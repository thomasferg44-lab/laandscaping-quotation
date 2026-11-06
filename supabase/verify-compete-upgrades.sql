-- Verification for patches/2026-11-05-compete-upgrades.sql.
-- Paste the whole file into the Supabase SQL editor and Run AFTER the patch.
-- Every row should say PASS. Run supabase/verify-rls.sql as well.
--
-- Changes nothing: creates throwaway logins and quotes, acts as anon /
-- those logins (set local role + request.jwt.claims, as PostgREST does),
-- then rolls ALL of it back before writing the results.

create temp table if not exists verify_results (n serial, test text, result text);
truncate verify_results;

do $$
declare
  res   text[] := '{}';
  ua    uuid := gen_random_uuid();   -- ordinary login A
  ub    uuid := gen_random_uuid();   -- ordinary login B
  us    uuid := gen_random_uuid();   -- allowlisted staff login
  q_leg uuid;  -- legacy single-option quote (no new fields set)
  q_tie uuid;  -- tiered quote with an optional add-on and a 50% deposit
  q_exp uuid;  -- expired quote
  q_opt uuid;  -- single-option quote with an optional add-on
  q_dra uuid;  -- draft
  n int; n2 int; ok boolean; txt text; r record; row_ record;
  items jsonb := '[{"id":"a","description":"Lawn","mode":"area","qty":40,"rate":85,"total":3400},
                   {"id":"b","description":"Compost","mode":"load","qty":1,"rate":1250.5,"total":1250.5}]';
begin
  begin  -- sandbox: everything below is rolled back at the end
    insert into auth.users (id, instance_id, aud, role, email)
    values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'verify-a-' || ua || '@example.invalid'),
           (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'verify-b-' || ub || '@example.invalid'),
           (us, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'verify-s-' || us || '@example.invalid');
    insert into public.business_users (user_id, note) values (us, 'verify-compete test');

    insert into public.quotes (customer_name, status, owner_id, line_items, subtotal, total)
      values ('Verify legacy', 'sent', ua, items, 4650.5, 4650.5) returning id into q_leg;
    insert into public.quotes (customer_name, status, owner_id, line_items, subtotal, total, deposit_type, deposit_value, tiers)
      values ('Verify tiers', 'viewed', ua, items, 4650.5, 4650.5, 'percent', 50,
        jsonb_build_array(
          jsonb_build_object('id','good','name','Good','line_items', items),
          jsonb_build_object('id','best','name','Best','line_items', items || '[{"id":"x","description":"Irrigation","mode":"plain","qty":1,"rate":999.99,"total":999.99,"optional":true}]'::jsonb)))
      returning id into q_tie;
    insert into public.quotes (customer_name, status, owner_id, line_items, subtotal, total, valid_until)
      values ('Verify expired', 'sent', ua, items, 4650.5, 4650.5, public.quote_business_today() - 1) returning id into q_exp;
    insert into public.quotes (customer_name, status, owner_id, line_items, subtotal, total, valid_until)
      values ('Verify optional', 'sent', ua,
        items || '[{"id":"o","description":"Mulch","mode":"unit","qty":2,"rate":95,"total":190,"optional":true}]'::jsonb,
        4650.5, 4650.5, public.quote_business_today()) returning id into q_opt;
    insert into public.quotes (customer_name, status, owner_id) values ('Verify draft', 'draft', ua) returning id into q_dra;

    -- --- get_public_quote: old links still resolve, new fields present ----
    begin
      set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*), bool_and(id = q_leg and tiers is null and is_expired = false and line_items = items)
        into n, ok from public.get_public_quote(q_leg::text);
      select is_expired into row_ from public.get_public_quote(q_exp::text);
      select count(*) into n2 from public.get_public_quote(q_dra::text);
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('legacy quote still resolves through get_public_quote|' || case when n = 1 and ok then 'PASS' else 'FAIL: rows=' || n end);
      res := res || ('get_public_quote reports expiry server-side|' || case when row_.is_expired then 'PASS' else 'FAIL' end);
      res := res || ('drafts still never returned|' || case when n2 = 0 then 'PASS' else 'FAIL' end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('get_public_quote|FAIL: ' || sqlerrm);
    end;

    txt := pg_get_function_result('public.get_public_quote(text)'::regprocedure);
    res := res || ('get_public_quote returns no internal columns|' ||
      case when txt ~ '(owner_id|parent_quote_id|portion|updated_at|accepted_consent)' then 'FAIL: ' || txt else 'PASS' end);

    -- --- legacy accept ------------------------------------------------------
    begin
      set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      ok := public.accept_public_quote(q_tie::text);   -- tiered: must refuse
      n  := case when public.accept_public_quote(q_exp::text) then 1 else 0 end;  -- expired: must refuse
      n2 := case when public.accept_public_quote(q_leg::text) then 1 else 0 end;  -- legacy: accepts
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('old accept refuses a tiered quote|' || case when not ok and (select status from public.quotes where id = q_tie) = 'viewed' then 'PASS' else 'FAIL' end);
      res := res || ('old accept refuses an expired quote|' || case when n = 0 and (select status from public.quotes where id = q_exp) = 'sent' then 'PASS' else 'FAIL' end);
      select * into row_ from public.quotes where id = q_leg;
      res := res || ('old accept still accepts a single-option quote|' ||
        case when n2 = 1 and row_.status = 'accepted' and row_.accepted_at is not null
               and row_.accepted_selection->>'accepted_via' = 'legacy-button' and row_.total = 4650.5
             then 'PASS' else 'FAIL: status=' || row_.status end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('legacy accept|FAIL: ' || sqlerrm);
    end;

    -- --- v2 accept: validation -------------------------------------------
    begin
      set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      txt := public.accept_public_quote_v2(q_tie::text, ' ', true, 'best', '{x}')
          || ',' || public.accept_public_quote_v2(q_tie::text, 'Test Customer', false, 'best', '{x}')
          || ',' || public.accept_public_quote_v2(q_tie::text, 'Test Customer', true, 'platinum', '{}')
          || ',' || public.accept_public_quote_v2(q_tie::text, 'Test Customer', true, null, '{}')
          || ',' || public.accept_public_quote_v2(q_exp::text, 'Test Customer', true, null, '{}')
          || ',' || public.accept_public_quote_v2(q_dra::text, 'Test Customer', true, null, '{}')
          || ',' || public.accept_public_quote_v2('%', 'Test Customer', true, null, '{}');
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('v2 refuses: no name, no consent, bad tier, no tier, expired, draft, bad token|' ||
        case when txt = 'name_required,consent_required,invalid_tier,invalid_tier,expired,not_found,not_found'
               and (select status from public.quotes where id = q_tie) = 'viewed'
               and (select status from public.quotes where id = q_exp) = 'sent'
             then 'PASS' else 'FAIL: ' || txt end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('v2 validation|FAIL: ' || sqlerrm);
    end;

    -- --- v2 accept: tier + add-on + deposit, totals computed server-side ---
    begin
      set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      -- 'a' is required (can't be double-added), 'ghost' doesn't exist
      txt := public.accept_public_quote_v2(q_tie::text, '  Test Customer  ', true, 'best', '{x,a,ghost}');
      n := case when public.accept_public_quote_v2(q_tie::text, 'Test Customer', true, 'best', '{x}') = 'not_open' then 1 else 0 end;
      reset role; perform set_config('request.jwt.claims', '', true);
      select * into row_ from public.quotes where id = q_tie;
      res := res || ('v2 accepts the chosen tier with the ticked add-on|' ||
        case when txt = 'accepted' and row_.status = 'accepted' and row_.accepted_at is not null
               and row_.accepted_name = 'Test Customer' and row_.accepted_consent and row_.accepted_tier_id = 'best'
               and jsonb_array_length(row_.accepted_selection->'line_items') = 3
             then 'PASS' else 'FAIL: ' || txt || ' ' || coalesce(row_.accepted_selection::text, 'no snapshot') end);
      res := res || ('v2 total and 50% deposit computed server-side|' ||
        case when row_.total = 5650.49 and (row_.accepted_selection->>'deposit_amount')::numeric = 2825.25
               and (row_.accepted_selection->>'balance_amount')::numeric = 2825.24
             then 'PASS: 5650.49 = 2825.25 + 2825.24' else 'FAIL: total=' || row_.total || ' snapshot=' || row_.accepted_selection::text end);
      res := res || ('v2 cannot accept twice|' || case when n = 1 then 'PASS' else 'FAIL' end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('v2 tier accept|FAIL: ' || sqlerrm);
    end;

    begin
      set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      txt := public.accept_public_quote_v2(q_opt::text, 'Test Customer', true, null, '{}');  -- valid until today: still open
      reset role; perform set_config('request.jwt.claims', '', true);
      select * into row_ from public.quotes where id = q_opt;
      res := res || ('optional add-on left unticked is excluded; valid-until today still accepts|' ||
        case when txt = 'accepted' and row_.total = 4650.5 and jsonb_array_length(row_.accepted_selection->'line_items') = 2
             then 'PASS' else 'FAIL: ' || txt || ' total=' || row_.total end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('optional exclusion|FAIL: ' || sqlerrm);
    end;

    -- --- guard: acceptance columns can't be forged outside the function ---
    begin
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);  -- anon JWT, as a definer function would see it
      update public.quotes set accepted_name = 'Forged', status = 'accepted' where id = q_exp;
      perform set_config('request.jwt.claims', '', true);
      res := res || 'guard blocks forged acceptance details|FAIL: update went through'::text;
    exception when others then
      perform set_config('request.jwt.claims', '', true);
      res := res || ('guard blocks forged acceptance details|' || case when sqlerrm like 'acceptance details%' then 'PASS' else 'FAIL: ' || sqlerrm end);
    end;
    begin
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      update public.quotes set valid_until = null where id = q_exp;
      perform set_config('request.jwt.claims', '', true);
      res := res || 'guard blocks un-expiring a quote|FAIL: update went through'::text;
    exception when others then
      perform set_config('request.jwt.claims', '', true);
      res := res || ('guard blocks un-expiring a quote|' || case when sqlerrm like 'anon may only change status%' then 'PASS' else 'FAIL: ' || sqlerrm end);
    end;

    -- --- sent_at stamped on draft -> sent -----------------------------------
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
      update public.quotes set status = 'sent' where id = q_dra;
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('sent_at stamped when a draft is sent|' || case when (select sent_at from public.quotes where id = q_dra) is not null then 'PASS' else 'FAIL' end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('sent_at stamped|FAIL: ' || sqlerrm);
    end;

    -- --- item library RLS ---------------------------------------------------
    insert into public.quote_library_items (name, default_rate, owner_id) values ('Verify A item', 10, ua), ('Verify B item', 20, ub);
    begin
      set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*) into n from public.quote_library_items;
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('anon cannot read the item library|' || case when n = 0 then 'PASS: 0 rows' else 'FAIL: ' || n end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('anon cannot read the item library|' || case when sqlstate = '42501' then 'PASS: permission denied' else 'FAIL: ' || sqlerrm end);
    end;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
      select count(*) into n from public.quote_library_items;
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('login sees only its own library items|' || case when n = 1 then 'PASS' else 'FAIL: sees ' || n end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('library RLS|FAIL: ' || sqlerrm);
    end;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
      insert into public.quote_library_items (name, owner_id) values ('Forged', ub);
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || 'login cannot add library items as someone else|FAIL: insert went through'::text;
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('login cannot add library items as someone else|' || case when sqlstate = '42501' then 'PASS: blocked by RLS' else 'FAIL: ' || sqlerrm end);
    end;

    -- --- demo data removal touches only the caller's demo rows -------------
    insert into public.quotes (customer_name, status, owner_id, is_demo)
      values ('Verify A demo', 'draft', ua, true), ('Verify B demo', 'draft', ub, true);
    begin
      set local role authenticated;  -- staff login: RLS lets it SEE everyone's quotes
      perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
      insert into public.quotes (customer_name, status, is_demo) values ('Verify S demo', 'draft', true);
      delete from public.quotes where is_demo and owner_id = us;  -- what removeDemoData() sends
      get diagnostics n = row_count;
      reset role; perform set_config('request.jwt.claims', '', true);
      select count(*) into n2 from public.quotes where customer_name in ('Verify A demo', 'Verify B demo');
      res := res || ('demo removal deletes only the caller''s demo rows|' || case when n = 1 and n2 = 2 then 'PASS' else 'FAIL: deleted ' || n || ', others left ' || n2 end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('demo removal|FAIL: ' || sqlerrm);
    end;

    -- --- EXECUTE grants on the new functions -----------------------------
    for r in
      select p.oid::regprocedure::text as fn,
             has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_x,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_x
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public'
        and p.proname in ('get_public_quote','accept_public_quote','accept_public_quote_v2','accept_quote_as_customer','quote_business_today')
      order by 1
    loop
      txt := case
        when r.fn like 'accept_quote_as_customer(%' or r.fn like 'quote_business_today(%'
          then case when not r.anon_x and not r.auth_x then 'PASS: no API access' else 'FAIL: anon=' || r.anon_x || ' authenticated=' || r.auth_x end
        else case when r.anon_x and not r.auth_x then 'PASS: anon only' else 'FAIL: anon=' || r.anon_x || ' authenticated=' || r.auth_x end
      end;
      res := res || ('execute grant: ' || r.fn || '|' || txt);
    end loop;

    raise exception 'verify_compete_rollback';
  exception when others then
    if sqlerrm <> 'verify_compete_rollback' then
      res := res || ('setup|FAIL: ' || sqlerrm || ' (has supabase/patches/2026-11-05-compete-upgrades.sql been run?)');
    end if;
  end;

  insert into verify_results (test, result)
  select split_part(x, '|', 1), substr(x, position('|' in x) + 1)
  from unnest(res) with ordinality as t(x, i) order by i;
end $$;

select test, result from verify_results order by n;

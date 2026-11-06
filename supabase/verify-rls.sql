-- Access-control verification for quotes.
-- Paste the whole file into the Supabase SQL editor and Run. Read the result
-- grid: every row should say PASS.
--
-- Changes nothing. It creates throwaway test logins and quotes, acts as
-- anon / as those logins, then rolls ALL of it back before writing the
-- results. Works on an empty project.
--
-- How it acts as other users: the SQL editor runs as `postgres`, where
-- auth.role() and auth.uid() are null because there is no JWT. So each test
-- does `set local role anon|authenticated` (what PostgREST does per request)
-- and sets request.jwt.claims (what auth.uid()/auth.role() read), then
-- resets both. Results are collected in a variable, since the rollback
-- would wipe a table.

create temp table if not exists verify_results (n serial, test text, result text);
truncate verify_results;

do $$
declare
  res   text[] := '{}';
  ua    uuid := gen_random_uuid();   -- ordinary login A (not allowlisted)
  ub    uuid := gen_random_uuid();   -- ordinary login B (not allowlisted)
  us    uuid := gen_random_uuid();   -- staff login (allowlisted)
  qa    uuid;                        -- A's sent quote
  qb    uuid;                        -- B's sent quote
  qd    uuid;                        -- A's draft
  n     int;
  n2    int;
  ok    boolean;
  txt   text;
  r     record;
begin
  begin  -- sandbox: everything below is rolled back at the end
    -- --- fixtures (as postgres) ------------------------------------------
    insert into auth.users (id, instance_id, aud, role, email)
    values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'verify-a-' || ua || '@example.invalid'),
           (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'verify-b-' || ub || '@example.invalid'),
           (us, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'verify-s-' || us || '@example.invalid');
    insert into public.business_users (user_id, note) values (us, 'verify-rls test');
    insert into public.quotes (customer_name, status, owner_id) values ('Verify A', 'sent', ua)  returning id into qa;
    insert into public.quotes (customer_name, status, owner_id) values ('Verify B', 'sent', ub)  returning id into qb;
    insert into public.quotes (customer_name, status, owner_id) values ('Verify D', 'draft', ua) returning id into qd;

    -- --- anon: table ------------------------------------------------------
    begin
      set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*) into n from public.quotes;
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('anon cannot select from quotes|' || case when n = 0 then 'PASS: 0 rows' else 'FAIL: ' || n || ' rows visible' end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('anon cannot select from quotes|' || case when sqlstate = '42501' then 'PASS: permission denied' else 'FAIL: unexpected error ' || sqlerrm end);
    end;

    begin
      set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      update public.quotes set status = 'accepted' where id = qa;
      get diagnostics n = row_count;
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('anon cannot update quotes directly|' || case when n = 0 then 'PASS: 0 rows' else 'FAIL: ' || n || ' rows updated' end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('anon cannot update quotes directly|' || case when sqlstate = '42501' then 'PASS: permission denied' else 'FAIL: unexpected error ' || sqlerrm end);
    end;

    begin
      set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*) into n from public.business_users;
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('anon cannot read business_users|' || case when n = 0 then 'PASS: 0 rows' else 'FAIL: ' || n || ' rows visible' end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('anon cannot read business_users|' || case when sqlstate = '42501' then 'PASS: permission denied' else 'FAIL: unexpected error ' || sqlerrm end);
    end;

    -- --- anon: get_public_quote ------------------------------------------
    begin
      set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*) into n from (
        select * from public.get_public_quote(null)
        union all select * from public.get_public_quote('')
        union all select * from public.get_public_quote('%')
        union all select * from public.get_public_quote('*')
        union all select * from public.get_public_quote(''' or 1=1 --')
        union all select * from public.get_public_quote(left(qa::text, 8))
      ) t;
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('anon cannot list quotes through the function|' || case when n = 0 then 'PASS: null/empty/wildcard/partial tokens return 0 rows' else 'FAIL: ' || n || ' rows returned' end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('anon cannot list quotes through the function|FAIL: ' || sqlerrm);
    end;

    begin
      set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*), bool_and(id = qa and customer_name = 'Verify A') into n, ok from public.get_public_quote(qa::text);
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('anon fetches one quote with a valid token|' || case when n = 1 and ok then 'PASS' else 'FAIL: rows=' || n end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('anon fetches one quote with a valid token|FAIL: ' || sqlerrm);
    end;

    begin
      set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*) into n  from public.get_public_quote(gen_random_uuid()::text);
      select count(*) into n2 from public.get_public_quote(qd::text);
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('anon gets nothing with a wrong token|' || case when n = 0 then 'PASS' else 'FAIL: rows=' || n end);
      res := res || ('anon gets nothing for a draft|' || case when n2 = 0 then 'PASS' else 'FAIL: rows=' || n2 end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('anon gets nothing with a wrong token|FAIL: ' || sqlerrm);
    end;

    txt := pg_get_function_result('public.get_public_quote(text)'::regprocedure);
    res := res || ('get_public_quote returns no internal columns|' ||
      case when txt ~ '(owner_id|parent_quote_id|portion|updated_at)' then 'FAIL: ' || txt else 'PASS' end);

    -- --- anon: status transitions through the functions ------------------
    begin
      set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      perform public.mark_public_quote_viewed(qa::text);
      perform public.mark_public_quote_viewed(gen_random_uuid()::text);  -- unknown: silent no-op
      reset role; perform set_config('request.jwt.claims', '', true);
      select count(*) into n from public.quotes where id = qa and status = 'viewed' and viewed_at is not null;
      res := res || ('anon marks a sent quote viewed|' || case when n = 1 then 'PASS: viewed_at stamped' else 'FAIL' end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('anon marks a sent quote viewed|FAIL: ' || sqlerrm);
    end;

    begin
      set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      ok := public.accept_public_quote(qa::text);
      n  := case when public.accept_public_quote(qa::text) then 1 else 0 end;  -- second time: already accepted
      n2 := case when public.accept_public_quote(qd::text) then 1 else 0 end;  -- draft: refused
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('anon accepts with a valid token|' || case when ok and exists (select 1 from public.quotes where id = qa and status = 'accepted' and accepted_at is not null) then 'PASS' else 'FAIL' end);
      res := res || ('anon cannot accept twice or accept a draft|' || case when n = 0 and n2 = 0 and (select status from public.quotes where id = qd) = 'draft' then 'PASS' else 'FAIL' end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('anon accepts with a valid token|FAIL: ' || sqlerrm);
    end;

    -- --- logged-in users ---------------------------------------------------
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
      select count(*) into n  from public.quotes where id = qb;
      select count(*) into n2 from public.quotes where owner_id is distinct from ua;
      ok := public.is_business_user();
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('logged-in user cannot see another user''s quotes|' || case when n = 0 and n2 = 0 then 'PASS' else 'FAIL: sees ' || n2 || ' quotes it does not own' end);
      res := res || ('ordinary login is not a business user|' || case when not ok then 'PASS' else 'FAIL' end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('logged-in user cannot see another user''s quotes|FAIL: ' || sqlerrm);
    end;

    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
      select count(*) into n from public.quotes where id in (qa, qd);
      update public.quotes set customer_name = 'hacked' where id = qb;
      get diagnostics n2 = row_count;
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('logged-in user sees their own quotes|' || case when n = 2 then 'PASS' else 'FAIL: sees ' || n || ' of 2' end);
      res := res || ('logged-in user cannot edit another user''s quote|' || case when n2 = 0 then 'PASS: 0 rows' else 'FAIL: ' || n2 || ' rows updated' end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('logged-in user cannot edit another user''s quote|FAIL: ' || sqlerrm);
    end;

    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
      insert into public.quotes (customer_name, owner_id) values ('Verify forged', ub);
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || 'logged-in user cannot create quotes as someone else|FAIL: insert went through'::text;
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('logged-in user cannot create quotes as someone else|' || case when sqlstate = '42501' then 'PASS: blocked by RLS' else 'FAIL: unexpected error ' || sqlerrm end);
    end;

    begin
      select count(*) into n2 from public.quotes;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
      select count(*) into n from public.quotes;
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('allowlisted business user sees all quotes|' || case when n = n2 then 'PASS: ' || n || ' rows' else 'FAIL: sees ' || n || ' of ' || n2 end);
    exception when others then
      reset role; perform set_config('request.jwt.claims', '', true);
      res := res || ('allowlisted business user sees all quotes|FAIL: ' || sqlerrm);
    end;

    -- --- EXECUTE grants on every function in schema public -----------------
    for r in
      select p.oid::regprocedure::text as fn,
             has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_x,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_x
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public'
      order by 1
    loop
      txt := case
        when r.fn like 'get_public_quote(%' or r.fn like 'mark_public_quote_viewed(%' or r.fn like 'accept_public_quote(%' or r.fn like 'accept_public_quote_v2(%'
          then case when r.anon_x and not r.auth_x then 'PASS: anon only' else 'FAIL: anon=' || r.anon_x || ' authenticated=' || r.auth_x end
        when r.fn like 'is_business_user(%'
          then case when r.auth_x and not r.anon_x then 'PASS: authenticated only' else 'FAIL: anon=' || r.anon_x || ' authenticated=' || r.auth_x end
        else case when not r.anon_x and not r.auth_x then 'PASS: no API access' else 'FAIL: anon=' || r.anon_x || ' authenticated=' || r.auth_x || ' (revoke unless intended)' end
      end;
      res := res || ('execute grant: ' || r.fn || '|' || txt);
    end loop;

    raise exception 'verify_rls_rollback';
  exception when others then
    if sqlerrm <> 'verify_rls_rollback' then
      res := res || ('setup|FAIL: ' || sqlerrm || ' (has supabase/patches/2026-10-06-lock-down-access.sql been run?)');
    end if;
  end;

  insert into verify_results (test, result)
  select split_part(x, '|', 1), substr(x, position('|' in x) + 1)
  from unnest(res) with ordinality as t(x, i) order by i;
end $$;

select test, result from verify_results order by n;

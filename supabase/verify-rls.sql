-- RLS + trigger verification for the quotes table.
-- Paste the whole file into the Supabase SQL editor and read the result
-- grid: every row should say PASS.
--
-- Needs at least one quote with status 'sent' or 'viewed'. Tests that are
-- expected to be blocked change nothing. The last test performs a real
-- sent -> viewed transition on that quote (and stamps viewed_at), which is
-- harmless but is a real change.

create temp table if not exists verify_results (n serial, test text, result text);
truncate verify_results;

do $$
declare
  qid uuid;
  old_name text;
  old_status text;
  rc int;
begin
  select id, customer_name, status into qid, old_name, old_status
  from public.quotes where status in ('sent','viewed')
  order by created_at desc limit 1;

  if qid is null then
    insert into verify_results (test, result)
    values ('setup', 'FAIL: no quote with status sent/viewed to test against');
    return;
  end if;
  insert into verify_results (test, result)
  values ('setup', 'using quote ' || qid || ' (status ' || old_status || ')');

  -- 1. anon must not edit a non-status column
  begin
    set local role anon;
    update public.quotes set customer_name = 'hacked' where id = qid;
    get diagnostics rc = row_count;
    reset role;
    if rc > 0 then
      update public.quotes set customer_name = old_name where id = qid; -- revert
      insert into verify_results (test, result)
      values ('anon edits customer_name', 'FAIL: update went through (reverted)');
    else
      insert into verify_results (test, result)
      values ('anon edits customer_name', 'PASS: RLS matched 0 rows');
    end if;
  exception when others then
    reset role;
    insert into verify_results (test, result)
    values ('anon edits customer_name', 'PASS: blocked - ' || sqlerrm);
  end;

  -- 2. anon must not move status backwards
  begin
    set local role anon;
    update public.quotes set status = 'draft' where id = qid;
    get diagnostics rc = row_count;
    reset role;
    if rc > 0 then
      update public.quotes set status = old_status where id = qid; -- revert
      insert into verify_results (test, result)
      values ('anon sets status=draft', 'FAIL: update went through (reverted)');
    else
      insert into verify_results (test, result)
      values ('anon sets status=draft', 'PASS: RLS matched 0 rows');
    end if;
  exception when others then
    reset role;
    insert into verify_results (test, result)
    values ('anon sets status=draft', 'PASS: blocked - ' || sqlerrm);
  end;

  -- 3. anon must not write timestamps directly
  begin
    set local role anon;
    update public.quotes set status = 'accepted', accepted_at = '2000-01-01' where id = qid;
    get diagnostics rc = row_count;
    reset role;
    if rc > 0 then
      update public.quotes set status = old_status, accepted_at = null where id = qid; -- revert
      insert into verify_results (test, result)
      values ('anon writes accepted_at', 'FAIL: update went through (reverted)');
    else
      insert into verify_results (test, result)
      values ('anon writes accepted_at', 'PASS: RLS matched 0 rows');
    end if;
  exception when others then
    reset role;
    insert into verify_results (test, result)
    values ('anon writes accepted_at', 'PASS: blocked - ' || sqlerrm);
  end;

  -- 4. anon must not read drafts
  begin
    set local role anon;
    select count(*) into rc from public.quotes where status = 'draft';
    reset role;
    insert into verify_results (test, result)
    values ('anon reads drafts', case when rc = 0 then 'PASS: 0 drafts visible' else 'FAIL: ' || rc || ' drafts visible' end);
  exception when others then
    reset role;
    insert into verify_results (test, result) values ('anon reads drafts', 'FAIL: ' || sqlerrm);
  end;

  -- 5. anon CAN perform the allowed transition, and viewed_at gets stamped
  if old_status = 'sent' then
    begin
      set local role anon;
      update public.quotes set status = 'viewed' where id = qid;
      get diagnostics rc = row_count;
      reset role;
      if rc = 1 and (select viewed_at from public.quotes where id = qid) is not null then
        insert into verify_results (test, result) values ('anon sent->viewed', 'PASS: status updated and viewed_at stamped');
      else
        insert into verify_results (test, result) values ('anon sent->viewed', 'FAIL: rows=' || rc || ', viewed_at not stamped');
      end if;
    exception when others then
      reset role;
      insert into verify_results (test, result) values ('anon sent->viewed', 'FAIL: ' || sqlerrm);
    end;
  else
    insert into verify_results (test, result) values ('anon sent->viewed', 'SKIPPED: quote already viewed');
  end if;

  -- 6. authenticated (landscaper) can still edit freely
  begin
    set local role authenticated;
    update public.quotes set customer_name = old_name where id = qid;
    get diagnostics rc = row_count;
    reset role;
    insert into verify_results (test, result)
    values ('authenticated edits', case when rc = 1 then 'PASS' else 'FAIL: 0 rows matched' end);
  exception when others then
    reset role;
    insert into verify_results (test, result) values ('authenticated edits', 'FAIL: ' || sqlerrm);
  end;
end $$;

select test, result from verify_results order by n;

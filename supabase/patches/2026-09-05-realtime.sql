-- Patch 2026-09-05: enable Realtime on quotes for the dashboard.
-- Paste into the Supabase SQL editor. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Realtime: let the landscaper's dashboard receive row changes instantly.
-- Only authenticated clients can subscribe usefully: realtime respects RLS,
-- so anon would only ever see non-draft rows, and the public page doesn't
-- subscribe at all. The dashboard also polls, so this is an enhancement,
-- not a requirement.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quotes'
  ) then
    alter publication supabase_realtime add table public.quotes;
  end if;
end $$;

-- Verify: should return one row
select * from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'quotes';

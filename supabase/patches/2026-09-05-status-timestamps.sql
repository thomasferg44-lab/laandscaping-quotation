-- Patch 2026-09-05: status timestamp stamping + anon update guard.
-- Paste into the Supabase SQL editor. Safe to re-run. Also included in
-- schema.sql for fresh deploys.
--
-- Fixes: viewed_at / accepted_at were never stamped (trigger missing from
-- the live project), and stamping was wrongly tied to the anon role.

-- Stamp status timestamps for ANY role. Whenever status moves into one of
-- the timestamped states, fill its *_at column if it is still empty. The
-- app never writes these columns itself; it only sends { status }.
create or replace function public.stamp_status_timestamps()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'viewed'   and new.viewed_at   is null then new.viewed_at   := now(); end if;
    if new.status = 'accepted' and new.accepted_at is null then new.accepted_at := now(); end if;
    if new.status = 'invoiced' and new.invoiced_at is null then new.invoiced_at := now(); end if;
    if new.status = 'paid'     and new.paid_at     is null then new.paid_at     := now(); end if;
  end if;
  return new;
end $$;

drop trigger if exists quotes_stamp_status_timestamps on public.quotes;
create trigger quotes_stamp_status_timestamps
  before update on public.quotes
  for each row execute function public.stamp_status_timestamps();

-- Guard: when the caller is anon, reject any change other than the allowed
-- forward status transition. Runs for all roles but only constrains anon.
--
-- Detect anon by the DATABASE role, not auth.role(). auth.role() reads the
-- JWT claim that PostgREST injects per request; it is null in the SQL editor
-- (set role anon) and null for any non-PostgREST path, so a guard based on
-- it can be bypassed. PostgREST always does "set local role anon" for
-- anon-key requests, so current_user covers both paths.
create or replace function public.guard_anon_quote_update()
returns trigger language plpgsql as $$
begin
  if current_user = 'anon' or coalesce(auth.role(), '') = 'anon' then
    if new.customer_name  is distinct from old.customer_name
    or new.customer_phone is distinct from old.customer_phone
    or new.customer_email is distinct from old.customer_email
    or new.line_items     is distinct from old.line_items
    or new.subtotal       is distinct from old.subtotal
    or new.total          is distinct from old.total
    or new.parent_quote_id is distinct from old.parent_quote_id
    or new.portion        is distinct from old.portion
    or new.viewed_at      is distinct from old.viewed_at
    or new.accepted_at    is distinct from old.accepted_at
    or new.invoiced_at    is distinct from old.invoiced_at
    or new.paid_at        is distinct from old.paid_at
    or new.created_at     is distinct from old.created_at then
      raise exception 'anon may only change status (timestamps are stamped server-side)';
    end if;
    if not (
      (old.status = 'sent'   and new.status in ('viewed','accepted')) or
      (old.status = 'viewed' and new.status = 'accepted')
    ) then
      raise exception 'invalid status transition for anon: % -> %', old.status, new.status;
    end if;
  end if;
  return new;
end $$;

-- Named with a leading "a" so it fires before the stamp trigger (Postgres
-- runs same-event triggers in alphabetical order); the guard sees the raw
-- request, then the stamp fills timestamps.
drop trigger if exists quotes_guard_anon_update on public.quotes;
drop trigger if exists quotes_a_guard_anon_update on public.quotes;
create trigger quotes_a_guard_anon_update
  before update on public.quotes
  for each row execute function public.guard_anon_quote_update();

-- Verify: should list quotes_a_guard_anon_update, quotes_set_updated_at,
-- quotes_stamp_status_timestamps
select tgname from pg_trigger
where tgrelid = 'public.quotes'::regclass and not tgisinternal
order by tgname;

-- Patch 2026-10-06: lock down access to quotes.
-- Paste the whole file into the Supabase SQL editor and Run. Safe to re-run.
-- Runs in one transaction: if any statement fails, nothing changes.
-- Already folded into schema.sql for fresh deploys.
--
-- Before this patch:
--   * anon could SELECT every non-draft quote (customer names, phones,
--     emails) with a plain `select *`. The uuid in the link didn't matter.
--   * any authenticated user had full access to every quote, and Supabase
--     allows sign-ups by default.
--
-- After:
--   * anon has no table access at all. The public page goes through three
--     SECURITY DEFINER functions keyed by the quote's id (a random v4 uuid
--     from gen_random_uuid(), so it is already an unguessable token):
--       get_public_quote(token)          one quote, public fields only
--       mark_public_quote_viewed(token)  sent -> viewed
--       accept_public_quote(token)       sent|viewed -> accepted
--   * authenticated users see only quotes they own, unless they are on the
--     business_users allowlist (the landscaper and their staff), who see all.
--
-- AFTER RUNNING: the landscaper is locked out until you allowlist them with
-- supabase/add-business-user.sql. The last result row reminds you.

begin;

-- ---------------------------------------------------------------------------
-- 1. Ownership + business allowlist
-- ---------------------------------------------------------------------------
alter table public.quotes
  add column if not exists owner_id uuid default auth.uid()
    references auth.users(id) on delete set null;
create index if not exists quotes_owner_id_idx on public.quotes (owner_id);

-- Staff of the business. Rows are added by hand in the SQL editor
-- (supabase/add-business-user.sql); the app never writes here.
create table if not exists public.business_users (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  note     text,
  added_at timestamptz not null default now()
);
alter table public.business_users enable row level security;
-- No policies: anon/authenticated can't read or write it. Only the
-- is_business_user() function below (security definer) looks inside.
revoke all on public.business_users from anon, authenticated;

create or replace function public.is_business_user()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.business_users where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- 2. Policies on quotes
-- ---------------------------------------------------------------------------
drop policy if exists "landscaper full access"       on public.quotes;
drop policy if exists "public can view sent quotes"  on public.quotes;
drop policy if exists "public can advance status"    on public.quotes;
drop policy if exists "owner or business user"       on public.quotes;

create policy "owner or business user" on public.quotes
  for all to authenticated
  using      (public.is_business_user() or owner_id = (select auth.uid()))
  with check (public.is_business_user() or owner_id = (select auth.uid()));

-- Belt and braces: with no anon policy RLS already returns nothing, but
-- revoking the table grants makes any anon query fail outright.
revoke all on public.quotes from anon;

-- ---------------------------------------------------------------------------
-- 3. Public quote page functions (anon only)
-- ---------------------------------------------------------------------------
-- Token must be a canonical uuid; anything else (null, '', '%', '*') returns
-- nothing rather than erroring, and there is no way to pass a pattern.
-- Returns only what the public page and its PDF render: no owner_id,
-- parent_quote_id, portion or updated_at. Drafts are never returned.
-- Customer phone/email are included because the PDF prints them; the person
-- holding the link is that customer.
drop function if exists public.get_public_quote(text);
create function public.get_public_quote(p_token text)
returns table (
  id uuid, status text,
  customer_name text, customer_phone text, customer_email text,
  line_items jsonb, subtotal numeric, total numeric,
  created_at timestamptz, viewed_at timestamptz, accepted_at timestamptz,
  invoiced_at timestamptz, paid_at timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_token is null
     or p_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return;
  end if;
  return query
    select q.id, q.status,
           q.customer_name, q.customer_phone, q.customer_email,
           q.line_items, q.subtotal, q.total,
           q.created_at, q.viewed_at, q.accepted_at, q.invoiced_at, q.paid_at
    from public.quotes q
    where q.id = p_token::uuid
      and q.status <> 'draft'
    limit 1;
end $$;

-- First open by the customer. No-op unless the quote is currently 'sent'.
-- viewed_at is stamped by the quotes_stamp_status_timestamps trigger.
create or replace function public.mark_public_quote_viewed(p_token text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if p_token is null
     or p_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return;
  end if;
  update public.quotes set status = 'viewed'
  where id = p_token::uuid and status = 'sent';
end $$;

-- Accept button. Returns true if this call accepted the quote, false if the
-- token is unknown or the quote isn't in sent/viewed (already accepted,
-- invoiced, or still a draft).
create or replace function public.accept_public_quote(p_token text)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if p_token is null
     or p_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  update public.quotes set status = 'accepted'
  where id = p_token::uuid and status in ('sent','viewed');
  return found;
end $$;

-- ---------------------------------------------------------------------------
-- 4. EXECUTE grants for EVERY function in this schema.
-- Postgres grants EXECUTE to PUBLIC on new functions, and Supabase's default
-- privileges also grant it to anon and authenticated explicitly, so revoking
-- from PUBLIC alone is not enough: revoke from all three, then grant back.
-- (Trigger functions only need EXECUTE when the trigger is created, not when
-- it fires, so revoking them is safe.)
-- ---------------------------------------------------------------------------
revoke execute on function public.get_public_quote(text)         from public, anon, authenticated;
revoke execute on function public.mark_public_quote_viewed(text) from public, anon, authenticated;
revoke execute on function public.accept_public_quote(text)      from public, anon, authenticated;
revoke execute on function public.is_business_user()             from public, anon, authenticated;
revoke execute on function public.set_updated_at()               from public, anon, authenticated;
revoke execute on function public.stamp_status_timestamps()      from public, anon, authenticated;
revoke execute on function public.guard_anon_quote_update()      from public, anon, authenticated;

grant execute on function public.get_public_quote(text)         to anon;
grant execute on function public.mark_public_quote_viewed(text) to anon;
grant execute on function public.accept_public_quote(text)      to anon;
-- Called inside the authenticated RLS policy and by the app's access check.
grant execute on function public.is_business_user()             to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Photo storage: any signed-in user could replace or delete any photo.
-- Upload stays open to signed-in users (owners need it); changing or
-- deleting needs the uploader or a business user.
-- ---------------------------------------------------------------------------
drop policy if exists "landscaper update quote photos" on storage.objects;
create policy "landscaper update quote photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'quote-photos'
         and (public.is_business_user() or owner_id = (select auth.uid())::text));

drop policy if exists "landscaper delete quote photos" on storage.objects;
create policy "landscaper delete quote photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'quote-photos'
         and (public.is_business_user() or owner_id = (select auth.uid())::text));

commit;

-- Shown as the result grid in the SQL editor.
select case
  when exists (select 1 from public.business_users)
    then 'OK: patch applied. ' || (select count(*) from public.business_users) || ' business user(s) allowlisted.'
  else 'PATCH APPLIED, BUT NOBODY CAN SEE QUOTES YET: run supabase/add-business-user.sql with the landscaper''s email next.'
end as next_step;

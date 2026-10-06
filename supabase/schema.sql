-- DropStack Quote & Invoice Tool (landscaping) — schema for ONE client deploy.
-- One Supabase project per client, so there is no client_id column.
-- Paste this whole file into the Supabase SQL editor for the client's project,
-- then run supabase/add-business-user.sql for the landscaper's login.

-- ---------------------------------------------------------------------------
-- quotes: one record serves as the quote AND, once status advances, the invoice
-- ---------------------------------------------------------------------------
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(), -- random v4: doubles as the public link token
  owner_id uuid default auth.uid() references auth.users(id) on delete set null,
  customer_name text not null,
  customer_phone text,        -- for the WhatsApp share link
  customer_email text,        -- for the mailto share link
  line_items jsonb not null default '[]',
    -- array of: { id, description, mode ('plain'|'area'|'unit'|'load'|'day'),
    --            qty, rate, total, photo_url (nullable) }
  subtotal numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'draft'
    check (status in ('draft','sent','viewed','accepted','invoiced','paid')),
  parent_quote_id uuid references public.quotes(id), -- future deposit/balance split
  portion text check (portion is null or portion in ('deposit','balance')),
  viewed_at timestamptz,
  accepted_at timestamptz,
  invoiced_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Re-pasting over a table created before owner_id existed:
alter table public.quotes
  add column if not exists owner_id uuid default auth.uid()
    references auth.users(id) on delete set null;
create index if not exists quotes_owner_id_idx on public.quotes (owner_id);
create index if not exists quotes_status_idx on public.quotes (status);
create index if not exists quotes_created_at_idx on public.quotes (created_at desc);

-- keep updated_at honest
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists quotes_set_updated_at on public.quotes;
create trigger quotes_set_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- anon: no table access; the public page uses the functions further down.
-- authenticated: own quotes, or all quotes if on the business_users allowlist.
-- ---------------------------------------------------------------------------
alter table public.quotes enable row level security;

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

-- ---------------------------------------------------------------------------
-- Public quote page functions (anon only)
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
-- EXECUTE grants for EVERY function in this schema.
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
-- Realtime: let the landscaper's dashboard receive row changes instantly.
-- Only authenticated clients can subscribe usefully: realtime respects RLS,
-- and anon has no access to the table; the public page doesn't subscribe. The dashboard also polls, so this is an enhancement,
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

-- ---------------------------------------------------------------------------
-- Storage: line-item photos
-- Public-read bucket so the hosted quote page can show thumbnails with no auth.
-- Signed-in users can upload; only the uploader or a business user can
-- replace or delete.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quote-photos', 'quote-photos', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read quote photos" on storage.objects;
create policy "public read quote photos" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'quote-photos');

drop policy if exists "landscaper upload quote photos" on storage.objects;
create policy "landscaper upload quote photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'quote-photos');

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

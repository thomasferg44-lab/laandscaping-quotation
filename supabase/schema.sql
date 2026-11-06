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
  -- compete-pass columns (tiers, deposit, expiry, acceptance, demo) are
  -- added just below with "add column if not exists", so this file works
  -- both fresh and re-pasted over an older table.
);

-- Re-pasting over a table created before owner_id existed:
alter table public.quotes
  add column if not exists owner_id uuid default auth.uid()
    references auth.users(id) on delete set null;
create index if not exists quotes_owner_id_idx on public.quotes (owner_id);
create index if not exists quotes_status_idx on public.quotes (status);
create index if not exists quotes_created_at_idx on public.quotes (created_at desc);

-- 2026-11-05 compete pass (patches/2026-11-05-compete-upgrades.sql)
alter table public.quotes
  add column if not exists tiers              jsonb,        -- null/[] = single option (line_items); else 2-3 { id, name, line_items }
  add column if not exists deposit_type       text,         -- 'percent' | 'fixed' | null
  add column if not exists deposit_value      numeric,      -- percent (0-100) or rand amount
  add column if not exists valid_until        date,         -- inclusive; null = no expiry
  add column if not exists sent_at            timestamptz,  -- stamped by trigger on -> 'sent'
  add column if not exists accepted_name      text,         -- customer's typed full name
  add column if not exists accepted_consent   boolean,      -- the consent tick
  add column if not exists accepted_tier_id   text,         -- chosen tier id (tiered quotes)
  add column if not exists accepted_selection jsonb,        -- frozen snapshot: items, totals, deposit split
  add column if not exists is_demo            boolean not null default false;

alter table public.quotes drop constraint if exists quotes_deposit_type_check;
alter table public.quotes add constraint quotes_deposit_type_check
  check (deposit_type is null or deposit_type in ('percent','fixed'));
alter table public.quotes drop constraint if exists quotes_deposit_value_check;
alter table public.quotes add constraint quotes_deposit_value_check
  check (deposit_value is null or (deposit_value >= 0 and (deposit_type is distinct from 'percent' or deposit_value <= 100)));
alter table public.quotes drop constraint if exists quotes_tiers_check;
alter table public.quotes add constraint quotes_tiers_check
  check (tiers is null or (jsonb_typeof(tiers) = 'array' and jsonb_array_length(tiers) <= 3));
alter table public.quotes drop constraint if exists quotes_accepted_name_check;
alter table public.quotes add constraint quotes_accepted_name_check
  check (accepted_name is null or char_length(accepted_name) between 2 and 120);

create index if not exists quotes_demo_owner_idx on public.quotes (owner_id) where is_demo;


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

-- ---------------------------------------------------------------------------
-- Item library (pricebook-lite), per business
-- ---------------------------------------------------------------------------
create table if not exists public.quote_library_items (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid default auth.uid() references auth.users(id) on delete set null,
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  description  text check (description is null or char_length(description) <= 500),
  mode         text not null default 'unit' check (mode in ('plain','area','unit','load','day')),
  default_rate numeric not null default 0 check (default_rate >= 0),
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists quote_library_items_owner_idx on public.quote_library_items (owner_id);

drop trigger if exists quote_library_items_set_updated_at on public.quote_library_items;
create trigger quote_library_items_set_updated_at
  before update on public.quote_library_items
  for each row execute function public.set_updated_at();

-- Same access model as quotes: the owner, or anyone on the business_users
-- allowlist. anon: nothing.
alter table public.quote_library_items enable row level security;
drop policy if exists "owner or business user" on public.quote_library_items;
create policy "owner or business user" on public.quote_library_items
  for all to authenticated
  using      (public.is_business_user() or owner_id = (select auth.uid()))
  with check (public.is_business_user() or owner_id = (select auth.uid()));
revoke all on public.quote_library_items from anon;

-- Stamp status timestamps for ANY role. Whenever status moves into one of
-- the timestamped states, fill its *_at column if it is still empty. The
-- app never writes these columns itself; it only sends { status }.
create or replace function public.stamp_status_timestamps()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'sent'     and new.sent_at     is null then new.sent_at     := now(); end if;
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

-- Detect anon by the DATABASE role, not only auth.role(): auth.role() reads
-- the JWT claim PostgREST injects per request and is null on other paths;
-- PostgREST always does "set local role anon" for anon-key requests.
-- Anon (directly, or through a SECURITY DEFINER function called with the
-- anon JWT) may only move status forward. The acceptance columns may change
-- only inside accept_quote_as_customer(), which sets the transaction-local
-- flag quotes.customer_accept for the duration of its single UPDATE. anon
-- can't set that flag: it has no SQL access, only the granted functions.
create or replace function public.guard_anon_quote_update()
returns trigger language plpgsql as $$
declare
  accepting boolean := coalesce(current_setting('quotes.customer_accept', true), '') = 'on';
begin
  if current_user = 'anon' or coalesce(auth.role(), '') = 'anon' then
    if new.customer_name   is distinct from old.customer_name
    or new.customer_phone  is distinct from old.customer_phone
    or new.customer_email  is distinct from old.customer_email
    or new.line_items      is distinct from old.line_items
    or new.tiers           is distinct from old.tiers
    or new.deposit_type    is distinct from old.deposit_type
    or new.deposit_value   is distinct from old.deposit_value
    or new.valid_until     is distinct from old.valid_until
    or new.is_demo         is distinct from old.is_demo
    or new.owner_id        is distinct from old.owner_id
    or new.parent_quote_id is distinct from old.parent_quote_id
    or new.portion         is distinct from old.portion
    or new.sent_at         is distinct from old.sent_at
    or new.viewed_at       is distinct from old.viewed_at
    or new.accepted_at     is distinct from old.accepted_at
    or new.invoiced_at     is distinct from old.invoiced_at
    or new.paid_at         is distinct from old.paid_at
    or new.created_at      is distinct from old.created_at then
      raise exception 'anon may only change status (timestamps are stamped server-side)';
    end if;
    if (new.accepted_name      is distinct from old.accepted_name
     or new.accepted_consent   is distinct from old.accepted_consent
     or new.accepted_tier_id   is distinct from old.accepted_tier_id
     or new.accepted_selection is distinct from old.accepted_selection
     or new.subtotal           is distinct from old.subtotal
     or new.total              is distinct from old.total)
    and not (accepting and new.status = 'accepted') then
      raise exception 'acceptance details can only be recorded by accept_public_quote';
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
-- The business's calendar day, for expiry. One place to change the zone.
create or replace function public.quote_business_today()
returns date
language sql stable
set search_path = ''
as $$
  select (now() at time zone 'Africa/Johannesburg')::date;
$$;

-- Token must be a canonical uuid; anything else (null, '', '%', '*') returns
-- nothing rather than erroring, and there is no way to pass a pattern.
-- Returns only what the public page and its PDF render: no owner_id,
-- parent_quote_id, portion or updated_at. Drafts are never returned.
-- Customer phone/email are included because the PDF prints them; the person
-- holding the link is that customer.
-- Same contract as before (canonical uuid token, never drafts, no internal
-- columns), plus the compete-pass fields. is_expired is computed here so
-- the page doesn't depend on the phone's clock.
drop function if exists public.get_public_quote(text);
create function public.get_public_quote(p_token text)
returns table (
  id uuid, status text,
  customer_name text, customer_phone text, customer_email text,
  line_items jsonb, subtotal numeric, total numeric,
  created_at timestamptz, viewed_at timestamptz, accepted_at timestamptz,
  invoiced_at timestamptz, paid_at timestamptz,
  -- 2026-11-05
  tiers jsonb, deposit_type text, deposit_value numeric,
  valid_until date, is_expired boolean, sent_at timestamptz,
  accepted_name text, accepted_tier_id text, accepted_selection jsonb,
  is_demo boolean
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
           q.created_at, q.viewed_at, q.accepted_at, q.invoiced_at, q.paid_at,
           q.tiers, q.deposit_type, q.deposit_value,
           q.valid_until,
           (q.valid_until is not null and q.status in ('sent','viewed')
              and q.valid_until < public.quote_business_today()) as is_expired,
           q.sent_at,
           q.accepted_name, q.accepted_tier_id, q.accepted_selection,
           q.is_demo
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

-- The one acceptance implementation. Internal: not executable by anon or
-- authenticated; only the two accept wrappers below call it.
-- Returns 'accepted' | 'not_found' | 'not_open' | 'expired' | 'invalid_tier'
--       | 'name_required' | 'consent_required'.
-- Totals are computed HERE from the stored items, never taken from the
-- caller: the customer only chooses a tier and which optional ids to add.
create or replace function public.accept_quote_as_customer(
  p_token text, p_full_name text, p_consent boolean,
  p_tier_id text, p_optional_ids text[], p_require_signature boolean)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  q            public.quotes%rowtype;
  v_name       text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_tiered     boolean;
  v_tier       jsonb;
  v_tier_pos   bigint;
  v_items      jsonb;
  v_included   jsonb;
  v_optional   text[];
  v_total      numeric;
  v_has_dep    boolean;
  v_dep_value  numeric;
  v_deposit    numeric := 0;
  v_snapshot   jsonb;
begin
  if p_token is null
     or p_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return 'not_found';
  end if;
  if p_require_signature then
    if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
      return 'name_required';
    end if;
    if p_consent is not true then
      return 'consent_required';
    end if;
  end if;

  select * into q from public.quotes
  where id = p_token::uuid and status <> 'draft'
  for update;
  if not found then return 'not_found'; end if;
  if q.status not in ('sent','viewed') then return 'not_open'; end if;
  if q.valid_until is not null and q.valid_until < public.quote_business_today() then
    return 'expired';
  end if;

  v_tiered := q.tiers is not null and jsonb_typeof(q.tiers) = 'array' and jsonb_array_length(q.tiers) >= 2;
  if v_tiered then
    select t, o into v_tier, v_tier_pos
    from jsonb_array_elements(q.tiers) with ordinality as x(t, o)
    where t->>'id' = p_tier_id
    limit 1;
    if v_tier is null then return 'invalid_tier'; end if;
    v_items := v_tier->'line_items';
  else
    v_items := q.line_items;
  end if;
  if v_items is null or jsonb_typeof(v_items) <> 'array' then v_items := '[]'::jsonb; end if;

  -- Required items always; optional ones (optional = JSON true) only if picked.
  select coalesce(jsonb_agg(el order by ord), '[]'::jsonb),
         coalesce(sum(round(coalesce((el->>'total')::numeric, 0), 2)), 0),
         coalesce(array_agg(el->>'id' order by ord) filter (where el->'optional' = 'true'::jsonb), '{}')
    into v_included, v_total, v_optional
  from jsonb_array_elements(v_items) with ordinality as e(el, ord)
  where el->'optional' is distinct from 'true'::jsonb
     or (el->>'id') = any(coalesce(p_optional_ids, '{}'::text[]));

  v_dep_value := round(coalesce(q.deposit_value, 0), 2);
  v_has_dep := q.deposit_type in ('percent','fixed') and v_dep_value > 0;
  if v_has_dep and q.deposit_type = 'percent' then
    v_deposit := round(v_total * least(v_dep_value, 100) / 100, 2);
  elsif v_has_dep then
    v_deposit := least(v_dep_value, v_total);
  end if;

  v_snapshot := jsonb_build_object(
    'tier_id',        case when v_tiered then v_tier->>'id' end,
    'tier_name',      case when v_tiered then coalesce(nullif(btrim(v_tier->>'name'), ''), 'Option ' || v_tier_pos) end,
    'line_items',     v_included,
    'optional_ids',   to_jsonb(v_optional),
    'subtotal',       v_total,
    'total',          v_total,
    'deposit_type',   case when v_has_dep then q.deposit_type end,
    'deposit_value',  case when v_has_dep then v_dep_value end,
    'deposit_amount', v_deposit,
    'balance_amount', v_total - v_deposit,
    'accepted_via',   case when p_require_signature then 'typed-name' else 'legacy-button' end
  );

  perform set_config('quotes.customer_accept', 'on', true);
  update public.quotes set
    status             = 'accepted',
    accepted_name      = case when p_require_signature then v_name end,
    accepted_consent   = case when p_require_signature then true end,
    accepted_tier_id   = case when v_tiered then v_tier->>'id' end,
    accepted_selection = v_snapshot,
    subtotal           = v_total,
    total              = v_total
  where id = q.id;
  perform set_config('quotes.customer_accept', '', true);
  return 'accepted';
end $$;

-- Legacy accept (the page deployed before this patch calls this). Same
-- signature and result as before. Tiered quotes come back 'invalid_tier'
-- (false) because no tier is given; expired quotes are refused.
create or replace function public.accept_public_quote(p_token text)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  return public.accept_quote_as_customer(p_token, null, null, null, null, false) = 'accepted';
end $$;

-- New accept: typed full name + consent tick, chosen tier, ticked add-ons.
create or replace function public.accept_public_quote_v2(
  p_token text, p_full_name text, p_consent boolean, p_tier_id text, p_optional_ids text[])
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  return public.accept_quote_as_customer(p_token, p_full_name, p_consent, p_tier_id, p_optional_ids, true);
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
revoke execute on function public.accept_public_quote_v2(text, text, boolean, text, text[]) from public, anon, authenticated;
revoke execute on function public.accept_quote_as_customer(text, text, boolean, text, text[], boolean) from public, anon, authenticated;
revoke execute on function public.quote_business_today()        from public, anon, authenticated;
revoke execute on function public.is_business_user()             from public, anon, authenticated;
revoke execute on function public.set_updated_at()               from public, anon, authenticated;
revoke execute on function public.stamp_status_timestamps()      from public, anon, authenticated;
revoke execute on function public.guard_anon_quote_update()      from public, anon, authenticated;

grant execute on function public.get_public_quote(text)         to anon;
grant execute on function public.mark_public_quote_viewed(text) to anon;
grant execute on function public.accept_public_quote(text)      to anon;
grant execute on function public.accept_public_quote_v2(text, text, boolean, text, text[]) to anon;
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

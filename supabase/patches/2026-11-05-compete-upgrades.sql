-- Patch 2026-11-05: compete-pass upgrades (tiers, typed-name acceptance,
-- optional add-ons, deposit, expiry, item library, demo data, timeline).
--
-- NOT APPLIED BY CLAUDE CODE. This file is for review (Ziggy) and is run by
-- hand in the Supabase SQL editor with Tom's go-ahead. Already folded into
-- schema.sql for fresh deploys.
--
-- Paste the whole file and Run. Safe to re-run. One transaction: if any
-- statement fails, nothing changes.
--
-- ADDITIVE ONLY. No column is dropped, renamed or retyped; every new column
-- is nullable or has a default, so existing rows and the currently deployed
-- frontend keep working before and after the new frontend ships:
--   * get_public_quote(text): same name and argument; it now returns MORE
--     columns. It is dropped and recreated inside this transaction because
--     Postgres can't add OUT columns in place; old clients ignore the extras.
--     Existing links in the wild keep resolving.
--   * accept_public_quote(text): same signature and boolean result. It still
--     accepts single-option quotes exactly as before (and now also freezes the
--     acceptance snapshot). It refuses tiered quotes (the old page can't
--     choose a tier) and expired quotes.
--   * NEW accept_public_quote_v2(token, full_name, consent, tier_id,
--     optional_ids): the new page's accept. Separate name, not an overload,
--     so PostgREST can never pick the wrong one.
--   * mark_public_quote_viewed(text): unchanged.
-- anon still has NO table access; everything goes through these functions.
--
-- Expiry uses the business day in Africa/Johannesburg, in ONE place:
-- public.quote_business_today(). Change it there for a client elsewhere.
--
-- Rollback (only if needed, by hand): the new columns and table can stay
-- unused harmlessly. To return to the previous functions, re-run the
-- function section of supabase/patches/2026-10-06-lock-down-access.sql and
-- 2026-09-05-status-timestamps.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1. quotes: new columns
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2. Item library (pricebook-lite), per business
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

-- ---------------------------------------------------------------------------
-- 3. Triggers: stamp sent_at; guard knows the new columns
-- ---------------------------------------------------------------------------
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
-- (quotes_a_guard_anon_update and quotes_stamp_status_timestamps already
-- point at these functions; create or replace is enough.)

-- ---------------------------------------------------------------------------
-- 4. Public quote page functions
-- ---------------------------------------------------------------------------
-- The business's calendar day, for expiry. One place to change the zone.
create or replace function public.quote_business_today()
returns date
language sql stable
set search_path = ''
as $$
  select (now() at time zone 'Africa/Johannesburg')::date;
$$;

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
-- 5. EXECUTE grants (same rule as schema.sql: revoke from all three, then
--    grant back exactly what each caller needs)
-- ---------------------------------------------------------------------------
revoke execute on function public.get_public_quote(text)                                  from public, anon, authenticated;
revoke execute on function public.accept_public_quote(text)                               from public, anon, authenticated;
revoke execute on function public.accept_public_quote_v2(text, text, boolean, text, text[]) from public, anon, authenticated;
revoke execute on function public.accept_quote_as_customer(text, text, boolean, text, text[], boolean) from public, anon, authenticated;
revoke execute on function public.quote_business_today()                                  from public, anon, authenticated;
revoke execute on function public.stamp_status_timestamps()                               from public, anon, authenticated;
revoke execute on function public.guard_anon_quote_update()                               from public, anon, authenticated;

grant execute on function public.get_public_quote(text)                                    to anon;
grant execute on function public.accept_public_quote(text)                                 to anon;
grant execute on function public.accept_public_quote_v2(text, text, boolean, text, text[]) to anon;

-- Tell PostgREST about the new function/columns now rather than on its next poll.
notify pgrst, 'reload schema';

commit;

-- After running: supabase/verify-rls.sql (every row PASS) and
-- supabase/verify-compete-upgrades.sql (every row PASS).

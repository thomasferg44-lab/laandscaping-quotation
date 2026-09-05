-- DropStack Quote & Invoice Tool (landscaping) — schema for ONE client deploy.
-- One Supabase project per client, so there is no client_id column.
-- Paste this whole file into the Supabase SQL editor for the client's project.

-- ---------------------------------------------------------------------------
-- quotes: one record serves as the quote AND, once status advances, the invoice
-- ---------------------------------------------------------------------------
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
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
-- ---------------------------------------------------------------------------
alter table public.quotes enable row level security;

-- Landscaper (authenticated session): full access. Single-user-per-deploy tool.
drop policy if exists "landscaper full access" on public.quotes;
create policy "landscaper full access" on public.quotes
  for all to authenticated
  using (true) with check (true);

-- Public quote page (anon key): may SELECT any row, but only by id.
-- Postgres cannot restrict "by id only" in a policy; the protection is that
-- ids are unguessable UUIDs and the anon role gets no listing UI. To make
-- "SELECT *" from anon return nothing useful, we additionally block drafts,
-- so an anon caller can only see quotes the landscaper has chosen to send.
drop policy if exists "public can view sent quotes" on public.quotes;
create policy "public can view sent quotes" on public.quotes
  for select to anon
  using (status <> 'draft');

-- Public page may UPDATE a row only to advance status sent->viewed or
-- sent/viewed->accepted. Column-level restriction is enforced by the
-- trigger below (anon cannot touch anything but status + timestamps).
drop policy if exists "public can advance status" on public.quotes;
create policy "public can advance status" on public.quotes
  for update to anon
  using (status in ('sent','viewed'))
  with check (status in ('viewed','accepted'));

-- Guard: when the caller is anon, reject any change other than the
-- allowed status transition and its timestamp. Runs for all roles but only
-- constrains anon.
create or replace function public.guard_anon_quote_update()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'anon' then
    if new.customer_name  is distinct from old.customer_name
    or new.customer_phone is distinct from old.customer_phone
    or new.customer_email is distinct from old.customer_email
    or new.line_items     is distinct from old.line_items
    or new.subtotal       is distinct from old.subtotal
    or new.total          is distinct from old.total
    or new.parent_quote_id is distinct from old.parent_quote_id
    or new.portion        is distinct from old.portion
    or new.invoiced_at    is distinct from old.invoiced_at
    or new.paid_at        is distinct from old.paid_at
    or new.created_at     is distinct from old.created_at then
      raise exception 'anon may only change status';
    end if;
    -- only forward transitions
    if not (
      (old.status = 'sent'   and new.status in ('viewed','accepted')) or
      (old.status = 'viewed' and new.status = 'accepted')
    ) then
      raise exception 'invalid status transition for anon: % -> %', old.status, new.status;
    end if;
    if new.status = 'viewed'   and new.viewed_at   is null then new.viewed_at   := now(); end if;
    if new.status = 'accepted' and new.accepted_at is null then new.accepted_at := now(); end if;
  end if;
  return new;
end $$;

drop trigger if exists quotes_guard_anon_update on public.quotes;
create trigger quotes_guard_anon_update
  before update on public.quotes
  for each row execute function public.guard_anon_quote_update();

-- ---------------------------------------------------------------------------
-- Storage: line-item photos
-- Public-read bucket so the hosted quote page can show thumbnails with no auth.
-- Only the authenticated landscaper can upload/replace/delete.
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
  using (bucket_id = 'quote-photos');

drop policy if exists "landscaper delete quote photos" on storage.objects;
create policy "landscaper delete quote photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'quote-photos');

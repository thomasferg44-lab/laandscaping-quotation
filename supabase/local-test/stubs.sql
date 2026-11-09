-- Minimal stand-ins for what Supabase provides, so the repo's SQL runs on a
-- throwaway local Postgres. NOT a Supabase replica: no PostgREST, no storage API.
create role anon nologin;
create role authenticated nologin;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
create schema auth;
grant usage on schema auth to anon, authenticated;
create table auth.users (id uuid primary key, instance_id uuid, aud text, role text, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::json->>'role' $$;
grant execute on function auth.uid(), auth.role() to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, owner_id text, name text);
alter table storage.objects enable row level security;
create publication supabase_realtime;

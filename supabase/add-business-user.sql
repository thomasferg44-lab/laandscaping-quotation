-- Give a login access to all of this business's quotes (the landscaper, or
-- a member of their staff).
--
-- 1. Create the login first: Supabase → Authentication → Users → Add user →
--    Create new user (email + strong temporary password, "Auto confirm" on).
-- 2. Change the email on the marked line below, paste the whole file into
--    the SQL editor and Run.
--
-- Stops with an error if no login has that email, so a typo can't silently
-- leave someone locked out. Safe to re-run.

do $$
declare
  v_email text := 'CHANGE-ME@example.invalid';  -- <<< the login's email
  v_note  text := 'owner';                      -- e.g. 'owner', 'staff: Sipho'
  v_id    uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(trim(v_email));
  if v_id is null then
    raise exception 'No login with email %. Create it under Authentication → Users first.', v_email;
  end if;
  insert into public.business_users (user_id, note) values (v_id, v_note)
  on conflict (user_id) do update set note = excluded.note;
end $$;

select u.email, b.note, b.added_at
from public.business_users b join auth.users u on u.id = b.user_id
order by b.added_at;

-- To remove someone's access (they can still log in but see nothing):
--   delete from public.business_users
--   where user_id = (select id from auth.users where email = 'their@email');
-- To stop them logging in at all, also delete the user under
-- Authentication → Users.

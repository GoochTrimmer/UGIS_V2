-- ============================================================
-- UGIS — Show who made each History change; auto-provision user_profiles
-- Apply with:
--   npx supabase db query --linked -f supabase/migrations/019_changed_by_user_profiles.sql
-- ============================================================

-- item_logs.changed_by has existed since the base schema but nothing ever
-- actually set it — writeItemLog()'s insert never passed it, so every
-- existing row has it null (unrecoverable; who made a past change isn't
-- knowable after the fact). A column default fixes this for every future
-- write, from every call site (ItemForm, Import's bulk logs, status
-- changes, etc.), with no application code changes needed.
alter table item_logs alter column changed_by set default auth.uid();

-- Staff accounts (created directly in the Supabase dashboard, not through
-- UGIS) have never gotten a user_profiles row — only consignee accounts do,
-- via manage-consignee-user. That's fine for role checks (auth_role()
-- defaults missing rows to 'staff'), but there's nowhere to read a staff
-- account's email from client-side for display purposes (auth.users isn't
-- queryable with the anon key). Auto-provision going forward, and backfill
-- what already exists.
create or replace function sync_new_user_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into user_profiles (id, role, email)
  values (new.id, 'staff', new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger auth_users_sync_profile
  after insert on auth.users
  for each row execute function sync_new_user_profile();

-- Backfill existing staff accounts (any auth.users row with no
-- user_profiles row at all — i.e. not already a provisioned consignee
-- login).
insert into user_profiles (id, role, email)
select u.id, 'staff', u.email
from auth.users u
left join user_profiles p on p.id = u.id
where p.id is null;

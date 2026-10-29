-- ============================================================
-- UGIS — Who changed an item's status (StatusTimeline attribution)
-- Apply with:
--   npx supabase db query --linked -f supabase/migrations/020_status_history_changed_by.sql
-- ============================================================

-- item_status_history is populated entirely by the log_item_status_change
-- trigger (007, made security definer in 013) — never written directly by
-- application code — so this is the one place to capture who made the
-- change. auth.uid() still reflects the real calling user's JWT inside a
-- security definer function (that only changes which role's table grants
-- apply, not which session's claims auth.uid() reads), and naturally comes
-- back null for anything with no user session behind it at all — a
-- Shopify webhook or reconciliation run, say — which is the accurate
-- answer for those, not a bug to work around.
alter table item_status_history add column changed_by uuid references auth.users(id) on delete set null;

create or replace function log_item_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    insert into item_status_history (item_id, status, changed_at, changed_by) values (new.id, new.status, now(), auth.uid());
  elsif TG_OP = 'UPDATE' and new.status is distinct from old.status then
    insert into item_status_history (item_id, status, changed_at, changed_by) values (new.id, new.status, now(), auth.uid());
  end if;
  return new;
end;
$$;

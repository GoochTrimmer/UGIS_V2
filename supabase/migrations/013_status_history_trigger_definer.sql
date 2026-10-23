-- ============================================================
-- UGIS — Fix: consignee accounts couldn't create or change the status of items
-- Run this in your Supabase SQL editor (or `supabase db push`)
-- against a database that already has 012_consignee_accounts.sql applied.
-- ============================================================

-- log_item_status_change() (007) writes to item_status_history on every
-- item insert / status change. It ran as the invoking user, and 012 only
-- grants consignee accounts SELECT on that table — so the trigger's insert
-- was rejected by RLS and rolled back the whole item write. Running it as
-- the function owner is safe: it only ever records NEW.id / NEW.status of
-- the row that was already allowed through items' own RLS.
create or replace function log_item_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    insert into item_status_history (item_id, status, changed_at) values (new.id, new.status, now());
  elsif TG_OP = 'UPDATE' and new.status is distinct from old.status then
    insert into item_status_history (item_id, status, changed_at) values (new.id, new.status, now());
  end if;
  return new;
end;
$$;

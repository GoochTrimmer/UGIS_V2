-- ============================================================
-- UGIS — Item Status History
-- Run this in your Supabase SQL editor (or `supabase db push`)
-- against a database that already has 006_reconciliation.sql applied.
-- ============================================================

-- One row per status a given item has ever held, in order — not just the
-- latest status (already on items.status) but the full timeline: when it
-- first went in stock, when it sold, if it came back as a return, etc.
create table item_status_history (
  id          uuid primary key default uuid_generate_v4(),
  item_id     uuid not null references items(id) on delete cascade,
  status      item_status not null,
  changed_at  timestamptz not null default now()
);

create index item_status_history_item_idx on item_status_history(item_id, changed_at);

alter table item_status_history enable row level security;
create policy "auth_all" on item_status_history for all to authenticated using (true) with check (true);

-- ============================================================
-- TRIGGER — captures every status change at the database level, not just
-- ones made through the app's own mutation code. This matters: the Shopify
-- order-paid webhook and the bulk CSV import both write to items.status
-- directly (server-side / raw batch update) without going through the
-- frontend's writeItemLog() audit path, so an application-level "log every
-- status change" approach would silently miss those. A trigger on the
-- table itself can't be bypassed by any of them.
-- ============================================================
create or replace function log_item_status_change()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    insert into item_status_history (item_id, status, changed_at) values (new.id, new.status, now());
  elsif TG_OP = 'UPDATE' and new.status is distinct from old.status then
    insert into item_status_history (item_id, status, changed_at) values (new.id, new.status, now());
  end if;
  return new;
end;
$$;

create trigger items_status_history
  after insert or update of status on items
  for each row execute function log_item_status_change();

-- ============================================================
-- BACKFILL — best-effort reconstruction for items that already existed
-- before this migration. Two passes:
--
--  1. Seed one row per item for its earliest known status: if a single-
--     item "created" log exists (writeItemLog from the Add Item form),
--     use its recorded snapshot + timestamp; otherwise (bulk-imported
--     items only ever got one summary log with item_id = null, so there's
--     nothing per-item to recover) fall back to the item's current status
--     and created_at — the true original status of an old bulk-imported
--     item that's since changed isn't recoverable, only its current one.
--
--  2. Replay every individually-logged status change since then (from
--     the item edit form or per-item status updates — the only write
--     paths that were ever logged this granularly) as its own row, so
--     items with a real recorded history get their actual timeline
--     rather than just a single seed point.
--
-- Going forward the trigger above is authoritative for all of this —
-- this block only ever runs once, at migration time.
-- ============================================================
insert into item_status_history (item_id, status, changed_at)
select
  i.id,
  coalesce(
    (
      select (l.snapshot_before->>'status')::item_status
      from item_logs l
      where l.item_id = i.id
        and l.field_changes->'_action'->>'to' = 'created'
      order by l.changed_at asc
      limit 1
    ),
    i.status
  ),
  coalesce(
    (
      select l.changed_at
      from item_logs l
      where l.item_id = i.id
        and l.field_changes->'_action'->>'to' = 'created'
      order by l.changed_at asc
      limit 1
    ),
    i.created_at
  )
from items i;

insert into item_status_history (item_id, status, changed_at)
select l.item_id, (l.field_changes->'status'->>'to')::item_status, l.changed_at
from item_logs l
where l.item_id is not null
  and l.field_changes ? 'status'
order by l.changed_at asc;

-- ============================================================
-- UGIS — Brand requests
-- Run against a database that already has 013 applied:
--   npx supabase db query --linked -f supabase/migrations/014_brand_requests.sql
-- ============================================================

-- When a bulk import contains a brand name that looks like a typo of an
-- existing one and the importer chooses "leave undefined for now", the
-- items go in without that brand and a request is filed here for staff to
-- add (or correct) the brand properly, instead of guessing or creating a
-- near-duplicate.
create table brand_requests (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  item_count    integer not null default 0,
  example_item  text,
  status        text not null default 'pending' check (status in ('pending', 'resolved', 'dismissed')),
  requested_by  uuid references auth.users(id) on delete set null default auth.uid(),
  consignee_id  uuid references consignees(id) on delete set null default auth_consignee_id(),
  created_at    timestamptz not null default now()
);

create index brand_requests_status_idx on brand_requests(status);

alter table brand_requests enable row level security;

create policy "staff_all" on brand_requests for all to authenticated
  using (auth_role() = 'staff') with check (auth_role() = 'staff');

-- Consignee accounts can file requests and see their own, nothing else.
create policy "consignee_insert" on brand_requests for insert to authenticated
  with check (auth_role() = 'consignee' and requested_by = auth.uid());
create policy "consignee_select_own" on brand_requests for select to authenticated
  using (auth_role() = 'consignee' and requested_by = auth.uid());

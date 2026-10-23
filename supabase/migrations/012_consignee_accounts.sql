-- ============================================================
-- UGIS — Consignee (stockist) self-service accounts
-- Run this in your Supabase SQL editor (or `supabase db push`)
-- against a database that already has 011_store_credit.sql applied.
-- ============================================================

-- ============================================================
-- USER PROFILES — links an auth.users row to a role, and (for
-- consignee-role users) to exactly one consignee. A user with no row here
-- is treated as staff (see auth_role() below) — every account that exists
-- today keeps full access with no backfill required.
-- ============================================================
create table user_profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          text not null check (role in ('staff', 'consignee')),
  consignee_id  uuid references consignees(id) on delete cascade,
  -- Denormalized copy of the auth user's email, so the Consignees admin
  -- panel can show "Login: x@y.com" without a service-role lookup just to
  -- render a list. Kept in sync by manage-consignee-user (create/reset);
  -- not authoritative — auth.users.email is.
  email         text,
  created_at    timestamptz not null default now(),
  constraint user_profiles_consignee_requires_role
    check (role = 'consignee' or consignee_id is null)
);

-- One login per consignee.
create unique index user_profiles_consignee_unique
  on user_profiles(consignee_id) where role = 'consignee';

-- ============================================================
-- ROLE HELPERS — security definer so a consignee user (who can only read
-- their own user_profiles row per the RLS policy below) can still evaluate
-- these inside other tables' policies without a permission/recursion issue.
-- ============================================================
create or replace function auth_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from user_profiles where id = auth.uid()), 'staff')
$$;

create or replace function auth_consignee_id()
returns uuid language sql stable security definer set search_path = public as $$
  select consignee_id from user_profiles where id = auth.uid()
$$;

alter table user_profiles enable row level security;
create policy "staff_all" on user_profiles for all to authenticated
  using (auth_role() = 'staff') with check (auth_role() = 'staff');
create policy "self_select" on user_profiles for select to authenticated
  using (id = auth.uid());

-- ============================================================
-- BRANDS — consignee-created brands are flagged for staff review rather
-- than silently trusted, since a consignee doesn't have the tribal
-- knowledge of the existing catalog that staff do.
-- ============================================================
alter table brands add column pending_review boolean not null default false;

create or replace function flag_consignee_brand()
returns trigger language plpgsql as $$
begin
  if auth_role() = 'consignee' then
    new.pending_review := true;
  end if;
  return new;
end;
$$;

create trigger brands_flag_consignee
  before insert on brands
  for each row execute function flag_consignee_brand();

-- ============================================================
-- ITEMS — reject any attempt by a consignee-role caller to set
-- cost_amount to a non-null value. Belt-and-suspenders alongside the
-- read-side masking view below (items_view) — this covers direct writes.
-- ============================================================
create or replace function guard_consignee_cost_amount()
returns trigger language plpgsql as $$
begin
  if auth_role() = 'consignee' and new.cost_amount is not null then
    raise exception 'consignee accounts cannot set cost_amount';
  end if;
  return new;
end;
$$;

create trigger items_guard_consignee_cost_amount
  before insert or update on items
  for each row execute function guard_consignee_cost_amount();

-- ============================================================
-- RLS REWRITE — replace the blanket "auth_all" policy on every table that
-- should now differ by role. Each becomes a staff-full-access policy plus
-- (where applicable) a scoped consignee policy.
-- ============================================================

-- brands: consignee can read everything and create new ones (flagged
-- above); only staff can edit/delete existing entries.
drop policy "auth_all" on brands;
create policy "staff_all" on brands for all to authenticated
  using (auth_role() = 'staff') with check (auth_role() = 'staff');
create policy "consignee_select" on brands for select to authenticated
  using (auth_role() = 'consignee');
create policy "consignee_insert" on brands for insert to authenticated
  with check (auth_role() = 'consignee');

-- consignees: consignee role can only see their own row.
drop policy "auth_all" on consignees;
create policy "staff_all" on consignees for all to authenticated
  using (auth_role() = 'staff') with check (auth_role() = 'staff');
create policy "consignee_select_self" on consignees for select to authenticated
  using (auth_role() = 'consignee' and id = auth_consignee_id());

-- items: consignee role fully scoped to their own consignee_id, both for
-- reads and for what they're allowed to write (with check).
drop policy "auth_all" on items;
create policy "staff_all" on items for all to authenticated
  using (auth_role() = 'staff') with check (auth_role() = 'staff');
create policy "consignee_all_own" on items for all to authenticated
  using (auth_role() = 'consignee' and consignee_id = auth_consignee_id())
  with check (auth_role() = 'consignee' and consignee_id = auth_consignee_id());

-- item_brands: no consignee_id column directly, scope via the parent item.
drop policy "auth_all" on item_brands;
create policy "staff_all" on item_brands for all to authenticated
  using (auth_role() = 'staff') with check (auth_role() = 'staff');
create policy "consignee_all_own" on item_brands for all to authenticated
  using (
    auth_role() = 'consignee' and exists (
      select 1 from items where items.id = item_brands.item_id
        and items.consignee_id = auth_consignee_id()
    )
  )
  with check (
    auth_role() = 'consignee' and exists (
      select 1 from items where items.id = item_brands.item_id
        and items.consignee_id = auth_consignee_id()
    )
  );

-- item_logs: scoped via the referenced item. Logs for items whose item_id
-- has since gone null (item deleted, on delete set null) become invisible
-- to consignees — acceptable, staff retain full visibility regardless.
drop policy "auth_all" on item_logs;
create policy "staff_all" on item_logs for all to authenticated
  using (auth_role() = 'staff') with check (auth_role() = 'staff');
create policy "consignee_select_own" on item_logs for select to authenticated
  using (
    auth_role() = 'consignee' and exists (
      select 1 from items where items.id = item_logs.item_id
        and items.consignee_id = auth_consignee_id()
    )
  );
create policy "consignee_insert_own" on item_logs for insert to authenticated
  with check (
    auth_role() = 'consignee' and exists (
      select 1 from items where items.id = item_logs.item_id
        and items.consignee_id = auth_consignee_id()
    )
  );

-- item_status_history: same join-based scoping — needed for Statistics'
-- sold-dates chart.
drop policy "auth_all" on item_status_history;
create policy "staff_all" on item_status_history for all to authenticated
  using (auth_role() = 'staff') with check (auth_role() = 'staff');
create policy "consignee_select_own" on item_status_history for select to authenticated
  using (
    auth_role() = 'consignee' and exists (
      select 1 from items where items.id = item_status_history.item_id
        and items.consignee_id = auth_consignee_id()
    )
  );

-- id_counters: no business data, both roles need write access to generate
-- readable IDs when creating items — left as-is (still "auth_all"), no
-- change needed here.

-- Shopify + store credit tables: staff-only, no consignee access at all —
-- drop the blanket policy and replace with a staff-only one.
drop policy "auth_all" on shopify_discrepancies;
create policy "staff_all" on shopify_discrepancies for all to authenticated
  using (auth_role() = 'staff') with check (auth_role() = 'staff');

drop policy "auth_all" on reconciliation_runs;
create policy "staff_all" on reconciliation_runs for all to authenticated
  using (auth_role() = 'staff') with check (auth_role() = 'staff');

drop policy "auth_all" on store_credit_log;
create policy "staff_all" on store_credit_log for all to authenticated
  using (auth_role() = 'staff') with check (auth_role() = 'staff');

drop policy "auth_all" on store_credit_discrepancies;
create policy "staff_all" on store_credit_discrepancies for all to authenticated
  using (auth_role() = 'staff') with check (auth_role() = 'staff');

-- ============================================================
-- READ-SIDE MASKING VIEWS — cost_amount (UG's internal cost basis) is
-- stripped for consignee-role readers. security_invoker means these views
-- re-check the underlying table's RLS as the calling user, so they don't
-- widen access — just reshape what's already visible. Both roles read
-- through these unconditionally; staff simply get cost_amount back
-- unmodified, so no role branching is needed in application code.
-- ============================================================
create view items_view with (security_invoker = true) as
select
  id, readable_id, name, size, season_year, season_period, season_custom, status, consignee_id,
  case when auth_role() = 'consignee' then null else cost_amount end as cost_amount,
  takeback_price, selling_price, sold_price, sale_channel, sale_geography, payment_type, card_fee,
  notes, created_at, updated_at, created_by,
  shopify_product_id, shopify_variant_id, shopify_admin_url, ready_to_list, scheduled_drop_at,
  is_migrated, shopify_needs_finishing, shopify_order_id, shopify_order_url,
  trade_in_cash_offer, trade_in_credit_offer, trade_in_choice,
  shopify_customer_id, shopify_customer_admin_url, shopify_store_credit_txn_id
from items;

create view item_logs_view with (security_invoker = true) as
select
  id, item_id, item_name, changed_at, changed_by, reverted,
  case when auth_role() = 'consignee' then field_changes - 'cost_amount' else field_changes end as field_changes,
  case when auth_role() = 'consignee' then snapshot_before - 'cost_amount' else snapshot_before end as snapshot_before
from item_logs;

-- ============================================================
-- UGIS — Let consignee accounts set / see cost_amount (trial)
-- Apply with:
--   npx supabase db query --linked -f supabase/migrations/015_consignee_cost_amount.sql
-- ============================================================

-- 012 blocked consignee accounts from writing cost_amount (and masked it on
-- read). For the stockist trial they may record their own cost if they
-- choose; left empty otherwise. Each consignee still only ever reaches their
-- own rows (items RLS is unchanged), so this exposes nothing across
-- consignees, and staff continue to see every value.
--
-- Open question for the stockists: whether they want this at all, and
-- whether it should be hidden from staff-facing views. That would be a
-- follow-up, not something to build until they've weighed in.

drop trigger if exists items_guard_consignee_cost_amount on items;
drop function if exists guard_consignee_cost_amount();

-- Same column list as 012's views, minus the consignee masking. Dropped and
-- recreated (not `create or replace`) because cost_amount's type changes from
-- the masked expression's plain numeric back to the column's numeric(10,2).
drop view if exists items_view;
drop view if exists item_logs_view;

create view items_view with (security_invoker = true) as
select
  id, readable_id, name, size, season_year, season_period, season_custom, status, consignee_id,
  cost_amount,
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
  field_changes,
  snapshot_before
from item_logs;

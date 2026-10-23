-- ============================================================
-- UGIS — Multi-quantity items ("6 of the same ring in stock")
-- Apply with:
--   npx supabase db query --linked -f supabase/migrations/017_item_batches.sql
-- ============================================================

-- Each physical unit keeps its own row (own status, sale price, Shopify
-- link, log/status history) — that machinery is unchanged and untouched.
-- batch_id just marks "these rows were created together as one listing",
-- so the Inventory list can show a sibling-count badge and a future bulk
-- action can target the whole group. Nullable: most items are still
-- one-of-a-kind and never get a batch_id.
alter table items add column batch_id uuid;
create index items_batch_id_idx on items(batch_id) where batch_id is not null;

-- Recreate items_view (015 dropped the cost_amount masking but kept the
-- explicit column list) to include the new column.
drop view if exists items_view;
create view items_view with (security_invoker = true) as
select
  id, readable_id, name, size, season_year, season_period, season_custom, status, consignee_id,
  cost_amount,
  takeback_price, selling_price, sold_price, sale_channel, sale_geography, payment_type, card_fee,
  notes, created_at, updated_at, created_by, batch_id,
  shopify_product_id, shopify_variant_id, shopify_admin_url, ready_to_list, scheduled_drop_at,
  is_migrated, shopify_needs_finishing, shopify_order_id, shopify_order_url,
  trade_in_cash_offer, trade_in_credit_offer, trade_in_choice,
  shopify_customer_id, shopify_customer_admin_url, shopify_store_credit_txn_id
from items;

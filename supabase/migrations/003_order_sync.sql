-- ============================================================
-- UGIS + Shopify Integration — Phase 2: Overselling Prevention
-- Run this in your Supabase SQL editor (or `supabase db push`)
-- against a database that already has 002_shopify_integration.sql applied.
-- ============================================================

alter table items
  add column shopify_order_id text;

-- Not unique — a redelivered webhook for the same order/item is expected
-- and handled as a no-op, not rejected at the DB level.
create index items_shopify_order_id_idx on items(shopify_order_id) where shopify_order_id is not null;

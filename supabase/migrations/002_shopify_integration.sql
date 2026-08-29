-- ============================================================
-- UGIS + Shopify Integration — Phase 1: Foundation
-- Run this in your Supabase SQL editor (or `supabase db push`)
-- against a database that already has schema.sql applied.
-- ============================================================

-- ============================================================
-- ITEMS — Shopify linking + listing lifecycle
-- ============================================================
alter table items
  add column shopify_product_id     text,
  add column shopify_variant_id     text,
  add column shopify_admin_url      text,
  add column ready_to_list          boolean not null default false,
  add column scheduled_drop_at      timestamptz,
  add column is_migrated            boolean not null default false,
  add column shopify_needs_finishing boolean not null default false;

-- Durable link — see spec §3. A given Shopify product/variant should
-- only ever be linked to one UGIS item.
create unique index items_shopify_product_id_unique
  on items (shopify_product_id) where shopify_product_id is not null;
create unique index items_shopify_variant_id_unique
  on items (shopify_variant_id) where shopify_variant_id is not null;

create index items_ready_to_list_idx on items(ready_to_list) where ready_to_list and shopify_product_id is null;
create index items_is_migrated_idx on items(is_migrated) where is_migrated;

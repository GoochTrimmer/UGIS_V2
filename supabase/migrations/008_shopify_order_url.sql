-- ============================================================
-- UGIS + Shopify Integration — order admin link
-- Run this in your Supabase SQL editor (or `supabase db push`)
-- against a database that already has 007_status_history.sql applied.
-- ============================================================

-- Precomputed like shopify_admin_url already is for the product listing —
-- building a Shopify admin URL needs the store's handle, which only lives
-- in an Edge Function secret (SHOPIFY_STORE_DOMAIN), not anything the
-- frontend has access to. Populated by shopify-webhook-orders-paid
-- alongside shopify_order_id; nothing here for orders placed before this
-- migration — there's no reliable way to backfill it retroactively.
alter table items
  add column shopify_order_url text;

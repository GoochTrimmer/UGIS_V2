-- ============================================================
-- UGIS + Shopify Integration — reconcile Draft/Live listing status too
-- Run this in your Supabase SQL editor (or `supabase db push`)
-- against a database that already has 008_shopify_order_url.sql applied.
-- ============================================================

-- shopify_needs_finishing was only ever cleared by staff clicking "Mark as
-- finished" in UGIS — publishing the product directly in Shopify admin
-- (skipping that button) left it stuck, and shopify-reconcile never
-- checked product publish status at all, only sold-vs-inventory. This
-- column tracks how many items shopify-reconcile auto-corrects each run,
-- surfaced in the Actionable tab's last-run summary.
alter table reconciliation_runs
  add column listing_statuses_synced integer;

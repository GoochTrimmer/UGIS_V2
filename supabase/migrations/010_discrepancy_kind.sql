-- ============================================================
-- UGIS + Shopify Integration — flag deleted/missing Shopify listings too
-- Run this in your Supabase SQL editor (or `supabase db push`)
-- against a database that already has 009_reconcile_listing_status.sql
-- applied.
-- ============================================================

-- Until now shopify_discrepancies only ever meant "sold status disagrees
-- with inventory". A linked item whose Shopify product/variant had been
-- deleted entirely fell through the cracks completely — the reconcile
-- function found no data for it and silently skipped it, rather than
-- flagging anything. `kind` distinguishes that case (no resolution
-- ambiguity to weigh, just "this needs to be unbound/relinked") from the
-- original sold-vs-inventory case (a real "which side is right" question).
alter table shopify_discrepancies
  add column kind text not null default 'sold_status';

alter table shopify_discrepancies
  add constraint shopify_discrepancies_kind_check check (kind in ('sold_status', 'listing_missing'));

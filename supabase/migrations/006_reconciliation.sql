-- ============================================================
-- UGIS + Shopify Integration — Phase 3: Discrepancy Reconciliation
-- Run this in your Supabase SQL editor (or `supabase db push`)
-- against a database that already has 005_payment_options.sql applied.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- One open row per linked item currently disagreeing with Shopify on
-- sold vs. not-sold. Never auto-resolved in favour of either system —
-- staff confirm which side was right (Actionable tab).
create table shopify_discrepancies (
  id                          uuid primary key default uuid_generate_v4(),
  item_id                     uuid not null references items(id) on delete cascade,
  ugis_status                 item_status not null,
  shopify_available_quantity  integer,
  detected_at                 timestamptz not null default now(),
  resolved_at                 timestamptz,
  resolved_status             item_status,
  -- true when a later reconciliation run found the mismatch had already
  -- gone away on its own (sync caught up, or the item was unlinked) —
  -- distinguishes that from a staff member actually reviewing it.
  auto_resolved               boolean not null default false
);

-- At most one open discrepancy per item; a rescan that still finds the
-- same mismatch leaves the existing row alone rather than duplicating it.
create unique index shopify_discrepancies_open_item_unique
  on shopify_discrepancies (item_id) where resolved_at is null;
create index shopify_discrepancies_resolved_at_idx on shopify_discrepancies(resolved_at);

-- One row per reconciliation run (nightly or manual "Run check now") —
-- drives the "check is running" indicator and the Actionable tab's
-- last-run summary.
create table reconciliation_runs (
  id                    uuid primary key default uuid_generate_v4(),
  started_at            timestamptz not null default now(),
  finished_at           timestamptz,
  status                text not null default 'running', -- running | completed | failed
  items_scanned         integer,
  discrepancies_opened  integer,
  discrepancies_closed  integer,
  error                 text
);
create index reconciliation_runs_started_at_idx on reconciliation_runs(started_at desc);

alter table shopify_discrepancies enable row level security;
alter table reconciliation_runs   enable row level security;
create policy "auth_all" on shopify_discrepancies for all to authenticated using (true) with check (true);
create policy "auth_all" on reconciliation_runs   for all to authenticated using (true) with check (true);

-- ============================================================
-- MANUAL ONE-TIME SETUP — run these yourself, separately, after deploying
-- the shopify-reconcile Edge Function. Not bundled above since they embed
-- a live secret and your project ref, neither of which belongs in a
-- checked-in migration.
-- ============================================================

-- 1. Store your service role / secret key once, via Vault (Project Settings
--    -> API Keys -> secret key). `alter database ... set app.settings...`
--    doesn't work here — hosted Supabase no longer grants the SQL editor's
--    role permission to set custom database parameters (ERROR 42501), so
--    Vault is the supported way to stash a secret for pg_cron/pg_net to read:
-- select vault.create_secret(
--   '<your secret key>',
--   'service_role_key',
--   'Service role key for the reconciliation cron job'
-- );

-- 2. Schedule the nightly run at midnight. Postgres cron runs in UTC, so
--    '0 16 * * *' = 16:00 UTC = 00:00 SGT (UTC+8) — adjust the hour if
--    your store's local timezone differs.
-- select cron.schedule(
--   'shopify-reconcile-nightly',
--   '0 16 * * *',
--   $$
--   select net.http_post(
--     url := 'https://<your-project-ref>.supabase.co/functions/v1/shopify-reconcile',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || (
--         select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'
--       )
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );

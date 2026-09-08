-- ============================================================
-- UGIS + Shopify Integration — Store Credit (trade-in) integration
-- Run this in your Supabase SQL editor (or `supabase db push`)
-- against a database that already has 010_discrepancy_kind.sql applied.
-- ============================================================

-- Trade-in fields live directly on the item (spec §5) — a trade-in is
-- always store-owned stock (consignee stays/becomes "Upstairs Garments"),
-- these columns just record how it entered the store and, once credit is
-- chosen, the Shopify identity/transaction that paid it out.
alter table items add column trade_in_cash_offer   numeric;
alter table items add column trade_in_credit_offer numeric;
alter table items add column trade_in_choice       text check (trade_in_choice in ('cash', 'credit'));
alter table items add column shopify_customer_id   text;
alter table items add column shopify_customer_admin_url text;
alter table items add column shopify_store_credit_txn_id text;

-- Credit belongs to a customer, who may trade in multiple items over time —
-- doesn't fit as item-level fields (spec §9 stage 5). This is UGIS's
-- accounting mirror only; Shopify's own ledger is what checkout actually
-- honors.
create table store_credit_log (
  id                    uuid primary key default uuid_generate_v4(),
  shopify_customer_id   text not null,
  amount                numeric not null,
  direction             text not null check (direction in ('credit', 'debit')),
  source                text not null check (source in ('trade_in', 'redemption', 'adjustment')),
  related_item_id       uuid references items(id) on delete set null,
  shopify_transaction_id text,
  created_at            timestamptz not null default now()
);
create index store_credit_log_customer_idx on store_credit_log(shopify_customer_id);
create index store_credit_log_related_item_idx on store_credit_log(related_item_id);
-- Guards against a redelivered webhook double-counting the same Shopify
-- transaction as a second debit row. Rows written without a known
-- transaction id (shouldn't normally happen, but not fatal) fall outside
-- this constraint since a null never conflicts with another null.
create unique index store_credit_log_txn_unique
  on store_credit_log(shopify_transaction_id) where shopify_transaction_id is not null;

-- One open row per customer currently disagreeing with Shopify's own
-- reported store credit balance — same never-auto-resolved review pattern
-- as shopify_discrepancies, just at the customer/ledger level instead of
-- the item level. Populated by shopify-reconcile's credit-balance pass.
create table store_credit_discrepancies (
  id                    uuid primary key default uuid_generate_v4(),
  shopify_customer_id   text not null,
  ugis_balance          numeric not null,
  shopify_balance       numeric not null,
  detected_at           timestamptz not null default now(),
  resolved_at           timestamptz
);
create unique index store_credit_discrepancies_open_customer_unique
  on store_credit_discrepancies (shopify_customer_id) where resolved_at is null;

-- Reconciliation runs also cover the credit-balance pass now — same run
-- row, same "Run check now" button, no separate schedule to set up.
alter table reconciliation_runs add column credit_customers_checked integer;
alter table reconciliation_runs add column credit_discrepancies_opened integer;
alter table reconciliation_runs add column credit_discrepancies_closed integer;

alter table store_credit_log            enable row level security;
alter table store_credit_discrepancies  enable row level security;
create policy "auth_all" on store_credit_log           for all to authenticated using (true) with check (true);
create policy "auth_all" on store_credit_discrepancies for all to authenticated using (true) with check (true);

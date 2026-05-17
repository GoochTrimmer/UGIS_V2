-- ============================================================
-- UGIS — Archive Inventory Schema
-- Run this in your Supabase SQL editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- BRANDS
-- ============================================================
create table brands (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  abbreviation  text not null,
  aliases       text[] default '{}',
  parent_id     uuid references brands(id) on delete set null,
  created_at    timestamptz default now(),
  constraint brands_abbreviation_unique unique (abbreviation)
);

create index brands_parent_idx on brands(parent_id);
create index brands_name_idx on brands using gin(to_tsvector('english', name));

-- ============================================================
-- CONSIGNEES
-- ============================================================
create table consignees (
  id                uuid primary key default uuid_generate_v4(),
  name              text not null,
  abbreviation      text not null,
  is_default_store  boolean not null default false,
  notes             text,
  created_at        timestamptz default now(),
  constraint consignees_abbreviation_unique unique (abbreviation)
);

-- ============================================================
-- ID COUNTERS (for readable IDs)
-- prefix = e.g. "UC-AL" or "UC-NK-AL"
-- ============================================================
create table id_counters (
  prefix        text primary key,
  current_count integer not null default 0
);

-- ============================================================
-- ITEMS
-- ============================================================
create type item_status as enum (
  'in_stock',
  'sold',
  'on_rental',
  'out_for_cleaning',
  'reserved',
  'returned',
  'archived'
);

create type season_period as enum (
  'SS',
  'AW',
  'Resort',
  'Pre-Fall',
  'NA',
  'Custom'
);

create table items (
  id              uuid primary key default uuid_generate_v4(),
  readable_id     text not null,
  name            text not null,
  size            text,
  season_year     smallint,
  season_period   season_period,
  season_custom   text,            -- only used when season_period = 'Custom'
  status          item_status not null default 'in_stock',
  consignee_id    uuid references consignees(id) on delete set null,
  cost_amount     numeric(10,2),
  takeback_price  numeric(10,2),
  selling_price   numeric(10,2),
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  created_by      uuid references auth.users(id) on delete set null,
  constraint items_readable_id_unique unique (readable_id)
);

create index items_status_idx on items(status);
create index items_consignee_idx on items(consignee_id);
create index items_created_at_idx on items(created_at desc);
create index items_fts_idx on items using gin(to_tsvector('english', name || ' ' || readable_id));

-- ============================================================
-- ITEM <-> BRAND (many-to-many)
-- ============================================================
create table item_brands (
  item_id     uuid not null references items(id) on delete cascade,
  brand_id    uuid not null references brands(id) on delete cascade,
  sort_order  smallint not null default 0,
  primary key (item_id, brand_id)
);

create index item_brands_brand_idx on item_brands(brand_id);

-- ============================================================
-- AUTO-UPDATE updated_at
-- ============================================================
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger items_updated_at
  before update on items
  for each row execute function update_updated_at();

-- ============================================================
-- READABLE ID GENERATION
-- Returns next padded count for a given prefix, e.g. "UC-AL" -> 1
-- Call this inside a transaction when inserting items.
-- ============================================================
create or replace function next_id_count(p_prefix text)
returns integer language plpgsql as $$
declare
  v_count integer;
begin
  insert into id_counters(prefix, current_count)
  values (p_prefix, 1)
  on conflict (prefix) do update
    set current_count = id_counters.current_count + 1
  returning current_count into v_count;
  return v_count;
end;
$$;

-- ============================================================
-- BATCH ID RESERVATION
-- Atomically reserves p_count IDs for a prefix, returns the first reserved count.
-- E.g. if current_count is 5 and p_count is 3, returns 6 (IDs 6, 7, 8 are reserved).
-- ============================================================
create or replace function reserve_id_range(p_prefix text, p_count integer)
returns integer language plpgsql as $$
declare
  v_start integer;
begin
  insert into id_counters(prefix, current_count)
  values (p_prefix, p_count)
  on conflict (prefix) do update
    set current_count = id_counters.current_count + p_count
  returning current_count - p_count + 1 into v_start;
  return v_start;
end;
$$;

-- ============================================================
-- BRAND HIERARCHY SEARCH
-- Returns a brand's ID and all descendant brand IDs
-- Useful for "search by parent brand" feature
-- ============================================================
create or replace function brand_family_ids(p_brand_id uuid)
returns setof uuid language sql stable as $$
  with recursive family as (
    select id from brands where id = p_brand_id
    union all
    select b.id from brands b
    inner join family f on b.parent_id = f.id
  )
  select id from family;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table brands      enable row level security;
alter table consignees  enable row level security;
alter table items       enable row level security;
alter table item_brands enable row level security;
alter table id_counters enable row level security;

-- Authenticated users can read and write everything
create policy "auth_all" on brands      for all to authenticated using (true) with check (true);
create policy "auth_all" on consignees  for all to authenticated using (true) with check (true);
create policy "auth_all" on items       for all to authenticated using (true) with check (true);
create policy "auth_all" on item_brands for all to authenticated using (true) with check (true);
create policy "auth_all" on id_counters for all to authenticated using (true) with check (true);

-- ============================================================
-- SEED: Default store consignee (always preserved, survives wipe)
-- ============================================================
insert into consignees (name, abbreviation, is_default_store) values
  ('Upstairs Garments', 'UG', true)
on conflict (abbreviation) do update set is_default_store = true;

-- ============================================================
-- SEED: Common archive brands
-- ============================================================
insert into brands (name, abbreviation, aliases) values
  ('Undercover', 'UC', '{"undercover"}'),
  ('Comme des Garçons', 'CDG', '{"comme des garcons", "CDG"}'),
  ('Yohji Yamamoto', 'YY', '{"yohji"}'),
  ('Maison Margiela', 'MM', '{"margiela", "MM6"}'),
  ('Issey Miyake', 'IM', '{"issey"}'),
  ('Raf Simons', 'RS', '{"raf"}'),
  ('Ann Demeulemeester', 'AD', '{"ann d"}'),
  ('Helmut Lang', 'HL', '{"helmut"}'),
  ('Nike', 'NK', '{"nike"}'),
  ('Adidas', 'ADI', '{"adidas"}');

-- CDG sublines (parent = CDG)
with cdg as (select id from brands where abbreviation = 'CDG')
insert into brands (name, abbreviation, parent_id) values
  ('Comme des Garçons Homme Plus', 'CDGHP', (select id from cdg)),
  ('Comme des Garçons Homme', 'CDGH', (select id from cdg)),
  ('Junya Watanabe Comme des Garçons', 'JW', (select id from cdg)),
  ('Noir Kei Ninomiya', 'NKN', (select id from cdg)),
  ('Comme des Garçons Play', 'CDGP', (select id from cdg));

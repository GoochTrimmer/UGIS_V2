-- ============================================================
-- UGIS — Consignee tags (Vendor/Stockist/custom), editable Store designation
-- Apply with:
--   npx supabase db query --linked -f supabase/migrations/018_consignee_tags.sql
-- ============================================================

-- Free-form labels (e.g. "Vendor", "Stockist", anything staff add) assigned
-- any number to a consignee. "Store" is a special reserved tag: it IS the
-- existing consignees.is_default_store flag, just made editable through the
-- same tag UI instead of only ever being set once by hand in schema.sql.
-- Every other table/view/function in the app keeps reading
-- is_default_store directly (ItemForm, Statistics, Import's wipe-exclusion,
-- cost-field logic, etc.) — the trigger below is what keeps it in sync
-- with the tag link, so none of that code needed to change.
create table consignee_tags (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null unique,
  is_store   boolean not null default false,
  created_at timestamptz not null default now()
);

create table consignee_tag_links (
  consignee_id uuid not null references consignees(id) on delete cascade,
  tag_id       uuid not null references consignee_tags(id) on delete cascade,
  primary key (consignee_id, tag_id)
);
create index consignee_tag_links_tag_idx on consignee_tag_links(tag_id);

insert into consignee_tags (name, is_store) values
  ('Store', true), ('Vendor', false), ('Stockist', false)
on conflict (name) do nothing;

-- Backfill: link whichever consignee currently has is_default_store = true
-- to the new Store tag, so nothing changes for existing data.
insert into consignee_tag_links (consignee_id, tag_id)
select c.id, t.id from consignees c, consignee_tags t
where c.is_default_store = true and t.is_store = true
on conflict do nothing;

-- The Store tag can only ever be linked to one consignee — assigning it to
-- a different one here moves it (deletes the old link, which the DELETE
-- branch below turns back into is_default_store = false on that row) and
-- flips the flag. Non-store tags (Vendor, Stockist, custom) just pass
-- through untouched.
create or replace function sync_store_tag()
returns trigger language plpgsql as $$
declare
  v_is_store boolean;
begin
  select is_store into v_is_store from consignee_tags where id = coalesce(new.tag_id, old.tag_id);
  if not coalesce(v_is_store, false) then
    return coalesce(new, old);
  end if;

  if TG_OP = 'INSERT' then
    delete from consignee_tag_links where tag_id = new.tag_id and consignee_id <> new.consignee_id;
    update consignees set is_default_store = false where id <> new.consignee_id and is_default_store = true;
    update consignees set is_default_store = true where id = new.consignee_id;
    return new;
  elsif TG_OP = 'DELETE' then
    update consignees set is_default_store = false where id = old.consignee_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger consignee_tag_links_sync_store
  after insert or delete on consignee_tag_links
  for each row execute function sync_store_tag();

alter table consignee_tags enable row level security;
alter table consignee_tag_links enable row level security;

create policy "staff_all" on consignee_tags for all to authenticated
  using (auth_role() = 'staff') with check (auth_role() = 'staff');
create policy "consignee_select" on consignee_tags for select to authenticated
  using (auth_role() = 'consignee');

create policy "staff_all" on consignee_tag_links for all to authenticated
  using (auth_role() = 'staff') with check (auth_role() = 'staff');
-- A consignee can see tags on their own row only (matches the existing
-- consignees RLS scope — see 012).
create policy "consignee_select_own" on consignee_tag_links for select to authenticated
  using (
    auth_role() = 'consignee' and exists (
      select 1 from consignees where consignees.id = consignee_tag_links.consignee_id
        and consignees.id = auth_consignee_id()
    )
  );

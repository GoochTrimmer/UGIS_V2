-- ============================================================
-- UGIS — Track which consignee submitted a pending-review brand
-- Apply with:
--   npx supabase db query --linked -f supabase/migrations/016_brand_pending_review_consignee.sql
-- ============================================================

-- 012's pending_review flag said "a consignee made this" but not which one.
-- Staff asked to see the actual consignee name, and to approve a brand
-- (clear the flag) without having to open the full edit form.
alter table brands add column created_by_consignee_id uuid references consignees(id) on delete set null;

create or replace function flag_consignee_brand()
returns trigger language plpgsql as $$
begin
  if auth_role() = 'consignee' then
    new.pending_review := true;
    new.created_by_consignee_id := auth_consignee_id();
  end if;
  return new;
end;
$$;

-- No new RLS policy needed for an "Approve" button — brands' existing
-- staff_all policy (012) already permits staff to update any column,
-- pending_review included.

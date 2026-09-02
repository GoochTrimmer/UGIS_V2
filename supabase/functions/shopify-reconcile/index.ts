// Nightly safety net (spec Phase 3): compares each Shopify-linked item's
// UGIS status against Shopify's actual inventory availability and flags any
// mismatch for staff review in the Actionable tab — never auto-resolving in
// either direction. Catches what live sync (Phase 2) can't: a best-effort
// sync call that silently failed, a manual edit made directly in Shopify
// admin, or a genuine race.
//
// Triggered nightly via pg_cron + pg_net (see migration 006), or manually
// from the Actionable tab's "Run check now" button — same invocation
// either way, no separate manual-vs-scheduled code path. Every invocation
// writes a reconciliation_runs row so the frontend can show a "check is
// running" indicator and a last-run summary.
import { corsPreflight, jsonResponse } from '../_shared/cors.ts'
import { shopifyGraphql, gidToId } from '../_shared/shopify.ts'
import { getPrimaryLocationId } from '../_shared/inventory.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'

interface VariantNode {
  id: string
  inventoryItem: {
    inventoryLevel: { quantities: { quantity: number }[] } | null
  } | null
}

const VARIANTS_PAGE = `
  query variantsPage($cursor: String, $locationId: ID!) {
    productVariants(first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        inventoryItem {
          inventoryLevel(locationId: $locationId) {
            quantities(names: ["available"]) { quantity }
          }
        }
      }
    }
  }
`

// Keyed by numeric variant id (matches how items.shopify_variant_id is
// stored). A variant with no inventoryLevel at the primary location isn't
// tracked there yet — can't reliably judge sold/not-sold from it, so it's
// left out of the map entirely rather than guessed at as zero.
async function fetchAvailabilityByVariantId(): Promise<Map<string, number>> {
  const locationId = await getPrimaryLocationId()
  const byVariant = new Map<string, number>()
  let cursor: string | null = null
  for (;;) {
    const data: {
      productVariants: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: VariantNode[]
      }
    } = await shopifyGraphql(VARIANTS_PAGE, { cursor, locationId })
    for (const v of data.productVariants.nodes) {
      const level = v.inventoryItem?.inventoryLevel
      if (!level) continue
      byVariant.set(gidToId(v.id), level.quantities[0]?.quantity ?? 0)
    }
    if (!data.productVariants.pageInfo.hasNextPage) break
    cursor = data.productVariants.pageInfo.endCursor
  }
  return byVariant
}

Deno.serve(async req => {
  const preflight = corsPreflight(req)
  if (preflight) return preflight

  const db = supabaseAdmin()

  const { data: run, error: runErr } = await db
    .from('reconciliation_runs')
    .insert({ status: 'running' })
    .select()
    .single()
  if (runErr || !run) {
    console.error('[shopify-reconcile] failed to start run', runErr)
    return jsonResponse({ error: runErr?.message ?? 'Could not start reconciliation run' }, 500)
  }

  try {
    const [{ data: items, error: itemsErr }, availability] = await Promise.all([
      db.from('items').select('id, status, shopify_variant_id').not('shopify_variant_id', 'is', null),
      fetchAvailabilityByVariantId(),
    ])
    if (itemsErr) throw new Error(itemsErr.message)

    const linkedItems = items ?? []

    const { data: openRows, error: openErr } = await db
      .from('shopify_discrepancies')
      .select('id, item_id')
      .is('resolved_at', null)
    if (openErr) throw new Error(openErr.message)

    const openByItem = new Map((openRows ?? []).map(r => [r.item_id as string, r.id as string]))
    const linkedItemIds = new Set(linkedItems.map(i => i.id as string))
    const stillMismatched = new Set<string>()

    let opened = 0
    for (const item of linkedItems) {
      const available = availability.get(item.shopify_variant_id as string)
      if (available === undefined) continue // variant not resolvable on Shopify's side right now — skip, don't guess

      const shopifyImpliesSold = available <= 0
      const ugisImpliesSold = item.status === 'sold'
      if (shopifyImpliesSold === ugisImpliesSold) continue // agree

      stillMismatched.add(item.id as string)
      if (openByItem.has(item.id as string)) continue // already flagged from a prior run — leave it

      const { error: insErr } = await db.from('shopify_discrepancies').insert({
        item_id: item.id,
        ugis_status: item.status,
        shopify_available_quantity: available,
      })
      if (insErr) console.error('[shopify-reconcile] failed to open discrepancy', item.id, insErr)
      else opened++
    }

    // Previously open rows that no longer mismatch (sync caught up, staff
    // fixed it outside this flow, or the item got unlinked) — auto-close so
    // the Actionable tab only ever shows currently-true problems.
    let closed = 0
    for (const [itemId, rowId] of openByItem) {
      const stillLinked = linkedItemIds.has(itemId)
      if (stillLinked && stillMismatched.has(itemId)) continue

      const current = linkedItems.find(i => i.id === itemId)
      const { error: closeErr } = await db.from('shopify_discrepancies').update({
        resolved_at: new Date().toISOString(),
        resolved_status: current?.status ?? null,
        auto_resolved: true,
      }).eq('id', rowId)
      if (closeErr) console.error('[shopify-reconcile] failed to auto-close discrepancy', rowId, closeErr)
      else closed++
    }

    await db.from('reconciliation_runs').update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      items_scanned: linkedItems.length,
      discrepancies_opened: opened,
      discrepancies_closed: closed,
    }).eq('id', run.id)

    return jsonResponse({ runId: run.id, itemsScanned: linkedItems.length, opened, closed })
  } catch (err) {
    console.error('[shopify-reconcile]', err)
    await db.from('reconciliation_runs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error: err instanceof Error ? err.message : 'Unknown error',
    }).eq('id', run.id)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

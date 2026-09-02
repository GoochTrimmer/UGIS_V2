// Nightly safety net (spec Phase 3): compares each Shopify-linked item
// against Shopify's actual state on two dimensions and reconciles both —
// sold-vs-inventory (flagged for staff review, never auto-resolved either
// way — a real ambiguity, e.g. an in-store sale Shopify doesn't know
// about) and Draft-vs-Live listing status (auto-corrected directly —
// there's no ambiguity here, Shopify's product status IS the ground truth
// for what shopify_needs_finishing is supposed to mirror). Catches what
// live sync (Phase 2) and the create-draft flow can't: a best-effort sync
// call that silently failed, a manual edit made directly in Shopify admin
// (including just publishing a draft without ever touching UGIS's "Mark
// as finished" button), or a genuine race.
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
  product: { status: string } | null
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
        product { status }
        inventoryItem {
          inventoryLevel(locationId: $locationId) {
            quantities(names: ["available"]) { quantity }
          }
        }
      }
    }
  }
`

interface VariantData {
  available: number | undefined // undefined = not stocked at this location yet, don't guess
  needsFinishing: boolean | undefined // undefined = product status missing from the response
}

// Keyed by numeric variant id (matches how items.shopify_variant_id is
// stored).
async function fetchVariantDataById(): Promise<Map<string, VariantData>> {
  const locationId = await getPrimaryLocationId()
  const byVariant = new Map<string, VariantData>()
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
      byVariant.set(gidToId(v.id), {
        available: level ? level.quantities[0]?.quantity ?? 0 : undefined,
        // Still DRAFT means photos/description genuinely aren't done yet —
        // same rule shopify-bulk-match and shopify-create-draft already use.
        needsFinishing: v.product ? v.product.status === 'DRAFT' : undefined,
      })
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
    const [{ data: items, error: itemsErr }, variantData] = await Promise.all([
      db.from('items')
        .select('id, name, status, shopify_variant_id, shopify_needs_finishing')
        .not('shopify_variant_id', 'is', null),
      fetchVariantDataById(),
    ])
    if (itemsErr) throw new Error(itemsErr.message)

    const linkedItems = items ?? []

    const { data: openRows, error: openErr } = await db
      .from('shopify_discrepancies')
      .select('id, item_id, kind')
      .is('resolved_at', null)
    if (openErr) throw new Error(openErr.message)

    const openByItem = new Map((openRows ?? []).map(r => [r.item_id as string, { rowId: r.id as string, kind: r.kind as string }]))

    // What each linked item's problem actually is *this run*, if any — a
    // single source of truth the open/close pass below reconciles against,
    // rather than tracking "still mismatched" and "still missing" as two
    // separate parallel sets the way this used to work.
    type Problem = { kind: 'listing_missing' } | { kind: 'sold_status'; available: number }
    const currentProblem = new Map<string, Problem>()

    let listingStatusesSynced = 0
    for (const item of linkedItems) {
      const variant = variantData.get(item.shopify_variant_id as string)

      if (!variant) {
        // No variant found at all in the full catalog scan — the Shopify
        // product/variant was deleted (or never existed under this id
        // anymore). Distinct from "variant exists but inventory isn't
        // tracked at this location yet", which isn't a problem at all.
        currentProblem.set(item.id as string, { kind: 'listing_missing' })
        continue
      }

      // Draft/Live sync — unambiguous, so corrected directly rather than
      // flagged. Shopify's product status is definitionally what
      // shopify_needs_finishing is supposed to track; there's no "which
      // side is right" question the way there is for sold-vs-inventory.
      if (variant.needsFinishing !== undefined && variant.needsFinishing !== item.shopify_needs_finishing) {
        const { error: syncErr } = await db
          .from('items')
          .update({ shopify_needs_finishing: variant.needsFinishing })
          .eq('id', item.id)
        if (syncErr) {
          console.error('[shopify-reconcile] failed to sync listing status', item.id, syncErr)
        } else {
          listingStatusesSynced++
          // Silent DB correction with no staff-facing entry anywhere would
          // be invisible — this is the only record that it happened, so it
          // needs to actually land somewhere staff already look (History).
          await db.from('item_logs').insert({
            item_id: item.id,
            item_name: item.name,
            field_changes: {
              _action: { from: null, to: 'listing_status_synced' },
              shopify_needs_finishing: { from: item.shopify_needs_finishing, to: variant.needsFinishing },
            },
            snapshot_before: {},
          })
        }
      }

      if (variant.available === undefined) continue // not tracked at this location yet — skip, don't guess

      const shopifyImpliesSold = variant.available <= 0
      const ugisImpliesSold = item.status === 'sold'
      if (shopifyImpliesSold !== ugisImpliesSold) {
        currentProblem.set(item.id as string, { kind: 'sold_status', available: variant.available })
      }
    }

    // Reconcile open rows against currentProblem: close what's no longer
    // true (sync caught up, staff fixed it outside this flow, the item got
    // unlinked, or its problem changed kind), open what's newly true, and
    // leave alone what's unchanged — so the Actionable tab only ever shows
    // currently-true problems, of the right kind, one per item.
    let opened = 0
    let closed = 0
    for (const item of linkedItems) {
      const itemId = item.id as string
      const problem = currentProblem.get(itemId)
      const openRow = openByItem.get(itemId)

      if (openRow && (!problem || openRow.kind !== problem.kind)) {
        const { error: closeErr } = await db.from('shopify_discrepancies').update({
          resolved_at: new Date().toISOString(),
          resolved_status: item.status,
          auto_resolved: true,
        }).eq('id', openRow.rowId)
        if (closeErr) {
          console.error('[shopify-reconcile] failed to auto-close discrepancy', openRow.rowId, closeErr)
        } else {
          closed++
          // Same reasoning as the listing-status sync above — a silent fix
          // with no record anywhere is invisible. This is what feeds the
          // Actionable tab's "Recently Auto-Resolved" list.
          const detail = openRow.kind === 'listing_missing'
            ? 'Shopify listing is linked and available again.'
            : `Sold-status mismatch resolved — UGIS and Shopify now agree (${item.status}).`
          await db.from('item_logs').insert({
            item_id: item.id,
            item_name: item.name,
            field_changes: {
              _action: { from: null, to: 'discrepancy_auto_resolved' },
              _kind: { from: null, to: openRow.kind },
              _detail: { from: null, to: detail },
            },
            snapshot_before: {},
          })
        }
      }

      if (problem && (!openRow || openRow.kind !== problem.kind)) {
        const { error: insErr } = await db.from('shopify_discrepancies').insert({
          item_id: item.id,
          kind: problem.kind,
          ugis_status: item.status,
          shopify_available_quantity: problem.kind === 'sold_status' ? problem.available : null,
        })
        if (insErr) console.error('[shopify-reconcile] failed to open discrepancy', item.id, insErr)
        else opened++
      }
    }

    // Rows for items that dropped out of the linked set entirely (unbound,
    // or the UGIS item itself got deleted — though that cascades away on
    // its own) — close those too, same as before.
    const linkedItemIds = new Set(linkedItems.map(i => i.id as string))
    for (const [itemId, { rowId }] of openByItem) {
      if (linkedItemIds.has(itemId)) continue
      const { error: closeErr } = await db.from('shopify_discrepancies').update({
        resolved_at: new Date().toISOString(),
        auto_resolved: true,
      }).eq('id', rowId)
      if (closeErr) console.error('[shopify-reconcile] failed to auto-close orphaned discrepancy', rowId, closeErr)
      else closed++
    }

    await db.from('reconciliation_runs').update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      items_scanned: linkedItems.length,
      discrepancies_opened: opened,
      discrepancies_closed: closed,
      listing_statuses_synced: listingStatusesSynced,
    }).eq('id', run.id)

    return jsonResponse({ runId: run.id, itemsScanned: linkedItems.length, opened, closed, listingStatusesSynced })
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

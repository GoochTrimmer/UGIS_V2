// Called from useItems.ts whenever a Shopify-linked item's status changes
// after it's already live — keeps Shop All / Sold Out collection membership
// and inventory availability matching the item's current UGIS status. The
// initial collection assignment at creation time happens inline in
// shopify-create-draft; this covers everything after that (spec §2 point 5
// — in-store sale enforcement). Formerly shopify-sync-collection, renamed
// on extending it to also handle inventory.
import { corsPreflight, jsonResponse } from '../_shared/cors.ts'
import { requireStaff } from '../_shared/requireStaff.ts'
import { syncProductCollection } from '../_shared/collections.ts'
import { setVariantInventory } from '../_shared/inventory.ts'

interface RequestBody {
  productId: string
  variantId: string | null
  status: string
}

Deno.serve(async req => {
  const preflight = corsPreflight(req)
  if (preflight) return preflight

  const denied = await requireStaff(req)
  if (denied) return denied

  try {
    const { productId, variantId, status } = (await req.json()) as RequestBody
    if (!productId || !status) return jsonResponse({ error: 'productId and status are required' }, 400)

    // Each side effect gets its own try/catch — collection sync and
    // inventory sync are independent outcomes, and a failure in one (the
    // collection removal step especially involves several sequential API
    // calls: the mutation plus up to 6 job-status polls) must not prevent
    // the other from running.
    try {
      await syncProductCollection(productId, status)
    } catch (err) {
      console.error('[shopify-sync-item-status] collection sync failed', err)
    }

    // Zero inventory the moment something's marked sold in UGIS — the whole
    // point is minimizing the window where it could still sell online too.
    // Restock to 1 if staff correct a mistaken "sold". A variant can't
    // always be resolved (e.g. backfilled items linked before variant
    // tracking existed) — skip rather than fail the whole sync.
    if (variantId) {
      try {
        // reason is a fixed Shopify enum, not free text — "correction" and
        // "restock" are the closest real values to what's actually
        // happening here (there's no literal "sold" reason; that's what
        // Shopify's own order/checkout flow would use internally, not this
        // manual adjustment API).
        await setVariantInventory(variantId, status === 'sold' ? 0 : 1, status === 'sold' ? 'correction' : 'restock')
      } catch (err) {
        console.error('[shopify-sync-item-status] inventory sync failed', err)
      }
    }

    return jsonResponse({ ok: true })
  } catch (err) {
    console.error('[shopify-sync-item-status]', err)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

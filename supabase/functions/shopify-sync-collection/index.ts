// Called from useItems.ts whenever a Shopify-linked item's status changes
// after it's already live — keeps Shop All / Sold Out collection membership
// matching the item's current UGIS status. The initial collection
// assignment at creation time happens inline in shopify-create-draft; this
// covers everything after that.
import { corsPreflight, jsonResponse } from '../_shared/cors.ts'
import { syncProductCollection } from '../_shared/collections.ts'

interface RequestBody {
  productId: string
  status: string
}

Deno.serve(async req => {
  const preflight = corsPreflight(req)
  if (preflight) return preflight

  try {
    const { productId, status } = (await req.json()) as RequestBody
    if (!productId || !status) return jsonResponse({ error: 'productId and status are required' }, 400)

    await syncProductCollection(productId, status)
    return jsonResponse({ ok: true })
  } catch (err) {
    console.error('[shopify-sync-collection]', err)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

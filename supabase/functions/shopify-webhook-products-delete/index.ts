// Receives Shopify's `products/delete` webhook directly — same shape as
// shopify-webhook-products-update (HMAC-verified, no Supabase JWT,
// verify_jwt disabled in supabase/config.toml).
//
// Flags the linked UGIS item (if any) with a `listing_missing`
// shopify_discrepancy the instant the product is deleted, rather than
// waiting for the next reconcile run to notice it's gone from a catalog
// scan. Never touches the UGIS item itself — deciding whether to unbind or
// delete it is a staff call, made from the Actionable tab.
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { verifyShopifyHmac } from '../_shared/hmac.ts'

interface ShopifyProductDeletePayload {
  id: number
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const rawBody = await req.text() // must read raw text before any JSON parsing — HMAC is over raw bytes
  const hmacHeader = req.headers.get('X-Shopify-Hmac-Sha256')
  const shopDomain = req.headers.get('X-Shopify-Shop-Domain')

  if (!(await verifyShopifyHmac(rawBody, hmacHeader))) {
    console.error('[shopify-webhook-products-delete] HMAC verification failed')
    return new Response('Unauthorized', { status: 401 })
  }

  const expectedDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN')
  if (expectedDomain && shopDomain !== expectedDomain) {
    console.error(`[shopify-webhook-products-delete] shop domain mismatch: got "${shopDomain}"`)
    return new Response('Unauthorized', { status: 401 })
  }

  let payload: ShopifyProductDeletePayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const productId = String(payload.id)

  try {
    const db = supabaseAdmin()
    const { data: item, error } = await db
      .from('items')
      .select('id, status')
      .eq('shopify_product_id', productId)
      .maybeSingle()

    if (error) throw error
    if (!item) {
      console.log(`[shopify-webhook-products-delete] no UGIS item linked to product ${productId} — skipping`)
      return new Response('ok', { status: 200 })
    }

    // At most one open discrepancy per item (see migration 006's unique
    // index) — if one's already open under a different kind, close it
    // first so the insert below doesn't collide with it.
    const { data: existingOpen } = await db
      .from('shopify_discrepancies')
      .select('id, kind')
      .eq('item_id', item.id)
      .is('resolved_at', null)
      .maybeSingle()

    if (existingOpen?.kind === 'listing_missing') {
      console.log(`[shopify-webhook-products-delete] item ${item.id} already flagged missing — no-op`)
      return new Response('ok', { status: 200 })
    }

    if (existingOpen) {
      await db.from('shopify_discrepancies').update({
        resolved_at: new Date().toISOString(),
        resolved_status: item.status,
        auto_resolved: true,
      }).eq('id', existingOpen.id)
    }

    const { error: insErr } = await db.from('shopify_discrepancies').insert({
      item_id: item.id,
      kind: 'listing_missing',
      ugis_status: item.status,
      shopify_available_quantity: null,
    })
    if (insErr) throw insErr

    console.log(`[shopify-webhook-products-delete] flagged item ${item.id} — linked Shopify product ${productId} was deleted`)
  } catch (err) {
    // Same reasoning as shopify-webhook-products-update — best-effort
    // instant path, reconcile is the real safety net, so log and still
    // 200 rather than triggering a Shopify retry storm.
    console.error('[shopify-webhook-products-delete]', err)
  }

  return new Response('ok', { status: 200 })
})

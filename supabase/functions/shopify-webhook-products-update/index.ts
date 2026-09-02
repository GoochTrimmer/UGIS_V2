// Receives Shopify's `products/update` webhook directly — like
// shopify-webhook-orders-paid, this isn't called from our own frontend, so
// there's no Supabase-issued JWT; authenticity is verified manually via
// HMAC instead (see _shared/hmac.ts). verify_jwt is disabled for this
// function specifically (see supabase/config.toml).
//
// Shopify fires this on ANY product edit — title, price, images, all of
// it — so this only reacts to the one thing UGIS actually needs to know
// about instantly: Draft/Live status. That's the same unambiguous
// correction shopify-reconcile already applies on its own schedule; this
// just makes the common case (someone publishes a draft, or reverts one,
// directly in Shopify admin) near-instant instead of waiting for the next
// scheduled or manual check. The check stays as the safety net regardless
// — this webhook can fail to fire or get delayed same as any webhook, and
// nothing here changes that.
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { verifyShopifyHmac } from '../_shared/hmac.ts'

interface ShopifyProductPayload {
  id: number
  status: string // "active" | "draft" | "archived" — REST webhook payloads use lowercase, unlike the GraphQL enum
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const rawBody = await req.text() // must read raw text before any JSON parsing — HMAC is over raw bytes
  const hmacHeader = req.headers.get('X-Shopify-Hmac-Sha256')
  const shopDomain = req.headers.get('X-Shopify-Shop-Domain')

  if (!(await verifyShopifyHmac(rawBody, hmacHeader))) {
    console.error('[shopify-webhook-products-update] HMAC verification failed')
    return new Response('Unauthorized', { status: 401 })
  }

  const expectedDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN')
  if (expectedDomain && shopDomain !== expectedDomain) {
    console.error(`[shopify-webhook-products-update] shop domain mismatch: got "${shopDomain}"`)
    return new Response('Unauthorized', { status: 401 })
  }

  let payload: ShopifyProductPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const productId = String(payload.id)
  const liveNeedsFinishing = payload.status?.toLowerCase() === 'draft'

  try {
    const db = supabaseAdmin()
    const { data: item, error } = await db
      .from('items')
      .select('id, name, shopify_needs_finishing')
      .eq('shopify_product_id', productId)
      .maybeSingle()

    if (error) throw error
    if (!item) {
      console.log(`[shopify-webhook-products-update] no UGIS item linked to product ${productId} — skipping`)
      return new Response('ok', { status: 200 })
    }

    if (liveNeedsFinishing === item.shopify_needs_finishing) {
      return new Response('ok', { status: 200 }) // already in sync, nothing to do
    }

    const { error: updateErr } = await db
      .from('items')
      .update({ shopify_needs_finishing: liveNeedsFinishing })
      .eq('id', item.id)
    if (updateErr) throw updateErr

    console.log(`[shopify-webhook-products-update] item ${item.id} listing status synced: needsFinishing ${item.shopify_needs_finishing} -> ${liveNeedsFinishing}`)

    // Same _action as shopify-reconcile's own Draft/Live sync, so this
    // flows into the exact same "Recently Auto-Resolved" feed on the
    // Actionable tab regardless of which path caught it.
    await db.from('item_logs').insert({
      item_id: item.id,
      item_name: item.name,
      field_changes: {
        _action: { from: null, to: 'listing_status_synced' },
        shopify_needs_finishing: { from: item.shopify_needs_finishing, to: liveNeedsFinishing },
      },
      snapshot_before: {},
    })
  } catch (err) {
    // Shopify retries on non-2xx — but this is a best-effort instant path
    // with reconcile as the real safety net, so log and still 200 rather
    // than triggering a retry storm over a transient DB hiccup.
    console.error('[shopify-webhook-products-update]', err)
  }

  return new Response('ok', { status: 200 })
})

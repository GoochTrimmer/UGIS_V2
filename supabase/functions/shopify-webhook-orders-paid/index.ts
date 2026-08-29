// Receives Shopify's `orders/paid` webhook directly (spec §2 point 2) —
// unlike every other function here, this isn't called from our own
// frontend via supabase.functions.invoke(), so there's no Supabase-issued
// JWT to check. verify_jwt is disabled for this function specifically (see
// supabase/config.toml); authenticity is verified manually via HMAC
// instead, using the same SHOPIFY_CLIENT_SECRET already configured for the
// client-credentials token exchange.
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { convertUsdToSgd } from '../_shared/currency.ts'
import { syncProductCollection } from '../_shared/collections.ts'

interface ShopifyLineItem {
  variant_id: number | null
  price: string
}

interface ShopifyOrderPayload {
  id: number
  line_items: ShopifyLineItem[]
  shipping_address?: { country_code?: string } | null
  billing_address?: { country_code?: string } | null
}

async function verifyHmac(rawBody: string, hmacHeader: string | null): Promise<boolean> {
  const secret = Deno.env.get('SHOPIFY_CLIENT_SECRET')
  if (!secret || !hmacHeader) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const computed = btoa(String.fromCharCode(...new Uint8Array(signature)))

  // Constant-time comparison — a timing-based short-circuit here would
  // partially defeat the point of verifying the signature at all.
  const match = computed.length === hmacHeader.length && (() => {
    let mismatch = 0
    for (let i = 0; i < computed.length; i++) {
      mismatch |= computed.charCodeAt(i) ^ hmacHeader.charCodeAt(i)
    }
    return mismatch === 0
  })()

  if (!match) {
    // If this starts happening right after rotating SHOPIFY_CLIENT_SECRET:
    // Shopify can take up to ~1h to switch webhook signing over to a newly
    // active/revoked secret (confirmed by Shopify staff, not documented
    // clearly) — not a bug here, just wait it out rather than re-debugging
    // the HMAC logic itself.
    console.error('[verifyHmac] mismatch — see comment above re: secret rotation delay if this just followed a rotation')
  }

  return match
}

type Db = ReturnType<typeof supabaseAdmin>

async function processLineItem(
  db: Db,
  lineItem: ShopifyLineItem,
  orderId: string,
  saleGeography: 'local' | 'overseas' | null,
) {
  console.log(`[shopify-webhook-orders-paid] looking up variant ${lineItem.variant_id} for order ${orderId}`)

  const { data: item, error } = await db
    .from('items')
    .select('id, name, status, shopify_product_id, shopify_order_id')
    .eq('shopify_variant_id', String(lineItem.variant_id))
    .maybeSingle()

  if (error) throw error
  if (!item) {
    console.log(`[shopify-webhook-orders-paid] no UGIS item linked to variant ${lineItem.variant_id} — skipping`)
    return
  }

  console.log(`[shopify-webhook-orders-paid] matched item ${item.id} ("${item.name}"), current status "${item.status}"`)

  if (item.status === 'sold') {
    if (item.shopify_order_id === orderId) {
      console.log(`[shopify-webhook-orders-paid] item ${item.id} already sold via this exact order — redelivery, no-op`)
      return
    }

    // Genuine conflict: already sold (in-store, or a different online
    // order) before this one arrived. Local wins per spec — flag it for
    // staff to handle the Shopify-side correction themselves, don't
    // silently overwrite and don't auto-cancel/refund (that's a real
    // customer/money action, meant to be staff-initiated).
    console.log(`[shopify-webhook-orders-paid] conflict: item ${item.id} already sold via order ${item.shopify_order_id}, new order ${orderId} — flagging, not overwriting`)
    await db.from('item_logs').insert({
      item_id: item.id,
      item_name: item.name,
      field_changes: {
        _action: { from: null, to: 'online_sale_conflict' },
        conflicting_order_id: { from: item.shopify_order_id, to: orderId },
      },
      snapshot_before: {},
    })
    return
  }

  const soldPriceSgd = await convertUsdToSgd(parseFloat(lineItem.price))

  const { error: updateErr } = await db
    .from('items')
    .update({
      status: 'sold',
      sold_price: soldPriceSgd,
      sale_channel: 'website',
      sale_geography: saleGeography,
      shopify_order_id: orderId,
    })
    .eq('id', item.id)

  if (updateErr) throw updateErr

  console.log(`[shopify-webhook-orders-paid] marked item ${item.id} sold (SGD ${soldPriceSgd}) via order ${orderId}`)

  await db.from('item_logs').insert({
    item_id: item.id,
    item_name: item.name,
    field_changes: {
      _action: { from: null, to: 'online_sale' },
      status: { from: item.status, to: 'sold' },
      sold_price: { from: null, to: soldPriceSgd },
      sale_channel: { from: null, to: 'website' },
    },
    snapshot_before: {},
  })

  if (item.shopify_product_id) {
    try {
      await syncProductCollection(item.shopify_product_id, 'sold')
    } catch (err) {
      console.error(`[shopify-webhook-orders-paid] collection sync failed for item ${item.id}`, err)
    }
  }
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const rawBody = await req.text() // must read raw text before any JSON parsing — HMAC is over raw bytes
  const hmacHeader = req.headers.get('X-Shopify-Hmac-Sha256')
  const shopDomain = req.headers.get('X-Shopify-Shop-Domain')

  if (!(await verifyHmac(rawBody, hmacHeader))) {
    console.error('[shopify-webhook-orders-paid] HMAC verification failed')
    return new Response('Unauthorized', { status: 401 })
  }

  console.log('[shopify-webhook-orders-paid] HMAC verified')

  const expectedDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN')
  if (expectedDomain && shopDomain !== expectedDomain) {
    console.error(`[shopify-webhook-orders-paid] shop domain mismatch: got "${shopDomain}"`)
    return new Response('Unauthorized', { status: 401 })
  }

  let payload: ShopifyOrderPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const orderId = String(payload.id)
  const countryCode = payload.shipping_address?.country_code ?? payload.billing_address?.country_code ?? null
  const saleGeography: 'local' | 'overseas' | null = countryCode ? (countryCode === 'SG' ? 'local' : 'overseas') : null

  console.log(`[shopify-webhook-orders-paid] order ${orderId}: ${payload.line_items?.length ?? 0} line item(s), geography=${saleGeography}`)

  const db = supabaseAdmin()

  for (const lineItem of payload.line_items ?? []) {
    if (!lineItem.variant_id) {
      console.log('[shopify-webhook-orders-paid] line item has no variant_id — skipping')
      continue
    }
    try {
      await processLineItem(db, lineItem, orderId, saleGeography)
    } catch (err) {
      // One bad line item shouldn't stop the rest of the order from processing.
      console.error(`[shopify-webhook-orders-paid] failed processing variant ${lineItem.variant_id}`, err)
    }
  }

  // Always 200 once we've gotten this far — Shopify retries on non-2xx,
  // and anything worth knowing about has already been logged above.
  return new Response('ok', { status: 200 })
})

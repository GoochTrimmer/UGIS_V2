// Store credit redemption sync (spec §9 stage 4/5) — DEAD CODE, not
// currently reachable. Confirmed against the live WebhookSubscriptionTopic
// enum (Admin API 2026-07): Shopify does not expose any store-credit
// webhook topic today, so this can't actually be registered (see
// shopify-register-webhook, which deliberately omits it). Redemption sync
// for now runs entirely through shopify-reconcile's balance-drift pass —
// it polls each customer's live balance and mirrors the delta as a debit
// row, on the same nightly/manual schedule as the rest of reconciliation.
//
// Kept here, not deleted, in case a future Shopify API version adds a
// store-credit topic — if `shopify-register-webhook`'s results ever show
// this topic registering successfully, this payload shape is still an
// unverified guess and would need checking against whatever Shopify
// actually sends before trusting it.
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { verifyShopifyHmac } from '../_shared/hmac.ts'
import { gidToId } from '../_shared/shopify.ts'

interface StoreCreditTransactionPayload {
  id: string | number
  type?: string // e.g. "debit" | "credit" — only debits (spend) are mirrored here; credits are written by shopify-issue-store-credit itself
  amount?: { amount: string; currency_code?: string } | string
  store_credit_account?: { id: string | number; owner_id?: string | number }
  customer_id?: string | number
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const rawBody = await req.text()
  const hmacHeader = req.headers.get('X-Shopify-Hmac-Sha256')
  const shopDomain = req.headers.get('X-Shopify-Shop-Domain')

  if (!(await verifyShopifyHmac(rawBody, hmacHeader))) {
    console.error('[shopify-webhook-store-credit] HMAC verification failed')
    return new Response('Unauthorized', { status: 401 })
  }

  const expectedDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN')
  if (expectedDomain && shopDomain !== expectedDomain) {
    console.error(`[shopify-webhook-store-credit] shop domain mismatch: got "${shopDomain}"`)
    return new Response('Unauthorized', { status: 401 })
  }

  let payload: StoreCreditTransactionPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  try {
    // Only mirror spends — a credit event here would almost always be one
    // this project issued itself (already logged synchronously by
    // shopify-issue-store-credit) or a manual adjustment made directly in
    // Shopify admin, which the balance-drift reconciliation pass catches
    // instead of trying to guess at here.
    if (payload.type && payload.type !== 'debit') {
      return new Response('ok', { status: 200 })
    }

    const txnId = String(payload.id)
    const customerId = payload.customer_id ?? payload.store_credit_account?.owner_id
    const amountRaw = typeof payload.amount === 'string' ? payload.amount : payload.amount?.amount
    if (!customerId || !amountRaw) {
      console.error('[shopify-webhook-store-credit] payload missing customer/amount — cannot mirror', payload)
      return new Response('ok', { status: 200 })
    }

    const db = supabaseAdmin()
    const { error } = await db.from('store_credit_log').insert({
      shopify_customer_id: `gid://shopify/Customer/${gidToId(String(customerId))}`,
      amount: Math.abs(Number(amountRaw)),
      direction: 'debit',
      source: 'redemption',
      shopify_transaction_id: `gid://shopify/StoreCreditAccountTransaction/${gidToId(txnId)}`,
    })
    // A unique-constraint violation here means this exact transaction was
    // already mirrored (Shopify redelivering the same webhook) — not an
    // error worth retrying over.
    if (error && error.code !== '23505') throw error
  } catch (err) {
    console.error('[shopify-webhook-store-credit]', err)
  }

  return new Response('ok', { status: 200 })
})

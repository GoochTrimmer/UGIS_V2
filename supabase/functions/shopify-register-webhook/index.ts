// One-time setup utility — registers webhook subscriptions pointing at
// this project's webhook-receiving functions. Not part of the app's
// regular runtime; run once (calling it again is harmless, it checks for
// an existing matching subscription per topic first and skips it).
import { corsPreflight, jsonResponse } from '../_shared/cors.ts'
import { shopifyGraphql } from '../_shared/shopify.ts'

const PROJECT_BASE = 'https://zuallwsggkzbccqhwrfl.supabase.co/functions/v1'

const SUBSCRIPTIONS: { topic: string; callbackUrl: string }[] = [
  { topic: 'ORDERS_PAID', callbackUrl: `${PROJECT_BASE}/shopify-webhook-orders-paid` },
  { topic: 'PRODUCTS_UPDATE', callbackUrl: `${PROJECT_BASE}/shopify-webhook-products-update` },
  { topic: 'PRODUCTS_DELETE', callbackUrl: `${PROJECT_BASE}/shopify-webhook-products-delete` },
  // No store-credit webhook topic exists in Shopify's Admin API as of
  // 2026-07 (confirmed against the live WebhookSubscriptionTopic enum —
  // there is no STORE_CREDIT_* entry at all). shopify-webhook-store-credit
  // is kept as dead code in case a future API version adds one; redemption
  // sync for now runs entirely through shopify-reconcile's balance-drift
  // pass instead. Not listed here since registering an unknown topic fails
  // this whole call before any topic in the list gets attempted (a query-
  // level validation error, not a per-topic one).
]

const LIST_SUBSCRIPTIONS = `
  query existingSubscriptions($topics: [WebhookSubscriptionTopic!]) {
    webhookSubscriptions(first: 50, topics: $topics) {
      nodes {
        id
        topic
        endpoint {
          __typename
          ... on WebhookHttpEndpoint { callbackUrl }
        }
      }
    }
  }
`

const CREATE_SUBSCRIPTION = `
  mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`

interface ExistingSubscriptionsResult {
  webhookSubscriptions: {
    nodes: { id: string; topic: string; endpoint: { __typename: string; callbackUrl?: string } }[]
  }
}

interface CreateSubscriptionResult {
  webhookSubscriptionCreate: {
    webhookSubscription: { id: string } | null
    userErrors: { field: string[]; message: string }[]
  }
}

Deno.serve(async req => {
  const preflight = corsPreflight(req)
  if (preflight) return preflight

  try {
    const existing = await shopifyGraphql<ExistingSubscriptionsResult>(LIST_SUBSCRIPTIONS, {
      topics: SUBSCRIPTIONS.map(s => s.topic),
    })

    const results: { topic: string; ok: boolean; alreadyRegistered?: boolean; subscriptionId?: string; error?: string }[] = []

    for (const { topic, callbackUrl } of SUBSCRIPTIONS) {
      const alreadyRegistered = existing.webhookSubscriptions.nodes.some(
        n => n.topic === topic && n.endpoint.__typename === 'WebhookHttpEndpoint' && n.endpoint.callbackUrl === callbackUrl,
      )
      if (alreadyRegistered) {
        results.push({ topic, ok: true, alreadyRegistered: true })
        continue
      }

      const created = await shopifyGraphql<CreateSubscriptionResult>(CREATE_SUBSCRIPTION, {
        topic,
        webhookSubscription: { callbackUrl, format: 'JSON' },
      })

      const { webhookSubscription, userErrors } = created.webhookSubscriptionCreate
      if (userErrors.length > 0 || !webhookSubscription) {
        results.push({ topic, ok: false, error: userErrors.map(e => e.message).join('; ') || 'Subscription creation failed' })
      } else {
        results.push({ topic, ok: true, subscriptionId: webhookSubscription.id })
      }
    }

    const allOk = results.every(r => r.ok)
    return jsonResponse({ ok: allOk, results }, allOk ? 200 : 502)
  } catch (err) {
    console.error('[shopify-register-webhook]', err)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

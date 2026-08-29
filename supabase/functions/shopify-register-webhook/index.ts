// One-time setup utility — registers the orders/paid webhook subscription
// pointing at shopify-webhook-orders-paid. Not part of the app's regular
// runtime; run once (calling it again is harmless, it checks for an
// existing matching subscription first and no-ops).
import { corsPreflight, jsonResponse } from '../_shared/cors.ts'
import { shopifyGraphql } from '../_shared/shopify.ts'

const CALLBACK_URL = 'https://zuallwsggkzbccqhwrfl.supabase.co/functions/v1/shopify-webhook-orders-paid'

const LIST_SUBSCRIPTIONS = `
  query existingSubscriptions {
    webhookSubscriptions(first: 50, topics: [ORDERS_PAID]) {
      nodes {
        id
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
    nodes: { id: string; endpoint: { __typename: string; callbackUrl?: string } }[]
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
    const existing = await shopifyGraphql<ExistingSubscriptionsResult>(LIST_SUBSCRIPTIONS)
    const alreadyRegistered = existing.webhookSubscriptions.nodes.some(
      n => n.endpoint.__typename === 'WebhookHttpEndpoint' && n.endpoint.callbackUrl === CALLBACK_URL,
    )
    if (alreadyRegistered) {
      return jsonResponse({ ok: true, alreadyRegistered: true })
    }

    const created = await shopifyGraphql<CreateSubscriptionResult>(CREATE_SUBSCRIPTION, {
      topic: 'ORDERS_PAID',
      webhookSubscription: { callbackUrl: CALLBACK_URL, format: 'JSON' },
    })

    const { webhookSubscription, userErrors } = created.webhookSubscriptionCreate
    if (userErrors.length > 0 || !webhookSubscription) {
      return jsonResponse({ error: userErrors.map(e => e.message).join('; ') || 'Subscription creation failed' }, 502)
    }

    return jsonResponse({ ok: true, subscriptionId: webhookSubscription.id })
  } catch (err) {
    console.error('[shopify-register-webhook]', err)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

// Looks up display info (name/email/phone) for a batch of Shopify customer
// IDs — used by the Actionable page so a store-credit balance-drift row can
// show who the customer actually is instead of just their raw Shopify id,
// which is all store_credit_discrepancies keeps locally (spec §9 stage 5
// never persists a name/email, only the id, since the credit-issue flow's
// email/phone input is transient — see shopify-issue-store-credit).
import { corsPreflight, jsonResponse } from '../_shared/cors.ts'
import { requireStaff } from '../_shared/requireStaff.ts'
import { shopifyGraphql, customerGid, adminCustomerUrl } from '../_shared/shopify.ts'

interface RequestBody {
  customerIds: string[]
}

interface ShopifyCustomerNode {
  id: string
  displayName: string
  email: string | null
  phone: string | null
}

const CUSTOMERS_BY_ID = `
  query customersByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Customer {
        id
        displayName
        email
        phone
      }
    }
  }
`

Deno.serve(async req => {
  const preflight = corsPreflight(req)
  if (preflight) return preflight

  const denied = await requireStaff(req)
  if (denied) return denied

  try {
    const { customerIds } = (await req.json()) as RequestBody
    if (!customerIds || customerIds.length === 0) {
      return jsonResponse({ error: 'customerIds is required' }, 400)
    }

    const data = await shopifyGraphql<{ nodes: Array<ShopifyCustomerNode | null> }>(CUSTOMERS_BY_ID, {
      ids: customerIds.map(customerGid),
    })

    const customers = data.nodes
      .filter((n): n is ShopifyCustomerNode => n != null)
      .map(n => ({
        // Full GID, matching how store_credit_discrepancies.shopify_customer_id
        // is stored — so the frontend can key its lookup map on that directly.
        shopifyCustomerId: n.id,
        displayName: n.displayName,
        email: n.email,
        phone: n.phone,
        adminUrl: adminCustomerUrl(n.id),
      }))

    return jsonResponse({ customers })
  } catch (err) {
    console.error('[shopify-get-customers]', err)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

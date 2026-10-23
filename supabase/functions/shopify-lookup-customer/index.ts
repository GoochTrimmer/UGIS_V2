// Read-only customer lookup by email/phone — used from the trade-in store
// credit form so staff can fill in just one of email/phone, check whether
// that already matches an existing Shopify customer, and autofill the
// other field from that account instead of guessing. This is the same
// search shopify-issue-store-credit's resolveCustomerId does internally
// before creating an account, just exposed standalone and without the
// create-if-missing fallback.
import { corsPreflight, jsonResponse } from '../_shared/cors.ts'
import { requireStaff } from '../_shared/requireStaff.ts'
import { shopifyGraphql } from '../_shared/shopify.ts'

interface RequestBody {
  email?: string
  phone?: string
}

interface CustomerNode {
  id: string
  displayName: string
  email: string | null
  phone: string | null
}

const FIND_CUSTOMER = `
  query findCustomer($query: String!) {
    customers(first: 5, query: $query) {
      edges { node { id displayName email phone } }
    }
  }
`

Deno.serve(async req => {
  const preflight = corsPreflight(req)
  if (preflight) return preflight

  const denied = await requireStaff(req)
  if (denied) return denied

  try {
    const { email, phone } = (await req.json()) as RequestBody
    const clauses = [email && `email:${email}`, phone && `phone:${phone}`].filter(Boolean) as string[]
    if (clauses.length === 0) {
      return jsonResponse({ error: 'email or phone is required' }, 400)
    }

    const data = await shopifyGraphql<{ customers: { edges: { node: CustomerNode }[] } }>(FIND_CUSTOMER, {
      query: clauses.join(' OR '),
    })

    // Same "prefer a candidate matching on both fields" logic as
    // shopify-issue-store-credit — an OR search can turn up a couple of
    // loosely-related matches when both email and phone were given.
    const candidates = data.customers.edges.map(e => e.node)
    const bothMatch = candidates.find(c => email && c.email === email && phone && c.phone === phone)
    const customer = bothMatch ?? candidates[0] ?? null

    return jsonResponse({ customer })
  } catch (err) {
    console.error('[shopify-lookup-customer]', err)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

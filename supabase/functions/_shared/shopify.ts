// Thin GraphQL Admin API client. Using GraphQL rather than REST across all
// Shopify Edge Functions — Shopify has been sunsetting REST for new
// development, and the store-credit mutation this integration will need
// later (spec §2) is GraphQL-only, so there's no reason to maintain two
// clients.
//
// Bump SHOPIFY_API_VERSION periodically (Shopify ships a new stable version
// quarterly); set it as a Supabase secret so it doesn't require a redeploy.

const DEFAULT_API_VERSION = '2026-07'

export class ShopifyConfigError extends Error {}
export class ShopifyApiError extends Error {
  constructor(message: string, public readonly errors: unknown) {
    super(message)
  }
}

interface ShopifyGraphqlResult<T> {
  data: T
  errors?: Array<{ message: string }>
}

// Apps created via the Dev Dashboard (required for all new custom apps since
// Jan 1 2026 — the old static shpat_ token flow no longer exists for newly
// created apps) don't get a long-lived access token. Instead they use the
// client credentials grant: exchange SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET
// for a token that expires roughly every 24h.
//
// Cached at module scope so it's reused across calls within one invocation
// (e.g. shopify-bulk-match's paginated scan) and across warm invocations of
// the same function instance. This is best-effort, not a strict singleton —
// Supabase may run multiple isolate instances, each with its own cache — but
// that just means occasionally paying for an extra token fetch, never a
// correctness problem.
let cachedToken: { token: string; expiresAt: number } | null = null
const TOKEN_EXPIRY_BUFFER_MS = 60_000 // refetch a bit before actual expiry, not after

async function getAccessToken(domain: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token
  }

  const clientId = Deno.env.get('SHOPIFY_CLIENT_ID')
  const clientSecret = Deno.env.get('SHOPIFY_CLIENT_SECRET')

  if (!clientId || !clientSecret) {
    throw new ShopifyConfigError(
      'Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET secret. Set them with `supabase secrets set` (values come from the Dev Dashboard app\'s Settings page).',
    )
  }

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new ShopifyApiError(`Token exchange failed (${res.status}) — is the app installed on this store?`, text)
  }

  const json = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS,
  }
  return cachedToken.token
}

export async function shopifyGraphql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const domain = Deno.env.get('SHOPIFY_STORE_DOMAIN')
  const version = Deno.env.get('SHOPIFY_API_VERSION') ?? DEFAULT_API_VERSION

  if (!domain) {
    throw new ShopifyConfigError('Missing SHOPIFY_STORE_DOMAIN secret. Set it with `supabase secrets set`.')
  }

  const token = await getAccessToken(domain)

  const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new ShopifyApiError(`Shopify API responded ${res.status}`, text)
  }

  const json = (await res.json()) as ShopifyGraphqlResult<T>
  if (json.errors?.length) {
    throw new ShopifyApiError(json.errors.map(e => e.message).join('; '), json.errors)
  }
  return json.data
}

const PRODUCT_STATUS_QUERY = `
  query productStatus($id: ID!) {
    product(id: $id) { status }
  }
`

/** Live status of a product (ACTIVE/DRAFT/ARCHIVED), or null if it's gone on Shopify's side. */
export async function getProductStatus(productId: string): Promise<string | null> {
  const data = await shopifyGraphql<{ product: { status: string } | null }>(PRODUCT_STATUS_QUERY, {
    id: productGid(productId),
  })
  return data.product?.status ?? null
}

/** Numeric ID from a Shopify GID, e.g. "gid://shopify/Product/123456789" -> "123456789" */
export function gidToId(gid: string): string {
  return gid.split('/').pop() ?? gid
}

export function productGid(id: string): string {
  return id.startsWith('gid://') ? id : `gid://shopify/Product/${id}`
}

export function variantGid(id: string): string {
  return id.startsWith('gid://') ? id : `gid://shopify/ProductVariant/${id}`
}

/** Admin edit URL for a product, given its numeric or GID id. */
export function adminProductUrl(productId: string): string {
  const domain = Deno.env.get('SHOPIFY_STORE_DOMAIN') ?? ''
  const storeHandle = domain.replace(/\.myshopify\.com$/, '')
  return `https://admin.shopify.com/store/${storeHandle}/products/${gidToId(productId)}`
}

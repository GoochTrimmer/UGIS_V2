// Spec §3 — link-by-URL exception tool. Used for the leftover items the
// bulk SKU match (shopify-bulk-match) can't resolve automatically.
//
// Two-step flow, both handled by this one function:
//   1. { url } -> resolve the product + its variants so staff can pick one.
//   2. { itemId, productId, variantId } -> persist the staff-confirmed link.
import { corsPreflight, jsonResponse } from '../_shared/cors.ts'
import { requireStaff } from '../_shared/requireStaff.ts'
import { shopifyGraphql, gidToId, productGid, adminProductUrl, getProductStatus } from '../_shared/shopify.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'

interface ResolveBody { url: string }
interface ConfirmBody { itemId: string; productId: string; variantId: string }
type RequestBody = Partial<ResolveBody & ConfirmBody>

interface ShopifyVariant { id: string; title: string; sku: string | null }
interface ShopifyProduct { id: string; title: string; handle: string; variants: { nodes: ShopifyVariant[] } }

const PRODUCT_FIELDS = `
  id
  title
  handle
  variants(first: 100) {
    nodes { id title sku }
  }
`

const PRODUCT_BY_HANDLE = `
  query productByHandle($handle: String!) {
    productByHandle(handle: $handle) { ${PRODUCT_FIELDS} }
  }
`

const PRODUCT_BY_ID = `
  query product($id: ID!) {
    product(id: $id) { ${PRODUCT_FIELDS} }
  }
`

/** Extracts a product handle or numeric ID from a storefront or admin Shopify URL. */
function parseShopifyProductUrl(raw: string): { handle: string } | { id: string } | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }

  // Admin: admin.shopify.com/store/{store}/products/{id}
  let m = url.pathname.match(/\/store\/[^/]+\/products\/(\d+)/)
  if (m) return { id: m[1] }

  // Legacy admin: {store}.myshopify.com/admin/products/{id}
  m = url.pathname.match(/\/admin\/products\/(\d+)/)
  if (m) return { id: m[1] }

  // Storefront: {store}/products/{handle}
  m = url.pathname.match(/\/products\/([^/?#]+)/)
  if (m) return { handle: m[1] }

  return null
}

function serializeProduct(product: ShopifyProduct) {
  return {
    productId: gidToId(product.id),
    title: product.title,
    handle: product.handle,
    variants: product.variants.nodes.map(v => ({
      variantId: gidToId(v.id),
      title: v.title,
      sku: v.sku,
    })),
  }
}

async function resolve(url: string) {
  const parsed = parseShopifyProductUrl(url)
  if (!parsed) return jsonResponse({ error: 'Could not parse a product handle or ID from that URL.' }, 400)

  const data = 'handle' in parsed
    ? await shopifyGraphql<{ productByHandle: ShopifyProduct | null }>(PRODUCT_BY_HANDLE, { handle: parsed.handle })
        .then(d => d.productByHandle)
    : await shopifyGraphql<{ product: ShopifyProduct | null }>(PRODUCT_BY_ID, { id: productGid(parsed.id) })
        .then(d => d.product)

  if (!data) return jsonResponse({ error: 'No product found at that URL.' }, 404)
  return jsonResponse(serializeProduct(data))
}

async function confirm({ itemId, productId, variantId }: ConfirmBody) {
  const db = supabaseAdmin()
  const status = await getProductStatus(productId)
  const { error } = await db
    .from('items')
    .update({
      shopify_product_id: productId,
      shopify_variant_id: variantId,
      shopify_admin_url: adminProductUrl(productId),
      // It's linked to a real Shopify listing either way — reflects the
      // trigger flag's job being done, not "should UGIS push a new draft".
      ready_to_list: true,
      // Reflect the listing's actual live state instead of assuming —
      // still DRAFT means photos/description genuinely aren't done yet.
      shopify_needs_finishing: status === 'DRAFT',
    })
    .eq('id', itemId)

  if (error) {
    if (error.code === '23505') {
      return jsonResponse({ error: 'That Shopify product/variant is already linked to another UGIS item.' }, 409)
    }
    return jsonResponse({ error: error.message }, 500)
  }
  return jsonResponse({ ok: true })
}

Deno.serve(async req => {
  const preflight = corsPreflight(req)
  if (preflight) return preflight

  const denied = await requireStaff(req)
  if (denied) return denied

  try {
    const body = (await req.json()) as RequestBody

    if (body.itemId && body.productId && body.variantId) {
      return await confirm(body as ConfirmBody)
    }
    if (body.url) {
      return await resolve(body.url)
    }
    return jsonResponse({ error: 'Provide either { url } to resolve or { itemId, productId, variantId } to confirm.' }, 400)
  } catch (err) {
    console.error('[shopify-resolve-link]', err)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

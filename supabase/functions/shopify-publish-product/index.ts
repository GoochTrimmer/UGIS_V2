// Publishes a draft product (Draft -> Active) on Shopify's side. Called by
// the "Mark as finished" button in UGIS's item edit form — previously that
// button only flipped shopify_needs_finishing to false in UGIS's own DB
// without ever touching Shopify, so clicking it made UGIS show the item as
// "Live" while the Shopify listing was still sitting in Draft. This closes
// that gap: shopify_needs_finishing only gets cleared once this call
// actually succeeds (see the markShopifyFinished mutation in useItems.ts).
import { corsPreflight, jsonResponse } from '../_shared/cors.ts'
import { requireStaff } from '../_shared/requireStaff.ts'
import { shopifyGraphql, productGid } from '../_shared/shopify.ts'

interface RequestBody {
  productId: string
}

// Modern (2024-01+) Admin API shape for this mutation — takes `product:`,
// not the older `input:` still used by productCreate elsewhere in this
// codebase (that one hasn't been touched since it was already working).
// Untested against the live schema yet; if Shopify comes back with a
// schema-mismatch error the first time this runs, that error message will
// say exactly which part is wrong.
const PRODUCT_PUBLISH = `
  mutation productPublish($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id status }
      userErrors { field message }
    }
  }
`

Deno.serve(async req => {
  const preflight = corsPreflight(req)
  if (preflight) return preflight

  const denied = await requireStaff(req)
  if (denied) return denied

  try {
    const { productId } = (await req.json()) as RequestBody
    if (!productId) return jsonResponse({ error: 'productId is required' }, 400)

    const data = await shopifyGraphql<{
      productUpdate: {
        product: { id: string; status: string } | null
        userErrors: { field: string[]; message: string }[]
      }
    }>(PRODUCT_PUBLISH, { product: { id: productGid(productId), status: 'ACTIVE' } })

    const { product, userErrors } = data.productUpdate
    if (userErrors.length > 0 || !product) {
      return jsonResponse({ error: userErrors.map(e => e.message).join('; ') || 'Publish failed' }, 502)
    }

    return jsonResponse({ ok: true, status: product.status })
  } catch (err) {
    console.error('[shopify-publish-product]', err)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

// Lets staff delete a UGIS item's linked Shopify listing along with the
// item itself, instead of leaving an orphaned product behind. Two actions:
//   { action: 'status', productId } -> current Shopify status, for the
//     pre-delete warning (ACTIVE/DRAFT/ARCHIVED) so staff know what they're
//     about to remove before confirming.
//   { action: 'delete', productId }  -> actually deletes the product.
import { corsPreflight, jsonResponse } from '../_shared/cors.ts'
import { shopifyGraphql, productGid, getProductStatus } from '../_shared/shopify.ts'

interface RequestBody {
  productId: string
  action: 'status' | 'delete'
}

const PRODUCT_DELETE = `
  mutation productDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      deletedProductId
      userErrors { field message }
    }
  }
`

async function status(productId: string) {
  // null if already gone on Shopify's side (e.g. deleted manually) — not an
  // error, just nothing left to warn about.
  return jsonResponse({ status: await getProductStatus(productId) })
}

async function remove(productId: string) {
  const result = await shopifyGraphql<{
    productDelete: { deletedProductId: string | null; userErrors: { field: string[]; message: string }[] }
  }>(PRODUCT_DELETE, { input: { id: productGid(productId) } })

  if (result.productDelete.userErrors.length > 0) {
    return jsonResponse({ error: result.productDelete.userErrors.map(e => e.message).join('; ') }, 502)
  }
  return jsonResponse({ deleted: true })
}

Deno.serve(async req => {
  const preflight = corsPreflight(req)
  if (preflight) return preflight

  try {
    const { productId, action } = (await req.json()) as RequestBody
    if (!productId) return jsonResponse({ error: 'productId is required' }, 400)

    return action === 'delete' ? await remove(productId) : await status(productId)
  } catch (err) {
    console.error('[shopify-delete-product]', err)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

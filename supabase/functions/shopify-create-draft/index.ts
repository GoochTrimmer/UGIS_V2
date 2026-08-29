// Spec §4 — "draft-first, finish-in-Shopify" listing creation.
// Called from ItemForm when an item's `ready_to_list` flag flips to true and
// it has no Shopify link yet. Creates a DRAFT product with title/price/SKU
// only — no images or description, those get finished by staff in Shopify's
// own admin UI.
import { corsPreflight, jsonResponse } from '../_shared/cors.ts'
import { shopifyGraphql, gidToId, adminProductUrl } from '../_shared/shopify.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'

interface RequestBody {
  itemId: string
}

const PRODUCT_CREATE = `
  mutation productCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        variants(first: 1) {
          nodes { id }
        }
      }
      userErrors { field message }
    }
  }
`

// Note: as of recent Admin API versions, SKU lives under the variant's
// nested inventoryItem rather than directly on the variant input. Verify
// this shape against the deployed SHOPIFY_API_VERSION's schema (via the
// GraphiQL explorer in the Shopify admin) before first real use — Shopify
// has moved variant/price/inventory fields around across versions.
const VARIANTS_BULK_UPDATE = `
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }
`

Deno.serve(async req => {
  const preflight = corsPreflight(req)
  if (preflight) return preflight

  try {
    const { itemId } = (await req.json()) as RequestBody
    if (!itemId) return jsonResponse({ error: 'itemId is required' }, 400)

    const db = supabaseAdmin()
    const { data: item, error: itemErr } = await db
      .from('items')
      .select('id, name, readable_id, selling_price, shopify_product_id, shopify_variant_id')
      .eq('id', itemId)
      .single()

    if (itemErr || !item) return jsonResponse({ error: 'Item not found' }, 404)

    // Idempotent: if already linked, just hand back the existing link
    // instead of creating a duplicate product.
    if (item.shopify_product_id) {
      return jsonResponse({
        productId: item.shopify_product_id,
        variantId: item.shopify_variant_id,
        adminUrl: adminProductUrl(item.shopify_product_id),
        alreadyLinked: true,
      })
    }

    const created = await shopifyGraphql<{
      productCreate: {
        product: { id: string; variants: { nodes: { id: string }[] } } | null
        userErrors: { field: string[]; message: string }[]
      }
    }>(PRODUCT_CREATE, {
      input: { title: item.name, status: 'DRAFT' },
    })

    const { product, userErrors } = created.productCreate
    if (userErrors.length > 0 || !product) {
      return jsonResponse({ error: userErrors.map(e => e.message).join('; ') || 'Product creation failed' }, 502)
    }

    const variantId = product.variants.nodes[0]?.id
    if (variantId) {
      const updated = await shopifyGraphql<{
        productVariantsBulkUpdate: {
          productVariants: { id: string }[]
          userErrors: { field: string[]; message: string }[]
        }
      }>(VARIANTS_BULK_UPDATE, {
        productId: product.id,
        variants: [
          {
            id: variantId,
            price: item.selling_price ?? undefined,
            inventoryItem: { sku: item.readable_id },
          },
        ],
      })
      if (updated.productVariantsBulkUpdate.userErrors.length > 0) {
        // Product + variant already exist at this point; don't fail the
        // whole request over price/SKU — surface as a warning and let
        // staff fix it up directly in Shopify.
        console.error('[shopify-create-draft] variant update errors', updated.productVariantsBulkUpdate.userErrors)
      }
    }

    const { error: updateErr } = await db
      .from('items')
      .update({
        shopify_product_id: gidToId(product.id),
        shopify_variant_id: variantId ? gidToId(variantId) : null,
        shopify_admin_url: adminProductUrl(product.id),
        shopify_needs_finishing: true,
      })
      .eq('id', itemId)

    if (updateErr) return jsonResponse({ error: `Created in Shopify but failed to save link: ${updateErr.message}` }, 500)

    return jsonResponse({
      productId: gidToId(product.id),
      variantId: variantId ? gidToId(variantId) : null,
      adminUrl: adminProductUrl(product.id),
    })
  } catch (err) {
    console.error('[shopify-create-draft]', err)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

// Spec §3 — backfilling existing (pre-integration) Shopify listings.
// Does a single paginated pull of the full catalog's variants (not
// per-item lookups) and auto-matches against UGIS items with no Shopify
// link yet by comparing SKU text to readable_id. Leftovers go to the
// shopify-resolve-link (link-by-URL) exception tool.
//
// Two actions:
//   { action: 'scan' }  -> pull + match, return results (no writes)
//   { action: 'apply', matches: [{ itemId, productId, variantId }] } -> persist
import { corsPreflight, jsonResponse } from '../_shared/cors.ts'
import { shopifyGraphql, gidToId, adminProductUrl } from '../_shared/shopify.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'

interface RequestBody {
  action: 'scan' | 'apply'
  matches?: { itemId: string; productId: string; variantId: string; needsFinishing: boolean }[]
}

interface ShopifyVariantNode {
  id: string
  sku: string | null
  product: { id: string; title: string; status: string }
}

const VARIANTS_PAGE = `
  query variantsPage($cursor: String) {
    productVariants(first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        sku
        product { id title status }
      }
    }
  }
`

async function fetchAllVariants(): Promise<ShopifyVariantNode[]> {
  const all: ShopifyVariantNode[] = []
  let cursor: string | null = null
  for (;;) {
    const data: {
      productVariants: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: ShopifyVariantNode[]
      }
    } = await shopifyGraphql(VARIANTS_PAGE, { cursor })
    all.push(...data.productVariants.nodes)
    if (!data.productVariants.pageInfo.hasNextPage) break
    cursor = data.productVariants.pageInfo.endCursor
  }
  return all
}

async function scan() {
  const db = supabaseAdmin()
  const [{ data: items, error: itemsErr }, variants] = await Promise.all([
    db.from('items').select('id, readable_id').is('shopify_product_id', null),
    fetchAllVariants(),
  ])
  if (itemsErr) return jsonResponse({ error: itemsErr.message }, 500)

  const bySku = new Map<string, ShopifyVariantNode>()
  for (const v of variants) {
    if (v.sku?.trim()) bySku.set(v.sku.trim().toUpperCase(), v)
  }

  const matched: { itemId: string; readableId: string; productId: string; productTitle: string; variantId: string; needsFinishing: boolean }[] = []
  const unmatched: { itemId: string; readableId: string }[] = []

  for (const item of items ?? []) {
    const hit = bySku.get(item.readable_id.trim().toUpperCase())
    if (hit) {
      matched.push({
        itemId: item.id,
        readableId: item.readable_id,
        productId: gidToId(hit.product.id),
        productTitle: hit.product.title,
        variantId: gidToId(hit.id),
        // Still DRAFT means photos/description genuinely aren't done yet.
        needsFinishing: hit.product.status === 'DRAFT',
      })
    } else {
      unmatched.push({ itemId: item.id, readableId: item.readable_id })
    }
  }

  return jsonResponse({
    scannedShopifyVariants: variants.length,
    scannedUgisItems: (items ?? []).length,
    matched,
    unmatched,
  })
}

async function apply(matches: NonNullable<RequestBody['matches']>) {
  const db = supabaseAdmin()
  const errors: string[] = []
  let applied = 0

  for (const m of matches) {
    const { error } = await db
      .from('items')
      .update({
        shopify_product_id: m.productId,
        shopify_variant_id: m.variantId,
        shopify_admin_url: adminProductUrl(m.productId),
        // It's linked to a real Shopify listing either way — reflects the
        // trigger flag's job being done, not "should UGIS push a new draft".
        ready_to_list: true,
        // Reflects the listing's actual status at scan time (spec §4 UI distinction).
        shopify_needs_finishing: m.needsFinishing,
      })
      .eq('id', m.itemId)

    if (error) {
      errors.push(error.code === '23505'
        ? `${m.itemId}: Shopify product/variant already linked to another item`
        : `${m.itemId}: ${error.message}`)
    } else {
      applied++
    }
  }

  return jsonResponse({ applied, errors })
}

Deno.serve(async req => {
  const preflight = corsPreflight(req)
  if (preflight) return preflight

  try {
    const body = (await req.json()) as RequestBody
    if (body.action === 'apply') {
      if (!body.matches?.length) return jsonResponse({ error: 'No matches provided' }, 400)
      return await apply(body.matches)
    }
    return await scan()
  } catch (err) {
    console.error('[shopify-bulk-match]', err)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

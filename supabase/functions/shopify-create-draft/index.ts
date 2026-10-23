// Spec §4 — "draft-first, finish-in-Shopify" listing creation.
// Called from ItemForm when an item's `ready_to_list` flag flips to true and
// it has no Shopify link yet. Creates a DRAFT product with title/price/SKU
// only — no images or description, those get finished by staff in Shopify's
// own admin UI.
import { corsPreflight, jsonResponse } from '../_shared/cors.ts'
import { requireStaff } from '../_shared/requireStaff.ts'
import { shopifyGraphql, gidToId, adminProductUrl } from '../_shared/shopify.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'
import { convertSgdToUsd } from '../_shared/currency.ts'
import { syncProductCollection } from '../_shared/collections.ts'
import { setVariantInventory } from '../_shared/inventory.ts'

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

const ALL_PUBLICATIONS = `
  query allPublications {
    publications(first: 25) {
      nodes { id name }
    }
  }
`

const PUBLISH_TO_ALL_CHANNELS = `
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
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
    const { itemId } = (await req.json()) as RequestBody
    if (!itemId) return jsonResponse({ error: 'itemId is required' }, 400)

    const db = supabaseAdmin()
    const { data: item, error: itemErr } = await db
      .from('items')
      .select('id, name, readable_id, selling_price, status, shopify_product_id, shopify_variant_id, batch_id')
      .eq('id', itemId)
      .single()

    if (itemErr || !item) return jsonResponse({ error: 'Item not found' }, 404)

    // Multi-quantity items ("6 of the same ring") push as ONE Shopify
    // listing, not one per unit — initial inventory is how many of the
    // batch are still in stock right now, not the usual single-piece 1.
    // One-shot snapshot at push time, not an ongoing synced count: if
    // staff sell a different sibling unit later, this listing's Shopify
    // quantity doesn't follow it down. Acceptable for now since consignee
    // stock (who this is mainly for) isn't normally pushed to Shopify at
    // all — see batch_id's migration note.
    let initialQuantity = 1
    if (item.batch_id) {
      const { count, error: countErr } = await db
        .from('items')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', item.batch_id)
        .eq('status', 'in_stock')
      if (countErr) console.error('[shopify-create-draft] batch count failed, defaulting to 1', countErr)
      else if (count != null) initialQuantity = Math.max(1, count)
    }

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
      input: { title: item.name, status: 'DRAFT', vendor: 'Upstairs Garments' },
    })

    const { product, userErrors } = created.productCreate
    if (userErrors.length > 0 || !product) {
      return jsonResponse({ error: userErrors.map(e => e.message).join('; ') || 'Product creation failed' }, 502)
    }

    const variantId = product.variants.nodes[0]?.id
    if (variantId) {
      // UGIS prices are SGD; the store's base currency is USD, and a raw
      // variant price is interpreted in the store's own currency — convert
      // or the listing goes live ~25% underpriced.
      let priceUsd: number | undefined
      if (item.selling_price != null) {
        try {
          priceUsd = await convertSgdToUsd(item.selling_price)
        } catch (err) {
          // Don't fail product creation over a currency API hiccup — leave
          // price unset and let staff fill it in manually in Shopify.
          console.error('[shopify-create-draft] currency conversion failed, leaving price unset', err)
        }
      }

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
            price: priceUsd,
            inventoryItem: { sku: item.readable_id },
            // Defaults to DENY anyway, but set explicitly rather than rely
            // on an implicit default — the in-store enforcement sync
            // (zeroing inventory when something's marked sold) only
            // actually blocks a purchase if this is DENY, not CONTINUE.
            inventoryPolicy: 'DENY',
          },
        ],
      })
      if (updated.productVariantsBulkUpdate.userErrors.length > 0) {
        // Product + variant already exist at this point; don't fail the
        // whole request over price/SKU — surface as a warning and let
        // staff fix it up directly in Shopify.
        console.error('[shopify-create-draft] variant update errors', updated.productVariantsBulkUpdate.userErrors)
      }

      // Enable inventory tracking and set initial stock — 1 for a one-off
      // archive piece, or the batch's current in-stock count for a
      // multi-quantity listing (see initialQuantity above). Best-effort:
      // the product/variant already exist regardless of whether this
      // succeeds.
      try {
        await setVariantInventory(gidToId(variantId), initialQuantity, 'received', true)
      } catch (err) {
        console.error('[shopify-create-draft] failed to set initial inventory', err)
      }
    }

    // Publish to every available sales channel. Products created via the API
    // aren't scoped to any channel by default (unlike creating one by hand in
    // the admin UI, where the active channels get auto-selected) — this
    // still just leaves it a DRAFT, invisible everywhere, until staff
    // publish it; it just means every channel is already ticked when they do.
    // Requires the write_publications (+ read_publications) scope.
    // One publishablePublish call PER channel rather than one batched call
    // for all of them — some channels (third-party or custom ones
    // especially) may not grant this app publish access even with the
    // scope, and a single failing entry shouldn't be able to take the
    // whole batch down with it. Best-effort throughout: the draft already
    // exists by this point, so failures here just get logged, not thrown.
    try {
      const pubs = await shopifyGraphql<{ publications: { nodes: { id: string; name: string }[] } }>(ALL_PUBLICATIONS)
      for (const pub of pubs.publications.nodes) {
        try {
          const published = await shopifyGraphql<{
            publishablePublish: { userErrors: { field: string[]; message: string }[] }
          }>(PUBLISH_TO_ALL_CHANNELS, { id: product.id, input: [{ publicationId: pub.id }] })
          if (published.publishablePublish.userErrors.length > 0) {
            console.error(`[shopify-create-draft] publish to "${pub.name}" errors`, published.publishablePublish.userErrors)
          }
        } catch (err) {
          console.error(`[shopify-create-draft] failed to publish to "${pub.name}"`, err)
        }
      }
    } catch (err) {
      console.error('[shopify-create-draft] failed to list publications', err)
    }

    // Shop All / Sold Out based on the item's current status — same
    // best-effort treatment; ongoing sync on later status changes is
    // handled separately by shopify-sync-item-status.
    try {
      await syncProductCollection(gidToId(product.id), item.status)
    } catch (err) {
      console.error('[shopify-create-draft] failed to sync collection', err)
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

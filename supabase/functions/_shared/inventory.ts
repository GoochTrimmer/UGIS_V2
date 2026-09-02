// In-store sale enforcement (spec §2 point 5): when an item is marked sold
// in UGIS, zero its Shopify inventory synchronously so it can't also sell
// online before any reconciliation job would catch it. Also used in
// reverse (restock to 1) if staff correct a mistaken "sold" status.
import { shopifyGraphql, variantGid } from './shopify.ts'

// Assumes a single-location store (typical for a boutique). If the store
// actually has multiple locations, this needs revisiting — it'll surface as
// a clearly wrong location rather than silently picking the wrong one.
let cachedLocationId: string | null = null

const PRIMARY_LOCATION = `
  query primaryLocation {
    locations(first: 1) {
      nodes { id }
    }
  }
`

export async function getPrimaryLocationId(): Promise<string> {
  if (cachedLocationId) return cachedLocationId
  const data = await shopifyGraphql<{ locations: { nodes: { id: string }[] } }>(PRIMARY_LOCATION)
  const id = data.locations.nodes[0]?.id
  if (!id) throw new Error('No Shopify location found — is the store set up with at least one location?')
  cachedLocationId = id
  return id
}

const VARIANT_INVENTORY_ITEM = `
  query variantInventoryItem($id: ID!) {
    productVariant(id: $id) {
      inventoryItem { id }
    }
  }
`

async function getVariantInventoryItemId(variantId: string): Promise<string> {
  const data = await shopifyGraphql<{ productVariant: { inventoryItem: { id: string } } | null }>(
    VARIANT_INVENTORY_ITEM,
    { id: variantGid(variantId) },
  )
  const id = data.productVariant?.inventoryItem?.id
  if (!id) throw new Error(`Could not find inventory item for variant ${variantId}`)
  return id
}

// Note the @idempotent directive on the field itself, not a plain argument —
// required as of API 2026-04+, on both mutations below (confirmed against
// the live schema — it turns out to apply more broadly than just
// inventorySetQuantities, and the key argument is non-nullable, not
// optional as Shopify's own docs example showed). Each call needs a fresh key.
const INVENTORY_ACTIVATE = `
  mutation inventoryActivate($inventoryItemId: ID!, $locationId: ID!, $idempotencyKey: String!) {
    inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) @idempotent(key: $idempotencyKey) {
      userErrors { field message }
    }
  }
`

const INVENTORY_SET_QUANTITIES = `
  mutation inventorySetQuantities($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      userErrors { code field message }
    }
  }
`

const INVENTORY_ITEM_UPDATE = `
  mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem { id tracked }
      userErrors { field message }
    }
  }
`

/**
 * Sets a variant's available inventory at the store's primary location.
 * Pass `ensureTracked: true` on first setup — a fresh draft's variant may
 * not have inventory tracking enabled yet, and without it the quantity set
 * below wouldn't actually be enforced. Skipped on routine sold/restock
 * toggles since it's already been set once by then.
 */
export async function setVariantInventory(variantId: string, quantity: number, reason: string, ensureTracked = false): Promise<void> {
  const [inventoryItemId, locationId] = await Promise.all([
    getVariantInventoryItemId(variantId),
    getPrimaryLocationId(),
  ])

  if (ensureTracked) {
    try {
      await shopifyGraphql(INVENTORY_ITEM_UPDATE, { id: inventoryItemId, input: { tracked: true } })
    } catch (err) {
      console.error('[setVariantInventory] failed to enable inventory tracking', err)
    }
  }

  // Not all variants are automatically stocked at a location on creation —
  // activate first. Best-effort: an "already active" response is fine, and
  // we don't want a flaky activate call to block the actual quantity set.
  try {
    await shopifyGraphql(INVENTORY_ACTIVATE, { inventoryItemId, locationId, idempotencyKey: crypto.randomUUID() })
  } catch (err) {
    console.error('[setVariantInventory] activate failed (may already be active, continuing)', err)
  }

  const result = await shopifyGraphql<{
    inventorySetQuantities: { userErrors: { code: string; field: string[]; message: string }[] }
  }>(INVENTORY_SET_QUANTITIES, {
    input: {
      name: 'available',
      reason,
      // changeFromQuantity is required to be present (as of 2026-04+) but
      // explicitly null opts out of the compare-and-swap check — the field
      // must still be sent, just with a null value, not omitted. UGIS is
      // the authoritative source for this decision; there's no concurrent
      // writer we're racing against for one-off archive items.
      quantities: [{ inventoryItemId, locationId, quantity, changeFromQuantity: null }],
    },
    idempotencyKey: crypto.randomUUID(),
  })

  if (result.inventorySetQuantities.userErrors.length > 0) {
    throw new Error(result.inventorySetQuantities.userErrors.map(e => e.message).join('; '))
  }
}

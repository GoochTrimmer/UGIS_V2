import type { Item } from '../../types'

export type ShopifyStatusValue = 'live' | 'draft' | 'unlisted'

// A single 'flags' state carries both toggle groups (Shopify status pills
// and the Incomplete pill) so they can be combined — matching any selected
// flag floats an item to the top, same as the old shopify-status-only sort.
export type SortState =
  | { field: 'flags'; shopifyStatuses: ShopifyStatusValue[]; incomplete: boolean }
  | { field: 'price' | 'cost'; dir: 'asc' | 'desc' }
  | null

export function shopifyStatusOf(item: Pick<Item, 'shopify_product_id' | 'shopify_needs_finishing'>): ShopifyStatusValue {
  if (!item.shopify_product_id) return 'unlisted'
  return item.shopify_needs_finishing ? 'draft' : 'live'
}

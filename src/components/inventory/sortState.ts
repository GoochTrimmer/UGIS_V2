import type { Item } from '../../types'

export type ShopifyStatusValue = 'live' | 'draft' | 'unlisted'

export type SortState =
  | { field: 'shopify_status'; values: ShopifyStatusValue[] }
  | { field: 'price' | 'cost'; dir: 'asc' | 'desc' }
  | null

export function shopifyStatusOf(item: Pick<Item, 'shopify_product_id' | 'shopify_needs_finishing'>): ShopifyStatusValue {
  if (!item.shopify_product_id) return 'unlisted'
  return item.shopify_needs_finishing ? 'draft' : 'live'
}

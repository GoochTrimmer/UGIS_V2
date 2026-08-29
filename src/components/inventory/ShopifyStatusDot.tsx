import type { Item } from '../../types'

type ShopifyLinkInfo = Pick<Item, 'shopify_product_id' | 'shopify_needs_finishing'>

// Reflects UGIS's last-known link state, not a live per-row Shopify check
// (that'd mean one API call per visible row) — accurate right after
// linking/pushing, can drift if the listing changes directly in Shopify.
// Closing that gap for real is the discrepancy-reconciliation job, still a
// deferred phase.
export default function ShopifyStatusDot({ item }: { item: ShopifyLinkInfo }) {
  if (!item.shopify_product_id) {
    return (
      <span
        className="inline-block w-2 h-2 rounded-full border border-gray-700 shrink-0"
        title="Not listed on Shopify"
      />
    )
  }
  const live = !item.shopify_needs_finishing
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${live ? 'bg-emerald-400' : 'bg-yellow-400'}`}
      title={live ? 'Shopify: Live (as of last sync)' : 'Shopify: Draft — needs finishing (as of last sync)'}
    />
  )
}

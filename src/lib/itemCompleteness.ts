import { paymentTypeHasFee } from './constants'
import type { Item } from '../types'

export interface MissingField {
  key: string
  label: string
  // Payment-related fields (take-back/cost, selling price, and card fee when
  // applicable) block a clean payout or sale record, so they're flagged with
  // more urgency than the rest — red caution icon, sorted to the top.
  priority?: boolean
}

type CompletenessItem = Pick<Item,
  | 'status'
  | 'size'
  | 'season_period'
  | 'season_year'
  | 'season_custom'
  | 'brands'
  | 'consignee_id'
  | 'consignee'
  | 'cost_amount'
  | 'takeback_price'
  | 'selling_price'
  | 'sold_price'
  | 'sale_channel'
  | 'sale_geography'
  | 'payment_type'
  | 'card_fee'
>

// Every non-Shopify field an item can carry — Shopify listing state (live /
// draft / unlisted) is deliberately excluded, since that's already surfaced
// by the status dot, not this flag. Several checks are contextual rather
// than flat nulls, mirroring fields that are genuinely conditional
// elsewhere in the app (e.g. Cost vs. Take-back Price already depend on
// consignment; season year/custom only apply to certain season periods;
// sale details only apply once an item is actually sold).
export function getMissingFields(item: CompletenessItem): MissingField[] {
  const missing: MissingField[] = []

  if (!item.size) missing.push({ key: 'size', label: 'Size' })
  if (item.brands.length === 0) missing.push({ key: 'brands', label: 'Brand' })

  if (!item.season_period) {
    missing.push({ key: 'season_period', label: 'Season' })
  } else if (item.season_period === 'Custom') {
    if (!item.season_custom) missing.push({ key: 'season_custom', label: 'Custom Season' })
  } else if (item.season_period !== 'NA' && item.season_year == null) {
    missing.push({ key: 'season_year', label: 'Season Year' })
  }

  if (item.consignee_id == null) missing.push({ key: 'consignee', label: 'Consignee' })

  const isConsigned = !!item.consignee && !item.consignee.is_default_store
  if (isConsigned) {
    if (item.takeback_price == null) missing.push({ key: 'takeback_price', label: 'Take-back Price', priority: true })
  } else if (item.cost_amount == null) {
    missing.push({ key: 'cost_amount', label: 'Cost', priority: true })
  }

  if (item.selling_price == null) missing.push({ key: 'selling_price', label: 'Selling Price', priority: true })

  if (item.status === 'sold') {
    if (item.sold_price == null) missing.push({ key: 'sold_price', label: 'Sold Price' })
    if (!item.sale_channel) missing.push({ key: 'sale_channel', label: 'Sale Channel' })
    if (!item.sale_geography) missing.push({ key: 'sale_geography', label: 'Geography' })
    if (!item.payment_type) {
      missing.push({ key: 'payment_type', label: 'Payment Type' })
    } else if (paymentTypeHasFee(item.payment_type) && item.card_fee == null) {
      missing.push({ key: 'card_fee', label: 'Card Fee', priority: true })
    }
  }

  return missing
}

export function isIncomplete(item: CompletenessItem): boolean {
  return getMissingFields(item).length > 0
}

export function hasPriorityMissing(missing: MissingField[]): boolean {
  return missing.some(f => f.priority)
}

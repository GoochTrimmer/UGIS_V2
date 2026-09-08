export type SaleChannel = 'in_store' | 'website' | 'grailed' | 'carousell' | 'instagram' | 'other'
export type SaleGeography = 'local' | 'overseas'
export type PaymentType =
  | 'cash'
  | 'domestic_card'
  | 'international_card'
  | 'paynow'
  | 'grabpay'
  | 'paylater_grab'
  | 'shopeepay'
  | 'atome'
  | 'shopback'
  | 'wechatpay'
  | 'alipay'
  | 'upi'
  | 'cdc_vouchers'

export type ItemStatus =
  | 'in_stock'
  | 'sold'
  | 'on_rental'
  | 'out_for_cleaning'
  | 'reserved'
  | 'returned'
  | 'archived'

export type SeasonPeriod = 'SS' | 'AW' | 'Resort' | 'Pre-Fall' | 'NA' | 'Custom'

export interface Brand {
  id: string
  name: string
  abbreviation: string
  aliases: string[] | null
  parent_id: string | null
  created_at: string
}

export interface Consignee {
  id: string
  name: string
  abbreviation: string
  is_default_store: boolean
  contact: string | null
  notes: string | null
  created_at: string
}

export interface Item {
  id: string
  readable_id: string
  name: string
  season_year: number | null
  season_period: SeasonPeriod | null
  season_custom: string | null
  status: ItemStatus
  consignee_id: string | null
  cost_amount: number | null
  takeback_price: number | null
  selling_price: number | null
  sold_price: number | null
  sale_channel: SaleChannel | null
  sale_geography: SaleGeography | null
  payment_type: PaymentType | null
  card_fee: number | null
  size: string | null
  notes: string | null
  created_at: string
  updated_at: string
  brands: Brand[]
  consignee: Pick<Consignee, 'id' | 'name' | 'abbreviation' | 'is_default_store'> | null
  shopify_product_id: string | null
  shopify_variant_id: string | null
  shopify_admin_url: string | null
  ready_to_list: boolean
  scheduled_drop_at: string | null
  is_migrated: boolean
  shopify_needs_finishing: boolean
  shopify_order_id: string | null
  shopify_order_url: string | null
  trade_in_cash_offer: number | null
  trade_in_credit_offer: number | null
  trade_in_choice: 'cash' | 'credit' | null
  shopify_customer_id: string | null
  shopify_customer_admin_url: string | null
  shopify_store_credit_txn_id: string | null
}

export interface ItemSnapshot {
  id: string
  name: string
  size: string | null
  status: ItemStatus
  season_year: number | null
  season_period: string | null
  season_custom: string | null
  cost_amount: number | null
  takeback_price: number | null
  selling_price: number | null
  sold_price: number | null
  sale_channel: SaleChannel | null
  sale_geography: SaleGeography | null
  payment_type: PaymentType | null
  card_fee: number | null
  notes: string | null
  readable_id: string
  consignee_id: string | null
  brands: Array<{ id: string; name: string; abbreviation: string }>
  consignee: { id: string; name: string; abbreviation: string } | null
  trade_in_cash_offer: number | null
  trade_in_credit_offer: number | null
  trade_in_choice: 'cash' | 'credit' | null
}

export interface ItemLog {
  id: string
  item_id: string | null
  item_name: string
  changed_at: string
  changed_by: string | null
  field_changes: Record<string, { from: unknown; to: unknown }>
  snapshot_before: ItemSnapshot
  reverted: boolean
}

export interface ItemStatusHistoryEntry {
  id: string
  item_id: string
  status: ItemStatus
  changed_at: string
}

export type ReconciliationRunStatus = 'running' | 'completed' | 'failed'

export interface ReconciliationRun {
  id: string
  started_at: string
  finished_at: string | null
  status: ReconciliationRunStatus
  items_scanned: number | null
  discrepancies_opened: number | null
  discrepancies_closed: number | null
  listing_statuses_synced: number | null
  credit_customers_checked: number | null
  credit_discrepancies_opened: number | null
  credit_discrepancies_closed: number | null
  error: string | null
}

export interface StoreCreditDiscrepancy {
  id: string
  shopify_customer_id: string
  ugis_balance: number
  shopify_balance: number
  detected_at: string
  resolved_at: string | null
}

export interface StoreCreditLogEntry {
  id: string
  shopify_customer_id: string
  amount: number
  direction: 'credit' | 'debit'
  source: 'trade_in' | 'redemption' | 'adjustment'
  related_item_id: string | null
  shopify_transaction_id: string | null
  created_at: string
}

export type ShopifyDiscrepancyKind = 'sold_status' | 'listing_missing'

export interface ShopifyDiscrepancy {
  id: string
  item_id: string
  kind: ShopifyDiscrepancyKind
  ugis_status: ItemStatus
  shopify_available_quantity: number | null
  detected_at: string
  resolved_at: string | null
  resolved_status: ItemStatus | null
  auto_resolved: boolean
  item: Pick<Item, 'id' | 'readable_id' | 'name' | 'status' | 'shopify_admin_url' | 'shopify_product_id' | 'shopify_variant_id'> | null
}

export interface ItemFilters {
  status?: ItemStatus
  consignee_id?: string
  search?: string
  brand_ids?: string[]
  _brandId?: string
}

export type SaleChannel = 'in_store' | 'website' | 'grailed' | 'carousell' | 'instagram' | 'other'
export type SaleGeography = 'local' | 'overseas'

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
  size: string | null
  notes: string | null
  created_at: string
  updated_at: string
  brands: Brand[]
  consignee: Pick<Consignee, 'id' | 'name' | 'abbreviation' | 'is_default_store'> | null
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
  notes: string | null
  readable_id: string
  consignee_id: string | null
  brands: Array<{ id: string; name: string; abbreviation: string }>
  consignee: { id: string; name: string; abbreviation: string } | null
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

export interface ItemFilters {
  status?: ItemStatus
  consignee_id?: string
  search?: string
  brand_ids?: string[]
  _brandId?: string
}

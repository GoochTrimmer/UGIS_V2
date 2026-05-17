export type ItemStatus =
  | 'in_stock'
  | 'sold'
  | 'on_rental'
  | 'out_for_cleaning'
  | 'reserved'
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
  size: string | null
  notes: string | null
  created_at: string
  updated_at: string
  brands: Brand[]
  consignee: Pick<Consignee, 'id' | 'name' | 'abbreviation'> | null
}

export interface ItemFilters {
  status?: ItemStatus
  consignee_id?: string
  search?: string
  brand_ids?: string[]
  _brandId?: string
}

import type { ItemStatus, SeasonPeriod, SaleChannel, SaleGeography } from '../types'

export const STATUS_CONFIG: Record<ItemStatus, { label: string; color: string }> = {
  in_stock:         { label: 'In Stock',         color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  sold:             { label: 'Sold',             color: 'bg-red-500/15 text-red-400 border-red-500/30' },
  on_rental:        { label: 'On Rental',        color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  out_for_cleaning: { label: 'Out for Cleaning', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  reserved:         { label: 'Reserved',         color: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  returned:         { label: 'Returned',         color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' },
  archived:         { label: 'Archived',         color: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
}

export const SEASON_PERIODS: SeasonPeriod[] = ['SS', 'AW', 'Resort', 'Pre-Fall', 'NA', 'Custom']

export const SALE_CHANNEL_CONFIG: Record<SaleChannel, { label: string }> = {
  in_store:  { label: 'In Store' },
  website:   { label: 'Website' },
  grailed:   { label: 'Grailed' },
  carousell: { label: 'Carousell' },
  instagram: { label: 'Instagram' },
  other:     { label: 'Other' },
}

export const SALE_GEOGRAPHY_CONFIG: Record<SaleGeography, { label: string; color: string }> = {
  local:    { label: 'Local',    color: '#6366f1' },
  overseas: { label: 'Overseas', color: '#14b8a6' },
}

export const CURRENT_YEAR = new Date().getFullYear()
export const YEAR_OPTIONS = Array.from({ length: 60 }, (_, i) => CURRENT_YEAR - i)

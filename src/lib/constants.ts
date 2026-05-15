import type { ItemStatus, SeasonPeriod } from '../types'

export const STATUS_CONFIG: Record<ItemStatus, { label: string; color: string }> = {
  in_stock:         { label: 'In Stock',         color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  sold:             { label: 'Sold',             color: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
  on_rental:        { label: 'On Rental',        color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  out_for_cleaning: { label: 'Out for Cleaning', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  reserved:         { label: 'Reserved',         color: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  archived:         { label: 'Archived',         color: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
}

export const SEASON_PERIODS: SeasonPeriod[] = ['SS', 'AW', 'Resort', 'Pre-Fall', 'NA', 'Custom']

export const CURRENT_YEAR = new Date().getFullYear()
export const YEAR_OPTIONS = Array.from({ length: 60 }, (_, i) => CURRENT_YEAR - i)

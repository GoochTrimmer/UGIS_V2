import { STATUS_CONFIG, SALE_CHANNEL_CONFIG, SALE_GEOGRAPHY_CONFIG } from './constants'
import type { ItemStatus, SaleChannel, SaleGeography } from '../types'

export const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  size: 'Size',
  status: 'Status',
  season_year: 'Year',
  season_period: 'Season Period',
  season_custom: 'Season',
  cost_amount: 'Cost',
  takeback_price: 'Take-back',
  selling_price: 'Selling Price',
  sold_price: 'Sold Price',
  sale_channel: 'Sale Channel',
  sale_geography: 'Geography',
  notes: 'Notes',
  consignee: 'Consignee',
  brands: 'Brands',
  shopify_needs_finishing: 'Shopify Listing',
}

export function fmtVal(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (field === 'status') return STATUS_CONFIG[v as ItemStatus]?.label ?? String(v)
  if (field === 'cost_amount' || field === 'takeback_price' || field === 'selling_price' || field === 'sold_price') {
    return `$${Number(v).toFixed(2)}`
  }
  if (field === 'sale_channel') return SALE_CHANNEL_CONFIG[v as SaleChannel]?.label ?? String(v)
  if (field === 'sale_geography') return SALE_GEOGRAPHY_CONFIG[v as SaleGeography]?.label ?? String(v)
  if (field === 'shopify_needs_finishing') return v ? 'Draft' : 'Live'
  return String(v)
}

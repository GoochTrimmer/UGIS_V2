import { supabase } from './supabase'
import type { Item, ItemSnapshot } from '../types'

export function buildSnapshot(item: Item): ItemSnapshot {
  return {
    id: item.id,
    name: item.name,
    size: item.size,
    status: item.status,
    season_year: item.season_year,
    season_period: item.season_period,
    season_custom: item.season_custom,
    cost_amount: item.cost_amount,
    takeback_price: item.takeback_price,
    selling_price: item.selling_price,
    sold_price: item.sold_price,
    sale_channel: item.sale_channel,
    sale_geography: item.sale_geography,
    notes: item.notes,
    readable_id: item.readable_id,
    consignee_id: item.consignee_id,
    brands: item.brands.map(b => ({ id: b.id, name: b.name, abbreviation: b.abbreviation })),
    consignee: item.consignee
      ? { id: item.consignee.id, name: item.consignee.name, abbreviation: item.consignee.abbreviation }
      : null,
  }
}

export function computeDiff(
  before: ItemSnapshot,
  after: {
    name: string
    size: string | null
    status: string
    season_year: number | null
    season_period: string | null
    season_custom: string | null
    cost_amount: number | null
    takeback_price: number | null
    selling_price: number | null
    sold_price: number | null
    sale_channel: string | null
    sale_geography: string | null
    notes: string | null
    consignee_id: string | null
    consignee: { id: string; name: string } | null
    brands: Array<{ id: string; name: string }>
  }
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}

  const scalar = [
    'name', 'size', 'status', 'season_year', 'season_period',
    'season_custom', 'cost_amount', 'takeback_price', 'selling_price', 'sold_price',
    'sale_channel', 'sale_geography', 'notes',
  ] as const
  for (const f of scalar) {
    const bv = before[f]
    const av = (after as Record<string, unknown>)[f]
    // treat null and empty string as equivalent
    const bNorm = bv ?? null
    const aNorm = av ?? null
    if (bNorm !== aNorm) changes[f] = { from: bNorm, to: aNorm }
  }

  if (before.consignee_id !== after.consignee_id) {
    changes['consignee'] = {
      from: before.consignee?.name ?? null,
      to: after.consignee?.name ?? null,
    }
  }

  const beforeBrands = before.brands.map(b => b.id).sort().join(',')
  const afterBrands = after.brands.map(b => b.id).sort().join(',')
  if (beforeBrands !== afterBrands) {
    changes['brands'] = {
      from: before.brands.map(b => b.name).join(', ') || null,
      to: after.brands.map(b => b.name).join(', ') || null,
    }
  }

  return changes
}

export async function writeItemLog(params: {
  item_id: string | null
  item_name: string
  field_changes: Record<string, { from: unknown; to: unknown }>
  snapshot_before: ItemSnapshot | Record<string, never>
}): Promise<void> {
  const { error } = await supabase.from('item_logs').insert(params)
  if (error) console.error('[itemLog]', error)
}

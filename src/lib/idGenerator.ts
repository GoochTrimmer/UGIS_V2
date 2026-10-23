import { supabase } from './supabase'

export function buildBrandPrefix(brandAbbreviations: string[]): string {
  return brandAbbreviations.join('-')
}

export async function generateReadableId(
  brandAbbreviations: string[],
  consigneeAbbreviation: string | null,
): Promise<string> {
  const parts = [...brandAbbreviations]
  if (consigneeAbbreviation) parts.push(consigneeAbbreviation)
  const prefix = parts.join('-')

  const { data, error } = await supabase.rpc('next_id_count', { p_prefix: prefix })
  if (error) throw error

  const count = String(data).padStart(2, '0')
  return `${prefix}-${count}`
}

// Reserves a contiguous run of IDs for one multi-quantity listing (e.g. 6
// identical rings) — same prefix, sequential counts, one DB round trip via
// reserve_id_range (already used by the bulk CSV importer for the same
// reason: a single next_id_count-per-row loop would race under concurrent
// use, a reserved range can't).
export async function generateReadableIdBatch(
  brandAbbreviations: string[],
  consigneeAbbreviation: string | null,
  quantity: number,
): Promise<string[]> {
  const parts = [...brandAbbreviations]
  if (consigneeAbbreviation) parts.push(consigneeAbbreviation)
  const prefix = parts.join('-')

  const { data, error } = await supabase.rpc('reserve_id_range', { p_prefix: prefix, p_count: quantity })
  if (error) throw error

  const start = data as number
  return Array.from({ length: quantity }, (_, i) => `${prefix}-${String(start + i).padStart(2, '0')}`)
}

export function formatSeason(
  year: number | null | undefined,
  period: string | null | undefined,
  custom?: string | null,
): string {
  if (!period || period === 'NA') return 'NA'
  if (period === 'Custom') return custom || 'N/A'
  if (!year) return period
  const shortYear = String(year).slice(-2)
  if (period === 'Resort' || period === 'Pre-Fall') return `${period} ${shortYear}`
  return `${period}${shortYear}`
}

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

export function formatSeason(
  year: number | null | undefined,
  period: string | null | undefined,
  custom?: string | null,
): string {
  if (!period || period === 'NA') return 'NA'
  if (period === 'Custom') return custom || '—'
  if (!year) return period
  const shortYear = String(year).slice(-2)
  if (period === 'Resort' || period === 'Pre-Fall') return `${period} ${shortYear}`
  return `${period}${shortYear}`
}

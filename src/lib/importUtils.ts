import type { ItemStatus, SeasonPeriod } from '../types'

const STOP_WORDS = new Set([
  'de', 'des', 'la', 'le', 'les', 'of', 'the', 'et', 'and', 'by',
  'du', 'van', 'den', 'par', 'pour',
])

export function generateAbbreviation(name: string, taken: Set<string>): string {
  const words = name.trim().split(/\s+/).filter(w => !STOP_WORDS.has(w.toLowerCase()))
  let base: string
  if (words.length === 0) {
    base = name.replace(/\s/g, '').substring(0, 3).toUpperCase()
  } else if (words.length === 1) {
    base = words[0].substring(0, 3).toUpperCase()
  } else {
    base = words.map(w => w[0].toUpperCase()).join('')
  }
  base = base.replace(/[^A-Z0-9]/g, '') || 'BRD'

  if (!taken.has(base)) return base
  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}${i}`
    if (!taken.has(candidate)) return candidate
  }
  return base
}

export interface ParsedSeason {
  period: SeasonPeriod | null
  year: number | null
  custom: string | null
}

export function parseSeason(raw: string | null | undefined): ParsedSeason {
  const s = raw?.trim() ?? ''
  if (!s) return { period: null, year: null, custom: null }

  const u = s.toUpperCase()

  // SS23, AW22
  let m = u.match(/^(SS|AW)(\d{2})$/)
  if (m) return { period: m[1] as SeasonPeriod, year: 2000 + parseInt(m[2]), custom: null }

  // SS2023, AW2022
  m = u.match(/^(SS|AW)(\d{4})$/)
  if (m) return { period: m[1] as SeasonPeriod, year: parseInt(m[2]), custom: null }

  // SS 2023, AW 2022
  m = u.match(/^(SS|AW)\s(\d{4})$/)
  if (m) return { period: m[1] as SeasonPeriod, year: parseInt(m[2]), custom: null }

  // R23, RES23 → Resort
  m = u.match(/^R(?:ES(?:ORT)?)?(\d{2})$/)
  if (m) return { period: 'Resort', year: 2000 + parseInt(m[1]), custom: null }

  // PF23 → Pre-Fall
  m = u.match(/^PF(\d{2})$/)
  if (m) return { period: 'Pre-Fall', year: 2000 + parseInt(m[1]), custom: null }

  if (u === 'NA' || u === 'N/A' || u === '-' || u === 'NONE' || u === 'UNKNOWN') {
    return { period: 'NA', year: null, custom: null }
  }

  return { period: 'Custom', year: null, custom: s }
}

export function normalizeStatus(raw: string | null | undefined): ItemStatus {
  const s = (raw ?? '').trim().toLowerCase()
  if (!s || s === 'in_stock' || s === 'in stock' || s === 'stock') return 'in_stock'
  if (s === 'sold') return 'sold'
  if (s.includes('rental') || s === 'rent') return 'on_rental'
  if (s.includes('cleaning')) return 'out_for_cleaning'
  if (s === 'reserved' || s === 'reserve') return 'reserved'
  if (s === 'archived' || s === 'archive') return 'archived'
  return 'in_stock'
}

export function extractSequence(readableId: string): string {
  return readableId.match(/-(\d+)$/)?.[1] ?? '01'
}

export function guessColumnMapping(headers: string[]): Record<string, string> {
  const patterns: Array<[string, RegExp]> = [
    ['name',      /name|item|description|title/i],
    ['brand',     /brand/i],
    ['size',      /size/i],
    ['season',    /season/i],
    ['status',    /status/i],
    ['consignee', /consignee|stockist/i],
    ['takeback',  /take.?back|return.?price|takeback/i],
    ['selling',   /sell|listed|retail|asking/i],
    ['cost',      /cost|purchase|paid/i],
    ['notes',     /note|comment|remark/i],
  ]

  const mapping: Record<string, string> = {}
  const used = new Set<string>()

  for (const header of headers) {
    for (const [field, pattern] of patterns) {
      if (!used.has(field) && pattern.test(header)) {
        mapping[header] = field
        used.add(field)
        break
      }
    }
  }
  return mapping
}

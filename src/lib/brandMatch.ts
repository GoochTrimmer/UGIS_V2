import type { Brand } from '../types'

// Normalizes a brand name/alias for comparison so "Comme des Garçons",
// "Comme des Garcons" and "comme  des garcons" all resolve to the same
// key — strips diacritics, punctuation and case rather than relying on an
// exact string match, which previously let consignee-submitted (and
// staff-submitted) sheet rows create duplicate brand entries for a brand
// that already existed under a slightly different spelling.
export function normalizeBrandKey(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Finds an existing brand matching by name, abbreviation, or any alias,
// under normalized comparison. Returns null only when the name is
// genuinely new.
export function findMatchingBrand(name: string, brands: Brand[]): Brand | null {
  const key = normalizeBrandKey(name)
  if (!key) return null
  return (
    brands.find(b =>
      normalizeBrandKey(b.name) === key ||
      normalizeBrandKey(b.abbreviation) === key ||
      (b.aliases ?? []).some(a => normalizeBrandKey(a) === key)
    ) ?? null
  )
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

// Closest existing brand to a name that had no exact (normalized) match —
// catches typos and near-spellings ("Undercovr", "Raf Simmons",
// "Comme des Garcon") that findMatchingBrand can't. Compared against the
// name and every alias (not abbreviations — too short to fuzzy-match
// safely). Returns null if nothing is close enough to be worth suggesting.
export function suggestBrand(name: string, brands: Brand[]): Brand | null {
  const key = normalizeBrandKey(name)
  if (key.length < 5) return null // too short to fuzzy-match without false positives ("Nine" ~ "Nike")
  let best: { brand: Brand; score: number } | null = null
  for (const b of brands) {
    for (const candidate of [b.name, ...(b.aliases ?? [])]) {
      const ck = normalizeBrandKey(candidate)
      if (ck.length < 4) continue
      const dist = editDistance(key, ck)
      const score = 1 - dist / Math.max(key.length, ck.length)
      const tolerated = Math.max(1, Math.floor(Math.max(key.length, ck.length) * 0.2))
      if (dist <= tolerated && (!best || score > best.score)) best = { brand: b, score }
    }
  }
  return best?.brand ?? null
}

// Loose (substring) match for live search boxes — used by BrandSelector so
// typing "comme des garcons" surfaces Comme des Garçons in the dropdown.
export function brandMatchesQuery(brand: Brand, query: string): boolean {
  const key = normalizeBrandKey(query)
  if (!key) return true
  return (
    normalizeBrandKey(brand.name).includes(key) ||
    normalizeBrandKey(brand.abbreviation).includes(key) ||
    (brand.aliases ?? []).some(a => normalizeBrandKey(a).includes(key))
  )
}

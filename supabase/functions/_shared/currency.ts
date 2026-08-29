// UGIS prices are entered/displayed in SGD throughout the app; the Shopify
// store's base currency is USD, and Shopify has no per-variant currency
// field — whatever raw number you send for `price` is interpreted in the
// store's own currency. So prices need converting at push time.
//
// Uses open.er-api.com (free, no API key, daily-updated) rather than a paid
// FX provider — retail listing prices don't need intraday precision.
// Cached at module scope with a long TTL for the same reason token caching
// exists in shopify.ts: avoid a redundant fetch on every single push within
// the same day, not because freshness matters much here.

let cachedRate: { sgdToUsd: number; expiresAt: number } | null = null
const RATE_TTL_MS = 6 * 60 * 60 * 1000 // 6h — plenty fresh for retail pricing, cheap to re-fetch

interface ExchangeRateResponse {
  result: string
  rates: Record<string, number>
}

async function getSgdToUsdRate(): Promise<number> {
  if (cachedRate && cachedRate.expiresAt > Date.now()) return cachedRate.sgdToUsd

  const res = await fetch('https://open.er-api.com/v6/latest/SGD')
  if (!res.ok) throw new Error(`Currency API responded ${res.status}`)

  const json = (await res.json()) as ExchangeRateResponse
  if (json.result !== 'success' || typeof json.rates?.USD !== 'number') {
    throw new Error('Currency API returned an unexpected response')
  }

  cachedRate = { sgdToUsd: json.rates.USD, expiresAt: Date.now() + RATE_TTL_MS }
  return cachedRate.sgdToUsd
}

/** Converts an SGD amount to USD using the current live rate, rounded to cents. */
export async function convertSgdToUsd(amountSgd: number): Promise<number> {
  const rate = await getSgdToUsdRate()
  return Math.round(amountSgd * rate * 100) / 100
}

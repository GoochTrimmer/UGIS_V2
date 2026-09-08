// Singapore-format phone helpers for the trade-in store-credit flow — this
// store's customers are assumed Singapore-based, so a locally-typed 8-digit
// number gets Singapore's +65 country code rather than requiring staff to
// type it themselves. See the "Store Credit Region" memory note.
const SG_COUNTRY_CODE = '+65'

/** True for an 8-digit Singapore local number (mobile 8xxx/9xxx, landline 6xxx, VOIP 3xxx). */
export function isValidSgLocalPhone(digits: string): boolean {
  return /^[3689]\d{7}$/.test(digits)
}

/** Local 8-digit SG number -> Shopify's expected E.164 format, e.g. "91234567" -> "+6591234567". */
export function toE164(localDigits: string): string {
  return isValidSgLocalPhone(localDigits) ? `${SG_COUNTRY_CODE}${localDigits}` : ''
}

/** An E.164 SG number back to its local 8-digit form, e.g. "+6591234567" -> "91234567" — for display in a field that only shows the local part. */
export function fromE164(value: string): string {
  return value.startsWith(SG_COUNTRY_CODE) ? value.slice(SG_COUNTRY_CODE.length) : value.replace(/\D/g, '')
}

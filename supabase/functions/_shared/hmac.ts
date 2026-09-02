// Shared by every Shopify-called (not UGIS-called) webhook endpoint — these
// have no Supabase-issued JWT to check (Shopify calls them directly), so
// authenticity is verified manually via HMAC instead, using the same
// SHOPIFY_CLIENT_SECRET already configured for the client-credentials token
// exchange. Extracted out of shopify-webhook-orders-paid, which was first.
export async function verifyShopifyHmac(rawBody: string, hmacHeader: string | null): Promise<boolean> {
  const secret = Deno.env.get('SHOPIFY_CLIENT_SECRET')
  if (!secret || !hmacHeader) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const computed = btoa(String.fromCharCode(...new Uint8Array(signature)))

  // Constant-time comparison — a timing-based short-circuit here would
  // partially defeat the point of verifying the signature at all.
  const match = computed.length === hmacHeader.length && (() => {
    let mismatch = 0
    for (let i = 0; i < computed.length; i++) {
      mismatch |= computed.charCodeAt(i) ^ hmacHeader.charCodeAt(i)
    }
    return mismatch === 0
  })()

  if (!match) {
    // If this starts happening right after rotating SHOPIFY_CLIENT_SECRET:
    // Shopify can take up to ~1h to switch webhook signing over to a newly
    // active/revoked secret (confirmed by Shopify staff, not documented
    // clearly) — not a bug here, just wait it out rather than re-debugging
    // the HMAC logic itself.
    console.error('[verifyShopifyHmac] mismatch — see comment above re: secret rotation delay if this just followed a rotation')
  }

  return match
}

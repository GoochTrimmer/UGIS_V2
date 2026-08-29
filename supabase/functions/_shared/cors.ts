// Edge Functions are invoked via supabase.functions.invoke() from the UGIS
// frontend (browser), so they need CORS headers like any other browser-called
// HTTP endpoint. Not used by Shopify (Shopify calls come later, in the
// webhook phase, and don't need CORS since they're server-to-server).
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function corsPreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

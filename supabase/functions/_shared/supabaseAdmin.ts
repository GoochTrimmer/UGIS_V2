import { createClient } from 'npm:@supabase/supabase-js@2'

// Service-role client — bypasses RLS. Only ever used inside Edge Functions
// (server-side), never sent to the frontend. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided automatically to every Edge
// Function by the Supabase platform; no manual secret needed for these two.
export function supabaseAdmin() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in function environment.')
  }
  return createClient(url, key)
}

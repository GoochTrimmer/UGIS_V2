import { createClient } from 'npm:@supabase/supabase-js@2'
import { jsonResponse } from './cors.ts'

// Edge Functions run with the service role (see supabaseAdmin.ts) and
// bypass RLS entirely, so anything Shopify- or store-credit-related has to
// re-check the caller's role itself — otherwise a consignee account could
// invoke these directly (bypassing the UI hiding the buttons) and act on
// data that isn't theirs. Uses the caller's own JWT (forwarded by
// supabase.functions.invoke()) against the anon key, so auth_role() below
// evaluates as that specific user via RLS, not the service role.
//
// Returns a Response to return immediately if the caller isn't staff, or
// null if it's fine to proceed.
export async function requireStaff(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey) {
    return jsonResponse({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY in function environment.' }, 500)
  }

  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: { user } } = await client.auth.getUser()
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401)

  const { data: role, error } = await client.rpc('auth_role')
  if (error) return jsonResponse({ error: 'Could not verify role' }, 500)
  if (role !== 'staff') return jsonResponse({ error: 'Staff only' }, 403)

  return null
}

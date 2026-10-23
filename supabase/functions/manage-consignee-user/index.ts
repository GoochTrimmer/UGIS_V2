// Staff-only account management for consignee (stockist) logins. One
// function, three actions — all trivial and always driven from the same
// "Create login / Reset password / Revoke access" panel on the Consignees
// page (see ConsigneePanel in src/pages/Consignees.tsx), so there's no
// value in splitting these into separate functions the way the Shopify
// integration does for genuinely distinct operations.
import { corsPreflight, jsonResponse } from '../_shared/cors.ts'
import { requireStaff } from '../_shared/requireStaff.ts'
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts'

interface RequestBody {
  action: 'create' | 'reset_password' | 'revoke'
  consigneeId: string
  email?: string
  password?: string
}

Deno.serve(async req => {
  const preflight = corsPreflight(req)
  if (preflight) return preflight

  const denied = await requireStaff(req)
  if (denied) return denied

  try {
    const body = (await req.json()) as RequestBody
    if (!body.consigneeId) return jsonResponse({ error: 'consigneeId is required' }, 400)

    const admin = supabaseAdmin()

    if (body.action === 'create') {
      if (!body.email || !body.password) {
        return jsonResponse({ error: 'email and password are required' }, 400)
      }

      const { data: existing } = await admin
        .from('user_profiles')
        .select('id')
        .eq('consignee_id', body.consigneeId)
        .eq('role', 'consignee')
        .maybeSingle()
      if (existing) return jsonResponse({ error: 'This consignee already has a login.' }, 409)

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: true,
      })
      if (createErr || !created.user) {
        return jsonResponse({ error: createErr?.message ?? 'Failed to create user' }, 500)
      }

      const { error: profileErr } = await admin.from('user_profiles').insert({
        id: created.user.id,
        role: 'consignee',
        consignee_id: body.consigneeId,
        email: body.email,
      })
      if (profileErr) {
        // Roll back the auth user so a failed profile insert doesn't leave
        // an orphaned login with no consignee scoping.
        await admin.auth.admin.deleteUser(created.user.id)
        return jsonResponse({ error: profileErr.message }, 500)
      }

      return jsonResponse({ ok: true, userId: created.user.id, email: body.email })
    }

    if (body.action === 'reset_password') {
      if (!body.password) return jsonResponse({ error: 'password is required' }, 400)

      const { data: profile, error: lookupErr } = await admin
        .from('user_profiles')
        .select('id')
        .eq('consignee_id', body.consigneeId)
        .eq('role', 'consignee')
        .single()
      if (lookupErr || !profile) return jsonResponse({ error: 'No login found for this consignee.' }, 404)

      const { error: updateErr } = await admin.auth.admin.updateUserById(profile.id, { password: body.password })
      if (updateErr) return jsonResponse({ error: updateErr.message }, 500)

      return jsonResponse({ ok: true })
    }

    if (body.action === 'revoke') {
      const { data: profile, error: lookupErr } = await admin
        .from('user_profiles')
        .select('id')
        .eq('consignee_id', body.consigneeId)
        .eq('role', 'consignee')
        .single()
      if (lookupErr || !profile) return jsonResponse({ error: 'No login found for this consignee.' }, 404)

      const { error: deleteErr } = await admin.auth.admin.deleteUser(profile.id)
      if (deleteErr) return jsonResponse({ error: deleteErr.message }, 500)
      // user_profiles row cascades away via its FK to auth.users.

      return jsonResponse({ ok: true })
    }

    return jsonResponse({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error('[manage-consignee-user]', err)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

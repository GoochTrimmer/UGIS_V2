import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { Consignee } from '../types'

export interface Profile {
  role: 'staff' | 'consignee'
  consignee: Pick<Consignee, 'id' | 'name' | 'abbreviation'> | null
}

const STAFF_PROFILE: Profile = { role: 'staff', consignee: null }

// A user with no user_profiles row is staff (see auth_role() in
// 012_consignee_accounts.sql) — every account that existed before this
// feature keeps full access with nothing to backfill.
async function fetchProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('role, consignee:consignees(id, name, abbreviation)')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return STAFF_PROFILE
  return { role: data.role as Profile['role'], consignee: data.consignee as unknown as Profile['consignee'] }
}

export function useProfile() {
  const { session, loading: authLoading } = useAuth()
  const userId = session?.user?.id

  const query = useQuery({
    queryKey: ['profile', userId],
    queryFn: () => fetchProfile(userId as string),
    enabled: !!userId,
  })

  return {
    profile: query.data ?? STAFF_PROFILE,
    loading: authLoading || (!!userId && query.isPending),
  }
}

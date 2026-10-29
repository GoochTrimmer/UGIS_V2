import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Resolves item_logs.changed_by (a user id) to an email for display —
// staff-only (RLS on user_profiles only grants staff full read access;
// a consignee account can read its own row but not other users', so this
// isn't wired into their History view at all, not just hidden client-side).
export function useUserLabels(ids: (string | null)[]) {
  const uniqueIds = [...new Set(ids.filter((id): id is string => !!id))].sort()

  return useQuery({
    queryKey: ['user_labels', uniqueIds],
    queryFn: async () => {
      if (uniqueIds.length === 0) return new Map<string, string>()
      const { data, error } = await supabase.from('user_profiles').select('id, email').in('id', uniqueIds)
      if (error) throw error
      const map = new Map<string, string>()
      for (const row of data as { id: string; email: string | null }[]) {
        if (row.email) map.set(row.id, row.email)
      }
      return map
    },
    enabled: uniqueIds.length > 0,
  })
}

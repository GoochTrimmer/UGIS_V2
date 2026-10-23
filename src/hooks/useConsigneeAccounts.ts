import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { invokeEdgeFunction } from '../lib/edgeFunctions'

export interface ConsigneeAccount {
  userId: string
  email: string | null
}

// Staff-only lookup of which consignees have a login — keyed by
// consignee_id, so ConsigneePanel can render "No login" vs "Login: x@y.com"
// per row without a separate query each.
export function useConsigneeAccounts() {
  return useQuery({
    queryKey: ['consignee_accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, consignee_id, email')
        .eq('role', 'consignee')
      if (error) throw error
      const map = new Map<string, ConsigneeAccount>()
      for (const row of data as { id: string; consignee_id: string; email: string | null }[]) {
        map.set(row.consignee_id, { userId: row.id, email: row.email })
      }
      return map
    },
  })
}

export function useConsigneeAccountMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['consignee_accounts'] })

  const create = useMutation({
    mutationFn: async (vars: { consigneeId: string; email: string; password: string }): Promise<void> => {
      const { error } = await invokeEdgeFunction('manage-consignee-user', { action: 'create', ...vars })
      if (error) throw new Error(error)
    },
    onSuccess: invalidate,
  })

  const resetPassword = useMutation({
    mutationFn: async (vars: { consigneeId: string; password: string }): Promise<void> => {
      const { error } = await invokeEdgeFunction('manage-consignee-user', { action: 'reset_password', ...vars })
      if (error) throw new Error(error)
    },
  })

  const revoke = useMutation({
    mutationFn: async (consigneeId: string): Promise<void> => {
      const { error } = await invokeEdgeFunction('manage-consignee-user', { action: 'revoke', consigneeId })
      if (error) throw new Error(error)
    },
    onSuccess: invalidate,
  })

  return { create, resetPassword, revoke }
}

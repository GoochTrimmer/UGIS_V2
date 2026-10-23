import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { BrandRequest } from '../types'

// Staff see every pending request; a consignee account only sees its own
// (enforced by RLS on brand_requests, not filtered here).
export function usePendingBrandRequests() {
  return useQuery({
    queryKey: ['brand_requests', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brand_requests')
        .select('*, consignee:consignees(name)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as BrandRequest[]
    },
  })
}

export function useBrandRequestMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['brand_requests'] })

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'resolved' | 'dismissed' }): Promise<void> => {
      const { error } = await supabase.from('brand_requests').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  return { setStatus }
}

export async function createBrandRequests(
  rows: { name: string; item_count: number; example_item: string | null }[],
): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabase.from('brand_requests').insert(rows)
  if (error) throw error
}

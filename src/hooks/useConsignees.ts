import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Consignee } from '../types'

export function useConsigneeItemCounts(): Map<string, number> {
  const { data } = useQuery({
    queryKey: ['consignee_item_counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('items').select('consignee_id')
      if (error) throw error
      return data as { consignee_id: string | null }[]
    },
  })
  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    if (row.consignee_id) counts.set(row.consignee_id, (counts.get(row.consignee_id) ?? 0) + 1)
  }
  return counts
}

type ConsigneeInsert = Omit<Consignee, 'id' | 'created_at' | 'is_default_store'> & { is_default_store?: boolean }
type ConsigneeUpdate = Pick<Consignee, 'id'> & Partial<ConsigneeInsert>

async function fetchConsignees(): Promise<Consignee[]> {
  const { data, error } = await supabase
    .from('consignees')
    .select('*')
    .order('name')
  if (error) throw error
  return data as Consignee[]
}

export function useConsignees() {
  return useQuery({ queryKey: ['consignees'], queryFn: fetchConsignees })
}

export function useConsigneeMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['consignees'] })

  const create = useMutation({
    mutationFn: async (c: ConsigneeInsert) => {
      const { data, error } = await supabase.from('consignees').insert(c).select().single()
      if (error) throw error
      return data as Consignee
    },
    onSuccess: invalidate,
  })

  const update = useMutation({
    mutationFn: async ({ id, ...c }: ConsigneeUpdate) => {
      const { data, error } = await supabase.from('consignees').update(c).eq('id', id).select().single()
      if (error) throw error
      return data as Consignee
    },
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('consignees').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  return { create, update, remove }
}

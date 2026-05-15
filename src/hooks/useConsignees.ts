import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Consignee } from '../types'

type ConsigneeInsert = Omit<Consignee, 'id' | 'created_at'>
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

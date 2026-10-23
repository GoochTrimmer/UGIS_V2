import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { ConsigneeTag } from '../types'

// The full tag catalog (Store/Vendor/Stockist + any custom ones staff add)
// — separate from which tags are linked to which consignee, see
// useConsignees.ts's embedded `tags` and the link mutations below.
export function useConsigneeTags() {
  return useQuery({
    queryKey: ['consignee_tags'],
    queryFn: async () => {
      const { data, error } = await supabase.from('consignee_tags').select('*').order('name')
      if (error) throw error
      return data as ConsigneeTag[]
    },
  })
}

export function useConsigneeTagMutations() {
  const qc = useQueryClient()

  const createTag = useMutation({
    mutationFn: async (name: string): Promise<ConsigneeTag> => {
      const { data, error } = await supabase.from('consignee_tags').insert({ name: name.trim() }).select().single()
      if (error) throw error
      return data as ConsigneeTag
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consignee_tags'] }),
  })

  // Blocked by FK (consignee_tag_links references this) if still assigned
  // anywhere — caller should check link count and unassign first rather
  // than relying on the DB error, so the UI can say why.
  const deleteTag = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from('consignee_tags').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consignee_tags'] }),
  })

  // Assigning the Store tag moves it off whoever currently has it — see
  // the sync_store_tag trigger (018) — so this one link insert is the
  // entire "change which consignee is the store" action.
  const assignTag = useMutation({
    mutationFn: async ({ consigneeId, tagId }: { consigneeId: string; tagId: string }): Promise<void> => {
      const { error } = await supabase.from('consignee_tag_links').insert({ consignee_id: consigneeId, tag_id: tagId })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consignees'] }),
  })

  const unassignTag = useMutation({
    mutationFn: async ({ consigneeId, tagId }: { consigneeId: string; tagId: string }): Promise<void> => {
      const { error } = await supabase.from('consignee_tag_links').delete().eq('consignee_id', consigneeId).eq('tag_id', tagId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consignees'] }),
  })

  return { createTag, deleteTag, assignTag, unassignTag }
}

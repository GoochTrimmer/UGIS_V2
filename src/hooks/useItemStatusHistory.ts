import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { ItemStatusHistoryEntry } from '../types'

export function useItemStatusHistory(itemId: string | undefined) {
  return useQuery({
    queryKey: ['item-status-history', itemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('item_status_history')
        .select('*')
        .eq('item_id', itemId as string)
        .order('changed_at', { ascending: true })
      if (error) throw error
      return data as ItemStatusHistoryEntry[]
    },
    enabled: !!itemId,
  })
}

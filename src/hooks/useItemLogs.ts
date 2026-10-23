import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { ItemLog } from '../types'

export function useItemLogs() {
  return useQuery({
    queryKey: ['item_logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('item_logs_view')
        .select('*')
        .order('changed_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return data as ItemLog[]
    },
  })
}

export function useItemLogsForItem(itemId: string | undefined) {
  return useQuery({
    queryKey: ['item_logs', 'item', itemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('item_logs_view')
        .select('*')
        .eq('item_id', itemId as string)
        .order('changed_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data as ItemLog[]
    },
    enabled: !!itemId,
  })
}

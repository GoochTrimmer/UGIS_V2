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

// Every item's most recent transition INTO 'sold' — the earnings-over-time
// chart on Statistics needs an actual sale date, which items.updated_at
// can't reliably give (it moves on any edit, sale-related or not). Keyed
// by item_id, ascending order so a re-sold item's later transition simply
// overwrites its earlier one in the map.
export function useSoldDates() {
  return useQuery({
    queryKey: ['item-status-history', 'sold-dates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('item_status_history')
        .select('item_id, changed_at')
        .eq('status', 'sold')
        .order('changed_at', { ascending: true })
      if (error) throw error
      const map = new Map<string, string>()
      for (const row of data ?? []) map.set(row.item_id, row.changed_at)
      return map
    },
  })
}

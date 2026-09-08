import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { invokeEdgeFunction } from '../lib/edgeFunctions'
import type { StoreCreditDiscrepancy } from '../types'

interface IssueStoreCreditResult {
  ok: true
  shopifyCustomerId: string
  adminCustomerUrl: string
  transactionId: string
}

export function useIssueStoreCredit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { itemId: string; customerEmail?: string; customerPhone?: string }) => {
      const { data, error } = await invokeEdgeFunction<IssueStoreCreditResult>('shopify-issue-store-credit', vars)
      if (error) throw new Error(error)
      return data
    },
    onSuccess: (_, { itemId }) => {
      qc.invalidateQueries({ queryKey: ['items'] })
      qc.invalidateQueries({ queryKey: ['item', itemId] })
    },
  })
}

export function useOpenStoreCreditDiscrepancies() {
  return useQuery({
    queryKey: ['store-credit-discrepancies', 'open'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('store_credit_discrepancies')
        .select('*')
        .is('resolved_at', null)
        .order('detected_at', { ascending: false })
      if (error) throw error
      return data as StoreCreditDiscrepancy[]
    },
  })
}

export function useResolveStoreCreditDiscrepancy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('store_credit_discrepancies')
        .update({ resolved_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['store-credit-discrepancies'] })
    },
  })
}

// Outstanding liability — "how much credit do we currently owe across all
// customers" (spec §9 stage 5) — a plain sum of the ledger, not a live
// Shopify read, so it stays fast and works even between reconciliation runs.
export function useStoreCreditLiability() {
  return useQuery({
    queryKey: ['store-credit-log', 'liability'],
    queryFn: async () => {
      const { data, error } = await supabase.from('store_credit_log').select('amount, direction')
      if (error) throw error
      const total = (data ?? []).reduce((sum, row) => sum + (row.direction === 'credit' ? row.amount : -row.amount), 0)
      return total
    },
  })
}

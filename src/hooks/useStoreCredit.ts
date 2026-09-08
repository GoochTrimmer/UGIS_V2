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
    // onSettled, not onSuccess — a $0/missing-offer item still resolves and
    // persists the Shopify customer link as a side effect before the
    // function returns its "no credit issued" error (see
    // shopify-issue-store-credit), so the item list/edit view needs to
    // refetch even on that "failure" or it'll keep showing stale
    // unlinked/empty customer fields until something else happens to
    // invalidate the cache.
    onSettled: (_data, _error, { itemId }) => {
      qc.invalidateQueries({ queryKey: ['items'] })
      qc.invalidateQueries({ queryKey: ['item', itemId] })
    },
  })
}

export interface AdjustStoreCreditResult {
  ok: true
  newAmount: number
  transactionId: string | null
  direction: 'credit' | 'debit' | null
}

// Adjusts an already-issued trade-in's credit amount up or down — distinct
// from useIssueStoreCredit (first-time issuance), per spec: adjusting an
// issued credit is a deliberate, separate History-tab action, never an
// automatic side effect of editing the offer amount and saving.
export function useAdjustStoreCredit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { itemId: string; newAmount: number }) => {
      const { data, error } = await invokeEdgeFunction<AdjustStoreCreditResult>('shopify-adjust-store-credit', vars)
      if (error) throw new Error(error)
      return data
    },
    onSuccess: (_data, { itemId }) => {
      qc.invalidateQueries({ queryKey: ['items'] })
      qc.invalidateQueries({ queryKey: ['item', itemId] })
    },
  })
}

export interface ShopifyCustomerInfo {
  shopifyCustomerId: string
  displayName: string
  email: string | null
  phone: string | null
  adminUrl: string
}

// store_credit_discrepancies only ever has the raw Shopify customer id
// (see shopify-get-customers) — this looks up display name/email/phone for
// the current batch of open discrepancies so Actionable can show who the
// customer actually is. Keyed on the sorted id list so the same batch of
// rows shares one cached lookup.
export function useShopifyCustomers(customerIds: string[]) {
  const sortedIds = [...new Set(customerIds)].sort()
  return useQuery({
    queryKey: ['shopify-customers', sortedIds],
    queryFn: async () => {
      const { data, error } = await invokeEdgeFunction<{ customers: ShopifyCustomerInfo[] }>('shopify-get-customers', {
        customerIds: sortedIds,
      })
      if (error) throw new Error(error)
      const byId = new Map<string, ShopifyCustomerInfo>()
      for (const c of data?.customers ?? []) byId.set(c.shopifyCustomerId, c)
      return byId
    },
    enabled: sortedIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })
}

export interface ShopifyCustomerLookupResult {
  id: string
  displayName: string
  email: string | null
  phone: string | null
}

// Read-only "does this email/phone already match a Shopify customer"
// check — used by the trade-in credit form to autofill whichever of
// email/phone staff haven't typed in yet, once the other one is valid.
export function useLookupShopifyCustomer() {
  return useMutation({
    mutationFn: async (vars: { email?: string; phone?: string }) => {
      const { data, error } = await invokeEdgeFunction<{ customer: ShopifyCustomerLookupResult | null }>(
        'shopify-lookup-customer',
        vars,
      )
      if (error) throw new Error(error)
      return data?.customer ?? null
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

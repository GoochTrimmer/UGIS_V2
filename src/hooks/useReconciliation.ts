import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { invokeEdgeFunction } from '../lib/edgeFunctions'
import type { ReconciliationRun, ShopifyDiscrepancy, ItemStatus } from '../types'

const DISCREPANCY_SELECT = `
  *,
  item:items(id, readable_id, name, status, shopify_admin_url, shopify_product_id, shopify_variant_id)
`

// Well beyond how long a routine catalog scan should ever take, and beyond
// Supabase's own Edge Function execution ceiling — a run still "running"
// past this has almost certainly crashed or been killed server-side before
// it could write its own failure status, not genuinely still working.
const STALE_RUN_MS = 10 * 60 * 1000

// Polls while a run is in flight so the "check is running" indicator
// (Layout) and the Actionable tab's last-run summary clear themselves as
// soon as it finishes, without staff having to refresh.
export function useLatestReconciliationRun() {
  return useQuery({
    queryKey: ['reconciliation-run', 'latest'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reconciliation_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      const run = data as ReconciliationRun | null

      if (run && run.status === 'running' && Date.now() - new Date(run.started_at).getTime() > STALE_RUN_MS) {
        const timedOut: ReconciliationRun = {
          ...run,
          status: 'failed',
          finished_at: run.finished_at ?? new Date().toISOString(),
          error: 'Timed out — no response after 10+ minutes, treated as failed so a new check can be triggered.',
        }
        // Best-effort — persists the correction so the row doesn't sit
        // looking permanently "running" to anyone querying it directly
        // (SQL editor, etc). A write failure here shouldn't block the UI
        // from unblocking itself; the value returned below already
        // reflects the correction either way.
        void supabase
          .from('reconciliation_runs')
          .update({ status: timedOut.status, finished_at: timedOut.finished_at, error: timedOut.error })
          .eq('id', run.id)
          .then(({ error: updateErr }) => {
            if (updateErr) console.error('[useLatestReconciliationRun] failed to mark stale run as failed', updateErr)
          })
        return timedOut
      }

      return run
    },
    refetchInterval: query => (query.state.data?.status === 'running' ? 3000 : false),
  })
}

export function useOpenDiscrepancies() {
  return useQuery({
    queryKey: ['shopify-discrepancies', 'open'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shopify_discrepancies')
        .select(DISCREPANCY_SELECT)
        .is('resolved_at', null)
        .order('detected_at', { ascending: false })
      if (error) throw error
      return data as unknown as ShopifyDiscrepancy[]
    },
  })
}

export function useTriggerReconciliation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await invokeEdgeFunction('shopify-reconcile', {})
      if (error) throw new Error(error)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reconciliation-run'] })
      qc.invalidateQueries({ queryKey: ['shopify-discrepancies'] })
      // The run also writes item_logs entries for anything it auto-fixed
      // (Draft/Live sync, auto-resolved discrepancies) — without this, the
      // Actionable tab's "Recently Auto-Resolved" feed would only refresh
      // on the next unrelated item_logs invalidation elsewhere in the app.
      qc.invalidateQueries({ queryKey: ['item_logs'] })
    },
  })
}

export function useResolveDiscrepancy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ItemStatus }) => {
      const { error } = await supabase
        .from('shopify_discrepancies')
        .update({ resolved_at: new Date().toISOString(), resolved_status: status, auto_resolved: false })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shopify-discrepancies'] })
    },
  })
}

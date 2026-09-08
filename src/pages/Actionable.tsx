import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Layout from '../components/layout/Layout'
import Modal from '../components/ui/Modal'
import Confirm from '../components/ui/Confirm'
import Spinner from '../components/ui/Spinner'
import ItemForm from '../components/inventory/ItemForm'
import { supabase } from '../lib/supabase'
import { STATUS_CONFIG } from '../lib/constants'
import { writeItemLog } from '../lib/itemLog'
import { getMissingFields, hasPriorityMissing } from '../lib/itemCompleteness'
import { useItems, useItemMutations } from '../hooks/useItems'
import { useItemLogs } from '../hooks/useItemLogs'
import {
  useLatestReconciliationRun,
  useOpenDiscrepancies,
  useTriggerReconciliation,
  useResolveDiscrepancy,
} from '../hooks/useReconciliation'
import {
  useOpenStoreCreditDiscrepancies,
  useResolveStoreCreditDiscrepancy,
  useStoreCreditLiability,
  useShopifyCustomers,
  type ShopifyCustomerInfo,
} from '../hooks/useStoreCredit'
import type { Item, ItemLog, ItemStatus, ShopifyDiscrepancy, StoreCreditDiscrepancy } from '../types'

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.round(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function shopifyStateLabel(qty: number | null): string {
  if (qty == null) return 'Unknown'
  return qty > 0 ? `Active (qty ${qty})` : 'Sold out'
}

function ListingMissingRow({ discrepancy }: { discrepancy: ShopifyDiscrepancy }) {
  const { unbindShopify, remove } = useItemMutations()
  const resolveDiscrepancy = useResolveDiscrepancy()
  const [unbinding, setUnbinding] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unbind = async () => {
    setUnbinding(true); setError(null)
    try {
      await unbindShopify.mutateAsync(discrepancy.item_id)
      // resolved_status doesn't mean "confirmed status" here the way it
      // does for a sold_status discrepancy — there's nothing to confirm,
      // just a record that this one was handled and how.
      await resolveDiscrepancy.mutateAsync({ id: discrepancy.id, status: discrepancy.ugis_status })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unbind')
    } finally {
      setUnbinding(false)
    }
  }

  const deleteItem = async () => {
    setDeleting(true); setError(null)
    try {
      // No need to also resolve the discrepancy row — it cascades away
      // with the item (shopify_discrepancies.item_id references items
      // on delete cascade).
      await remove.mutateAsync(discrepancy.item_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  const busy = unbinding || deleting

  return (
    <div className="px-4 py-3 border-b border-border last:border-b-0">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-white font-medium">
            {discrepancy.item?.name ?? 'Unknown item'}
            <span className="ml-2 text-xs font-mono text-gray-500">{discrepancy.item?.readable_id}</span>
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            <span className="text-amber-400">Shopify listing no longer exists</span> — likely deleted directly in
            Shopify admin. UGIS still shows it as linked.
            {' · '}
            detected {timeAgo(discrepancy.detected_at)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button className="btn-ghost py-1 px-2 text-xs text-red-400 hover:text-red-300" disabled={busy} onClick={() => setConfirmingDelete(true)}>
            Delete Item
          </button>
          <button className="btn-primary py-1 px-2 text-xs" disabled={busy} onClick={() => void unbind()}>
            {unbinding ? 'Unbinding…' : 'Unbind Shopify Link'}
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

      <Confirm
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => deleteItem()}
        title="Delete Item"
        message={`Permanently delete "${discrepancy.item?.name ?? 'this item'}" from UGIS? The Shopify listing is already gone — this only affects UGIS's own record, and cannot be undone.`}
        danger
      />
    </div>
  )
}

function DiscrepancyRow({ discrepancy }: { discrepancy: ShopifyDiscrepancy }) {
  const { updateStatus, forceSyncShopifyStatus } = useItemMutations()
  const resolveDiscrepancy = useResolveDiscrepancy()
  const currentStatus = discrepancy.item?.status ?? discrepancy.ugis_status
  const [chosenStatus, setChosenStatus] = useState<ItemStatus>(currentStatus)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (discrepancy.kind === 'listing_missing') return <ListingMissingRow discrepancy={discrepancy} />

  const confirm = async () => {
    setConfirming(true); setError(null)
    try {
      if (chosenStatus !== currentStatus) {
        await updateStatus.mutateAsync({ id: discrepancy.item_id, status: chosenStatus })
      } else {
        // Staff confirmed UGIS was already right — Shopify is the side that
        // drifted, so push a correction there explicitly. A same-status
        // updateStatus call wouldn't do this: its sync only fires on an
        // actual UGIS-side transition, so without this the mismatch would
        // just reopen on the next reconciliation run.
        await forceSyncShopifyStatus.mutateAsync({
          status: chosenStatus,
          shopifyProductId: discrepancy.item?.shopify_product_id ?? null,
          shopifyVariantId: discrepancy.item?.shopify_variant_id ?? null,
        })
        await writeItemLog({
          item_id: discrepancy.item_id,
          item_name: discrepancy.item?.name ?? discrepancy.item_id,
          field_changes: { _action: { from: null, to: 'discrepancy_resolution' } },
          snapshot_before: {},
        })
      }
      await resolveDiscrepancy.mutateAsync({ id: discrepancy.id, status: chosenStatus })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="px-4 py-3 border-b border-border last:border-b-0">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-white font-medium">
            {discrepancy.item?.name ?? 'Unknown item'}
            <span className="ml-2 text-xs font-mono text-gray-500">{discrepancy.item?.readable_id}</span>
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            Shopify: <span className="text-gray-300">{shopifyStateLabel(discrepancy.shopify_available_quantity)}</span>
            {' · '}
            UGIS: <span className="text-gray-300">{STATUS_CONFIG[discrepancy.ugis_status]?.label ?? discrepancy.ugis_status}</span>
            {' · '}
            detected {timeAgo(discrepancy.detected_at)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            className="input text-xs py-1"
            value={chosenStatus}
            onChange={e => setChosenStatus(e.target.value as ItemStatus)}
          >
            {(Object.entries(STATUS_CONFIG) as [ItemStatus, { label: string }][]).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <button className="btn-primary py-1 px-2 text-xs" disabled={confirming} onClick={() => void confirm()}>
            {confirming ? 'Confirming…' : 'Confirm'}
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  )
}

function StoreCreditDiscrepancyRow({ discrepancy, customer, customerLookupFailed }: {
  discrepancy: StoreCreditDiscrepancy
  customer: ShopifyCustomerInfo | undefined
  customerLookupFailed: boolean
}) {
  const resolve = useResolveStoreCreditDiscrepancy()
  const [resolving, setResolving] = useState(false)

  const markReviewed = async () => {
    setResolving(true)
    try {
      await resolve.mutateAsync(discrepancy.id)
    } finally {
      setResolving(false)
    }
  }

  return (
    <div className="px-4 py-3 border-b border-border last:border-b-0">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          {customer ? (
            <>
              <p className="text-sm text-white font-medium">
                {customer.displayName}
                {customer.email && <span className="ml-2 text-xs font-normal text-gray-500">{customer.email}</span>}
              </p>
              <p className="text-xs font-mono text-gray-600 mt-0.5">{discrepancy.shopify_customer_id}</p>
            </>
          ) : (
            <p className="text-sm text-white font-medium font-mono">
              {discrepancy.shopify_customer_id}
              {customerLookupFailed && (
                <span className="ml-2 text-xs font-sans font-normal text-gray-600">(couldn't reach Shopify for name/email)</span>
              )}
            </p>
          )}
          <p className="text-xs text-gray-500 mt-0.5">
            UGIS ledger: <span className="text-gray-300">${discrepancy.ugis_balance.toFixed(2)}</span>
            {' · '}
            Shopify balance: <span className="text-gray-300">${discrepancy.shopify_balance.toFixed(2)}</span>
            {' · '}
            detected {timeAgo(discrepancy.detected_at)}
            {customer && (
              <>
                {' · '}
                <a href={customer.adminUrl} target="_blank" rel="noreferrer" className="text-gray-300 hover:text-white transition-colors">
                  View on Shopify →
                </a>
              </>
            )}
          </p>
        </div>
        <button className="btn-ghost py-1 px-2 text-xs shrink-0" disabled={resolving} onClick={() => void markReviewed()}>
          {resolving ? 'Marking…' : 'Mark Reviewed'}
        </button>
      </div>
    </div>
  )
}

function StoreCreditSection() {
  const { data: discrepancies = [], isLoading } = useOpenStoreCreditDiscrepancies()
  const { data: liability } = useStoreCreditLiability()
  const customerIds = useMemo(() => discrepancies.map(d => d.shopify_customer_id), [discrepancies])
  const { data: customersById, isError: customerLookupFailed } = useShopifyCustomers(customerIds)

  return (
    <div>
      <h2 className="text-sm font-medium text-white mb-2">Store Credit</h2>
      <p className="text-xs text-gray-500 mb-3">
        Outstanding liability: <span className="text-gray-300">${(liability ?? 0).toFixed(2)}</span> across UGIS's
        ledger. Balance drift below means UGIS's record disagrees with Shopify's actual reported balance for that
        customer — check directly in Shopify admin and mark reviewed once resolved; this doesn't auto-correct either
        side.
      </p>
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : discrepancies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-600">
            <div className="text-3xl mb-2">✓</div>
            <p className="text-sm">No balance drift — UGIS and Shopify agree.</p>
          </div>
        ) : (
          discrepancies.map(d => (
            <StoreCreditDiscrepancyRow
              key={d.id}
              discrepancy={d}
              customer={customersById?.get(d.shopify_customer_id)}
              customerLookupFailed={!!customerLookupFailed}
            />
          ))
        )}
      </div>
    </div>
  )
}

function IncompleteItemRow({ item, onEdit }: { item: Item; onEdit: (item: Item) => void }) {
  const missing = getMissingFields(item)
  const urgent = hasPriorityMissing(missing)
  return (
    <div className="px-4 py-3 border-b border-border last:border-b-0 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-white font-medium flex items-center gap-1.5 truncate">
          <span className={`${urgent ? 'text-red-500' : 'text-amber-400'} shrink-0`}>⚠</span>
          {item.name}
          <span className="text-xs font-mono text-gray-500 shrink-0">{item.readable_id}</span>
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          Missing:{' '}
          {missing.map((f, i) => (
            <span key={f.key} className={f.priority ? 'text-red-400' : undefined}>
              {f.label}{i < missing.length - 1 ? ', ' : ''}
            </span>
          ))}
        </p>
      </div>
      <button className="btn-ghost py-1 px-2 text-xs shrink-0" onClick={() => onEdit(item)}>Edit</button>
    </div>
  )
}

// Reconciliation writes an item_logs entry for everything it fixes on its
// own (Draft/Live sync, an auto-closed discrepancy) — this surfaces those
// directly on Actionable instead of leaving them buried in a run-summary
// sentence or requiring a trip to the History page to notice.
const AUTO_ACTIONS = new Set(['listing_status_synced', 'discrepancy_auto_resolved'])

function autoCorrectionDetail(log: ItemLog): string {
  const action = log.field_changes['_action']?.to
  if (action === 'listing_status_synced') {
    const nowNeedsFinishing = log.field_changes['shopify_needs_finishing']?.to
    return `Shopify listing status corrected: ${nowNeedsFinishing ? 'Live → Draft' : 'Draft → Live'}`
  }
  if (action === 'discrepancy_auto_resolved') {
    return String(log.field_changes['_detail']?.to ?? 'Discrepancy resolved automatically.')
  }
  return 'Auto-corrected.'
}

function AutoResolvedRow({ log, onDeleted }: { log: ItemLog; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false)

  const deleteOne = async () => {
    setDeleting(true)
    try {
      const { error } = await supabase.from('item_logs').delete().eq('id', log.id)
      if (error) throw error
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="px-4 py-2.5 flex items-start gap-2.5">
      <span className="text-emerald-400 shrink-0 mt-0.5">✓</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs">
          <span className="text-white font-medium">{log.item_name}</span>
          <span className="text-gray-600"> — </span>
          <span className="text-emerald-400">{autoCorrectionDetail(log)}</span>
        </p>
        <p className="text-xs text-gray-600 mt-0.5">{timeAgo(log.changed_at)}</p>
      </div>
      <button
        type="button"
        className="text-gray-600 hover:text-red-400 transition-colors shrink-0 text-xs px-1"
        disabled={deleting}
        onClick={() => void deleteOne()}
        title="Delete this entry"
      >
        {deleting ? '…' : '✕'}
      </button>
    </div>
  )
}

function AutoResolvedSection() {
  const qc = useQueryClient()
  const { data: logs = [] } = useItemLogs()
  const entries = useMemo(
    () => logs.filter(l => AUTO_ACTIONS.has(String(l.field_changes['_action']?.to))),
    [logs],
  )
  const [clearing, setClearing] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const invalidateLogs = () => qc.invalidateQueries({ queryKey: ['item_logs'] })

  const clearAll = async () => {
    setClearing(true)
    try {
      const { error } = await supabase.from('item_logs').delete().in('id', entries.map(e => e.id))
      if (error) throw error
      await invalidateLogs()
    } finally {
      setClearing(false)
    }
  }

  if (entries.length === 0) return null

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 className="text-sm font-medium text-white">Recently Auto-Resolved ({entries.length})</h2>
        <button className="btn-ghost text-xs shrink-0" disabled={clearing} onClick={() => setConfirmingClear(true)}>
          Clear
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Fixed automatically by the reconciliation check — no action needed, shown here so it isn't invisible.
      </p>
      <div className="card overflow-hidden">
        <div className="max-h-80 overflow-y-auto divide-y divide-border">
          {entries.map(log => (
            <AutoResolvedRow key={log.id} log={log} onDeleted={invalidateLogs} />
          ))}
        </div>
      </div>

      <Confirm
        open={confirmingClear}
        onClose={() => setConfirmingClear(false)}
        onConfirm={() => clearAll()}
        title="Clear Auto-Resolved Log"
        message={`Permanently delete ${entries.length} auto-resolved log entr${entries.length === 1 ? 'y' : 'ies'}? This only clears this list — it doesn't undo any of the corrections themselves.`}
      />
    </div>
  )
}

function IncompleteItemsSection() {
  const { data: items = [], isLoading } = useItems()
  const [editing, setEditing] = useState<Item | null>(null)
  const incompleteItems = useMemo(() => {
    return items
      .map(item => ({ item, missing: getMissingFields(item) }))
      .filter(({ missing }) => missing.length > 0)
      .sort((a, b) => Number(hasPriorityMissing(b.missing)) - Number(hasPriorityMissing(a.missing)))
      .map(({ item }) => item)
  }, [items])

  return (
    <div>
      <h2 className="text-sm font-medium text-white mb-2">
        Incomplete Items {incompleteItems.length > 0 && `(${incompleteItems.length})`}
      </h2>
      <p className="text-xs text-gray-500 mb-3">
        Items missing a selling price, consignee, or the applicable cost / take-back price — easy to miss when
        an item is added quickly and finished off later. Items missing payment info (selling price, cost /
        take-back, or card fee) are flagged <span className="text-red-400">red</span> and sorted to the top.
      </p>
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : incompleteItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-600">
            <div className="text-3xl mb-2">✓</div>
            <p className="text-sm">Nothing incomplete — every item has its key fields filled in.</p>
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {incompleteItems.map(item => <IncompleteItemRow key={item.id} item={item} onEdit={setEditing} />)}
          </div>
        )}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit Item" wide>
        {editing && <ItemForm item={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  )
}

export default function Actionable() {
  const { data: latestRun } = useLatestReconciliationRun()
  const { data: discrepancies = [], isLoading } = useOpenDiscrepancies()
  const trigger = useTriggerReconciliation()

  const running = latestRun?.status === 'running'

  return (
    <Layout>
      <div className="px-4 md:px-6 py-5 max-w-3xl mx-auto w-full space-y-5">
        <div>
          <h1 className="text-lg font-semibold text-white mb-1">Actionable</h1>
          <p className="text-xs text-gray-500">
            Everything that needs a staff decision — Shopify/UGIS mismatches and items missing key data.
          </p>
        </div>

        <div>
          <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
            <h2 className="text-sm font-medium text-white">Shopify Discrepancies</h2>
            <button
              className="btn-ghost text-xs shrink-0"
              disabled={running || trigger.isPending}
              onClick={() => void trigger.mutate()}
            >
              {running || trigger.isPending ? 'Running…' : 'Run check now'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Two kinds show up here: UGIS's status disagreeing with Shopify's live inventory (usually a failed sync
            step or a manual edit made directly in Shopify — confirm which side was right, nothing resolves itself),
            and a linked Shopify listing that's been deleted entirely (unbind it to clear the stale link). Draft vs.
            Live listing status is checked too, but that one has a clear right answer, so it's auto-corrected rather
            than listed below.
          </p>

          <div className="text-xs text-gray-600 mb-3">
            {running && (
              <span className="flex items-center gap-1.5 text-amber-400">
                <Spinner size="sm" /> Check in progress — this can take a minute on a large catalog.
              </span>
            )}
            {!running && latestRun?.status === 'completed' && (
              <span>
                Last run {timeAgo(latestRun.finished_at ?? latestRun.started_at)} — scanned {latestRun.items_scanned ?? 0} linked
                item{latestRun.items_scanned === 1 ? '' : 's'}, flagged {latestRun.discrepancies_opened ?? 0}, auto-resolved{' '}
                {latestRun.discrepancies_closed ?? 0}
                {!!latestRun.listing_statuses_synced && `, corrected ${latestRun.listing_statuses_synced} Draft/Live status${latestRun.listing_statuses_synced === 1 ? '' : 'es'}`}
                {!!latestRun.credit_customers_checked && `, checked store credit for ${latestRun.credit_customers_checked} customer${latestRun.credit_customers_checked === 1 ? '' : 's'}`}.
              </span>
            )}
            {!running && latestRun?.status === 'failed' && (
              <span className="text-red-400">Last run failed{latestRun.error ? `: ${latestRun.error}` : '.'}</span>
            )}
            {!latestRun && <span>No reconciliation runs yet.</span>}
          </div>

          <div className="card overflow-hidden">
            {isLoading ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : discrepancies.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-600">
                <div className="text-3xl mb-2">✓</div>
                <p className="text-sm">Nothing to review — UGIS and Shopify agree.</p>
              </div>
            ) : (
              discrepancies.map(d => <DiscrepancyRow key={d.id} discrepancy={d} />)
            )}
          </div>
        </div>

        <StoreCreditSection />

        <AutoResolvedSection />

        <IncompleteItemsSection />
      </div>
    </Layout>
  )
}

import { useMemo, useState } from 'react'
import Layout from '../components/layout/Layout'
import Modal from '../components/ui/Modal'
import Spinner from '../components/ui/Spinner'
import ItemForm from '../components/inventory/ItemForm'
import { STATUS_CONFIG } from '../lib/constants'
import { writeItemLog } from '../lib/itemLog'
import { getMissingFields } from '../lib/itemCompleteness'
import { useItems, useItemMutations } from '../hooks/useItems'
import {
  useLatestReconciliationRun,
  useOpenDiscrepancies,
  useTriggerReconciliation,
  useResolveDiscrepancy,
} from '../hooks/useReconciliation'
import type { Item, ItemStatus, ShopifyDiscrepancy } from '../types'

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

function DiscrepancyRow({ discrepancy }: { discrepancy: ShopifyDiscrepancy }) {
  const { updateStatus, forceSyncShopifyStatus } = useItemMutations()
  const resolveDiscrepancy = useResolveDiscrepancy()
  const currentStatus = discrepancy.item?.status ?? discrepancy.ugis_status
  const [chosenStatus, setChosenStatus] = useState<ItemStatus>(currentStatus)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

function IncompleteItemRow({ item, onEdit }: { item: Item; onEdit: (item: Item) => void }) {
  const missing = getMissingFields(item)
  return (
    <div className="px-4 py-3 border-b border-border last:border-b-0 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-white font-medium flex items-center gap-1.5 truncate">
          <span className="text-amber-400 shrink-0">⚠</span>
          {item.name}
          <span className="text-xs font-mono text-gray-500 shrink-0">{item.readable_id}</span>
        </p>
        <p className="text-xs text-gray-500 mt-0.5">Missing: {missing.map(f => f.label).join(', ')}</p>
      </div>
      <button className="btn-ghost py-1 px-2 text-xs shrink-0" onClick={() => onEdit(item)}>Edit</button>
    </div>
  )
}

function IncompleteItemsSection() {
  const { data: items = [], isLoading } = useItems()
  const [editing, setEditing] = useState<Item | null>(null)
  const incompleteItems = useMemo(() => items.filter(i => getMissingFields(i).length > 0), [items])

  return (
    <div>
      <h2 className="text-sm font-medium text-white mb-2">
        Incomplete Items {incompleteItems.length > 0 && `(${incompleteItems.length})`}
      </h2>
      <p className="text-xs text-gray-500 mb-3">
        Items missing a selling price, consignee, or the applicable cost / take-back price — easy to miss when
        an item is added quickly and finished off later.
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
          incompleteItems.map(item => <IncompleteItemRow key={item.id} item={item} onEdit={setEditing} />)
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
            Items where UGIS's status and Shopify's live inventory disagree — usually a failed sync step or a
            manual edit made directly in Shopify. Confirm which side was right; nothing here resolves itself.
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
                {latestRun.discrepancies_closed ?? 0}.
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

        <IncompleteItemsSection />
      </div>
    </Layout>
  )
}

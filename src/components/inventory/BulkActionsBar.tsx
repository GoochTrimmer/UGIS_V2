import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { updateItemStatus, deleteItem, pushItemShopifyDraft } from '../../hooks/useItems'
import { STATUS_CONFIG, SALE_CHANNEL_CONFIG, SALE_GEOGRAPHY_CONFIG, PAYMENT_TYPE_CONFIG, paymentTypeHasFee } from '../../lib/constants'
import Modal from '../ui/Modal'
import Confirm from '../ui/Confirm'
import type { Item, ItemStatus, SaleChannel, SaleGeography, PaymentType } from '../../types'

interface BulkActionsBarProps {
  selectedItems: Item[]
  onClear: () => void
}

interface BulkResult {
  succeeded: number
  failed: { label: string; error: string }[]
}

// Runs sequentially rather than in parallel — several of these actions
// (pushing Shopify drafts especially) hit the Shopify API per item, and
// firing a whole batch at once risks tripping its rate limits. Sequential
// also makes the "N/M done" progress readout meaningful.
async function runSequential(
  items: Item[],
  fn: (item: Item) => Promise<void>,
  onProgress: (done: number, total: number) => void,
): Promise<BulkResult> {
  const failed: BulkResult['failed'] = []
  let succeeded = 0
  for (let i = 0; i < items.length; i++) {
    try {
      await fn(items[i])
      succeeded++
    } catch (err) {
      failed.push({ label: items[i].readable_id, error: err instanceof Error ? err.message : 'Failed' })
    }
    onProgress(i + 1, items.length)
  }
  return { succeeded, failed }
}

function ResultSummary({ result }: { result: BulkResult }) {
  if (result.failed.length === 0) {
    return <p className="text-xs text-emerald-400">Updated {result.succeeded} item{result.succeeded === 1 ? '' : 's'}.</p>
  }
  return (
    <div className="text-xs">
      <p className="text-amber-400">{result.succeeded} succeeded, {result.failed.length} failed:</p>
      <ul className="text-red-400 mt-0.5 space-y-0.5">
        {result.failed.map(f => <li key={f.label}>{f.label}: {f.error}</li>)}
      </ul>
    </div>
  )
}

export default function BulkActionsBar({ selectedItems, onClear }: BulkActionsBarProps) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<ItemStatus>('in_stock')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<BulkResult | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [soldDetailsOpen, setSoldDetailsOpen] = useState(false)
  const [saleChannel, setSaleChannel] = useState<SaleChannel | ''>('')
  const [saleGeography, setSaleGeography] = useState<SaleGeography | ''>('')
  const [paymentType, setPaymentType] = useState<PaymentType | ''>('')
  const [cardFee, setCardFee] = useState('')

  const count = selectedItems.length
  const unlinkedItems = selectedItems.filter(i => !i.shopify_product_id)
  const linkedCount = count - unlinkedItems.length

  // Items already at the chosen status are left out of every status-change
  // action entirely — no point spending a write (and a row in the results
  // list) confirming something that's already true.
  const itemsNeedingStatus = selectedItems.filter(i => i.status !== status)
  const alreadyAtStatus = count - itemsNeedingStatus.length

  // Goes straight through the raw write functions rather than the
  // useMutation-wrapped versions, and invalidates the cache ONCE here after
  // the whole batch settles — not after every individual item. Each
  // mutation hook's own onSuccess would otherwise fire (and refetch) after
  // every single write, which visibly fades the table out and back in
  // between each item as it processes.
  const run = async (fn: (item: Item) => Promise<void>, targets: Item[]) => {
    setBusy(true); setResult(null); setProgress({ done: 0, total: targets.length })
    const res = await runSequential(targets, fn, (done, total) => setProgress({ done, total }))
    setBusy(false); setProgress(null); setResult(res)
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['items'] }),
      qc.invalidateQueries({ queryKey: ['item_logs'] }),
    ])
    if (res.failed.length === 0) onClear()
  }

  const applyStatus = () => void run(item => updateItemStatus({ id: item.id, status }), itemsNeedingStatus)

  const quickMarkSold = () => void run(item => updateItemStatus({ id: item.id, status: 'sold' }), itemsNeedingStatus)

  const applySoldDetails = () => {
    setSoldDetailsOpen(false)
    void run(item => updateItemStatus({
      id: item.id,
      status: 'sold',
      sold_price: item.selling_price ?? null,
      sale_channel: saleChannel || null,
      sale_geography: saleGeography || null,
      payment_type: paymentType || null,
      card_fee: paymentTypeHasFee(paymentType) && cardFee ? parseFloat(cardFee) : null,
    }), itemsNeedingStatus)
  }

  // Skipped items (already linked) never enter the loop at all, so they
  // can't show up as spurious "failures" in the result summary.
  const pushDrafts = () => void run(async item => { await pushItemShopifyDraft(item.id) }, unlinkedItems)

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 w-max max-w-[98vw] bg-surface-1 border border-indigo-500/40 rounded-xl shadow-2xl px-2.5 sm:px-3 py-2.5 flex flex-col gap-2">
      <div className="flex flex-nowrap items-center gap-2 sm:gap-3">
        {/* Everything except Delete lives in this scrollable strip — its
            width grows with 3-digit counts and long labels, but Delete
            stays pinned outside it so a big selection can never push it
            out of view. */}
        <div className="flex flex-nowrap items-center gap-2 sm:gap-3 overflow-x-auto min-w-0">
          <span className="text-xs text-gray-300 font-medium shrink-0">{count} <span className="hidden sm:inline">selected</span></span>
          <button type="button" className="text-xs text-gray-500 hover:text-white transition-colors shrink-0" onClick={onClear} disabled={busy}>
            Clear
          </button>

          <div className="w-px h-4 bg-indigo-500/30 shrink-0" />

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="hidden sm:inline text-xs text-gray-500">Set status to</span>
            <select className="input text-xs py-1" value={status} onChange={e => setStatus(e.target.value as ItemStatus)} disabled={busy}>
              {(Object.entries(STATUS_CONFIG) as [ItemStatus, { label: string }][]).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            {status === 'sold' ? (
              <>
                <button
                  type="button"
                  className="btn-ghost py-1 px-2 text-xs whitespace-nowrap"
                  disabled={busy || itemsNeedingStatus.length === 0}
                  onClick={quickMarkSold}
                >
                  <span className="hidden sm:inline">Quick Mark </span>Sold ({itemsNeedingStatus.length})
                </button>
                <button
                  type="button"
                  className="btn-ghost py-1 px-2 text-xs whitespace-nowrap"
                  disabled={busy || itemsNeedingStatus.length === 0}
                  onClick={() => setSoldDetailsOpen(true)}
                >
                  <span className="hidden sm:inline">Mark Sold — </span>Details…
                </button>
              </>
            ) : (
              <button type="button" className="btn-primary py-1 px-2 text-xs whitespace-nowrap" disabled={busy || itemsNeedingStatus.length === 0} onClick={applyStatus}>
                Apply<span className="hidden sm:inline"> to</span> {itemsNeedingStatus.length}
              </button>
            )}
            {alreadyAtStatus > 0 && (
              <span className="hidden sm:inline text-xs text-gray-600 whitespace-nowrap" title="These are skipped — no change needed">
                ({alreadyAtStatus} already {STATUS_CONFIG[status].label.toLowerCase()})
              </span>
            )}
          </div>

          <div className="w-px h-4 bg-indigo-500/30 shrink-0" />

          <button
            type="button"
            className="btn-ghost py-1 px-2 text-xs shrink-0 whitespace-nowrap"
            disabled={busy || unlinkedItems.length === 0}
            title={unlinkedItems.length === 0 ? 'All selected items are already linked to Shopify' : undefined}
            onClick={pushDrafts}
          >
            <span className="hidden sm:inline">
              Push {unlinkedItems.length < count ? `${unlinkedItems.length} unlinked` : 'to'} Shopify Draft
            </span>
            <span className="sm:hidden">Draft ({unlinkedItems.length})</span>
          </button>

          {busy && progress && (
            <span className="text-xs text-gray-500 shrink-0 whitespace-nowrap">
              <span className="hidden sm:inline">Working… </span>{progress.done}/{progress.total}
            </span>
          )}
        </div>

        <div className="w-px h-4 bg-indigo-500/30 shrink-0" />

        <button type="button" className="btn-ghost py-1 px-2 text-xs text-red-400 hover:text-red-300 shrink-0" disabled={busy} onClick={() => setDeleting(true)}>
          Delete
        </button>
      </div>

      {result && <ResultSummary result={result} />}

      <Modal open={soldDetailsOpen} onClose={() => setSoldDetailsOpen(false)} title={`Mark ${itemsNeedingStatus.length} Items Sold`}>
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Applied to {itemsNeedingStatus.length} of the {count} selected items — sold price defaults to each item's own
            listed price. {alreadyAtStatus > 0 && `${alreadyAtStatus} already sold ${alreadyAtStatus === 1 ? 'is' : 'are'} skipped.`}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Sale Channel</label>
              <select className="input" value={saleChannel} onChange={e => setSaleChannel(e.target.value as SaleChannel | '')}>
                <option value="">— unknown —</option>
                {(Object.entries(SALE_CHANNEL_CONFIG) as [SaleChannel, { label: string }][]).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Geography</label>
              <select className="input" value={saleGeography} onChange={e => setSaleGeography(e.target.value as SaleGeography | '')}>
                <option value="">— unknown —</option>
                {(Object.entries(SALE_GEOGRAPHY_CONFIG) as [SaleGeography, { label: string }][]).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Payment Type</label>
              <select className="input" value={paymentType} onChange={e => setPaymentType(e.target.value as PaymentType | '')}>
                <option value="">— unknown —</option>
                {(Object.entries(PAYMENT_TYPE_CONFIG) as [PaymentType, { label: string }][]).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            {paymentTypeHasFee(paymentType) && (
              <div>
                <label className="label">Fee (applied to each item)</label>
                <input className="input" type="number" step="0.01" value={cardFee} onChange={e => setCardFee(e.target.value)} placeholder="0.00" />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setSoldDetailsOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={itemsNeedingStatus.length === 0} onClick={applySoldDetails}>
              Mark {itemsNeedingStatus.length} Sold
            </button>
          </div>
        </div>
      </Modal>

      <Confirm
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => run(item => deleteItem(item.id), selectedItems)}
        title="Delete Items"
        message={
          linkedCount > 0
            ? `Delete ${count} items? This cannot be undone. ${linkedCount} of them are linked to Shopify listings — those listings won't be touched; delete or unlink them individually via Edit first if you want them removed from Shopify too.`
            : `Delete ${count} items? This cannot be undone.`
        }
        danger
      />
    </div>
  )
}

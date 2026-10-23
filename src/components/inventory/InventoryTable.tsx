import { useEffect, useMemo, useState } from 'react'
import { useMutationState } from '@tanstack/react-query'
import { formatSeason } from '../../lib/idGenerator'
import { SHOPIFY_LINKING_KEY } from '../../hooks/useItems'
import StatusMenu from './StatusMenu'
import Modal from '../ui/Modal'
import ItemForm from './ItemForm'
import DeleteItemDialog from './DeleteItemDialog'
import ShopifyStatusDot from './ShopifyStatusDot'
import BulkActionsBar from './BulkActionsBar'
import { STATUS_CONFIG } from '../../lib/constants'
import type { Item, ItemStatus } from '../../types'
import type { SortState } from './sortState'
import { shopifyStatusOf } from './sortState'
import { isIncomplete, getMissingFields, hasPriorityMissing } from '../../lib/itemCompleteness'

function usePendingShopifyLinkIds(): Set<string> {
  const pending = useMutationState({
    filters: { mutationKey: SHOPIFY_LINKING_KEY, status: 'pending' },
    select: m => (m.state.variables as { itemId?: string } | undefined)?.itemId,
  })
  return new Set(pending.filter((id): id is string => !!id))
}

interface InventoryTableProps {
  items: Item[]
  sort: SortState
  onSortChange: (updater: SortState | ((prev: SortState) => SortState)) => void
  bulkMode: boolean
  missingListingIds: Set<string>
  batchCounts: Map<string, { total: number; inStock: number }>
}

// "4 of 6 in stock" badge for a multi-quantity item — see batch_id (migration
// 017) and ItemForm's Qty field. Only rendered when an item actually has
// siblings; a lone row with a stale/unmatched batch_id renders nothing.
function BatchBadge({ item, batchCounts }: { item: Item; batchCounts: InventoryTableProps['batchCounts'] }) {
  if (!item.batch_id) return null
  const counts = batchCounts.get(item.batch_id)
  if (!counts || counts.total < 2) return null
  return (
    <span
      className="text-[10px] font-semibold bg-surface-3 text-gray-400 rounded-full px-1.5 py-0.5 leading-none shrink-0"
      title={`${counts.total} units added together — ${counts.inStock} still in stock`}
    >
      {counts.inStock}/{counts.total} in stock
    </span>
  )
}

// Rounder, larger, neutral-gray checkbox — reads as a deliberate UI
// control rather than a bare browser default.
const checkboxClass =
  'w-4 h-4 rounded-lg border-2 border-gray-500 bg-surface-2 accent-gray-400 cursor-pointer transition-colors hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400/50'

function fmt(amount: number | null | undefined): string {
  if (amount == null) return 'N/A'
  return new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', maximumFractionDigits: 0 }).format(amount)
}

function priceOf(item: Item): number {
  return (item.status === 'sold' && item.sold_price != null ? item.sold_price : item.selling_price) ?? 0
}

function costOf(item: Item): number {
  return (item.consignee && !item.consignee.is_default_store ? item.takeback_price : item.cost_amount) ?? 0
}

// Value shared by every member of a group, or null if it isn't uniform
// (e.g. one unit's selling price was edited after a restock) — used so a
// collapsed group row shows a real number when it can, and an honest
// "varies" rather than an arbitrary one member's value when it can't.
function uniformValue<T>(items: Item[], get: (i: Item) => T): T | null {
  const first = get(items[0])
  return items.every(i => get(i) === first) ? first : null
}

// Small funnel glyph shown on an unsorted sortable column, so it reads as
// "click to filter/sort" rather than a plain label — swaps for a ▲/▼ once
// that column is actually driving the sort.
function SortIcon({ direction }: { direction: 'asc' | 'desc' | null }) {
  if (direction === 'asc') return <span className="text-[9px] leading-none">▲</span>
  if (direction === 'desc') return <span className="text-[9px] leading-none">▼</span>
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" className="opacity-50 shrink-0">
      <path d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5L2 3z" fill="currentColor" />
    </svg>
  )
}

function SortableHeader({ label, active, dir, onClick }: {
  label: string
  active: boolean
  dir: 'asc' | 'desc'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 ml-auto transition-colors ${active ? 'text-white' : 'text-gray-600 hover:text-gray-300'}`}
    >
      {label}
      <SortIcon direction={active ? dir : null} />
    </button>
  )
}

type Row =
  | { kind: 'single'; item: Item }
  | { kind: 'group'; batchId: string; items: Item[] }

// Groups CONSECUTIVE items sharing a batch_id into one collapsible row —
// deliberately not a full regroup-by-batch-id-anywhere, since that would
// fight whatever sort/filter is active. The default sort (newest first)
// keeps a just-created batch's units adjacent, which covers the common
// case; under another sort or a status filter that splits a batch across
// tabs, its members just render as ordinary single rows instead.
function groupRows(items: Item[]): Row[] {
  const rows: Row[] = []
  let i = 0
  while (i < items.length) {
    const item = items[i]
    if (!item.batch_id) {
      rows.push({ kind: 'single', item })
      i++
      continue
    }
    let j = i + 1
    while (j < items.length && items[j].batch_id === item.batch_id) j++
    const members = items.slice(i, j)
    if (members.length > 1) rows.push({ kind: 'group', batchId: item.batch_id, items: members })
    else rows.push({ kind: 'single', item })
    i = j
  }
  return rows
}

export default function InventoryTable({ items, sort, onSortChange, bulkMode, missingListingIds, batchCounts }: InventoryTableProps) {
  const [editing, setEditing] = useState<Item | null>(null)
  const [deleting, setDeleting] = useState<Item | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set())
  // Anchor for shift-click range selection — the last item clicked WITHOUT
  // shift held, same as a spreadsheet's active cell. A shift-click doesn't
  // move this anchor, so repeated shift-clicks extend/shrink from the same
  // starting point rather than drifting with each click, matching Excel.
  const [lastClickedId, setLastClickedId] = useState<string | null>(null)
  const pendingShopifyLinkIds = usePendingShopifyLinkIds()

  // Selection only makes sense while the toggle (in Inventory.tsx) is on —
  // clear it on every flip, in either direction.
  useEffect(() => {
    setSelected(new Set())
  }, [bulkMode])

  // Prunes selections that fall out of view — e.g. a filter/tab change
  // hides an item, or its status change moves it off the current tab.
  useEffect(() => {
    setSelected(prev => {
      const validIds = new Set(items.map(i => i.id))
      const next = new Set([...prev].filter(id => validIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [items])

  const sortedItems = useMemo(() => {
    if (!sort) return items
    if (sort.field === 'flags') {
      // Items matching MORE of the selected flags rank higher — an item
      // that's both, say, Live and Incomplete outranks one matching only
      // one of the two, rather than tying with it. Within the Incomplete
      // match, items missing a payment field (red ⚠, see itemCompleteness)
      // rank above items only missing non-payment fields (amber ⚠), so a
      // shopify-status match still outweighs it. Ties (equal score) keep
      // their original relative order (stable sort).
      const { shopifyStatuses, incomplete } = sort
      const scoreOf = (item: Item) => {
        let score = 0
        if (shopifyStatuses.length > 0 && shopifyStatuses.includes(shopifyStatusOf(item))) score += 2
        if (incomplete) {
          const missing = getMissingFields(item)
          if (missing.length > 0) score += hasPriorityMissing(missing) ? 2 : 1
        }
        return score
      }
      return [...items].sort((a, b) => scoreOf(b) - scoreOf(a))
    }
    const valueOf = sort.field === 'price' ? priceOf : costOf
    const factor = sort.dir === 'asc' ? 1 : -1
    return [...items].sort((a, b) => factor * (valueOf(a) - valueOf(b)))
  }, [items, sort])

  // Bulk mode skips grouping entirely — selection targets individual
  // rows, and "select a collapsed group" isn't a thing it supports (yet).
  const rows = useMemo(
    () => (bulkMode ? sortedItems.map((item): Row => ({ kind: 'single', item })) : groupRows(sortedItems)),
    [sortedItems, bulkMode],
  )

  const toggleSort = (field: 'price' | 'cost') => {
    onSortChange(prev => {
      if (!prev || prev.field !== field) return { field, dir: 'asc' }
      if (prev.dir === 'asc') return { field, dir: 'desc' }
      return null
    })
  }

  const toggleExpanded = (batchId: string) => {
    setExpandedBatches(prev => {
      const next = new Set(prev)
      if (next.has(batchId)) next.delete(batchId)
      else next.add(batchId)
      return next
    })
  }

  // Plain click toggles just that item and moves the anchor there. Shift-
  // click applies the contiguous range between the anchor and this item
  // (in the table's current sorted order) on top of whatever's already
  // selected — added if the anchor is currently selected, removed if it
  // isn't. That means shift-click can shrink a selection too: click an
  // already-selected item at one edge of a range to deselect it (making
  // it the new, now-unselected anchor), then shift-click the far edge to
  // clear the whole span, without disturbing any selection elsewhere.
  const selectItem = (id: string, shiftKey: boolean) => {
    if (shiftKey && lastClickedId) {
      const from = sortedItems.findIndex(i => i.id === lastClickedId)
      const to = sortedItems.findIndex(i => i.id === id)
      if (from !== -1 && to !== -1) {
        const [start, end] = from < to ? [from, to] : [to, from]
        const addRange = selected.has(lastClickedId)
        setSelected(prev => {
          const next = new Set(prev)
          for (let i = start; i <= end; i++) {
            if (addRange) next.add(sortedItems[i].id)
            else next.delete(sortedItems[i].id)
          }
          return next
        })
        return
      }
    }
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setLastClickedId(id)
  }

  const selectedItems = items.filter(i => selected.has(i.id))

  if (!items.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[20rem] text-gray-600">
        <div className="text-4xl mb-3">◌</div>
        <p className="text-sm">No items found</p>
      </div>
    )
  }

  // One <tr> per item — used both for an ungrouped item and for each
  // member of an expanded group, so every interaction (status change,
  // edit, delete, selection) behaves identically either way.
  const renderDesktopRow = (item: Item, indented: boolean) => (
    <tr
      key={item.id}
      className={`group ${bulkMode ? 'cursor-pointer select-none' : ''} ${
        selected.has(item.id) ? 'bg-indigo-500/20 hover:bg-indigo-500/25' : 'hover:bg-surface-2/50'
      }`}
      onMouseDown={bulkMode ? e => { if (e.shiftKey) e.preventDefault() } : undefined}
      onClick={bulkMode ? e => selectItem(item.id, e.shiftKey) : undefined}
    >
      {bulkMode && (
        <td className="pl-4 pr-1 py-3" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            className={checkboxClass}
            checked={selected.has(item.id)}
            onChange={() => selectItem(item.id, false)}
            onClick={e => {
              if (e.shiftKey) {
                e.preventDefault()
                selectItem(item.id, true)
              }
            }}
          />
        </td>
      )}
      <td className={`px-4 py-3 font-mono text-xs text-gray-400 whitespace-nowrap ${missingListingIds.has(item.id) ? 'line-through opacity-60' : ''}`}>
        <div className={`flex items-center gap-1.5 ${indented ? 'pl-4' : ''}`}>
          {indented && <span className="text-gray-700">└</span>}
          {missingListingIds.has(item.id) ? (
            <span className="text-red-400" title="Shopify listing was deleted — see the Actionable tab">✕</span>
          ) : (
            <ShopifyStatusDot item={item} pending={pendingShopifyLinkIds.has(item.id)} />
          )}
          {isIncomplete(item) && (() => {
            const missing = getMissingFields(item)
            return (
              <span className={hasPriorityMissing(missing) ? 'text-red-500' : 'text-amber-400'} title={`Missing: ${missing.map(f => f.label).join(', ')}`}>⚠</span>
            )
          })()}
          {item.readable_id}
        </div>
      </td>
      <td className="px-4 py-3 max-w-xs">
        <div className="flex items-center gap-1.5">
          <span
            className={`text-white font-medium truncate ${missingListingIds.has(item.id) ? 'line-through opacity-60' : ''}`}
            title={item.name}
          >
            {item.name}
          </span>
          {!indented && <BatchBadge item={item} batchCounts={batchCounts} />}
        </div>
      </td>
      <td className="px-4 py-3 text-xs font-mono text-gray-400">{item.size ?? 'N/A'}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {item.brands.length === 0 && <span className="text-xs text-gray-600">N/A</span>}
          {item.brands.map(b => (
            <span key={b.id} className="text-xs font-mono text-gray-400 bg-surface-3 px-1.5 py-0.5 rounded">{b.abbreviation}</span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-gray-400 font-mono whitespace-nowrap">
        {formatSeason(item.season_year, item.season_period, item.season_custom)}
      </td>
      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
        <StatusMenu itemId={item.id} currentStatus={item.status} sellingPrice={item.selling_price} />
      </td>
      <td className="px-4 py-3 text-xs text-gray-400">{item.consignee?.name ?? 'N/A'}</td>
      <td className="px-4 py-3 text-xs text-gray-500 text-right">
        {item.consignee && !item.consignee.is_default_store
          ? fmt(item.takeback_price)
          : fmt(item.cost_amount)}
      </td>
      <td className="px-4 py-3 text-xs text-right">
        {item.status === 'sold' && item.sold_price != null ? (
          <div>
            <div className="text-white font-medium">{fmt(item.sold_price)}</div>
            {item.sold_price !== item.selling_price && item.selling_price != null && (
              <div className="text-gray-600 line-through">{fmt(item.selling_price)}</div>
            )}
            {item.card_fee != null && (
              <div className="text-red-400/80" title="Card fee">-{fmt(item.card_fee)}</div>
            )}
          </div>
        ) : (
          <span className="text-white font-medium">{fmt(item.selling_price)}</span>
        )}
      </td>
      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
        <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
          <button className="btn-ghost py-1 px-2 text-xs" onClick={() => setEditing(item)}>Edit</button>
          <button className="btn-ghost py-1 px-2 text-xs text-red-400 hover:text-red-300" onClick={() => setDeleting(item)}>Del</button>
        </div>
      </td>
    </tr>
  )

  // Collapsed summary row for a batch — click anywhere to expand. No
  // single status/price exists across the group, so those columns show a
  // breakdown / "varies" rather than picking one member's value.
  const renderDesktopGroup = (batchId: string, members: Item[]) => {
    const expanded = expandedBatches.has(batchId)
    const first = members[0]
    const inStockCount = members.filter(m => m.status === 'in_stock').length
    const statusCounts = new Map<ItemStatus, number>()
    for (const m of members) statusCounts.set(m.status, (statusCounts.get(m.status) ?? 0) + 1)
    const uniformSelling = uniformValue(members, m => m.selling_price)
    const uniformCost = uniformValue(members, m =>
      m.consignee && !m.consignee.is_default_store ? m.takeback_price : m.cost_amount,
    )

    return (
      <>
        <tr
          key={batchId}
          className="group cursor-pointer hover:bg-surface-2/50"
          onClick={() => toggleExpanded(batchId)}
        >
          {bulkMode && <td className="pl-4 pr-1 py-3" />}
          <td className="px-4 py-3 font-mono text-xs text-gray-400 whitespace-nowrap">
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500">{expanded ? '▾' : '▸'}</span>
              {members.length} units
            </div>
          </td>
          <td className="px-4 py-3 max-w-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-white font-medium truncate" title={first.name}>{first.name}</span>
              <BatchBadge item={first} batchCounts={batchCounts} />
            </div>
          </td>
          <td className="px-4 py-3 text-xs font-mono text-gray-400">{first.size ?? 'N/A'}</td>
          <td className="px-4 py-3">
            <div className="flex flex-wrap gap-1">
              {first.brands.map(b => (
                <span key={b.id} className="text-xs font-mono text-gray-400 bg-surface-3 px-1.5 py-0.5 rounded">{b.abbreviation}</span>
              ))}
            </div>
          </td>
          <td className="px-4 py-3 text-xs text-gray-400 font-mono whitespace-nowrap">
            {formatSeason(first.season_year, first.season_period, first.season_custom)}
          </td>
          <td className="px-4 py-3">
            <div className="flex flex-wrap gap-1">
              {[...statusCounts.entries()].map(([status, count]) => (
                <span key={status} className={`text-[10px] border rounded px-1.5 py-0.5 ${STATUS_CONFIG[status].color}`}>
                  {count} {STATUS_CONFIG[status].label}
                </span>
              ))}
            </div>
          </td>
          <td className="px-4 py-3 text-xs text-gray-400">{first.consignee?.name ?? 'N/A'}</td>
          <td className="px-4 py-3 text-xs text-gray-500 text-right">
            {uniformCost !== null ? fmt(uniformCost) : <span className="text-gray-700">varies</span>}
          </td>
          <td className="px-4 py-3 text-xs text-right">
            {uniformSelling !== null ? (
              <span className="text-white font-medium">{fmt(uniformSelling)}</span>
            ) : (
              <span className="text-gray-700">varies</span>
            )}
          </td>
          <td className="px-4 py-3 text-right text-xs text-gray-600">{inStockCount} in stock</td>
        </tr>
        {expanded && members.map(m => renderDesktopRow(m, true))}
      </>
    )
  }

  const renderMobileCard = (item: Item, indented: boolean) => (
    <div
      key={item.id}
      className={`px-4 py-3 ${indented ? 'pl-8 bg-surface-1/40' : ''} ${bulkMode ? 'cursor-pointer select-none' : ''} ${
        selected.has(item.id) ? 'bg-indigo-500/20 hover:bg-indigo-500/25' : 'hover:bg-surface-2/30'
      }`}
      onMouseDown={bulkMode ? e => { if (e.shiftKey) e.preventDefault() } : undefined}
      onClick={bulkMode ? e => selectItem(item.id, e.shiftKey) : undefined}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        {bulkMode && (
          <input
            type="checkbox"
            className={`${checkboxClass} mt-1 shrink-0`}
            checked={selected.has(item.id)}
            onChange={() => selectItem(item.id, false)}
            onClick={e => {
              e.stopPropagation()
              if (e.shiftKey) {
                e.preventDefault()
                selectItem(item.id, true)
              }
            }}
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="flex items-center gap-1.5">
            <span className={`text-sm font-medium text-white truncate leading-tight ${missingListingIds.has(item.id) ? 'line-through opacity-60' : ''}`}>
              {item.name}
            </span>
            {!indented && <BatchBadge item={item} batchCounts={batchCounts} />}
          </p>
          <p className="text-xs font-mono text-gray-500 leading-tight mt-0.5 flex items-center gap-1.5">
            {missingListingIds.has(item.id) ? (
              <span className="text-red-400" title="Shopify listing was deleted — see the Actionable tab">✕</span>
            ) : (
              <ShopifyStatusDot item={item} pending={pendingShopifyLinkIds.has(item.id)} />
            )}
            {isIncomplete(item) && (() => {
              const missing = getMissingFields(item)
              return (
                <span className={hasPriorityMissing(missing) ? 'text-red-500' : 'text-amber-400'} title={`Missing: ${missing.map(f => f.label).join(', ')}`}>⚠</span>
              )
            })()}
            {item.readable_id}{item.size ? <span className="text-gray-400"> · {item.size}</span> : null}
          </p>
        </div>
        <div onClick={e => e.stopPropagation()}>
          <StatusMenu itemId={item.id} currentStatus={item.status} />
        </div>
      </div>
      <div className="flex gap-2 mt-2" onClick={e => e.stopPropagation()}>
        <button className="btn-ghost py-0.5 px-2 text-xs" onClick={() => setEditing(item)}>Edit</button>
        <button className="btn-ghost py-0.5 px-2 text-xs text-red-400" onClick={() => setDeleting(item)}>Delete</button>
      </div>
    </div>
  )

  const renderMobileGroup = (batchId: string, members: Item[]) => {
    const expanded = expandedBatches.has(batchId)
    const first = members[0]
    const inStockCount = members.filter(m => m.status === 'in_stock').length
    return (
      <div key={batchId}>
        <div className="px-4 py-3 cursor-pointer hover:bg-surface-2/30" onClick={() => toggleExpanded(batchId)}>
          <p className="flex items-center gap-1.5">
            <span className="text-gray-500 text-xs">{expanded ? '▾' : '▸'}</span>
            <span className="text-sm font-medium text-white truncate leading-tight">{first.name}</span>
            <BatchBadge item={first} batchCounts={batchCounts} />
          </p>
          <p className="text-xs font-mono text-gray-500 leading-tight mt-0.5">
            {members.length} units{first.size ? <span className="text-gray-400"> · {first.size}</span> : null} · {inStockCount} in stock
          </p>
        </div>
        {expanded && members.map(m => renderMobileCard(m, true))}
      </div>
    )
  }

  return (
    <>
      {bulkMode && selectedItems.length > 0 && (
        <BulkActionsBar selectedItems={selectedItems} onClear={() => setSelected(new Set())} />
      )}

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-1">
            <tr className="border-b border-border text-left text-xs text-gray-600">
              {bulkMode && <th className="pl-4 pr-1 py-2.5 w-8" />}
              <th className="px-4 py-2.5 font-medium w-28">ID</th>
              <th className="px-4 py-2.5 font-medium">Item</th>
              <th className="px-4 py-2.5 font-medium w-16">Size</th>
              <th className="px-4 py-2.5 font-medium">Brands</th>
              <th className="px-4 py-2.5 font-medium w-20">Season</th>
              <th className="px-4 py-2.5 font-medium w-32">Status</th>
              <th className="px-4 py-2.5 font-medium w-28">Consignee</th>
              <th className="px-4 py-2.5 font-medium w-24 text-right">
                <SortableHeader
                  label="Cost"
                  active={sort?.field === 'cost'}
                  dir={sort?.field === 'cost' ? sort.dir : 'asc'}
                  onClick={() => toggleSort('cost')}
                />
              </th>
              <th className="px-4 py-2.5 font-medium w-24 text-right">
                <SortableHeader
                  label="Price"
                  active={sort?.field === 'price'}
                  dir={sort?.field === 'price' ? sort.dir : 'asc'}
                  onClick={() => toggleSort('price')}
                />
              </th>
              <th className="px-4 py-2.5 font-medium w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(row =>
              row.kind === 'single'
                ? renderDesktopRow(row.item, false)
                : renderDesktopGroup(row.batchId, row.items),
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-border">
        {rows.map(row =>
          row.kind === 'single'
            ? renderMobileCard(row.item, false)
            : renderMobileGroup(row.batchId, row.items),
        )}
      </div>

      {/* Edit modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit Item" wide>
        {editing && <ItemForm item={editing} onDone={() => setEditing(null)} />}
      </Modal>

      {/* Delete confirm — warns about + optionally deletes the linked Shopify listing */}
      <DeleteItemDialog item={deleting} onClose={() => setDeleting(null)} />
    </>
  )
}

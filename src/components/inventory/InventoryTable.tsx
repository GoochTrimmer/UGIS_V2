import { useMemo, useState } from 'react'
import { useMutationState } from '@tanstack/react-query'
import { formatSeason } from '../../lib/idGenerator'
import { SHOPIFY_LINKING_KEY } from '../../hooks/useItems'
import StatusMenu from './StatusMenu'
import Modal from '../ui/Modal'
import ItemForm from './ItemForm'
import DeleteItemDialog from './DeleteItemDialog'
import ShopifyStatusDot from './ShopifyStatusDot'
import type { Item } from '../../types'
import type { SortState } from './sortState'
import { shopifyStatusOf } from './sortState'

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
}

function fmt(amount: number | null | undefined): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', maximumFractionDigits: 0 }).format(amount)
}

function priceOf(item: Item): number {
  return (item.status === 'sold' && item.sold_price != null ? item.sold_price : item.selling_price) ?? 0
}

function costOf(item: Item): number {
  return (item.consignee && !item.consignee.is_default_store ? item.takeback_price : item.cost_amount) ?? 0
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

export default function InventoryTable({ items, sort, onSortChange }: InventoryTableProps) {
  const [editing, setEditing] = useState<Item | null>(null)
  const [deleting, setDeleting] = useState<Item | null>(null)
  const pendingShopifyLinkIds = usePendingShopifyLinkIds()

  const sortedItems = useMemo(() => {
    if (!sort) return items
    if (sort.field === 'shopify_status') {
      // items matching any selected status float to the top, stable otherwise
      const values = sort.values
      return [...items].sort((a, b) => {
        const aMatch = values.includes(shopifyStatusOf(a)) ? 0 : 1
        const bMatch = values.includes(shopifyStatusOf(b)) ? 0 : 1
        return aMatch - bMatch
      })
    }
    const valueOf = sort.field === 'price' ? priceOf : costOf
    const factor = sort.dir === 'asc' ? 1 : -1
    return [...items].sort((a, b) => factor * (valueOf(a) - valueOf(b)))
  }, [items, sort])

  const toggleSort = (field: 'price' | 'cost') => {
    onSortChange(prev => {
      if (!prev || prev.field !== field) return { field, dir: 'asc' }
      if (prev.dir === 'asc') return { field, dir: 'desc' }
      return null
    })
  }

  if (!items.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[20rem] text-gray-600">
        <div className="text-4xl mb-3">◌</div>
        <p className="text-sm">No items found</p>
      </div>
    )
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-1">
            <tr className="border-b border-border text-left text-xs text-gray-600">
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
            {sortedItems.map(item => (
              <tr key={item.id} className="hover:bg-surface-2/50 group">
                <td className="px-4 py-3 font-mono text-xs text-gray-400 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <ShopifyStatusDot item={item} pending={pendingShopifyLinkIds.has(item.id)} />
                    {item.readable_id}
                  </div>
                </td>
                <td className="px-4 py-3 text-white font-medium max-w-xs truncate" title={item.name}>{item.name}</td>
                <td className="px-4 py-3 text-xs font-mono text-gray-400">{item.size ?? '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(item.brands ?? []).map(b => (
                      <span key={b.id} className="text-xs font-mono text-gray-400 bg-surface-3 px-1.5 py-0.5 rounded">{b.abbreviation}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400 font-mono whitespace-nowrap">
                  {formatSeason(item.season_year, item.season_period, item.season_custom)}
                </td>
                <td className="px-4 py-3">
                  <StatusMenu itemId={item.id} currentStatus={item.status} sellingPrice={item.selling_price} />
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">{item.consignee?.name ?? '—'}</td>
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
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="btn-ghost py-1 px-2 text-xs" onClick={() => setEditing(item)}>Edit</button>
                    <button className="btn-ghost py-1 px-2 text-xs text-red-400 hover:text-red-300" onClick={() => setDeleting(item)}>Del</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-border">
        {sortedItems.map(item => (
          <div key={item.id} className="px-4 py-3 hover:bg-surface-2/30">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate leading-tight">{item.name}</p>
                <p className="text-xs font-mono text-gray-500 leading-tight mt-0.5 flex items-center gap-1.5">
                  <ShopifyStatusDot item={item} pending={pendingShopifyLinkIds.has(item.id)} />
                  {item.readable_id}{item.size ? <span className="text-gray-400"> · {item.size}</span> : null}
                </p>
              </div>
              <StatusMenu itemId={item.id} currentStatus={item.status} />
            </div>
            <div className="flex gap-2 mt-2">
              <button className="btn-ghost py-0.5 px-2 text-xs" onClick={() => setEditing(item)}>Edit</button>
              <button className="btn-ghost py-0.5 px-2 text-xs text-red-400" onClick={() => setDeleting(item)}>Delete</button>
            </div>
          </div>
        ))}
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

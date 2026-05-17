import { useState } from 'react'
import { formatSeason } from '../../lib/idGenerator'
import StatusMenu from './StatusMenu'
import Modal from '../ui/Modal'
import ItemForm from './ItemForm'
import Confirm from '../ui/Confirm'
import { useItemMutations } from '../../hooks/useItems'
import type { Item } from '../../types'

interface InventoryTableProps {
  items: Item[]
}

function fmt(amount: number | null | undefined): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)
}

export default function InventoryTable({ items }: InventoryTableProps) {
  const [editing, setEditing] = useState<Item | null>(null)
  const [deleting, setDeleting] = useState<Item | null>(null)
  const { remove } = useItemMutations()

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
              <th className="px-4 py-2.5 font-medium w-24 text-right">Cost</th>
              <th className="px-4 py-2.5 font-medium w-24 text-right">Price</th>
              <th className="px-4 py-2.5 font-medium w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map(item => (
              <tr key={item.id} className="hover:bg-surface-2/50 group">
                <td className="px-4 py-3 font-mono text-xs text-gray-400 whitespace-nowrap">{item.readable_id}</td>
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
                  <StatusMenu itemId={item.id} currentStatus={item.status} />
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">{item.consignee?.name ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-gray-500 text-right">{fmt(item.cost_amount)}</td>
                <td className="px-4 py-3 text-xs text-white text-right font-medium">{fmt(item.selling_price)}</td>
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
        {items.map(item => (
          <div key={item.id} className="px-4 py-3 hover:bg-surface-2/30">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate leading-tight">{item.name}</p>
                <p className="text-xs font-mono text-gray-500 leading-tight mt-0.5">
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

      {/* Delete confirm */}
      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutateAsync(deleting!.id)}
        title="Delete Item"
        message={`Delete "${deleting?.name}" (${deleting?.readable_id})? This cannot be undone.`}
        danger
      />
    </>
  )
}

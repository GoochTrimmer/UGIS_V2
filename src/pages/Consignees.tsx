import { useState } from 'react'
import { useConsignees, useConsigneeMutations, useConsigneeItemCounts } from '../hooks/useConsignees'
import { useItems } from '../hooks/useItems'
import Layout from '../components/layout/Layout'
import Modal from '../components/ui/Modal'
import SlideOver from '../components/ui/SlideOver'
import ConsigneeForm from '../components/consignees/ConsigneeForm'
import Confirm from '../components/ui/Confirm'
import Spinner from '../components/ui/Spinner'
import { STATUS_CONFIG } from '../lib/constants'
import type { Consignee } from '../types'

function ConsigneePanel({ consignee }: { consignee: Consignee }) {
  const { data: items = [], isLoading } = useItems({ consignee_id: consignee.id })

  const byStatus = items.reduce<Record<string, typeof items>>((acc, item) => {
    ;(acc[item.status] ??= []).push(item)
    return acc
  }, {})

  const statusOrder = ['in_stock', 'reserved', 'on_rental', 'out_for_cleaning', 'returned', 'sold', 'archived']

  return (
    <div className="flex flex-col h-full">
      {/* Consignee meta */}
      <div className="px-5 py-4 border-b border-border space-y-1.5">
        {consignee.contact && (
          <div className="flex gap-2 text-xs">
            <span className="text-gray-600 w-16 shrink-0">Contact</span>
            <span className="text-gray-300">{consignee.contact}</span>
          </div>
        )}
        {consignee.notes && (
          <div className="flex gap-2 text-xs">
            <span className="text-gray-600 w-16 shrink-0">Notes</span>
            <span className="text-gray-400">{consignee.notes}</span>
          </div>
        )}
        {!consignee.contact && !consignee.notes && (
          <p className="text-xs text-gray-700">No contact info recorded.</p>
        )}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {isLoading && <div className="flex justify-center py-10"><Spinner /></div>}

        {!isLoading && items.length === 0 && (
          <p className="text-sm text-gray-600 text-center py-10">No items for this consignee.</p>
        )}

        {!isLoading && items.length > 0 && (
          <div className="space-y-5">
            {statusOrder
              .filter(s => byStatus[s]?.length)
              .map(status => {
                const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]
                const group = byStatus[status]
                return (
                  <div key={status}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs border rounded px-1.5 py-0.5 ${cfg.color}`}>{cfg.label}</span>
                      <span className="text-xs text-gray-700">{group.length}</span>
                    </div>
                    <div className="space-y-px">
                      {group.map(item => (
                        <div key={item.id} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-surface-2 transition-colors">
                          <span className="font-mono text-xs text-gray-600 shrink-0 w-24 truncate">{item.readable_id}</span>
                          <span className="text-xs text-gray-300 flex-1 truncate">{item.name}</span>
                          <div className="flex items-center gap-2 shrink-0 text-right">
                            {item.size && (
                              <span className="text-xs text-gray-600">{item.size}</span>
                            )}
                            {item.selling_price != null && (
                              <span className="text-xs text-gray-400">£{Number(item.selling_price).toFixed(0)}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Consignees() {
  const { data: consignees = [], isLoading } = useConsignees()
  const { remove } = useConsigneeMutations()
  const itemCounts = useConsigneeItemCounts()
  const [viewing, setViewing] = useState<Consignee | null>(null)
  const [editing, setEditing] = useState<Consignee | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<Consignee | null>(null)
  const [search, setSearch] = useState('')

  const filtered = consignees.filter(c =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.abbreviation.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Layout>
      <div className="px-4 md:px-6 py-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-base font-semibold text-white">Consignee Manager</h1>
            <p className="text-xs text-gray-600 mt-0.5">{consignees.length} consignees</p>
          </div>
          <button className="btn-primary" onClick={() => setAdding(true)}>+ New Consignee</button>
        </div>

        <div className="mb-4">
          <input
            className="input w-64"
            placeholder="Search consignees…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="card overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-gray-600 text-left">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium w-20">Abbr.</th>
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  <th className="px-4 py-2.5 font-medium">Notes</th>
                  <th className="px-4 py-2.5 font-medium w-16 text-right">Items</th>
                  <th className="px-4 py-2.5 font-medium w-24" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(c => {
                  const count = itemCounts.get(c.id) ?? 0
                  return (
                    <tr
                      key={c.id}
                      className="hover:bg-surface-2/50 group cursor-pointer"
                      onClick={() => setViewing(c)}
                    >
                      <td className="px-4 py-3 text-white">
                        {c.name}
                        {c.is_default_store && (
                          <span className="ml-2 text-xs text-gray-600 border border-border rounded px-1.5 py-0.5">Store</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{c.abbreviation}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{c.contact ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{c.notes ?? '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-xs font-mono ${count > 0 ? 'text-gray-300' : 'text-gray-700'}`}>{count}</span>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <button className="btn-ghost py-0.5 px-2 text-xs" onClick={() => setEditing(c)}>Edit</button>
                          <button className="btn-ghost py-0.5 px-2 text-xs text-red-400" onClick={() => setDeleting(c)}>Del</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-12 text-gray-600 text-sm">No consignees found</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <SlideOver
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing?.name ?? ''}
        subtitle={`${viewing?.abbreviation ?? ''} · ${itemCounts.get(viewing?.id ?? '') ?? 0} items`}
      >
        {viewing && <ConsigneePanel consignee={viewing} />}
      </SlideOver>

      <Modal open={adding} onClose={() => setAdding(false)} title="New Consignee">
        <ConsigneeForm onDone={() => setAdding(false)} />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit Consignee">
        {editing && <ConsigneeForm consignee={editing} onDone={() => setEditing(null)} />}
      </Modal>
      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutateAsync(deleting!.id)}
        title="Delete Consignee"
        message={`Delete "${deleting?.name}"? Items linked to this consignee will have their consignee cleared.`}
        danger
      />
    </Layout>
  )
}

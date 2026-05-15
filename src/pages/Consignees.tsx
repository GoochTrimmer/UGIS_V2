import { useState } from 'react'
import { useConsignees, useConsigneeMutations } from '../hooks/useConsignees'
import Layout from '../components/layout/Layout'
import Modal from '../components/ui/Modal'
import ConsigneeForm from '../components/consignees/ConsigneeForm'
import Confirm from '../components/ui/Confirm'
import Spinner from '../components/ui/Spinner'
import type { Consignee } from '../types'

export default function Consignees() {
  const { data: consignees = [], isLoading } = useConsignees()
  const { remove } = useConsigneeMutations()
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
                  <th className="px-4 py-2.5 font-medium w-24">Abbr.</th>
                  <th className="px-4 py-2.5 font-medium">Notes</th>
                  <th className="px-4 py-2.5 font-medium w-24" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(c => (
                  <tr key={c.id} className="hover:bg-surface-2/50 group">
                    <td className="px-4 py-3 text-white">{c.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">{c.abbreviation}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{c.notes ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="btn-ghost py-0.5 px-2 text-xs" onClick={() => setEditing(c)}>Edit</button>
                        <button className="btn-ghost py-0.5 px-2 text-xs text-red-400" onClick={() => setDeleting(c)}>Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-12 text-gray-600 text-sm">No consignees found</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

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

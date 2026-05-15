import { useState } from 'react'
import { useBrands, useBrandMutations } from '../hooks/useBrands'
import Layout from '../components/layout/Layout'
import Modal from '../components/ui/Modal'
import BrandForm from '../components/brands/BrandForm'
import Confirm from '../components/ui/Confirm'
import Spinner from '../components/ui/Spinner'
import type { Brand } from '../types'

export default function Brands() {
  const { data: brands = [], isLoading } = useBrands()
  const { remove } = useBrandMutations()
  const [editing, setEditing] = useState<Brand | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<Brand | null>(null)
  const [search, setSearch] = useState('')

  const topBrands = brands.filter(b => !b.parent_id)
  const getChildren = (parentId: string) => brands.filter(b => b.parent_id === parentId)

  const filtered = search
    ? brands.filter(b =>
        b.name.toLowerCase().includes(search.toLowerCase()) ||
        b.abbreviation.toLowerCase().includes(search.toLowerCase())
      )
    : null

  interface BrandRowProps {
    brand: Brand
    depth?: number
  }

  const BrandRow = ({ brand, depth = 0 }: BrandRowProps) => {
    const children = getChildren(brand.id)
    return (
      <>
        <tr className="border-b border-border hover:bg-surface-2/50 group">
          <td className="px-4 py-2.5">
            <div className="flex items-center gap-2" style={{ paddingLeft: depth * 20 }}>
              {depth > 0 && <span className="text-gray-700 text-xs">└</span>}
              <span className="text-sm text-white">{brand.name}</span>
            </div>
          </td>
          <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{brand.abbreviation}</td>
          <td className="px-4 py-2.5 text-xs text-gray-600">
            {(brand.aliases ?? []).join(', ') || '—'}
          </td>
          <td className="px-4 py-2.5 text-right">
            <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
              <button className="btn-ghost py-0.5 px-2 text-xs" onClick={() => setEditing(brand)}>Edit</button>
              <button className="btn-ghost py-0.5 px-2 text-xs text-red-400" onClick={() => setDeleting(brand)}>Del</button>
            </div>
          </td>
        </tr>
        {!filtered && children.map(child => (
          <BrandRow key={child.id} brand={child} depth={depth + 1} />
        ))}
      </>
    )
  }

  const displayBrands = filtered ?? topBrands

  return (
    <Layout>
      <div className="px-4 md:px-6 py-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-base font-semibold text-white">Brand Manager</h1>
            <p className="text-xs text-gray-600 mt-0.5">{brands.length} brands</p>
          </div>
          <button className="btn-primary" onClick={() => setAdding(true)}>+ New Brand</button>
        </div>

        <div className="mb-4">
          <input
            className="input w-64"
            placeholder="Search brands…"
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
                  <th className="px-4 py-2.5 font-medium">Aliases</th>
                  <th className="px-4 py-2.5 font-medium w-24" />
                </tr>
              </thead>
              <tbody>
                {displayBrands.map(b => (
                  <BrandRow key={b.id} brand={b} depth={0} />
                ))}
                {displayBrands.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-12 text-gray-600 text-sm">No brands found</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="New Brand">
        <BrandForm onDone={() => setAdding(false)} />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit Brand">
        {editing && <BrandForm brand={editing} onDone={() => setEditing(null)} />}
      </Modal>
      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutateAsync(deleting!.id)}
        title="Delete Brand"
        message={`Delete "${deleting?.name}"? Items tagged with this brand will lose the association.`}
        danger
      />
    </Layout>
  )
}

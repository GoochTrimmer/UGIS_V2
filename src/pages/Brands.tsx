import { useState } from 'react'
import { useBrands, useBrandMutations } from '../hooks/useBrands'
import { useProfile } from '../hooks/useProfile'
import { usePendingBrandRequests, useBrandRequestMutations } from '../hooks/useBrandRequests'
import Layout from '../components/layout/Layout'
import Modal from '../components/ui/Modal'
import BrandForm from '../components/brands/BrandForm'
import Confirm from '../components/ui/Confirm'
import Spinner from '../components/ui/Spinner'
import type { Brand, BrandRequest } from '../types'

export default function Brands() {
  const { data: brands = [], isLoading } = useBrands()
  const { remove, approve } = useBrandMutations()
  const { profile, loading: profileLoading } = useProfile()
  const isConsigneeUser = profileLoading || profile.role === 'consignee' // assume the more restrictive role while unresolved
  const [editing, setEditing] = useState<Brand | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<Brand | null>(null)
  const [search, setSearch] = useState('')
  const [reviewOnly, setReviewOnly] = useState(false)
  const { data: requests = [] } = usePendingBrandRequests()
  const { setStatus: setRequestStatus } = useBrandRequestMutations()
  const [fulfilling, setFulfilling] = useState<BrandRequest | null>(null)
  const pendingCount = brands.filter(b => b.pending_review).length

  const topBrands = brands.filter(b => !b.parent_id)
  const getChildren = (parentId: string) => brands.filter(b => b.parent_id === parentId)

  const filtered = search || reviewOnly
    ? brands.filter(b =>
        (!search ||
          b.name.toLowerCase().includes(search.toLowerCase()) ||
          b.abbreviation.toLowerCase().includes(search.toLowerCase())) &&
        (!reviewOnly || b.pending_review)
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
              {brand.pending_review && (
                <span className="text-[10px] font-semibold bg-amber-500/20 text-amber-400 rounded-full px-1.5 py-0.5 leading-none">
                  added by {brand.created_by_consignee?.name ?? 'consignee'}
                </span>
              )}
            </div>
          </td>
          <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{brand.abbreviation}</td>
          <td className="px-4 py-2.5 text-xs text-gray-600">
            {(brand.aliases ?? []).join(', ') || '—'}
          </td>
          <td className="px-4 py-2.5 text-right">
            {!isConsigneeUser && (
              <div className="flex gap-1 justify-end items-center">
                {brand.pending_review && (
                  <button
                    className="btn-ghost py-0.5 px-2 text-xs text-emerald-400 border border-emerald-500/30"
                    disabled={approve.isPending}
                    onClick={() => approve.mutate(brand.id)}
                  >
                    {approve.isPending ? 'Approving…' : 'Approve'}
                  </button>
                )}
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="btn-ghost py-0.5 px-2 text-xs" onClick={() => setEditing(brand)}>Edit</button>
                  <button className="btn-ghost py-0.5 px-2 text-xs text-red-400" onClick={() => setDeleting(brand)}>Del</button>
                </div>
              </div>
            )}
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

        {!isConsigneeUser && requests.length > 0 && (
          <div className="mb-5 border border-amber-500/30 bg-amber-500/5 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-amber-500/20">
              <p className="text-xs font-medium text-amber-400">Brand requests ({requests.length})</p>
              <p className="text-xs text-gray-600 mt-0.5">
                Brand names from imports that looked like typos of an existing brand and were left undefined. Add the brand, or dismiss if it was a typo — then assign the brand to those items.
              </p>
            </div>
            <div className="divide-y divide-border">
              {requests.map(r => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{r.name}</p>
                    <p className="text-xs text-gray-600 truncate">
                      {r.consignee?.name ?? 'Staff'} · {r.item_count} item{r.item_count === 1 ? '' : 's'}
                      {r.example_item ? ` · e.g. ${r.example_item}` : ''} · {new Date(r.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  <button className="btn-ghost py-0.5 px-2 text-xs" onClick={() => setFulfilling(r)}>Add brand</button>
                  <button
                    className="btn-ghost py-0.5 px-2 text-xs text-gray-500"
                    disabled={setRequestStatus.isPending}
                    onClick={() => setRequestStatus.mutate({ id: r.id, status: 'dismissed' })}
                  >
                    Dismiss
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4 flex items-center gap-2">
          <input
            className="input w-64"
            placeholder="Search brands…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {!isConsigneeUser && pendingCount > 0 && (
            <button
              className={`text-xs rounded px-2.5 py-1.5 border transition-colors ${
                reviewOnly ? 'border-amber-500/40 bg-amber-500/15 text-amber-400' : 'border-border text-gray-500 hover:text-gray-300'
              }`}
              onClick={() => setReviewOnly(r => !r)}
            >
              New from consignees ({pendingCount})
            </button>
          )}
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
      <Modal open={!!fulfilling} onClose={() => setFulfilling(null)} title="Add Requested Brand">
        {fulfilling && (
          <BrandForm
            initialName={fulfilling.name}
            onSaved={() => setRequestStatus.mutate({ id: fulfilling.id, status: 'resolved' })}
            onDone={() => setFulfilling(null)}
          />
        )}
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

import { useState } from 'react'
import { useItems } from '../hooks/useItems'
import Layout from '../components/layout/Layout'
import FilterBar from '../components/inventory/FilterBar'
import InventoryTable from '../components/inventory/InventoryTable'
import Modal from '../components/ui/Modal'
import ItemForm from '../components/inventory/ItemForm'
import Spinner from '../components/ui/Spinner'
import { STATUS_CONFIG } from '../lib/constants'
import type { ItemFilters, ItemStatus } from '../types'

export default function Inventory() {
  const [filters, setFilters] = useState<ItemFilters>({ status: 'in_stock' })
  const [addOpen, setAddOpen] = useState(false)

  const { data: items = [], isLoading, isFetching, error } = useItems(filters)
  // Fetch without status filter so tab counts always reflect the full dataset
  const { data: allForCounts = [] } = useItems({ ...filters, status: undefined })

  const counts = allForCounts.reduce<Partial<Record<ItemStatus, number>>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1
    return acc
  }, {})

  const setStatus = (status: ItemStatus | undefined) =>
    setFilters(f => ({ ...f, status }))

  return (
    <Layout>
      <div className="px-4 md:px-6 py-5 flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-base font-semibold text-white">Inventory</h1>
            <p className="text-xs text-gray-600 mt-0.5">{items.length} item{items.length !== 1 ? 's' : ''}</p>
          </div>
          <button className="btn-primary" onClick={() => setAddOpen(true)}>
            + Add Item
          </button>
        </div>

        {/* Status tabs */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          <button
            onClick={() => setStatus(undefined)}
            className={`px-2.5 py-0.5 text-xs border rounded-full transition-opacity bg-white/10 text-white border-white/20 ${!filters.status ? 'opacity-100' : 'opacity-40 hover:opacity-70'}`}
          >
            All · {allForCounts.length}
          </button>
          {(Object.entries(STATUS_CONFIG) as [ItemStatus, { label: string; color: string }][]).map(([k, v]) =>
            counts[k] || filters.status === k ? (
              <button
                key={k}
                onClick={() => setStatus(k)}
                className={`px-2.5 py-0.5 text-xs border rounded-full transition-opacity ${v.color} ${filters.status === k ? 'opacity-100' : 'opacity-40 hover:opacity-70'}`}
              >
                {v.label} · {counts[k] ?? 0}
              </button>
            ) : null
          )}
        </div>

        {/* Filters */}
        <div className="mb-4">
          <FilterBar filters={filters} onChange={setFilters} />
        </div>

        {/* Content */}
        <div className={`card overflow-auto flex-1 min-h-0 transition-opacity duration-200 ${isFetching && !isLoading ? 'opacity-50' : 'opacity-100'}`}>
          {isLoading && (
            <div className="flex justify-center items-center h-full">
              <Spinner />
            </div>
          )}
          {error && (
            <div className="text-sm text-red-400 px-4 py-8 text-center">{(error as Error).message}</div>
          )}
          {!isLoading && !error && (
            <InventoryTable items={items} />
          )}
        </div>
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Item" wide>
        <ItemForm onDone={() => setAddOpen(false)} />
      </Modal>
    </Layout>
  )
}

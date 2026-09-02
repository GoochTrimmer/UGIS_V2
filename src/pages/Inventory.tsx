import { useEffect, useMemo, useState } from 'react'
import { useItems } from '../hooks/useItems'
import { useOpenDiscrepancies } from '../hooks/useReconciliation'
import Layout from '../components/layout/Layout'
import FilterBar from '../components/inventory/FilterBar'
import InventoryTable from '../components/inventory/InventoryTable'
import Modal from '../components/ui/Modal'
import ItemForm from '../components/inventory/ItemForm'
import Spinner from '../components/ui/Spinner'
import ShopifyStatusDot from '../components/inventory/ShopifyStatusDot'
import { STATUS_CONFIG } from '../lib/constants'
import type { SortState, ShopifyStatusValue } from '../components/inventory/sortState'
import type { ItemFilters, ItemStatus } from '../types'

export default function Inventory() {
  const [filters, setFilters] = useState<ItemFilters>({ status: 'in_stock' })
  const [addOpen, setAddOpen] = useState(false)
  const [sort, setSort] = useState<SortState>(null)
  const [bulkMode, setBulkMode] = useState(false)

  // Escape exits bulk-edit mode, same as it closes a modal — a familiar
  // "back out of this" gesture, and the button label below advertises it.
  useEffect(() => {
    if (!bulkMode) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setBulkMode(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [bulkMode])

  const emptyFlags = { field: 'flags' as const, shopifyStatuses: [] as ShopifyStatusValue[], incomplete: false }

  const toggleShopifyStatusSort = (value: ShopifyStatusValue) => {
    setSort(prev => {
      const base = prev?.field === 'flags' ? prev : emptyFlags
      const shopifyStatuses = base.shopifyStatuses.includes(value)
        ? base.shopifyStatuses.filter(v => v !== value)
        : [...base.shopifyStatuses, value]
      const next = { ...base, shopifyStatuses }
      return next.shopifyStatuses.length > 0 || next.incomplete ? next : null
    })
  }

  const toggleIncompleteSort = () => {
    setSort(prev => {
      const base = prev?.field === 'flags' ? prev : emptyFlags
      const next = { ...base, incomplete: !base.incomplete }
      return next.shopifyStatuses.length > 0 || next.incomplete ? next : null
    })
  }

  const { data: items = [], isLoading, isFetching, error } = useItems(filters)
  // Fetch without status filter so tab counts always reflect the full dataset
  const { data: allForCounts = [] } = useItems({ ...filters, status: undefined })

  // Items whose linked Shopify listing has been deleted — struck through in
  // the table so it's obvious at a glance, with the actual unbind/delete
  // decision left to the Actionable tab.
  const { data: discrepancies = [] } = useOpenDiscrepancies()
  const missingListingIds = useMemo(
    () => new Set(discrepancies.filter(d => d.kind === 'listing_missing').map(d => d.item_id)),
    [discrepancies],
  )

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
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`btn ${bulkMode ? 'bg-amber-500 text-black hover:bg-amber-400 focus:ring-amber-400' : 'bg-surface-2 text-gray-300 border border-border hover:bg-surface-3'}`}
              onClick={() => setBulkMode(m => !m)}
            >
              {bulkMode ? '⎋ Esc to Exit' : '✎ Edit Items'}
            </button>
            <button className="btn-primary" onClick={() => setAddOpen(true)}>
              + Add Item
            </button>
          </div>
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
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
          <FilterBar filters={filters} onChange={setFilters} />
          <div className="flex items-center gap-3 text-xs text-gray-600 shrink-0">
            {([
              { value: 'live', label: 'Live', item: { shopify_product_id: 'x', shopify_needs_finishing: false } },
              { value: 'draft', label: 'Draft', item: { shopify_product_id: 'x', shopify_needs_finishing: true } },
              { value: 'unlisted', label: 'Unlisted', item: { shopify_product_id: null, shopify_needs_finishing: false } },
            ] as const).map(({ value, label, item }) => (
              <button
                key={value}
                type="button"
                title={`Sort by ${label}`}
                onClick={() => toggleShopifyStatusSort(value)}
                className={`flex items-center gap-1.5 transition-colors ${sort?.field === 'flags' && sort.shopifyStatuses.includes(value) ? 'text-white' : 'hover:text-gray-400'}`}
              >
                <ShopifyStatusDot item={item} /> {label}
              </button>
            ))}
            <button
              type="button"
              title="Sort by items missing important fields"
              onClick={toggleIncompleteSort}
              className={`flex items-center gap-1.5 transition-colors ${sort?.field === 'flags' && sort.incomplete ? 'text-white' : 'hover:text-gray-400'}`}
            >
              <span className="text-amber-400">⚠</span> Incomplete
            </button>
          </div>
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
            <InventoryTable items={items} sort={sort} onSortChange={setSort} bulkMode={bulkMode} missingListingIds={missingListingIds} />
          )}
        </div>
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Item" wide>
        <ItemForm onDone={() => setAddOpen(false)} />
      </Modal>
    </Layout>
  )
}

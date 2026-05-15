import { useRef, useEffect } from 'react'
import { useBrands } from '../../hooks/useBrands'
import { useConsignees } from '../../hooks/useConsignees'
import { STATUS_CONFIG } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import type { ItemFilters, ItemStatus } from '../../types'

interface FilterBarProps {
  filters: ItemFilters
  onChange: (f: ItemFilters) => void
}

export default function FilterBar({ filters, onChange }: FilterBarProps) {
  const { data: brands = [] } = useBrands()
  const { data: consignees = [] } = useConsignees()

  // Keep a ref to always read the latest filters inside async callbacks
  const filtersRef = useRef(filters)
  useEffect(() => { filtersRef.current = filters })

  const setFilter = (key: keyof ItemFilters, value: string) =>
    onChange({ ...filters, [key]: value || undefined })

  const handleBrandChange = async (brandId: string) => {
    if (!brandId) return onChange({ ...filtersRef.current, _brandId: undefined, brand_ids: undefined })
    const { data } = await supabase.rpc('brand_family_ids', { p_brand_id: brandId })
    // Discard result if the user already switched to a different brand
    if (filtersRef.current._brandId !== brandId) return
    const rows = data as unknown as Array<{ brand_family_ids: string } | string> | null
    const ids = rows?.map(r => (typeof r === 'object' && r !== null ? r.brand_family_ids : r as string)) ?? [brandId]
    onChange({ ...filtersRef.current, brand_ids: ids })
  }

  const topBrands = brands.filter(b => !b.parent_id)
  const subBrands = brands.filter(b => b.parent_id)

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {/* Search — filters client-side instantly, no network request */}
      <input
        className="input w-56"
        placeholder="Search name or ID…"
        value={filters.search ?? ''}
        onChange={e => setFilter('search', e.target.value)}
      />

      {/* Status */}
      <select
        className="input w-44"
        value={filters.status ?? ''}
        onChange={e => setFilter('status', e.target.value)}
      >
        <option value="">All statuses</option>
        {(Object.entries(STATUS_CONFIG) as [ItemStatus, { label: string; color: string }][]).map(([k, v]) => (
          <option key={k} value={k}>{v.label}</option>
        ))}
      </select>

      {/* Brand */}
      <select
        className="input w-52"
        value={filters._brandId ?? ''}
        onChange={e => {
          onChange({ ...filters, _brandId: e.target.value || undefined })
          void handleBrandChange(e.target.value)
        }}
      >
        <option value="">All brands</option>
        {topBrands.map(b => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
        {subBrands.length > 0 && (
          <optgroup label="Sublines">
            {subBrands.map(b => (
              <option key={b.id} value={b.id}>  {b.name}</option>
            ))}
          </optgroup>
        )}
      </select>

      {/* Consignee */}
      <select
        className="input w-44"
        value={filters.consignee_id ?? ''}
        onChange={e => setFilter('consignee_id', e.target.value)}
      >
        <option value="">All consignees</option>
        {consignees.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      {/* Clear */}
      {Object.values(filters).some(Boolean) && (
        <button className="btn-ghost text-xs" onClick={() => onChange({})}>
          Clear filters
        </button>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useItemMutations } from '../../hooks/useItems'
import { useConsignees } from '../../hooks/useConsignees'
import { useBrands } from '../../hooks/useBrands'
import BrandSelector from '../brands/BrandSelector'
import Modal from '../ui/Modal'
import BrandForm from '../brands/BrandForm'
import ConsigneeForm from '../consignees/ConsigneeForm'
import { STATUS_CONFIG, SEASON_PERIODS, YEAR_OPTIONS, SALE_CHANNEL_CONFIG, SALE_GEOGRAPHY_CONFIG } from '../../lib/constants'
import type { Item, Brand, ItemStatus, SeasonPeriod, SaleChannel, SaleGeography } from '../../types'

interface ItemFormProps {
  item?: Item
  onDone: () => void
}

interface ItemFormValues {
  name: string
  size: string
  status: ItemStatus
  season_year: string
  season_period: SeasonPeriod
  season_custom: string
  consignee_id: string
  cost_amount: string
  takeback_price: string
  selling_price: string
  sold_price: string
  sale_channel: SaleChannel | ''
  sale_geography: SaleGeography | ''
  notes: string
}

export default function ItemForm({ item, onDone }: ItemFormProps) {
  const { create, update } = useItemMutations()
  const { data: consignees = [] } = useConsignees()
  const { data: allBrands = [] } = useBrands()
  const [selectedBrands, setSelectedBrands] = useState<Brand[]>([])
  const [isConsigned, setIsConsigned] = useState(false)
  const [showNewBrand, setShowNewBrand] = useState(false)
  const [showNewConsignee, setShowNewConsignee] = useState(false)

  void allBrands

  const { register, handleSubmit, watch, reset, setValue, formState: { errors, isSubmitting } } = useForm<ItemFormValues>({
    defaultValues: {
      name: '', size: '', status: 'in_stock', season_year: '', season_period: 'SS',
      season_custom: '', consignee_id: '', cost_amount: '', takeback_price: '',
      selling_price: '', sold_price: '', sale_channel: '', sale_geography: '', notes: '',
    }
  })

  const storeConsignee = consignees.find(c => c.is_default_store) ?? null
  const consigneeOptions = consignees.filter(c => !c.is_default_store)

  const seasonPeriod = watch('season_period')
  const watchedConsigneeId = watch('consignee_id')
  const watchedStatus = watch('status')
  const sizeReg = register('size')

  useEffect(() => {
    if (item) {
      const itemIsConsigned = !!item.consignee && item.consignee.id !== storeConsignee?.id
      setIsConsigned(itemIsConsigned)
      reset({
        name: item.name,
        size: item.size ?? '',
        status: item.status,
        season_year: item.season_year ? String(item.season_year) : '',
        season_period: (item.season_period as SeasonPeriod) ?? 'SS',
        season_custom: item.season_custom ?? '',
        consignee_id: item.consignee_id ?? '',
        cost_amount: item.cost_amount ? String(item.cost_amount) : '',
        takeback_price: item.takeback_price ? String(item.takeback_price) : '',
        selling_price: item.selling_price ? String(item.selling_price) : '',
        sold_price: item.sold_price ? String(item.sold_price) : '',
        sale_channel: (item.sale_channel ?? '') as SaleChannel | '',
        sale_geography: (item.sale_geography ?? '') as SaleGeography | '',
        notes: item.notes ?? '',
      })
      setSelectedBrands(item.brands ?? [])
    } else {
      setIsConsigned(false)
      reset({
        name: '', size: '', status: 'in_stock', season_year: '', season_period: 'SS',
        season_custom: '', consignee_id: storeConsignee?.id ?? '',
        cost_amount: '', takeback_price: '', selling_price: '', notes: '',
      })
    }
    // storeConsignee intentionally omitted — re-run only when item changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, reset])

  // When consignees first load for a new item, set the store as the default consignee
  useEffect(() => {
    if (!item && storeConsignee && !watchedConsigneeId) {
      setValue('consignee_id', storeConsignee.id)
    }
  }, [item, storeConsignee, watchedConsigneeId, setValue])

  const handleConsignedToggle = (checked: boolean) => {
    setIsConsigned(checked)
    if (!checked) {
      setValue('consignee_id', storeConsignee?.id ?? '')
    } else {
      setValue('consignee_id', '')
    }
  }

  const onSubmit = async (data: ItemFormValues) => {
    const effectiveConsignee = isConsigned
      ? (consignees.find(c => c.id === data.consignee_id) ?? null)
      : storeConsignee

    const payload = {
      name: data.name.trim(),
      size: data.size.trim() || null,
      status: data.status,
      season_year: data.season_year ? parseInt(data.season_year) : null,
      season_period: data.season_period || null,
      season_custom: data.season_period === 'Custom' ? data.season_custom.trim() : null,
      consignee_id: effectiveConsignee?.id ?? null,
      cost_amount: !isConsigned && data.cost_amount ? parseFloat(data.cost_amount) : null,
      takeback_price: isConsigned && data.takeback_price ? parseFloat(data.takeback_price) : null,
      selling_price: data.selling_price ? parseFloat(data.selling_price) : null,
      sold_price: data.status === 'sold' && data.sold_price ? parseFloat(data.sold_price) : null,
      sale_channel: (data.status === 'sold' && data.sale_channel) ? data.sale_channel : null,
      sale_geography: (data.status === 'sold' && data.sale_geography) ? data.sale_geography : null,
      notes: data.notes.trim() || null,
      brands: selectedBrands,
      consignee: effectiveConsignee,
    }

    if (item) await update.mutateAsync({ id: item.id, readable_id: item.readable_id, ...payload })
    else await create.mutateAsync(payload)
    onDone()
  }

  const mutationError = create.error ?? update.error

  // ID preview: store-owned always shows UG, consigned shows selected consignee
  const previewConsigneeAbbr = isConsigned
    ? (consignees.find(c => c.id === watchedConsigneeId)?.abbreviation ?? null)
    : (storeConsignee?.abbreviation ?? null)

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {mutationError && (
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded px-3 py-2">
          {mutationError.message}
        </div>
      )}

      {/* Name + Size */}
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className="label">Item Name *</label>
          <input className="input" {...register('name', { required: true })} placeholder="e.g. Undercover AW02 Witch's Cell Division Jacket" />
          {errors.name && <p className="text-xs text-red-400 mt-1">Required</p>}
        </div>
        <div>
          <label className="label">Size</label>
          <input
            className="input font-mono"
            {...sizeReg}
            onChange={e => {
              e.target.value = e.target.value.toUpperCase()
              void sizeReg.onChange(e)
            }}
            placeholder="M, XL, 38…"
          />
        </div>
      </div>

      {/* Brands */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="label mb-0">Brand(s) <span className="text-gray-600 font-normal">(order determines ID prefix)</span></label>
          <button type="button" className="text-xs text-gray-500 hover:text-white transition-colors" onClick={() => setShowNewBrand(true)}>
            + New brand
          </button>
        </div>
        <BrandSelector value={selectedBrands} onChange={setSelectedBrands} />
      </div>

      {/* Season */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="label">Season</label>
          <select className="input" {...register('season_period')}>
            {SEASON_PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {seasonPeriod !== 'NA' && seasonPeriod !== 'Custom' && (
          <div>
            <label className="label">Year</label>
            <select className="input" {...register('season_year')}>
              <option value="">—</option>
              {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}
        {seasonPeriod === 'Custom' && (
          <div className="col-span-2">
            <label className="label">Custom season</label>
            <input className="input" {...register('season_custom')} placeholder="Pre-Fall 2003" />
          </div>
        )}
      </div>

      {/* Status */}
      <div>
        <label className="label">Status</label>
        <select className="input" {...register('status')}>
          {(Object.entries(STATUS_CONFIG) as [ItemStatus, { label: string; color: string }][]).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {/* Consignment toggle */}
      <div className="flex items-center gap-3 py-1">
        <input
          id="is-consigned"
          type="checkbox"
          className="w-4 h-4 rounded border-border bg-surface-2 accent-white cursor-pointer"
          checked={isConsigned}
          onChange={e => handleConsignedToggle(e.target.checked)}
        />
        <label htmlFor="is-consigned" className="text-sm text-gray-300 cursor-pointer select-none">
          Consignment piece
          <span className="text-gray-600 font-normal ml-1">(on behalf of a consignee)</span>
        </label>
      </div>

      {/* Consignee selector — only when consigned */}
      {isConsigned && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label mb-0">Consignee *</label>
            <button type="button" className="text-xs text-gray-500 hover:text-white transition-colors" onClick={() => setShowNewConsignee(true)}>
              + New consignee
            </button>
          </div>
          <select className="input" {...register('consignee_id', { required: isConsigned })}>
            <option value="">Select consignee…</option>
            {consigneeOptions.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.abbreviation})</option>
            ))}
          </select>
          {errors.consignee_id && <p className="text-xs text-red-400 mt-1">Required for consignment items</p>}
        </div>
      )}

      {/* Pricing — context-aware */}
      {isConsigned ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Take-back Price</label>
            <input className="input" type="number" step="0.01" {...register('takeback_price')} placeholder="0.00" />
          </div>
          <div>
            <label className="label">Selling Price</label>
            <input className="input" type="number" step="0.01" {...register('selling_price')} placeholder="0.00" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Cost</label>
            <input className="input" type="number" step="0.01" {...register('cost_amount')} placeholder="0.00" />
          </div>
          <div>
            <label className="label">Selling Price</label>
            <input className="input" type="number" step="0.01" {...register('selling_price')} placeholder="0.00" />
          </div>
        </div>
      )}

      {/* Sale details — only when status is sold */}
      {watchedStatus === 'sold' && (
        <div className="border border-border rounded-lg px-3 py-3 space-y-3 bg-surface-2/40">
          <div>
            <p className="text-xs font-medium text-white mb-0.5">Sale Details</p>
            <p className="text-xs text-gray-600">Actual price and channel — may differ from the listed price above.</p>
          </div>
          <div>
            <label className="label">Actual Sold Price</label>
            <input className="input" type="number" step="0.01" {...register('sold_price')} placeholder="0.00" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Sale Channel</label>
              <select className="input" {...register('sale_channel')}>
                <option value="">— unknown —</option>
                {(Object.entries(SALE_CHANNEL_CONFIG) as [SaleChannel, { label: string }][]).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Geography</label>
              <select className="input" {...register('sale_geography')}>
                <option value="">— unknown —</option>
                {(Object.entries(SALE_GEOGRAPHY_CONFIG) as [SaleGeography, { label: string }][]).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="label">Notes</label>
        <textarea className="input resize-none" rows={3} {...register('notes')} placeholder="Condition, provenance, details…" />
      </div>

      {/* ID preview */}
      {selectedBrands.length > 0 && !item && (
        <div className="text-xs text-gray-500 bg-surface-2 border border-border rounded px-3 py-2">
          <span className="text-gray-600">ID preview: </span>
          <span className="font-mono text-gray-300">
            {selectedBrands.map(b => b.abbreviation).join('-')}
            {previewConsigneeAbbr ? `-${previewConsigneeAbbr}` : ''}
            -NN
          </span>
        </div>
      )}

      <div className="flex gap-2 justify-end pt-2">
        <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : item ? 'Save Changes' : 'Add Item'}
        </button>
      </div>

      <Modal open={showNewBrand} onClose={() => setShowNewBrand(false)} title="New Brand">
        <BrandForm onDone={() => setShowNewBrand(false)} />
      </Modal>

      <Modal open={showNewConsignee} onClose={() => setShowNewConsignee(false)} title="New Consignee">
        <ConsigneeForm onDone={() => setShowNewConsignee(false)} />
      </Modal>
    </form>
  )
}

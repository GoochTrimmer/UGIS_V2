import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useItemMutations } from '../../hooks/useItems'
import { useConsignees } from '../../hooks/useConsignees'
import { useBrands } from '../../hooks/useBrands'
import BrandSelector from '../brands/BrandSelector'
import { STATUS_CONFIG, SEASON_PERIODS, YEAR_OPTIONS } from '../../lib/constants'
import type { Item, Brand, ItemStatus, SeasonPeriod } from '../../types'

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
  notes: string
}

export default function ItemForm({ item, onDone }: ItemFormProps) {
  const { create, update } = useItemMutations()
  const { data: consignees = [] } = useConsignees()
  const { data: allBrands = [] } = useBrands()
  const [selectedBrands, setSelectedBrands] = useState<Brand[]>([])

  void allBrands

  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm<ItemFormValues>({
    defaultValues: {
      name: '',
      size: '',
      status: 'in_stock',
      season_year: '',
      season_period: 'SS',
      season_custom: '',
      consignee_id: '',
      cost_amount: '',
      takeback_price: '',
      selling_price: '',
      notes: '',
    }
  })

  const seasonPeriod = watch('season_period')
  const sizeReg = register('size')

  useEffect(() => {
    if (item) {
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
        notes: item.notes ?? '',
      })
      setSelectedBrands(item.brands ?? [])
    }
  }, [item, reset])

  const onSubmit = async (data: ItemFormValues) => {
    const consignee = consignees.find(c => c.id === data.consignee_id) ?? null

    const payload = {
      name: data.name.trim(),
      size: data.size.trim() || null,
      status: data.status,
      season_year: data.season_year ? parseInt(data.season_year) : null,
      season_period: data.season_period || null,
      season_custom: data.season_period === 'Custom' ? data.season_custom.trim() : null,
      consignee_id: data.consignee_id || null,
      cost_amount: data.cost_amount ? parseFloat(data.cost_amount) : null,
      takeback_price: data.takeback_price ? parseFloat(data.takeback_price) : null,
      selling_price: data.selling_price ? parseFloat(data.selling_price) : null,
      notes: data.notes.trim() || null,
      brands: selectedBrands,
      consignee,
    }

    if (item) await update.mutateAsync({ id: item.id, readable_id: item.readable_id, ...payload })
    else await create.mutateAsync(payload)
    onDone()
  }

  const mutationError = create.error ?? update.error

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
          <input className="input" {...register('name', { required: true })} placeholder='AW11 Undercover Jacket "Klaus"' />
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
        <label className="label">Brand(s) <span className="text-gray-600 font-normal">(order determines ID prefix)</span></label>
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

      {/* Consignee */}
      <div>
        <label className="label">Consignee / Stockist</label>
        <select className="input" {...register('consignee_id')}>
          <option value="">Store-owned / None</option>
          {consignees.map(c => (
            <option key={c.id} value={c.id}>{c.name} ({c.abbreviation})</option>
          ))}
        </select>
      </div>

      {/* Pricing */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="label">Cost</label>
          <input className="input" type="number" step="0.01" {...register('cost_amount')} placeholder="0.00" />
        </div>
        <div>
          <label className="label">Take-back</label>
          <input className="input" type="number" step="0.01" {...register('takeback_price')} placeholder="0.00" />
        </div>
        <div>
          <label className="label">Selling Price</label>
          <input className="input" type="number" step="0.01" {...register('selling_price')} placeholder="0.00" />
        </div>
      </div>

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
            {watch('consignee_id') ? `-${consignees.find(c => c.id === watch('consignee_id'))?.abbreviation ?? '?'}` : ''}
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
    </form>
  )
}

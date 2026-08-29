import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useItemMutations } from '../../hooks/useItems'
import { useConsignees } from '../../hooks/useConsignees'
import { useBrands } from '../../hooks/useBrands'
import { invokeEdgeFunction } from '../../lib/edgeFunctions'
import BrandSelector from '../brands/BrandSelector'
import Modal from '../ui/Modal'
import Confirm from '../ui/Confirm'
import BrandForm from '../brands/BrandForm'
import ConsigneeForm from '../consignees/ConsigneeForm'
import { STATUS_CONFIG, SEASON_PERIODS, YEAR_OPTIONS, SALE_CHANNEL_CONFIG, SALE_GEOGRAPHY_CONFIG } from '../../lib/constants'
import type { Item, Brand, ItemStatus, SeasonPeriod, SaleChannel, SaleGeography } from '../../types'

// datetime-local <-> ISO helpers (datetime-local has no timezone; treated as local time)
function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function datetimeLocalToIso(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

interface ItemFormProps {
  item?: Item
  onDone: () => void
}

interface ResolvedShopifyProduct {
  productId: string
  title: string
  variants: { variantId: string; title: string; sku: string | null }[]
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
  ready_to_list: boolean
  scheduled_drop_at: string
}

export default function ItemForm({ item, onDone }: ItemFormProps) {
  const { create, update, markShopifyFinished, unbindShopify } = useItemMutations()
  const { data: consignees = [] } = useConsignees()
  const { data: allBrands = [] } = useBrands()
  const [selectedBrands, setSelectedBrands] = useState<Brand[]>([])
  const [isConsigned, setIsConsigned] = useState(false)
  const [showNewBrand, setShowNewBrand] = useState(false)
  const [showNewConsignee, setShowNewConsignee] = useState(false)
  const [shopifyPushing, setShopifyPushing] = useState(false)
  const [shopifyError, setShopifyError] = useState<string | null>(null)
  const [unbinding, setUnbinding] = useState(false)
  const [reassigning, setReassigning] = useState(false)
  const [reassignUrl, setReassignUrl] = useState('')
  const [reassignResolving, setReassignResolving] = useState(false)
  const [reassignLinking, setReassignLinking] = useState(false)
  const [reassignProduct, setReassignProduct] = useState<ResolvedShopifyProduct | null>(null)
  const [reassignVariantId, setReassignVariantId] = useState('')

  void allBrands

  const { register, handleSubmit, watch, reset, setValue, formState: { errors, isSubmitting } } = useForm<ItemFormValues>({
    defaultValues: {
      name: '', size: '', status: 'in_stock', season_year: '', season_period: 'SS',
      season_custom: '', consignee_id: '', cost_amount: '', takeback_price: '',
      selling_price: '', sold_price: '', sale_channel: '', sale_geography: '', notes: '',
      ready_to_list: false, scheduled_drop_at: '',
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
        ready_to_list: item.ready_to_list,
        scheduled_drop_at: isoToDatetimeLocal(item.scheduled_drop_at),
      })
      setSelectedBrands(item.brands ?? [])
    } else {
      setIsConsigned(false)
      reset({
        name: '', size: '', status: 'in_stock', season_year: '', season_period: 'SS',
        season_custom: '', consignee_id: storeConsignee?.id ?? '',
        cost_amount: '', takeback_price: '', selling_price: '', notes: '',
        ready_to_list: false, scheduled_drop_at: '',
      })
    }
    setShopifyError(null)
    setUnbinding(false)
    setReassigning(false)
    setReassignUrl('')
    setReassignProduct(null)
    setReassignVariantId('')
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
      ready_to_list: data.ready_to_list,
      scheduled_drop_at: datetimeLocalToIso(data.scheduled_drop_at),
      brands: selectedBrands,
      consignee: effectiveConsignee,
    }

    const shouldPushDraft = data.ready_to_list && !item?.shopify_product_id

    if (item) {
      await update.mutateAsync({ id: item.id, readable_id: item.readable_id, ...payload })
      if (shouldPushDraft) {
        const ok = await pushToShopify(item.id)
        if (!ok) return // keep the form open so the error + retry button are visible
      }
    } else {
      const created = await create.mutateAsync(payload)
      if (shouldPushDraft) await pushToShopify((created as { id: string }).id)
    }
    onDone()
  }

  const pushToShopify = async (itemId: string): Promise<boolean> => {
    setShopifyPushing(true)
    setShopifyError(null)
    const { error } = await invokeEdgeFunction('shopify-create-draft', { itemId })
    setShopifyPushing(false)
    if (error) { setShopifyError(error); return false }
    return true
  }

  const retryShopifyPush = async () => {
    if (!item) return
    const ok = await pushToShopify(item.id)
    if (ok) onDone()
  }

  const markFinished = async () => {
    if (!item) return
    await markShopifyFinished.mutateAsync(item.id)
    onDone()
  }

  const confirmUnbind = async () => {
    if (!item) return
    await unbindShopify.mutateAsync(item.id)
    setUnbinding(false)
    onDone()
  }

  const resolveReassignUrl = async () => {
    setReassignResolving(true)
    setShopifyError(null)
    setReassignProduct(null)
    const { data, error } = await invokeEdgeFunction<ResolvedShopifyProduct>('shopify-resolve-link', { url: reassignUrl })
    setReassignResolving(false)
    if (error) { setShopifyError(error); return }
    setReassignProduct(data)
    setReassignVariantId(data?.variants[0]?.variantId ?? '')
  }

  const confirmReassign = async () => {
    if (!item || !reassignProduct || !reassignVariantId) return
    setReassignLinking(true)
    setShopifyError(null)
    const { error } = await invokeEdgeFunction('shopify-resolve-link', {
      itemId: item.id,
      productId: reassignProduct.productId,
      variantId: reassignVariantId,
    })
    setReassignLinking(false)
    if (error) { setShopifyError(error); return }
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

      {/* Shopify listing */}
      <div className="border border-border rounded-lg px-3 py-3 space-y-3 bg-surface-2/40">
        <p className="text-xs font-medium text-white">Shopify Listing</p>

        {item?.shopify_product_id ? (
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-gray-500">
              Linked to Shopify product <span className="font-mono text-gray-300">{item.shopify_product_id}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {item.shopify_admin_url && (
                <a href={item.shopify_admin_url} target="_blank" rel="noreferrer" className="btn-ghost py-1 px-2 text-xs">
                  {item.shopify_needs_finishing ? 'Finish on Shopify →' : 'View on Shopify →'}
                </a>
              )}
              {item.shopify_needs_finishing && (
                <button type="button" className="btn-ghost py-1 px-2 text-xs" onClick={() => void markFinished()}>
                  Mark as finished
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <input
                id="ready-to-list"
                type="checkbox"
                className="w-4 h-4 rounded border-border bg-surface-2 accent-white cursor-pointer"
                {...register('ready_to_list')}
              />
              <label htmlFor="ready-to-list" className="text-sm text-gray-300 cursor-pointer select-none">
                Ready to list
                <span className="text-gray-600 font-normal ml-1">(pushes a draft listing to Shopify on save)</span>
              </label>
            </div>
            {/* Scheduled drop — paused for now (spec §4's auto-flip-on-date isn't built yet,
                and today the checkbox pushes immediately regardless of this field, which
                would be misleading to show). DB column + form wiring stay intact below;
                uncomment to bring it back.
            {watch('ready_to_list') && (
              <div>
                <label className="label">Scheduled drop <span className="text-gray-600 font-normal">(optional)</span></label>
                <input className="input" type="datetime-local" {...register('scheduled_drop_at')} />
              </div>
            )}
            */}
            {item && item.ready_to_list && (
              <button
                type="button"
                className="btn-ghost py-1 px-2 text-xs"
                disabled={shopifyPushing}
                onClick={() => void retryShopifyPush()}
              >
                {shopifyPushing ? 'Pushing…' : 'Push to Shopify now'}
              </button>
            )}
          </>
        )}

        {/* Link/reassign/unbind — only meaningful once the item actually exists */}
        {item && (() => {
          const isLinked = !!item.shopify_product_id
          // Linked items keep an explicit "Reassign via URL" toggle (a
          // deliberate, occasional fix-a-mistake action). Unlinked items
          // skip the toggle entirely and just follow "Ready to list": the
          // link-existing form stays open while it's unchecked, and hides
          // once checked, since the two are mutually exclusive intents.
          const showLinkForm = isLinked ? reassigning : !watch('ready_to_list')
          return (
            <div>
              {isLinked ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-ghost py-1 px-2 text-xs"
                    onClick={() => { setReassigning(r => !r); setShopifyError(null) }}
                  >
                    Reassign via URL
                  </button>
                  <button type="button" className="btn-ghost py-1 px-2 text-xs text-red-400" onClick={() => setUnbinding(true)}>
                    Unbind
                  </button>
                </div>
              ) : showLinkForm && (
                <p className="text-xs text-gray-600 mb-2">Already exists on Shopify? Link it directly instead of pushing a new draft.</p>
              )}

              {showLinkForm && (
                <div className={isLinked ? 'space-y-2 border-t border-border pt-3 mt-3' : 'space-y-2'}>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1 text-xs"
                      placeholder="Paste the Shopify product URL…"
                      value={reassignUrl}
                      onChange={e => setReassignUrl(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && reassignUrl) void resolveReassignUrl() }}
                    />
                    <button
                      type="button"
                      className="btn-ghost text-xs shrink-0"
                      onClick={() => void resolveReassignUrl()}
                      disabled={!reassignUrl || reassignResolving}
                    >
                      {reassignResolving ? 'Resolving…' : 'Resolve'}
                    </button>
                  </div>

                  {reassignProduct && (
                    <div className="space-y-2">
                      <p className="text-xs text-gray-400">{reassignProduct.title}</p>
                      {reassignProduct.variants.length > 1 && (
                        <select className="input text-xs" value={reassignVariantId} onChange={e => setReassignVariantId(e.target.value)}>
                          {reassignProduct.variants.map(v => (
                            <option key={v.variantId} value={v.variantId}>{v.title} {v.sku ? `(${v.sku})` : ''}</option>
                          ))}
                        </select>
                      )}
                      <div className="flex justify-end">
                        <button
                          type="button"
                          className="btn-primary text-xs"
                          disabled={!reassignVariantId || reassignLinking}
                          onClick={() => void confirmReassign()}
                        >
                          {reassignLinking ? 'Linking…' : 'Confirm link'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        {shopifyError && (
          <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded px-2 py-1.5">{shopifyError}</p>
        )}
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

      <Confirm
        open={unbinding}
        onClose={() => setUnbinding(false)}
        onConfirm={() => void confirmUnbind()}
        title="Unbind Shopify Listing"
        message="This clears the link in UGIS only — the listing itself stays on Shopify untouched. You can relink it later via URL or the bulk match tool."
        danger
      />
    </form>
  )
}

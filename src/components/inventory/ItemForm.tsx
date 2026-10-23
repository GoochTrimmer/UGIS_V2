import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useItemMutations } from '../../hooks/useItems'
import { useConsignees } from '../../hooks/useConsignees'
import { useProfile } from '../../hooks/useProfile'
import { useBrands } from '../../hooks/useBrands'
import { useIssueStoreCredit, useLookupShopifyCustomer, useAdjustStoreCredit, useShopifyCustomers } from '../../hooks/useStoreCredit'
import { invokeEdgeFunction } from '../../lib/edgeFunctions'
import { isValidSgLocalPhone, toE164, fromE164 } from '../../lib/phone'
import BrandSelector from '../brands/BrandSelector'
import StatusTimeline from './StatusTimeline'
import ItemEditHistory from './ItemEditHistory'
import Modal from '../ui/Modal'
import Confirm from '../ui/Confirm'
import BrandForm from '../brands/BrandForm'
import ConsigneeForm from '../consignees/ConsigneeForm'
import { STATUS_CONFIG, SEASON_PERIODS, YEAR_OPTIONS, SALE_CHANNEL_CONFIG, SALE_GEOGRAPHY_CONFIG, PAYMENT_TYPE_CONFIG, paymentTypeHasFee } from '../../lib/constants'
import type { Item, Brand, ItemStatus, SeasonPeriod, SaleChannel, SaleGeography, PaymentType } from '../../types'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  quantity: string
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
  payment_type: PaymentType | ''
  card_fee: string
  notes: string
  ready_to_list: boolean
  scheduled_drop_at: string
  trade_in_cash_offer: string
  trade_in_credit_offer: string
  trade_in_choice: 'cash' | 'credit' | ''
}

// Store-credit issuance/adjustment lives here on the History tab rather
// than the Details tab — this is a deliberate operational action (tracking
// UGIS's actual cost and syncing the customer's real Shopify balance), not
// something that should happen implicitly as a side effect of editing the
// offer amount and hitting Save. Two distinct actions, never conflated:
// issuing (first time only) and adjusting (an already-issued amount).
function TradeInCreditManager({ item }: { item: Item }) {
  const customerIds = item.shopify_customer_id ? [item.shopify_customer_id] : []
  const { data: customersById, isLoading, isError } = useShopifyCustomers(customerIds)
  const customer = item.shopify_customer_id ? customersById?.get(item.shopify_customer_id) : undefined

  const issueStoreCredit = useIssueStoreCredit()
  const lookupCustomer = useLookupShopifyCustomer()
  const adjustStoreCredit = useAdjustStoreCredit()

  const [creditEmail, setCreditEmail] = useState('')
  const [creditPhone, setCreditPhone] = useState('')
  const [creditError, setCreditError] = useState<string | null>(null)
  const [lookupMessage, setLookupMessage] = useState<string | null>(null)
  // Locked once a lookup confirms a field against an actual Shopify
  // customer record — disables the input so a confirmed value can't be
  // fat-fingered into a mismatch afterwards. "Change" unlocks it again.
  const [emailLocked, setEmailLocked] = useState(false)
  const [phoneLocked, setPhoneLocked] = useState(false)

  const [adjustAmount, setAdjustAmount] = useState(String(item.trade_in_credit_offer ?? 0))
  const [adjustMessage, setAdjustMessage] = useState<string | null>(null)
  const [adjustError, setAdjustError] = useState<string | null>(null)
  // `item` is a snapshot passed in when the modal opened, not a live
  // subscription (same caveat as markFinished/retryShopifyPush below) — so
  // a successful adjustment overrides the displayed amount locally rather
  // than waiting on a prop refresh that won't arrive until the modal's
  // reopened, even though the query cache itself is invalidated correctly.
  const [displayAmount, setDisplayAmount] = useState(item.trade_in_credit_offer ?? 0)

  // Keeps both fields in sync if the offer changes underneath them (e.g.
  // the modal was reopened with fresher data) rather than holding on to
  // whatever was there at mount.
  useEffect(() => {
    setAdjustAmount(String(item.trade_in_credit_offer ?? 0))
    setDisplayAmount(item.trade_in_credit_offer ?? 0)
  }, [item.trade_in_credit_offer])

  const emailValid = EMAIL_RE.test(creditEmail.trim())
  const phoneValid = isValidSgLocalPhone(creditPhone.trim())

  const runCustomerLookup = async () => {
    setCreditError(null)
    setLookupMessage(null)
    if (!emailValid && !phoneValid) return

    try {
      const result = await lookupCustomer.mutateAsync({
        email: emailValid ? creditEmail.trim() : undefined,
        phone: phoneValid ? toE164(creditPhone.trim()) : undefined,
      })
      if (!result) {
        setLookupMessage('No matching customer found on Shopify — enter both fields manually.')
        return
      }

      // Shopify's record is the source of truth once matched — adopt it
      // over whatever was typed (it may have been a typo that's exactly why
      // the OR search still found them) and lock the field so it can't be
      // edited into a mismatch afterwards. A field Shopify doesn't have on
      // file is left as-is — whatever staff enter there gets attached to
      // this customer's profile when credit is issued.
      if (result.email) {
        setCreditEmail(result.email)
        setEmailLocked(true)
      }
      if (result.phone) {
        setCreditPhone(fromE164(result.phone))
        setPhoneLocked(true)
      }

      const missingEmail = !result.email
      const missingPhone = !result.phone
      setLookupMessage(
        missingEmail || missingPhone
          ? `Found ${result.displayName} on Shopify, but their profile has no ${missingEmail ? 'email' : 'phone number'} linked yet — enter it below and it'll be added to their profile when credit is issued.`
          : `Found ${result.displayName} on Shopify — both fields confirmed.`,
      )
    } catch (err) {
      setLookupMessage(err instanceof Error ? err.message : 'Lookup failed.')
    }
  }

  const runIssue = async () => {
    setCreditError(null)
    try {
      await issueStoreCredit.mutateAsync({
        itemId: item.id,
        customerEmail: creditEmail.trim() || undefined,
        customerPhone: toE164(creditPhone.trim()) || undefined,
      })
    } catch (err) {
      setCreditError(err instanceof Error ? err.message : 'Failed to issue store credit')
    }
  }

  const runAdjust = async () => {
    setAdjustError(null)
    setAdjustMessage(null)
    const newAmount = parseFloat(adjustAmount)
    if (!Number.isFinite(newAmount) || newAmount < 0) {
      setAdjustError('Enter a valid amount.')
      return
    }
    if (newAmount === displayAmount) {
      setAdjustError('That\'s already the current amount.')
      return
    }
    try {
      const result = await adjustStoreCredit.mutateAsync({ itemId: item.id, newAmount })
      const delta = Math.abs(newAmount - displayAmount).toFixed(2)
      setAdjustMessage(
        result?.direction
          ? `${result.direction === 'credit' ? 'Credited an additional' : 'Debited'} $${delta} on Shopify — new amount $${newAmount.toFixed(2)}.`
          : 'No change needed.',
      )
      setDisplayAmount(newAmount)
    } catch (err) {
      setAdjustError(err instanceof Error ? err.message : 'Failed to adjust store credit')
    }
  }

  return (
    <div>
      <label className="label mb-1.5">Store Credit</label>
      <div className="card px-3 py-3 space-y-3 text-sm">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Amount</span>
            <span className="text-white font-medium">${displayAmount.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Status</span>
            {item.shopify_store_credit_txn_id ? (
              <span className="text-emerald-400">✓ Issued</span>
            ) : (
              <span className="text-amber-400">Not yet issued</span>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-500 shrink-0">Customer</span>
            {!item.shopify_customer_id ? (
              <span className="text-gray-500">Not yet linked</span>
            ) : isLoading ? (
              <span className="text-gray-600">Looking up…</span>
            ) : customer ? (
              <span className="text-white text-right">
                {customer.displayName}
                {customer.email && <span className="block text-xs text-gray-500">{customer.email}</span>}
              </span>
            ) : (
              <span className="text-gray-500 text-xs font-mono truncate">
                {isError ? "Couldn't reach Shopify" : item.shopify_customer_id}
              </span>
            )}
          </div>
          {item.shopify_customer_admin_url && (
            <div className="flex justify-end">
              <a href={item.shopify_customer_admin_url} target="_blank" rel="noreferrer" className="text-xs text-gray-300 hover:text-white transition-colors">
                View customer on Shopify →
              </a>
            </div>
          )}
        </div>

        {item.shopify_store_credit_txn_id ? (
          <div className="pt-3 border-t border-border space-y-2">
            <p className="text-xs text-gray-600">
              Already issued. Adjusting the amount below credits or debits the difference directly on the
              customer's Shopify store credit balance and updates this item's cost — use this only to correct
              the trade-in's value, not as a general way to issue credit.
            </p>
            <div className="flex items-center gap-2">
              <input
                className="input text-xs"
                type="number"
                step="0.01"
                min="0"
                value={adjustAmount}
                onChange={e => { setAdjustAmount(e.target.value); setAdjustError(null); setAdjustMessage(null) }}
              />
              <button
                type="button"
                className="btn-primary text-xs shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={adjustStoreCredit.isPending}
                onClick={() => void runAdjust()}
              >
                {adjustStoreCredit.isPending ? 'Updating…' : 'Update Amount'}
              </button>
            </div>
            {adjustMessage && (
              <p className="text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-900/40 rounded px-2 py-1.5">{adjustMessage}</p>
            )}
            {adjustError && (
              <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded px-2 py-1.5">{adjustError}</p>
            )}
          </div>
        ) : !item.trade_in_credit_offer ? (
          <p className="pt-3 border-t border-border text-xs text-gray-600">
            Set a credit offer amount on the Details tab, then come back here to issue it.
          </p>
        ) : (
          <div className="pt-3 border-t border-border space-y-2">
            <p className="text-xs text-gray-600">
              Store credit attaches to a Shopify customer account — both an email and phone number are
              required. Fill in one and hit Look Up to check for an existing Shopify customer and autofill
              the other.
            </p>
            <div className="grid grid-cols-2 gap-2 items-start">
              <div>
                <input
                  className="input text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                  type="email"
                  placeholder="Customer email *"
                  value={creditEmail}
                  disabled={emailLocked}
                  onChange={e => { setCreditEmail(e.target.value); setCreditError(null); setLookupMessage(null) }}
                />
                {emailLocked && (
                  <button
                    type="button"
                    className="text-[10px] text-gray-500 hover:text-white transition-colors mt-1"
                    onClick={() => setEmailLocked(false)}
                  >
                    ✓ Confirmed via Shopify · change
                  </button>
                )}
              </div>
              <div>
                <div className="flex items-stretch">
                  <span className="shrink-0 flex items-center px-2 text-xs text-gray-500 bg-surface-2 border border-border border-r-0 rounded-l">
                    +65
                  </span>
                  <input
                    className="input text-xs rounded-l-none disabled:opacity-60 disabled:cursor-not-allowed"
                    type="tel"
                    inputMode="numeric"
                    placeholder="Phone *"
                    value={creditPhone}
                    disabled={phoneLocked}
                    onChange={e => { setCreditPhone(e.target.value.replace(/\D/g, '').slice(0, 8)); setCreditError(null); setLookupMessage(null) }}
                  />
                </div>
                {phoneLocked && (
                  <button
                    type="button"
                    className="text-[10px] text-gray-500 hover:text-white transition-colors mt-1"
                    onClick={() => setPhoneLocked(false)}
                  >
                    ✓ Confirmed via Shopify · change
                  </button>
                )}
              </div>
            </div>
            {!(emailLocked && phoneLocked) && (
              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn-ghost text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={lookupCustomer.isPending || (!emailValid && !phoneValid)}
                  onClick={() => void runCustomerLookup()}
                >
                  {lookupCustomer.isPending ? 'Looking up…' : 'Look Up on Shopify'}
                </button>
              </div>
            )}
            {lookupMessage && (
              <p className="text-xs text-gray-400 bg-surface-2 border border-border rounded px-2 py-1.5">{lookupMessage}</p>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                className="btn-primary text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={issueStoreCredit.isPending || !emailValid || !phoneValid}
                onClick={() => void runIssue()}
              >
                {issueStoreCredit.isPending ? 'Issuing…' : 'Issue Store Credit'}
              </button>
            </div>
            {creditError && (
              <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded px-2 py-1.5">{creditError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ItemForm({ item, onDone }: ItemFormProps) {
  const { create, createBatch, addUnits, update, markShopifyFinished, unbindShopify, pushShopifyDraft, linkShopifyProduct } = useItemMutations()
  const { profile, loading: profileLoading } = useProfile()
  const isConsigneeUser = profileLoading || profile.role === 'consignee' // assume the more restrictive role while unresolved
  const [tab, setTab] = useState<'details' | 'history'>('details')
  const { data: consignees = [] } = useConsignees()
  const { data: allBrands = [] } = useBrands()
  const [selectedBrands, setSelectedBrands] = useState<Brand[]>([])
  const [isConsigned, setIsConsigned] = useState(false)
  const [isTradeIn, setIsTradeIn] = useState(false)
  const [showNewBrand, setShowNewBrand] = useState(false)
  const [showNewConsignee, setShowNewConsignee] = useState(false)
  const [shopifyError, setShopifyError] = useState<string | null>(null)
  const [unbinding, setUnbinding] = useState(false)
  const [reassigning, setReassigning] = useState(false)
  const [reassignUrl, setReassignUrl] = useState('')
  const [reassignResolving, setReassignResolving] = useState(false)
  const [reassignProduct, setReassignProduct] = useState<ResolvedShopifyProduct | null>(null)
  const [reassignVariantId, setReassignVariantId] = useState('')
  const [addingUnits, setAddingUnits] = useState(false)
  const [addUnitsQty, setAddUnitsQty] = useState('1')
  const [addUnitsResult, setAddUnitsResult] = useState<{ ok: boolean; message: string } | null>(null)

  void allBrands

  const { register, handleSubmit, watch, reset, setValue, getValues, formState: { errors, isSubmitting } } = useForm<ItemFormValues>({
    defaultValues: {
      name: '', quantity: '1', size: '', status: 'in_stock', season_year: '', season_period: 'SS',
      season_custom: '', consignee_id: '', cost_amount: '', takeback_price: '',
      selling_price: '', sold_price: '', sale_channel: '', sale_geography: '',
      payment_type: '', card_fee: '', notes: '',
      ready_to_list: false, scheduled_drop_at: '',
      trade_in_cash_offer: '', trade_in_credit_offer: '', trade_in_choice: '',
    }
  })

  const storeConsignee = consignees.find(c => c.is_default_store) ?? null
  const consigneeOptions = consignees.filter(c => !c.is_default_store)

  const seasonPeriod = watch('season_period')
  const watchedConsigneeId = watch('consignee_id')
  const watchedStatus = watch('status')
  const watchedPaymentType = watch('payment_type')
  const watchedTradeInChoice = watch('trade_in_choice')
  const watchedTradeInCashOffer = watch('trade_in_cash_offer')
  const watchedTradeInCreditOffer = watch('trade_in_credit_offer')
  const watchedReadyToList = watch('ready_to_list')
  const previewQuantity = Math.max(1, parseInt(watch('quantity')) || 1)
  const sizeReg = register('size')
  const tradeInChoiceField = register('trade_in_choice')

  useEffect(() => {
    if (item) {
      const itemIsTradeIn = !!item.trade_in_choice || item.trade_in_cash_offer != null || item.trade_in_credit_offer != null
      const itemIsConsigned = !itemIsTradeIn && !!item.consignee && item.consignee.id !== storeConsignee?.id
      // A consignee account only ever reaches items that are already
      // theirs (RLS-scoped) — always treat those as consignment pieces,
      // regardless of what the stored trade-in/consignee fields say.
      setIsConsigned(isConsigneeUser ? true : itemIsConsigned)
      setIsTradeIn(itemIsTradeIn)
      reset({
        name: item.name,
        quantity: '1',
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
        payment_type: (item.payment_type ?? '') as PaymentType | '',
        card_fee: item.card_fee ? String(item.card_fee) : '',
        notes: item.notes ?? '',
        ready_to_list: item.ready_to_list,
        scheduled_drop_at: isoToDatetimeLocal(item.scheduled_drop_at),
        // != null (not the usual truthy check) — a genuine $0 offer must
        // still show as "0", not fall back to '' and silently disable the
        // Issue Store Credit button (which checks the watched value below).
        trade_in_cash_offer: item.trade_in_cash_offer != null ? String(item.trade_in_cash_offer) : '',
        trade_in_credit_offer: item.trade_in_credit_offer != null ? String(item.trade_in_credit_offer) : '',
        trade_in_choice: item.trade_in_choice ?? '',
      })
      setSelectedBrands(item.brands ?? [])
    } else {
      setIsConsigned(isConsigneeUser)
      setIsTradeIn(false)
      reset({
        name: '', quantity: '1', size: '', status: 'in_stock', season_year: '', season_period: 'SS',
        season_custom: '', consignee_id: isConsigneeUser ? (profile.consignee?.id ?? '') : (storeConsignee?.id ?? ''),
        cost_amount: '', takeback_price: '', selling_price: '', notes: '',
        ready_to_list: false, scheduled_drop_at: '',
        trade_in_cash_offer: '', trade_in_credit_offer: '', trade_in_choice: '',
      })
    }
    setShopifyError(null)
    setUnbinding(false)
    setReassigning(false)
    setReassignUrl('')
    setReassignProduct(null)
    setReassignVariantId('')
    setAddingUnits(false)
    setAddUnitsQty('1')
    setAddUnitsResult(null)
    setTab('details')
    // storeConsignee intentionally omitted — re-run only when item changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, reset])

  // When consignees first load for a new item, set the default consignee —
  // a consignee account always defaults to (and stays locked to) itself;
  // staff default to the store.
  useEffect(() => {
    if (!item && !watchedConsigneeId) {
      if (isConsigneeUser && profile.consignee) setValue('consignee_id', profile.consignee.id)
      else if (!isConsigneeUser && storeConsignee) setValue('consignee_id', storeConsignee.id)
    }
  }, [item, storeConsignee, watchedConsigneeId, setValue, isConsigneeUser, profile.consignee])

  const handleConsignedToggle = (checked: boolean) => {
    if (isConsigneeUser) return // locked — always a consignment piece under their own consignee
    setIsConsigned(checked)
    if (checked) {
      setIsTradeIn(false)
      setValue('consignee_id', '')
    } else {
      setValue('consignee_id', storeConsignee?.id ?? '')
    }
  }

  // Trade-in items are always store-owned (spec: the shop becomes sole
  // owner once credit/cash is paid out) — mutually exclusive with
  // consignment rather than a separate flag combination staff could
  // accidentally leave in an inconsistent state.
  const handleTradeInToggle = (checked: boolean) => {
    if (isConsigneeUser) return // trade-ins are always store-owned, not applicable to consignee accounts
    setIsTradeIn(checked)
    if (checked) {
      setIsConsigned(false)
      setValue('consignee_id', storeConsignee?.id ?? '')
    }
  }

  // Closes the moment a validated submit fires, rather than waiting on the
  // save (and any Shopify push) to finish first — the inventory list's own
  // loading fade already covers that wait, so sitting on the modal for it
  // too was redundant. The save itself still runs to completion in the
  // background; a failure at this point (network/DB, not a validation
  // problem — RHF already blocked those before onSubmit ever ran) is
  // logged rather than shown, since there's no longer a modal to show it
  // in. A failed Shopify push still leaves ready_to_list set with no
  // product linked, so the existing "Push to Shopify now" retry button
  // surfaces again next time the item's reopened.
  // Shared by onSubmit (create/update this item) and handleAddUnits (clone
  // the currently-edited values into N new sibling rows) — both need the
  // exact same field derivation, so it lives once.
  const buildPayload = (data: ItemFormValues) => {
    const effectiveConsignee = isConsigned
      ? (consignees.find(c => c.id === data.consignee_id) ?? null)
      : storeConsignee

    // A trade-in's cost basis IS the offer amount paid out — no separate
    // manual cost entry to keep in sync with it (see the Cost field in the
    // trade-in pricing block below). Null while the customer's choice is
    // still pending, since the true cost isn't settled yet.
    const tradeInCashOffer = isTradeIn && data.trade_in_cash_offer ? parseFloat(data.trade_in_cash_offer) : null
    const tradeInCreditOffer = isTradeIn && data.trade_in_credit_offer ? parseFloat(data.trade_in_credit_offer) : null
    const tradeInChoice = isTradeIn && data.trade_in_choice ? data.trade_in_choice : null
    const tradeInCost = tradeInChoice === 'cash' ? tradeInCashOffer : tradeInChoice === 'credit' ? tradeInCreditOffer : null

    return {
      name: data.name.trim(),
      size: data.size.trim() || null,
      status: data.status,
      season_year: data.season_year ? parseInt(data.season_year) : null,
      season_period: data.season_period || null,
      season_custom: data.season_period === 'Custom' ? data.season_custom.trim() : null,
      consignee_id: effectiveConsignee?.id ?? null,
      // Consignee accounts may record their own (optional) cost; staff keep
      // whatever a consignee entered on a consigned item rather than wiping it
      // (staff have no cost field of their own for consigned pieces — theirs
      // is the take-back price).
      cost_amount: isTradeIn
        ? tradeInCost
        : isConsigneeUser
          ? (data.cost_amount ? parseFloat(data.cost_amount) : null)
          : isConsigned
            ? (item?.cost_amount ?? null)
            : (data.cost_amount ? parseFloat(data.cost_amount) : null),
      takeback_price: isConsigned && data.takeback_price ? parseFloat(data.takeback_price) : null,
      selling_price: data.selling_price ? parseFloat(data.selling_price) : null,
      sold_price: data.status === 'sold' && data.sold_price ? parseFloat(data.sold_price) : null,
      sale_channel: (data.status === 'sold' && data.sale_channel) ? data.sale_channel : null,
      sale_geography: (data.status === 'sold' && data.sale_geography) ? data.sale_geography : null,
      payment_type: (data.status === 'sold' && data.payment_type) ? data.payment_type : null,
      card_fee: data.status === 'sold' && paymentTypeHasFee(data.payment_type) && data.card_fee ? parseFloat(data.card_fee) : null,
      notes: data.notes.trim() || null,
      ready_to_list: data.ready_to_list,
      scheduled_drop_at: datetimeLocalToIso(data.scheduled_drop_at),
      trade_in_cash_offer: tradeInCashOffer,
      trade_in_credit_offer: tradeInCreditOffer,
      trade_in_choice: tradeInChoice,
      brands: selectedBrands,
      consignee: effectiveConsignee,
    }
  }

  const onSubmit = (data: ItemFormValues) => {
    const payload = buildPayload(data)
    const shouldPushDraft = data.ready_to_list && !item?.shopify_product_id
    // Only meaningful on a brand-new item — "add 6 of the same ring" rather
    // than true variants, see createBatch in useItems.ts. Clamped here
    // (rather than relying on the input's min) since a cleared/invalid
    // field would otherwise produce NaN.
    const quantity = !item ? Math.max(1, parseInt(data.quantity) || 1) : 1

    onDone()

    void (async () => {
      try {
        let targetId: string
        if (item) {
          await update.mutateAsync({ id: item.id, readable_id: item.readable_id, ...payload })
          targetId = item.id
        } else if (quantity > 1) {
          const createdRows = await createBatch.mutateAsync({ ...payload, quantity })
          // If this batch is pushed to Shopify, it's pushed as one listing
          // (see shopify-create-draft) — any one unit's id works to drive
          // that, so the first is as good as any.
          targetId = createdRows[0].id
        } else {
          const created = await create.mutateAsync(payload)
          targetId = (created as { id: string }).id
        }
        if (shouldPushDraft) await pushToShopify(targetId)
      } catch (err) {
        console.error('[ItemForm] save failed', err)
      }
    })()
  }

  // Clones this item's current (saved + any unsaved edits in the form
  // right now) values into N new sibling rows, joining them into its
  // batch — a restock, not a new submit of this item. Doesn't close the
  // modal, so staff can keep editing or add more again.
  const handleAddUnits = async () => {
    if (!item) return
    const quantity = Math.max(1, parseInt(addUnitsQty) || 1)
    setAddUnitsResult(null)
    try {
      const payload = buildPayload(getValues())
      const createdRows = await addUnits.mutateAsync({
        ...payload,
        sourceItemId: item.id,
        sourceBatchId: item.batch_id,
        quantity,
      })
      setAddUnitsResult({ ok: true, message: `Added ${createdRows.length} more — ${createdRows.map(r => r.readable_id).join(', ')}` })
      setAddingUnits(false)
      setAddUnitsQty('1')
    } catch (err) {
      setAddUnitsResult({ ok: false, message: err instanceof Error ? err.message : 'Failed to add units' })
    }
  }

  const pushToShopify = async (itemId: string): Promise<boolean> => {
    setShopifyError(null)
    try {
      await pushShopifyDraft.mutateAsync({ itemId })
      return true
    } catch (err) {
      setShopifyError(err instanceof Error ? err.message : 'Failed to reach Shopify')
      return false
    }
  }

  const retryShopifyPush = async () => {
    if (!item) return
    const ok = await pushToShopify(item.id)
    if (ok) onDone()
  }

  const markFinished = async () => {
    if (!item?.shopify_product_id) return
    setShopifyError(null)
    try {
      await markShopifyFinished.mutateAsync({ id: item.id, shopifyProductId: item.shopify_product_id })
      onDone()
    } catch (err) {
      setShopifyError(err instanceof Error ? err.message : 'Failed to publish on Shopify')
    }
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
    setShopifyError(null)
    try {
      await linkShopifyProduct.mutateAsync({
        itemId: item.id,
        productId: reassignProduct.productId,
        variantId: reassignVariantId,
      })
      onDone()
    } catch (err) {
      setShopifyError(err instanceof Error ? err.message : 'Failed to reach Shopify')
    }
  }

  // ID preview: store-owned always shows UG, consigned shows selected consignee
  const previewConsigneeAbbr = isConsigned
    ? (consignees.find(c => c.id === watchedConsigneeId)?.abbreviation ?? null)
    : (storeConsignee?.abbreviation ?? null)

  // Button label reflects every side-effect this save will trigger, not
  // just "save the item" — a Shopify draft push otherwise happens silently
  // in the background, and staff should see that coming before they click.
  // Trade-in credit itself is issued/adjusted only from the History tab
  // now, deliberately — never as a side effect of a Details-tab save.
  const willPushToShopify = watchedReadyToList && !item?.shopify_product_id
  const addLabel = previewQuantity > 1 ? `Add ${previewQuantity} Items` : 'Add Item'
  const submitLabel = !willPushToShopify
    ? (item ? 'Save Changes' : addLabel)
    : `${item ? 'Save' : addLabel} & Publish to Shopify`

  // No tabs for a brand-new item — there's no history or sale to show yet,
  // so it just always renders the Details content below.
  const showDetails = !item || tab === 'details'
  const showHistory = !!item && tab === 'history'

  const saleDetailsSection = watchedStatus === 'sold' && (
    <div className="border border-border rounded-lg px-3 py-3 space-y-3 bg-surface-2/40">
      <div>
        <p className="text-xs font-medium text-white mb-0.5">Sale Details</p>
        <p className="text-xs text-gray-600">Actual price and channel — may differ from the listed price above.</p>
      </div>
      {item?.shopify_order_id && (
        <div className="flex items-center justify-between gap-2 text-xs bg-surface-2 border border-border rounded px-2.5 py-1.5">
          <span className="text-gray-400">Sold via Shopify checkout</span>
          {item.shopify_order_url && (
            <a href={item.shopify_order_url} target="_blank" rel="noreferrer" className="text-gray-300 hover:text-white transition-colors shrink-0">
              View order on Shopify →
            </a>
          )}
        </div>
      )}
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
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Payment Type</label>
          <select className="input" {...register('payment_type')}>
            <option value="">— unknown —</option>
            {(Object.entries(PAYMENT_TYPE_CONFIG) as [PaymentType, { label: string }][]).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
        {paymentTypeHasFee(watchedPaymentType) && (
          <div>
            <label className="label">Fee</label>
            <input className="input" type="number" step="0.01" {...register('card_fee')} placeholder="0.00" />
          </div>
        )}
      </div>
    </div>
  )

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {item && (
        <div className="flex gap-4 border-b border-border">
          <button
            type="button"
            onClick={() => setTab('details')}
            className={`px-1 pb-2 text-sm font-medium border-b-2 transition-colors ${tab === 'details' ? 'border-white text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
          >
            Details
          </button>
          <button
            type="button"
            onClick={() => setTab('history')}
            className={`px-1 pb-2 text-sm font-medium border-b-2 transition-colors ${tab === 'history' ? 'border-white text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
          >
            History
          </button>
        </div>
      )}

      {item?.trade_in_choice && (
        <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2.5 py-1.5 w-fit">
          <span>⇄</span>
          Traded in for {item.trade_in_choice === 'credit' ? 'store credit' : 'cash'} — $
          {(item.trade_in_choice === 'credit' ? item.trade_in_credit_offer : item.trade_in_cash_offer)?.toFixed(2)}
        </div>
      )}

      {showHistory && (
        <div className="space-y-5">
          {item!.trade_in_choice === 'credit' && <TradeInCreditManager item={item!} />}
          <div>
            <label className="label mb-1.5">Status History</label>
            <StatusTimeline itemId={item!.id} />
          </div>
          <div>
            <label className="label mb-1.5">Other Changes</label>
            <ItemEditHistory itemId={item!.id} />
          </div>
        </div>
      )}

      {showDetails && (
      <>
      {/* Name + Size (+ Quantity, new items only) */}
      <div className={`grid gap-2 ${item ? 'grid-cols-3' : 'grid-cols-4'}`}>
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
        {!item && (
          <div>
            <label className="label">Qty <span className="text-gray-600 font-normal">(identical units)</span></label>
            <input className="input font-mono" type="number" min={1} step={1} {...register('quantity')} placeholder="1" />
          </div>
        )}
      </div>

      {/* Add more units — restock an existing item, cloning its current
          values (including any unsaved edits above) into N new sibling
          rows rather than requiring a brand-new Add Item for each one. */}
      {item && (
        <div className="border border-border rounded-lg px-3 py-2.5">
          {!addingUnits ? (
            <button type="button" className="text-xs text-gray-400 hover:text-white transition-colors" onClick={() => { setAddingUnits(true); setAddUnitsResult(null) }}>
              + Add more units of this item
            </button>
          ) : (
            <div className="flex items-end gap-2 flex-wrap">
              <div>
                <label className="label">How many more?</label>
                <input
                  className="input font-mono w-24 h-8 py-0"
                  type="number" min={1} step={1}
                  value={addUnitsQty}
                  onChange={e => setAddUnitsQty(e.target.value)}
                  autoFocus
                />
              </div>
              <button
                type="button"
                className="btn-primary py-1 px-2 text-xs"
                disabled={addUnits.isPending}
                onClick={() => void handleAddUnits()}
              >
                {addUnits.isPending ? 'Adding…' : 'Add'}
              </button>
              <button type="button" className="btn-ghost py-1 px-2 text-xs" onClick={() => setAddingUnits(false)}>Cancel</button>
              <p className="text-xs text-gray-600 w-full">Uses this item's current values above — brand, price, consignee, etc.</p>
            </div>
          )}
          {addUnitsResult && (
            <p className={`text-xs mt-1.5 ${addUnitsResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>{addUnitsResult.message}</p>
          )}
        </div>
      )}

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

      {/* Consignment toggle — locked on for consignee accounts, who only
          ever manage their own consignment pieces */}
      {!isConsigneeUser && (
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
      )}

      {/* Trade-in toggle — not applicable to consignee accounts (trade-ins
          are always store-owned) */}
      {!isConsigneeUser && (
        <div className="flex items-center gap-3 py-1">
          <input
            id="is-trade-in"
            type="checkbox"
            className="w-4 h-4 rounded border-border bg-surface-2 accent-white cursor-pointer"
            checked={isTradeIn}
            onChange={e => handleTradeInToggle(e.target.checked)}
          />
          <label htmlFor="is-trade-in" className="text-sm text-gray-300 cursor-pointer select-none">
            Trade-in item
            <span className="text-gray-600 font-normal ml-1">(customer traded this in for cash or store credit — always store-owned)</span>
          </label>
        </div>
      )}

      {/* Trade-in appraisal — cash/credit offer, customer's choice, and
          (once credit is chosen) issuing the actual Shopify store credit. */}
      {isTradeIn && (
        <div className="border border-border rounded-lg px-3 py-3 space-y-3 bg-surface-2/40">
          <div>
            <label className="label">Customer Chose</label>
            <select
              className="input disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={!!item?.shopify_store_credit_txn_id}
              {...tradeInChoiceField}
              onChange={e => {
                void tradeInChoiceField.onChange(e)
                // Clear the other offer field so a stale value from a
                // since-abandoned choice can't linger into the cost basis.
                if (e.target.value === 'cash') setValue('trade_in_credit_offer', '')
                else if (e.target.value === 'credit') setValue('trade_in_cash_offer', '')
              }}
            >
              <option value="">— pending customer decision —</option>
              <option value="cash">Cash</option>
              <option value="credit">Store Credit</option>
            </select>
          </div>

          {watchedTradeInChoice === 'cash' && (
            <div>
              <label className="label">Cash Offer</label>
              <input className="input" type="number" step="0.01" {...register('trade_in_cash_offer')} placeholder="0.00" />
            </div>
          )}

          {watchedTradeInChoice === 'credit' && (
            <div>
              <label className="label">Credit Offer</label>
              <input
                className="input disabled:opacity-60 disabled:cursor-not-allowed"
                type="number"
                step="0.01"
                disabled={!!item?.shopify_store_credit_txn_id}
                {...register('trade_in_credit_offer')}
                placeholder="0.00"
              />
            </div>
          )}

          {!watchedTradeInChoice && (
            <p className="text-xs text-gray-600">Select cash or store credit to enter the offer amount.</p>
          )}

          {watchedTradeInChoice === 'credit' && item?.shopify_store_credit_txn_id && (
            <p className="text-xs text-gray-600">
              Already issued — adjust the amount from the History tab rather than editing it here, so the
              customer's actual Shopify balance stays in sync with this record.
            </p>
          )}
        </div>
      )}

      {/* Consignee selector — staff only. A consignee account's items always
          belong to its own consignee (set automatically on create, enforced
          by RLS), so there's nothing for them to choose or see here. */}
      {isConsigned && !isConsigneeUser && (
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
        <div className="space-y-2">
          <div className={`grid gap-2 ${isConsigneeUser ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {isConsigneeUser && (
              <div>
                <label className="label">Cost <span className="text-gray-600 font-normal">(optional)</span></label>
                <input className="input" type="number" step="0.01" {...register('cost_amount')} placeholder="0.00" />
              </div>
            )}
            <div>
              <label className="label">Take-back Price</label>
              <input className="input" type="number" step="0.01" {...register('takeback_price')} placeholder="0.00" />
            </div>
            <div>
              <label className="label">Selling Price</label>
              <input className="input" type="number" step="0.01" {...register('selling_price')} placeholder="0.00" />
            </div>
          </div>
          {!isConsigneeUser && item?.cost_amount != null && (
            <p className="text-xs text-gray-500">
              Consignee's recorded cost: <span className="text-gray-300">${Number(item.cost_amount).toFixed(2)}</span>
            </p>
          )}
        </div>
      ) : isTradeIn ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Cost <span className="text-gray-600 font-normal">(from trade-in offer)</span></label>
            <div className="input flex items-center text-gray-400 cursor-not-allowed">
              {watchedTradeInChoice === 'credit' && watchedTradeInCreditOffer ? `$${Number(watchedTradeInCreditOffer).toFixed(2)}`
                : watchedTradeInChoice === 'cash' && watchedTradeInCashOffer ? `$${Number(watchedTradeInCashOffer).toFixed(2)}`
                : '— pending customer choice —'}
            </div>
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

      {saleDetailsSection}

      {/* Shopify listing — Shopify is Upstairs Garments-only, not exposed
          to consignee accounts at all */}
      {!isConsigneeUser && (
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
                <button
                  type="button"
                  className="btn-ghost py-1 px-2 text-xs"
                  disabled={markShopifyFinished.isPending}
                  onClick={() => void markFinished()}
                >
                  {markShopifyFinished.isPending ? 'Publishing…' : 'Mark as finished'}
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
                disabled={pushShopifyDraft.isPending}
                onClick={() => void retryShopifyPush()}
              >
                {pushShopifyDraft.isPending ? 'Pushing…' : 'Push to Shopify now'}
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
                          disabled={!reassignVariantId || linkShopifyProduct.isPending}
                          onClick={() => void confirmReassign()}
                        >
                          {linkShopifyProduct.isPending ? 'Linking…' : 'Confirm link'}
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
      )}

      {/* Notes */}
      <div>
        <label className="label">Notes</label>
        <textarea className="input resize-none" rows={3} {...register('notes')} placeholder="Condition, provenance, details…" />
      </div>

      {/* ID preview */}
      {selectedBrands.length > 0 && !item && (
        <div className="text-xs text-gray-500 bg-surface-2 border border-border rounded px-3 py-2">
          <span className="text-gray-600">{previewQuantity > 1 ? `ID preview (×${previewQuantity}): ` : 'ID preview: '}</span>
          <span className="font-mono text-gray-300">
            {selectedBrands.map(b => b.abbreviation).join('-')}
            {previewConsigneeAbbr ? `-${previewConsigneeAbbr}` : ''}
            -NN{previewQuantity > 1 ? ' … -NN' : ''}
          </span>
        </div>
      )}
      </>
      )}

      <div className="flex gap-2 justify-end pt-2">
        <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={isSubmitting}>
          {submitLabel}
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
        onConfirm={() => confirmUnbind()}
        title="Unbind Shopify Listing"
        message="This clears the link in UGIS only — the listing itself stays on Shopify untouched. You can relink it later via URL or the bulk match tool."
        danger
      />
    </form>
  )
}

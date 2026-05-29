import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { generateReadableId } from '../lib/idGenerator'
import { buildSnapshot, computeDiff, writeItemLog } from '../lib/itemLog'
import type { Item, Brand, Consignee, ItemFilters, ItemStatus, ItemSnapshot, SaleChannel, SaleGeography } from '../types'

const ITEM_SELECT = `
  *,
  consignee:consignees(id, name, abbreviation, is_default_store),
  item_brands(
    sort_order,
    brand:brands(id, name, abbreviation, parent_id)
  )
`

interface RawItemBrand {
  sort_order: number
  brand: Brand
}

interface RawItem extends Omit<Item, 'brands'> {
  item_brands: RawItemBrand[]
}

function normalizeItem(row: RawItem): Item {
  const { item_brands, ...rest } = row
  const brands = (item_brands ?? [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(ib => ib.brand)
  return { ...rest, brands } as Item
}

type ServerFilters = Omit<ItemFilters, 'search'>

async function fetchItems(filters: ServerFilters = {}): Promise<Item[]> {
  let query = supabase
    .from('items')
    .select(ITEM_SELECT)
    .order('created_at', { ascending: false })

  if (filters.status) query = query.eq('status', filters.status)
  if (filters.consignee_id) query = query.eq('consignee_id', filters.consignee_id)

  const { data, error } = await query
  if (error) throw error

  let items = (data as unknown as RawItem[]).map(normalizeItem)

  if (filters.brand_ids && filters.brand_ids.length > 0) {
    const brandSet = new Set(filters.brand_ids)
    items = items.filter(item => item.brands.some(b => brandSet.has(b.id)))
  }

  return items
}

export function useItems(filters?: ItemFilters) {
  const { search, ...serverFilters } = filters ?? {}

  return useQuery({
    queryKey: ['items', serverFilters],
    queryFn: () => fetchItems(serverFilters),
    placeholderData: keepPreviousData,
    select: search
      ? (data: Item[]) => data.filter(item =>
          item.name.toLowerCase().includes(search.toLowerCase()) ||
          item.readable_id.toLowerCase().includes(search.toLowerCase())
        )
      : undefined,
  })
}

export function useItem(id: string | undefined) {
  return useQuery({
    queryKey: ['item', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items')
        .select(ITEM_SELECT)
        .eq('id', id as string)
        .single()
      if (error) throw error
      return normalizeItem(data as unknown as RawItem)
    },
    enabled: !!id,
  })
}

interface CreateItemInput {
  name: string
  size: string | null
  status: ItemStatus
  season_year: number | null
  season_period: string | null
  season_custom: string | null
  consignee_id: string | null
  cost_amount: number | null
  takeback_price: number | null
  selling_price: number | null
  sold_price: number | null
  sale_channel: SaleChannel | null
  sale_geography: SaleGeography | null
  notes: string | null
  brands: Pick<Brand, 'id' | 'name' | 'abbreviation'>[]
  consignee: Pick<Consignee, 'id' | 'name' | 'abbreviation'> | null
}

interface UpdateItemInput extends CreateItemInput {
  id: string
  readable_id: string
}

export function useItemMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['items'] })
  const invalidateLogs = () => qc.invalidateQueries({ queryKey: ['item_logs'] })

  const create = useMutation({
    mutationFn: async ({ brands, consignee, ...item }: CreateItemInput) => {
      const brandAbbrs = brands.map(b => b.abbreviation)
      const consigneeAbbr = consignee?.abbreviation ?? null
      const readableId = await generateReadableId(brandAbbrs, consigneeAbbr)

      const { data, error } = await supabase
        .from('items')
        .insert({ ...item, readable_id: readableId })
        .select()
        .single()
      if (error) throw error

      const insertedId = (data as { id: string }).id

      if (brands.length > 0) {
        const brandRows = brands.map((b, i) => ({
          item_id: insertedId,
          brand_id: b.id,
          sort_order: i,
        }))
        const { error: bErr } = await supabase.from('item_brands').insert(brandRows)
        if (bErr) throw bErr
      }

      const snapshot: ItemSnapshot = {
        id: insertedId,
        name: item.name,
        size: item.size,
        status: item.status,
        season_year: item.season_year,
        season_period: item.season_period,
        season_custom: item.season_custom,
        cost_amount: item.cost_amount,
        takeback_price: item.takeback_price,
        selling_price: item.selling_price,
        sold_price: item.sold_price,
        sale_channel: item.sale_channel,
        sale_geography: item.sale_geography,
        notes: item.notes,
        readable_id: readableId,
        consignee_id: item.consignee_id,
        brands: brands.map(b => ({ id: b.id, name: b.name, abbreviation: b.abbreviation })),
        consignee: consignee ? { id: consignee.id, name: consignee.name, abbreviation: consignee.abbreviation } : null,
      }
      await writeItemLog({
        item_id: insertedId,
        item_name: item.name,
        field_changes: { _action: { from: null, to: 'created' } },
        snapshot_before: snapshot,
      })

      return data
    },
    onSuccess: () => {
      invalidate()
      invalidateLogs()
    },
  })

  const update = useMutation({
    mutationFn: async ({ id, brands, consignee, readable_id: currentReadableId, ...item }: UpdateItemInput) => {
      // Fetch current state for audit log before making changes
      const { data: currentRaw } = await supabase.from('items').select(ITEM_SELECT).eq('id', id).single()
      const currentItem = currentRaw ? normalizeItem(currentRaw as unknown as RawItem) : null

      const oldPrefix = currentReadableId.replace(/-\d+$/, '')
      const newParts = [
        ...brands.map(b => b.abbreviation),
        ...(consignee ? [consignee.abbreviation] : []),
      ]
      const newPrefix = newParts.join('-')

      let newReadableId = currentReadableId
      if (newPrefix && newPrefix !== oldPrefix) {
        newReadableId = await generateReadableId(
          brands.map(b => b.abbreviation),
          consignee?.abbreviation ?? null,
        )
      }

      const { error } = await supabase.from('items').update({ ...item, readable_id: newReadableId }).eq('id', id)
      if (error) throw error

      await supabase.from('item_brands').delete().eq('item_id', id)
      if (brands && brands.length > 0) {
        const brandRows = brands.map((b, i) => ({
          item_id: id,
          brand_id: b.id,
          sort_order: i,
        }))
        const { error: bErr } = await supabase.from('item_brands').insert(brandRows)
        if (bErr) throw bErr
      }

      if (currentItem) {
        const snapshot = buildSnapshot(currentItem)
        const changes = computeDiff(snapshot, { ...item, consignee_id: consignee?.id ?? null, consignee, brands })
        if (Object.keys(changes).length > 0) {
          await writeItemLog({ item_id: id, item_name: currentItem.name, field_changes: changes, snapshot_before: snapshot })
        }
      }
    },
    onSuccess: (_, vars) => {
      invalidate()
      invalidateLogs()
      qc.invalidateQueries({ queryKey: ['item', vars.id] })
    },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, sold_price, sale_channel, sale_geography }: {
      id: string
      status: ItemStatus
      sold_price?: number | null
      sale_channel?: SaleChannel | null
      sale_geography?: SaleGeography | null
    }) => {
      const { data: currentRaw } = await supabase.from('items').select(ITEM_SELECT).eq('id', id).single()
      const currentItem = currentRaw ? normalizeItem(currentRaw as unknown as RawItem) : null

      const patch: Record<string, unknown> = { status }
      if (sold_price !== undefined) patch.sold_price = sold_price
      if (sale_channel !== undefined) patch.sale_channel = sale_channel
      if (sale_geography !== undefined) patch.sale_geography = sale_geography

      const { error } = await supabase.from('items').update(patch).eq('id', id)
      if (error) throw error

      if (currentItem) {
        const snapshot = buildSnapshot(currentItem)
        const changes: Record<string, { from: unknown; to: unknown }> = {}
        if (currentItem.status !== status) changes.status = { from: currentItem.status, to: status }
        if (sold_price !== undefined && currentItem.sold_price !== sold_price) {
          changes.sold_price = { from: currentItem.sold_price, to: sold_price }
        }
        if (sale_channel !== undefined && currentItem.sale_channel !== sale_channel) {
          changes.sale_channel = { from: currentItem.sale_channel, to: sale_channel }
        }
        if (sale_geography !== undefined && currentItem.sale_geography !== sale_geography) {
          changes.sale_geography = { from: currentItem.sale_geography, to: sale_geography }
        }
        if (Object.keys(changes).length > 0) {
          await writeItemLog({ item_id: id, item_name: currentItem.name, field_changes: changes, snapshot_before: snapshot })
        }
      }
    },
    onSuccess: () => {
      invalidate()
      invalidateLogs()
    },
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data: currentRaw } = await supabase.from('items').select(ITEM_SELECT).eq('id', id).single()
      const currentItem = currentRaw ? normalizeItem(currentRaw as unknown as RawItem) : null

      // Log BEFORE deleting — FK constraint requires the item to still exist at insert time.
      // After deletion, ON DELETE SET NULL will null out item_id automatically.
      if (currentItem) {
        await writeItemLog({
          item_id: id,
          item_name: currentItem.name,
          field_changes: { _action: { from: null, to: 'deleted' } },
          snapshot_before: buildSnapshot(currentItem),
        })
      }

      const { error } = await supabase.from('items').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidate()
      invalidateLogs()
    },
  })

  return { create, update, updateStatus, remove }
}

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { generateReadableId } from '../lib/idGenerator'
import type { Item, Brand, Consignee, ItemFilters, ItemStatus } from '../types'

const ITEM_SELECT = `
  *,
  consignee:consignees(id, name, abbreviation),
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
  notes: string | null
  brands: Brand[]
  consignee: Pick<Consignee, 'id' | 'name' | 'abbreviation'> | null
}

interface UpdateItemInput extends CreateItemInput {
  id: string
  readable_id: string
}

export function useItemMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['items'] })

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

      if (brands.length > 0) {
        const insertedId = (data as { id: string }).id
        const brandRows = brands.map((b, i) => ({
          item_id: insertedId,
          brand_id: b.id,
          sort_order: i,
        }))
        const { error: bErr } = await supabase.from('item_brands').insert(brandRows)
        if (bErr) throw bErr
      }

      return data
    },
    onSuccess: invalidate,
  })

  const update = useMutation({
    mutationFn: async ({ id, brands, consignee, readable_id: currentReadableId, ...item }: UpdateItemInput) => {
      // Regenerate readable_id if brands or consignee changed (both affect the prefix)
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
    },
    onSuccess: (_, vars) => {
      invalidate()
      qc.invalidateQueries({ queryKey: ['item', vars.id] })
    },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ItemStatus }) => {
      const { error } = await supabase.from('items').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('items').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  return { create, update, updateStatus, remove }
}

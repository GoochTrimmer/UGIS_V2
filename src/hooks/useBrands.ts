import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { extractSequence } from '../lib/importUtils'
import type { Brand } from '../types'

interface ItemForRegen {
  id: string
  readable_id: string
  consignee: { abbreviation: string } | null
  item_brands: Array<{ sort_order: number; brand: { abbreviation: string } }>
}

type BrandInsert = Omit<Brand, 'id' | 'created_at'>
type BrandUpdate = Pick<Brand, 'id'> & Partial<BrandInsert>

async function fetchBrands(): Promise<Brand[]> {
  const { data, error } = await supabase
    .from('brands')
    .select('*')
    .order('name')
  if (error) throw error
  return data as Brand[]
}

export function useBrands() {
  return useQuery({ queryKey: ['brands'], queryFn: fetchBrands })
}

export function useBrandMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['brands'] })

  const create = useMutation({
    mutationFn: async (brand: BrandInsert) => {
      const { data, error } = await supabase.from('brands').insert(brand).select().single()
      if (error) throw error
      return data as Brand
    },
    onSuccess: invalidate,
  })

  const update = useMutation({
    mutationFn: async ({ id, ...brand }: BrandUpdate) => {
      const { data, error } = await supabase.from('brands').update(brand).eq('id', id).select().single()
      if (error) throw error
      return data as Brand
    },
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('brands').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const regenerateIds = useMutation({
    mutationFn: async (brandId: string) => {
      const { data: links, error: linksErr } = await supabase
        .from('item_brands')
        .select('item_id')
        .eq('brand_id', brandId)
      if (linksErr) throw linksErr

      const itemIds = (links ?? []).map(l => (l as { item_id: string }).item_id)
      if (itemIds.length === 0) return 0

      const { data: items, error: itemsErr } = await supabase
        .from('items')
        .select('id, readable_id, consignee:consignees(abbreviation), item_brands(sort_order, brand:brands(abbreviation))')
        .in('id', itemIds)
      if (itemsErr) throw itemsErr

      const rows = (items ?? []) as unknown as ItemForRegen[]
      for (const item of rows) {
        const seq = extractSequence(item.readable_id)
        const brandAbbrs = [...item.item_brands]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(ib => ib.brand.abbreviation)
        const consigneeAbbr = item.consignee?.abbreviation ?? null
        const parts = consigneeAbbr ? [...brandAbbrs, consigneeAbbr] : brandAbbrs
        const newId = `${parts.join('-')}-${seq}`
        if (newId === item.readable_id) continue
        const { error } = await supabase.from('items').update({ readable_id: newId }).eq('id', item.id)
        if (error) throw error
      }

      return rows.length
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['items'] })
    },
  })

  return { create, update, remove, regenerateIds }
}

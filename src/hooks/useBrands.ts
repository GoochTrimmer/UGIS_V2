import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Brand } from '../types'

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

  return { create, update, remove }
}

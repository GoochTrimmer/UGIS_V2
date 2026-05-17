import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useBrands, useBrandMutations } from '../../hooks/useBrands'
import type { Brand } from '../../types'

interface BrandFormProps {
  brand?: Brand
  onDone: () => void
}

interface BrandFormValues {
  name: string
  abbreviation: string
  aliases: string
  parent_id: string
}

export default function BrandForm({ brand, onDone }: BrandFormProps) {
  const { data: brands = [] } = useBrands()
  const { create, update, regenerateIds } = useBrandMutations()
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<BrandFormValues>()
  const originalAbbrRef = useRef('')

  useEffect(() => {
    if (brand) {
      originalAbbrRef.current = brand.abbreviation
      reset({
        name: brand.name,
        abbreviation: brand.abbreviation,
        aliases: (brand.aliases ?? []).join(', '),
        parent_id: brand.parent_id ?? '',
      })
    } else {
      reset({ name: '', abbreviation: '', aliases: '', parent_id: '' })
    }
  }, [brand, reset])

  const onSubmit = async (data: BrandFormValues) => {
    const newAbbr = data.abbreviation.trim().toUpperCase()
    const payload = {
      name: data.name.trim(),
      abbreviation: newAbbr,
      aliases: data.aliases ? data.aliases.split(',').map(a => a.trim()).filter(Boolean) : [],
      parent_id: data.parent_id || null,
    }
    if (brand) {
      await update.mutateAsync({ id: brand.id, ...payload })
      if (newAbbr !== originalAbbrRef.current) {
        await regenerateIds.mutateAsync(brand.id)
      }
    } else {
      await create.mutateAsync(payload)
    }
    onDone()
  }

  const mutationError = create.error ?? update.error
  if (mutationError) console.error('[BrandForm]', mutationError)

  function friendlyError(err: unknown): string {
    const code = (err as { code?: string }).code ?? ''
    const msg = (err as { message?: string }).message ?? ''
    if (code === '23505' || msg.includes('duplicate key')) {
      if (msg.includes('abbreviation')) return 'Duplicate abbreviation — choose a different one.'
      return 'A brand with those details already exists.'
    }
    return 'Something went wrong. Please try again.'
  }

  const parentOptions = brands.filter(b => !brand || b.id !== brand.id)

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {mutationError && (
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded px-3 py-2">
          {friendlyError(mutationError)}
        </div>
      )}
      <div>
        <label className="label">Brand Name *</label>
        <input
          className="input"
          {...register('name', {
            required: 'Required',
            validate: v => {
              const norm = v.trim().toLowerCase()
              const dupe = brands.find(b => b.name.toLowerCase() === norm && b.id !== brand?.id)
              return dupe ? 'A brand with this name already exists.' : true
            },
          })}
          placeholder="Comme des Garçons"
        />
        {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name.message}</p>}
      </div>
      <div>
        <label className="label">Abbreviation * <span className="text-gray-600 font-normal">(used in IDs, e.g. CDG)</span></label>
        <input
          className="input font-mono uppercase"
          {...register('abbreviation', {
            required: 'Required',
            validate: v => {
              const norm = v.trim().toUpperCase()
              const dupe = brands.find(b => b.abbreviation === norm && b.id !== brand?.id)
              return dupe ? 'Duplicate abbreviation — choose a different one.' : true
            },
          })}
          placeholder="CDG"
        />
        {errors.abbreviation && <p className="text-xs text-red-400 mt-1">{errors.abbreviation.message}</p>}
      </div>
      <div>
        <label className="label">Aliases <span className="text-gray-600 font-normal">(comma-separated)</span></label>
        <input className="input" {...register('aliases')} placeholder="comme des garcons, CDG" />
      </div>
      <div>
        <label className="label">Parent Brand <span className="text-gray-600 font-normal">(for sublines)</span></label>
        <select className="input" {...register('parent_id')}>
          <option value="">None (top-level brand)</option>
          {parentOptions.map(b => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2 justify-end pt-2">
        <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={isSubmitting || regenerateIds.isPending}>
          {regenerateIds.isPending ? 'Updating IDs…' : isSubmitting ? 'Saving…' : brand ? 'Save Changes' : 'Create Brand'}
        </button>
      </div>
    </form>
  )
}

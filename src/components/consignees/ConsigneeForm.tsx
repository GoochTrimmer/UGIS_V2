import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useConsigneeMutations } from '../../hooks/useConsignees'
import type { Consignee } from '../../types'

interface ConsigneeFormProps {
  consignee?: Consignee
  onDone: () => void
}

interface ConsigneeFormValues {
  name: string
  abbreviation: string
  contact: string
  notes: string
}

export default function ConsigneeForm({ consignee, onDone }: ConsigneeFormProps) {
  const { create, update } = useConsigneeMutations()
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<ConsigneeFormValues>()

  useEffect(() => {
    reset(consignee
      ? { name: consignee.name, abbreviation: consignee.abbreviation, contact: consignee.contact ?? '', notes: consignee.notes ?? '' }
      : { name: '', abbreviation: '', contact: '', notes: '' }
    )
  }, [consignee, reset])

  const onSubmit = async (data: ConsigneeFormValues) => {
    const payload = {
      name: data.name.trim(),
      abbreviation: data.abbreviation.trim().toUpperCase(),
      contact: data.contact.trim() || null,
      notes: data.notes.trim() || null,
    }
    if (consignee) await update.mutateAsync({ id: consignee.id, ...payload })
    else await create.mutateAsync(payload)
    onDone()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="label">Name *</label>
        <input className="input" {...register('name', { required: true })} placeholder="Allan" />
        {errors.name && <p className="text-xs text-red-400 mt-1">Required</p>}
      </div>
      <div>
        <label className="label">Abbreviation * <span className="text-gray-600 font-normal">(used in IDs, e.g. AL)</span></label>
        <input className="input font-mono uppercase" {...register('abbreviation', { required: true })} placeholder="AL" />
        {errors.abbreviation && <p className="text-xs text-red-400 mt-1">Required</p>}
      </div>
      <div>
        <label className="label">Contact</label>
        <input className="input" {...register('contact')} placeholder="Phone, email, Instagram…" />
      </div>
      <div>
        <label className="label">Notes</label>
        <input className="input" {...register('notes')} placeholder="Terms, preferences…" />
      </div>
      <div className="flex gap-2 justify-end pt-2">
        <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : consignee ? 'Save Changes' : 'Create Consignee'}
        </button>
      </div>
    </form>
  )
}

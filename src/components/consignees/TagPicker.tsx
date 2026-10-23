import { useState } from 'react'
import { useConsignees } from '../../hooks/useConsignees'
import { useConsigneeTags, useConsigneeTagMutations } from '../../hooks/useConsigneeTags'
import Confirm from '../ui/Confirm'
import type { Consignee } from '../../types'

// Assign/unassign tags (Vendor, Stockist, custom, or the special Store
// tag) on one consignee. Store is handled differently from every other
// tag: it can only ever belong to one consignee (see sync_store_tag
// trigger, migration 018), so assigning it here moves it rather than just
// adding it, and it can't be removed outright — only reassigned elsewhere.
export default function TagPicker({ consignee }: { consignee: Consignee }) {
  const { data: allTags = [] } = useConsigneeTags()
  const { data: consignees = [] } = useConsignees()
  const { createTag, assignTag, unassignTag } = useConsigneeTagMutations()
  const [adding, setAdding] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmingStoreMove, setConfirmingStoreMove] = useState<{ tagId: string; fromName: string } | null>(null)

  const assignedIds = new Set(consignee.tags.map(t => t.id))
  const available = allTags.filter(t => !assignedIds.has(t.id))
  const currentStoreHolder = consignees.find(c => c.is_default_store && c.id !== consignee.id)

  const doAssign = async (tagId: string) => {
    setError(null)
    try {
      await assignTag.mutateAsync({ consigneeId: consignee.id, tagId })
      setAdding(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign tag')
    }
  }

  const handlePick = (tagId: string) => {
    const tag = allTags.find(t => t.id === tagId)
    if (tag?.is_store && currentStoreHolder) {
      setConfirmingStoreMove({ tagId, fromName: currentStoreHolder.name })
      return
    }
    void doAssign(tagId)
  }

  const handleCreate = async () => {
    const name = newTagName.trim()
    if (!name) return
    setError(null)
    try {
      const tag = await createTag.mutateAsync(name)
      await doAssign(tag.id)
      setNewTagName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tag')
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {consignee.tags.length === 0 && <span className="text-xs text-gray-700">No tags</span>}
        {consignee.tags.map(tag => (
          <span
            key={tag.id}
            className={`inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 border ${
              tag.is_store ? 'border-amber-500/40 bg-amber-500/10 text-amber-400' : 'border-border bg-surface-3 text-gray-300'
            }`}
          >
            {tag.name}
            {!tag.is_store && (
              <button
                type="button"
                className="text-gray-500 hover:text-red-400"
                onClick={() => unassignTag.mutate({ consigneeId: consignee.id, tagId: tag.id })}
                title="Remove tag"
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>

      {error && <p className="text-xs text-red-400 mb-1.5">{error}</p>}

      {!adding ? (
        <button type="button" className="text-xs text-gray-500 hover:text-white transition-colors" onClick={() => setAdding(true)}>
          + Add tag
        </button>
      ) : (
        <div className="space-y-1.5">
          {available.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {available.map(tag => (
                <button
                  key={tag.id}
                  type="button"
                  className="text-xs rounded-full px-2 py-0.5 border border-border text-gray-400 hover:border-gray-500 hover:text-white transition-colors"
                  onClick={() => handlePick(tag.id)}
                  disabled={assignTag.isPending}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <input
              className="input h-7 text-xs py-0 w-36"
              placeholder="New tag name…"
              value={newTagName}
              onChange={e => setNewTagName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleCreate() } }}
            />
            <button type="button" className="btn-ghost py-0.5 px-2 text-xs" disabled={!newTagName.trim() || createTag.isPending} onClick={() => void handleCreate()}>
              Create
            </button>
            <button type="button" className="btn-ghost py-0.5 px-2 text-xs text-gray-500" onClick={() => { setAdding(false); setNewTagName(''); setError(null) }}>
              Done
            </button>
          </div>
        </div>
      )}

      <Confirm
        open={!!confirmingStoreMove}
        onClose={() => setConfirmingStoreMove(null)}
        onConfirm={() => doAssign(confirmingStoreMove!.tagId)}
        title="Move Store Designation"
        message={`"${confirmingStoreMove?.fromName}" is currently the store — new items default to it, and it's excluded from "wipe all data". Moving Store to "${consignee.name}" removes that designation from ${confirmingStoreMove?.fromName}. Continue?`}
        danger
      />
    </div>
  )
}

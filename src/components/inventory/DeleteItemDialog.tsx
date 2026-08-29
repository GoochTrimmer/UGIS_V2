import { useEffect, useState } from 'react'
import { useItemMutations } from '../../hooks/useItems'
import { invokeEdgeFunction } from '../../lib/edgeFunctions'
import Modal from '../ui/Modal'
import Confirm from '../ui/Confirm'
import type { Item } from '../../types'

interface DeleteItemDialogProps {
  item: Item | null
  onClose: () => void
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Live',
  DRAFT: 'Draft',
  ARCHIVED: 'Archived',
}

export default function DeleteItemDialog({ item, onClose }: DeleteItemDialogProps) {
  const { remove } = useItemMutations()
  const [shopifyStatus, setShopifyStatus] = useState<string | null>(null)
  const [checkingStatus, setCheckingStatus] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<'ugis' | 'both' | null>(null)

  useEffect(() => {
    setShopifyStatus(null)
    setError(null)
    setDeleting(null)
    if (item?.shopify_product_id) {
      setCheckingStatus(true)
      void invokeEdgeFunction<{ status: string | null }>('shopify-delete-product', {
        productId: item.shopify_product_id,
        action: 'status',
      }).then(({ data, error }) => {
        setCheckingStatus(false)
        if (error) { setError(error); return }
        setShopifyStatus(data?.status ?? null)
      })
    }
  }, [item])

  if (!item) return null

  // Not linked to Shopify — nothing extra to warn about.
  if (!item.shopify_product_id) {
    return (
      <Confirm
        open
        onClose={onClose}
        onConfirm={() => remove.mutateAsync(item.id)}
        title="Delete Item"
        message={`Delete "${item.name}" (${item.readable_id})? This cannot be undone.`}
        danger
      />
    )
  }

  const deleteUgisOnly = async () => {
    setDeleting('ugis')
    await remove.mutateAsync(item.id)
    setDeleting(null)
    onClose()
  }

  const deleteBoth = async () => {
    setDeleting('both')
    setError(null)
    const { error } = await invokeEdgeFunction('shopify-delete-product', {
      productId: item.shopify_product_id,
      action: 'delete',
    })
    if (error) { setError(error); setDeleting(null); return }
    await remove.mutateAsync(item.id)
    setDeleting(null)
    onClose()
  }

  return (
    <Modal open onClose={onClose} title="Delete Item">
      <div className="space-y-4">
        <p className="text-sm text-gray-400">
          Delete <strong className="text-white">"{item.name}"</strong> ({item.readable_id})? This cannot be undone.
        </p>

        <div className="border border-border rounded-lg px-3 py-3 space-y-2 bg-surface-2/40">
          <p className="text-xs text-gray-500">
            This item is linked to a Shopify listing that is currently holding the status: {' '}
            {checkingStatus ? (
              <span className="text-gray-400">checking…</span>
            ) : shopifyStatus ? (
              <span className={`font-medium ${shopifyStatus === 'ACTIVE' ? 'text-emerald-400' : 'text-gray-300'}`}>
                {STATUS_LABEL[shopifyStatus] ?? shopifyStatus}
              </span>
            ) : (
              <span className="text-gray-400">unknown — couldn't reach Shopify to check</span>
            )}
            .
          </p>
          {item.shopify_admin_url && (
            <a href={item.shopify_admin_url} target="_blank" rel="noreferrer" className="text-xs text-gray-400 hover:text-white underline">
              View listing on Shopify →
            </a>
          )}
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded px-3 py-2">{error}</p>
        )}

        <div className="flex flex-wrap gap-2 justify-end pt-1">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={!!deleting}>Cancel</button>
          <button
            type="button"
            className="text-sm font-medium px-4 py-1.5 rounded border border-border text-gray-300 hover:bg-surface-3 disabled:opacity-40 transition-colors"
            onClick={() => void deleteUgisOnly()}
            disabled={!!deleting}
          >
            {deleting === 'ugis' ? 'Deleting…' : 'Delete from UGIS only'}
          </button>
          <button
            type="button"
            className="text-sm font-medium px-4 py-1.5 rounded bg-red-700 hover:bg-red-600 text-white disabled:opacity-40 transition-colors"
            onClick={() => void deleteBoth()}
            disabled={!!deleting}
          >
            {deleting === 'both' ? 'Deleting…' : 'Delete from UGIS + Shopify'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

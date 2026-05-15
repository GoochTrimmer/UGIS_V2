import { useState } from 'react'
import { useItemMutations } from '../../hooks/useItems'
import { STATUS_CONFIG } from '../../lib/constants'
import StatusBadge from '../ui/StatusBadge'
import Modal from '../ui/Modal'
import type { ItemStatus } from '../../types'

interface StatusMenuProps {
  itemId: string
  currentStatus: ItemStatus
}

export default function StatusMenu({ itemId, currentStatus }: StatusMenuProps) {
  const [open, setOpen] = useState(false)
  const { updateStatus } = useItemMutations()

  const change = async (status: ItemStatus) => {
    setOpen(false)
    await updateStatus.mutateAsync({ id: itemId, status })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer hover:opacity-80 transition-opacity"
      >
        <StatusBadge status={currentStatus} />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Change Status">
        <div className="space-y-1">
          {(Object.entries(STATUS_CONFIG) as [ItemStatus, { label: string; color: string }][]).map(([k, v]) => (
            <button
              key={k}
              type="button"
              disabled={k === currentStatus}
              onClick={() => void change(k)}
              className={`w-full text-left px-3 py-2.5 rounded text-sm flex items-center gap-3 transition-colors ${
                k === currentStatus
                  ? 'opacity-40 cursor-default'
                  : 'hover:bg-surface-3'
              }`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${v.color.split(' ')[0].replace('/15', '')}`} />
              <span className={k === currentStatus ? 'text-gray-400' : 'text-white'}>{v.label}</span>
              {k === currentStatus && <span className="text-xs text-gray-600 ml-auto">current</span>}
            </button>
          ))}
        </div>
      </Modal>
    </>
  )
}

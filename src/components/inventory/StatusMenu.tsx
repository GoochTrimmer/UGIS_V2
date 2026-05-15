import { useState, useRef, useEffect } from 'react'
import { useItemMutations } from '../../hooks/useItems'
import { STATUS_CONFIG } from '../../lib/constants'
import StatusBadge from '../ui/StatusBadge'
import type { ItemStatus } from '../../types'

interface StatusMenuProps {
  itemId: string
  currentStatus: ItemStatus
}

export default function StatusMenu({ itemId, currentStatus }: StatusMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { updateStatus } = useItemMutations()

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const change = async (status: ItemStatus) => {
    setOpen(false)
    await updateStatus.mutateAsync({ id: itemId, status })
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="cursor-pointer hover:opacity-80 transition-opacity"
      >
        <StatusBadge status={currentStatus} />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 bg-surface-2 border border-border rounded shadow-xl min-w-max">
          {(Object.entries(STATUS_CONFIG) as [ItemStatus, { label: string; color: string }][]).map(([k, v]) => (
            <button
              key={k}
              type="button"
              onClick={() => void change(k)}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-surface-3 flex items-center gap-2 ${k === currentStatus ? 'opacity-50 cursor-default' : ''}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${v.color.split(' ')[0].replace('/15', '')}`} />
              {v.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

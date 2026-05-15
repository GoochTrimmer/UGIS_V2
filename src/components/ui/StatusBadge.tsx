import { STATUS_CONFIG } from '../../lib/constants'
import type { ItemStatus } from '../../types'

interface StatusBadgeProps {
  status: ItemStatus
  size?: 'xs' | 'sm'
}

export default function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status]
  if (!cfg) return null
  return (
    <span className={`inline-flex items-center border rounded-full font-medium ${cfg.color} ${
      size === 'xs' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-xs'
    }`}>
      {cfg.label}
    </span>
  )
}

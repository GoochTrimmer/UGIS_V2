import { useItemStatusHistory } from '../../hooks/useItemStatusHistory'
import { useUserLabels } from '../../hooks/useUserLabels'
import { useProfile } from '../../hooks/useProfile'
import { STATUS_CONFIG } from '../../lib/constants'
import Spinner from '../ui/Spinner'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
}

function durationLabel(fromIso: string, toIso: string | null): string {
  const from = new Date(fromIso).getTime()
  const to = toIso ? new Date(toIso).getTime() : Date.now()
  const days = Math.max(0, Math.round((to - from) / 86_400_000))
  if (days === 0) return 'same day'
  return `${days} day${days === 1 ? '' : 's'}`
}

export default function StatusTimeline({ itemId }: { itemId: string }) {
  const { data: history = [], isLoading } = useItemStatusHistory(itemId)
  const { profile } = useProfile()
  const isStaff = profile.role === 'staff'
  const { data: userLabels } = useUserLabels(isStaff ? history.map(h => h.changed_by) : [])

  if (isLoading) {
    return <div className="flex justify-center py-2"><Spinner size="sm" /></div>
  }
  if (history.length === 0) {
    return <p className="text-xs text-gray-600">No recorded history yet.</p>
  }

  return (
    <ol className="space-y-1.5">
      {history.map((entry, i) => {
        const config = STATUS_CONFIG[entry.status]
        const next = history[i + 1]
        const isCurrent = i === history.length - 1
        return (
          <li key={entry.id} className="flex items-center gap-2 text-xs">
            <span className={`shrink-0 px-2 py-0.5 rounded-full border ${config?.color ?? 'border-border text-gray-400'}`}>
              {config?.label ?? entry.status}
            </span>
            <span className="text-gray-300">{formatDate(entry.changed_at)}</span>
            <span className="text-gray-600">
              {isCurrent
                ? `· current, ${durationLabel(entry.changed_at, null)} so far`
                : `· ${durationLabel(entry.changed_at, next.changed_at)}`}
            </span>
            {isStaff && (
              <span className="text-gray-700">
                · {entry.changed_by ? `by ${userLabels?.get(entry.changed_by) ?? '…'}` : 'auto'}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

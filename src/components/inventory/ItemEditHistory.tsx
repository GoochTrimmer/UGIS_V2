import { useItemLogsForItem } from '../../hooks/useItemLogs'
import { useUserLabels } from '../../hooks/useUserLabels'
import { useProfile } from '../../hooks/useProfile'
import { FIELD_LABELS, fmtVal } from '../../lib/itemLogFormat'
import Spinner from '../ui/Spinner'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ItemEditHistory({ itemId }: { itemId: string }) {
  const { data: logs = [], isLoading } = useItemLogsForItem(itemId)
  const { profile } = useProfile()
  const isStaff = profile.role === 'staff'
  const { data: userLabels } = useUserLabels(isStaff ? logs.map(l => l.changed_by) : [])

  // Status changes already have their own timeline above — only show the
  // other fields here (price corrections, discounts, brand/consignee
  // reassignment, etc), and drop any entry that turns out to be a
  // status-only edit once that field's excluded.
  const entries = logs
    .map(log => ({
      log,
      changes: Object.entries(log.field_changes).filter(([field]) => !field.startsWith('_') && field !== 'status'),
    }))
    .filter(e => e.changes.length > 0)

  if (isLoading) {
    return <div className="flex justify-center py-2"><Spinner size="sm" /></div>
  }
  if (entries.length === 0) {
    return <p className="text-xs text-gray-600">No other changes recorded yet.</p>
  }

  return (
    <ul className="space-y-2">
      {entries.map(({ log, changes }) => (
        <li key={log.id} className={`text-xs border-l-2 border-border pl-2.5 ${log.reverted ? 'opacity-40 line-through' : ''}`}>
          <span className="text-gray-600">{formatDate(log.changed_at)}</span>
          {isStaff && log.changed_by && (
            <span className="text-gray-700"> · by {userLabels?.get(log.changed_by) ?? '…'}</span>
          )}
          <div className="space-y-0.5 mt-0.5">
            {changes.map(([field, { from, to }]) => (
              <div key={field}>
                <span className="text-gray-600">{FIELD_LABELS[field] ?? field}: </span>
                <span className="text-gray-500">{fmtVal(field, from)}</span>
                <span className="text-gray-700 mx-1.5">→</span>
                <span className="text-gray-300">{fmtVal(field, to)}</span>
              </div>
            ))}
          </div>
        </li>
      ))}
    </ul>
  )
}

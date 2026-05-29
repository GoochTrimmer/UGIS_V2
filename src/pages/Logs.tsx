import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useItemLogs } from '../hooks/useItemLogs'
import { useItemMutations } from '../hooks/useItems'
import { supabase } from '../lib/supabase'
import Layout from '../components/layout/Layout'
import Spinner from '../components/ui/Spinner'
import { STATUS_CONFIG, SALE_CHANNEL_CONFIG, SALE_GEOGRAPHY_CONFIG } from '../lib/constants'
import type { ItemLog, ItemStatus, SaleChannel, SaleGeography } from '../types'

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  size: 'Size',
  status: 'Status',
  season_year: 'Year',
  season_period: 'Season Period',
  season_custom: 'Season',
  cost_amount: 'Cost',
  takeback_price: 'Take-back',
  selling_price: 'Selling Price',
  sold_price: 'Sold Price',
  sale_channel: 'Sale Channel',
  sale_geography: 'Geography',
  notes: 'Notes',
  consignee: 'Consignee',
  brands: 'Brands',
}

function fmtVal(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (field === 'status') return STATUS_CONFIG[v as ItemStatus]?.label ?? String(v)
  if (field === 'cost_amount' || field === 'takeback_price' || field === 'selling_price' || field === 'sold_price') {
    return `$${Number(v).toFixed(2)}`
  }
  if (field === 'sale_channel') return SALE_CHANNEL_CONFIG[v as SaleChannel]?.label ?? String(v)
  if (field === 'sale_geography') return SALE_GEOGRAPHY_CONFIG[v as SaleGeography]?.label ?? String(v)
  return String(v)
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function groupByDay(logs: ItemLog[]) {
  const groups = new Map<string, ItemLog[]>()
  for (const log of logs) {
    const label = dayLabel(log.changed_at)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(log)
  }
  return [...groups.entries()].map(([date, items]) => ({ date, items }))
}

function actionType(log: ItemLog): 'created' | 'imported' | 'bulk_updated' | 'deleted' | 'edit' {
  const action = log.field_changes['_action']?.to
  if (action === 'created') return 'created'
  if (action === 'imported') return 'imported'
  if (action === 'bulk_updated') return 'bulk_updated'
  if (action === 'deleted') return 'deleted'
  return 'edit'
}

export default function Logs() {
  const { data: logs = [], isLoading } = useItemLogs()
  const { update } = useItemMutations()
  const qc = useQueryClient()
  const [reverting, setReverting] = useState<string | null>(null)

  const handleRevert = async (log: ItemLog) => {
    if (!log.item_id || log.reverted || actionType(log) !== 'edit') return
    setReverting(log.id)
    try {
      const s = log.snapshot_before
      await update.mutateAsync({
        id: s.id,
        readable_id: s.readable_id,
        name: s.name,
        size: s.size,
        status: s.status,
        season_year: s.season_year,
        season_period: s.season_period,
        season_custom: s.season_custom,
        cost_amount: s.cost_amount,
        takeback_price: s.takeback_price,
        selling_price: s.selling_price,
        sold_price: s.sold_price,
        sale_channel: s.sale_channel,
        sale_geography: s.sale_geography,
        notes: s.notes,
        consignee_id: s.consignee_id,
        brands: s.brands,
        consignee: s.consignee,
      })
      await supabase.from('item_logs').update({ reverted: true }).eq('id', log.id)
      await qc.invalidateQueries({ queryKey: ['item_logs'] })
    } finally {
      setReverting(null)
    }
  }

  const groups = groupByDay(logs)

  return (
    <Layout>
      <div className="px-4 md:px-6 py-5 max-w-3xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-base font-semibold text-white">Edit History</h1>
          <p className="text-xs text-gray-600 mt-0.5">Last 200 changes · reverted entries are struck through</p>
        </div>

        {isLoading && (
          <div className="flex justify-center py-16"><Spinner /></div>
        )}

        {!isLoading && logs.length === 0 && (
          <div className="text-center py-16 text-sm text-gray-600">No changes recorded yet.</div>
        )}

        <div className="space-y-8">
          {groups.map(({ date, items }) => (
            <div key={date}>
              <p className="text-xs text-gray-600 font-medium uppercase tracking-widest mb-2">{date}</p>
              <div className="space-y-px">
                {items.map(log => {
                  const type = actionType(log)
                  const dimmed = log.reverted

                  const borderClass =
                    type === 'created' || type === 'imported' ? 'border-l-2 border-l-emerald-500/50' :
                    type === 'bulk_updated' ? 'border-l-2 border-l-blue-500/50' :
                    type === 'deleted' ? 'border-l-2 border-l-red-500/50' : ''

                  const canRevert = type === 'edit' && !!log.item_id && !log.reverted

                  return (
                    <div
                      key={log.id}
                      className={`card px-4 py-3 flex gap-4 items-start transition-opacity ${dimmed ? 'opacity-40' : ''} ${borderClass}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">

                          {/* Item name */}
                          <span className={`text-sm text-white font-medium truncate ${log.reverted ? 'line-through' : ''}`}>
                            {type === 'imported' ? 'Bulk Import' : log.item_name}
                          </span>

                          {/* Timestamp */}
                          <span className="text-xs text-gray-600 shrink-0">
                            {new Date(log.changed_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                          </span>

                          {/* Type badge */}
                          {type === 'created' && (
                            <span className="text-xs text-emerald-400 border border-emerald-900/40 rounded px-1.5 py-0.5">Added</span>
                          )}
                          {type === 'imported' && (
                            <span className="text-xs text-emerald-400 border border-emerald-900/40 rounded px-1.5 py-0.5">Imported</span>
                          )}
                          {type === 'bulk_updated' && (
                            <span className="text-xs text-blue-400 border border-blue-900/40 rounded px-1.5 py-0.5">Bulk Update</span>
                          )}
                          {type === 'deleted' && (
                            <span className="text-xs text-red-400 border border-red-900/40 rounded px-1.5 py-0.5">Deleted</span>
                          )}
                          {log.reverted && (
                            <span className="text-xs text-gray-600 border border-border rounded px-1.5 py-0.5">Reverted</span>
                          )}
                        </div>

                        {/* Body */}
                        <div className={`space-y-0.5 ${log.reverted ? 'line-through' : ''}`}>
                          {type === 'imported' && (
                            <div className="text-xs text-gray-500">
                              Imported{' '}
                              <span className="text-gray-300 font-medium">
                                {String(log.field_changes['_count']?.to ?? '?')} items
                              </span>
                              {log.field_changes['_breakdown']?.to != null && (
                                <span className="text-gray-600"> · {String(log.field_changes['_breakdown'].to)}</span>
                              )}
                            </div>
                          )}

                          {type === 'bulk_updated' && (
                            <div className="text-xs text-gray-500">
                              Updated{' '}
                              <span className="text-gray-300 font-medium">
                                {String(log.field_changes['_count']?.to ?? '?')} items
                              </span>
                              {log.field_changes['_fields']?.to != null && (
                                <span className="text-gray-600"> · {String(log.field_changes['_fields'].to)}</span>
                              )}
                            </div>
                          )}

                          {type === 'edit' && Object.entries(log.field_changes)
                            .filter(([field]) => !field.startsWith('_'))
                            .map(([field, { from, to }]) => (
                              <div key={field} className="text-xs">
                                <span className="text-gray-600">{FIELD_LABELS[field] ?? field}: </span>
                                <span className="text-gray-500">{fmtVal(field, from)}</span>
                                <span className="text-gray-700 mx-1.5">→</span>
                                <span className="text-gray-300">{fmtVal(field, to)}</span>
                              </div>
                            ))}
                        </div>
                      </div>

                      <button
                        disabled={!canRevert || reverting === log.id}
                        onClick={() => void handleRevert(log)}
                        title={
                          type === 'deleted' ? 'Deleted items cannot be restored' :
                          type === 'created' || type === 'imported' || type === 'bulk_updated' ? 'Cannot revert a bulk operation' :
                          log.reverted ? 'Already reverted' :
                          !log.item_id ? 'Item no longer exists' :
                          'Revert item to this state'
                        }
                        className="text-xs text-gray-600 hover:text-white border border-border hover:border-gray-500 rounded px-2.5 py-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                      >
                        {reverting === log.id ? '…' : 'Revert'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  )
}

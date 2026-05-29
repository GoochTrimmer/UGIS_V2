import { useState, useRef, useEffect } from 'react'
import { useItemMutations } from '../../hooks/useItems'
import { STATUS_CONFIG, SALE_CHANNEL_CONFIG, SALE_GEOGRAPHY_CONFIG } from '../../lib/constants'
import StatusBadge from '../ui/StatusBadge'
import Modal from '../ui/Modal'
import type { ItemStatus, SaleChannel, SaleGeography } from '../../types'

interface StatusMenuProps {
  itemId: string
  currentStatus: ItemStatus
  sellingPrice?: number | null
}

export default function StatusMenu({ itemId, currentStatus, sellingPrice }: StatusMenuProps) {
  const [open, setOpen] = useState(false)
  const [soldPrompt, setSoldPrompt] = useState(false)
  const [soldInput, setSoldInput] = useState('')
  const [channel, setChannel] = useState<SaleChannel | ''>('')
  const [geography, setGeography] = useState<SaleGeography | ''>('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { updateStatus } = useItemMutations()

  useEffect(() => {
    if (soldPrompt) {
      setSoldInput(sellingPrice != null ? String(sellingPrice) : '')
      setChannel('')
      setGeography('')
      setTimeout(() => inputRef.current?.select(), 50)
    }
  }, [soldPrompt, sellingPrice])

  const change = async (status: ItemStatus) => {
    setOpen(false)
    if (status === 'sold') { setSoldPrompt(true); return }
    await updateStatus.mutateAsync({ id: itemId, status })
  }

  const confirmSale = async () => {
    await updateStatus.mutateAsync({
      id: itemId,
      status: 'sold',
      sold_price: soldInput ? parseFloat(soldInput) : null,
      sale_channel: channel || null,
      sale_geography: geography || null,
    })
    setSoldPrompt(false)
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="cursor-pointer hover:opacity-80 transition-opacity">
        <StatusBadge status={currentStatus} />
      </button>

      {/* Status picker */}
      <Modal open={open} onClose={() => setOpen(false)} title="Change Status">
        <div className="space-y-1">
          {(Object.entries(STATUS_CONFIG) as [ItemStatus, { label: string; color: string }][]).map(([k, v]) => (
            <button
              key={k}
              type="button"
              disabled={k === currentStatus}
              onClick={() => void change(k)}
              className={`w-full text-left px-3 py-2.5 rounded text-sm flex items-center gap-3 transition-colors ${
                k === currentStatus ? 'opacity-40 cursor-default' : 'hover:bg-surface-3'
              }`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${v.color.split(' ')[0].replace('/15', '')}`} />
              <span className={k === currentStatus ? 'text-gray-400' : 'text-white'}>{v.label}</span>
              {k === currentStatus && <span className="text-xs text-gray-600 ml-auto">current</span>}
            </button>
          ))}
        </div>
      </Modal>

      {/* Sold details prompt */}
      <Modal open={soldPrompt} onClose={() => setSoldPrompt(false)} title="Record Sale Details">
        <div className="space-y-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            Enter the actual sold price and where/how the sale happened. All fields are optional — you can fill them in later via Edit.
          </p>

          {/* Sold price */}
          <div>
            <label className="label">Actual Sold Price</label>
            {sellingPrice != null && (
              <p className="text-xs text-gray-600 mb-1">
                Listed: <span className="text-gray-400 font-mono">${Number(sellingPrice).toLocaleString('en-SG', { minimumFractionDigits: 2 })}</span>
              </p>
            )}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                ref={inputRef}
                className="input pl-7"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={soldInput}
                onChange={e => setSoldInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void confirmSale() }}
              />
            </div>
          </div>

          {/* Channel + Geography side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Sale Channel</label>
              <select className="input" value={channel} onChange={e => setChannel(e.target.value as SaleChannel | '')}>
                <option value="">— unknown —</option>
                {(Object.entries(SALE_CHANNEL_CONFIG) as [SaleChannel, { label: string }][]).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Geography</label>
              <select className="input" value={geography} onChange={e => setGeography(e.target.value as SaleGeography | '')}>
                <option value="">— unknown —</option>
                {(Object.entries(SALE_GEOGRAPHY_CONFIG) as [SaleGeography, { label: string }][]).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <button className="btn-ghost" onClick={() => setSoldPrompt(false)}>Cancel</button>
            <button className="btn-primary" onClick={() => void confirmSale()}>Confirm Sale</button>
          </div>
        </div>
      </Modal>
    </>
  )
}

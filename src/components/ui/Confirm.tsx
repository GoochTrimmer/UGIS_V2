import { useState } from 'react'
import Modal from './Modal'

interface ConfirmProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title?: string
  message: string
  danger?: boolean
}

export default function Confirm({ open, onClose, onConfirm, title, message, danger }: ConfirmProps) {
  // Waits for onConfirm to actually settle before closing, and disables
  // both buttons while it's in flight — previously this closed the dialog
  // (and re-enabled the trigger button behind it) the instant Confirm was
  // clicked, regardless of whether the underlying action had finished.
  // With an async action (deleting an item, say) that left a window where
  // the same action could be fired a second time before the first had
  // even completed.
  const [pending, setPending] = useState(false)

  const handleConfirm = async () => {
    setPending(true)
    try {
      await onConfirm()
      onClose()
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal open={open} onClose={pending ? () => {} : onClose} title={title ?? 'Confirm'}>
      <p className="text-sm text-gray-400 mb-5">{message}</p>
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>Cancel</button>
        <button
          type="button"
          className={danger ? 'btn-danger' : 'btn-primary'}
          onClick={() => void handleConfirm()}
          disabled={pending}
        >
          {pending ? 'Working…' : 'Confirm'}
        </button>
      </div>
    </Modal>
  )
}

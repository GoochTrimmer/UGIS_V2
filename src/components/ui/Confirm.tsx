import Modal from './Modal'

interface ConfirmProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title?: string
  message: string
  danger?: boolean
}

export default function Confirm({ open, onClose, onConfirm, title, message, danger }: ConfirmProps) {
  return (
    <Modal open={open} onClose={onClose} title={title ?? 'Confirm'}>
      <p className="text-sm text-gray-400 mb-5">{message}</p>
      <div className="flex gap-2 justify-end">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button
          className={danger ? 'btn-danger' : 'btn-primary'}
          onClick={() => { onConfirm(); onClose() }}
        >
          Confirm
        </button>
      </div>
    </Modal>
  )
}

import { useEffect } from 'react'

interface SlideOverProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: React.ReactNode
}

export default function SlideOver({ open, onClose, title, subtitle, children }: SlideOverProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <div
        className={`fixed top-0 right-0 z-50 h-full w-full max-w-md bg-surface-1 border-l border-border flex flex-col shadow-2xl transition-transform duration-200 ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-white">{title}</h2>
            {subtitle && <p className="text-xs text-gray-600 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-lg leading-none mt-0.5">×</button>
        </div>
        <div className="overflow-y-auto flex-1">
          {children}
        </div>
      </div>
    </>
  )
}

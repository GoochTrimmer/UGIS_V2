import { useState, useRef, useEffect } from 'react'

interface Option {
  value: string
  label: string
}

interface MultiSelectProps {
  options: Option[]
  selected: string[]
  onChange: (selected: string[]) => void
  placeholder: string
}

export default function MultiSelect({ options, selected, onChange, placeholder }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value])
  }

  const triggerLabel =
    selected.length === 0 ? `All ${placeholder}` :
    selected.length === 1 ? (options.find(o => o.value === selected[0])?.label ?? '1 selected') :
    `${selected.length} ${placeholder}`

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`input text-xs h-8 py-0 w-44 text-left flex items-center justify-between gap-1 ${selected.length > 0 ? 'border-gray-500' : ''}`}
      >
        <span className="truncate text-gray-300">{triggerLabel}</span>
        <span className={`shrink-0 text-gray-600 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 bg-surface-1 border border-border rounded-lg shadow-2xl w-52 max-h-64 overflow-y-auto py-1">
          {selected.length > 0 && (
            <>
              <button
                className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:text-white hover:bg-surface-2 transition-colors"
                onClick={() => onChange([])}
              >
                Clear selection
              </button>
              <div className="border-t border-border my-1" />
            </>
          )}
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-600">No options</p>
          )}
          {options.map(opt => (
            <label
              key={opt.value}
              className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-surface-2 cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                className="rounded accent-indigo-500"
              />
              <span className="text-xs text-gray-300 truncate">{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

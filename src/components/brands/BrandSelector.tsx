import { useState, useRef, useEffect } from 'react'
import { useBrands } from '../../hooks/useBrands'
import type { Brand } from '../../types'

interface BrandSelectorProps {
  value?: Brand[]
  onChange: (brands: Brand[]) => void
}

export default function BrandSelector({ value = [], onChange }: BrandSelectorProps) {
  const { data: brands = [] } = useBrands()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = brands.filter(b =>
    !value.find(v => v.id === b.id) &&
    (b.name.toLowerCase().includes(query.toLowerCase()) ||
     b.abbreviation.toLowerCase().includes(query.toLowerCase()) ||
     (b.aliases ?? []).some(a => a.toLowerCase().includes(query.toLowerCase())))
  )

  const add = (brand: Brand) => {
    onChange([...value, brand])
    setQuery('')
  }

  const remove = (id: string) => onChange(value.filter(b => b.id !== id))

  const moveUp = (i: number) => {
    if (i === 0) return
    const next = [...value]
    ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
    onChange(next)
  }

  return (
    <div ref={ref}>
      {/* Selected brands */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {value.map((b, i) => (
            <div key={b.id} className="flex items-center gap-1 bg-surface-3 border border-border rounded px-2 py-0.5">
              {i > 0 && (
                <button type="button" onClick={() => moveUp(i)} className="text-gray-600 hover:text-white text-xs" title="Move left">←</button>
              )}
              <span className="text-xs font-mono text-gray-300">{b.abbreviation}</span>
              <span className="text-xs text-gray-500">{b.name}</span>
              <button type="button" onClick={() => remove(b.id)} className="text-gray-600 hover:text-red-400 text-xs ml-1">×</button>
            </div>
          ))}
        </div>
      )}
      {/* Input */}
      <div className="relative">
        <input
          className="input"
          placeholder="Search brand…"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
        />
        {open && filtered.length > 0 && (
          <div className="absolute z-50 top-full mt-1 w-full bg-surface-2 border border-border rounded shadow-xl max-h-52 overflow-y-auto">
            {filtered.slice(0, 30).map(b => (
              <button
                key={b.id}
                type="button"
                onClick={() => { add(b); setOpen(false) }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface-3 flex items-center gap-2"
              >
                <span className="font-mono text-xs text-gray-400 w-16 shrink-0">{b.abbreviation}</span>
                <span className="text-white">{b.name}</span>
                {b.parent_id && <span className="text-xs text-gray-600 ml-auto">subline</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

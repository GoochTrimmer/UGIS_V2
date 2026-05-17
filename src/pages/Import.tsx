import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { useQueryClient } from '@tanstack/react-query'
import Layout from '../components/layout/Layout'
import Modal from '../components/ui/Modal'
import { useBrands } from '../hooks/useBrands'
import { useConsignees } from '../hooks/useConsignees'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { generateAbbreviation, parseSeason, normalizeStatus, guessColumnMapping } from '../lib/importUtils'
import { formatSeason } from '../lib/idGenerator'
import type { Brand, Consignee, ItemStatus } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

const UGIS_FIELDS = [
  { value: '',           label: '— skip —' },
  { value: 'name',      label: 'Item Name' },
  { value: 'brand',     label: 'Brand(s)' },
  { value: 'size',      label: 'Size' },
  { value: 'season',    label: 'Season' },
  { value: 'status',    label: 'Status' },
  { value: 'consignee', label: 'Consignee' },
  { value: 'cost',      label: 'Cost' },
  { value: 'takeback',  label: 'Take-back Price' },
  { value: 'selling',   label: 'Listed / Selling Price' },
  { value: 'notes',     label: 'Notes' },
]

interface ParsedRow {
  index: number
  name: string
  brandNames: string[]
  size: string | null
  season: ReturnType<typeof parseSeason>
  status: ItemStatus
  consigneeName: string | null
  cost: number | null
  takeback: number | null
  selling: number | null
  notes: string | null
  errors: string[]
}

type Step = 'upload' | 'map' | 'importing' | 'done'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseRows(
  dataRows: string[][],
  headers: string[],
  mapping: Record<string, string>,
): ParsedRow[] {
  const fieldToColIdx: Record<string, number> = {}
  for (const [header, field] of Object.entries(mapping)) {
    if (field) {
      const idx = headers.indexOf(header)
      if (idx !== -1) fieldToColIdx[field] = idx
    }
  }

  const get = (row: string[], field: string) =>
    (row[fieldToColIdx[field] ?? -1] ?? '').trim()

  return dataRows
    .map((row, i) => {
      const name = get(row, 'name')
      const errors: string[] = []
      if (!name) errors.push('Name is required')

      const brandRaw = get(row, 'brand')
      const brandNames = brandRaw
        ? brandRaw.split(/[,/]/).map(b => b.trim()).filter(Boolean)
        : []

      const parseNum = (field: string) => {
        const raw = get(row, field).replace(/[^0-9.-]/g, '')
        const n = raw ? parseFloat(raw) : null
        return n !== null && !isNaN(n) ? n : null
      }

      return {
        index: i,
        name,
        brandNames,
        size: get(row, 'size').toUpperCase() || null,
        season: parseSeason(get(row, 'season')),
        status: normalizeStatus(get(row, 'status')),
        consigneeName: get(row, 'consignee') || null,
        cost: parseNum('cost'),
        takeback: parseNum('takeback'),
        selling: parseNum('selling'),
        notes: get(row, 'notes') || null,
        errors,
      }
    })
    .filter(r => r.name || r.brandNames.length > 0)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Import() {
  const { data: existingBrands = [] } = useBrands()
  const { data: existingConsignees = [] } = useConsignees()
  const { session } = useAuth()
  const qc = useQueryClient()

  const [step, setStep] = useState<Step>('upload')
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [selectedSheet, setSelectedSheet] = useState('')
  const [rawRows, setRawRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [brandAbbrs, setBrandAbbrs] = useState<Record<string, string>>({})
  const [consigneeAbbrs, setConsigneeAbbrs] = useState<Record<string, string>>({})
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importCount, setImportCount] = useState(0)

  // Wipe state
  const [showWipe, setShowWipe] = useState(false)
  const [wipePassword, setWipePassword] = useState('')
  const [wiping, setWiping] = useState(false)
  const [wipeError, setWipeError] = useState('')
  const workbookRef = useRef<XLSX.WorkBook | null>(null)

  const headers = rawRows[0] ?? []
  const dataRows = rawRows.slice(1)

  const parsedRows = useMemo(
    () => parseRows(dataRows, headers, mapping),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawRows, mapping],
  )

  const validRows = parsedRows.filter(r => r.errors.length === 0)

  const existingBrandNameSet = useMemo(
    () => new Set(existingBrands.map(b => b.name.toLowerCase())),
    [existingBrands],
  )
  const existingConsigneeNameSet = useMemo(
    () => new Set(existingConsignees.map(c => c.name.toLowerCase())),
    [existingConsignees],
  )

  const detectedNewBrandNames = useMemo(() => {
    const all = new Set(validRows.flatMap(r => r.brandNames))
    return [...all].filter(n => !existingBrandNameSet.has(n.toLowerCase()))
  }, [validRows, existingBrandNameSet])

  const detectedNewConsigneeNames = useMemo(() => {
    const all = new Set(validRows.map(r => r.consigneeName).filter(Boolean) as string[])
    return [...all].filter(n => !existingConsigneeNameSet.has(n.toLowerCase()))
  }, [validRows, existingConsigneeNameSet])

  // Initialize abbreviations for newly detected brands
  useEffect(() => {
    setBrandAbbrs(prev => {
      const takenAbbrs = new Set([
        ...existingBrands.map(b => b.abbreviation),
        ...Object.values(prev),
      ])
      const updates: Record<string, string> = {}
      for (const name of detectedNewBrandNames) {
        if (!prev[name]) {
          const abbr = generateAbbreviation(name, takenAbbrs)
          takenAbbrs.add(abbr)
          updates[name] = abbr
        }
      }
      return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev
    })
  }, [detectedNewBrandNames, existingBrands])

  useEffect(() => {
    setConsigneeAbbrs(prev => {
      const takenAbbrs = new Set([
        ...existingConsignees.map(c => c.abbreviation),
        ...Object.values(prev),
      ])
      const updates: Record<string, string> = {}
      for (const name of detectedNewConsigneeNames) {
        if (!prev[name]) {
          const abbr = generateAbbreviation(name, takenAbbrs)
          takenAbbrs.add(abbr)
          updates[name] = abbr
        }
      }
      return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev
    })
  }, [detectedNewConsigneeNames, existingConsignees])

  // Abbreviation conflict detection
  const abbrConflicts = useMemo(() => {
    const conflicts = new Set<string>()
    const existingAbbrs = new Set(existingBrands.map(b => b.abbreviation))
    const seen = new Set<string>()
    for (const [name, abbr] of Object.entries(brandAbbrs)) {
      if (existingAbbrs.has(abbr) || seen.has(abbr)) conflicts.add(name)
      else seen.add(abbr)
    }
    return conflicts
  }, [brandAbbrs, existingBrands])

  const consigneeAbbrConflicts = useMemo(() => {
    const conflicts = new Set<string>()
    const existingAbbrs = new Set(existingConsignees.map(c => c.abbreviation))
    const seen = new Set<string>()
    for (const [name, abbr] of Object.entries(consigneeAbbrs)) {
      if (existingAbbrs.has(abbr) || seen.has(abbr)) conflicts.add(name)
      else seen.add(abbr)
    }
    return conflicts
  }, [consigneeAbbrs, existingConsignees])

  // ─── File handling ───────────────────────────────────────────────────────────

  const loadSheet = useCallback((wb: XLSX.WorkBook, sheetName: string) => {
    const ws = wb.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as string[][]
    const filtered = data.filter(row => row.some(cell => (cell as string).trim() !== ''))
    setRawRows(filtered)
    setMapping(guessColumnMapping(filtered[0] ?? []))
  }, [])

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) return
    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(buffer, { type: 'array' })
    workbookRef.current = wb
    setSheetNames(wb.SheetNames)
    setSelectedSheet(wb.SheetNames[0])
    loadSheet(wb, wb.SheetNames[0])
    setStep('map')
  }, [loadSheet])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }, [handleFile])

  // ─── Import ───────────────────────────────────────────────────────────────────

  const handleImport = async () => {
    const hasConflicts = abbrConflicts.size > 0 || consigneeAbbrConflicts.size > 0
    if (hasConflicts) return

    setStep('importing')
    setImportErrors([])
    setProgress({ current: 0, total: validRows.length })

    const errors: string[] = []

    // 1. Create new brands
    const brandMap = new Map<string, Brand>()
    for (const b of existingBrands) brandMap.set(b.name.toLowerCase(), b)

    for (const name of detectedNewBrandNames) {
      const abbr = brandAbbrs[name]
      if (!abbr) { errors.push(`No abbreviation for brand "${name}"`); continue }
      const { data, error } = await supabase.from('brands').insert({
        name,
        abbreviation: abbr,
        aliases: [],
        parent_id: null,
      }).select().single()
      if (error) { errors.push(`Brand "${name}": ${error.message}`); continue }
      brandMap.set(name.toLowerCase(), data as Brand)
    }

    // 2. Create new consignees
    const consigneeMap = new Map<string, Consignee>()
    for (const c of existingConsignees) consigneeMap.set(c.name.toLowerCase(), c)

    for (const name of detectedNewConsigneeNames) {
      const abbr = consigneeAbbrs[name]
      if (!abbr) { errors.push(`No abbreviation for consignee "${name}"`); continue }
      const { data, error } = await supabase.from('consignees').insert({
        name,
        abbreviation: abbr,
        notes: null,
      }).select().single()
      if (error) { errors.push(`Consignee "${name}": ${error.message}`); continue }
      consigneeMap.set(name.toLowerCase(), data as Consignee)
    }

    // 3. Prepare item rows with brand/consignee resolved
    interface PreparedRow {
      name: string
      size: string | null
      status: ItemStatus
      season_year: number | null
      season_period: string | null
      season_custom: string | null
      consignee_id: string | null
      cost_amount: number | null
      takeback_price: number | null
      selling_price: number | null
      notes: string | null
      brands: Brand[]
      consignee: Consignee | null
    }

    const storeConsignee = existingConsignees.find(c => c.is_default_store) ?? null

    const prepared: PreparedRow[] = []
    for (const row of validRows) {
      const brands = row.brandNames
        .map(n => brandMap.get(n.toLowerCase()))
        .filter((b): b is Brand => b !== undefined)
      const namedConsignee = row.consigneeName
        ? (consigneeMap.get(row.consigneeName.toLowerCase()) ?? null)
        : null
      // Default to store (UG) when no consignee specified, so IDs share the same prefix
      const consignee = namedConsignee ?? storeConsignee

      prepared.push({
        name: row.name,
        size: row.size,
        status: row.status,
        season_year: row.season.year,
        season_period: row.season.period,
        season_custom: row.season.custom,
        consignee_id: consignee?.id ?? null,
        cost_amount: row.cost,
        takeback_price: row.takeback,
        selling_price: row.selling,
        notes: row.notes,
        brands,
        consignee,
      })
    }

    // 4. Group by prefix and reserve ID ranges in bulk
    const prefixGroups = new Map<string, number>()
    for (const row of prepared) {
      const parts = [...row.brands.map(b => b.abbreviation)]
      if (row.consignee) parts.push(row.consignee.abbreviation)
      const prefix = parts.join('-') || 'ITEM'
      prefixGroups.set(prefix, (prefixGroups.get(prefix) ?? 0) + 1)
    }

    const prefixStartCounts = new Map<string, number>()
    for (const [prefix, count] of prefixGroups) {
      const { data, error } = await supabase.rpc('reserve_id_range', { p_prefix: prefix, p_count: count })
      if (error) { errors.push(`ID reservation for "${prefix}": ${error.message}`); continue }
      prefixStartCounts.set(prefix, data as number)
    }

    const prefixCurrentCounts = new Map<string, number>(prefixStartCounts)

    // 5. Assign readable IDs and build DB rows
    const dbRows: Array<{
      name: string; size: string | null; status: ItemStatus; season_year: number | null
      season_period: string | null; season_custom: string | null; consignee_id: string | null
      cost_amount: number | null; takeback_price: number | null; selling_price: number | null
      notes: string | null; readable_id: string
    }> = []
    const rowBrands: Brand[][] = []

    for (const row of prepared) {
      const parts = [...row.brands.map(b => b.abbreviation)]
      if (row.consignee) parts.push(row.consignee.abbreviation)
      const prefix = parts.join('-') || 'ITEM'
      const count = prefixCurrentCounts.get(prefix)
      if (count === undefined) { errors.push(`Missing ID range for "${row.name}"`); continue }
      prefixCurrentCounts.set(prefix, count + 1)
      const readable_id = `${prefix}-${String(count).padStart(2, '0')}`

      dbRows.push({
        name: row.name, size: row.size, status: row.status,
        season_year: row.season_year, season_period: row.season_period,
        season_custom: row.season_custom, consignee_id: row.consignee_id,
        cost_amount: row.cost_amount, takeback_price: row.takeback_price,
        selling_price: row.selling_price, notes: row.notes, readable_id,
      })
      rowBrands.push(row.brands)
    }

    // 6. Batch insert items (50 at a time)
    const brandLinks: Array<{ item_id: string; brand_id: string; sort_order: number }> = []
    const BATCH = 50
    let imported = 0

    for (let i = 0; i < dbRows.length; i += BATCH) {
      const batch = dbRows.slice(i, i + BATCH)
      const batchBrands = rowBrands.slice(i, i + BATCH)

      const { data, error } = await supabase.from('items').insert(batch).select('id')
      if (error) {
        for (const row of batch) errors.push(`"${row.name}": ${error.message}`)
        setProgress({ current: i + BATCH, total: dbRows.length })
        continue
      }

      imported += batch.length
      for (let j = 0; j < batch.length; j++) {
        const itemId = (data[j] as { id: string }).id
        for (let k = 0; k < batchBrands[j].length; k++) {
          brandLinks.push({ item_id: itemId, brand_id: batchBrands[j][k].id, sort_order: k })
        }
      }
      setProgress({ current: i + BATCH, total: dbRows.length })
    }

    // 7. Insert all brand links in one shot
    if (brandLinks.length > 0) {
      const { error } = await supabase.from('item_brands').insert(brandLinks)
      if (error) errors.push(`Brand links: ${error.message}`)
    }

    setImportErrors(errors)
    setImportCount(imported)
    setStep('done')
  }

  // ─── Wipe ─────────────────────────────────────────────────────────────────────

  const handleWipe = async () => {
    setWiping(true)
    setWipeError('')

    const email = session?.user?.email ?? ''
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: wipePassword })
    if (authErr) {
      setWipeError('Incorrect password.')
      setWiping(false)
      return
    }

    await supabase.from('items').delete().not('id', 'is', null)
    await supabase.from('brands').delete().not('id', 'is', null)
    await supabase.from('consignees').delete().eq('is_default_store', false)
    await supabase.from('id_counters').delete().not('prefix', 'is', null)

    await qc.invalidateQueries()
    setWiping(false)
    setShowWipe(false)
    setWipePassword('')
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <Layout>
      <div className="px-4 md:px-6 py-5 max-w-3xl mx-auto w-full">
        <h1 className="text-lg font-semibold text-white mb-1">Import Items</h1>
        <p className="text-xs text-gray-500 mb-6">
          Upload an Excel file to bulk-import items. New brands and consignees are created automatically.
        </p>

        {/* ── Step: Upload ─────────────────────────────────────────── */}
        {step === 'upload' && (
          <div
            className="border-2 border-dashed border-border rounded-lg p-12 text-center cursor-pointer hover:border-gray-500 transition-colors"
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => document.getElementById('xlsx-input')?.click()}
          >
            <div className="text-3xl mb-3 text-gray-600">↑</div>
            <p className="text-sm text-gray-400">Drop your .xlsx file here, or click to browse</p>
            <p className="text-xs text-gray-600 mt-1">Excel files only (.xlsx, .xls)</p>
            <input
              id="xlsx-input"
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
            />
          </div>
        )}

        {/* ── Step: Map + Preview ──────────────────────────────────── */}
        {step === 'map' && (
          <div className="space-y-6">
            {/* Sheet selector */}
            {sheetNames.length > 1 && (
              <div>
                <label className="label">Sheet</label>
                <select
                  className="input w-48"
                  value={selectedSheet}
                  onChange={e => {
                    setSelectedSheet(e.target.value)
                    if (workbookRef.current) loadSheet(workbookRef.current, e.target.value)
                  }}
                >
                  {sheetNames.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}

            {/* Column mapping */}
            <div>
              <h2 className="text-sm font-medium text-white mb-3">Column mapping</h2>
              <div className="card divide-y divide-border overflow-hidden">
                {headers.map(header => (
                  <div key={header} className="flex items-center gap-4 px-4 py-2">
                    <span className="font-mono text-xs text-gray-400 w-48 truncate" title={header}>{header}</span>
                    <span className="text-gray-700 text-xs">→</span>
                    <select
                      className="input text-sm h-8 py-0 flex-1"
                      value={mapping[header] ?? ''}
                      onChange={e => setMapping(prev => ({ ...prev, [header]: e.target.value }))}
                    >
                      {UGIS_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Stats */}
            <div className="flex gap-4 text-xs text-gray-500">
              <span><span className="text-white font-medium">{parsedRows.length}</span> rows detected</span>
              <span><span className="text-white font-medium">{validRows.length}</span> valid</span>
              {parsedRows.length - validRows.length > 0 && (
                <span className="text-red-400">
                  {parsedRows.length - validRows.length} with errors
                </span>
              )}
            </div>

            {/* New brands */}
            {detectedNewBrandNames.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-white mb-1">
                  New brands <span className="text-gray-500 font-normal">({detectedNewBrandNames.length} to create)</span>
                </h2>
                <p className="text-xs text-gray-600 mb-3">Review auto-generated abbreviations. You can edit them here or later in Brand Manager.</p>
                <div className="card divide-y divide-border overflow-hidden">
                  {detectedNewBrandNames.map(name => (
                    <div key={name} className="flex items-center gap-3 px-4 py-2">
                      <span className="text-sm text-gray-300 flex-1 truncate">{name}</span>
                      <span className="text-gray-600 text-xs">abbr</span>
                      <input
                        className={`input font-mono text-xs w-24 py-1 h-7 ${abbrConflicts.has(name) ? 'border-red-500' : ''}`}
                        value={brandAbbrs[name] ?? ''}
                        onChange={e => setBrandAbbrs(prev => ({
                          ...prev,
                          [name]: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                        }))}
                        maxLength={8}
                        placeholder="ABBR"
                      />
                      {abbrConflicts.has(name) && (
                        <span className="text-xs text-red-400">conflict</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* New consignees */}
            {detectedNewConsigneeNames.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-white mb-1">
                  New consignees <span className="text-gray-500 font-normal">({detectedNewConsigneeNames.length} to create)</span>
                </h2>
                <div className="card divide-y divide-border overflow-hidden">
                  {detectedNewConsigneeNames.map(name => (
                    <div key={name} className="flex items-center gap-3 px-4 py-2">
                      <span className="text-sm text-gray-300 flex-1 truncate">{name}</span>
                      <span className="text-gray-600 text-xs">abbr</span>
                      <input
                        className={`input font-mono text-xs w-24 py-1 h-7 ${consigneeAbbrConflicts.has(name) ? 'border-red-500' : ''}`}
                        value={consigneeAbbrs[name] ?? ''}
                        onChange={e => setConsigneeAbbrs(prev => ({
                          ...prev,
                          [name]: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                        }))}
                        maxLength={8}
                        placeholder="ABBR"
                      />
                      {consigneeAbbrConflicts.has(name) && (
                        <span className="text-xs text-red-400">conflict</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Preview table */}
            {validRows.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-white mb-3">Preview <span className="text-gray-500 font-normal">(first 5 rows)</span></h2>
                <div className="overflow-x-auto card">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-left text-gray-600">
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Brand(s)</th>
                        <th className="px-3 py-2">Size</th>
                        <th className="px-3 py-2">Season</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {validRows.slice(0, 5).map(row => (
                        <tr key={row.index}>
                          <td className="px-3 py-2 text-white max-w-[200px] truncate" title={row.name}>{row.name}</td>
                          <td className="px-3 py-2 text-gray-400">{row.brandNames.join(', ') || '—'}</td>
                          <td className="px-3 py-2 text-gray-400 font-mono">{row.size ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-400 font-mono">
                            {formatSeason(row.season.year, row.season.period, row.season.custom)}
                          </td>
                          <td className="px-3 py-2 text-gray-400">{row.status.replace('_', ' ')}</td>
                          <td className="px-3 py-2 text-gray-400">{row.cost ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Errors preview */}
            {parsedRows.some(r => r.errors.length > 0) && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded px-3 py-2">
                {parsedRows.filter(r => r.errors.length > 0).length} rows will be skipped (missing name).
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 justify-between">
              <button className="btn-ghost" onClick={() => { setStep('upload'); setRawRows([]) }}>
                ← Back
              </button>
              <button
                className="btn-primary"
                disabled={
                  validRows.length === 0 ||
                  abbrConflicts.size > 0 ||
                  consigneeAbbrConflicts.size > 0
                }
                onClick={() => void handleImport()}
              >
                Import {validRows.length} items →
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Importing ───────────────────────────────────────── */}
        {step === 'importing' && (
          <div className="text-center py-16">
            <div className="text-3xl mb-4 text-gray-600 animate-pulse">⟳</div>
            <p className="text-sm text-white mb-2">Importing…</p>
            <p className="text-xs text-gray-500 mb-6">{progress.current} / {progress.total}</p>
            <div className="w-64 mx-auto bg-surface-2 rounded-full h-1.5">
              <div
                className="bg-white h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* ── Step: Done ────────────────────────────────────────────── */}
        {step === 'done' && (
          <div className="text-center py-12 space-y-4">
            <div className="text-3xl text-white">✓</div>
            <p className="text-sm text-white font-medium">Import complete</p>
            <p className="text-xs text-gray-500">
              {importCount} items imported
              {importErrors.length > 0 && `, ${importErrors.length} failed`}
            </p>
            {importErrors.length > 0 && (
              <div className="text-left text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded px-4 py-3 space-y-1 max-h-48 overflow-y-auto">
                {importErrors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            <div className="flex gap-3 justify-center pt-2">
              <button className="btn-ghost" onClick={() => { setStep('upload'); setRawRows([]) }}>
                Import another file
              </button>
              <a href="/" className="btn-primary">Go to Inventory →</a>
            </div>
          </div>
        )}
        {/* ── Danger Zone ──────────────────────────────────────────── */}
        {step !== 'importing' && (
          <div className="mt-12 border-t border-red-900/30 pt-6">
            <p className="text-xs font-medium text-red-500 mb-1">Danger Zone</p>
            <p className="text-xs text-gray-600 mb-3">
              Permanently deletes all items, brands, non-store consignees, and ID counters. Upstairs Garments is always preserved. Used for testing only.
            </p>
            <button
              className="text-xs text-red-400 border border-red-900/40 rounded px-3 py-1.5 hover:bg-red-900/20 transition-colors"
              onClick={() => { setShowWipe(true); setWipeError(''); setWipePassword('') }}
            >
              Wipe all data…
            </button>
          </div>
        )}
      </div>

      {/* ── Wipe confirmation modal ───────────────────────────────── */}
      <Modal open={showWipe} onClose={() => setShowWipe(false)} title="Wipe All Data">
        <div className="space-y-4">
          <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded px-3 py-2 leading-relaxed">
            This will permanently delete <strong>all items, brands, non-store consignees, and ID counters</strong>. Upstairs Garments is preserved. This cannot be undone.
          </div>
          <div>
            <label className="label">Enter your account password to confirm</label>
            <input
              className="input"
              type="password"
              placeholder="Password"
              value={wipePassword}
              onChange={e => setWipePassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && wipePassword) void handleWipe() }}
              autoFocus
            />
            {wipeError && <p className="text-xs text-red-400 mt-1">{wipeError}</p>}
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button className="btn-ghost" onClick={() => setShowWipe(false)}>Cancel</button>
            <button
              className="text-sm font-medium px-4 py-1.5 rounded bg-red-700 hover:bg-red-600 text-white disabled:opacity-40 transition-colors"
              disabled={!wipePassword || wiping}
              onClick={() => void handleWipe()}
            >
              {wiping ? 'Wiping…' : 'Wipe all data'}
            </button>
          </div>
        </div>
      </Modal>
    </Layout>
  )
}

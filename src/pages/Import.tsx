import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { useQueryClient } from '@tanstack/react-query'
import Layout from '../components/layout/Layout'
import Modal from '../components/ui/Modal'
import { useBrands } from '../hooks/useBrands'
import { useConsignees } from '../hooks/useConsignees'
import { useItems } from '../hooks/useItems'
import { useAuth } from '../hooks/useAuth'
import { useProfile } from '../hooks/useProfile'
import { usePendingBrandRequests, createBrandRequests } from '../hooks/useBrandRequests'
import { supabase } from '../lib/supabase'
import { generateAbbreviation, parseSeason, normalizeStatus, guessColumnMapping } from '../lib/importUtils'
import { findMatchingBrand, normalizeBrandKey, suggestBrand } from '../lib/brandMatch'
import { formatSeason } from '../lib/idGenerator'
import { SALE_CHANNEL_CONFIG, SALE_GEOGRAPHY_CONFIG } from '../lib/constants'
import { writeItemLog } from '../lib/itemLog'
import type { Brand, Consignee, ItemStatus, SaleChannel, SaleGeography } from '../types'

// ─── Normalizers ──────────────────────────────────────────────────────────────

function normalizeSaleChannel(raw: string): SaleChannel | null {
  const s = raw.toLowerCase().trim()
  if (['in_store', 'in store', 'instore', 'store', 'walk in'].includes(s)) return 'in_store'
  if (['website', 'web', 'online', 'site'].includes(s)) return 'website'
  if (['grailed'].includes(s)) return 'grailed'
  if (['carousell', 'carousel'].includes(s)) return 'carousell'
  if (['instagram', 'ig', 'instagram dm', 'dm', 'insta'].includes(s)) return 'instagram'
  if (['other', 'misc'].includes(s)) return 'other'
  return null
}

function normalizeSaleGeography(raw: string): SaleGeography | null {
  const s = raw.toLowerCase().trim()
  if (['local', 'sg', 'singapore', 'domestic'].includes(s)) return 'local'
  if (['overseas', 'international', 'intl', 'abroad', 'foreign'].includes(s)) return 'overseas'
  return null
}

// ─── Shared column definitions ────────────────────────────────────────────────
// Single source of truth used by both export and template download.

const SHEET_COLUMNS = [
  { header: 'ID',              wch: 16 },
  { header: 'Item Name',       wch: 48 },
  { header: 'Brand',           wch: 28 },
  { header: 'Size',            wch: 8  },
  { header: 'Season',          wch: 10 },
  { header: 'Status',          wch: 14 },
  { header: 'Consignee',       wch: 20 },
  { header: 'Cost',            wch: 10 },
  { header: 'Take-back Price', wch: 14 },
  { header: 'Listed Price',    wch: 12 },
  { header: 'Sold Price',      wch: 12 },
  { header: 'Sale Channel',    wch: 14 },
  { header: 'Sale Geography',  wch: 14 },
  { header: 'Notes',           wch: 36 },
]

function buildReferenceSheet(): XLSX.WorkSheet {
  const ref: (string | number)[][] = [
    ['SEASON CODES'],
    ['Code', 'Meaning'],
    ['SS23', 'Spring / Summer 2023'],
    ['AW22', 'Autumn / Winter 2022'],
    ['R23',  'Resort 2023'],
    ['PF21', 'Pre-Fall 2021'],
    ['NA',   'No known season'],
    ['',     '(leave blank = no season)'],
    [],
    ['STATUS VALUES'],
    ['Value', 'Meaning'],
    ['in_stock',         'Default — item is available'],
    ['sold',             'Item has been sold'],
    ['reserved',         'Held for a buyer'],
    ['returned',         'Returned to the consignee'],
    ['on_rental',        'Out on loan / rental'],
    ['out_for_cleaning', 'At the cleaner'],
    ['archived',         'No longer active'],
    [],
    ['SALE CHANNEL'],
    ['Value', 'Meaning'],
    ['in_store',  'Sold in-store / walk-in'],
    ['website',   'Sold via your website'],
    ['grailed',   'Sold on Grailed'],
    ['carousell', 'Sold on Carousell'],
    ['instagram', 'Sold via Instagram DM'],
    ['other',     'Any other channel'],
    [],
    ['SALE GEOGRAPHY'],
    ['Value', 'Meaning'],
    ['local',    'Buyer is in Singapore'],
    ['overseas', 'Buyer is outside Singapore'],
    [],
    ['GENERAL NOTES'],
    ['Field', 'Format / Notes'],
    ['Cost / Prices',  'Numbers only — no $ symbol (e.g. 120 not $120)'],
    ['ID',             'Leave blank for new items; paste an existing ID to update that item'],
    ['Brand',          'Separate multiple brands with a comma (e.g. Undercover, Nike)'],
    ['Status / Channel / Geography', 'Use the raw values above (e.g. in_stock). Human-readable labels (e.g. In Stock) are also accepted.'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(ref)
  ws['!cols'] = [{ wch: 28 }, { wch: 48 }]
  return ws
}

function makeWorkbook(rows: Record<string, unknown>[]): XLSX.WorkBook {
  const ws = XLSX.utils.json_to_sheet(rows, { header: SHEET_COLUMNS.map(c => c.header) })
  ws['!cols'] = SHEET_COLUMNS.map(c => ({ wch: c.wch }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Items')
  XLSX.utils.book_append_sheet(wb, buildReferenceSheet(), 'Reference')
  return wb
}

// ─── Export ───────────────────────────────────────────────────────────────────

function exportToExcel(items: ReturnType<typeof useItems>['data']) {
  const rows = (items ?? []).map(item => ({
    'ID':              item.readable_id,
    'Item Name':       item.name,
    'Brand':           item.brands.map(b => b.name).join(', '),
    'Size':            item.size ?? '',
    'Season':          formatSeason(item.season_year, item.season_period, item.season_custom),
    'Status':          item.status,
    'Consignee':       item.consignee?.name ?? '',
    'Cost':            item.cost_amount ?? '',
    'Take-back Price': item.takeback_price ?? '',
    'Listed Price':    item.selling_price ?? '',
    'Sold Price':      item.sold_price ?? '',
    'Sale Channel':    item.sale_channel ?? '',
    'Sale Geography':  item.sale_geography ?? '',
    'Notes':           item.notes ?? '',
  }))
  XLSX.writeFile(makeWorkbook(rows), `UGIS Export ${new Date().toISOString().split('T')[0]}.xlsx`)
}

function downloadTemplate() {
  const wb = XLSX.utils.book_new()
  const itemsWs = XLSX.utils.aoa_to_sheet([SHEET_COLUMNS.map(c => c.header)])
  itemsWs['!cols'] = SHEET_COLUMNS.map(c => ({ wch: c.wch }))
  XLSX.utils.book_append_sheet(wb, itemsWs, 'Items')
  XLSX.utils.book_append_sheet(wb, buildReferenceSheet(), 'Reference')
  XLSX.writeFile(wb, 'UGIS Import Template.xlsx')
}

// ─── Types ────────────────────────────────────────────────────────────────────

const UGIS_FIELDS = [
  { value: '',              label: '— skip —' },
  { value: 'readable_id',  label: 'Item ID (for updates)' },
  { value: 'name',         label: 'Item Name' },
  { value: 'brand',        label: 'Brand(s)' },
  { value: 'size',         label: 'Size' },
  { value: 'season',       label: 'Season' },
  { value: 'status',       label: 'Status' },
  { value: 'consignee',    label: 'Consignee' },
  { value: 'cost',         label: 'Cost' },
  { value: 'takeback',     label: 'Take-back Price' },
  { value: 'selling',      label: 'Listed / Selling Price' },
  { value: 'sold_price',   label: 'Sold Price' },
  { value: 'sale_channel',    label: 'Sale Channel' },
  { value: 'sale_geography',  label: 'Sale Geography' },
  { value: 'notes',        label: 'Notes' },
]

interface ParsedRow {
  index: number
  readableId: string | null
  name: string
  brandNames: string[]
  size: string | null
  season: ReturnType<typeof parseSeason>
  status: ItemStatus
  consigneeName: string | null
  cost: number | null
  takeback: number | null
  selling: number | null
  soldPrice: number | null
  saleChannel: SaleChannel | null
  saleGeography: SaleGeography | null
  notes: string | null
  errors: string[]
}

type Step = 'upload' | 'map' | 'importing' | 'done'

// ─── parseRows ────────────────────────────────────────────────────────────────

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
      const readableId = get(row, 'readable_id') || null
      const name = get(row, 'name')
      const errors: string[] = []
      // Name only required for new items (no readable_id provided)
      if (!name && !readableId) errors.push('Name or Item ID required')

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
        readableId,
        name,
        brandNames,
        size: get(row, 'size').toUpperCase() || null,
        season: parseSeason(get(row, 'season')),
        status: normalizeStatus(get(row, 'status')),
        consigneeName: get(row, 'consignee') || null,
        cost: parseNum('cost'),
        takeback: parseNum('takeback'),
        selling: parseNum('selling'),
        soldPrice: parseNum('sold_price'),
        saleChannel: normalizeSaleChannel(get(row, 'sale_channel')),
        saleGeography: normalizeSaleGeography(get(row, 'sale_geography')),
        notes: get(row, 'notes') || null,
        errors,
      }
    })
    .filter(r => r.name || r.brandNames.length > 0 || r.readableId)
}

// Sentinel values for a flagged (possible-typo) brand's dropdown, alongside
// real brand ids.
const BRAND_SKIP = '__skip__'
const BRAND_CREATE = '__create__'

// ─── Component ────────────────────────────────────────────────────────────────

export default function Import() {
  const { data: existingBrands = [] } = useBrands()
  const { data: existingConsignees = [] } = useConsignees()
  const { data: allItems } = useItems()
  const { session } = useAuth()
  const { profile, loading: profileLoading } = useProfile()
  const isConsigneeUser = profileLoading || profile.role === 'consignee' // assume the more restrictive role while unresolved
  const qc = useQueryClient()

  const [step, setStep] = useState<Step>('upload')
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [selectedSheet, setSelectedSheet] = useState('')
  const [rawRows, setRawRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [brandAbbrs, setBrandAbbrs] = useState<Record<string, string>>({})
  // normalized sheet brand name -> chosen existing brand id, BRAND_SKIP or BRAND_CREATE
  const [brandChoices, setBrandChoices] = useState<Record<string, string>>({})
  const [requestedBrandCount, setRequestedBrandCount] = useState(0)
  const { data: pendingBrandRequests = [] } = usePendingBrandRequests()
  const [consigneeAbbrs, setConsigneeAbbrs] = useState<Record<string, string>>({})
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' })
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importCount, setImportCount] = useState(0)
  const [updateCount, setUpdateCount] = useState(0)

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

  // Lookup for existing items by readable_id
  const readableIdMap = useMemo(
    () => new Map((allItems ?? []).map(item => [item.readable_id.toLowerCase(), item])),
    [allItems],
  )

  // Rows with a readable_id that matches an existing item → update
  const updateRows = useMemo(
    () => parsedRows.filter(r => r.readableId && readableIdMap.has(r.readableId.toLowerCase())),
    [parsedRows, readableIdMap],
  )

  // Rows without a match → create (must pass name validation)
  const createRows = useMemo(
    () => parsedRows
      .filter(r => !r.readableId || !readableIdMap.has(r.readableId.toLowerCase()))
      .filter(r => r.errors.length === 0),
    [parsedRows, readableIdMap],
  )

  const existingConsigneeNameSet = useMemo(
    () => new Set(existingConsignees.map(c => c.name.toLowerCase())),
    [existingConsignees],
  )

  // Matches by name, abbreviation, OR alias under normalized (diacritic-
  // and punctuation-insensitive) comparison — "Comme des Garcons" resolves
  // to the existing "Comme des Garçons" entry instead of being proposed as
  // a brand-new (duplicate) brand. See src/lib/brandMatch.ts.
  // Sheet brand names with no exact (normalized) match to an existing brand,
  // deduped by normalized key so "Nike" / "NIKE" / "nike " in one sheet are
  // ONE entry rather than three.
  const unmatchedBrands = useMemo(() => {
    const byKey = new Map<string, string>()
    for (const n of createRows.flatMap(r => r.brandNames)) {
      const key = normalizeBrandKey(n)
      if (key && !byKey.has(key)) byKey.set(key, n)
    }
    return [...byKey.values()].filter(n => !findMatchingBrand(n, existingBrands))
  }, [createRows, existingBrands])

  // Unmatched names that are suspiciously close to an existing brand — most
  // likely typos. These are never silently created as new brands: the user
  // must pick the right existing brand, or leave it undefined and file a
  // request for staff to add/correct it.
  const brandSuggestions = useMemo(() => {
    const m = new Map<string, Brand>()
    for (const n of unmatchedBrands) {
      const sug = suggestBrand(n, existingBrands)
      if (sug) m.set(n, sug)
    }
    return m
  }, [unmatchedBrands, existingBrands])

  const flaggedBrandNames = useMemo(
    () => unmatchedBrands.filter(n => brandSuggestions.has(n)),
    [unmatchedBrands, brandSuggestions],
  )
  const unresolvedFlaggedCount = flaggedBrandNames.filter(n => !brandChoices[normalizeBrandKey(n)]).length

  // Brands that will actually be created: names with no near-match, plus
  // flagged names the user explicitly chose to create as new.
  const detectedNewBrandNames = useMemo(
    () => unmatchedBrands.filter(n => !brandSuggestions.has(n) || brandChoices[normalizeBrandKey(n)] === BRAND_CREATE),
    [unmatchedBrands, brandSuggestions, brandChoices],
  )

  const brandRowCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of createRows) {
      for (const key of new Set(r.brandNames.map(normalizeBrandKey))) m.set(key, (m.get(key) ?? 0) + 1)
    }
    return m
  }, [createRows])

  // Consignee accounts always import into their own consignee — the
  // sheet's Consignee column (if mapped) is ignored, so there's never a
  // "new consignee" to create on their behalf.
  const detectedNewConsigneeNames = useMemo(() => {
    if (isConsigneeUser) return []
    const all = new Set(createRows.map(r => r.consigneeName).filter(Boolean) as string[])
    return [...all].filter(n => !existingConsigneeNameSet.has(n.toLowerCase()))
  }, [createRows, existingConsigneeNameSet, isConsigneeUser])

  useEffect(() => {
    setBrandAbbrs(prev => {
      const takenAbbrs = new Set([...existingBrands.map(b => b.abbreviation), ...Object.values(prev)])
      const updates: Record<string, string> = {}
      for (const name of detectedNewBrandNames) {
        if (!prev[name]) { updates[name] = generateAbbreviation(name, takenAbbrs); takenAbbrs.add(updates[name]) }
      }
      return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev
    })
  }, [detectedNewBrandNames, existingBrands])

  useEffect(() => {
    setConsigneeAbbrs(prev => {
      const takenAbbrs = new Set([...existingConsignees.map(c => c.abbreviation), ...Object.values(prev)])
      const updates: Record<string, string> = {}
      for (const name of detectedNewConsigneeNames) {
        if (!prev[name]) { updates[name] = generateAbbreviation(name, takenAbbrs); takenAbbrs.add(updates[name]) }
      }
      return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev
    })
  }, [detectedNewConsigneeNames, existingConsignees])

  const abbrConflicts = useMemo(() => {
    const conflicts = new Set<string>()
    const existingAbbrs = new Set(existingBrands.map(b => b.abbreviation))
    const seen = new Set<string>()
    // Only brands still pending creation — a stale entry for a name the
    // user has since mapped to an existing brand must not block the import.
    for (const name of detectedNewBrandNames) {
      const abbr = brandAbbrs[name]
      if (abbr === undefined) continue
      if (existingAbbrs.has(abbr) || seen.has(abbr)) conflicts.add(name)
      else seen.add(abbr)
    }
    return conflicts
  }, [brandAbbrs, existingBrands, detectedNewBrandNames])

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

  // ─── File handling ────────────────────────────────────────────────────────────

  const loadSheet = useCallback((wb: XLSX.WorkBook, sheetName: string) => {
    const ws = wb.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as string[][]
    const filtered = data.filter(row => row.some(cell => (cell as string).trim() !== ''))
    setRawRows(filtered)
    setBrandChoices({})
    const guessed = guessColumnMapping(filtered[0] ?? [])
    // Consignee accounts don't get a "Consignee" mapping option (their
    // sheet always imports into their own consignee) — drop it even if
    // auto-detected, so the dropdown doesn't show a stray unselectable value.
    if (isConsigneeUser) {
      for (const key of Object.keys(guessed)) {
        if (guessed[key] === 'consignee') guessed[key] = ''
      }
    }
    setMapping(guessed)
  }, [isConsigneeUser])

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
    if (abbrConflicts.size > 0 || consigneeAbbrConflicts.size > 0 || unresolvedFlaggedCount > 0) return

    setStep('importing')
    setImportErrors([])
    const errors: string[] = []
    const total = updateRows.length + createRows.length
    setProgress({ current: 0, total, label: '' })

    // ── A. Resolve / create brands & consignees for new items ─────────────────
    // Grows as new brands get created below, so a second sheet row with the
    // same "new" brand name resolves to the one just created instead of
    // creating a duplicate.
    const knownBrands: Brand[] = [...existingBrands]
    const resolveBrand = (name: string): Brand | null | undefined => {
      const choice = brandChoices[normalizeBrandKey(name)]
      if (choice === BRAND_SKIP) return null
      if (choice && choice !== BRAND_CREATE) {
        const chosen = knownBrands.find(b => b.id === choice)
        if (chosen) return chosen
      }
      return findMatchingBrand(name, knownBrands)
    }

    for (const name of detectedNewBrandNames) {
      const abbr = brandAbbrs[name]
      if (!abbr) { errors.push(`No abbreviation for brand "${name}"`); continue }
      const { data, error } = await supabase.from('brands')
        .insert({ name, abbreviation: abbr, aliases: [], parent_id: null })
        .select().single()
      if (error) { errors.push(`Brand "${name}": ${error.message}`); continue }
      knownBrands.push(data as Brand)
    }

    const consigneeMap = new Map<string, Consignee>()
    for (const c of existingConsignees) consigneeMap.set(c.name.toLowerCase(), c)

    if (!isConsigneeUser) {
      for (const name of detectedNewConsigneeNames) {
        const abbr = consigneeAbbrs[name]
        if (!abbr) { errors.push(`No abbreviation for consignee "${name}"`); continue }
        const { data, error } = await supabase.from('consignees')
          .insert({ name, abbreviation: abbr, notes: null })
          .select().single()
        if (error) { errors.push(`Consignee "${name}": ${error.message}`); continue }
        consigneeMap.set(name.toLowerCase(), data as Consignee)
      }
    }

    // ── B. Process UPDATE rows ────────────────────────────────────────────────
    const mappedFields = new Set(Object.values(mapping).filter(Boolean))

    const buildPatch = (row: ParsedRow): Record<string, unknown> => {
      const p: Record<string, unknown> = {}
      if (mappedFields.has('name')         && row.name)             p.name = row.name
      if (mappedFields.has('size'))                                  p.size = row.size
      if (mappedFields.has('status'))                                p.status = row.status
      if (mappedFields.has('season') && row.season.year != null) {
        p.season_year = row.season.year
        p.season_period = row.season.period
        p.season_custom = row.season.custom
      }
      if (mappedFields.has('cost')         && row.cost != null)      p.cost_amount = row.cost
      if (mappedFields.has('takeback')     && row.takeback != null)  p.takeback_price = row.takeback
      if (mappedFields.has('selling')      && row.selling != null)   p.selling_price = row.selling
      if (mappedFields.has('sold_price')   && row.soldPrice != null) p.sold_price = row.soldPrice
      if (mappedFields.has('sale_channel') && row.saleChannel)       p.sale_channel = row.saleChannel
      if (mappedFields.has('sale_geography') && row.saleGeography)   p.sale_geography = row.saleGeography
      if (mappedFields.has('notes')        && row.notes != null)     p.notes = row.notes
      return p
    }

    let updated = 0
    setProgress({ current: 0, total, label: 'Updating existing items…' })

    for (const row of updateRows) {
      const existing = readableIdMap.get(row.readableId!.toLowerCase())
      if (!existing) continue
      const patch = buildPatch(row)
      if (Object.keys(patch).length === 0) { updated++; setProgress(p => ({ ...p, current: p.current + 1 })); continue }
      const { error } = await supabase.from('items').update(patch).eq('id', existing.id)
      if (error) { errors.push(`Update "${row.readableId}": ${error.message}`); continue }
      updated++
      setProgress(p => ({ ...p, current: p.current + 1 }))
    }

    if (updated > 0) {
      const fieldLabels = [...mappedFields]
        .filter(f => !['readable_id', 'name', 'brand', 'consignee'].includes(f))
        .map(f => UGIS_FIELDS.find(u => u.value === f)?.label ?? f)
        .join(', ')
      await writeItemLog({
        item_id: null,
        item_name: 'Bulk Update',
        field_changes: {
          _action: { from: null, to: 'bulk_updated' },
          _count:  { from: null, to: updated },
          _fields: { from: null, to: fieldLabels },
        },
        snapshot_before: {},
      })
    }

    // ── C. Process CREATE rows ────────────────────────────────────────────────
    setProgress(p => ({ ...p, label: 'Creating new items…' }))

    const storeConsignee = existingConsignees.find(c => c.is_default_store) ?? null
    // A consignee account's own row, forced onto every created item — the
    // sheet's Consignee column is ignored for them (RLS would reject
    // anything else anyway).
    const ownConsignee = isConsigneeUser
      ? (existingConsignees.find(c => c.id === profile.consignee?.id) ?? null)
      : null

    interface PreparedRow {
      name: string; size: string | null; status: ItemStatus
      season_year: number | null; season_period: string | null; season_custom: string | null
      consignee_id: string | null; cost_amount: number | null; takeback_price: number | null
      selling_price: number | null; sold_price: number | null
      sale_channel: SaleChannel | null; sale_geography: SaleGeography | null
      notes: string | null; brands: Brand[]; consignee: Consignee | null
    }

    const prepared: PreparedRow[] = []
    for (const row of createRows) {
      const brands = row.brandNames
        .map(n => resolveBrand(n))
        .filter((b): b is Brand => b !== undefined && b !== null)
      const consignee = isConsigneeUser
        ? ownConsignee
        : row.consigneeName
          ? (consigneeMap.get(row.consigneeName.toLowerCase()) ?? storeConsignee)
          : storeConsignee
      prepared.push({
        name: row.name, size: row.size, status: row.status,
        season_year: row.season.year, season_period: row.season.period, season_custom: row.season.custom,
        consignee_id: consignee?.id ?? null,
        cost_amount: row.cost, takeback_price: row.takeback, selling_price: row.selling,
        sold_price: row.soldPrice, sale_channel: row.saleChannel, sale_geography: row.saleGeography,
        notes: row.notes, brands, consignee,
      })
    }

    // Reserve ID ranges
    const prefixGroups = new Map<string, number>()
    for (const row of prepared) {
      const prefix = [...row.brands.map(b => b.abbreviation), ...(row.consignee ? [row.consignee.abbreviation] : [])].join('-') || 'ITEM'
      prefixGroups.set(prefix, (prefixGroups.get(prefix) ?? 0) + 1)
    }
    const prefixStartCounts = new Map<string, number>()
    for (const [prefix, count] of prefixGroups) {
      const { data, error } = await supabase.rpc('reserve_id_range', { p_prefix: prefix, p_count: count })
      if (error) { errors.push(`ID reservation for "${prefix}": ${error.message}`); continue }
      prefixStartCounts.set(prefix, data as number)
    }
    const prefixCurrentCounts = new Map<string, number>(prefixStartCounts)

    const dbRows: Array<{
      name: string; size: string | null; status: ItemStatus; season_year: number | null
      season_period: string | null; season_custom: string | null; consignee_id: string | null
      cost_amount: number | null; takeback_price: number | null; selling_price: number | null
      sold_price: number | null; sale_channel: SaleChannel | null; sale_geography: SaleGeography | null
      notes: string | null; readable_id: string; is_migrated: boolean
    }> = []
    const rowBrands: Brand[][] = []

    for (const row of prepared) {
      const prefix = [...row.brands.map(b => b.abbreviation), ...(row.consignee ? [row.consignee.abbreviation] : [])].join('-') || 'ITEM'
      const count = prefixCurrentCounts.get(prefix)
      if (count === undefined) { errors.push(`Missing ID range for "${row.name}"`); continue }
      prefixCurrentCounts.set(prefix, count + 1)
      dbRows.push({
        name: row.name, size: row.size, status: row.status,
        season_year: row.season_year, season_period: row.season_period, season_custom: row.season_custom,
        consignee_id: row.consignee_id, cost_amount: row.cost_amount, takeback_price: row.takeback_price,
        selling_price: row.selling_price, sold_price: row.sold_price,
        sale_channel: row.sale_channel, sale_geography: row.sale_geography,
        notes: row.notes, readable_id: `${prefix}-${String(count).padStart(2, '0')}`,
        is_migrated: true,
      })
      rowBrands.push(row.brands)
    }

    const brandLinks: Array<{ item_id: string; brand_id: string; sort_order: number }> = []
    const BATCH = 50
    let imported = 0

    for (let i = 0; i < dbRows.length; i += BATCH) {
      const batch = dbRows.slice(i, i + BATCH)
      const batchBrands = rowBrands.slice(i, i + BATCH)
      const { data, error } = await supabase.from('items').insert(batch).select('id')
      if (error) {
        for (const row of batch) errors.push(`"${row.name}": ${error.message}`)
        setProgress(p => ({ ...p, current: p.current + batch.length }))
        continue
      }
      imported += batch.length
      for (let j = 0; j < batch.length; j++) {
        const itemId = (data[j] as { id: string }).id
        for (let k = 0; k < batchBrands[j].length; k++) {
          brandLinks.push({ item_id: itemId, brand_id: batchBrands[j][k].id, sort_order: k })
        }
      }
      setProgress(p => ({ ...p, current: p.current + batch.length }))
    }

    if (brandLinks.length > 0) {
      const { error } = await supabase.from('item_brands').insert(brandLinks)
      if (error) errors.push(`Brand links: ${error.message}`)
    }

    if (imported > 0) {
      const breakdownMap = new Map<string, number>()
      for (const row of prepared) {
        const name = row.consignee?.name ?? 'Unassigned'
        breakdownMap.set(name, (breakdownMap.get(name) ?? 0) + 1)
      }
      const breakdown = [...breakdownMap.entries()]
        .sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} (${c})`).join(', ')
      await writeItemLog({
        item_id: null, item_name: 'Bulk Import',
        field_changes: {
          _action: { from: null, to: 'imported' },
          _count: { from: null, to: imported },
          _breakdown: { from: null, to: breakdown },
        },
        snapshot_before: {},
      })
    }

    // File a request for every flagged brand left undefined, so staff can
    // add/correct it and assign it to the affected items afterwards.
    const alreadyRequested = new Set(pendingBrandRequests.map(r => normalizeBrandKey(r.name)))
    const requests: { name: string; item_count: number; example_item: string | null }[] = []
    for (const name of flaggedBrandNames) {
      const key = normalizeBrandKey(name)
      if (brandChoices[key] !== BRAND_SKIP || alreadyRequested.has(key)) continue
      const affected = createRows.filter(r => r.brandNames.some(b => normalizeBrandKey(b) === key))
      requests.push({ name, item_count: affected.length, example_item: affected[0]?.name ?? null })
    }
    try {
      await createBrandRequests(requests)
      await qc.invalidateQueries({ queryKey: ['brand_requests'] })
    } catch (err) {
      errors.push(`Brand request: ${err instanceof Error ? err.message : 'failed to file'}`)
    }
    setRequestedBrandCount(requests.length)

    if (updated > 0 || imported > 0) {
      await qc.invalidateQueries({ queryKey: ['items'] })
      await qc.invalidateQueries({ queryKey: ['item_logs'] })
    }

    setImportErrors(errors)
    setImportCount(imported)
    setUpdateCount(updated)
    setStep('done')
  }

  // ─── Wipe ─────────────────────────────────────────────────────────────────────

  const handleWipe = async () => {
    setWiping(true); setWipeError('')
    const { error: authErr } = await supabase.auth.signInWithPassword({
      email: session?.user?.email ?? '', password: wipePassword,
    })
    if (authErr) { setWipeError('Incorrect password.'); setWiping(false); return }
    await supabase.from('items').delete().not('id', 'is', null)
    await supabase.from('brands').delete().not('id', 'is', null)
    await supabase.from('consignees').delete().eq('is_default_store', false)
    await supabase.from('id_counters').delete().not('prefix', 'is', null)
    await qc.invalidateQueries()
    setWiping(false); setShowWipe(false); setWipePassword('')
  }

  // ─── Derived UI values ────────────────────────────────────────────────────────

  const totalActionable = updateRows.length + createRows.length
  const skippedRows = parsedRows.filter(r =>
    !r.readableId || !readableIdMap.has(r.readableId.toLowerCase())
  ).filter(r => r.errors.length > 0).length

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <Layout>
      <div className="px-4 md:px-6 py-5 max-w-3xl mx-auto w-full">
        <h1 className="text-lg font-semibold text-white mb-1">Import / Export</h1>
        <p className="text-xs text-gray-500 mb-6">
          Upload an Excel file to create new items or bulk-update existing ones. Match existing items by their ID column.
        </p>

        {/* ── Upload ───────────────────────────────────────────────── */}
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
            <input id="xlsx-input" type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f) }} />
          </div>
        )}

        {/* ── Map + Preview ─────────────────────────────────────────── */}
        {step === 'map' && (
          <div className="space-y-6">
            {sheetNames.length > 1 && (
              <div>
                <label className="label">Sheet</label>
                <select className="input w-48" value={selectedSheet} onChange={e => {
                  setSelectedSheet(e.target.value)
                  if (workbookRef.current) loadSheet(workbookRef.current, e.target.value)
                }}>
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
                      {UGIS_FIELDS
                        .filter(f => !isConsigneeUser || f.value !== 'consignee')
                        .map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Stats */}
            <div className="flex flex-wrap gap-4 text-xs text-gray-500">
              <span><span className="text-white font-medium">{parsedRows.length}</span> rows detected</span>
              {createRows.length > 0 && (
                <span className="text-emerald-400"><span className="font-medium">{createRows.length}</span> will be created</span>
              )}
              {updateRows.length > 0 && (
                <span className="text-blue-400"><span className="font-medium">{updateRows.length}</span> will be updated</span>
              )}
              {skippedRows > 0 && (
                <span className="text-red-400"><span className="font-medium">{skippedRows}</span> skipped (missing name)</span>
              )}
            </div>

            {/* Possible typos — must be resolved before importing */}
            {flaggedBrandNames.length > 0 && (
              <div className="border border-amber-500/40 bg-amber-500/5 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-amber-500/20">
                  <h2 className="text-sm font-medium text-amber-400">
                    Possible brand typos <span className="font-normal">({unresolvedFlaggedCount} of {flaggedBrandNames.length} need a decision)</span>
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    These brand names aren't in your brand list but look very close to one that is. Pick the right brand, or leave it undefined for now — the items import without a brand and a request is sent to add it.
                  </p>
                </div>
                <div className="divide-y divide-border">
                  {flaggedBrandNames.map(name => {
                    const key = normalizeBrandKey(name)
                    const sug = brandSuggestions.get(name)!
                    const choice = brandChoices[key] ?? ''
                    const rows = brandRowCounts.get(key) ?? 0
                    const usingSuggestion = choice === sug.id
                    const chosenBrand = choice && choice !== BRAND_SKIP && choice !== BRAND_CREATE
                      ? existingBrands.find(b => b.id === choice)
                      : undefined
                    const summary = !choice ? null
                      : choice === BRAND_SKIP ? 'Left undefined — request will be sent'
                      : choice === BRAND_CREATE ? 'Will be created as a new brand'
                      : `Using “${chosenBrand?.name ?? '…'}”`
                    const setChoice = (value: string) => setBrandChoices(prev => ({ ...prev, [key]: value }))
                    return (
                      <div
                        key={key}
                        className={`px-4 py-3 space-y-2 border-l-4 ${choice ? 'border-emerald-500/70' : 'border-amber-500'}`}
                      >
                        <div className="flex items-baseline justify-between gap-3 flex-wrap">
                          <p className="text-sm font-semibold text-white">
                            “{name}”
                            <span className="ml-2 text-xs font-normal text-gray-600">{rows} row{rows === 1 ? '' : 's'}</span>
                          </p>
                          {summary ? (
                            <span className="text-xs font-medium text-emerald-400">✓ {summary}</span>
                          ) : (
                            <span className="text-xs font-medium text-amber-400">Needs a decision</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setChoice(sug.id)}
                            className={`text-sm font-semibold rounded px-3 py-1.5 transition-colors ${
                              usingSuggestion
                                ? 'bg-emerald-500 text-black'
                                : 'bg-amber-400 text-black hover:bg-amber-300'
                            }`}
                          >
                            {usingSuggestion ? '✓ ' : ''}Did you mean “{sug.name}”?
                          </button>
                          <span className="text-xs text-gray-600">or</span>
                          <select
                            className="input text-xs h-8 py-0 w-full sm:w-72"
                            value={usingSuggestion ? '' : choice}
                            onChange={e => e.target.value && setChoice(e.target.value)}
                          >
                            <option value="">Something else…</option>
                            <option value={BRAND_SKIP}>Leave undefined for now — request to add</option>
                            {!isConsigneeUser && <option value={BRAND_CREATE}>Create as a new brand</option>}
                            <optgroup label="Pick from existing brands">
                              {existingBrands.map(b => (
                                <option key={b.id} value={b.id}>
                                  {b.id === sug.id ? `★ ${b.name} — closest match` : b.name}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* New brands */}
            {detectedNewBrandNames.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-white mb-1">
                  New brands <span className="text-gray-500 font-normal">({detectedNewBrandNames.length} to create)</span>
                </h2>
                <div className="card divide-y divide-border overflow-hidden">
                  {detectedNewBrandNames.map(name => (
                    <div key={name} className="flex items-center gap-3 px-4 py-2">
                      <span className="text-sm text-gray-300 flex-1 truncate">{name}</span>
                      <span className="text-gray-600 text-xs">abbr</span>
                      <input
                        className={`input font-mono text-xs w-24 py-1 h-7 ${abbrConflicts.has(name) ? 'border-red-500' : ''}`}
                        value={brandAbbrs[name] ?? ''}
                        onChange={e => setBrandAbbrs(prev => ({ ...prev, [name]: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}
                        maxLength={8} placeholder="ABBR"
                      />
                      {abbrConflicts.has(name) && <span className="text-xs text-red-400">conflict</span>}
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
                        onChange={e => setConsigneeAbbrs(prev => ({ ...prev, [name]: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}
                        maxLength={8} placeholder="ABBR"
                      />
                      {consigneeAbbrConflicts.has(name) && <span className="text-xs text-red-400">conflict</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Preview: updates */}
            {updateRows.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-white mb-1">
                  Updating <span className="text-blue-400">{updateRows.length}</span> existing items
                  <span className="text-gray-500 font-normal ml-2">(first 5 shown)</span>
                </h2>
                <div className="overflow-x-auto card">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-left text-gray-600">
                        <th className="px-3 py-2">ID</th>
                        {Array.from(new Set(Object.values(mapping).filter(f => f && f !== 'readable_id'))).map(f => (
                          <th key={f} className="px-3 py-2">{UGIS_FIELDS.find(u => u.value === f)?.label ?? f}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {updateRows.slice(0, 5).map(row => (
                        <tr key={row.index}>
                          <td className="px-3 py-2 font-mono text-blue-400">{row.readableId}</td>
                          {Array.from(new Set(Object.values(mapping).filter(f => f && f !== 'readable_id'))).map(f => (
                            <td key={f} className="px-3 py-2 text-gray-300 max-w-[160px] truncate">
                              {f === 'sale_channel' && row.saleChannel ? SALE_CHANNEL_CONFIG[row.saleChannel].label
                                : f === 'sale_geography' && row.saleGeography ? SALE_GEOGRAPHY_CONFIG[row.saleGeography].label
                                : f === 'status' ? row.status
                                : f === 'sold_price' ? (row.soldPrice ?? '—')
                                : f === 'name' ? row.name
                                : '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Preview: creates */}
            {createRows.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-white mb-1">
                  Creating <span className="text-emerald-400">{createRows.length}</span> new items
                  <span className="text-gray-500 font-normal ml-2">(first 5 shown)</span>
                </h2>
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
                      {createRows.slice(0, 5).map(row => (
                        <tr key={row.index}>
                          <td className="px-3 py-2 text-white max-w-[200px] truncate" title={row.name}>{row.name}</td>
                          <td className="px-3 py-2 text-gray-400">{row.brandNames.join(', ') || '—'}</td>
                          <td className="px-3 py-2 text-gray-400 font-mono">{row.size ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-400 font-mono">{formatSeason(row.season.year, row.season.period, row.season.custom)}</td>
                          <td className="px-3 py-2 text-gray-400">{row.status.replace('_', ' ')}</td>
                          <td className="px-3 py-2 text-gray-400">{row.cost ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {skippedRows > 0 && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded px-3 py-2">
                {skippedRows} rows will be skipped (no name and no matching ID).
              </div>
            )}

            {unresolvedFlaggedCount > 0 && (
              <p className="text-xs text-amber-400 text-right">
                Decide on {unresolvedFlaggedCount} possible brand typo{unresolvedFlaggedCount === 1 ? '' : 's'} above to continue.
              </p>
            )}

            <div className="flex gap-3 justify-between">
              <button className="btn-ghost" onClick={() => { setStep('upload'); setRawRows([]) }}>← Back</button>
              <button
                className="btn-primary"
                disabled={totalActionable === 0 || abbrConflicts.size > 0 || consigneeAbbrConflicts.size > 0 || unresolvedFlaggedCount > 0}
                onClick={() => void handleImport()}
              >
                {createRows.length > 0 && updateRows.length > 0
                  ? `Process ${totalActionable} rows (${createRows.length} create · ${updateRows.length} update) →`
                  : createRows.length > 0
                    ? `Import ${createRows.length} items →`
                    : `Update ${updateRows.length} items →`}
              </button>
            </div>
          </div>
        )}

        {/* ── Importing ─────────────────────────────────────────────── */}
        {step === 'importing' && (
          <div className="text-center py-16">
            <div className="text-3xl mb-4 text-gray-600 animate-pulse">⟳</div>
            <p className="text-sm text-white mb-1">{progress.label || 'Processing…'}</p>
            <p className="text-xs text-gray-500 mb-6">{progress.current} / {progress.total}</p>
            <div className="w-64 mx-auto bg-surface-2 rounded-full h-1.5">
              <div
                className="bg-white h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* ── Done ──────────────────────────────────────────────────── */}
        {step === 'done' && (
          <div className="text-center py-12 space-y-4">
            <div className="text-3xl text-white">✓</div>
            <p className="text-sm text-white font-medium">Complete</p>
            <div className="flex justify-center gap-6 text-xs text-gray-500">
              {importCount > 0 && <span><span className="text-emerald-400 font-medium">{importCount}</span> created</span>}
              {updateCount > 0 && <span><span className="text-blue-400 font-medium">{updateCount}</span> updated</span>}
              {requestedBrandCount > 0 && <span><span className="text-amber-400 font-medium">{requestedBrandCount}</span> brand request{requestedBrandCount === 1 ? '' : 's'} sent</span>}
              {importErrors.length > 0 && <span className="text-red-400">{importErrors.length} failed</span>}
            </div>
            {importErrors.length > 0 && (
              <div className="text-left text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded px-4 py-3 space-y-1 max-h-48 overflow-y-auto">
                {importErrors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            <div className="flex gap-3 justify-center pt-2">
              <button className="btn-ghost" onClick={() => { setStep('upload'); setRawRows([]) }}>Process another file</button>
              <a href="/" className="btn-primary">Go to Inventory →</a>
            </div>
          </div>
        )}

        {/* ── Export ───────────────────────────────────────────────── */}
        {step !== 'importing' && (
          <div className="mt-10 border-t border-border pt-6">
            <p className="text-sm font-medium text-white mb-1">Export / Template</p>
            <p className="text-xs text-gray-600 mb-3">
              Export your inventory or download a blank template. Both files use identical column headers — fill in the exported file and re-import to bulk-update.
            </p>
            <div className="flex gap-2 flex-wrap">
              <button className="btn-ghost text-xs" onClick={() => exportToExcel(allItems)} disabled={!allItems?.length}>
                Export inventory ↓ {allItems?.length ? `(${allItems.length} items)` : ''}
              </button>
              <button className="btn-ghost text-xs" onClick={downloadTemplate}>
                Download blank template ↓
              </button>
            </div>
          </div>
        )}

        {/* ── Danger Zone — staff only; a consignee account's RLS scope
            would limit the actual damage to their own rows, but this
            action has no place in their UI regardless. ──────────────── */}
        {step !== 'importing' && !isConsigneeUser && (
          <div className="mt-12 border-t border-red-900/30 pt-6">
            <p className="text-xs font-medium text-red-500 mb-1">Danger Zone</p>
            <p className="text-xs text-gray-600 mb-3">
              Permanently deletes all items, brands, non-store consignees, and ID counters. Upstairs Garments is always preserved.
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

      <Modal open={showWipe} onClose={() => setShowWipe(false)} title="Wipe All Data">
        <div className="space-y-4">
          <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded px-3 py-2 leading-relaxed">
            This will permanently delete <strong>all items, brands, non-store consignees, and ID counters</strong>. Upstairs Garments is preserved. This cannot be undone.
          </div>
          <div>
            <label className="label">Enter your account password to confirm</label>
            <input className="input" type="password" placeholder="Password" value={wipePassword}
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

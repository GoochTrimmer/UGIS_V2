import { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { useItems } from '../hooks/useItems'
import { useBrands } from '../hooks/useBrands'
import { useConsignees } from '../hooks/useConsignees'
import Layout from '../components/layout/Layout'
import Spinner from '../components/ui/Spinner'
import MultiSelect from '../components/ui/MultiSelect'
import { STATUS_CONFIG, SALE_CHANNEL_CONFIG, SALE_GEOGRAPHY_CONFIG } from '../lib/constants'
import type { Item, ItemStatus } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtShort(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

function fmtFull(n: number): string {
  return new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', maximumFractionDigits: 2 }).format(n)
}

function itemCost(item: Item): number {
  if (item.consignee && !item.consignee.is_default_store) return item.takeback_price ?? 0
  return item.cost_amount ?? 0
}

const STATUS_ORDER: ItemStatus[] = [
  'in_stock', 'reserved', 'on_rental', 'out_for_cleaning', 'returned', 'sold', 'archived',
]

const PIE_COLORS: Record<string, string> = {
  in_stock:         '#34d399',
  sold:             '#f87171',
  on_rental:        '#60a5fa',
  out_for_cleaning: '#fbbf24',
  reserved:         '#fb923c',
  returned:         '#22d3ee',
  archived:         '#a78bfa',
}

const BRAND_PALETTE = [
  '#6366f1', '#8b5cf6', '#ec4899', '#14b8a6',
  '#f59e0b', '#ef4444', '#10b981', '#3b82f6',
  '#a855f7', '#f97316', '#06b6d4', '#84cc16',
  '#e11d48', '#0891b2', '#65a30d', '#d97706',
]

const TOOLTIP_STYLE = {
  contentStyle: { background: '#111', border: '1px solid #2a2a2a', borderRadius: 6, fontSize: 12 },
  itemStyle: { color: '#bbb' },
  labelStyle: { color: '#fff', fontWeight: 600 },
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: string
  sub?: string
  tone?: 'positive' | 'negative' | 'neutral'
}

function StatCard({ label, value, sub, tone }: StatCardProps) {
  const valueColor =
    tone === 'positive' ? 'text-emerald-400' :
    tone === 'negative' ? 'text-red-400' :
    'text-white'
  return (
    <div className="card px-4 py-3">
      <p className="text-xs text-gray-600 mb-1">{label}</p>
      <p className={`text-lg font-semibold leading-tight ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-gray-700 mt-0.5">{sub}</p>}
    </div>
  )
}

interface TooltipPayloadItem {
  name: string
  value: number
  fill: string
}

function BrandGroupTooltip({
  active, payload, label, rows,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
  rows: Record<string, string | number>[]
}) {
  if (!active || !payload?.length) return null
  const fullName = rows.find(r => r.name === label)?.fullName ?? label
  const segments = payload.filter(p => (p.value ?? 0) > 0)
  if (!segments.length) return null
  return (
    <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 6, padding: '8px 12px', fontSize: 12, minWidth: 160 }}>
      <p style={{ color: '#fff', fontWeight: 600, marginBottom: 6 }}>{String(fullName)}</p>
      {segments.map(p => (
        <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ width: 8, height: 8, background: p.fill, borderRadius: 2, flexShrink: 0 }} />
          <span style={{ color: '#ccc', fontFamily: 'monospace', fontSize: 11 }}>{p.name}</span>
          <span style={{ color: '#888', marginLeft: 'auto', paddingLeft: 16 }}>{fmtFull(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function ChartCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="mb-4">
        <p className="text-xs font-medium text-white">{title}</p>
        {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
      </div>
      {children}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Statistics() {
  const { data: allItems = [], isLoading } = useItems()
  const { data: brands = [] } = useBrands()
  const { data: consignees = [] } = useConsignees()

  const [brandFilters, setBrandFilters] = useState<string[]>([])
  const [consigneeFilters, setConsigneeFilters] = useState<string[]>([])
  const [groupByParent, setGroupByParent] = useState(true)

  const items = useMemo(() => {
    let list = allItems
    if (brandFilters.length > 0) {
      const set = new Set(brandFilters)
      list = list.filter(i => i.brands.some(b => set.has(b.id)))
    }
    if (consigneeFilters.length > 0) {
      const set = new Set(consigneeFilters)
      list = list.filter(i => i.consignee ? set.has(i.consignee.id) : false)
    }
    return list
  }, [allItems, brandFilters, consigneeFilters])

  // ── Metrics ──────────────────────────────────────────────────────────────────

  const metrics = useMemo(() => {
    const inStock = items.filter(i => i.status === 'in_stock')
    const sold    = items.filter(i => i.status === 'sold')

    const inventoryValue  = inStock.reduce((s, i) => s + (i.selling_price ?? 0), 0)
    const costBasisStock  = inStock.reduce((s, i) => s + itemCost(i), 0)
    const margin          = inventoryValue - costBasisStock

    const salesRevenue    = sold.reduce((s, i) => s + (i.sold_price ?? i.selling_price ?? 0), 0)
    const costOfSales     = sold.reduce((s, i) => s + itemCost(i), 0)
    const realizedProfit  = salesRevenue - costOfSales

    return {
      totalItems: items.length,
      inStockCount: inStock.length,
      soldCount: sold.length,
      inventoryValue,
      costBasisStock,
      margin,
      salesRevenue,
      costOfSales,
      realizedProfit,
    }
  }, [items])

  // ── Chart data ────────────────────────────────────────────────────────────────

  const statusData = useMemo(() => {
    const counts: Partial<Record<ItemStatus, number>> = {}
    for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1
    return STATUS_ORDER
      .filter(s => counts[s])
      .map(s => ({ name: STATUS_CONFIG[s].label, value: counts[s]!, fill: PIE_COLORS[s] }))
  }, [items])

  const consigneeChartData = useMemo(() => {
    const map = new Map<string, { name: string; value: number; cost: number }>()
    for (const item of items.filter(i => i.status === 'in_stock')) {
      const key = item.consignee?.name ?? 'Unassigned'
      const prev = map.get(key) ?? { name: key, value: 0, cost: 0 }
      map.set(key, {
        name: key,
        value: prev.value + (item.selling_price ?? 0),
        cost:  prev.cost  + itemCost(item),
      })
    }
    return [...map.values()].sort((a, b) => b.value - a.value)
  }, [items])

  const channelChartData = useMemo(() => {
    const map = new Map<string, { name: string; revenue: number; count: number }>()
    for (const item of items.filter(i => i.status === 'sold' && i.sale_channel)) {
      const key = item.sale_channel!
      const label = SALE_CHANNEL_CONFIG[key].label
      const prev = map.get(key) ?? { name: label, revenue: 0, count: 0 }
      map.set(key, { name: label, revenue: prev.revenue + (item.sold_price ?? item.selling_price ?? 0), count: prev.count + 1 })
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue)
  }, [items])

  const geographyChartData = useMemo(() => {
    const acc = { local: { count: 0, revenue: 0 }, overseas: { count: 0, revenue: 0 } }
    for (const item of items.filter(i => i.status === 'sold' && i.sale_geography)) {
      const g = item.sale_geography!
      acc[g].count += 1
      acc[g].revenue += item.sold_price ?? item.selling_price ?? 0
    }
    return (['local', 'overseas'] as const)
      .filter(g => acc[g].count > 0)
      .map(g => ({
        name: SALE_GEOGRAPHY_CONFIG[g].label,
        value: acc[g].count,
        revenue: acc[g].revenue,
        fill: SALE_GEOGRAPHY_CONFIG[g].color,
      }))
  }, [items])

  const brandById = useMemo(() => new Map(brands.map(b => [b.id, b])), [brands])

  // Flat: one bar per brand (ungrouped)
  const flatBrandData = useMemo(() => {
    const map = new Map<string, { name: string; fullName: string; value: number }>()
    for (const item of items.filter(i => i.status === 'in_stock')) {
      for (const brand of item.brands) {
        const prev = map.get(brand.id) ?? { name: brand.abbreviation, fullName: brand.name, value: 0 }
        map.set(brand.id, { ...prev, value: prev.value + (item.selling_price ?? 0) })
      }
    }
    return [...map.values()].sort((a, b) => b.value - a.value).slice(0, 12)
  }, [items])

  // Grouped: one bar per parent brand, stacked by sub-brand
  const groupedBrandData = useMemo(() => {
    const groupMap = new Map<string, { label: string; fullName: string; subs: Map<string, number>; total: number }>()

    for (const item of items.filter(i => i.status === 'in_stock')) {
      for (const brand of item.brands) {
        const parent = brand.parent_id ? brandById.get(brand.parent_id) : null
        const parentKey = parent ? parent.id : brand.id
        const parentLabel = parent ? parent.abbreviation : brand.abbreviation
        const parentFullName = parent ? parent.name : brand.name
        const subKey = brand.abbreviation
        const val = item.selling_price ?? 0

        if (!groupMap.has(parentKey)) {
          groupMap.set(parentKey, { label: parentLabel, fullName: parentFullName, subs: new Map(), total: 0 })
        }
        const group = groupMap.get(parentKey)!
        group.subs.set(subKey, (group.subs.get(subKey) ?? 0) + val)
        group.total += val
      }
    }

    const sortedGroups = [...groupMap.values()].sort((a, b) => b.total - a.total)

    // Assign a distinct palette colour to every sub-brand key globally
    const allSubKeysList: string[] = []
    for (const g of sortedGroups) for (const k of g.subs.keys()) if (!allSubKeysList.includes(k)) allSubKeysList.push(k)
    const keyColors: Record<string, string> = {}
    allSubKeysList.forEach((k, i) => { keyColors[k] = BRAND_PALETTE[i % BRAND_PALETTE.length] })

    // Parent legend uses the first sub-brand's colour as the representative swatch
    const parentBaseColor: Record<string, string> = {}
    for (const g of sortedGroups) {
      const firstKey = [...g.subs.keys()][0]
      parentBaseColor[g.label] = firstKey ? keyColors[firstKey] : BRAND_PALETTE[0]
    }

    const allSubKeys = new Set<string>()
    for (const g of groupMap.values()) for (const k of g.subs.keys()) allSubKeys.add(k)
    const subKeys = [...allSubKeys]

    const rows = sortedGroups.slice(0, 12).map(g => {
      const row: Record<string, string | number> = { name: g.label, fullName: g.fullName }
      for (const [k, v] of g.subs) row[k] = v
      return row
    })

    // One legend entry per parent (full colour, no opacity)
    const parentLegend = sortedGroups.slice(0, 12).map(g => ({
      label: g.label,
      fullName: g.fullName,
      color: parentBaseColor[g.label] ?? BRAND_PALETTE[0],
    }))

    return { rows, subKeys, keyColors, parentLegend }
  }, [items, brandById])

  // ── Render ────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return <Layout><div className="flex justify-center py-24"><Spinner /></div></Layout>
  }

  return (
    <Layout>
      <div className="px-4 md:px-6 py-5">

        {/* Header */}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div>
            <h1 className="text-base font-semibold text-white">Statistics</h1>
            <p className="text-xs text-gray-600 mt-0.5">
              {items.length} items · inventory figures use in-stock items only
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <MultiSelect
              options={brands.map(b => ({ value: b.id, label: b.name }))}
              selected={brandFilters}
              onChange={setBrandFilters}
              placeholder="brands"
            />
            <MultiSelect
              options={consignees.map(c => ({ value: c.id, label: c.name }))}
              selected={consigneeFilters}
              onChange={setConsigneeFilters}
              placeholder="consignees"
            />
            {(brandFilters.length > 0 || consigneeFilters.length > 0) && (
              <button
                className="btn-ghost text-xs h-8 px-2"
                onClick={() => { setBrandFilters([]); setConsigneeFilters([]) }}
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <StatCard label="In Stock" value={String(metrics.inStockCount)} sub={`of ${metrics.totalItems} total items`} />
          <StatCard label="Inventory Value" value={fmtFull(metrics.inventoryValue)} sub="selling price · in-stock" />
          <StatCard label="Cost Basis" value={fmtFull(metrics.costBasisStock)} sub="cost / take-back · in-stock" />
          <StatCard
            label="Unrealised Margin"
            value={fmtFull(metrics.margin)}
            sub="value minus cost basis"
            tone={metrics.margin > 0 ? 'positive' : metrics.margin < 0 ? 'negative' : 'neutral'}
          />
          <StatCard label="Items Sold" value={String(metrics.soldCount)} sub="all time" />
          <StatCard label="Sales Revenue" value={fmtFull(metrics.salesRevenue)} sub="selling price · sold" />
          <StatCard label="Cost of Sales" value={fmtFull(metrics.costOfSales)} sub="cost / take-back · sold" />
          <StatCard
            label="Realised Profit"
            value={fmtFull(metrics.realizedProfit)}
            sub="revenue minus cost of sales"
            tone={metrics.realizedProfit > 0 ? 'positive' : metrics.realizedProfit < 0 ? 'negative' : 'neutral'}
          />
        </div>

        {/* Charts — top row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">

          {/* Status distribution */}
          <ChartCard title="Items by Status">
            {statusData.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-10">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="45%"
                    innerRadius={54}
                    outerRadius={82}
                    paddingAngle={2}
                  >
                    {statusData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown) => [String(v), 'items']}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    formatter={value => <span style={{ fontSize: 11, color: '#666' }}>{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Value by consignee */}
          <ChartCard title="Inventory Value by Consignee" sub="in-stock items · selling price">
            {consigneeChartData.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-10">No in-stock data</p>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={consigneeChartData} layout="vertical" margin={{ left: 4, right: 20, top: 4, bottom: 4 }}>
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10, fill: '#555' }}
                    tickFormatter={fmtShort}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#888' }}
                    width={86}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(v: unknown, name: any) => [fmtFull(v as number), name === 'value' ? 'Sell value' : 'Cost basis'] as any}
                    cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  />
                  <Bar dataKey="value" name="value" fill="#6366f1" radius={[0, 3, 3, 0]} maxBarSize={18} />
                  <Bar dataKey="cost"  name="cost"  fill="#4b5563" radius={[0, 3, 3, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        {/* Brand chart — full width */}
        <div className="card p-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-xs font-medium text-white">Inventory Value by Brand</p>
              <p className="text-xs text-gray-600 mt-0.5">in-stock items · selling price · top 12</p>
            </div>
            <button
              className={`text-xs border rounded px-2.5 py-1 transition-colors shrink-0 ml-4 ${
                groupByParent
                  ? 'border-indigo-500/50 text-indigo-400 bg-indigo-500/10'
                  : 'border-border text-gray-600 hover:text-gray-300'
              }`}
              onClick={() => setGroupByParent(v => !v)}
            >
              Group by parent
            </button>
          </div>

          {groupByParent ? (
            groupedBrandData.rows.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-10">No in-stock data</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={groupedBrandData.rows} margin={{ left: 4, right: 16, top: 4, bottom: 4 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#555' }} tickFormatter={fmtShort} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                      content={<BrandGroupTooltip rows={groupedBrandData.rows} />}
                    />
                    {groupedBrandData.subKeys.map(key => (
                      <Bar key={key} dataKey={key} stackId="stack" fill={groupedBrandData.keyColors[key]} maxBarSize={44} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
                {/* Parent-brand-only legend */}
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 px-1">
                  {groupedBrandData.parentLegend.map(entry => (
                    <div key={entry.label} className="flex items-center gap-1.5" title={entry.fullName}>
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: entry.color }} />
                      <span className="text-xs text-gray-500">{entry.label}</span>
                    </div>
                  ))}
                </div>
              </>
            )
          ) : (
            flatBrandData.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-10">No in-stock data</p>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={flatBrandData} margin={{ left: 4, right: 16, top: 4, bottom: 4 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#555' }} tickFormatter={fmtShort} axisLine={false} tickLine={false} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown) => [fmtFull(v as number), 'Sell value']}
                    labelFormatter={(label: unknown) => {
                      const entry = flatBrandData.find(b => b.name === String(label))
                      return entry?.fullName ?? String(label)
                    }}
                    cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  />
                  <Bar dataKey="value" fill="#8b5cf6" radius={[3, 3, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            )
          )}
        </div>

        {/* Sales channel + geography — row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">

          {/* Revenue by channel */}
          <ChartCard title="Revenue by Sale Channel" sub="sold items · actual sold price">
            {channelChartData.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-10">No channel data recorded yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={channelChartData} layout="vertical" margin={{ left: 4, right: 20, top: 4, bottom: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#555' }} tickFormatter={fmtShort} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#888' }} width={80} axisLine={false} tickLine={false} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown) => [fmtFull(v as number), 'Revenue']}
                    cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  />
                  <Bar dataKey="revenue" fill="#6366f1" radius={[0, 3, 3, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Local vs Overseas */}
          <ChartCard title="Local vs Overseas" sub="sold items by buyer geography">
            {geographyChartData.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-10">No geography data recorded yet.</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={geographyChartData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                      innerRadius={50} outerRadius={76} paddingAngle={3}>
                      {geographyChartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      formatter={(v: unknown) => [String(v), 'items']}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex justify-center gap-6 mt-1">
                  {geographyChartData.map(entry => (
                    <div key={entry.name} className="text-center">
                      <div className="flex items-center gap-1.5 justify-center mb-0.5">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: entry.fill }} />
                        <span className="text-xs text-gray-500">{entry.name}</span>
                      </div>
                      <p className="text-sm font-semibold text-white">{entry.value}</p>
                      <p className="text-xs text-gray-600">{fmtFull(entry.revenue)}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </ChartCard>
        </div>

      </div>
    </Layout>
  )
}

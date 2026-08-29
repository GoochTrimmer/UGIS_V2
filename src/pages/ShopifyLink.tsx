import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Layout from '../components/layout/Layout'
import Spinner from '../components/ui/Spinner'
import { invokeEdgeFunction } from '../lib/edgeFunctions'
import { useItems } from '../hooks/useItems'

// ─── Bulk SKU match (spec §3 step 1) ──────────────────────────────────────

interface MatchedRow { itemId: string; readableId: string; productId: string; productTitle: string; variantId: string; needsFinishing: boolean }
interface UnmatchedRow { itemId: string; readableId: string }
interface ScanResult { scannedShopifyVariants: number; scannedUgisItems: number; matched: MatchedRow[]; unmatched: UnmatchedRow[] }

function BulkMatch() {
  const qc = useQueryClient()
  const [scanning, setScanning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [applied, setApplied] = useState<{ applied: number; errors: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const scan = async () => {
    setScanning(true); setError(null); setResult(null); setApplied(null)
    const { data, error } = await invokeEdgeFunction<ScanResult>('shopify-bulk-match', { action: 'scan' })
    setScanning(false)
    if (error) { setError(error); return }
    setResult(data)
  }

  const apply = async () => {
    if (!result?.matched.length) return
    setApplying(true); setError(null)
    const { data, error } = await invokeEdgeFunction<{ applied: number; errors: string[] }>('shopify-bulk-match', {
      action: 'apply',
      matches: result.matched.map(m => ({ itemId: m.itemId, productId: m.productId, variantId: m.variantId, needsFinishing: m.needsFinishing })),
    })
    setApplying(false)
    if (error) { setError(error); return }
    setApplied(data)
    await qc.invalidateQueries({ queryKey: ['items'] })
    setResult(null)
  }

  return (
    <div className="card p-4 space-y-4">
      <div>
        <p className="text-sm font-medium text-white mb-1">Bulk match by SKU</p>
        <p className="text-xs text-gray-500">
          Pulls your full Shopify catalog once and matches it against UGIS items with no Shopify link yet, by comparing SKU text to the item ID. Leftovers go to the link-by-URL tool below.
        </p>
      </div>

      <button className="btn-ghost text-xs" onClick={() => void scan()} disabled={scanning}>
        {scanning ? 'Scanning…' : 'Scan catalog'}
      </button>

      {error && <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded px-3 py-2">{error}</p>}

      {applied && (
        <p className="text-xs text-emerald-400">
          Linked {applied.applied} item{applied.applied === 1 ? '' : 's'}.
          {applied.errors.length > 0 && <span className="text-red-400"> {applied.errors.length} failed.</span>}
        </p>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex gap-4 text-xs text-gray-500">
            <span>{result.scannedShopifyVariants} Shopify variants scanned</span>
            <span>{result.scannedUgisItems} unlinked UGIS items</span>
          </div>

          {result.matched.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-emerald-400">{result.matched.length} matched</p>
                <button className="btn-primary py-1 px-2 text-xs" onClick={() => void apply()} disabled={applying}>
                  {applying ? 'Applying…' : `Apply ${result.matched.length} match${result.matched.length === 1 ? '' : 'es'}`}
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto border border-border rounded divide-y divide-border">
                {result.matched.map(m => (
                  <div key={m.itemId} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                    <span className="font-mono text-gray-400 w-28 truncate">{m.readableId}</span>
                    <span className="text-gray-300 truncate flex-1">{m.productTitle}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.unmatched.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1">{result.unmatched.length} unmatched — use link-by-URL below</p>
              <div className="max-h-32 overflow-y-auto border border-border rounded divide-y divide-border">
                {result.unmatched.map(u => (
                  <div key={u.itemId} className="px-3 py-1.5 text-xs font-mono text-gray-500">{u.readableId}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Link by URL (spec §3 exception tool) ─────────────────────────────────

interface ResolvedProduct {
  productId: string
  title: string
  handle: string
  variants: { variantId: string; title: string; sku: string | null }[]
}

function LinkByUrl() {
  const qc = useQueryClient()
  const { data: items = [], isLoading: itemsLoading } = useItems()
  const unlinkedItems = useMemo(() => items.filter(i => !i.shopify_product_id), [items])

  const [url, setUrl] = useState('')
  const [resolving, setResolving] = useState(false)
  const [product, setProduct] = useState<ResolvedProduct | null>(null)
  const [variantId, setVariantId] = useState('')
  const [itemQuery, setItemQuery] = useState('')
  const [itemPickerOpen, setItemPickerOpen] = useState(false)
  const [itemId, setItemId] = useState('')
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linked, setLinked] = useState(false)

  const filteredItems = unlinkedItems.filter(i =>
    !itemQuery ||
    i.name.toLowerCase().includes(itemQuery.toLowerCase()) ||
    i.readable_id.toLowerCase().includes(itemQuery.toLowerCase())
  ).slice(0, 20)

  const resolve = async () => {
    setResolving(true); setError(null); setProduct(null); setLinked(false)
    const { data, error } = await invokeEdgeFunction<ResolvedProduct>('shopify-resolve-link', { url })
    setResolving(false)
    if (error) { setError(error); return }
    setProduct(data)
    setVariantId(data?.variants[0]?.variantId ?? '')
  }

  const selectItem = (id: string, label: string) => {
    setItemId(id)
    setItemQuery(label)
    setItemPickerOpen(false)
  }

  const handleItemQueryChange = (value: string) => {
    setItemQuery(value)
    setItemId('') // typing invalidates whatever was picked, until a new selection is made
    setItemPickerOpen(true)
  }

  const link = async () => {
    if (!product || !variantId || !itemId) return
    setLinking(true); setError(null)
    const { error } = await invokeEdgeFunction('shopify-resolve-link', { itemId, productId: product.productId, variantId })
    setLinking(false)
    if (error) { setError(error); return }
    setLinked(true)
    setProduct(null); setUrl(''); setItemId(''); setItemQuery(''); setItemPickerOpen(false)
    await qc.invalidateQueries({ queryKey: ['items'] })
  }

  return (
    <div className="card p-4 space-y-4">
      <div>
        <p className="text-sm font-medium text-white mb-1">Link by URL</p>
        <p className="text-xs text-gray-500">
          Paste a Shopify storefront or admin product URL to resolve and link it to a UGIS item — for the leftovers the bulk match can't resolve automatically.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="https://yourstore.com/products/... or https://admin.shopify.com/store/.../products/..."
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && url) void resolve() }}
        />
        <button className="btn-ghost text-xs shrink-0" onClick={() => void resolve()} disabled={!url || resolving}>
          {resolving ? 'Resolving…' : 'Resolve'}
        </button>
      </div>

      {error && <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded px-3 py-2">{error}</p>}
      {linked && <p className="text-xs text-emerald-400">Linked.</p>}

      {product && (
        <div className="space-y-3 border-t border-border pt-3">
          <p className="text-sm text-white">{product.title}</p>

          {product.variants.length > 1 && (
            <div>
              <label className="label">Variant</label>
              <select className="input" value={variantId} onChange={e => setVariantId(e.target.value)}>
                {product.variants.map(v => (
                  <option key={v.variantId} value={v.variantId}>{v.title} {v.sku ? `(${v.sku})` : ''}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="label">Link to UGIS item</label>
            <input
              className="input mb-1.5"
              placeholder="Search by name or ID…"
              value={itemQuery}
              onChange={e => handleItemQueryChange(e.target.value)}
              onFocus={() => setItemPickerOpen(true)}
            />
            {itemPickerOpen && (
              itemsLoading ? (
                <Spinner size="sm" />
              ) : (
                <div className="max-h-40 overflow-y-auto border border-border rounded divide-y divide-border">
                  {filteredItems.map(i => (
                    <button
                      type="button"
                      key={i.id}
                      onClick={() => selectItem(i.id, `${i.readable_id} — ${i.name}`)}
                      className={`w-full text-left flex items-center gap-3 px-3 py-1.5 text-xs hover:bg-surface-2 transition-colors ${itemId === i.id ? 'bg-surface-3' : ''}`}
                    >
                      <span className="font-mono text-gray-400 w-28 truncate">{i.readable_id}</span>
                      <span className="text-gray-300 truncate flex-1">{i.name}</span>
                    </button>
                  ))}
                  {filteredItems.length === 0 && (
                    <p className="text-xs text-gray-600 px-3 py-2">No unlinked items match.</p>
                  )}
                </div>
              )
            )}
          </div>

          <div className="flex justify-end">
            <button className="btn-primary text-xs" disabled={!itemId || !variantId || linking} onClick={() => void link()}>
              {linking ? 'Linking…' : 'Link item'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function ShopifyLink() {
  return (
    <Layout>
      <div className="px-4 md:px-6 py-5 max-w-2xl mx-auto w-full space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-white mb-1">Shopify Linking</h1>
          <p className="text-xs text-gray-500">
            Backfill tools for connecting already-published Shopify listings to their UGIS records. New items created in UGIS with "Ready to list" link automatically — see the item's edit form.
          </p>
        </div>
        <BulkMatch />
        <LinkByUrl />
      </div>
    </Layout>
  )
}

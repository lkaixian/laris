import { useEffect, useRef, useState } from 'react'
import { api, imageUrl, ApiError } from './api'
import type { Me } from './api'
import { useFetch, msg, Async, Hint, PageHeader, Status as Chip } from './ui'
import { ConfirmDialog, MoreMenu } from './kit'

// "Catalog photos": one photo with many labelled products -> one card per product to check, edit, confirm or ask suppliers about.
// Contract: docs/api-contract.md (listings), setup: docs/deploy.md 10b.
type Status = 'needs_review' | 'confirmed' | 'discarded'
interface Item {
  id: string; position: number; description: string; labels: string[]; sku: string | null; sizes: string[]
  price: string | number | null; currency: string | null; bbox: [number, number, number, number]
  status: Status; reasons: string[]; item_key: string | null; crop_url: string
  price_tiers?: Tier[]; stock_qty?: string | number | null; category?: string | null; category_suggestion?: string | null
}
// One customer price: for one size (or every size when size is null) from min_qty up. Priced by the rules engine, never the model.
interface Tier { size: string | null; min_qty: string | number; price: string | number }
interface TierRow { size: string; min_qty: string; price: string }
interface ListingRow { id: string; party_name: string | null; note: string | null; created_at: string; items: number; to_review: number; image_url: string; thumb_url?: string }
interface Detail extends Omit<ListingRow, 'items'> { items: Item[] }
interface Supplier { id: string; name: string; contact: string | null }
interface SendResult { rfq_id: string; sends: { supplier_id: string; status: 'sent' | 'failed'; error: string | null }[] }

// Permissions arrive on GET /api/me. Missing (mock mode, older server): show the page and let the server say no.
const perms = (me?: Me) => (me as (Me & { permissions?: string[] }) | undefined)?.permissions
export const canUpload = (me?: Me) => perms(me)?.includes('upload_documents') ?? true
const canSeePrice = (me: Me | undefined, owner: boolean) => perms(me)?.includes('view_costs') ?? owner

const BADGE: Record<Status, string> = { needs_review: 'Needs review', confirmed: 'Confirmed', discarded: 'Discarded' }
const HINT: Record<string, string> = {
  unverified_sku: 'SKU could not be confirmed from the photo text',
  unverified_price: 'Price could not be confirmed from the photo text',
  no_ocr_check: 'The photo text was not double-checked, please compare with the photo',
}
const KEY_RE = /^[a-z][a-z0-9_]{0,60}$/
const when = (s: string) => new Date(s).toLocaleString()
const money = (cur: string | null, v: string | number) => `${cur ?? 'MYR'} ${Number(v).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`
const qtyText = (v: string | number) => Number(v).toLocaleString('en-MY', { maximumFractionDigits: 3 })
const tierKey = (t: { size: string | null; min_qty: string | number; price: string | number }) => `${t.size ?? ''}|${Number(t.min_qty)}|${Number(t.price)}`
// Retry makes sense when the vision service was asleep or the connection dropped; not for a rejected file or a missing setup.
const transient = (e: unknown) => e instanceof ApiError && (e.status === 502 || e.status === 504 || e.code === 'network' || e.code === 'vision_unavailable')

// Images need the identity headers: fetch as a blob (data URLs in mock mode pass through).
function Pic({ url, alt, className }: { url: string; alt: string; className?: string }) {
  const [src, setSrc] = useState('')
  const [bad, setBad] = useState(false)
  useEffect(() => {
    let live = true, made = ''
    setBad(false)
    imageUrl(url).then(u => { made = u; if (live) setSrc(u); else if (u.startsWith('blob:')) URL.revokeObjectURL(u) }, () => live && setBad(true))
    return () => { live = false; if (made.startsWith('blob:')) URL.revokeObjectURL(made) }
  }, [url])
  if (bad) return <span className="text-sm text-muted">Photo not available.</span>
  return src ? <img src={src} alt={alt} className={className} /> : <span role="status" aria-busy="true" className="skeleton block h-24 w-40 max-w-full"><span className="sr-only">Loading photo...</span></span>
}

// ---------- Upload ----------
type CatMode = 'auto' | 'suggest' | 'manual'
const CAT_MODES: [CatMode, string, string][] = [
  ['auto', 'Auto', 'The photo reader sets the category of each product. You can still change it.'],
  ['suggest', 'Suggest', 'The photo reader proposes a category and you accept it with one click.'],
  ['manual', 'Manual', 'No category is proposed. Pick or type one yourself.'],
]
const MODE_KEY = 'laris.catmode'
const readMode = (): CatMode => { try { const v = localStorage.getItem(MODE_KEY); return v === 'auto' || v === 'manual' ? v : 'suggest' } catch { return 'suggest' } }
function UploadCard({ owner, suppliers, onDone }: { owner: boolean; suppliers: Supplier[]; onDone: (id: string) => void }) {
  const [file, setFile] = useState<File>()
  const [sup, setSup] = useState('')
  const [note, setNote] = useState('')
  const [formErr, setFormErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<{ text: string; retry: boolean }>()
  const [mode, setMode] = useState<CatMode>(readMode)
  const input = useRef<HTMLInputElement>(null)

  const send = async () => {
    if (!file) return setFormErr('Choose a photo first.')
    if (busy) return
    setFormErr(''); setErr(undefined); setBusy(true)
    try {
      const fd = new FormData()
      fd.append('image', file)
      if (sup) fd.append('supplier_id', sup)
      if (note.trim()) fd.append('note', note.trim())
      fd.append('categorize', mode)
      const r = await api<{ listing_id: string }>('POST', '/listings', fd)
      setFile(undefined); setNote(''); if (input.current) input.current.value = ''
      onDone(r.listing_id)
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) setErr({ text: owner ? e.message : 'Photo reading is not set up yet. Ask the owner to set up photo reading.', retry: false })
      else if (e instanceof ApiError && (e.code === 'timeout' || e.status === 502 || e.status === 504)) setErr({ text: 'The upload may still be processing. Check the list below before trying again.', retry: false })  // the server may still finish
      else if (transient(e)) setErr({ text: 'The photo reader is not answering yet (it may still be waking up). Nothing was saved. Try again in a minute.', retry: true })
      else setErr({ text: msg(e), retry: false })
    } finally { setBusy(false) }
  }

  return (
    <section aria-labelledby="cat-up" className="card max-w-2xl">
      <h2 id="cat-up" className="mb-2 text-md font-semibold">Read a catalog photo</h2>
      <form className="grid gap-3" onSubmit={e => { e.preventDefault(); send() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">Photo with several labelled products (take one or choose from the gallery)
          <input id="cat-file" ref={input} type="file" accept="image/*" capture="environment" className="input py-2 font-normal" onChange={e => { setFile(e.target.files?.[0]); setFormErr('') }} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Supplier (optional)
          <select className="input font-normal" value={sup} onChange={e => setSup(e.target.value)}>
            <option value="">Not sure / none</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Note (optional)
          <input className="input font-normal" maxLength={300} value={note} onChange={e => setNote(e.target.value)} />
        </label>
        <fieldset className="grid gap-1">
          <legend className="text-sm font-semibold">Categories</legend>
          <div role="group" aria-label="How products are categorised" className="flex flex-wrap gap-2">
            {CAT_MODES.map(([k, name]) => <button key={k} type="button" className="btn aria-pressed:bg-tint aria-pressed:font-bold" aria-pressed={mode === k}
              onClick={() => { setMode(k); try { localStorage.setItem(MODE_KEY, k) } catch { /* storage blocked: lasts for this visit */ } }}>{name}</button>)}
          </div>
          <p className="text-sm text-muted">{CAT_MODES.find(([k]) => k === mode)?.[2]}</p>
        </fieldset>
        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        <div><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Reading the photo...' : 'Read the photo'}</button></div>
        <p role="status" className="text-sm text-muted">{busy ? 'Reading the photo… the first run after a quiet period can take a few minutes. Please keep this page open.' : ''}</p>
      </form>
      {err && (
        <div role="alert" className="mt-3 rounded-ui border border-warn bg-warn-bg p-3 text-warn">
          <p>{err.text}</p>
          {err.retry && <button type="button" className="btn mt-3" onClick={send}>Retry reading the photo</button>}
        </div>
      )}
    </section>
  )
}

// ---------- One product ----------
function ItemCard({ lid, n, it, cats, showPrice, suppliers, supErr, onChanged }: { lid: string; n: number; it: Item; cats: string[]; showPrice: boolean; suppliers: Supplier[]; supErr?: { error?: string; reload: () => void }; onChanged: () => void }) {
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState({ description: '', category: '', sku: '', sizes: '', item_key: '', price: '', stock: '' })
  const [tiers, setTiers] = useState<TierRow[]>([])
  const [formErr, setFormErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [asking, setAsking] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [askErr, setAskErr] = useState('')
  const [res, setRes] = useState<SendResult>()
  const [note, setNote] = useState('')
  const [confirmOff, setConfirmOff] = useState(false)
  const ref = useRef<HTMLLIElement>(null)
  const id = `it-${it.id}`

  const patch = async (body: Record<string, unknown>, done?: () => void) => {
    if (busy) return
    setBusy(true); setErr('')
    try { await api('PATCH', `/listings/${lid}/items/${it.id}`, body); done?.(); onChanged() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  const open = () => {
    setF({ description: it.description, category: it.category ?? '', sku: it.sku ?? '', sizes: it.sizes.join(', '), item_key: it.item_key ?? '', price: it.price === null ? '' : String(it.price),
      stock: it.stock_qty === null || it.stock_qty === undefined ? '' : String(Number(it.stock_qty)) })
    setTiers((it.price_tiers ?? []).map(t => ({ size: t.size ?? '', min_qty: String(Number(t.min_qty)), price: String(Number(t.price)) })))
    setFormErr(''); setEdit(true)
  }
  const save = () => {
    const body: Record<string, unknown> = {}
    const sizes = f.sizes.split(',').map(s => s.trim()).filter(Boolean)
    if (!f.description.trim()) return setFormErr('The description cannot be empty.')
    if (f.item_key.trim() && !KEY_RE.test(f.item_key.trim())) return setFormErr('Item key: lower-case letters, digits and underscores, starting with a letter.')
    if (showPrice && f.price.trim() && !(Number(f.price) > 0)) return setFormErr('Price must be a number above zero.')
    if (f.stock.trim() && !(Number(f.stock) >= 0)) return setFormErr('Stock count must be zero or more, or left empty when you do not count it.')
    if (showPrice) {
      for (const [i, t] of tiers.entries()) {
        if (!(Number(t.price) > 0)) return setFormErr(`Price row ${i + 1}: the price must be a number above zero.`)
        if (!(Number(t.min_qty) > 0)) return setFormErr(`Price row ${i + 1}: the minimum quantity must be above zero.`)
        if (t.size && !sizes.some(s => s.toLowerCase() === t.size.toLowerCase())) return setFormErr(`Price row ${i + 1}: size ${t.size} is not in the sizes list.`)
      }
      const keys = tiers.map(t => `${t.size.toLowerCase()}|${Number(t.min_qty)}`)
      if (new Set(keys).size !== keys.length) return setFormErr('Two price rows have the same size and minimum quantity.')
    }
    if (f.description.trim() !== it.description) body.description = f.description.trim()
    if (f.category.trim() !== (it.category ?? '')) body.category = f.category.trim() || null
    if (f.sku.trim() !== (it.sku ?? '')) body.sku = f.sku.trim() || null
    if (sizes.join(',') !== it.sizes.join(',')) body.sizes = sizes
    if (f.item_key.trim() && f.item_key.trim() !== (it.item_key ?? '')) body.item_key = f.item_key.trim()
    if (showPrice && f.price.trim() && Number(f.price) !== Number(it.price)) body.price = Number(f.price)
    const stock = f.stock.trim() === '' ? null : Number(f.stock)
    const was = it.stock_qty === null || it.stock_qty === undefined ? null : Number(it.stock_qty)
    if (stock !== was) body.stock_qty = stock
    const next = tiers.map(t => ({ size: t.size || null, min_qty: t.min_qty.trim() || '1', price: t.price.trim() }))
    if (showPrice && next.map(tierKey).sort().join() !== (it.price_tiers ?? []).map(tierKey).sort().join()) body.price_tiers = next
    setFormErr('')
    if (!Object.keys(body).length) return setEdit(false)
    patch(body, () => setEdit(false))
  }

  const ask = async () => {
    if (!picked.length) return setAskErr('Choose at least one supplier.')
    if (busy) return
    setAskErr(''); setBusy(true)
    try {
      setRes(await api<SendResult>('POST', `/listings/${lid}/items/${it.id}/ask`, { supplier_ids: picked, ...(note.trim() ? { note: note.trim() } : {}) }))
      setAsking(false); setPicked([])
    } catch (e) { setAskErr(msg(e)) } finally { setBusy(false) }
  }
  const nameOf = (sid: string) => suppliers.find(s => s.id === sid)?.name ?? 'Supplier'
  const off = it.status === 'discarded'

  return (
    <li ref={ref} id={id} tabIndex={-1} className={`card scroll-mt-4 ${off ? 'opacity-80' : ''}`} aria-labelledby={`${id}-h`}>
      <div className="flex flex-wrap items-start gap-4">
        <Pic url={it.crop_url} alt={`Cropped photo of product ${n}`} className="max-h-40 w-[120px] max-w-full rounded-ui border border-hairline object-contain" />
        <div className="min-w-0 flex-1 basis-60">
          <h3 id={`${id}-h`} className="flex flex-wrap items-center gap-2 font-semibold">
            <span>{n}. <span className={off ? 'line-through' : undefined}>{it.description}</span></span>
            <Chip v={it.status} />
            {it.category && <span className="rounded-ui border border-soft px-1.5 text-sm font-normal">{it.category}</span>}
          </h3>
          {!it.category && it.category_suggestion && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm"><span className="text-muted">Suggested category:</span> <b>{it.category_suggestion}</b>
              <button type="button" className="btn min-h-9 px-2" aria-disabled={busy || undefined} onClick={() => patch({ category: it.category_suggestion })}>Use this category</button></p>
          )}
          {it.labels.length > 0 && (
            <p className="mt-1 text-sm"><span className="text-muted">Printed on the label:</span>{' '}
              {it.labels.map((l, i) => <span key={i} dir="auto" className="mr-2 inline-block rounded-ui border border-soft px-1.5">{l}</span>)}</p>
          )}
          <dl className="mt-2 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">SKU</dt><dd className="break-words">{it.sku ?? 'none'}</dd></div>
            <div><dt className="text-muted">Sizes</dt><dd className="break-words">{it.sizes.length ? it.sizes.join(', ') : 'none'}</dd></div>
            {it.item_key && <div><dt className="text-muted">Item key</dt><dd className="break-words">{it.item_key}</dd></div>}
            {it.price !== null && <div><dt className="text-muted">Price</dt><dd className="tabular-nums">{money(it.currency, it.price)}</dd></div>}
            <div><dt className="text-muted">Stock</dt><dd className="tabular-nums">{it.stock_qty === null || it.stock_qty === undefined ? 'Not counted' : qtyText(it.stock_qty)}</dd></div>
          </dl>
          {showPrice && (it.price_tiers?.length ?? 0) > 0 && (
            <div className="mt-2 text-sm">
              <p className="text-muted">Prices by size and quantity</p>
              <ul className="mt-1 grid gap-1">
                {[...it.price_tiers!].sort((x, y) => (x.size ?? '').localeCompare(y.size ?? '') || Number(x.min_qty) - Number(y.min_qty)).map(t => <li key={tierKey(t)} className="tabular-nums">{t.size ?? 'Any size'}, from {qtyText(t.min_qty)}: {money(it.currency, t.price)} each</li>)}
              </ul>
            </div>
          )}
          {it.reasons.length > 0 && (
            <ul className="mt-2 grid gap-1 text-sm text-warn">
              {it.reasons.map(r => <li key={r}><span className="font-semibold">Check:</span> {HINT[r] ?? r.replace(/_/g, ' ')}</li>)}
            </ul>
          )}
        </div>
      </div>

      {edit ? (
        <form className="mt-3 grid gap-3 border-t border-hairline pt-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); save() }}>
          <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">Description
            <input className="input font-normal" maxLength={300} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">Category
            <input className="input font-normal" maxLength={60} list={`${id}-cats`} value={f.category} onChange={e => setF({ ...f, category: e.target.value })} />
            <datalist id={`${id}-cats`}>{cats.map(c => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">SKU
            <input className="input font-normal" maxLength={80} value={f.sku} onChange={e => setF({ ...f, sku: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">Sizes (separated by commas)
            <input className="input font-normal" value={f.sizes} onChange={e => setF({ ...f, sizes: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">Item key
            <input className="input font-normal" aria-describedby={`${id}-key-help`} value={f.item_key} onChange={e => setF({ ...f, item_key: e.target.value })} />
            <Hint id={`${id}-key-help`}>A short code for this product in your cost book: lower-case letters, digits and underscores.</Hint>
          </label>
          {showPrice && (
            <label className="flex flex-col gap-1 text-sm font-semibold">Price
              <input className="input font-normal" inputMode="decimal" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm font-semibold">Stock count
            <input className="input font-normal" inputMode="decimal" aria-describedby={`${id}-stock-help`} value={f.stock} onChange={e => setF({ ...f, stock: e.target.value })} />
            <Hint id={`${id}-stock-help`}>Leave empty if you do not count it. Replies say "in stock" only when a count is set. Sales do not lower it.</Hint>
          </label>
          {showPrice && (
            <fieldset className="min-w-0 sm:col-span-2">
              <legend className="mb-1 text-sm font-semibold">Prices by size and quantity (optional)</legend>
              <p id={`${id}-tier-help`} className="mb-2 text-sm text-muted">Each row is the price per unit from that quantity up. The largest minimum the order reaches is used. "Any size" applies to sizes without their own rows.</p>
              {tiers.length > 0 && (
                <ul className="grid gap-2">
                  {tiers.map((t, i) => {
                    const set = (k: keyof TierRow, v: string) => setTiers(ts => ts.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
                    const sizes = f.sizes.split(',').map(s => s.trim()).filter(Boolean)
                    return (
                      <li key={i} className="grid grid-cols-2 items-end gap-2 rounded-ui border border-soft p-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                        <label className="flex min-w-0 flex-col gap-1 text-sm">Size
                          <select className="input" value={t.size} onChange={e => set('size', e.target.value)}>
                            <option value="">Any size</option>
                            {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                            {t.size && !sizes.includes(t.size) && <option value={t.size}>{t.size} (not in sizes)</option>}
                          </select>
                        </label>
                        <label className="flex min-w-0 flex-col gap-1 text-sm">From quantity
                          <input className="input" inputMode="decimal" value={t.min_qty} onChange={e => set('min_qty', e.target.value)} />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1 text-sm">Price each
                          <input className="input" inputMode="decimal" value={t.price} onChange={e => set('price', e.target.value)} />
                        </label>
                        <button type="button" className="btn" onClick={() => setTiers(ts => ts.filter((_, j) => j !== i))}>Remove<span className="sr-only"> price row {i + 1}</span></button>
                      </li>
                    )
                  })}
                </ul>
              )}
              <button type="button" className="btn mt-2" aria-describedby={`${id}-tier-help`} onClick={() => setTiers(ts => [...ts, { size: '', min_qty: '1', price: '' }])}>Add a price row</button>
            </fieldset>
          )}
          {formErr && <p role="alert" className="text-sm text-warn sm:col-span-2">{formErr}</p>}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Saving...' : 'Save changes'}</button>
            <button type="button" className="btn" onClick={() => setEdit(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-hairline pt-3">
          <MoreMenu label={`More for product ${n}`}>
            <button type="button" data-close className="sidelink w-full text-left" onClick={open}>Edit product {n}</button>
            <button type="button" data-close className="sidelink w-full text-left" aria-expanded={asking} aria-controls={`${id}-ask`} onClick={() => setAsking(!asking)}>Ask suppliers about product {n}</button>
            {!off && <button type="button" data-close className="sidelink w-full text-left text-warn" aria-disabled={busy || undefined} onClick={() => setConfirmOff(true)}>Discard product {n}</button>}
          </MoreMenu>
          {it.status !== 'confirmed' && (
            <button type="button" className="btn btn-primary" aria-disabled={busy || undefined} onClick={() => patch({ status: 'confirmed' })}>
              {off ? `Restore and confirm product ${n}` : `Confirm product ${n}`}
            </button>
          )}
        </div>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-warn">{err}</p>}
      <ConfirmDialog open={confirmOff} danger title={`Discard product ${n}?`} confirmLabel="Discard" body="It is kept in this photo as discarded, and you can restore it later."
        onCancel={() => setConfirmOff(false)} onConfirm={() => { setConfirmOff(false); patch({ status: 'discarded' }) }} />

      {asking && (
        <form id={`${id}-ask`} className="mt-3 grid gap-3 border-t border-soft pt-3" onSubmit={e => { e.preventDefault(); ask() }}>
          <fieldset className="min-w-0">
            <legend className="mb-1 text-sm font-semibold">Which suppliers to ask? (choose at least one)</legend>
            {supErr?.error ? <div role="alert" className="text-sm text-warn"><p>{supErr.error}</p><button type="button" className="btn mt-2" onClick={supErr.reload}>Retry loading</button></div> : suppliers.length === 0 ? <p className="text-sm text-muted">No suppliers yet. Add one under Contacts first.</p> : (
              <ul className="grid gap-1">
                {suppliers.map(s => (
                  <li key={s.id}>
                    <label className="flex min-h-11 items-center gap-3 rounded-ui border border-soft bg-surface px-3 text-sm">
                      <input type="checkbox" className="size-5 shrink-0" checked={picked.includes(s.id)} onChange={() => setPicked(p => (p.includes(s.id) ? p.filter(x => x !== s.id) : [...p, s.id]))} />
                      <span className="min-w-0 break-words"><span className="font-semibold">{s.name}</span> <span className="text-muted">{s.contact ?? 'no WhatsApp number'}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
          <label className="flex flex-col gap-1 text-sm font-semibold">Ask (optional, up to 300 characters)
            <textarea className="input min-h-20 py-2 font-normal" maxLength={300} value={note} onChange={e => setNote(e.target.value)} />
          </label>
          {askErr && <p role="alert" className="text-sm text-warn">{askErr}</p>}
          <div><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Sending...' : 'Send on WhatsApp'}</button></div>
        </form>
      )}
      {res && (
        <div role="status" className="mt-3 rounded-ui border border-soft p-3 text-sm">
          <p className="font-semibold">Asked about product {n}</p>
          <ul className="mt-1 grid gap-1">
            {res.sends.map(s => <li key={s.supplier_id}><span className="font-semibold">{nameOf(s.supplier_id)}</span>: {s.status === 'sent' ? 'sent' : <span className="text-warn">not sent. {s.error ?? 'No reason was given.'}</span>}</li>)}
          </ul>
          <p className="mt-1 text-muted">Replies appear under Ask suppliers.</p>
        </div>
      )}
    </li>
  )
}

// ---------- Whole photo + products ----------
function DetailView({ id, showPrice, suppliers, supErr, onList }: { id: string; showPrice: boolean; suppliers: Supplier[]; supErr?: { error?: string; reload: () => void }; onList: () => void }) {
  const s = useFetch<Detail>(`/listings/${id}`)
  const cats = useFetch<string[]>('/listings/categories')
  const jump = (itemId: string) => { const el = document.getElementById(`it-${itemId}`); el?.scrollIntoView({ block: 'center' }); el?.focus() }
  const d = s.data
  return (
    <section aria-labelledby="cat-d" className="mt-8 border-t border-hairline pt-6">
      <h2 id="cat-d" className="mb-1 text-md font-semibold">Photo from {d ? when(d.created_at) : '...'}</h2>
      <p className="mb-3"><a className="link inline-flex min-h-11 items-center" href="#/catalog">Close this photo</a></p>
      <Async s={s} rows={4} shape="detail" empty={d && !d.items.length} emptyText="No products were found in this photo." emptyHint="Try a sharper photo with the labels facing the camera.">
        {d && (
          <>
            <p className="mb-2 text-sm text-muted">{d.party_name ? `Supplier: ${d.party_name}. ` : ''}{d.note ? `Note: ${d.note}. ` : ''}Numbered outlines mark each product; select one to jump to its card.</p>
            <div className="relative mb-4 w-fit max-w-full">
              <Pic url={d.image_url} alt="The whole catalog photo" className="block h-auto max-w-full rounded-ui border border-soft" />
              {d.items.map((it, i) => {
                const [x0, y0, x1, y1] = it.bbox
                return (
                  <button key={it.id} type="button" aria-label={`Product ${i + 1}: ${it.description}, ${BADGE[it.status]}`} onClick={() => jump(it.id)}
                    style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }}
                    className={`absolute border-2 bg-transparent p-0 text-left ${it.status === 'discarded' ? 'border-dashed' : ''} border-accent hover:bg-tint/30`}>
                    <span aria-hidden="true" className="absolute left-0 top-0 min-w-5 bg-accent px-1 text-xs font-bold text-on-accent">{i + 1}</span>
                  </button>
                )
              })}
            </div>
            <ul className="grid gap-4">
              {d.items.map((it, i) => <ItemCard key={it.id} lid={id} n={i + 1} it={it} cats={cats.data ?? []} showPrice={showPrice} suppliers={suppliers} supErr={supErr} onChanged={() => { s.reload(); cats.reload(); onList() }} />)}
            </ul>
          </>
        )}
      </Async>
    </section>
  )
}

// Recent photos as a grid of the photos themselves: the card is one link, so the date is its name.
function Gallery({ rows, current }: { rows: ListingRow[]; current?: string }) {
  return (
    <ul aria-label="Recent catalog photos, newest first" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {rows.map(l => (
        <li key={l.id}>
          <a href={`#/catalog/${l.id}`} aria-current={l.id === current ? 'page' : undefined}
            className={`block overflow-hidden rounded-ui border bg-surface hover:border-accent ${l.id === current ? 'border-accent ring-2 ring-accent' : 'border-hairline'}`}>
            <div className="flex aspect-4/3 items-center justify-center bg-tint">
              <Pic url={l.thumb_url ?? l.image_url} alt={`Catalog photo from ${when(l.created_at)}`} className="size-full object-cover" />
            </div>
            <div className="grid gap-1 p-2 text-sm">
              <time dateTime={l.created_at} className="font-semibold">{when(l.created_at)}</time>
              <span className="truncate text-muted">{l.party_name ?? 'No supplier'}</span>
              <span className="flex flex-wrap items-center gap-2"><span className="tabular-nums">{l.items} {l.items === 1 ? 'product' : 'products'}</span><Chip v={l.to_review ? 'needs_review' : 'confirmed'} /></span>
            </div>
          </a>
        </li>
      ))}
    </ul>
  )
}

export function CatalogView({ me, owner, id }: { me?: Me; owner: boolean; id?: string }) {
  const list = useFetch<ListingRow[]>('/listings')
  const sup = useFetch<Supplier[]>('/contacts?role=supplier')
  const [up, setUp] = useState<boolean>()
  const upOpen = up ?? (list.loading && !list.data ? false : !list.data?.length)  // open until the first photo exists
  return (
    <>
      <PageHeader title="Catalog photos" description="Photograph shelves of labelled products, then check what LARIS read."
        actions={<button type="button" className={`btn ${upOpen ? '' : 'btn-primary'}`} aria-expanded={upOpen} aria-controls="cat-up" onClick={() => setUp(!upOpen)}>Upload photo</button>} />
      {upOpen && <UploadCard owner={owner} suppliers={sup.data ?? []} onDone={lid => { list.reload(); location.hash = `#/catalog/${lid}` }} />}
      <section aria-labelledby="cat-list" className="mt-8">
        <h2 id="cat-list" className="mb-3 text-md font-semibold">Recent photos</h2>
        <Async s={list} rows={5} shape="table" empty={!list.data?.length} emptyText="No catalog photos yet." emptyHint="Photograph a page or shelf of labelled products and LARIS lists each one for you to check."
          emptyAction={{ label: 'Read your first catalog photo', onClick: () => { setUp(true); requestAnimationFrame(() => { const f = document.getElementById('cat-file'); f?.scrollIntoView({ block: 'center' }); f?.focus() }) } }}>
          <Gallery rows={list.data ?? []} current={id} />
        </Async>
      </section>
      {id && <DetailView key={id} id={id} showPrice={canSeePrice(me, owner)} suppliers={sup.data ?? []} supErr={sup} onList={list.reload} />}
    </>
  )
}

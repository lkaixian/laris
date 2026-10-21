import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, resolveMe, getRole, setRole, ApiError, MOCK, NEXT } from './api'
import type { Role, Me, Tracker, DocDetail, DocSummary, Line, Alert, Field, Proposal, AuditEvent } from './api'

// ---------- helpers ----------
const rm = (s: string | null) => (s === null ? 'Not set' : 'RM ' + Number(s).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const label = (s: string) => s.replace(/_/g, ' ')
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')
const REVIEWABLE = ['received', 'parsed'] // 'in' statuses where the API still allows line edits (src/api/routes.py)
// Stable focus target after an action or a route change: the page h1, else the main landmark.
const focusTop = () => (document.querySelector<HTMLElement>('main h1') ?? document.getElementById('main'))?.focus()

function useFetch<T>(path: string) {
  const [s, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true })
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    set(p => ({ ...p, loading: true, error: undefined }))
    api<T>('GET', path).then(data => live && set({ data, loading: false }), e => live && set({ loading: false, error: msg(e) }))
    return () => { live = false }
  }, [path, n])
  return { ...s, reload: () => setN(x => x + 1) }
}

// One in-flight action with a shared error shape. Retry is offered when the failure is the AI service or the network.
function useAction() {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<{ text: string; retry: boolean }>()
  const run = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setErr(undefined)
    try { await fn() } catch (e) {
      const ai = e instanceof ApiError && e.code === 'ilmu_unavailable'
      setErr({ text: ai ? 'The AI reading service is unavailable (ilmu_unavailable). Nothing was saved.' : msg(e), retry: ai || (e instanceof ApiError && e.code === 'network') })
    } finally { setBusy(false) }
  }
  return { busy, err, run }
}

function ActionError({ err, onRetry, label }: { err?: { text: string; retry: boolean }; onRetry: () => void; label: string }) {
  if (!err) return null
  return (
    <div role="alert" className="card mt-3 border-warn bg-warn-bg text-warn">
      <p>{err.text}</p>
      {err.retry && <button type="button" className="btn mt-3" onClick={onRetry}>{label}</button>}
    </div>
  )
}

function Async({ s, empty, emptyText, children }: { s: { loading: boolean; error?: string; data?: unknown; reload: () => void }; empty?: boolean; emptyText?: string; children: ReactNode }) {
  if (s.error) return (
    <div role="alert" className="card border-warn bg-warn-bg text-warn">
      <p>{s.error}</p>
      <button className="btn mt-3" onClick={s.reload}>Retry loading</button>
    </div>
  )
  if (s.loading && !s.data) return <p role="status" className="text-muted">Loading...</p>
  if (empty) return <p className="card text-muted">{emptyText}</p>
  return <>{children}</>
}

function ThemeToggle({ dark, setDark }: { dark: boolean; setDark: (d: boolean) => void }) {
  const flip = () => {
    const t = dark ? 'light' : 'dark'
    document.documentElement.dataset.theme = t
    try { localStorage.setItem('theme', t) } catch { /* storage blocked: choice lasts for this visit only */ }
    setDark(!dark)
  }
  return <button className="btn" aria-pressed={dark} onClick={flip}>Dark theme</button>
}

// LARIS logo: laris-logo.png (light) or laris-logo-dark.png (dark); falls back to the text wordmark when no file is there.
function Brand({ dark }: { dark: boolean }) {
  const [failed, setFailed] = useState(false)
  return !failed
    ? <img src={`/brand/laris-logo${dark ? '-dark' : ''}.png`} alt="LARIS" width={131} height={28} className="h-7 w-auto" onError={() => setFailed(true)} />
    : <strong className="text-xl font-semibold tracking-[0.2em]">LARIS</strong>
}

function OrgMark({ org }: { org: Me['org'] }) {
  const [broken, setBroken] = useState(false)
  const initials = org.name.replace(/^SAMPLE\s+/i, '').split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
  if (org.logo_url && !broken) return <img src={org.logo_url} alt={org.name} className="h-8 max-w-40 object-contain" onError={() => setBroken(true)} />
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-ui bg-tint text-sm font-semibold text-accent">{initials}</span>
      <span className="truncate text-sm font-semibold">{org.name}</span>
    </span>
  )
}

function Status({ v }: { v: string }) { return <span className="badge">{label(v)}</span> }

// ---------- Tracker ----------
function DocCard({ d, owner }: { d: DocSummary; owner: boolean }) {
  return (
    <li>
      <a className="row" href={`#/doc/${d.id}`}>
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-semibold text-accent underline underline-offset-2">{d.doc_no ?? 'No document number'}</span>
          <span className="text-sm tabular-nums">{d.total ? rm(d.total) : ''}</span>
        </span>
        <span className="block text-sm">{d.party.name}</span>
        <span className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Status v={d.status} />
          {d.flags.needs_review && <span className="badge badge-warn">Needs review</span>}
          {owner && d.flags.cost_is_stale && <span className="badge badge-warn">Cost is stale</span>}
          {d.valid_until && <span className="text-muted">Valid until {d.valid_until}</span>}
        </span>
      </a>
    </li>
  )
}

function UploadQuote({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('')
  const [supplier, setSupplier] = useState('')
  const [formErr, setFormErr] = useState('')
  const [res, setRes] = useState<{ doc: DocSummary; review: Line[] }>()
  const file = useRef<HTMLInputElement>(null)
  const out = useRef<HTMLDivElement>(null)
  const a = useAction()
  useEffect(() => { if (res) out.current?.focus() }, [res])
  const submit = () => {
    const f = file.current?.files?.[0]
    if (!f && !text.trim()) return setFormErr('Choose a file or paste the quote text.')
    if (f && text.trim()) return setFormErr('Use either a file or pasted text, not both.')
    setFormErr('')
    const fd = new FormData()
    if (f) fd.append('file', f); else fd.append('text', text.trim())
    if (supplier.trim()) fd.append('supplier', supplier.trim())
    a.run(async () => {
      const doc = await api<DocSummary>('POST', '/documents/ingest', fd)
      const d = await api<DocDetail>('GET', `/documents/${doc.id}`)
      setRes({ doc, review: d.lines.filter(l => l.needs_review) })
      setText(''); if (file.current) file.current.value = ''
      onDone()
    })
  }
  return (
    <details className="card mt-3">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-accent">Upload supplier quote</summary>
      <form className="mt-2 grid gap-3" onSubmit={e => { e.preventDefault(); submit() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">Quote file (PDF, photo or text)
          <input ref={file} type="file" accept=".pdf,.txt,image/*" className="input py-2 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Or paste the quote text
          <textarea className="input min-h-24 py-2 font-normal" value={text} onChange={e => setText(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Supplier name (optional)
          <input className="input font-normal" value={supplier} onChange={e => setSupplier(e.target.value)} />
        </label>
        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        <div><button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? 'Reading the quote...' : 'Read quote and add to tracker'}</button></div>
      </form>
      <ActionError err={a.err} onRetry={submit} label="Retry reading the quote" />
      {res && (
        <div ref={out} tabIndex={-1} className="card mt-3" aria-labelledby="up-res">
          <h3 id="up-res" className="font-semibold">Added {res.doc.doc_no ?? 'supplier quote'} from {res.doc.party.name}</h3>
          <p className="text-sm">Status: {label(res.doc.status)}. <a className="link" href={`#/doc/${res.doc.id}`}>Open the supplier quote</a></p>
          {res.review.length > 0
            ? <><p className="mt-2 text-sm font-semibold">{res.review.length} {res.review.length === 1 ? 'line needs' : 'lines need'} review</p>
                <ul className="list-disc pl-5 text-sm">{res.review.map(l => <li key={l.id}>Line {l.line_no}: {l.description}</li>)}</ul></>
            : <p className="mt-2 text-sm text-muted">No lines need review.</p>}
        </div>
      )}
    </details>
  )
}

const CHANNELS = [['telegram', 'Telegram'], ['whatsapp', 'WhatsApp'], ['web', 'Web'], ['upload', 'Upload']]
function SimulateEnquiry() {
  const [channel, setChannel] = useState('telegram')
  const [text, setText] = useState('')
  const [formErr, setFormErr] = useState('')
  const a = useAction()
  const submit = () => {
    if (!text.trim()) return setFormErr('Type the customer enquiry first.')
    setFormErr('')
    a.run(async () => {
      const doc = await api<DocSummary>('POST', '/enquiries/simulate', { channel, text: text.trim() })
      location.hash = `#/doc/${doc.id}`
    })
  }
  return (
    <details className="card mt-3">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-accent">Simulate customer enquiry</summary>
      <form className="mt-2 grid gap-3" onSubmit={e => { e.preventDefault(); submit() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">Channel it arrived on
          <select className="input w-fit font-normal" value={channel} onChange={e => setChannel(e.target.value)}>
            {CHANNELS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Enquiry text
          <textarea className="input min-h-24 py-2 font-normal" maxLength={4000} value={text} onChange={e => setText(e.target.value)} />
        </label>
        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        <div><button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? 'Pricing the enquiry...' : 'Create draft quote from enquiry'}</button></div>
      </form>
      <ActionError err={a.err} onRetry={submit} label="Retry pricing the enquiry" />
    </details>
  )
}

function TrackerView({ owner }: { owner: boolean }) {
  const s = useFetch<Tracker>('/tracker')
  const [filter, setFilter] = useState('')
  const all = [...(s.data?.received ?? []), ...(s.data?.sent ?? [])]
  const statuses = [...new Set(all.map(d => d.status))].sort()
  const pick = (l: DocSummary[]) => l.filter(d => !filter || d.status === filter)
  const shown = pick(all).length
  const lane = (title: string, hint: string, l: DocSummary[], extra: ReactNode) => (
    <section aria-labelledby={title} className="min-w-0">
      <h2 id={title} className="border-b-2 border-accent pb-1 text-lg font-semibold">{title} <span className="text-sm font-normal text-muted">({l.length}) {hint}</span></h2>
      {extra}
      {l.length ? <ul className="mt-3 divide-y divide-soft border-b border-soft bg-surface">{l.map(d => <DocCard key={d.id} d={d} owner={owner} />)}</ul> : <p className="py-3 text-muted">{filter ? `No documents with status ${label(filter)}.` : 'No documents yet.'}</p>}
    </section>
  )
  return (
    <>
      <h1 tabIndex={-1} className="mb-3 text-2xl font-semibold">Quote tracker</h1>
      <label className="mb-4 flex flex-wrap items-center gap-2 text-sm font-semibold">
        Filter by status
        <select className="input" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="">All statuses</option>
          {statuses.map(x => <option key={x} value={x}>{label(x)}</option>)}
        </select>
      </label>
      <p role="status" className="sr-only">{s.data ? `Showing ${shown} ${shown === 1 ? 'document' : 'documents'}` : ''}</p>
      <Async s={s}>
        <div className="grid gap-8 md:grid-cols-2">
          {lane('Received', 'Supplier quotes', pick(s.data?.received ?? []), <UploadQuote onDone={s.reload} />)}
          {lane('Sent', 'Customer quotes', pick(s.data?.sent ?? []), <SimulateEnquiry />)}
        </div>
      </Async>
    </>
  )
}

// ---------- Document detail ----------
function cell(f: Field, v: unknown): ReactNode {
  if (v === undefined || v === null || v === '') return <span className="text-muted">Not set</span>
  if (f.type === 'boolean') return v ? 'Yes' : 'No'
  return `${String(v)}${f.unit ? ' ' + f.unit : ''}`
}

function LineRow({ docId, l, cols, edit, showPrice, onSaved }: { docId: string; l: Line; cols: Field[]; edit: boolean; showPrice: boolean; onSaved: (n: number) => void }) {
  const [key, setKey] = useState(l.item_key ?? '')
  const [qty, setQty] = useState(l.qty ? String(Number(l.qty)) : '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const errId = `line-err-${l.id}`
  const bad = err ? { 'aria-invalid': true, 'aria-describedby': errId } : {}
  const save = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try {
      await api('POST', `/documents/${docId}/lines/${l.id}`, { item_key: key.trim() || undefined, qty: qty === '' ? undefined : qty })
      onSaved(l.line_no)
    } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  if (l.is_header) return <tr><th colSpan={6 + cols.length} scope="colgroup" className="bg-soft text-ink">{l.description}</th></tr>
  const unmapped = Object.entries(l.attrs_unmapped)
  return (
    <tr>
      <td>{l.line_no}</td>
      <td>
        {l.description}
        {l.needs_review && <span className="badge badge-warn ml-2">Needs review{l.ocr_confidence !== null ? `, OCR ${Math.round(Number(l.ocr_confidence) * 100)}%` : ''}</span>}
        {unmapped.length > 0 && <p className="text-xs text-muted">Unmapped field: {unmapped.map(([k, v]) => `${k} = ${String(v)}`).join(', ')}</p>}
        {err && <p id={errId} role="alert" className="text-xs text-warn">{err}</p>}
      </td>
      <td>
        {edit ? <input className="input w-36" aria-label={`Item key for line ${l.line_no}`} value={key} onChange={e => setKey(e.target.value)} {...bad} /> : l.item_key ?? <span className="text-muted">Not set</span>}
      </td>
      <td>
        {edit ? <input className="input w-24" type="number" min="0" step="any" inputMode="decimal" aria-label={`Quantity for line ${l.line_no}`} value={qty} onChange={e => setQty(e.target.value)} {...bad} /> : l.qty ? Number(l.qty) : <span className="text-muted">Not set</span>}
      </td>
      <td>{l.uom}</td>
      <td>{showPrice ? rm(l.unit_price) : <span className="text-muted">Hidden for staff</span>}</td>
      {cols.map(f => <td key={f.key}>{cell(f, l.attrs[f.key])}</td>)}
      {edit && <td><button className="btn" aria-disabled={busy || undefined} onClick={save}>{busy ? 'Saving...' : `Save line ${l.line_no}`}</button></td>}
    </tr>
  )
}

function DetailView({ id, owner }: { id: string; owner: boolean }) {
  const s = useFetch<DocDetail>(`/documents/${id}`)
  const f = useFetch<Field[]>('/fields')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const d = s.data
  const cols = (f.data ?? []).filter(x => x.show_in_grid).sort((a, b) => a.sort_order - b.sort_order)
  const actions = d ? NEXT[d.doc.direction][d.doc.status] ?? [] : []
  const edit = !!d && d.doc.direction === 'in' && REVIEWABLE.includes(d.doc.status)
  const docNo = d?.doc.id === id ? d.doc.doc_no ?? 'Document' : undefined
  useEffect(() => { document.title = `${docNo ?? 'Loading document'} · LARIS` }, [docNo])
  // Arrived by navigation (focus is parked on main): move it to the heading once the document is there.
  useEffect(() => { if (docNo && document.activeElement === document.getElementById('main')) focusTop() }, [docNo])
  const move = async (to: string) => {
    if (busy) return
    setBusy(true); setErr(''); setNote('')
    try {
      await api('POST', `/documents/${id}/transition`, { to, reason: reason.trim() || undefined })
      setReason(''); setNote(`${docNo} moved to ${label(to)}.`); s.reload(); focusTop()
    } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  const lineOf = (lineId?: string) => d?.lines.find(l => l.id === lineId)
  return (
    <>
      <p className="mb-2"><a className="link inline-flex min-h-11 items-center" href="#/tracker">Back to tracker</a></p>
      <Async s={s} empty={false}>
        {d && (
          <>
            <h1 tabIndex={-1} className="text-2xl font-semibold">{d.doc.doc_no ?? 'No document number'}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span>{d.doc.direction === 'in' ? 'Supplier quote from' : 'Customer quote for'} {d.doc.party.name}</span>
              <Status v={d.doc.status} />
              {owner && d.doc.flags.cost_is_stale && <span className="badge badge-warn">Cost is stale</span>}
              <span className="text-muted">Total {rm(d.doc.total)}</span>
            </p>

            <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
            <div className="min-w-0 lg:order-1">
            <h2 className="mb-1 text-lg font-semibold">Lines</h2>
            {edit && <p className="mb-2 text-sm text-muted">Review step: set the item key and quantity for each line, then save the line. Lines marked Needs review are unclear on the source document.</p>}
            {f.error && <p role="alert" className="mb-2 text-sm text-warn">Could not load extra columns: {f.error}</p>}
            {d.lines.length === 0 ? <p className="card text-muted">This document has no lines.</p> : (
              <div className="max-w-full overflow-x-auto rounded-ui border border-soft bg-surface" role="region" aria-label="Lines" tabIndex={0}>
                <table className="w-full min-w-max">
                  <caption className="sr-only">Lines of {d.doc.doc_no ?? 'this document'}</caption>
                  <thead><tr>
                    <th scope="col">No.</th><th scope="col">Description</th><th scope="col">Item key</th><th scope="col">Qty</th><th scope="col">Unit</th>
                    <th scope="col">{d.doc.direction === 'in' ? 'Unit cost' : 'Unit price'}</th>
                    {cols.map(c => <th key={c.key} scope="col">{c.label}</th>)}
                    {edit && <th scope="col">Action</th>}
                  </tr></thead>
                  <tbody>{d.lines.map(l => <LineRow key={l.id} docId={id} l={l} cols={cols} edit={edit} showPrice={owner || d.doc.direction === 'out' || REVIEWABLE.includes(d.doc.status)} onSaved={n => { setNote(`Line ${n} saved.`); s.reload() }} />)}</tbody>
                </table>
              </div>
            )}
            </div>

            <aside className="grid gap-6 lg:order-2">
            <section className="card border-l-4 border-l-accent" aria-labelledby="actions">
              <h2 id="actions" className="font-semibold">Decision</h2>
              <p role="status" className="text-sm">{note}</p>
              {!actions.length && <p className="text-sm text-muted">This document is {label(d.doc.status)}. No further actions.</p>}
              {actions.length > 0 && !owner && !actions.some(a => !a.owner) && <p className="text-sm text-muted">Only the owner can decide on this quote. Switch the simulated role to owner to try it.</p>}
              {actions.some(a => !a.owner || owner) && (
                <>
                  {owner && <label className="mt-2 flex flex-col gap-1 text-sm font-semibold">Reason (optional, saved to the activity log)
                    <input className="input max-w-md font-normal" value={reason} onChange={e => setReason(e.target.value)} />
                  </label>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {actions.filter(a => !a.owner || owner).map(a => (
                      <button key={a.to} aria-disabled={busy || undefined} onClick={() => move(a.to)} className={`btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`}>{a.label}</button>
                    ))}
                  </div>
                </>
              )}
              {err && <p role="alert" className="mt-2 text-sm text-warn">{err}</p>}
            </section>

            {owner && d.provenance && (
              <section aria-labelledby="prov">
                <h2 id="prov" className="text-lg font-semibold">Cost provenance <span className="text-sm font-normal text-muted">(owner only)</span></h2>
                {d.provenance.length === 0 ? <p className="card mt-2 text-muted">No supplier cost is linked to this document.</p> : (
                  <ul className="mt-2 grid gap-2">
                    {d.provenance.map(p => {
                      const ln = lineOf(p.line_id)
                      const perUnit = Number(p.cost_snapshot) - Number(p.current_unit_cost)
                      // margin impact = cost change x qty of the cost item per unit sold x units sold
                      const total = ln?.qty ? perUnit * Number(p.qty_consumed ?? 1) * Number(ln.qty) : null
                      return (
                        <li key={p.cost_item_id + p.line_id} className="card">
                          <p className="font-semibold">{ln ? `Line ${ln.line_no}: ${ln.description}` : `Cost item ${p.cost_item_id}`}</p>
                          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
                            <dt className="text-muted">Supplier</dt><dd>{p.supplier}</dd>
                            <dt className="text-muted">Source document</dt><dd><a className="link" href={`#/doc/${p.source_doc_id}`}>{p.source_doc_no}</a></dd>
                            <dt className="text-muted">Cost date</dt><dd>{p.cost_date}</dd>
                            <dt className="text-muted">Cost used in quote</dt><dd>{rm(p.cost_snapshot)}</dd>
                            <dt className="text-muted">Current cost</dt><dd>{rm(p.current_unit_cost)}</dd>
                            <dt className="text-muted">Line margin</dt><dd>{rm(p.line_margin)}</dd>
                          </dl>
                          {p.cost_is_stale && (
                            <p className="badge badge-warn mt-2">Cost is stale: margin down {rm(String(Math.abs(total ?? perUnit)))}{total === null ? ' per unit' : ''}</p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )}
            {!owner && <p className="text-sm text-muted">Cost and margin are visible to the owner role only.</p>}
            </aside>
            </div>
          </>
        )}
      </Async>
    </>
  )
}

// ---------- Stale-cost alerts + field proposals ----------
function Proposals() {
  const s = useFetch<Proposal[]>('/field-proposals')
  const [err, setErr] = useState('')
  const [type, setType] = useState<Record<string, string>>({})
  const decide = async (p: Proposal, decision: 'approve' | 'ignore') => {
    setErr('')
    try { await api('POST', `/field-proposals/${p.id}/decide`, { decision, type: type[p.id] ?? 'text', label: p.key.replace(/_/g, ' ') }); s.reload(); focusTop() }
    catch (e) { setErr(msg(e)) }
  }
  return (
    <section className="mt-10 border-t border-soft pt-6" aria-labelledby="newf">
      <h2 id="newf" className="text-base font-semibold">New fields seen on documents</h2>
      <p className="mb-2 text-sm text-muted">A field the extractor found that is not a column yet. Nothing becomes a column until you approve it.</p>
      {err && <p role="alert" className="mb-2 text-sm text-warn">{err}</p>}
      <Async s={s} empty={!s.data?.length} emptyText="No unknown fields waiting for a decision.">
        <ul className="grid gap-2 md:grid-cols-2">
          {s.data?.map(p => (
            <li key={p.id} className="card">
              <p className="font-semibold">{p.key}</p>
              <p className="text-sm text-muted">Sample values: {p.sample_values.map(String).join(', ')}</p>
              <label className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold">Column type
                <select className="input" value={type[p.id] ?? 'text'} onChange={e => setType({ ...type, [p.id]: e.target.value })}>
                  {['text', 'number', 'integer', 'date', 'select', 'boolean'].map(t => <option key={t}>{t}</option>)}
                </select>
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn btn-primary" onClick={() => decide(p, 'approve')}>Add {p.key} as column</button>
                <button className="btn" onClick={() => decide(p, 'ignore')}>Ignore {p.key}</button>
              </div>
            </li>
          ))}
        </ul>
      </Async>
    </section>
  )
}

function AlertsView({ owner }: { owner: boolean }) {
  const s = useFetch<Alert[]>('/alerts/stale-costs')
  if (!owner) return <><h1 tabIndex={-1} className="text-2xl font-semibold">Stale-cost alerts</h1><p className="card mt-3 text-muted">Owner only. Staff do not see supplier cost or margin. Switch the simulated role to owner to view alerts.</p></>
  const n = s.data?.length ?? 0
  const lost = (s.data ?? []).reduce((a, x) => a + Number(x.margin_delta), 0)
  return (
    <>
      <h1 tabIndex={-1} className="text-2xl font-semibold">Stale-cost alerts</h1>
      <p className="mb-6 text-muted">Quotes still open whose supplier cost has risen since pricing. Nothing is re-priced automatically.</p>
      <p role="status" className={s.data && n ? 'mb-4 border-l-4 border-amber pl-3 text-xl font-semibold' : 'sr-only'}>{s.data && n ? `${n} open ${n === 1 ? 'quote' : 'quotes'} affected, margin down ${rm(String(Math.abs(lost)))} in total` : ''}</p>
      <Async s={s} empty={!n} emptyText="No open quote is affected by a newer supplier cost.">
        <ul className="grid gap-2">
          {s.data?.map(a => (
            <li key={a.quote_id + a.item_key} className="card flex flex-wrap items-center gap-x-6 gap-y-2 border-l-4 border-l-amber">
              <div className="min-w-0 flex-1 basis-64">
              <p className="font-semibold"><a className="link" href={`#/doc/${a.quote_id}`}>{a.quote_no}</a> <span className="font-normal">for {a.customer}</span></p>
              <p className="mt-1 text-sm">{a.item_key}: cost {rm(a.old_cost)} to {rm(a.current_cost)}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2"><span className="badge badge-warn">Margin down {rm(String(Math.abs(Number(a.margin_delta))))}</span><Status v={a.status} /></p>
              </div>
              <a className="btn btn-primary" href={`#/doc/${a.quote_id}`}>Review {a.quote_no}</a>
            </li>
          ))}
        </ul>
      </Async>
      <Proposals />
    </>
  )
}

// ---------- Activity ----------
function ActivityView() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [checked, setChecked] = useState('')
  const [announce, setAnnounce] = useState('')
  const cursor = useRef(0)
  const first = useRef(true)
  const poll = async () => {
    try {
      const rows = await api<AuditEvent[]>('GET', `/audit?after=${cursor.current}`)
      if (rows.length) {
        cursor.current = Math.max(...rows.map(r => r.id)); setEvents(e => [...rows.reverse(), ...e])
        if (!first.current) setAnnounce(`${rows.length} new ${rows.length === 1 ? 'event' : 'events'}`)
      }
      setError(''); setChecked(new Date().toLocaleTimeString())
    } catch (e) { setError(msg(e)) } finally { setLoading(false); first.current = false }
  }
  useEffect(() => { poll(); const t = setInterval(poll, 4000); return () => clearInterval(t) }, [])
  return (
    <>
      <h1 tabIndex={-1} className="text-2xl font-semibold">Activity log</h1>
      <p className="mb-3 text-sm text-muted">Checks for new events every 4 seconds.{checked && ` Last checked ${checked}.`}</p>
      <p role="status" className="sr-only">{announce}</p>
      {error && <div role="alert" className="card mb-3 border-warn bg-warn-bg text-warn"><p>{error}</p><button className="btn mt-3" onClick={poll}>Retry loading</button></div>}
      {loading ? <p role="status" className="text-muted">Loading...</p> : events.length === 0 && !error ? <p className="card text-muted">No activity yet.</p> : (
        <ol className="grid gap-2">
          {events.map(e => (
            <li key={e.id} className="card text-sm">
              <p className="font-semibold">{e.event}</p>
              <p className="text-muted"><time dateTime={e.at}>{new Date(e.at).toLocaleString()}</time>, by {e.actor}</p>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

// ---------- Shell ----------
const TITLES: Record<string, string> = { alerts: 'Stale-cost alerts', tracker: 'Quote tracker', activity: 'Activity log' }

export default function App() {
  const [hash, setHash] = useState(location.hash)
  const [role, setRoleState] = useState<Role>(getRole())
  const [roleNote, setRoleNote] = useState('')
  useEffect(() => { const h = () => setHash(location.hash); addEventListener('hashchange', h); return () => removeEventListener('hashchange', h) }, [])
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark')
  // The user id comes from GET /api/me (X-Role only). Re-resolved whenever the simulated role changes; nothing renders before it.
  const [me, setMe] = useState<Me>()
  const [meErr, setMeErr] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    setMe(undefined); setMeErr('')
    resolveMe(role).then(m => live && setMe(m), e => live && setMeErr(msg(e)))
    return () => { live = false }
  }, [role, tries])
  const owner = role === 'owner'
  const [, page, arg] = hash.split('/')
  const route = page || (owner ? 'alerts' : 'tracker')
  useEffect(() => { if (route !== 'doc') document.title = `${TITLES[route] ?? 'Page not found'} · LARIS` }, [route])
  const firstNav = useRef(true)
  useEffect(() => { if (firstNav.current) { firstNav.current = false; return } focusTop() }, [hash])
  const nav = [...(owner ? [['alerts', 'Stale costs']] : []), ['tracker', 'Tracker'], ['activity', 'Activity']]
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:bg-surface focus:p-3" onClick={e => { e.preventDefault(); document.getElementById('main')?.focus() }}>Skip to content</a>
      <header className="border-b border-soft bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
          <div className="flex min-w-0 flex-1 basis-60 items-center gap-3">
            <span className="shrink-0"><Brand dark={dark} /></span>
            {me && <><span aria-hidden="true" className="h-8 w-px shrink-0 bg-line" /><OrgMark org={me.org} /></>}
          </div>
          <ThemeToggle dark={dark} setDark={setDark} />
          <label className="flex items-center gap-2 text-sm font-semibold">
            Role (simulated)
            <select className="input" value={role} onChange={e => { const r = e.target.value as Role; setRole(r); setRoleState(r); setRoleNote(`Viewing as ${r === 'owner' ? 'Owner' : 'Staff'}`) }}>
              <option value="owner">Owner</option><option value="staff">Staff</option>
            </select>
          </label>
        </div>
        <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-wrap px-1">
          {nav.map(([k, t]) => <a key={k} className="navlink" href={`#/${k}`} aria-current={route === k || (route === 'doc' && k === 'tracker') ? 'page' : undefined}>{t}</a>)}
        </nav>
      </header>
      <p role="status" className="sr-only">{roleNote}</p>
      {MOCK && <p className="bg-warn-bg px-4 py-2 text-center text-sm text-warn">SAMPLE data. Mock mode is on: nothing here is real and nothing is saved to a server.</p>}
      <main id="main" tabIndex={-1} key={role} className="mx-auto max-w-6xl px-4 py-5">
        {meErr ? (
          <div role="alert" className="card border-warn bg-warn-bg text-warn">
            <p>Could not identify the signed-in user: {meErr}</p>
            <button className="btn mt-3" onClick={() => setTries(t => t + 1)}>Retry identifying user</button>
          </div>
        ) : !me ? <p role="status" className="text-muted">Loading...</p> : <>
          {route === 'alerts' && <AlertsView owner={owner} />}
          {route === 'tracker' && <TrackerView owner={owner} />}
          {route === 'activity' && <ActivityView />}
          {route === 'doc' && arg && <DetailView id={arg} owner={owner} />}
          {!['alerts', 'tracker', 'activity', 'doc'].includes(route) && <p className="card">Page not found. <a className="link" href="#/tracker">Open the tracker</a></p>}
        </>}
      </main>
    </>
  )
}

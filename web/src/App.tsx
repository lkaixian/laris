import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, download, resolveMe, getRole, setRole, MOCK, NEXT, authConfig, getToken, logout } from './api'
import Login from './Login'
import { AccountView, TeamView } from './Team'
import { ContactDetail, ContactsView } from './Contacts'
import { SearchView } from './Search'
import { AssistantView } from './Assistant'
import { HomeView } from './Home'
import { AskView } from './Ask'
import { rm, label, msg, REVIEWABLE, focusTop, useFetch, useAction, ActionError, Async, ThemeToggle, Brand, OrgMark, Status } from './ui'
import type { Role, Me, Tracker, DocDetail, DocSummary, Line, Alert, Field, Followup, Job, MarginReport, Settings, Proposal, AuditEvent } from './api'


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
          {lane('Received', 'Supplier quotes', pick(s.data?.received ?? []), <><UploadQuote onDone={s.reload} />{!MOCK && <ManualQuote onDone={s.reload} />}</>)}
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
      const r = await api<{ delivery?: string }>('POST', `/documents/${id}/transition`, { to, reason: reason.trim() || undefined })
      setReason(''); setNote(`${docNo} moved to ${label(to)}.`); s.reload(); focusTop()
      if (r.delivery === 'failed') setErr('Marked as sent, but the message to the customer did not go through. Send the quote PDF by hand.')
      else if (r.delivery === 'not_sent') setNote(`${docNo} moved to ${label(to)}. No chat contact on file, so nothing was sent.`)
    } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  const save = async (path: string, name: string) => {
    setErr(''); setNote('')
    try { await download(path, name); setNote(`${name} downloaded.`) } catch (e) { setErr(msg(e)) }
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
            {d.doc.direction === 'out' && !MOCK && (
              <p className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="btn" onClick={() => save(`/documents/${id}/pdf`, `${d.doc.doc_no}.pdf`)}>Download quote PDF</button>
                {owner && ['accepted', 'sent', 'read', 'job_created'].includes(d.doc.status) && <>
                  <button type="button" className="btn" onClick={() => save(`/export/bom.xlsx?quote_id=${id}`, `bom-${d.doc.doc_no}.xlsx`)}>Download BOM (xlsx)</button>
                  <button type="button" className="btn" onClick={() => save(`/export/po.csv?quote_id=${id}`, `po-${d.doc.doc_no}.csv`)}>Download purchase list (csv)</button>
                </>}
              </p>
            )}

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
function Report() {
  const s = useFetch<MarginReport>('/reports/margin?days=7')
  const r = s.data
  return (
    <section className="mb-8" aria-labelledby="wk">
      <h2 id="wk" className="mb-2 text-base font-semibold">Last 7 days</h2>
      <Async s={s} empty={!r || r.quotes === 0} emptyText="No quotes were created in the last 7 days.">
        {r && <>
          <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {([['Quotes', String(r.quotes)], ['Quoted', rm(r.revenue)], ['Margin', `${rm(r.margin)}${r.margin_pct !== null ? ` (${r.margin_pct}%)` : ''}`],
               ['Won / lost', `${r.won} / ${r.lost}`]] as const).map(([k, v]) => (
              <div key={k} className="card"><dt className="text-sm text-muted">{k}</dt><dd className="text-lg font-semibold">{v}</dd></div>
            ))}
          </dl>
          {r.lowest_margin.length > 0 && <p className="mt-2 text-sm">Thinnest margin: {r.lowest_margin.map((q, i) => (
            <span key={q.quote_id}>{i > 0 && ', '}<a className="link" href={`#/doc/${q.quote_id}`}>{q.quote_no}</a> ({q.margin_pct ?? 'n/a'}%)</span>))}</p>}
        </>}
      </Async>
    </section>
  )
}

const JOB_COLS: [Job['status'], string][] = [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']]

function JobsView() {
  const s = useFetch<Job[]>('/jobs')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const move = async (j: Job, status: Job['status']) => {
    setErr(''); setNote('')
    try { await api('POST', `/jobs/${j.id}`, { status }); setNote(`${j.quote_no} moved to ${JOB_COLS.find(c => c[0] === status)![1]}.`); s.reload() }
    catch (e) { setErr(msg(e)) }
  }
  return (
    <>
      <h1 tabIndex={-1} className="text-2xl font-semibold">Jobs</h1>
      <p className="mb-4 text-muted">Created when a customer accepts a quote ("Sign and create job" on the quote).</p>
      {err && <p role="alert" className="mb-2 text-sm text-warn">{err}</p>}
      <p role="status" className="mb-2 text-sm">{note}</p>
      <Async s={s} empty={!s.data?.length} emptyText="No jobs yet. A job appears when an accepted quote is signed.">
        <div className="grid gap-4 md:grid-cols-3">
          {JOB_COLS.map(([st, title]) => {
            const list = (s.data ?? []).filter(j => j.status === st)
            return (
              <section key={st} aria-labelledby={`jobs-${st}`}>
                <h2 id={`jobs-${st}`} className="mb-2 text-base font-semibold">{title} ({list.length})</h2>
                <ul className="grid gap-2">
                  {list.map(j => (
                    <li key={j.id} className="card">
                      <p className="font-semibold"><a className="link" href={`#/doc/${j.quote_id}`}>{j.quote_no}</a> <span className="font-normal">for {j.customer}</span></p>
                      <p className="mt-1 text-sm">{j.summary}</p>
                      <p className="mt-1 text-sm text-muted">Total {rm(j.total)}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {JOB_COLS.filter(c => c[0] !== st).map(([to, label]) => (
                          <button key={to} type="button" className="btn" onClick={() => move(j, to)}>Move {j.quote_no} to {label}</button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </Async>
    </>
  )
}

type Row = { description: string; qty: string; uom: string; unit_price: string }
const blank = (): Row => ({ description: '', qty: '', uom: '', unit_price: '' })

// Fallback when the reader cannot make sense of a document: key the lines in. Same review steps afterwards.
function ManualQuote({ onDone }: { onDone: () => void }) {
  const [supplier, setSupplier] = useState('')
  const [docNo, setDocNo] = useState('')
  const [rows, setRows] = useState<Row[]>([blank()])
  const [formErr, setFormErr] = useState('')
  const [added, setAdded] = useState<DocSummary>()
  const a = useAction()
  const set = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const submit = () => {
    if (!supplier.trim()) return setFormErr('Enter the supplier name.')
    if (rows.some(r => !r.description.trim() || !(Number(r.qty) > 0) || !r.uom.trim() || r.unit_price === '' || Number(r.unit_price) < 0))
      return setFormErr('Every line needs a description, a quantity above 0, a unit and a price.')
    setFormErr('')
    a.run(async () => {
      const doc = await api<DocSummary>('POST', '/documents/manual', {
        supplier: supplier.trim(), doc_no: docNo.trim() || undefined,
        lines: rows.map(r => ({ description: r.description.trim(), qty: r.qty, uom: r.uom.trim(), unit_price: r.unit_price })) })
      setAdded(doc); setRows([blank()]); setDocNo(''); onDone()
    })
  }
  return (
    <details className="card mt-3">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-accent">Key in a supplier quote by hand</summary>
      <form className="mt-2 grid gap-3" onSubmit={e => { e.preventDefault(); submit() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">Supplier name
          <input className="input font-normal" value={supplier} onChange={e => setSupplier(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Supplier document number (optional)
          <input className="input font-normal" value={docNo} onChange={e => setDocNo(e.target.value)} /></label>
        {rows.map((r, i) => (
          <fieldset key={i} className="grid gap-2 rounded-ui border border-soft p-2 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold">Line {i + 1}</legend>
            <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">Description
              <input className="input font-normal" value={r.description} onChange={e => set(i, 'description', e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-sm font-semibold">Quantity
              <input className="input font-normal" inputMode="decimal" value={r.qty} onChange={e => set(i, 'qty', e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-sm font-semibold">Unit (for example sheet, kg)
              <input className="input font-normal" value={r.uom} onChange={e => set(i, 'uom', e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-sm font-semibold">Unit price
              <input className="input font-normal" inputMode="decimal" value={r.unit_price} onChange={e => set(i, 'unit_price', e.target.value)} /></label>
            {rows.length > 1 && <div className="flex items-end"><button type="button" className="btn" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove line {i + 1}</button></div>}
          </fieldset>
        ))}
        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={() => setRows([...rows, blank()])}>Add a line</button>
          <button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? 'Saving...' : 'Add to tracker'}</button>
        </div>
      </form>
      <ActionError err={a.err} onRetry={submit} label="Retry saving" />
      {added && <p role="status" className="mt-2 text-sm">Added {added.doc_no ?? 'supplier quote'}. <a className="link" href={`#/doc/${added.id}`}>Open it to review the lines</a></p>}
    </details>
  )
}

function SettingsView({ owner }: { owner: boolean }) {
  const s = useFetch<Settings>('/settings')
  const [f, setF] = useState<Settings>()
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  useEffect(() => { if (s.data) setF(s.data) }, [s.data])
  if (!owner) return <><h1 tabIndex={-1} className="text-2xl font-semibold">Settings</h1><p className="card mt-3 text-muted">Owner only. Switch the simulated role to owner to change settings.</p></>
  const text = (k: 'ssm_no' | 'address' | 'bank_details' | 'sst_no', name: string) => (
    <label className="flex flex-col gap-1 text-sm font-semibold">{name}
      <input className="input font-normal" value={f?.[k] ?? ''} onChange={e => f && setF({ ...f, [k]: e.target.value })} /></label>
  )
  const save = async () => {
    if (!f) return
    setErr(''); setNote('')
    try {
      const out = await api<Settings>('POST', '/settings', {
        min_margin_pct: f.min_margin_pct, ssm_no: f.ssm_no ?? '', address: f.address ?? '', bank_details: f.bank_details ?? '',
        sst_registered: f.sst_registered, sst_no: f.sst_no ?? '' })
      setF(out); setNote('Settings saved.')
    } catch (e) { setErr(msg(e)) }
  }
  return (
    <>
      <h1 tabIndex={-1} className="text-2xl font-semibold">Settings</h1>
      <p className="mb-4 text-muted">The margin floor flags thin quotes for review. The business details are printed on the quote PDF.</p>
      <Async s={s} empty={false}>
        {f && (
          <form className="grid max-w-xl gap-3" onSubmit={e => { e.preventDefault(); save() }}>
            <label className="flex flex-col gap-1 text-sm font-semibold">Margin floor (%)
              <input className="input font-normal" inputMode="decimal" value={f.min_margin_pct} onChange={e => setF({ ...f, min_margin_pct: e.target.value })} /></label>
            {text('ssm_no', 'SSM registration number')}
            {text('address', 'Business address')}
            {text('bank_details', 'Bank details for payment')}
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={f.sst_registered} onChange={e => setF({ ...f, sst_registered: e.target.checked })} /> Registered for SST</label>
            {f.sst_registered && text('sst_no', 'SST registration number')}
            {err && <p role="alert" className="text-sm text-warn">{err}</p>}
            <p role="status" className="text-sm">{note}</p>
            <div><button type="submit" className="btn btn-primary">Save settings</button></div>
          </form>
        )}
      </Async>
    </>
  )
}

function Followups({ owner }: { owner: boolean }) {
  const s = useFetch<Followup[]>('/followups')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const act = async (f: Followup, action: 'send' | 'skip') => {
    setErr(''); setNote('')
    try { await api('POST', `/followups/${f.id}`, { action }); setNote(action === 'send' ? `Follow-up for ${f.doc_no} sent.` : `Follow-up for ${f.doc_no} skipped.`); s.reload() }
    catch (e) { setErr(msg(e)) }
  }
  return (
    <section className="mt-10 border-t border-soft pt-6" aria-labelledby="fu">
      <h2 id="fu" className="text-base font-semibold">Quotes waiting for a reply</h2>
      <p className="mb-2 text-sm text-muted">No answer after the follow-up window. Read the message, then send it or skip. Nothing is sent without you.</p>
      {err && <p role="alert" className="mb-2 text-sm text-warn">{err}</p>}
      <p role="status" className="mb-2 text-sm">{note}</p>
      <Async s={s} empty={!s.data?.length} emptyText="No quote is waiting for a follow-up.">
        <ul className="grid gap-2 md:grid-cols-2">
          {s.data?.map(f => (
            <li key={f.id} className="card">
              <p className="font-semibold"><a className="link" href={`#/doc/${f.document_id}`}>{f.doc_no}</a> <span className="font-normal">for {f.customer}</span></p>
              <p className="mt-1 text-sm text-muted">{f.reason}</p>
              <p className="mt-2 text-sm">{f.suggested_text ?? 'No chat contact on file: call the customer, then skip this.'}</p>
              {owner && <div className="mt-3 flex flex-wrap gap-2">
                {f.suggested_text && <button type="button" className="btn btn-primary" onClick={() => act(f, 'send')}>Send follow-up for {f.doc_no}</button>}
                <button type="button" className="btn" onClick={() => act(f, 'skip')}>Skip {f.doc_no}</button>
              </div>}
            </li>
          ))}
        </ul>
      </Async>
    </section>
  )
}

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
      <Report />
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
      <Followups owner={owner} />
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
const TITLES: Record<string, string> = { home: 'Home', alerts: 'Stale-cost alerts', tracker: 'Quote tracker', activity: 'Activity log', contacts: 'Contacts', ask: 'Ask suppliers', search: 'Search', assistant: 'Assistant', jobs: 'Jobs', settings: 'Settings', team: 'Team', account: 'Account' }

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
  const [searchText, setSearchText] = useState('')
  const searchBox = useRef<HTMLInputElement>(null)
  useEffect(() => {  // "/" jumps to the search box, like most list tools
    const k = (e: KeyboardEvent) => { if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) { e.preventDefault(); searchBox.current?.focus() } }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [])
  // 'login' shows the sign-in screen: when the server needs accounts and this tab has no session, or the session ended.
  const [gate, setGate] = useState<'checking' | 'login' | 'ready'>(MOCK ? 'ready' : 'checking')
  useEffect(() => {
    if (MOCK) return
    authConfig().then(c => setGate(c.login_required && !getToken() ? 'login' : 'ready'), () => setGate('ready'))
    const out = () => { setMe(undefined); setGate('login') }
    addEventListener('laris:signedout', out)
    return () => removeEventListener('laris:signedout', out)
  }, [])
  useEffect(() => {
    if (gate !== 'ready') return
    let live = true
    setMe(undefined); setMeErr('')
    // With a per-user token the server decides the role; follow it instead of the picker.
    resolveMe(role).then(m => { if (!live) return; if (m.role !== role) { setRole(m.role); setRoleState(m.role) } else setMe(m) }, e => live && setMeErr(msg(e)))
    return () => { live = false }
  }, [role, tries, gate])
  const owner = role === 'owner'
  const signedIn = !!getToken()
  const [, page, arg] = hash.split('/')
  const route = page || 'home'
  useEffect(() => { if (route !== 'doc') document.title = `${TITLES[route] ?? 'Page not found'} · LARIS` }, [route])
  const firstNav = useRef(true)
  useEffect(() => { if (firstNav.current) { firstNav.current = false; return } focusTop() }, [hash])
  if (gate === 'checking') return <p role="status" className="p-6 text-muted">Loading...</p>
  if (gate === 'login') return <Login dark={dark} setDark={setDark} onDone={() => { setGate('ready'); setTries(t => t + 1) }} />
  const runSearch = () => { const t = searchText.trim(); if (t) location.hash = `#/search/${encodeURIComponent(t)}` }
  const nav = [['home', 'Home'], ...(owner ? [['alerts', 'Stale costs']] : []), ['tracker', 'Tracker'], ['contacts', 'Contacts'], ['ask', 'Ask suppliers'], ['jobs', 'Jobs'], ['assistant', 'Assistant'], ['activity', 'Activity'], ...(owner ? [['team', 'Team'], ['settings', 'Settings']] : [])]
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
          {signedIn ? (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <a className="link inline-flex min-h-11 items-center" href="#/account">{me ? `${me.name} (${me.role})` : 'Account'}</a>
              <button type="button" className="btn" onClick={() => logout()}>Sign out</button>
            </span>
          ) : <label className="flex items-center gap-2 text-sm font-semibold">
            Role (simulated)
            <select className="input" value={role} onChange={e => { const r = e.target.value as Role; setRole(r); setRoleState(r); setRoleNote(`Viewing as ${r === 'owner' ? 'Owner' : 'Staff'}`) }}>
              <option value="owner">Owner</option><option value="staff">Staff</option>
            </select>
          </label>}
        </div>
        <form role="search" className="mx-auto flex max-w-6xl gap-2 px-4 pb-2" onSubmit={e => { e.preventDefault(); runSearch() }}>
          <label className="sr-only" htmlFor="gs">Search everything</label>
          <input id="gs" ref={searchBox} type="search" className="input min-w-0 flex-1" placeholder="Search (press / to focus)"
            value={searchText} onChange={e => setSearchText(e.target.value)} />
          <button type="submit" className="btn">Search</button>
        </form>
        <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-wrap px-1">
          {nav.map(([k, t]) => <a key={k} className="navlink" href={`#/${k}`} aria-current={route === k || (route === 'doc' && k === 'tracker') || (route === 'contact' && k === 'contacts') ? 'page' : undefined}>{t}</a>)}
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
          {route === 'home' && <HomeView owner={owner} name={me.name} />}
          {route === 'alerts' && <AlertsView owner={owner} />}
          {route === 'tracker' && <TrackerView owner={owner} />}
          {route === 'contacts' && <ContactsView owner={owner} />}
          {route === 'ask' && <AskView owner={owner} />}
          {route === 'assistant' && <AssistantView />}
          {route === 'search' && <SearchView q={decodeURIComponent(arg ?? '')} />}
          {route === 'contact' && arg && <ContactDetail id={arg} owner={owner} />}
          {route === 'jobs' && <JobsView />}
          {route === 'settings' && <SettingsView owner={owner} />}
          {route === 'team' && <TeamView owner={owner} meId={me.id} />}
          {route === 'account' && <AccountView name={me.name} role={me.role} />}
          {route === 'activity' && <ActivityView />}
          {route === 'doc' && arg && <DetailView id={arg} owner={owner} />}
          {!['home', 'alerts', 'tracker', 'contacts', 'contact', 'ask', 'search', 'assistant', 'jobs', 'activity', 'settings', 'team', 'account', 'doc'].includes(route) && <p className="card">Page not found. <a className="link" href="#/tracker">Open the tracker</a></p>}
        </>}
      </main>
    </>
  )
}

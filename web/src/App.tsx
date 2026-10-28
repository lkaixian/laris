import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, download, resolveMe, getRole, setRole, MOCK, NEXT, authConfig, getToken, getAccount, can, canOpen, needs, why, ApiError } from './api'
import type { License } from './api'
import Login from './Login'
import { Register, Forgot } from './Signup'
import AcceptInvite from './Invite'
import { LicenseProvider, LicenceGate, LicenceBanner, LicenceView, PurchaseView, Frame, blocked, useWriteGate, setLicenceOn } from './Licence'
import { Shell } from './Shell'
import { ErrorBoundary } from './ErrorBoundary'
import { ToastProvider, useToast } from './Toast'
import IdleGuard from './Idle'
import { AccountView, TeamView } from './Team'
import { RolesView } from './Roles'
import { IssuerView } from './Issuer'
import { ChannelsCard } from './Channels'
import { QuoteSettingsCard } from './QuoteSettings'
import { QuotePanel, Messages } from './QuoteDoc'
import { ContactDetail, ContactsView } from './Contacts'
import { SearchView } from './Search'
import { AssistantView } from './Assistant'
import { HomeView } from './Home'
import { TrackView } from './Track'
import { Timeline } from './Timeline'
import { JobsView } from './JobsBoard'
import { AskView } from './Ask'
import { StatusView, HealthBanner } from './Status'
import { CatalogView } from './Listings'
import { HelpView } from './Help'
import { PrivacyView } from './Privacy'
import { ApiAccessView } from './ApiAccess'
import { TourHost } from './Tour'
import { rm, label, msg, REVIEWABLE, focusTop, useFetch, useAction, ActionError, Async, Skeleton, EmptyState, PageHeader, TableRegion, Hint, OrgCtx, Status, applyBrand, OfflineBanner } from './ui'
import type { Role, Me, Tracker, DocDetail, DocSummary, Line, Alert, Field, Followup, MarginReport, Settings, Proposal, AuditEvent } from './api'


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

function UploadQuote({ onDone, open, onToggle }: { onDone: () => void; open: boolean; onToggle: (o: boolean) => void }) {
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
    <details className="card mt-3" open={open} onToggle={e => onToggle(e.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-accent">Upload supplier quote</summary>
      <form className="mt-2 grid gap-3" onSubmit={e => { e.preventDefault(); submit() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">Quote file (PDF, photo or text)
          <input id="quote-file" ref={file} type="file" accept=".pdf,.txt,image/*" className="input py-2 font-normal" />
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
function SimulateEnquiry({ open, onToggle }: { open: boolean; onToggle: (o: boolean) => void }) {
  const [channel, setChannel] = useState('telegram')
  const [text, setText] = useState('')
  const [formErr, setFormErr] = useState('')
  const a = useAction()
  const submit = () => {
    if (!can('manage_contacts')) return
    if (!text.trim()) return setFormErr('Type the customer enquiry first.')
    setFormErr('')
    a.run(async () => {
      const doc = await api<DocSummary>('POST', '/enquiries/simulate', { channel, text: text.trim() })
      location.hash = `#/doc/${doc.id}`
    })
  }
  return (
    <details className="card mt-3" open={open} onToggle={e => onToggle(e.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-accent">Simulate customer enquiry</summary>
      <form className="mt-2 grid gap-3" onSubmit={e => { e.preventDefault(); submit() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">Channel it arrived on
          <select className="input w-fit font-normal" value={channel} onChange={e => setChannel(e.target.value)}>
            {CHANNELS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Enquiry text
          <textarea id="enquiry-text" className="input min-h-24 py-2 font-normal" maxLength={4000} value={text} onChange={e => setText(e.target.value)} />
        </label>
        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        {!can('manage_contacts') && <p id="sim-why" className="text-sm text-muted">{why('manage_contacts')} to create a draft quote from an enquiry.</p>}
        <div><button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined} {...(can('manage_contacts') ? {} : { ...needs('manage_contacts'), 'aria-describedby': 'sim-why' })}>{a.busy ? 'Pricing the enquiry...' : 'Create draft quote from enquiry'}</button></div>
      </form>
      <ActionError err={a.err} onRetry={submit} label="Retry pricing the enquiry" />
    </details>
  )
}

const OPEN_QUOTE = ['draft', 'approved', 'sent', 'read']
let savedFilter = ''  // list state kept for this visit, so Back from a document returns to the same filtered list

// arg: 'review' and 'open' pre-select a filter (Home links), 'upload' opens the upload form.
function TrackerView({ owner, arg }: { owner: boolean; arg?: string }) {
  const gate = useWriteGate()
  const s = useFetch<Tracker>('/tracker')
  const [filter, setFilterRaw] = useState(arg === 'review' || arg === 'open' ? arg : savedFilter)
  const setFilter = (v: string) => { savedFilter = v; setFilterRaw(v) }
  useEffect(() => { if (arg === 'review' || arg === 'open') setFilter(arg) }, [arg])
  const [up, setUp] = useState(arg === 'upload')
  const [sim, setSim] = useState(false)
  const [tick, setTick] = useState(0)
  const focusId = useRef(arg === 'upload' ? 'quote-file' : '')
  // Open a form and put the cursor in it once it exists (the lanes only render after the tracker has loaded).
  const openForm = (id: string) => { (id === 'quote-file' ? setUp : setSim)(true); focusId.current = id; setTick(t => t + 1) }
  useEffect(() => {
    if (!focusId.current || !s.data) return
    const id = focusId.current; focusId.current = ''
    requestAnimationFrame(() => { const el = document.getElementById(id); el?.scrollIntoView({ block: 'center' }); el?.focus() })
  }, [tick, s.data])
  const all = [...(s.data?.received ?? []), ...(s.data?.sent ?? [])]
  const statuses = [...new Set(all.map(d => d.status))].sort()
  const match = (d: DocSummary) => !filter || (filter === 'review' ? d.flags.needs_review : filter === 'open' ? d.direction === 'out' && OPEN_QUOTE.includes(d.status) : d.status === filter)
  const pick = (l: DocSummary[]) => l.filter(match)
  const shown = pick(all).length
  const filterName = filter === 'review' ? 'needing review' : filter === 'open' ? 'open customer quotes' : `with status ${label(filter)}`
  const lane = (title: string, hint: string, l: DocSummary[], extra: ReactNode, empty: { title: string; hint: string; action?: { label: string; onClick: () => void } }) => (
    <section aria-labelledby={title} className="min-w-0">
      <h2 id={title} className="border-b-2 border-accent pb-1 text-lg font-semibold">{title} <span className="text-sm font-normal text-muted">({l.length}) {hint}</span></h2>
      {extra}
      {l.length ? <ul className="mt-3 divide-y divide-soft rounded-ui border border-soft bg-surface">{l.map(d => <DocCard key={d.id} d={d} owner={owner} />)}</ul>
        : <div className="mt-3">{filter ? <p className="py-3 text-muted">No documents {filterName}. <button type="button" className="link" onClick={() => setFilter('')}>Show all</button></p> : <EmptyState {...empty} />}</div>}
    </section>
  )
  return (
    <>
      <PageHeader title="Quote tracker" description="Supplier quotes you received and customer quotes you sent, in one place."
        actions={can('upload_documents') && <button type="button" className="btn btn-primary" {...gate(() => openForm('quote-file'))}>Upload quote</button>} />
      <label className="mb-4 flex flex-wrap items-center gap-2 text-sm font-semibold">
        Filter
        <select className="input" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="">All documents</option>
          <option value="review">Needs review</option>
          <option value="open">Open customer quotes</option>
          {statuses.map(x => <option key={x} value={x}>Status: {label(x)}</option>)}
        </select>
      </label>
      <p role="status" className="sr-only">{s.data ? `Showing ${shown} ${shown === 1 ? 'document' : 'documents'}` : ''}</p>
      <Async s={s} rows={4}>
        <div className="grid gap-8 md:grid-cols-2">
          {lane('Received', 'Supplier quotes', pick(s.data?.received ?? []), can('upload_documents') ? <><UploadQuote onDone={s.reload} open={up} onToggle={setUp} />{!MOCK && <ManualQuote onDone={s.reload} />}</> : null,
            { title: 'No supplier quotes yet.', hint: 'Upload a PDF, a photo or pasted text and LARIS reads the prices for you.', action: can('upload_documents') ? { label: 'Upload a supplier quote', onClick: () => openForm('quote-file') } : undefined })}
          {lane('Sent', 'Customer quotes', pick(s.data?.sent ?? []), <SimulateEnquiry open={sim} onToggle={setSim} />,
            { title: 'No customer quotes yet.', hint: 'A quote appears here when a customer asks for a price.', action: { label: 'Try a sample enquiry', onClick: () => openForm('enquiry-text') } })}
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
  // `edit` = the document is still reviewable; the permission only decides whether the inputs are there (the server stays the authority).
  const editable = edit && can('upload_documents')
  const priceEdit = editable && can('view_costs') && l.unit_price !== null
  const [key, setKey] = useState(l.item_key ?? '')
  const [qty, setQty] = useState(l.qty ? String(Number(l.qty)) : '')
  const [price, setPrice] = useState(l.unit_price !== null ? String(Number(l.unit_price)) : '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const errId = `line-err-${l.id}`
  const bad = err ? { 'aria-invalid': true, 'aria-describedby': errId } : {}
  const save = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try {
      const changed = priceEdit && price !== '' && Number(price) !== Number(l.unit_price)
      await api('POST', `/documents/${docId}/lines/${l.id}`, { item_key: key.trim() || undefined, qty: qty === '' ? undefined : qty, ...(changed ? { unit_price: price } : {}) })
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
        {editable ? <input className="input w-36" aria-label={`Item key for line ${l.line_no}`} value={key} onChange={e => setKey(e.target.value)} {...bad} /> : l.item_key ?? <span className="text-muted">Not set</span>}
      </td>
      <td>
        {editable ? <input className="input w-24" type="number" min="0" step="any" inputMode="decimal" aria-label={`Quantity for line ${l.line_no}`} value={qty} onChange={e => setQty(e.target.value)} {...bad} /> : l.qty ? Number(l.qty) : <span className="text-muted">Not set</span>}
      </td>
      <td>{l.uom}</td>
      <td>{!showPrice ? <span className="text-muted">Hidden for staff</span>
        : priceEdit ? <input className="input w-28" type="number" min="0" step="any" inputMode="decimal" aria-label={`Unit cost for line ${l.line_no}`} value={price} onChange={e => setPrice(e.target.value)} {...bad} />
        : rm(l.unit_price)}</td>
      {cols.map(f => <td key={f.key}>{cell(f, l.attrs[f.key])}</td>)}
      {editable && <td><button className="btn" aria-disabled={busy || undefined} onClick={save}>{busy ? 'Saving...' : `Save line ${l.line_no}`}</button></td>}
    </tr>
  )
}

function DetailView({ id, owner }: { id: string; owner: boolean }) {
  const costs = can('view_costs')  // cost, margin and provenance follow the permission; deciding on a quote stays owner-class
  const s = useFetch<DocDetail>(`/documents/${id}`)
  const f = useFetch<Field[]>('/fields')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')  // the status being moved to, shown on that button while it runs
  const toast = useToast()
  const d = s.data
  const cols = (f.data ?? []).filter(x => x.show_in_grid).sort((a, b) => a.sort_order - b.sort_order)
  const actions = d ? NEXT[d.doc.direction][d.doc.status] ?? [] : []
  const edit = !!d && d.doc.direction === 'in' && REVIEWABLE.includes(d.doc.status)
  const docNo = d?.doc.id === id ? d.doc.doc_no ?? 'Document' : undefined
  // Arrived by navigation (focus is parked on main): move it to the heading once the document is there.
  useEffect(() => { if (docNo && document.activeElement === document.getElementById('main')) focusTop() }, [docNo])
  const move = async (to: string) => {
    if (busy) return
    setBusy(to); setErr('')
    try {
      const r = await api<{ delivery?: string }>('POST', `/documents/${id}/transition`, { to, reason: reason.trim() || undefined })
      setReason(''); s.reload(); focusTop()
      if (r.delivery === 'not_sent') toast(`${docNo} moved to ${label(to)}. No chat contact on file, so nothing was sent.`)
      else toast(`${docNo} moved to ${label(to)}.`)
      if (r.delivery === 'failed') setErr('Marked as sent, but the message to the customer did not go through. Send the quote PDF by hand.')
    } catch (e) { setErr(msg(e)); if (e instanceof ApiError && e.status === 409) s.reload() } finally { setBusy('') }  // 409: the document changed under us, show its real state
  }
  const save = async (path: string, name: string) => {
    setErr('')
    try { await download(path, name); toast(`${name} downloaded.`) } catch (e) { setErr(msg(e)) }
  }
  const lineOf = (lineId?: string) => d?.lines.find(l => l.id === lineId)
  return (
    <>
      {!d && <PageHeader back={{ href: '#/tracker', label: 'Back to tracker' }} />}
      <Async s={s} empty={false} rows={5}>
        {d && (
          <>
            <PageHeader back={{ href: '#/tracker', label: 'Back to tracker' }} title={d.doc.doc_no ?? 'No document number'}
              meta={<>
                <span>{d.doc.direction === 'in' ? 'Supplier quote from' : 'Customer quote for'} {d.doc.party.name}</span>
                <Status v={d.doc.status} />
                {costs && d.doc.flags.cost_is_stale && <span className="badge badge-warn">Cost is stale</span>}
                <span className="text-muted">Total {rm(d.doc.total)}</span>
              </>}
              actions={d.doc.direction === 'out' && !MOCK && <>
                {can('export_data') && costs && ['accepted', 'sent', 'read', 'job_created'].includes(d.doc.status) && <>
                  <button type="button" className="btn" onClick={() => save(`/export/bom.xlsx?quote_id=${id}`, `bom-${d.doc.doc_no}.xlsx`)}>Download BOM (xlsx)</button>
                  <button type="button" className="btn" onClick={() => save(`/export/po.csv?quote_id=${id}`, `po-${d.doc.doc_no}.csv`)}>Download purchase list (csv)</button>
                </>}
              </>} />

            <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
            <div className="min-w-0 lg:order-1">
            {d.doc.direction === 'out' && <QuotePanel key={id} id={id} status={d.doc.status} owner={owner} onChanged={s.reload} />}
            <h2 className="mb-1 text-lg font-semibold">Lines</h2>
            {edit && !can('upload_documents') && <p className="mb-2 text-sm text-muted">{why('upload_documents')} to edit these lines. You can read them here.</p>}
            {edit && can('upload_documents') && <p className="mb-2 text-sm text-muted">Review step: set the item key and quantity for each line, then save the line. The item key is a short code that links the line to your cost book, for example acrylic_3mm_sheet. Lines marked Needs review are unclear on the source document.</p>}
            {f.error && <p role="alert" className="mb-2 text-sm text-warn">Could not load extra columns: {f.error}</p>}
            {d.lines.length === 0 ? <p className="card text-muted">This document has no lines.</p> : (
              <TableRegion label="Lines">
                <table className="w-full min-w-max">
                  <caption className="sr-only">Lines of {d.doc.doc_no ?? 'this document'}</caption>
                  <thead><tr>
                    <th scope="col">No.</th><th scope="col">Description</th><th scope="col">Item key</th><th scope="col">Qty</th><th scope="col">Unit</th>
                    <th scope="col">{d.doc.direction === 'in' ? 'Unit cost' : 'Unit price'}</th>
                    {cols.map(c => <th key={c.key} scope="col">{c.label}</th>)}
                    {edit && can('upload_documents') && <th scope="col">Action</th>}
                  </tr></thead>
                  <tbody>{d.lines.map(l => <LineRow key={l.id} docId={id} l={l} cols={cols} edit={edit} showPrice={costs || d.doc.direction === 'out' || REVIEWABLE.includes(d.doc.status)} onSaved={n => { toast(`Line ${n} saved.`); s.reload() }} />)}</tbody>
                </table>
              </TableRegion>
            )}
            <Messages list={d.messages} />
            </div>

            <aside className="grid gap-6 lg:order-2">
            <section className="card border-l-4 border-l-accent" aria-labelledby="actions">
              <h2 id="actions" className="font-semibold">Decision</h2>
              {!actions.length && <p className="text-sm text-muted">This document is {label(d.doc.status)}. No further actions.</p>}
              {actions.length > 0 && !owner && !actions.some(a => !a.owner) && <p className="text-sm text-muted">Only the owner can decide on this quote. Switch the simulated role to owner to try it.</p>}
              {actions.some(a => !a.owner || owner) && (
                <>
                  {owner && <label className="mt-2 flex flex-col gap-1 text-sm font-semibold">Reason (optional, saved to the activity log)
                    <input className="input max-w-md font-normal" value={reason} onChange={e => setReason(e.target.value)} />
                  </label>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {actions.filter(a => !a.owner || owner).map(a => (
                      <button key={a.to} aria-disabled={!!busy || undefined} {...(a.owner ? { onClick: () => move(a.to) } : needs('upload_documents', () => move(a.to)))} className={`btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`}>{busy === a.to ? 'Working...' : a.label}</button>
                    ))}
                  </div>
                </>
              )}
              {err && <p role="alert" className="mt-2 text-sm text-warn">{err}</p>}
            </section>

            <Timeline key={id} id={id} status={d.doc.status} />

            {costs && d.provenance && (
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
            {!costs && <p className="text-sm text-muted">Cost and margin are not available to your role.</p>}
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
      <Async s={s} empty={!r || !r.quotes} emptyText="No quotes were created in the last 7 days.">
        {r && <>
          <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {([['Quotes', String(r.quotes ?? 0)], ['Quoted', rm(r.revenue)], ['Margin', `${rm(r.margin)}${r.margin_pct != null ? ` (${r.margin_pct}%)` : ''}`],
               ['Won / lost', `${r.won ?? 0} / ${r.lost ?? 0}`]] as const).map(([k, v]) => (
              <div key={k} className="card"><dt className="text-sm text-muted">{k}</dt><dd className="text-lg font-semibold">{v}</dd></div>
            ))}
          </dl>
          {(r.lowest_margin?.length ?? 0) > 0 && <p className="mt-2 text-sm">Thinnest margin: {r.lowest_margin!.map((q, i) => (
            <span key={q.quote_id}>{i > 0 && ', '}<a className="link" href={`#/doc/${q.quote_id}`}>{q.quote_no}</a> ({q.margin_pct ?? 'n/a'}%)</span>))}</p>}
        </>}
      </Async>
    </section>
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
          <button type="submit" className="btn" aria-disabled={a.busy || undefined}>{a.busy ? 'Saving...' : 'Add to tracker'}</button>
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
  const [busy, setBusy] = useState(false)
  const [logoErr, setLogoErr] = useState('')
  const toast = useToast()
  useEffect(() => { if (s.data) setF(s.data) }, [s.data])
  if (!owner) return <><PageHeader title="Settings" /><p className="card text-muted">You do not have access. Only the owner changes settings.</p></>
  const text = (k: 'ssm_no' | 'address' | 'bank_details' | 'sst_no', name: string) => (
    <label className="flex flex-col gap-1 text-sm font-semibold">{name}
      <input className="input font-normal" value={f?.[k] ?? ''} onChange={e => f && setF({ ...f, [k]: e.target.value })} /></label>
  )
  const colour = (f?.brand_color ?? '').trim()
  const colourOk = colour === '' || /^#[0-9a-f]{6}$/i.test(colour)
  // Logo: png, jpeg or webp up to 200 KB, read in the browser into a data URL. The server checks the real bytes again.
  const pickLogo = (file?: File) => {
    setLogoErr('')
    if (!file || !f) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setLogoErr('Use a PNG, JPEG or WebP image. SVG is not accepted.')
    if (file.size > 200 * 1024) return setLogoErr('That image is over 200 KB. Use a smaller one.')
    const r = new FileReader()
    r.onload = () => setF(p => p && { ...p, logo_data_url: String(r.result) })
    r.onerror = () => setLogoErr('Could not read that file. Try another image.')
    r.readAsDataURL(file)
  }
  const save = async () => {
    if (!f || busy) return
    setErr('')
    if (!colourOk) return setErr('The brand colour must be a hex colour like #0f5c47.')
    setBusy(true)
    try {
      const out = await api<Settings>('POST', '/settings', {
        display_name: f.display_name?.trim() || null, brand_color: colour ? colour.toLowerCase() : null, logo_data_url: f.logo_data_url || null,
        min_margin_pct: f.min_margin_pct, ssm_no: f.ssm_no ?? '', address: f.address ?? '', bank_details: f.bank_details ?? '',
        sst_registered: f.sst_registered, sst_no: f.sst_no ?? '' })
      setF(out); toast('Settings saved.')
      window.dispatchEvent(new Event('laris:branding'))
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 413 ? 'The logo is too large. Use an image under 200 KB.'
        : e instanceof ApiError && e.status === 415 ? 'The logo must be a PNG, JPEG or WebP image.'
        : e instanceof ApiError && e.status === 422 && /colou?r/i.test(e.code + e.message) ? 'The brand colour is not valid. Use a hex colour like #0f5c47.' : msg(e))
    } finally { setBusy(false) }
  }
  return (
    <>
      <PageHeader title="Settings" description="The margin floor flags thin quotes for review. The business details are printed on the quote PDF. Branding shows in the header for everyone after you save." />
      <Async s={s} empty={false} rows={4}>
        {f && (
          <form className="grid max-w-xl gap-3" onSubmit={e => { e.preventDefault(); save() }}>
            <fieldset className="grid gap-3 rounded-ui border border-soft p-3">
              <legend className="px-1 text-sm font-semibold">Branding (everyone sees this)</legend>
              <label className="flex flex-col gap-1 text-sm font-semibold">Organisation display name
                <input className="input font-normal" maxLength={120} value={f.display_name ?? ''} onChange={e => setF({ ...f, display_name: e.target.value })} /></label>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm font-semibold">Brand colour (hex)
                  <input className="input w-32 font-normal" placeholder="#0f5c47" maxLength={7} autoCapitalize="none" spellCheck={false} aria-invalid={!colourOk || undefined} aria-describedby="bc-help"
                    value={f.brand_color ?? ''} onChange={e => setF({ ...f, brand_color: e.target.value })} /></label>
                <label className="flex flex-col gap-1 text-sm font-semibold">Pick a colour
                  <input type="color" className="input w-16 p-1" value={colourOk && colour ? colour.toLowerCase() : '#0f5c47'} onChange={e => setF({ ...f, brand_color: e.target.value })} /></label>
                <span aria-hidden="true" className="size-11 rounded-ui border border-line" style={{ backgroundColor: colourOk && colour ? colour : 'var(--accent)' }} />
                <button type="button" className="btn" onClick={() => setF({ ...f, brand_color: null })}>Reset colour</button>
              </div>
              <p id="bc-help" className="text-sm text-muted">{colour ? (colourOk ? `Colour ${colour.toLowerCase()} is used for main buttons and the active tab.` : 'Not a valid colour yet. Use # and six hex digits.') : 'No colour set: the standard LARIS green is used.'}</p>
              <div className="grid gap-2">
                <label className="flex flex-col gap-1 text-sm font-semibold">Logo (PNG, JPEG or WebP, up to 200 KB)
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="input py-2 font-normal" aria-describedby={logoErr ? 'logo-err' : undefined}
                    onChange={e => { pickLogo(e.target.files?.[0]); e.target.value = '' }} /></label>
                {logoErr && <p id="logo-err" role="alert" className="text-sm text-warn">{logoErr}</p>}
                {f.logo_data_url
                  ? <div className="flex flex-wrap items-center gap-3"><img src={f.logo_data_url} alt="Logo preview" className="h-12 max-w-40 rounded-ui border border-soft bg-surface object-contain p-1" />
                      <button type="button" className="btn" onClick={() => setF({ ...f, logo_data_url: null })}>Remove logo</button></div>
                  : <p className="text-sm text-muted">No logo: initials are shown instead.</p>}
              </div>
            </fieldset>
            <label className="flex flex-col gap-1 text-sm font-semibold">Margin floor (%)
              <input className="input font-normal" inputMode="decimal" aria-describedby="mf-help" value={f.min_margin_pct} onChange={e => setF({ ...f, min_margin_pct: e.target.value })} />
              <Hint id="mf-help">Margin is profit as a share of the selling price. A quote below this is flagged for review.</Hint></label>
            {text('ssm_no', 'SSM registration number')}
            {text('address', 'Business address')}
            {text('bank_details', 'Bank details for payment')}
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={f.sst_registered} onChange={e => setF({ ...f, sst_registered: e.target.checked })} /> Registered for SST</label>
            {f.sst_registered && text('sst_no', 'SST registration number')}
            {err && <p role="alert" className="text-sm text-warn">{err}</p>}
            <div><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Saving...' : 'Save settings'}</button></div>
          </form>
        )}
      </Async>
      <ChannelsCard />
      <QuoteSettingsCard />
    </>
  )
}

function Followups() {
  const s = useFetch<Followup[]>(can('manage_followups') ? '/followups' : null)  // no permission: no request (the page is not reachable then anyway)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')  // "<id>:<action>" while that call runs
  const toast = useToast()
  const act = async (f: Followup, action: 'send' | 'skip') => {
    if (busy) return
    setErr(''); setBusy(`${f.id}:${action}`)
    try { await api('POST', `/followups/${f.id}`, { action }); toast(action === 'send' ? `Follow-up for ${f.doc_no} sent.` : `Follow-up for ${f.doc_no} skipped.`); s.reload() }
    catch (e) { setErr(msg(e)) } finally { setBusy('') }
  }
  return (
    <section id="followups" aria-label="Quotes waiting for a reply">
      <PageHeader title="Follow-ups" description="Quotes with no answer after the follow-up window. Read the message, then send it or skip. Nothing is sent without you." />
      {err && <p role="alert" className="mb-2 text-sm text-warn">{err}</p>}
      <Async s={s} rows={2} empty={!s.data?.length} emptyText="No quote is waiting for a follow-up." emptyHint="When a customer has not answered after the follow-up window, the quote shows up here.">
        <ul className="grid gap-2 md:grid-cols-2">
          {s.data?.map(f => (
            <li key={f.id} className="card">
              <p className="font-semibold"><a className="link" href={`#/doc/${f.document_id}`}>{f.doc_no}</a> <span className="font-normal">for {f.customer}</span></p>
              <p className="mt-1 text-sm text-muted">{f.reason}</p>
              <p className="mt-2 text-sm">{f.suggested_text ?? 'No chat contact on file: call the customer, then skip this.'}</p>
              {can('manage_followups') && <div className="mt-3 flex flex-wrap gap-2">
                {f.suggested_text && <button type="button" className="btn btn-primary" aria-disabled={!!busy || undefined} onClick={() => act(f, 'send')}>{busy === `${f.id}:send` ? 'Sending...' : `Send follow-up for ${f.doc_no}`}</button>}
                <button type="button" className="btn" aria-disabled={!!busy || undefined} onClick={() => act(f, 'skip')}>{busy === `${f.id}:skip` ? 'Skipping...' : `Skip ${f.doc_no}`}</button>
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
  const [busy, setBusy] = useState('')
  const toast = useToast()
  const decide = async (p: Proposal, decision: 'approve' | 'ignore') => {
    if (busy) return
    setErr(''); setBusy(`${p.id}:${decision}`)
    try { await api('POST', `/field-proposals/${p.id}/decide`, { decision, type: type[p.id] ?? 'text', label: p.key.replace(/_/g, ' ') }); toast(decision === 'approve' ? `${p.key} added as a column.` : `${p.key} ignored.`); s.reload(); focusTop() }
    catch (e) { setErr(msg(e)) } finally { setBusy('') }
  }
  return (
    <section className="mt-10 border-t border-soft pt-6" aria-labelledby="newf">
      <h2 id="newf" className="text-base font-semibold">New fields seen on documents</h2>
      <p className="mb-2 text-sm text-muted">A field the extractor found that is not a column yet. Nothing becomes a column until you approve it.</p>
      {err && <p role="alert" className="mb-2 text-sm text-warn">{err}</p>}
      <Async s={s} rows={2} empty={!s.data?.length} emptyText="No unknown fields waiting for a decision.">
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
                <button className="btn btn-primary" aria-disabled={!!busy || undefined} onClick={() => decide(p, 'approve')}>{busy === `${p.id}:approve` ? 'Adding...' : `Add ${p.key} as column`}</button>
                <button className="btn" aria-disabled={!!busy || undefined} onClick={() => decide(p, 'ignore')}>{busy === `${p.id}:ignore` ? 'Ignoring...' : `Ignore ${p.key}`}</button>
              </div>
            </li>
          ))}
        </ul>
      </Async>
    </section>
  )
}

function AlertsView() {
  const s = useFetch<Alert[]>('/alerts/stale-costs')
  const n = s.data?.length ?? 0
  const lost = (s.data ?? []).reduce((a, x) => a + (Number(x.margin_delta) || 0), 0)
  return (
    <>
      <PageHeader title="Stale-cost alerts" description="Quotes still open whose supplier cost has risen since pricing. Nothing is re-priced automatically." />
      {can('view_reports') && can('view_costs') && <Report />}
      <p role="status" className={s.data && n ? 'mb-4 border-l-4 border-amber pl-3 text-xl font-semibold' : 'sr-only'}>{s.data && n ? `${n} open ${n === 1 ? 'quote' : 'quotes'} affected, margin down ${rm(String(Math.abs(lost)))} in total` : ''}</p>
      <Async s={s} empty={!n} emptyText="No open quote is affected by a newer supplier cost." emptyHint="You will see a quote here if a supplier raises a price after you quoted.">
        <ul className="grid gap-2">
          {s.data?.map(a => (
            <li key={a.quote_id + a.item_key} className="card flex flex-wrap items-center gap-x-6 gap-y-2 border-l-4 border-l-amber">
              <div className="min-w-0 flex-1 basis-64">
              <p className="font-semibold"><a className="link" href={`#/doc/${a.quote_id}`}>{a.quote_no}</a> <span className="font-normal">for {a.customer}</span></p>
              <p className="mt-1 text-sm">{a.item_key}: cost {rm(a.old_cost)} to {rm(a.current_cost)}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2"><span className="badge badge-warn">Margin down {rm(String(Math.abs(Number(a.margin_delta) || 0)))}</span><Status v={a.status} /></p>
              </div>
              <a className="btn" href={`#/doc/${a.quote_id}`}>Review {a.quote_no}</a>
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
      <PageHeader title="Activity log" description={`Checks for new events every 4 seconds.${checked ? ` Last checked ${checked}.` : ''}`} />
      <p role="status" className="sr-only">{announce}</p>
      {error && <div role="alert" className="card mb-3 border-warn bg-warn-bg text-warn"><p>{error}</p><button className="btn mt-3" onClick={poll}>Retry loading</button></div>}
      {loading ? <Skeleton rows={5} shape="text" /> : events.length === 0 && !error ? <EmptyState title="No activity yet." hint="Uploads, approvals and sign-ins are listed here as they happen." /> : (
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

// ---------- Pages and shell ----------
/*
  ADD A PAGE: write the view component, add one entry to PAGES (hash route -> title + render), add a nav item in Shell.tsx NAV,
  and, if it needs a permission, one line in NEED in api.ts. Start the view with <PageHeader title=... /> (it sets <title> and is the focus target).
  Detail pages use PageHeader's `back` prop and a route like #/thing/<id> (arg).
*/
interface PageCtx { me: Me; owner: boolean; arg?: string }
// Mock-only test switch: /?crash=1#/contacts throws while rendering, to see the page fallback. MOCK is a build constant, so real builds drop it.
function MockCrash(): never { throw new Error('Mock crash (?crash=1)') }
const NotFound = () => <><PageHeader title="Page not found" /><EmptyState title="That page does not exist." action={{ label: 'Open the tracker', href: '#/tracker' }} /></>
const PAGES: Record<string, { title: string; render: (c: PageCtx) => ReactNode }> = {
  home: { title: 'Home', render: c => <HomeView me={c.me} owner={can('view_costs')} /> },
  alerts: { title: 'Stale-cost alerts', render: () => <AlertsView /> },
  followups: { title: 'Follow-ups', render: () => <Followups /> },
  tracker: { title: 'Quote tracker', render: c => <TrackerView owner={can('view_costs')} arg={c.arg} /> },
  contacts: { title: 'Contacts', render: c => <ContactsView owner={can('view_costs')} arg={c.arg} /> },
  contact: { title: 'Contact', render: c => c.arg ? <ContactDetail id={c.arg} owner={can('view_costs')} /> : <NotFound /> },
  ask: { title: 'Ask suppliers', render: () => <AskView owner={can('view_replies_prices')} /> },
  catalog: { title: 'Catalog photos', render: c => <CatalogView me={c.me} owner={c.owner} id={c.arg} /> },
  assistant: { title: 'Assistant', render: () => <AssistantView /> },
  search: { title: 'Search', render: c => <SearchView q={safeDecode(c.arg)} /> },
  track: { title: 'Track', render: () => <TrackView /> },
  jobs: { title: 'Jobs', render: c => <JobsView me={c.me} /> },
  settings: { title: 'Settings', render: c => <SettingsView owner={c.owner} /> },
  team: { title: 'Team', render: c => <TeamView owner={c.owner} meId={c.me.id} /> },
  privacy: { title: 'Privacy and data', render: () => <PrivacyView /> },
  'api-access': { title: 'API access', render: () => <ApiAccessView /> },
  roles: { title: 'Roles', render: c => <RolesView owner={c.owner} /> },
  account: { title: 'Account', render: c => <AccountView name={c.me.name} role={c.me.role_name ?? c.me.role} /> },
  activity: { title: 'Activity log', render: () => <ActivityView /> },
  status: { title: 'System status', render: () => <StatusView /> },
  licence: { title: 'Licence', render: c => <LicenceView owner={c.owner} /> },
  issuer: { title: 'Issue licences', render: () => <IssuerView /> },
  purchase: { title: 'Get a licence', render: c => <PurchaseView owner={c.owner} backHref="#/licence" /> },
  help: { title: 'Help', render: c => <HelpView arg={c.arg} /> },
  doc: { title: 'Document', render: c => c.arg ? <DetailView id={c.arg} owner={c.owner} /> : <NotFound /> },
}

// A malformed escape in the hash (#/search/%E0%A4%A) must not throw: treat it as empty.
const safeDecode = (s = '') => { try { return decodeURIComponent(s) } catch { return '' } }
const NOT_ENFORCED: License = { status: 'active', plan: null, seats: null, seats_used: 0, expires_at: null, days_left: null, enforced: false, read_only: false, clock: null }

const routeOf = (h: string) => (h.split('/')[1] || 'home').split('?')[0]

// Put a list page back where the reader left it (after Back from a document). Waits for the content to be tall enough; stops if the reader scrolls.
function restoreScroll(y: number) {
  let n = 0, stop = false
  const off = () => { stop = true }
  const evs = ['wheel', 'touchstart', 'keydown'] as const
  evs.forEach(e => addEventListener(e, off, { once: true, passive: true }))
  const tick = () => { if (stop) return; scrollTo(0, y); if (Math.abs(scrollY - y) < 2 || ++n > 180) return; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  return () => { stop = true; evs.forEach(e => removeEventListener(e, off)) }
}

export default function App() {
  return <ToastProvider><AppShell /></ToastProvider>
}

/*
  Sign-in states live here: `gate` is 'checking' | 'login' | 'ready'. A new pre-login screen (register, verify, licence) is another gate
  value rendered before the <Shell>; pages only ever render inside the shell once the gate is 'ready' and /api/me has answered.
*/
function AppShell() {
  const toast = useToast()
  const [hash, setHash] = useState(location.hash)
  const [role, setRoleState] = useState<Role>(getRole())
  const prev = useRef({ from: location.hash, now: location.hash })
  const seen = useRef(new Map<string, number>())  // route -> scrollY when it was left
  useEffect(() => {
    history.scrollRestoration = 'manual'
    const h = () => {
      seen.current.set(routeOf(prev.current.now), scrollY)  // read before React swaps the page
      prev.current = { from: prev.current.now, now: location.hash }
      setHash(location.hash)
    }
    addEventListener('hashchange', h); return () => removeEventListener('hashchange', h)
  }, [])
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark')
  // The user id comes from GET /api/me (X-Role only). Re-resolved whenever the simulated role changes; nothing renders before it.
  const [me, setMe] = useState<Me>()
  const [meErr, setMeErr] = useState('')
  const [tries, setTries] = useState(0)
  // 'login' shows the sign-in screen: when the server needs accounts and this tab has no session, or the session ended.
  const [gate, setGate] = useState<'checking' | 'login' | 'ready'>(MOCK ? 'ready' : 'checking')
  const [demo, setDemo] = useState(false)  // the server still accepts the shared access token (login not required)
  // Licence: undefined until read. Not enforced (the usual case) means nothing in the UI changes. `roOk`: the person chose to continue read-only.
  const [lic, setLic] = useState<License>()
  const [licTries, setLicTries] = useState(0)
  const [roOk, setRoOk] = useState(false)
  const licRetried = useRef(false)
  useEffect(() => {
    if (!MOCK) authConfig().then(c => { setDemo(!c.login_required); setGate(c.login_required && !getToken() ? 'login' : 'ready') }, () => setGate('ready'))
    const out = () => { setMe(undefined); setLic(undefined); setRoOk(false); setGate('login') }
    addEventListener('laris:signedout', out)
    const l402 = () => { toast('Your licence is missing or expired, so that change was not saved.', { href: '#/licence', label: 'Open licence' }); setLicTries(t => t + 1) }
    addEventListener('laris:license402', l402)
    return () => { removeEventListener('laris:signedout', out); removeEventListener('laris:license402', l402) }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (gate !== 'ready' || !me) return
    let live = true
    // Failed read (the wrapper already retried once): keep what was known, log, try once more later. Never turns enforcement off by itself.
    api<License>('GET', '/license').then(l => { if (live) { licRetried.current = false; setLicenceOn(l.enforced); setLic(l) } }, e => {
      if (!live) return
      console.warn('Licence check failed', e)
      setLic(p => p ?? NOT_ENFORCED)  // first read: let the app open, the later retry corrects it
      if (!licRetried.current) { licRetried.current = true; setTimeout(() => setLicTries(t => t + 1), 5000) }
    })
    return () => { live = false }
  }, [gate, me?.id, licTries])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (gate !== 'ready') return
    let live = true
    setMe(undefined); setMeErr('')
    // With a per-user token the server decides the role; follow it instead of the picker.
    resolveMe(role).then(m => { if (!live) return; if (m.role !== role) { setRole(m.role); setRoleState(m.role) } else setMe(m) }, e => live && setMeErr(msg(e)))
    return () => { live = false }
  }, [role, tries, gate])
  const owner = role === 'owner'
  const [, page, arg] = hash.split('/')
  const route0 = (page || 'home').split('?')[0]  // '#/invite?token=...' is route 'invite'
  const route = route0 === 'alerts' && arg === 'followups' ? 'followups' : route0  // the old #/alerts/followups link opens the Follow-ups page
  useEffect(() => applyBrand(me?.org), [me?.org])
  // Branding saved on the Settings page: re-read /me without blanking the page.
  useEffect(() => {
    const h = () => resolveMe(role).then(setMe, () => undefined)
    addEventListener('laris:branding', h); addEventListener('laris:perms', h)  // a 403 may mean the role changed: re-read /me (permissions)
    return () => { removeEventListener('laris:branding', h); removeEventListener('laris:perms', h) }
  }, [role])
  // On navigation: back to a list from a document restores its scroll position, any other route change starts at the top; focus goes to the page heading.
  const firstNav = useRef(true)
  useEffect(() => {
    if (firstNav.current) { firstNav.current = false; return }
    const to = routeOf(hash), from = routeOf(prev.current.from)
    const y = (from === 'doc' || from === 'contact') && to !== from ? seen.current.get(to) : undefined
    if (!y && to !== from) scrollTo(0, 0)
    focusTop(!!y || to !== from)
    return y ? restoreScroll(y) : undefined
  }, [hash])
  const onRole = (r: Role) => { setRole(r); setRoleState(r); toast(`Viewing as ${r === 'owner' ? 'Owner' : 'Staff'}`) }
  if (gate === 'checking') return <div className="p-6"><Skeleton rows={3} /></div>
  // Signed-out screens (full width, no sidebar): sign in is the default, register and forgot are public routes.
  if (route === 'invite') return <AcceptInvite dark={dark} setDark={setDark} />
  if (gate === 'login' || (['login', 'register', 'forgot'].includes(route) && (MOCK || !getToken()))) {
    if (route === 'register') return <Register dark={dark} setDark={setDark} />
    if (route === 'forgot') return <Forgot dark={dark} setDark={setDark} />
    return <Login dark={dark} setDark={setDark} demo={demo} onDone={() => { if (route === 'login') location.hash = '#/home'; setGate('ready'); setTries(t => t + 1) }} />
  }
  const orgName = me?.org.name ?? 'LARIS'
  if (me && lic && blocked(lic) && !roOk) {
    // Enforced and unusable: activation instead of the app (the purchase page is the one other screen).
    if (route === 'purchase') return <OrgCtx value={orgName}><Frame org={orgName} dark={dark} setDark={setDark} wide><PurchaseView owner={owner} backHref="#/licence" /></Frame></OrgCtx>
    return <LicenceGate lic={lic} owner={owner} org={orgName} dark={dark} setDark={setDark} reload={() => setLicTries(t => t + 1)} onReadOnly={() => setRoOk(true)} />
  }
  const entry = PAGES[route]
  return (
    <LicenseProvider value={{ lic, readOnly: !!lic?.enforced && lic.read_only, reload: () => setLicTries(t => t + 1) }}>
    <OrgCtx value={orgName}>
      <Shell me={me} hash={hash} route={route} dark={dark} setDark={setDark} owner={owner} role={role} onRole={onRole} banner={<><OfflineBanner /><LicenceBanner lic={lic} owner={owner} /><HealthBanner owner={owner && !!me} hash={hash} /></>}>
        {meErr ? (
          <div role="alert" className="card border-warn bg-warn-bg text-warn">
            <p>Could not identify the signed-in user: {meErr}</p>
            <button className="btn mt-3" onClick={() => setTries(t => t + 1)}>Retry identifying user</button>
          </div>
        ) : !me || !lic ? <Skeleton rows={4} /> : (
          <div key={route + (route === 'doc' || route === 'contact' ? arg : '')} className="page-in">
            {!canOpen(route, owner) ? <>
              <PageHeader title={entry?.title ?? 'Page'} />
              <p role="alert" className="card text-muted">You do not have access to this page. Ask the owner to change your role if you need it.</p>
            </> : (
              <ErrorBoundary level="page">
                {MOCK && route === 'contacts' && new URLSearchParams(location.search).get('crash') === '1' && <MockCrash />}
                {entry ? entry.render({ me, owner, arg }) : <NotFound />}
              </ErrorBoundary>
            )}
          </div>
        )}
      </Shell>
      {me && <TourHost me={me} owner={owner} />}
      {!MOCK && getAccount() && <IdleGuard />}
    </OrgCtx>
    </LicenseProvider>
  )
}

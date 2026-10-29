import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, MOCK, can, needs, why } from './api'
import { FilterBar, FilterSelect } from './kit'
import { rm, label, useFetch, useAction, ActionError, Async, EmptyState, PageHeader, Status } from './ui'
import { useWriteGate } from './Licence'
import type { Tracker, DocDetail, DocSummary, Line } from './api'

// ---------- Tracker ----------
function DocCard({ d, owner }: { d: DocSummary; owner: boolean }) {
  return (
    <li>
      <a className="row group" href={`#/doc/${d.id}`}>
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-semibold text-ink group-hover:underline">{d.doc_no ?? 'No document number'}</span>
          <span className="num text-sm">{d.total ? rm(d.total) : ''}</span>
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
export function TrackerView({ owner, arg }: { owner: boolean; arg?: string }) {
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
      <h2 id={title} className="border-b border-hairline pb-2 text-md font-semibold">{title} <span className="text-sm font-normal text-muted">({l.length}) {hint}</span></h2>
      {extra}
      {l.length ? <ul className="mt-3 divide-y divide-hairline rounded-card border border-hairline bg-surface">{l.map(d => <DocCard key={d.id} d={d} owner={owner} />)}</ul>
        : <div className="mt-3">{filter ? <p className="py-3 text-muted">No documents {filterName}. <button type="button" className="link" onClick={() => setFilter('')}>Show all</button></p> : <EmptyState {...empty} />}</div>}
    </section>
  )
  return (
    <>
      <PageHeader title="Quote tracker" description="Supplier quotes you received and customer quotes you sent, in one place."
        actions={can('upload_documents') && <button type="button" className="btn btn-primary" {...gate(() => openForm('quote-file'))}>Upload quote</button>} />
      <FilterBar label="Tracker filter" chips={filter ? [{ label: `Showing: ${filterName}`, onRemove: () => setFilter('') }] : []} onClear={() => setFilter('')}>
        <FilterSelect label="Filter" value={filter} onChange={setFilter}>
          <option value="">All documents</option>
          <option value="review">Needs review</option>
          <option value="open">Open customer quotes</option>
          {statuses.map(x => <option key={x} value={x}>Status: {label(x)}</option>)}
        </FilterSelect>
      </FilterBar>
      <p role="status" className="sr-only">{s.data ? `Showing ${shown} ${shown === 1 ? 'document' : 'documents'}` : ''}</p>
      <Async s={s} rows={4}>
        <div className="grid gap-6 md:grid-cols-2">
          {lane('Received', 'Supplier quotes', pick(s.data?.received ?? []), can('upload_documents') ? <><UploadQuote onDone={s.reload} open={up} onToggle={setUp} />{!MOCK && <ManualQuote onDone={s.reload} />}</> : null,
            { title: 'No supplier quotes yet.', hint: 'Upload a PDF, a photo or pasted text and LARIS reads the prices for you.', action: can('upload_documents') ? { label: 'Upload a supplier quote', onClick: () => openForm('quote-file') } : undefined })}
          {lane('Sent', 'Customer quotes', pick(s.data?.sent ?? []), <SimulateEnquiry open={sim} onToggle={setSim} />,
            { title: 'No customer quotes yet.', hint: 'A quote appears here when a customer asks for a price.', action: { label: 'Try a sample enquiry', onClick: () => openForm('enquiry-text') } })}
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
          <button type="submit" className="btn" aria-disabled={a.busy || undefined}>{a.busy ? 'Saving...' : 'Add to tracker'}</button>
        </div>
      </form>
      <ActionError err={a.err} onRetry={submit} label="Retry saving" />
      {added && <p role="status" className="mt-2 text-sm">Added {added.doc_no ?? 'supplier quote'}. <a className="link" href={`#/doc/${added.id}`}>Open it to review the lines</a></p>}
    </details>
  )
}

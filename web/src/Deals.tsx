import { useState } from 'react'
import { api } from './api'
import { Async, PageHeader, Status, msg, rm, useFetch } from './ui'
import { DataTable, StatStrip, StatTile, Tabs } from './kit'
import type { Col } from './kit'
import { useToast } from './Toast'
import { BuyLane } from './BuyLane'
import { docName, PACKS, say, useSector } from './sectorPacks'
import type { DocKind, SectorPack } from './sectorPacks'

// Deals: the quote-to-cash chain (customer PO, order, proforma, delivery order, invoice, receipt, supplier PO) in the words of the chosen sector.
// Preparation only. Payments are recorded, never taken; nothing here is filed with an authority or sent to a customer.
// The server enforces every rule (src/chain.py); the buttons below only offer what the rules allow. Demo / synthetic data only.
interface Ln { description: string; qty: string; uom: string; unit_price: string }
interface CDoc {
  id: string; kind: DocKind; doc_no: string; status: string; status_effective: string; deal_id: string; parent_id: string | null; party?: string | null; ref: string | null
  lines: Ln[]; subtotal: string; discount: string; sst: string; rounding: string; total: string; paid: string; balance: string | null; deposit_pct: string | null
  due_on: string | null; days_overdue: number; ageing: string | null; note: string | null; created_at: string
}
interface Detail extends CDoc { trail: CDoc[]; history: { at: string; event: string; actor: string }[] }
interface Recv { as_of: string; total: string; buckets: Record<string, { count: number; outstanding: string }> }

const ORDER: DocKind[] = ['cpo', 'so', 'pf', 'do', 'inv', 'rcp']
const label = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
// What can be made from a document, and the moves a person can ask for by hand (the server has the final say).
const MAKE: Partial<Record<DocKind, DocKind[]>> = { cpo: ['so'], so: ['pf', 'do', 'inv'], do: ['inv'] }
const MOVES: Record<string, Record<string, string[]>> = {
  cpo: { received: ['confirmed', 'cancelled'], confirmed: ['cancelled'] }, so: { confirmed: ['cancelled'], in_fulfilment: ['cancelled'] },
  pf: { draft: ['sent', 'cancelled'], sent: ['cancelled'] }, do: { prepared: ['dispatched'], dispatched: ['delivered', 'returned'], delivered: ['returned'] },
  inv: { draft: ['pending_approval', 'void'], pending_approval: ['issued', 'draft', 'void'], issued: ['void'], partially_paid: ['void'] },
  rcp: { issued: ['void'] }, spo: { draft: ['pending_approval', 'cancelled'], pending_approval: ['sent', 'draft', 'cancelled'], sent: ['partially_received', 'received', 'cancelled'], partially_received: ['received', 'cancelled'] },
}
const OWNER_MOVES = ['inv:issued', 'spo:sent', 'rcp:void', 'inv:void', 'so:cancelled', 'cpo:confirmed']
const NEEDS_REASON = ['void', 'cancelled', 'returned']

export function DealsView({ owner, arg }: { owner: boolean; arg?: string }) {
  const [pack, setPack] = useSector()
  const [kind, setKind] = useState<'all' | DocKind>('all')
  const [adding, setAdding] = useState(false)
  const list = useFetch<CDoc[]>('/chain')
  const recv = useFetch<Recv>('/chain/receivables')
  const rows = (list.data ?? []).filter(d => pack.docs.includes(d.kind) && (kind === 'all' || d.kind === kind))
  const all = (list.data ?? []).filter(d => pack.docs.includes(d.kind))
  const count = (f: (d: CDoc) => boolean) => all.filter(f).length
  const kpi: Record<string, number | string> = {
    open: count(d => d.kind === 'so' && ['confirmed', 'in_fulfilment'].includes(d.status)), deposits: count(d => d.kind === 'pf' && d.status === 'sent'),
    approval: count(d => d.status === 'pending_approval'), owed: rm(recv.data?.total ?? '0'),
  }
  const cols: Col<CDoc>[] = [
    { key: 'no', head: 'Document', mobile: 'title', cell: d => <a href={`#/deals/${d.id}`}>{d.doc_no}</a> },
    { key: 'type', head: 'Type', mobile: 'sub', cell: d => docName(pack, d.kind) },
    { key: 'who', head: say(pack.terms.customer), mobile: 'meta', cell: d => d.party ?? '' },
    { key: 'st', head: 'Status', mobile: 'badge', cell: d => <Status v={d.status_effective} /> },
    { key: 'total', head: 'Total', num: true, mobile: 'meta', cell: d => rm(d.total) },
  ]
  if (arg) return <DealDetail id={arg} pack={pack} owner={owner} onChanged={() => { list.reload(); recv.reload() }} />
  return (
    <>
      <PageHeader title="Deals" description={say(pack.tagline)} actions={<button className="btn btn-primary" onClick={() => setAdding(a => !a)}>{adding ? 'Close' : `New: ${say(pack.quickActions[0].label)}`}</button>} />
      <DemoSwitch pack={pack} onPick={setPack} />
      {adding && <NewDoc pack={pack} onDone={() => { setAdding(false); list.reload(); recv.reload() }} />}
      <div data-guide="deals-kpi"><StatStrip label="Deals at a glance">
        {pack.kpis.map(k => <StatTile key={k.id} title={say(k.label)} value={kpi[k.id]} warn={k.id === 'approval' && Number(kpi.approval) > 0} />)}
      </StatStrip></div>
      <Workflow pack={pack} />
      <div data-guide="deals-docs">
      <h2 className="mt-6 mb-2 text-lg font-semibold">Documents</h2>
      <Tabs label="Filter by document type" value={kind} onChange={v => setKind(v as 'all' | DocKind)}
        options={[{ value: 'all', label: 'All', count: all.length }, ...pack.docs.map(k => ({ value: k, label: docName(pack, k), count: all.filter(d => d.kind === k).length }))]} />
      <Async s={list} empty={rows.length === 0} emptyText="No documents yet" emptyHint={`Start with ${say(pack.quickActions[0].label).toLowerCase()}. Each next document is one click and copies the last.`}>
        <DataTable label="Documents" caption="Quote-to-cash documents" rows={rows} rowKey={d => d.id} cols={cols} />
      </Async>
      </div>
      <Ageing data={recv.data} />
      <p className="mt-6 text-sm text-muted">Demo / synthetic data. Preparation only: LARIS records payments, it never takes money, files an e-invoice or sends a document by itself.</p>
    </>
  )
}

function DemoSwitch({ pack, onPick }: { pack: SectorPack; onPick: (id: string) => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 glass-lite p-3" data-guide="deals-sector">
      <span aria-hidden="true" className="size-3 rounded-full" style={{ background: pack.accent }} />
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Demo mode: business type</span>
        <select className="input" value={pack.id} onChange={e => onPick(e.target.value)}>{PACKS.map(p => <option key={p.id} value={p.id}>{say(p.name)}</option>)}</select>
      </label>
      <span className="text-sm text-muted">Words, documents and defaults change with the sector. Your data stays the same.</span>
    </div>
  )
}

function Workflow({ pack }: { pack: SectorPack }) {
  const steps: [string, string][] = [['Trigger', say(pack.workflow.trigger)], ['Connected data', say(pack.workflow.data)], ['Decision logic', say(pack.workflow.rules)],
    ['Human approval', say(pack.workflow.approval)], ['Visible outcome', say(pack.workflow.outcome)]]
  return (
    <details className="mt-4 glass-lite p-3" data-guide="deals-workflow">
      <summary className="cursor-pointer font-semibold">How a {say(pack.terms.order).toLowerCase()} flows here</summary>
      <ol className="mt-2 grid gap-2 md:grid-cols-5">
        {steps.map(([h, t], i) => <li key={h} className="rounded-card border border-hairline p-2 text-sm"><span className="text-muted">{i + 1}. {h}</span><span className="block">{t}</span></li>)}
      </ol>
      <p className="mt-2 text-sm text-muted">Prices come from rules. AI only reads messages and drafts replies; a person approves.</p>
    </details>
  )
}

function Ageing({ data }: { data?: Recv }) {
  if (!data) return null
  return (
    <section aria-label="Receivables ageing" className="mt-6" data-guide="deals-ageing">
      <h2 className="mb-2 text-lg font-semibold">Who still owes you</h2>
      <StatStrip label="Receivables ageing">
        {Object.entries(data.buckets).map(([k, b]) => <StatTile key={k} title={k === 'current' ? 'Not yet due' : `${k} days late`} value={rm(b.outstanding)} hint={`${b.count} invoice${b.count === 1 ? '' : 's'}`} warn={k !== 'current' && b.count > 0} />)}
      </StatStrip>
      <p className="mt-1 text-sm text-muted">Reminder messages are drafts for you to send. LARIS sends nothing by itself.</p>
    </section>
  )
}

function NewDoc({ pack, onDone }: { pack: SectorPack; onDone: () => void }) {
  const toast = useToast()
  const [kind, setKind] = useState<'cpo' | 'so' | 'spo'>((pack.quickActions[0].to as 'so') ?? 'so')
  const role = kind === 'spo' ? 'supplier' : 'customer'
  const people = useFetch<{ id: string; name: string }[]>(`/contacts?role=${role}`)
  const [who, setWho] = useState('')
  const [ref, setRef] = useState('')
  const [lines, setLines] = useState(() => pack.sampleLines.map(l => ({ ...l })))
  const [busy, setBusy] = useState(false)
  const upd = (i: number, k: 'description' | 'qty' | 'unit_price', v: string) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, [k]: k === 'description' ? v : Number(v) } : l)))
  const kinds = (['so', 'cpo', 'spo'] as const).filter(k => pack.docs.includes(k))
  const sum = lines.reduce((a, l) => a + l.qty * l.unit_price, 0)
  const save = async () => {
    setBusy(true)
    try { const d = await api<CDoc>('POST', '/chain', { kind, customer_id: who || people.data?.[0]?.id, ref: ref.trim() || undefined, lines: lines.filter(l => l.description.trim() && l.qty > 0) }); toast(`${docName(pack, kind)} ${d.doc_no} created`); onDone() }
    catch (e) { toast(msg(e)) } finally { setBusy(false) }
  }
  return (
    <form className="card mb-4 grid gap-3" onSubmit={e => { e.preventDefault(); void save() }} aria-label="New document">
      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1 text-sm"><span>Document</span>
          <select className="input" value={kind} onChange={e => setKind(e.target.value as 'so')}>{kinds.map(k => <option key={k} value={k}>{docName(pack, k)}</option>)}</select></label>
        <label className="grid gap-1 text-sm"><span>{kind === 'spo' ? 'Supplier' : say(pack.terms.customer)}</span>
          <select className="input" value={who} onChange={e => setWho(e.target.value)}>{(people.data ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {kind === 'cpo' && <label className="grid gap-1 text-sm"><span>Their PO number</span><input className="input" value={ref} maxLength={80} onChange={e => setRef(e.target.value)} /></label>}
      </div>
      <div className="grid gap-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_5rem_6rem] gap-2">
            <input className="input" aria-label={`Line ${i + 1} description`} value={l.description} onChange={e => upd(i, 'description', e.target.value)} />
            <input className="input" aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.qty} onChange={e => upd(i, 'qty', e.target.value)} />
            <input className="input" aria-label={`Line ${i + 1} unit price`} inputMode="decimal" value={l.unit_price} onChange={e => upd(i, 'unit_price', e.target.value)} />
          </div>
        ))}
        <button type="button" className="btn btn-sm justify-self-start" onClick={() => setLines(ls => [...ls, { description: '', qty: 1, uom: 'unit', unit_price: 0 }])}>Add a line</button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="tabular-nums">Total before tax: {rm(String(sum))}</span>
        <button className="btn btn-primary" disabled={busy || !people.data?.length}>{busy ? 'Saving' : 'Save'}</button>
      </div>
    </form>
  )
}

// The pipeline strip: one step per document type. Filled = exists in this deal; the current one is marked.
function Pipeline({ trail, current, pack }: { trail: CDoc[]; current: string; pack: SectorPack }) {
  const steps = ORDER.filter(k => pack.docs.includes(k) || trail.some(d => d.kind === k))
  return (
    <nav aria-label="Document trail" className="mb-4 overflow-x-auto" data-guide="deals-pipeline">
      <ol className="flex min-w-max items-center gap-1">
        {steps.map((k, i) => {
          const docs = trail.filter(d => d.kind === k)
          const first = docs[0]
          return (
            <li key={k} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden="true" className="text-muted">&rarr;</span>}
              {first ? <a href={`#/deals/${first.id}`} aria-current={docs.some(d => d.id === current) ? 'step' : undefined}
                className={`chip ${docs.some(d => d.id === current) ? 'chip-accepted' : 'chip-approved'}`}>{docName(pack, k)}{docs.length > 1 ? ` x${docs.length}` : ''}</a>
                : <span className="chip chip-draft">{docName(pack, k)}</span>}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function DealDetail({ id, pack, owner, onChanged }: { id: string; pack: SectorPack; owner: boolean; onChanged: () => void }) {
  const s = useFetch<Detail>(`/chain/${id}`)
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [deposit, setDeposit] = useState(String(pack.defaults.depositPct))
  const [pay, setPay] = useState('')
  const d = s.data
  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    try { toast(await fn()); s.reload(); onChanged() } catch (e) { toast(msg(e)) } finally { setBusy(false) }
  }
  const [asking, setAsking] = useState<string>()
  const [reason, setReason] = useState('')
  const move = (to: string, why?: string) => {
    void run(async () => { const r = await api<CDoc>('POST', `/chain/${id}/transition`, { to, reason: why }); setAsking(undefined); setReason(''); return `${r.doc_no} is now ${label(r.status)}` })
  }
  const make = (to: DocKind) => run(async () => {
    const r = await api<CDoc>('POST', `/chain/${id}/convert`, { to, deposit_pct: to === 'pf' ? Number(deposit) : undefined, due_in_days: pack.defaults.creditDays })
    location.hash = `#/deals/${r.id}`
    return `${docName(pack, to)} ${r.doc_no} made from ${d?.doc_no}`
  })
  const payable = !!d && ((d.kind === 'inv' && ['issued', 'partially_paid'].includes(d.status)) || (d.kind === 'pf' && d.status === 'sent'))
  return (
    <>
      <PageHeader title={d ? `${docName(pack, d.kind)} ${d.doc_no}` : 'Deal'} back={{ href: '#/deals', label: 'Deals' }} />
      <Async s={s} empty={!d}>
        {d && <>
          <Pipeline trail={d.trail} current={d.id} pack={pack} />
          <BuyLane trail={d.trail} owner={owner} onChanged={() => { s.reload(); onChanged() }} />
          <section className="card mb-4 grid gap-1">
            <p className="flex flex-wrap items-center gap-2"><Status v={d.status_effective} />{d.days_overdue > 0 && <span className="text-sm text-warn">{d.days_overdue} days late</span>}
              {d.ref && <span className="text-sm text-muted">Their PO: {d.ref}</span>}{d.due_on && <span className="text-sm text-muted">Due {d.due_on}</span>}</p>
            <DataTable label="Lines" caption="Document lines" rows={d.lines} rowKey={(l) => l.description + l.qty} cols={[
              { key: 'd', head: 'Item', mobile: 'title', cell: l => l.description }, { key: 'q', head: 'Qty', num: true, mobile: 'meta', cell: l => `${l.qty} ${l.uom}` },
              { key: 'p', head: 'Unit price', num: true, mobile: 'meta', cell: l => rm(l.unit_price) }, { key: 't', head: 'Amount', num: true, mobile: 'badge', cell: l => rm(String(Number(l.qty) * Number(l.unit_price))) }]} />
            <p className="text-right text-lg font-semibold tabular-nums">Total {rm(d.total)}</p>
            {d.balance != null && <p className="text-right tabular-nums text-muted">Paid {rm(d.paid)} &middot; Balance {rm(d.balance)}</p>}
          </section>
          <section aria-label="Next steps" className="card mb-4 grid gap-3" data-guide="deals-actions">
            <h2 className="text-lg font-semibold">Next step</h2>
            <div className="flex flex-wrap items-end gap-2">
              {(MAKE[d.kind] ?? []).filter(k => pack.docs.includes(k)).map(k => (
                <span key={k} className="flex items-end gap-2">
                  {k === 'pf' && <label className="grid gap-1 text-sm"><span>Deposit %</span><input className="input w-20" inputMode="decimal" value={deposit} onChange={e => setDeposit(e.target.value)} /></label>}
                  <button className="btn btn-primary" disabled={busy} onClick={() => void make(k)}>Make {docName(pack, k)}</button>
                </span>
              ))}
              {payable && <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); void run(async () => { const r = await api<{ receipt: CDoc }>('POST', `/chain/${id}/payment`, { amount: Number(pay) }); setPay(''); return `Payment recorded, receipt ${r.receipt.doc_no}` }) }}>
                <label className="grid gap-1 text-sm"><span>Payment received (RM)</span><input className="input w-32" inputMode="decimal" value={pay} onChange={e => setPay(e.target.value)} /></label>
                <button className="btn btn-primary" disabled={busy || !Number(pay)}>Record payment</button></form>}
              {Object.keys(MOVES[d.kind] ?? {}).length > 0 && (MOVES[d.kind][d.status] ?? []).map(to => {
                const locked = OWNER_MOVES.includes(`${d.kind}:${to}`) && !owner
                return <button key={to} className={`btn ${NEEDS_REASON.includes(to) ? 'btn-danger' : ''}`} disabled={busy} aria-disabled={locked || undefined} data-locked={locked || undefined}
                  title={locked ? 'Needs the owner to approve' : undefined} onClick={() => (locked ? toast('Needs the owner to approve this step') : NEEDS_REASON.includes(to) ? setAsking(to) : move(to))}>{locked ? '\u{1F512} ' : ''}{label(to)}</button>
              })}
            </div>
            {asking && <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); if (reason.trim()) move(asking, reason.trim()) }}>
              <label className="grid gap-1 text-sm"><span>Reason to {asking}</span><input className="input" autoFocus maxLength={300} value={reason} onChange={e => setReason(e.target.value)} /></label>
              <button className="btn btn-danger" disabled={busy || !reason.trim()}>Confirm {asking}</button>
              <button type="button" className="btn btn-quiet" onClick={() => setAsking(undefined)}>Cancel</button></form>}
            {d.kind === 'inv' && <p className="text-sm text-muted">E-invoice: preparation only. Buyer TIN, MSIC and classification fields are roadmap; LARIS never submits to MyInvois.</p>}
          </section>
          <section aria-label="This record's history" className="card">
            <h2 className="mb-2 text-lg font-semibold">History</h2>
            <ul className="grid gap-1 text-sm">{d.history.map((h, i) => <li key={i}><span className="text-muted">{new Date(h.at).toLocaleString()}</span> {h.event}</li>)}</ul>
          </section>
        </>}
      </Async>
    </>
  )
}

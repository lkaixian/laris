import { useEffect, useState } from 'react'
import { api } from './api'
import { OrderPage } from './Order'
import { t, useLang } from './i18n'
import type { Text } from './i18n'
import { Async, PageHeader, Status, msg, rm, useFetch } from './ui'
import { DataTable } from './kit'

import { useToast } from './Toast'
import { BuyLane } from './BuyLane'
import { docName, say, useSector } from './sectorPacks'
import type { DocKind, SectorPack } from './sectorPacks'

// Deals: orders (the money and paper of an order are on its own page, Order.tsx) plus the customer PO, sales order and supplier PO in the words of the chosen sector.
// Preparation only. Payments are recorded, never taken; nothing here is filed with an authority or sent to a customer.
// The server enforces every rule (src/chain.py); the buttons below only offer what the rules allow. Demo / synthetic data only.
// #/deals/<job id> is an order; #/deals/d:<id> is one customer PO, sales order or supplier PO.
interface Ln { description: string; qty: string; uom: string; unit_price: string }
interface CDoc {
  id: string; kind: DocKind; doc_no: string; status: string; deal_id: string; parent_id: string | null; job_id: string | null; party?: string | null; ref: string | null
  lines: Ln[]; subtotal: string; discount: string; sst: string; rounding: string; total: string; note: string | null; created_at: string
}
interface Detail extends CDoc { trail: CDoc[]; history: { at: string; event: string; actor: string }[] }

const ORDER: DocKind[] = ['cpo', 'so', 'spo']
const D = {
  orders: { en: 'Orders', ms: 'Pesanan', zh: '订单', ta: 'ஆர்டர்கள்' },
  ordersHint: { en: 'Each order has its own page: proforma, deposit, delivery, invoice and receipts.', ms: 'Setiap pesanan ada halamannya: proforma, deposit, penghantaran, invois dan resit.', zh: '每个订单都有自己的页面：形式发票、订金、送货、发票和收据。', ta: 'ஒவ்வொரு ஆர்டருக்கும் தனிப் பக்கம் உண்டு: புரோஃபார்மா, முன்பணம், டெலிவரி, இன்வாய்ஸ், ரசீதுகள்.' },
  noOrders: { en: 'No orders yet', ms: 'Belum ada pesanan', zh: '还没有订单', ta: 'இன்னும் ஆர்டர்கள் இல்லை' },
  order: { en: 'Order', ms: 'Pesanan', zh: '订单', ta: 'ஆர்டர்' }, who: { en: 'Customer', ms: 'Pelanggan', zh: '客户', ta: 'வாடிக்கையாளர்' },
  st: { en: 'Status', ms: 'Status', zh: '状态', ta: 'நிலை' }, total: { en: 'Total', ms: 'Jumlah', zh: '总计', ta: 'மொத்தம்' },
  open: { en: 'Open the order (money, delivery, invoice)', ms: 'Buka pesanan (wang, penghantaran, invois)', zh: '打开订单（收款、送货、发票）', ta: 'ஆர்டரைத் திற (பணம், டெலிவரி, இன்வாய்ஸ்)' },
} satisfies Record<string, Text>
const label = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
// What can be made from a document, and the moves a person can ask for by hand (the server has the final say).
const MAKE: Partial<Record<DocKind, DocKind[]>> = { cpo: ['so'] }
const MOVES: Record<string, Record<string, string[]>> = {
  cpo: { received: ['confirmed', 'cancelled'], confirmed: ['cancelled'] }, so: { confirmed: ['cancelled'] },
  spo: { draft: ['pending_approval', 'cancelled'], pending_approval: ['sent', 'draft', 'cancelled'], sent: ['cancelled'], partially_received: ['cancelled'] },  // goods arriving is recorded with "Goods arrived?" (POST /chain/{id}/receive), not moved by hand
}
const OWNER_MOVES = ['spo:sent', 'so:cancelled', 'cpo:confirmed']
const NEEDS_REASON = ['void', 'cancelled', 'returned']

export function DealsView({ owner, arg }: { owner: boolean; arg?: string }) {
  useLang()
  const [pack] = useSector()
  useEffect(() => { if (!arg) location.replace('#/customers') }, [arg])  // the old Deals list lives on as Customers
  if (arg?.startsWith('d:')) return <DealDetail id={arg.slice(2)} pack={pack} owner={owner} onChanged={() => undefined} />
  if (arg) return <OrderPage id={arg} owner={owner} />
  return null
}

const B = {
  title: { en: 'Supplier orders', ms: 'Pesanan pembekal', zh: '供应商订单', ta: 'சப்ளையர் ஆர்டர்கள்' },
  desc: { en: 'What you ordered from suppliers, and what has arrived.', ms: 'Apa yang anda pesan daripada pembekal, dan apa yang telah tiba.', zh: '你向供应商订的货，以及已到的货。', ta: 'சப்ளையர்களிடம் நீங்கள் ஆர்டர் செய்தவை, வந்தவை.' },
  none: { en: 'No supplier orders yet', ms: 'Belum ada pesanan pembekal', zh: '还没有供应商订单', ta: 'இன்னும் சப்ளையர் ஆர்டர்கள் இல்லை' },
  add: { en: 'New supplier order', ms: 'Pesanan pembekal baharu', zh: '新建供应商订单', ta: 'புதிய சப்ளையர் ஆர்டர்' }, close: { en: 'Close', ms: 'Tutup', zh: '关闭', ta: 'மூடு' },
} satisfies Record<string, Text>

// Supplier POs (and the goods received against them). Customer documents are on the Customers page.
export function BuyingView() {
  useLang()
  const [pack] = useSector()
  const [adding, setAdding] = useState(false)
  const list = useFetch<CDoc[]>('/chain?kind=spo')
  const rows = list.data ?? []
  return (
    <>
      <PageHeader title={t(B.title)} description={t(B.desc)} actions={<button className="btn btn-primary" onClick={() => setAdding(a => !a)}>{adding ? t(B.close) : t(B.add)}</button>} />
      {adding && <NewDoc pack={pack} only={['spo']} onDone={() => { setAdding(false); list.reload() }} />}
      <Async s={list} empty={rows.length === 0} emptyText={t(B.none)}>
        <DataTable label={t(B.title)} caption={t(B.title)} rows={rows} rowKey={d => d.id} cols={[
          { key: 'no', head: 'Document', mobile: 'title', cell: d => <a href={`#/deals/d:${d.id}`}>{d.doc_no}</a> },
          { key: 'who', head: 'Supplier', mobile: 'sub', cell: d => d.party ?? '' },
          { key: 'st', head: 'Status', mobile: 'badge', cell: d => <Status v={d.status} /> },
          { key: 'total', head: 'Total', num: true, mobile: 'meta', cell: d => rm(d.total) }]} />
      </Async>
    </>
  )
}

export function NewDoc({ pack, only, onDone }: { pack: SectorPack; only?: ('cpo' | 'so' | 'spo')[]; onDone: () => void }) {
  const toast = useToast()
  const [kind, setKind] = useState<'cpo' | 'so' | 'spo'>(only?.[0] ?? (pack.quickActions[0].to as 'so') ?? 'so')
  const role = kind === 'spo' ? 'supplier' : 'customer'
  const people = useFetch<{ id: string; name: string }[]>(`/contacts?role=${role}`)
  const [who, setWho] = useState('')
  const [ref, setRef] = useState('')
  const [lines, setLines] = useState(() => pack.sampleLines.map(l => ({ ...l })))
  const [busy, setBusy] = useState(false)
  const upd = (i: number, k: 'description' | 'qty' | 'unit_price', v: string) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, [k]: k === 'description' ? v : Number(v) } : l)))
  const kinds = only ?? (['so', 'cpo', 'spo'] as const).filter(k => pack.docs.includes(k))
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
              {first ? <a href={`#/deals/d:${first.id}`} aria-current={docs.some(d => d.id === current) ? 'step' : undefined}
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
    const r = await api<CDoc>('POST', `/chain/${id}/convert`, { to })
    location.hash = `#/deals/d:${r.id}`
    return `${docName(pack, to)} ${r.doc_no} made from ${d?.doc_no}`
  })
  return (
    <>
      <PageHeader title={d ? `${docName(pack, d.kind)} ${d.doc_no}` : 'Deal'} back={d?.kind === 'spo' ? { href: '#/buying', label: t(B.title) } : { href: '#/customers', label: 'Customers' }} />
      <Async s={s} empty={!d}>
        {d && <>
          <Pipeline trail={d.trail} current={d.id} pack={pack} />
          <BuyLane trail={d.trail} owner={owner} onChanged={() => { s.reload(); onChanged() }} />
          <section className="card mb-4 grid gap-1">
            <p className="flex flex-wrap items-center gap-2"><Status v={d.status} />
              {d.ref && <span className="text-sm text-muted">Their PO: {d.ref}</span>}{d.job_id && <a className="link text-sm" href={`#/deals/${d.job_id}`}>{t(D.open)}</a>}</p>
            <DataTable label="Lines" caption="Document lines" rows={d.lines} rowKey={(l) => l.description + l.qty} cols={[
              { key: 'd', head: 'Item', mobile: 'title', cell: l => l.description }, { key: 'q', head: 'Qty', num: true, mobile: 'meta', cell: l => `${l.qty} ${l.uom}` },
              { key: 'p', head: 'Unit price', num: true, mobile: 'meta', cell: l => rm(l.unit_price) }, { key: 't', head: 'Amount', num: true, mobile: 'badge', cell: l => rm(String(Number(l.qty) * Number(l.unit_price))) }]} />
            <p className="text-right text-lg font-semibold tabular-nums">Total {rm(d.total)}</p>
          </section>
          <section aria-label="Next steps" className="card mb-4 grid gap-3" data-guide="deals-actions">
            <h2 className="text-lg font-semibold">Next step</h2>
            <div className="flex flex-wrap items-end gap-2">
              {(MAKE[d.kind] ?? []).filter(k => pack.docs.includes(k)).map(k => (
                <span key={k} className="flex items-end gap-2">
                  <button className="btn btn-primary" disabled={busy} onClick={() => void make(k)}>Make {docName(pack, k)}</button>
                </span>
              ))}
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

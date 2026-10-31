// SAMPLE data only (mock mode). Two small in-memory copies of the server:
//  1. /chain: customer PO, sales order and supplier PO (src/chain.py, src/api/deals.py), each linked to an order (job_id).
//  2. The order chain on a job: proforma, payments, delivery orders, invoice, receipts, PDFs and the public delivery page
//     (src/api/chain.py, src/api/delivery.py). Rules are tested against the real API in tests/test_chain*.py, not here.
// Switches: ?delivery=ok (default) | signed | expired | error for the public delivery page.
import { ApiError } from './api'

type Ln = { description: string; qty: string; uom: string; unit_price: string; src?: number }
interface D { id: string; kind: string; doc_no: string; status: string; deal_id: string; parent_id: string | null; job_id: string | null; party: string; party_id: string; ref: string | null; lines: Ln[]
  total: string; created_at: string; note: string | null }
const DAY = 864e5
const iso = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10)
const PFX: Record<string, string> = { cpo: 'CPO', so: 'SO', spo: 'SPO', grn: 'GRN' }
const NAMES: Record<string, string> = { cpo: 'Customer PO (received)', so: 'Sales Order', spo: 'Supplier PO (sent)', grn: 'Goods Received' }
const NEXT: Record<string, Record<string, string[]>> = {
  cpo: { received: ['confirmed', 'cancelled'], confirmed: ['cancelled'] }, so: { confirmed: ['cancelled'] },
  spo: { draft: ['pending_approval', 'cancelled'], pending_approval: ['sent', 'draft', 'cancelled'], sent: ['partially_received', 'received', 'cancelled'], partially_received: ['received', 'cancelled'] } }
const OWNER = ['spo:sent', 'so:cancelled', 'cpo:confirmed']
const START: Record<string, string> = { cpo: 'received', so: 'confirmed', spo: 'draft', grn: 'received' }
const sum = (ls: Ln[]) => ls.reduce((a, l) => a + Math.round(Number(l.qty) * Number(l.unit_price) * 100), 0) / 100
const m2 = (n: number) => n.toFixed(2)
const cents = (s: string | number) => Math.round(Number(s) * 100)

let seq: Record<string, number> = {}
const docs: D[] = []
function add(kind: string, deal: string, parent: D | null, party: string, ls: Ln[], over: Partial<D> = {}): D {
  const n = (seq[kind] = (seq[kind] ?? 0) + 1), y = new Date().getFullYear()
  const d: D = { id: `ch-${kind}-${n}`, kind, doc_no: `${PFX[kind]}-${y}-${String(n).padStart(4, '0')}`, status: START[kind], deal_id: deal, parent_id: parent?.id ?? null, job_id: parent?.job_id ?? null, party, party_id: 'p-' + party,
    ref: parent?.ref ?? null, lines: ls, total: m2(sum(ls)), created_at: new Date(Date.now() - (30 - docs.length) * 36e5).toISOString(), note: null, ...over }
  docs.push(d)
  return d
}
function seed() {
  if (docs.length) return
  const so = add('so', 'deal-1', null, 'SAMPLE Sri Murni Events', [{ description: 'Nasi minyak set (per pax)', qty: '120', uom: 'pax', unit_price: '18.00' }, { description: 'Setup and serving crew', qty: '1', uom: 'event', unit_price: '350.00' }], { job_id: 'job-1' })
  add('spo', 'deal-1', so, 'SAMPLE Pasar Borong', [{ description: 'Chicken and rice, bulk (per pax)', qty: '120', uom: 'pax', unit_price: '9.50' }, { description: 'Disposable packaging', qty: '120', uom: 'pax', unit_price: '0.80' }], { status: 'sent' })
  add('so', 'deal-2', null, 'SAMPLE Warung Ali', [{ description: 'Sample item', qty: '10', uom: 'pcs', unit_price: '25.00' }], { job_id: 'job-2' })
  add('cpo', 'deal-3', null, 'SAMPLE Kopi Corner', [{ description: 'Coffee beans 1 kg', qty: '12', uom: 'bag', unit_price: '48.00' }], { ref: 'KC-PO-2291', job_id: 'job-3' })
  add('spo', 'deal-4', null, 'SAMPLE Pasar Borong', [{ description: 'Chicken 1 kg', qty: '40', uom: 'kg', unit_price: '9.80' }], { status: 'pending_approval' })
}
const receivingOf = (spo: D) => spo.lines.map((l, i) => {
  const got = docs.filter(x => x.kind === 'grn' && x.parent_id === spo.id).reduce((a, g) => a + g.lines.filter(x => x.src === i + 1).reduce((b, x) => b + Number(x.qty), 0), 0)
  return { no: i + 1, description: l.description, uom: l.uom, ordered: String(Number(l.qty)), received: String(got), left: String(Math.max(Number(l.qty) - got, 0)) }
})
const shape = (d: D) => ({ ...d, kind_label: NAMES[d.kind], discount_pct: '0.00', sst_rate: '0.00', round5: false, subtotal: d.total, discount: '0.00', sst: '0.00', rounding: '0.00', quote_id: null, void_reason: null })

// ---- the order chain on a job
interface OD { id: string; kind: 'proforma' | 'delivery_order' | 'invoice' | 'receipt' | 'credit_note'; doc_no: string; status: 'issued' | 'signed' | 'void'; subtotal: string; tax_total: string | null; total: string
  extra: Record<string, unknown>; issued_at: string; void_reason: string | null; payment_id: string | null; qty?: Record<number, number>; token?: string; sig?: { name: string; at: string; problems: string | null; has_mark: boolean } }
interface Pay { id: string; job_id: string; amount: string; method: string; reference: string | null; paid_on: string; purpose: 'deposit' | 'balance'; recorded_by: string; reverses_payment_id: string | null
  reversal_reason: string | null; created_at: string; key: string }
interface Ord { id: string; title: string; customer: string; total: number; quotePct: number | null; docs: OD[]; pays: Pay[] }
const ITEMS = [{ no: 1, description: 'SAMPLE acrylic signboard 60x30, gloss', ordered: 40 }, { no: 2, description: 'SAMPLE vinyl lettering, per metre', ordered: 20 }]
const orders = new Map<string, Ord>()
const odSeq: Record<string, number> = {}
const PREFIX = { proforma: 'PF', delivery_order: 'DO', invoice: 'INV', receipt: 'RC', credit_note: 'CN' }
function issue(o: Ord, kind: OD['kind'], total: string, extra: Record<string, unknown>, over: Partial<OD> = {}): OD {
  const n = (odSeq[kind] = (odSeq[kind] ?? 0) + 1)
  const d: OD = { id: `od-${kind}-${n}`, kind, doc_no: `${PREFIX[kind]}-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`, status: 'issued', subtotal: total, tax_total: null, total, extra, issued_at: new Date().toISOString(),
    void_reason: null, payment_id: null, ...over }
  o.docs.push(d)
  return d
}
function pay(o: Ord, amount: number, purpose: 'deposit' | 'balance', over: Partial<Pay> = {}): { payment: Pay; receipt: OD } {
  const p: Pay = { id: `pay-${o.pays.length + 1}-${o.id}`, job_id: o.id, amount: m2(amount), method: 'transfer', reference: null, paid_on: iso(0), purpose, recorded_by: 'SAMPLE Owner', reverses_payment_id: null, reversal_reason: null,
    created_at: new Date().toISOString(), key: `seed-${o.pays.length}-${o.id}`, ...over }
  o.pays.push(p)
  const inv = live(o, 'invoice')
  const rc = issue(o, 'receipt', p.amount, { balance: m2(o.total - paid(o)), ...(inv ? { invoice_id: inv.id, invoice_no: inv.doc_no } : {}) }, { payment_id: p.id })
  return { payment: p, receipt: rc }
}
const live = (o: Ord, k: OD['kind']) => o.docs.find(d => d.kind === k && d.status !== 'void')
const paid = (o: Ord, purpose?: string) => o.pays.filter(p => !purpose || p.purpose === purpose).reduce((a, p) => a + (p.reverses_payment_id ? -1 : 1) * Number(p.amount), 0)
const dl = (o: Ord) => ITEMS.map(x => {
  const dos = o.docs.filter(d => d.kind === 'delivery_order' && d.status !== 'void')
  return { no: x.no, ordered: String(x.ordered), issued: String(dos.reduce((a, d) => a + (d.qty?.[x.no] ?? 0), 0)), signed: String(dos.filter(d => d.status === 'signed').reduce((a, d) => a + (d.qty?.[x.no] ?? 0), 0)) }
})
const stageOf = (o: Ord) => {
  const pf = live(o, 'proforma'), due = pf ? Number(pf.extra.deposit_amount) : null, complete = dl(o).every(x => Number(x.signed) >= Number(x.ordered))
  if (o.total && paid(o) >= o.total - 1e-9) return 'paid'
  if (live(o, 'invoice')) return 'awaiting_payment'
  if (complete) return 'delivered'
  return (due == null ? paid(o) > 0 : paid(o, 'deposit') >= due - 1e-9) ? 'in_production' : 'awaiting_deposit'
}
function order(id: string): Ord {
  let o = orders.get(id)
  if (o) return o
  o = { id, title: id === 'job-1' ? 'SAMPLE Signage Works order' : 'SAMPLE order', customer: 'SAMPLE Customer (synthetic)', total: id === 'job-1' ? 2400 : 1000, quotePct: id === 'job-1' ? 50 : 30, docs: [], pays: [] }
  orders.set(id, o)
  if (id === 'job-1') {
    issue(o, 'proforma', '2400.00', { deposit_pct: '50', deposit_amount: '1200.00' })
    pay(o, 1200, 'deposit', { reference: 'DUITNOW 88231' })
    issue(o, 'delivery_order', '2400.00', {}, { qty: { 1: 40, 2: 20 }, token: 'SampleDeliveryToken_0123456789abcdef' })
  }
  if (id === 'job-2') {
    o.total = 250
    const d = issue(o, 'delivery_order', '250.00', {}, { qty: { 1: 40, 2: 20 }, status: 'signed' })
    d.sig = { name: 'SAMPLE Warung Ali', at: new Date(Date.now() - 2 * DAY).toISOString(), problems: null, has_mark: false }
    issue(o, 'invoice', '250.00', { deposit_paid: '0', balance_due: '250.00', due_on: iso(-12) })
  }
  return o
}
const needOwner = (owner: boolean) => { if (!owner) throw new ApiError(403, 'owner_only', 'owner role required') }
const needPay = (owner: boolean) => { if (!owner) throw new ApiError(403, 'permission_required', 'You need the Record payments permission.') }
function chainOf(o: Ord) {
  const total = o.total, pd = paid(o), dep = paid(o, 'deposit'), pf = live(o, 'proforma'), inv = live(o, 'invoice'), d = dl(o)
  const dos = o.docs.filter(x => x.kind === 'delivery_order')
  const rev = new Set(o.pays.map(p => p.reverses_payment_id))
  return { job: { id: o.id, title: o.title, quote_id: null, status: 'doing', customer: o.customer, quote_deposit_pct: o.quotePct == null ? null : String(o.quotePct) },
    total: m2(total), paid: m2(pd), balance: m2(total - pd),
    credited: m2(o.docs.filter(x => x.kind === 'credit_note' && x.status !== 'void').reduce((a, x) => a + Number(x.total), 0)),
    deposit: pf ? { pct: pf.extra.deposit_pct, amount: pf.extra.deposit_amount, paid: m2(dep) } : null, stage: stageOf(o), overdue: null,
    delivery: { lines: d, complete: d.every(x => Number(x.signed) >= Number(x.ordered)) },
    delivery_orders: dos.map(x => ({ id: x.id, doc_no: x.doc_no, status: x.status, issued_at: x.issued_at, override_reason: x.extra.override_reason ?? null, signature: x.sig ?? null })),
    problems: dos.filter(x => x.sig?.problems).map(x => ({ doc_no: x.doc_no, note: x.sig!.problems, at: x.sig!.at })),
    invoice: inv ? { id: inv.id, doc_no: inv.doc_no, total: inv.total, due_on: inv.extra.due_on ?? null, issued_at: inv.issued_at, balance_due: m2(total - pd),
      receipts: o.docs.filter(x => x.kind === 'receipt' && x.extra.invoice_id === inv.id).map(x => ({ id: x.id, doc_no: x.doc_no, payment_id: x.payment_id, status: x.status })) } : null,
    documents: o.docs.map(({ qty, token, sig, ...x }) => x), payments: o.pays.map(({ key, ...p }) => ({ ...p, reversed: rev.has(p.id) })) }
}
const recvOf = () => {
  const b: Record<string, { count: number; outstanding: string }> = { current: { count: 0, outstanding: '0' }, '1-30': { count: 0, outstanding: '0' }, '31-60': { count: 0, outstanding: '0' }, '60+': { count: 0, outstanding: '0' } }
  let total = 0, waiting = 0
  for (const id of ['job-1', 'job-2']) order(id)
  for (const o of orders.values()) {
    const inv = live(o, 'invoice'), pf = live(o, 'proforma'), owed = o.total - paid(o)
    if (pf && paid(o, 'deposit') < Number(pf.extra.deposit_amount) - 1e-9) waiting++
    if (!inv || owed <= 0) continue
    const days = inv.extra.due_on ? Math.round((Date.parse(iso(0)) - Date.parse(String(inv.extra.due_on))) / DAY) : 0
    const k = days <= 0 ? 'current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : '60+'
    b[k].count++; b[k].outstanding = m2(Number(b[k].outstanding) + owed); total += owed
  }
  return { as_of: iso(0), deposits_waiting: waiting, buckets: b, total: m2(total), note: 'Reminders are drafts for the owner to send; LARIS sends nothing by itself.' }
}

// ---- the public delivery page: GET /public/delivery/{token}, POST .../sign
const dmode = new URLSearchParams(location.search).get('delivery') ?? 'ok'
export function mockDelivery(method: string, p: string, body: Record<string, unknown>): unknown {
  const m = p.match(/^\/public\/delivery\/([^/]+)(\/sign)?$/)
  if (!m) return undefined
  if (dmode === 'expired') throw new ApiError(404, 'not_found', 'This link is not valid.')
  if (dmode === 'error') throw new ApiError(503, 'unavailable', 'Service unavailable')
  order('job-1')
  const d = [...orders.values()].flatMap(o => o.docs).find(x => x.kind === 'delivery_order' && x.token === m[1])
  if (!d) throw new ApiError(404, 'not_found', 'This link is not valid.')
  if (dmode === 'signed' && d.status === 'issued') d.status = 'signed', d.sig = { name: 'SAMPLE Customer', at: new Date(Date.now() - 36e5).toISOString(), problems: null, has_mark: false }
  if (method === 'GET') return {
    notice: 'This records your name, the time and your device. It confirms you received the goods listed here.', language: 'en',
    issuer: { name: 'SAMPLE Signage Works (synthetic)', logo_url: null },
    delivery_order: { doc_no: d.doc_no, issued_on: d.issued_at.slice(0, 10), status: d.status, currency: 'RM', show_prices: false,
      lines: ITEMS.filter(x => d.qty?.[x.no]).map(x => ({ description: x.description, qty: String(d.qty![x.no]), uom: x.no === 1 ? 'pcs' : 'm' })) },
    can_sign: d.status === 'issued', signed: d.status === 'signed' && d.sig ? { name: d.sig.name, at: d.sig.at, problems: d.sig.problems } : null }
  const name = String(body.name ?? '').trim().replace(/\s+/g, ' ')
  if (d.status === 'signed') throw new ApiError(409, 'already_signed', 'This delivery order has already been signed.')
  if (name.length < 2 || name.length > 80) throw new ApiError(422, 'bad_name', 'Type your full name (2 to 80 characters).')
  if (body.agree !== true) throw new ApiError(422, 'must_agree', 'Tick the box to confirm you received these goods.')
  const problems = String(body.problems ?? '').trim() || null
  d.status = 'signed'; d.sig = { name, at: new Date().toISOString(), problems, has_mark: !!body.mark }
  return { status: 'signed', signed_at: d.sig.at, problems_reported: !!problems }
}

export function mockChain(method: string, p: string, q: string, owner: boolean, body: Record<string, unknown>): unknown {
  let m: RegExpMatchArray | null
  // ---- the order chain on a job
  if ((m = p.match(/^\/jobs\/([^/]+)\/(chain|proforma|payments|delivery-orders|invoice|credit-notes)$/))) {
    const [, id, act] = m
    needPay(owner)
    const o = order(id)
    if (act === 'chain' && method === 'GET') return chainOf(o)
    if (method !== 'POST') return undefined
    if (act === 'proforma') {
      needOwner(owner)
      if (live(o, 'proforma')) throw new ApiError(409, 'already_issued', 'this order already has a proforma; void it first to issue another')
      let pct = body.deposit_pct == null ? o.quotePct : Number(body.deposit_pct)
      if (pct == null) pct = 50  // nothing agreed: 50%
      const d = issue(o, 'proforma', m2(o.total), { deposit_pct: String(pct), deposit_amount: m2(Math.round(o.total * pct) / 100) })
      return { id: d.id, doc_no: d.doc_no, kind: d.kind, status: d.status, total: d.total }
    }
    if (act === 'payments') {
      const old = o.pays.find(x => x.key === body.idempotency_key)
      const rc = (x: Pay) => { const r = o.docs.find(d => d.payment_id === x.id)!; return { id: r.id, doc_no: r.doc_no, status: r.status } }
      if (old) return { payment: old, receipt: rc(old) }
      const amt = Number(body.amount)
      if (!(amt > 0)) throw new ApiError(422, 'bad_amount', 'amount must be more than 0')
      if (String(body.paid_on) > iso(0)) throw new ApiError(422, 'future_date', 'paid_on cannot be in the future')
      if (cents(amt) > cents(o.total - paid(o))) throw new ApiError(409, 'overpayment', `payment: overpayment, this order has ${m2(o.total - paid(o))} left to pay`)
      const r = pay(o, amt, body.purpose === 'deposit' ? 'deposit' : 'balance', { method: String(body.method), reference: (body.reference as string) || null, paid_on: String(body.paid_on), key: String(body.idempotency_key) })
      return { payment: r.payment, receipt: { id: r.receipt.id, doc_no: r.receipt.doc_no, status: r.receipt.status } }
    }
    if (act === 'delivery-orders') {
      const left = dl(o).map(x => ({ no: Number(x.no), q: Number(x.ordered) - Number(x.issued) })).filter(x => x.q > 0)
      const gated = stageOf(o) === 'awaiting_deposit'
      if (body.override_reason) needOwner(owner)
      if (gated && !body.override_reason) throw new ApiError(409, 'deposit_missing', 'the deposit has not been recorded yet; the owner can override with a reason')
      if (!left.length) throw new ApiError(409, 'nothing_to_deliver', 'everything ordered is already on a delivery order')
      const d = issue(o, 'delivery_order', m2(o.total), gated ? { override_reason: String(body.override_reason) } : {}, { qty: Object.fromEntries(left.map(x => [x.no, x.q])) })
      return { id: d.id, doc_no: d.doc_no, status: d.status, issued_at: d.issued_at, override: gated, lines: left.map(x => ({ no: x.no, description: ITEMS[x.no - 1].description, qty: String(x.q), uom: 'unit' })) }
    }
    if (act === 'credit-notes') {
      needOwner(owner)
      const inv0 = live(o, 'invoice'), amt = Number(body.amount), why = String(body.reason ?? '').trim()
      if (!inv0) throw new ApiError(409, 'no_invoice', 'a credit note is made against an invoice; issue the invoice first')
      if (!(amt > 0) || why.length < 3) throw new ApiError(422, 'validation_error', 'give an amount above zero and a reason')
      if (cents(amt) >= cents(o.total)) throw new ApiError(409, 'too_big', `the order is RM${m2(o.total)}; to cancel all of it, void the invoice instead`)
      if (cents(o.total - amt) < cents(paid(o))) throw new ApiError(409, 'already_paid', `RM${m2(paid(o))} has been paid, so at most RM${m2(o.total - paid(o))} can be credited; any refund is made outside LARIS`)
      const d = issue(o, 'credit_note', m2(amt), { invoice_id: inv0.id, invoice_no: inv0.doc_no, reason: why })
      o.total = Math.round((o.total - amt) * 100) / 100
      return { id: d.id, doc_no: d.doc_no, kind: d.kind, status: d.status, total: d.total }
    }
    needOwner(owner)  // invoice
    if (live(o, 'invoice')) throw new ApiError(409, 'already_issued', 'this order already has an invoice; void it first to issue another')
    if (!o.docs.some(d => d.kind === 'delivery_order' && d.status === 'signed') && !body.override_reason) throw new ApiError(409, 'not_delivered', 'no delivery order is signed yet; wait for it or give override_reason')
    const due = (body.due_on as string) || iso(30)
    const d = issue(o, 'invoice', m2(o.total), { deposit_paid: m2(paid(o)), balance_due: m2(o.total - paid(o)), due_on: due })
    return { id: d.id, doc_no: d.doc_no, kind: d.kind, status: d.status, total: d.total }
  }
  if ((m = p.match(/^\/deal-docs\/([^/]+)\/(delivery-link|pdf)$/))) {
    needPay(owner)
    const d = [...orders.values()].flatMap(o => o.docs).find(x => x.id === m![1])
    if (!d) throw new ApiError(404, 'not_found', 'document not found')
    if (m[2] === 'pdf') return new Blob([`SAMPLE ${d.kind} ${d.doc_no} (mock mode)\n`], { type: 'application/pdf' })
    if (d.kind !== 'delivery_order' || d.status !== 'issued') throw new ApiError(409, 'not_linkable', `${d.doc_no} is ${d.status}; a link works while it is issued and unsigned`)
    d.token = `SampleDeliveryToken_${d.id.replace(/\W/g, '')}_0123456789`
    return { url: `${location.origin}/#/d/${d.token}`, expires_at: new Date(Date.now() + 30 * DAY).toISOString() }
  }
  if (p === '/payments/propose-from-slip' && method === 'POST') {
    needPay(owner)
    return { amount: '1200.00', paid_on: iso(-1), reference: 'DUITNOW 88231', payer: 'SAMPLE Customer', matched_job_id: 'job-1', confidence: 0.91, notice: 'A slip is not proof of money received: check your bank before confirming.' }
  }
  if (!p.startsWith('/chain')) return undefined
  seed()
  const find = (id: string) => docs.find(x => x.id === id) ?? (() => { throw new ApiError(404, 'not_found', 'document not found') })()
  if (p === '/chain' && method === 'GET') { const k = new URLSearchParams(q).get('kind'); return docs.filter(x => !k || x.kind === k).slice().reverse().map(shape) }
  if (p === '/chain/receivables') { needPay(owner); return recvOf() }
  if (p === '/chain/buy/compare' && method === 'POST') {
    const qs = (body.quotes as { supplier: string; total: number | string; lead_days?: number; on_time_pct?: number }[]) ?? []
    if (qs.length < 2 || qs.length > 4) throw new ApiError(422, 'need_2_to_4', 'Compare between 2 and 4 supplier quotes')
    const rows = qs.map(q => ({ supplier: String(q.supplier).trim().slice(0, 80), total: Number(q.total), lead_days: Number(q.lead_days ?? 0), on_time_pct: Number(q.on_time_pct ?? 0) }))
    if (rows.some(r => !r.supplier || !Number.isFinite(r.total) || r.total < 0 || r.on_time_pct < 0 || r.on_time_pct > 100)) throw new ApiError(422, 'bad_number', 'Check the supplier names and numbers')
    const o = rows.slice().sort((a, b) => a.total - b.total || a.lead_days - b.lead_days || b.on_time_pct - a.on_time_pct), best = o[0]
    const fastest = rows.slice().sort((a, b) => a.lead_days - b.lead_days || a.total - b.total)[0]
    return { quotes: o.map((r, i) => {
      const dp = r.total - best.total, dd = r.lead_days - best.lead_days, days = Math.abs(dd)
      const why = i === 0 ? 'Lowest price' + (best.on_time_pct ? `, and ${best.on_time_pct}% on time` : '') : `${dp > 0 ? `RM ${dp.toFixed(2)} dearer` : 'same price'}, ${dd === 0 ? 'same lead time' : `${days} day${days === 1 ? '' : 's'} ${dd > 0 ? 'slower' : 'faster'}`}`
      return { ...r, total: r.total.toFixed(2), rank: i + 1, best: i === 0, why, vs_last_paid: null }
    }), best: best.supplier, fastest: fastest.supplier, note: 'Ranked by price, then speed. You choose; nothing is ordered until the owner approves the purchase order.' }
  }
  if (p === '/chain/buy/margin' && method === 'POST') {
    const s = Number(body.sell_total), c = Number(body.cost_total), t = Number(body.target_pct ?? 20)
    if (![s, c, t].every(Number.isFinite) || s < 0 || c < 0) throw new ApiError(422, 'bad_number', 'Check the numbers')
    const profit = s - c, pct = s === 0 ? 0 : profit / s * 100
    return { sell: m2(s), cost: m2(c), profit: m2(profit), margin_pct: pct.toFixed(1), target_pct: t.toFixed(0), state: profit < 0 ? 'loss' : pct < t ? 'below_target' : 'ok' }
  }
  if (p === '/chain' && method === 'POST') {
    if (!['cpo', 'so', 'spo'].includes(String(body.kind))) throw new ApiError(422, 'validation', 'kind must be cpo, so or spo')
    const ls = (body.lines as { description: string; qty: number; uom?: string; unit_price: number }[]).map(l => ({ description: l.description, qty: String(l.qty), uom: l.uom ?? 'unit', unit_price: m2(Number(l.unit_price)) }))
    const name = 'SAMPLE Customer'
    if (body.kind === 'cpo' && body.ref && docs.some(x => x.kind === 'cpo' && x.party === name && x.ref?.toLowerCase() === String(body.ref).toLowerCase())) throw new ApiError(409, 'duplicate_po', "this customer's PO number is already recorded")
    const serves = body.serves ? find(String(body.serves)) : null
    if (serves && (body.kind !== 'spo' || !['so', 'cpo'].includes(serves.kind) || ['cancelled', 'void'].includes(serves.status))) throw new ApiError(409, 'bad_parent', 'a supplier PO can serve an open customer order or sales order')
    const job = serves ? serves.job_id : body.kind === 'spo' ? null : 'job-' + (docs.length + 10)
    return shape(add(String(body.kind), serves ? serves.deal_id : 'deal-' + (docs.length + 1) + Date.now(), serves, body.kind === 'spo' ? 'SAMPLE Pasar Borong' : name, ls, { ref: (body.ref as string) || null, job_id: job }))
  }
  if ((m = p.match(/^\/chain\/([^/]+)$/)) && method === 'GET') {
    const d = find(m[1])
    return { ...shape(d), receiving: d.kind === 'spo' ? receivingOf(d) : null, trail: docs.filter(x => x.deal_id === d.deal_id).map(shape), history: [{ at: d.created_at, event: `${NAMES[d.kind]} ${d.doc_no} created`, actor: 'SAMPLE Owner' }] }
  }
  if ((m = p.match(/^\/chain\/([^/]+)\/receive$/)) && method === 'POST') {
    const d = find(m[1])
    if (d.kind !== 'spo') throw new ApiError(409, 'not_a_supplier_po', 'goods are received against a supplier PO')
    if (!['sent', 'partially_received'].includes(d.status)) throw new ApiError(409, 'not_sent', `this supplier PO is ${d.status}; goods can be received once it has been sent`)
    const left = receivingOf(d), got: Ln[] = [], seen = new Set<number>()
    for (const x of (body.lines as { no: number; qty: number }[] | undefined) ?? []) {
      const row = left.find(r => r.no === x.no)
      if (!row) throw new ApiError(422, 'bad_line', `the supplier PO has no line ${x.no}`)
      if (seen.has(x.no)) throw new ApiError(422, 'bad_line', `line ${x.no} is listed twice`)
      seen.add(x.no)
      if (!(Number(x.qty) > 0)) throw new ApiError(422, 'bad_qty', `line ${x.no}: the quantity received must be above zero`)
      if (Number(x.qty) > Number(row.left)) throw new ApiError(409, 'too_many', `line ${x.no}: only ${row.left} still to come, not ${x.qty}`)
      got.push({ description: row.description, qty: String(x.qty), uom: row.uom, unit_price: d.lines[x.no - 1].unit_price, src: x.no })
    }
    if (!got.length) throw new ApiError(422, 'bad_lines', 'say what arrived')
    const note = add('grn', d.deal_id, d, d.party, got, { job_id: d.job_id, note: String(body.note ?? '').trim() || null })
    d.status = receivingOf(d).every(r => Number(r.left) === 0) ? 'received' : 'partially_received'
    return { note: shape(note), status: d.status, receiving: receivingOf(d) }
  }
  if ((m = p.match(/^\/chain\/([^/]+)\/convert$/)) && method === 'POST') {
    const d = find(m[1])
    if (body.to !== 'so' || d.kind !== 'cpo') throw new ApiError(409, 'illegal_conversion', `a ${NAMES[d.kind]} cannot be turned into that document`)
    d.status = 'confirmed'
    return shape(add('so', d.deal_id, d, d.party, d.lines))
  }
  if ((m = p.match(/^\/chain\/([^/]+)\/transition$/)) && method === 'POST') {
    const d = find(m[1]), to = String(body.to)
    if (!(NEXT[d.kind]?.[d.status] ?? []).includes(to)) throw new ApiError(409, 'illegal_transition', `a ${NAMES[d.kind]} cannot go from ${d.status} to ${to}`)
    if (OWNER.includes(`${d.kind}:${to}`) && !owner) throw new ApiError(403, 'owner_only', `only the owner can move a ${NAMES[d.kind]} to ${to}`)
    if (['void', 'cancelled', 'returned'].includes(to) && !String(body.reason ?? '').trim()) throw new ApiError(422, 'reason_required', 'give a reason')
    if (to === 'cancelled' && d.job_id && orders.get(d.job_id)?.pays.length) throw new ApiError(409, 'has_payments', 'money has been recorded on this order; reverse the payments first')
    d.status = to
    return shape(d)
  }
  return undefined
}

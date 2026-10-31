// SAMPLE data only (mock mode) for /chain: a small in-memory copy of the server rules in src/chain.py and src/api/deals.py.
// The real rules (totals, state machines, partial deliveries, numbering) are tested against the API in tests/test_chain.py, not here.
import { ApiError } from './api'

type Ln = { description: string; qty: string; uom: string; unit_price: string; src?: number }
interface D { id: string; kind: string; doc_no: string; status: string; deal_id: string; parent_id: string | null; party: string; party_id: string; ref: string | null; lines: Ln[]
  total: string; paid: string; deposit_pct: string | null; due_on: string | null; created_at: string; note: string | null }
const DAY = 864e5
const iso = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10)
const PFX: Record<string, string> = { cpo: 'CPO', so: 'SO', pf: 'PF', do: 'DO', inv: 'INV', rcp: 'RCP', spo: 'SPO' }
const NAMES: Record<string, string> = { cpo: 'Customer PO (received)', so: 'Sales Order', pf: 'Proforma Invoice', do: 'Delivery Order', inv: 'Invoice', rcp: 'Receipt', spo: 'Supplier PO (sent)' }
const NEXT: Record<string, Record<string, string[]>> = {
  cpo: { received: ['confirmed', 'cancelled'], confirmed: ['cancelled'] }, so: { confirmed: ['in_fulfilment', 'cancelled'], in_fulfilment: ['fulfilled', 'cancelled'] },
  pf: { draft: ['sent', 'cancelled'], sent: ['deposit_received', 'cancelled'] }, do: { prepared: ['dispatched'], dispatched: ['delivered', 'returned'], delivered: ['returned'] },
  inv: { draft: ['pending_approval', 'void'], pending_approval: ['issued', 'draft', 'void'], issued: ['partially_paid', 'paid', 'void'], partially_paid: ['paid', 'void'] },
  rcp: { issued: ['void'] }, spo: { draft: ['pending_approval', 'cancelled'], pending_approval: ['sent', 'draft', 'cancelled'], sent: ['partially_received', 'received', 'cancelled'], partially_received: ['received', 'cancelled'] } }
const OWNER = ['inv:issued', 'spo:sent', 'rcp:void', 'inv:void', 'so:cancelled', 'cpo:confirmed']
const START: Record<string, string> = { cpo: 'received', so: 'confirmed', pf: 'draft', do: 'prepared', inv: 'draft', rcp: 'issued', spo: 'draft' }
const CAN: Record<string, string[]> = { cpo: ['so'], so: ['pf', 'do', 'inv'], do: ['inv'] }
const sum = (ls: Ln[]) => ls.reduce((a, l) => a + Math.round(Number(l.qty) * Number(l.unit_price) * 100), 0) / 100
const m2 = (n: number) => n.toFixed(2)

let seq: Record<string, number> = {}
const docs: D[] = []
function add(kind: string, deal: string, parent: D | null, party: string, ls: Ln[], over: Partial<D> = {}): D {
  const n = (seq[kind] = (seq[kind] ?? 0) + 1), y = new Date().getFullYear()
  const d: D = { id: `ch-${kind}-${n}`, kind, doc_no: `${PFX[kind]}-${y}-${String(n).padStart(4, '0')}`, status: START[kind], deal_id: deal, parent_id: parent?.id ?? null, party, party_id: 'p-' + party,
    ref: parent?.ref ?? null, lines: ls, total: m2(sum(ls)), paid: '0.00', deposit_pct: null, due_on: null, created_at: new Date(Date.now() - (30 - docs.length) * 36e5).toISOString(), note: null, ...over }
  docs.push(d)
  return d
}
function seed() {
  if (docs.length) return
  const so = add('so', 'deal-1', null, 'SAMPLE Sri Murni Events', [{ description: 'Nasi minyak set (per pax)', qty: '120', uom: 'pax', unit_price: '18.00' }, { description: 'Setup and serving crew', qty: '1', uom: 'event', unit_price: '350.00' }], { status: 'in_fulfilment' })
  const pf = add('pf', 'deal-1', so, so.party, so.lines, { status: 'deposit_received', deposit_pct: '30.00', paid: '751.50' })
  add('rcp', 'deal-1', pf, so.party, [{ description: 'Payment for ' + pf.doc_no, qty: '1', uom: 'unit', unit_price: '751.50' }])
  const dd = add('do', 'deal-1', so, so.party, [{ ...so.lines[0], qty: '60', src: 0 }], { status: 'delivered' })
  add('inv', 'deal-1', dd, so.party, dd.lines, { status: 'issued', due_on: iso(-12) })
  add('spo', 'deal-1', so, 'SAMPLE Pasar Borong', [{ description: 'Chicken and rice, bulk (per pax)', qty: '120', uom: 'pax', unit_price: '9.50' }, { description: 'Disposable packaging', qty: '120', uom: 'pax', unit_price: '0.80' }], { status: 'sent' })
  const so2 = add('so', 'deal-2', null, 'SAMPLE Warung Ali', [{ description: 'Sample item', qty: '10', uom: 'pcs', unit_price: '25.00' }])
  add('inv', 'deal-2', so2, so2.party, so2.lines, { status: 'pending_approval', due_on: iso(30) })
  add('cpo', 'deal-3', null, 'SAMPLE Kopi Corner', [{ description: 'Coffee beans 1 kg', qty: '12', uom: 'bag', unit_price: '48.00' }], { ref: 'KC-PO-2291' })
  add('spo', 'deal-4', null, 'SAMPLE Pasar Borong', [{ description: 'Chicken 1 kg', qty: '40', uom: 'kg', unit_price: '9.80' }], { status: 'pending_approval' })
}
const shape = (d: D) => {
  const overdue = d.kind === 'inv' && ['issued', 'partially_paid'].includes(d.status) && !!d.due_on && d.due_on < iso(0)
  const days = overdue ? Math.round((Date.parse(iso(0)) - Date.parse(d.due_on!)) / DAY) : 0
  return { ...d, kind_label: NAMES[d.kind], status_effective: overdue ? 'overdue' : d.status, balance: ['inv', 'pf'].includes(d.kind) ? m2(Number(d.total) - Number(d.paid)) : null,
    days_overdue: days, ageing: overdue ? (days <= 30 ? '1-30' : days <= 60 ? '31-60' : '60+') : (d.kind === 'inv' && ['issued', 'partially_paid'].includes(d.status) ? 'current' : null),
    discount_pct: '0.00', sst_rate: '0.00', round5: false, subtotal: d.total, discount: '0.00', sst: '0.00', rounding: '0.00', quote_id: null, party_id: d.party_id, void_reason: null }
}

export function mockChain(method: string, p: string, q: string, owner: boolean, body: Record<string, unknown>): unknown {
  if (!p.startsWith('/chain')) return undefined
  seed()
  const find = (id: string) => docs.find(x => x.id === id) ?? (() => { throw new ApiError(404, 'not_found', 'document not found') })()
  if (p === '/chain' && method === 'GET') { const k = new URLSearchParams(q).get('kind'); return docs.filter(x => !k || x.kind === k).slice().reverse().map(shape) }
  if (p === '/chain/receivables') {
    const b: Record<string, { count: number; outstanding: string }> = { current: { count: 0, outstanding: '0' }, '1-30': { count: 0, outstanding: '0' }, '31-60': { count: 0, outstanding: '0' }, '60+': { count: 0, outstanding: '0' } }
    let total = 0
    for (const d of docs.filter(x => x.kind === 'inv' && ['issued', 'partially_paid'].includes(x.status))) {
      const s = shape(d), k = s.ageing ?? 'current', o = Number(d.total) - Number(d.paid)
      b[k].count++; b[k].outstanding = m2(Number(b[k].outstanding) + o); total += o
    }
    return { as_of: iso(0), buckets: b, total: m2(total), note: 'Reminders are drafts for the owner to send; LARIS sends nothing by itself.' }
  }
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
  let m: RegExpMatchArray | null
  if (p === '/chain' && method === 'POST') {
    const ls = (body.lines as { description: string; qty: number; uom?: string; unit_price: number }[]).map(l => ({ description: l.description, qty: String(l.qty), uom: l.uom ?? 'unit', unit_price: m2(Number(l.unit_price)) }))
    const name = 'SAMPLE Customer'
    if (body.kind === 'cpo' && body.ref && docs.some(x => x.kind === 'cpo' && x.party === name && x.ref?.toLowerCase() === String(body.ref).toLowerCase())) throw new ApiError(409, 'duplicate_po', "this customer's PO number is already recorded")
    const serves = body.serves ? find(String(body.serves)) : null
    if (serves && (body.kind !== 'spo' || !['so', 'cpo'].includes(serves.kind) || ['cancelled', 'void'].includes(serves.status))) throw new ApiError(409, 'bad_parent', 'a supplier PO can serve an open customer order or sales order')
    return shape(add(String(body.kind), serves ? serves.deal_id : 'deal-' + (docs.length + 1) + Date.now(), serves, body.kind === 'spo' ? 'SAMPLE Pasar Borong' : name, ls, { ref: (body.ref as string) || null }))
  }
  if ((m = p.match(/^\/chain\/([^/]+)$/)) && method === 'GET') {
    const d = find(m[1])
    return { ...shape(d), trail: docs.filter(x => x.deal_id === d.deal_id).map(shape), history: [{ at: d.created_at, event: `${NAMES[d.kind]} ${d.doc_no} created`, actor: 'SAMPLE Owner' }] }
  }
  if ((m = p.match(/^\/chain\/([^/]+)\/convert$/)) && method === 'POST') {
    const d = find(m[1]), to = String(body.to)
    if (!(CAN[d.kind] ?? []).includes(to)) throw new ApiError(409, 'illegal_conversion', `a ${NAMES[d.kind]} cannot be turned into that document`)
    if (to === 'pf') { if (!body.deposit_pct) throw new ApiError(422, 'deposit_required', 'a proforma needs deposit_pct'); return shape(add('pf', d.deal_id, d, d.party, d.lines, { deposit_pct: m2(Number(body.deposit_pct)) })) }
    if (to === 'do') {
      const sent = docs.filter(x => x.parent_id === d.id && x.kind === 'do' && !['returned'].includes(x.status)).flatMap(x => x.lines)
      const ls = d.lines.map((l, i) => ({ ...l, src: i, qty: String(Number(l.qty) - sent.filter(s => s.src === i).reduce((a, s) => a + Number(s.qty), 0)) })).filter(l => Number(l.qty) > 0)
      if (!ls.length) throw new ApiError(409, 'nothing_to_deliver', 'nothing is left to deliver, or no quantity was given')
      if (d.status === 'confirmed') d.status = 'in_fulfilment'
      return shape(add('do', d.deal_id, d, d.party, ls))
    }
    if (to === 'so') { d.status = 'confirmed'; return shape(add('so', d.deal_id, d, d.party, d.lines)) }
    return shape(add('inv', d.deal_id, d, d.party, d.lines, { due_on: iso(Number(body.due_in_days ?? 30)) }))
  }
  if ((m = p.match(/^\/chain\/([^/]+)\/transition$/)) && method === 'POST') {
    const d = find(m[1]), to = String(body.to)
    if (!(NEXT[d.kind]?.[d.status] ?? []).includes(to)) throw new ApiError(409, 'illegal_transition', `a ${NAMES[d.kind]} cannot go from ${d.status} to ${to}`)
    if (OWNER.includes(`${d.kind}:${to}`) && !owner) throw new ApiError(403, 'owner_only', `only the owner can move a ${NAMES[d.kind]} to ${to}`)
    if (['void', 'cancelled', 'returned'].includes(to) && !String(body.reason ?? '').trim()) throw new ApiError(422, 'reason_required', 'give a reason')
    d.status = to
    if (d.kind === 'do' && to === 'delivered') { const so = docs.find(x => x.id === d.parent_id); if (so && so.lines.every((l, i) => docs.filter(x => x.parent_id === so.id && x.kind === 'do' && x.status === 'delivered').flatMap(x => x.lines).filter(s => s.src === i).reduce((a, s) => a + Number(s.qty), 0) >= Number(l.qty))) so.status = 'fulfilled' }
    return shape(d)
  }
  if ((m = p.match(/^\/chain\/([^/]+)\/payment$/)) && method === 'POST') {
    const d = find(m[1]), amt = Number(body.amount)
    if (!['inv', 'pf'].includes(d.kind) || !['issued', 'partially_paid', 'sent'].includes(d.status)) throw new ApiError(409, 'not_payable', 'payments go on an issued invoice or a sent proforma')
    const owed = d.kind === 'inv' ? Number(d.total) - Number(d.paid) : Number(d.total) * Number(d.deposit_pct ?? 100) / 100 - Number(d.paid)
    if (amt > owed + 1e-9) throw new ApiError(409, 'overpayment', `RM ${m2(owed)} is outstanding; the payment is more than that`)
    const rc = add('rcp', d.deal_id, d, d.party, [{ description: `Payment for ${d.doc_no}`, qty: '1', uom: 'unit', unit_price: m2(amt) }])
    d.paid = m2(Number(d.paid) + amt)
    d.status = d.kind === 'inv' ? (Number(d.paid) >= Number(d.total) ? 'paid' : 'partially_paid') : 'deposit_received'
    return { receipt: shape(rc), document: shape(d) }
  }
  return undefined
}

// SAMPLE data only. Synthetic, invented for demo; no real suppliers, customers or prices.
// Mimics docs/api-contract.md including role stripping (staff never gets cost, margin or owner_only attrs).
import { ApiError, NEXT } from './api'
import type { Role, DocDetail, DocSummary, Line, Field, Proposal, AuditEvent, Alert } from './api'

const money = (n: number) => n.toFixed(4)
const sup = { id: 'p1', name: 'SAMPLE Kayu Timur Supplies' }
const sup2 = { id: 'p2', name: 'SAMPLE Besi Jaya Hardware' }
const cust = { id: 'p3', name: 'SAMPLE Customer: Cabinet Works A' }

const L = (id: string, n: number, description: string, qty: number | null, uom: string, price: number | null, extra: Partial<Line> = {}): Line => ({
  id, line_no: n, description, qty: qty === null ? null : money(qty), uom, unit_price: price === null ? null : money(price),
  discount_pct: null, tax_rate: null, section: null, is_header: false, needs_review: false, ocr_confidence: null,
  attrs: {}, attrs_unmapped: {}, item_key: null, ...extra,
})
const D = (id: string, direction: 'in' | 'out', doc_no: string, party: { id: string; name: string }, status: string, total: number, issued_on: string, flags = { cost_is_stale: false, needs_review: false }): DocSummary => ({
  id, direction, kind: 'quotation', doc_no, party, status, issued_on, valid_until: '2026-11-30', total: money(total), currency: 'MYR', updated_at: '2026-10-21T09:00:00+08:00', flags,
})

const fields: (Field & { owner_only?: boolean })[] = [
  { key: 'finishing', label: 'Finishing', type: 'select', unit: null, options: ['raw', 'sanded', 'painted'], show_in_grid: true, sort_order: 10 },
  { key: 'lead_time_days', label: 'Lead time', type: 'integer', unit: 'days', options: null, show_in_grid: true, sort_order: 20 },
  { key: 'supplier_grade', label: 'Supplier grade', type: 'text', unit: null, options: null, show_in_grid: true, sort_order: 30, owner_only: true },
]
let proposals: Proposal[] = [{ id: 'fp1', key: 'thickness_mm', sample_values: ['12', '18', '12'], status: 'pending' }]

const docs: Record<string, DocDetail> = {
  'out-1': {
    doc: { ...D('out-1', 'out', 'QT-2026-0007', cust, 'sent', 4146.0, '2026-10-12', { cost_is_stale: true, needs_review: false }), terms: { payment: '50% deposit' } },
    lines: [
      L('o1l1', 1, 'Plywood 18mm, cabinet carcass', 40, 'sheet', 98, { item_key: 'plywood_18mm', attrs: { finishing: 'sanded', lead_time_days: 5, supplier_grade: 'B' } }),
      L('o1l2', 2, 'Edge banding 22mm', 120, 'm', 1.8, { item_key: 'edge_band_22', attrs: { finishing: 'raw' } }),
      L('o1l3', 3, 'Workshop labour', 1, 'day', 10, { item_key: 'labour_day' }),
    ],
    provenance: [{
      cost_item_id: 'c1', line_id: 'o1l1', supplier: sup.name, source_doc_id: 'in-1', source_doc_no: 'SQ-SAMPLE-101', source_line_id: 'i1l1',
      cost_date: '2026-10-18', unit_cost: money(71.5), cost_snapshot: money(62), current_unit_cost: money(71.5), cost_is_stale: true, line_margin: money(1060),
    }, {
      cost_item_id: 'c2', line_id: 'o1l2', supplier: sup2.name, source_doc_id: 'in-3', source_doc_no: 'SQ-SAMPLE-110', source_line_id: 'i3l1',
      cost_date: '2026-09-20', unit_cost: money(1.1), cost_snapshot: money(1.1), current_unit_cost: money(1.1), cost_is_stale: false, line_margin: money(84),
    }],
    messages: [{ direction: 'out', channel: 'whatsapp', body: 'SAMPLE message: quotation QT-2026-0007 sent.', at: '2026-10-12T10:00:00+08:00' }],
  },
  'out-2': {
    doc: { ...D('out-2', 'out', 'QT-2026-0008', { id: 'p4', name: 'SAMPLE Customer: Kedai Perabot B' }, 'draft', 530.0, '2026-10-21') },
    lines: [L('o2l1', 1, 'Edge banding 22mm', 200, 'm', 1.8, { item_key: 'edge_band_22' }), L('o2l2', 2, 'Delivery', 1, 'trip', 170, { item_key: 'delivery' })],
    provenance: [{
      cost_item_id: 'c2', line_id: 'o2l1', supplier: sup2.name, source_doc_id: 'in-3', source_doc_no: 'SQ-SAMPLE-110', source_line_id: 'i3l1',
      cost_date: '2026-09-20', unit_cost: money(1.1), cost_snapshot: money(1.1), current_unit_cost: money(1.1), cost_is_stale: false, line_margin: money(140),
    }],
    messages: [],
  },
  'out-3': {
    doc: D('out-3', 'out', 'QT-2026-0005', { id: 'p5', name: 'SAMPLE Customer: Reno Studio C' }, 'accepted', 2200.0, '2026-10-02'),
    lines: [L('o3l1', 1, 'Plywood 18mm', 20, 'sheet', 110, { item_key: 'plywood_18mm' })],
    provenance: [], messages: [],
  },
  'in-1': {
    doc: D('in-1', 'in', 'SQ-SAMPLE-101', sup, 'in_cost_book', 1430.0, '2026-10-18'),
    lines: [L('i1l1', 1, 'Plywood 18mm BB/CC', 20, 'sheet', 71.5, { item_key: 'plywood_18mm', attrs: { lead_time_days: 3, supplier_grade: 'A' } })],
    provenance: [], messages: [],
  },
  'in-3': {
    doc: D('in-3', 'in', 'SQ-SAMPLE-110', sup2, 'parsed', 330.0, '2026-10-20', { cost_is_stale: false, needs_review: true }),
    lines: [
      L('i3l1', 1, 'Edge band PVC 22mm roll', 300, 'm', 1.1, { item_key: 'edge_band_22', ocr_confidence: 0.97 }),
      L('i3l2', 2, 'Hinge soft close (hand-written qty unclear)', null, 'pc', 4.2, { needs_review: true, ocr_confidence: 0.58, attrs_unmapped: { thickness_mm: '12' } }),
    ],
    provenance: [], messages: [],
  },
}

const audit: AuditEvent[] = [
  { id: 1, at: '2026-10-18T09:00:00+08:00', actor: 'system', entity: 'document', entity_id: 'in-1', event: 'SAMPLE: supplier quote SQ-SAMPLE-101 added to cost book' },
  { id: 2, at: '2026-10-18T09:00:01+08:00', actor: 'system', entity: 'document', entity_id: 'out-1', event: 'SAMPLE: cost rose on plywood_18mm, QT-2026-0007 flagged stale' },
]
const log = (actor: string, entity_id: string, event: string) => audit.push({ id: audit.length + 1, at: new Date().toISOString(), actor, entity: 'document', entity_id, event })

const summary = (d: DocDetail): DocSummary => d.doc
const live = ['draft', 'approved', 'sent', 'read']
const staffView = (d: DocDetail): DocDetail => ({
  doc: { ...d.doc, flags: { cost_is_stale: false, needs_review: d.doc.flags.needs_review } },
  lines: d.lines.map(l => ({ ...l, attrs: Object.fromEntries(Object.entries(l.attrs).filter(([k]) => !fields.find(f => f.key === k)?.owner_only)) })),
  messages: d.messages,
})
const alerts = (): Alert[] => Object.values(docs).filter(d => d.doc.direction === 'out' && live.includes(d.doc.status)).flatMap(d =>
  (d.provenance ?? []).filter(p => p.cost_is_stale).map(p => {
    const line = d.lines.find(l => l.id === p.line_id)!
    return { quote_id: d.doc.id, quote_no: d.doc.doc_no!, customer: d.doc.party.name, item_key: line.item_key ?? line.description,
      old_cost: p.cost_snapshot, current_cost: p.current_unit_cost, margin_delta: money((Number(p.cost_snapshot) - Number(p.current_unit_cost)) * Number(line.qty)), status: d.doc.status }
  }))

export function mock(method: string, path: string, role: Role, body: any): unknown {
  const [p, q = ''] = path.split('?')
  const owner = role === 'owner'
  const need = () => { if (!owner) throw new ApiError(403, 'forbidden', 'Owner role required.') }
  let m: RegExpMatchArray | null
  if (p === '/me') return { role, name: owner ? 'SAMPLE Owner' : 'SAMPLE Staff', org: { name: 'SAMPLE Trading Sdn Bhd', logo_url: null } }
  if (p === '/tracker') {
    const all = Object.values(docs).map(summary).map(s => owner ? s : { ...s, flags: { ...s.flags, cost_is_stale: false } })
    return { received: all.filter(d => d.direction === 'in'), sent: all.filter(d => d.direction === 'out') }
  }
  if ((m = p.match(/^\/documents\/([^/]+)$/))) {
    const d = docs[m[1]]
    if (!d) throw new ApiError(404, 'not_found', 'Document not found.')
    return owner ? d : staffView(d)
  }
  if ((m = p.match(/^\/documents\/([^/]+)\/transition$/)) && method === 'POST') {
    const d = docs[m[1]]
    if (!d) throw new ApiError(404, 'not_found', 'Document not found.')
    const a = (NEXT[d.doc.direction][d.doc.status] ?? []).find(x => x.to === body.to)
    if (!a) throw new ApiError(409, 'transition_not_allowed', `Cannot move from ${d.doc.status} to ${body.to}.`)
    if (a.owner) need()
    log(owner ? 'owner' : 'staff', d.doc.id, `${d.doc.doc_no}: ${d.doc.status} to ${body.to}${body.reason ? ` (${body.reason})` : ''}`)
    d.doc.status = body.to
    d.doc.updated_at = new Date().toISOString()
    return d.doc
  }
  if ((m = p.match(/^\/documents\/([^/]+)\/lines\/([^/]+)$/)) && method === 'POST') {
    const d = docs[m[1]]; const l = d?.lines.find(x => x.id === m![2])
    if (!l) throw new ApiError(404, 'not_found', 'Line not found.')
    if (body.unit_price !== undefined && d.doc.direction === 'out') throw new ApiError(403, 'forbidden', 'Prices on quotes come from the rules engine.')
    if (body.item_key !== undefined) l.item_key = body.item_key
    if (body.qty !== undefined) l.qty = money(Number(body.qty))
    l.needs_review = body.needs_review ?? (l.qty === null || !l.item_key)
    d.doc.flags.needs_review = d.lines.some(x => x.needs_review)
    log(owner ? 'owner' : 'staff', d.doc.id, `${d.doc.doc_no}: line ${l.line_no} edited`)
    return l
  }
  if (p === '/alerts/stale-costs') { need(); return alerts() }
  if (p === '/cost-items') { need(); return [] }
  if (p === '/fields') return fields.filter(f => owner || !f.owner_only)
  if (p === '/field-proposals') { need(); return proposals.filter(x => x.status === 'pending') }
  if ((m = p.match(/^\/field-proposals\/([^/]+)\/decide$/)) && method === 'POST') {
    need()
    const pr = proposals.find(x => x.id === m![1])
    if (!pr) throw new ApiError(404, 'not_found', 'Proposal not found.')
    pr.status = body.decision === 'approve' ? 'approved' : 'ignored'
    if (body.decision === 'approve') {
      fields.push({ key: pr.key, label: body.label || pr.key, type: body.type || 'text', unit: null, options: null, show_in_grid: true, sort_order: 100 })
      Object.values(docs).flatMap(d => d.lines).forEach(l => { if (pr.key in l.attrs_unmapped) { l.attrs[pr.key] = l.attrs_unmapped[pr.key]; delete l.attrs_unmapped[pr.key] } })
    }
    log('owner', pr.id, `Field "${pr.key}" ${pr.status}`)
    return pr
  }
  if (p === '/audit') {
    const after = Number(new URLSearchParams(q).get('after') ?? 0)
    return audit.filter(e => e.id > after)
  }
  throw new ApiError(404, 'not_found', `No mock route for ${method} ${p}`)
}

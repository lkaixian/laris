// SAMPLE data only. Synthetic, invented for demo; no real suppliers, customers or prices.
// Mirrors docs/demo-script.md and db/seed_made_to_order.sql: acrylic RM100/sheet (SAMPLE-A-001), quote SAMPLE-QT-0001
// (40 signboards at RM60 = RM2,400, sent). Upload a newer acrylic quote (RM140), approve it and add it to the cost
// book: the quote goes stale, margin down RM400. Staff never get cost, margin or owner_only attrs.
import { ApiError, NEXT } from './api'
import type { Role, DocDetail, DocSummary, Line, Field, Proposal, AuditEvent, Alert, Provenance } from './api'

const money = (n: number) => n.toFixed(4)
const supA = { id: 'p1', name: 'SAMPLE Supplier A Acrylic Sdn Bhd' }
const cust = { id: 'p3', name: 'SAMPLE Customer Cafe (synthetic)' }
const REVIEWABLE = ['received', 'parsed']
const live = ['draft', 'approved', 'sent', 'read']
const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)

const L = (id: string, n: number, description: string, qty: number | null, uom: string, price: number | null, extra: Partial<Line> = {}): Line => ({
  id, line_no: n, description, qty: qty === null ? null : money(qty), uom, unit_price: price === null ? null : money(price),
  discount_pct: null, tax_rate: null, section: null, is_header: false, needs_review: false, ocr_confidence: null,
  attrs: {}, attrs_unmapped: {}, item_key: null, ...extra,
})
const D = (id: string, direction: 'in' | 'out', doc_no: string, party: { id: string; name: string }, status: string, total: number, issued_on: string | null, flags = { cost_is_stale: false, needs_review: false }): DocSummary => ({
  id, direction, kind: 'quotation', doc_no, party, status, issued_on, valid_until: ago(-30), total: money(total), currency: 'MYR', updated_at: new Date().toISOString(), flags,
})

const fields: (Field & { owner_only?: boolean })[] = [
  { key: 'finishing', label: 'Finishing', type: 'select', unit: null, options: ['gloss', 'matt'], show_in_grid: true, sort_order: 10 },
  { key: 'lead_time_days', label: 'Lead time', type: 'integer', unit: 'days', options: null, show_in_grid: true, sort_order: 20 },
  { key: 'supplier_grade', label: 'Supplier grade', type: 'text', unit: null, options: null, show_in_grid: true, sort_order: 30, owner_only: true },
]
const proposals: Proposal[] = [{ id: 'fp1', key: 'thickness_mm', sample_values: ['3', '5', '3'], status: 'pending' }]

// Current supplier cost per item key (what the cost book would answer). Raised by promoting a newer quote.
const costs: Record<string, number> = { acrylic_3mm_sheet: 100, vinyl_roll: 8 }
// Cost basis of each out line: item, qty consumed per unit sold, cost at pricing time, where it came from.
const basis = [
  { line: 'o1l1', item: 'acrylic_3mm_sheet', per: 0.25, snap: 100, src: 'in-1', srcLine: 'i1l1' },
  { line: 'o1l1', item: 'vinyl_roll', per: 0.5, snap: 8, src: 'in-1', srcLine: 'i1l2' },
]
const OTHER = 8.5 // machine and labour per signboard

const docs: Record<string, DocDetail> = {
  'in-1': {
    doc: D('in-1', 'in', 'SAMPLE-A-001', supA, 'in_cost_book', 108, ago(45)),
    lines: [
      L('i1l1', 1, 'SAMPLE acrylic 3mm sheet', 1, 'sheet', 100, { item_key: 'acrylic_3mm_sheet', attrs: { lead_time_days: 5, supplier_grade: 'A' } }),
      L('i1l2', 2, 'SAMPLE vinyl roll', 1, 'm', 8, { item_key: 'vinyl_roll' }),
    ],
    messages: [],
  },
  'out-1': {
    doc: D('out-1', 'out', 'SAMPLE-QT-0001', cust, 'sent', 2400, null),
    lines: [L('o1l1', 1, 'SAMPLE acrylic signboard 60x30', 40, 'pcs', 60, { item_key: 'signboard_60x30', attrs: { finishing: 'gloss' } })],
    messages: [{ direction: 'out', channel: 'telegram', body: 'SAMPLE message: quotation SAMPLE-QT-0001 sent.', at: new Date().toISOString() }],
  },
}

const audit: AuditEvent[] = []
const log = (actor: string, entity_id: string, event: string) => audit.push({ id: audit.length + 1, at: new Date().toISOString(), actor, entity: 'document', entity_id, event })
log('SAMPLE Staff', 'in-1', 'SAMPLE-A-001: uploaded')
log('SAMPLE Owner', 'in-1', 'SAMPLE-A-001: accepted, added to cost book (acrylic_3mm_sheet RM100)')
log('SAMPLE Owner', 'out-1', 'SAMPLE-QT-0001: approved and sent')

// Provenance and margin are computed from the basis and the current costs, so they move when a quote is promoted.
const prov = (d: DocDetail): Provenance[] => basis.filter(b => d.lines.some(l => l.id === b.line)).map(b => {
  const line = d.lines.find(l => l.id === b.line)!
  const cost = basis.filter(x => x.line === b.line).reduce((a, x) => a + x.per * costs[x.item], 0) + OTHER
  const src = docs[b.src]
  return {
    line_id: b.line, cost_item_id: b.item, supplier: src.doc.party.name, source_doc_id: b.src, source_doc_no: src.doc.doc_no!,
    source_line_id: b.srcLine, cost_date: src.doc.issued_on!, unit_cost: money(b.snap), cost_snapshot: money(b.snap),
    current_unit_cost: money(costs[b.item]), cost_is_stale: costs[b.item] > b.snap, line_margin: money(Number(line.qty) * (Number(line.unit_price) - cost)),
    qty_consumed: money(b.per),
  }
})
const withProv = (d: DocDetail): DocDetail => {
  if (d.doc.direction !== 'out') return d
  const provenance = prov(d)
  d.doc.flags.cost_is_stale = provenance.some(p => p.cost_is_stale)
  return { ...d, provenance }
}
const staffView = (d: DocDetail): DocDetail => ({
  doc: { ...d.doc, flags: { cost_is_stale: false, needs_review: d.doc.flags.needs_review } },
  lines: d.lines.map(l => ({
    ...l,
    unit_price: d.doc.direction === 'out' || REVIEWABLE.includes(d.doc.status) ? l.unit_price : null,
    attrs: Object.fromEntries(Object.entries(l.attrs).filter(([k]) => !fields.find(f => f.key === k)?.owner_only)),
  })),
  messages: d.messages,
})
const alerts = (): Alert[] => Object.values(docs).filter(d => d.doc.direction === 'out' && live.includes(d.doc.status)).flatMap(d =>
  prov(d).filter(p => p.cost_is_stale).map(p => {
    const line = d.lines.find(l => l.id === p.line_id)!
    return { quote_id: d.doc.id, quote_no: d.doc.doc_no!, customer: d.doc.party.name, item_key: p.cost_item_id,
      old_cost: p.cost_snapshot, current_cost: p.current_unit_cost,
      margin_delta: money((Number(p.cost_snapshot) - Number(p.current_unit_cost)) * Number(p.qty_consumed) * Number(line.qty)), status: d.doc.status }
  }))

const down = (t: string) => { if (/ilmu down/i.test(t)) throw new ApiError(502, 'ilmu_unavailable', 'AI extraction failed (SAMPLE: simulated outage); key the lines in manually') }

// Mock contact book: one entry per party that appears in the sample documents.
const contacts = () => {
  const seen = new Map<string, { id: string; role: 'customer' | 'supplier'; name: string }>()
  for (const d of Object.values(docs)) seen.set(d.doc.party.id, { id: d.doc.party.id, role: d.doc.direction === 'in' ? 'supplier' : 'customer', name: d.doc.party.name })
  seen.set('p4', { id: 'p4', role: 'supplier', name: 'SAMPLE Supplier B Footwear (synthetic)' })
  seen.set('p5', { id: 'p5', role: 'supplier', name: 'SAMPLE Supplier C Leather (synthetic)' })
  return [...seen.values()].map(c => ({ ...c, contact: c.role === 'supplier' ? `+60 12-555 ${c.id.replace(/\D/g, '').padStart(4, '0')}` : null, email: null, attention: null, ssm_no: null, address: null, notes: 'SAMPLE contact (mock mode).',
    documents: Object.values(docs).filter(d => d.doc.party.id === c.id).length, last_activity: null, value: null }))
}

// Mock price requests (Ask suppliers). Staff never get the price fields.
const dot = (c: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="${c}"/><circle cx="80" cy="60" r="34" fill="none" stroke="#e00000" stroke-width="4"/></svg>`)}`
const rp = (reply_id: string, supplier_id: string, supplier_name: string, text: string, p: Partial<{ unit_price: string; min_qty: string; tiers: { min_qty: string; unit_price: string }[]; status: string }> = {}) =>
  ({ reply_id, send_id: 's' + reply_id, supplier_id, supplier_name, text, unit_price: null as string | null, min_qty: null as string | null, tiers: [] as { min_qty: string; unit_price: string }[], status: 'waiting', ...p })
const rfqs = [
  { id: 'rfq-1', description: 'ballet flat, cream, strap', note: 'How much for the circled one? Any MOQ or bulk price?', created_at: new Date(Date.now() - 36e5).toISOString(), image_url: dot('#e8dcc8'),
    replies: [
      rp('r1', 'p1', supA.name, 'RM 18 each, min 12 pairs. 100 pairs or more RM 16.', { unit_price: '18.0000', min_qty: '12', tiers: [{ min_qty: '100', unit_price: '16.0000' }], status: 'ready' }),
      rp('r2', 'p4', 'SAMPLE Supplier B Footwear (synthetic)', 'RM 15.50 per pair, MOQ 24.', { unit_price: '15.5000', min_qty: '24', status: 'ready' }),
      rp('r3', 'p5', 'SAMPLE Supplier C Leather (synthetic)', ''),
    ] },
  { id: 'rfq-2', description: 'brass buckle 25mm', note: 'How much for the circled one? Any MOQ or bulk price?', created_at: new Date(Date.now() - 864e5).toISOString(), image_url: dot('#d6d9e0'),
    replies: [
      rp('r4', 'p4', 'SAMPLE Supplier B Footwear (synthetic)', 'RM 2.20 each, no MOQ.', { unit_price: '2.2000', min_qty: '1', status: 'needs_review' }),
      rp('r5', 'p5', 'SAMPLE Supplier C Leather (synthetic)', ''),
    ] },
]

export function mock(method: string, path: string, role: Role, body: any): unknown {
  const [p, q = ''] = path.split('?')
  const owner = role === 'owner'
  const who = owner ? 'SAMPLE Owner' : 'SAMPLE Staff'
  const need = () => { if (!owner) throw new ApiError(403, 'owner_only', 'owner role required') }
  let m: RegExpMatchArray | null
  if (p === '/me') return { id: owner ? 'sample-owner' : 'sample-staff', role, name: who, org: { name: 'SAMPLE Signage Works (synthetic)', logo_url: null } }
  if (p === '/tracker') {
    const all = Object.values(docs).map(withProv).map(d => d.doc).map(s => owner ? s : { ...s, flags: { ...s.flags, cost_is_stale: false } })
    return { received: all.filter(d => d.direction === 'in'), sent: all.filter(d => d.direction === 'out') }
  }
  if (p === '/documents/ingest' && method === 'POST') {
    // Supplier upload: the file or pasted text is not really read. Any upload becomes the newer acrylic quote (RM140).
    const text = String(body.get('text') ?? body.get('file')?.name ?? '')
    down(text)
    if (Object.values(docs).some(d => d.doc.doc_no === 'SAMPLE-A-002')) throw new ApiError(409, 'duplicate', 'document SAMPLE-A-002 already recorded for this supplier')
    const supplier = String(body.get('supplier') || supA.name)
    docs['in-2'] = {
      doc: D('in-2', 'in', 'SAMPLE-A-002', { ...supA, name: supplier }, 'parsed', 140, ago(3), { cost_is_stale: false, needs_review: true }),
      lines: [
        L('i2l1', 1, 'SAMPLE acrylic 3mm sheet', 1, 'sheet', 140, { item_key: 'acrylic_3mm_sheet', ocr_confidence: '0.970' }),
        L('i2l2', 2, 'SAMPLE vinyl roll (quantity unclear on the photo)', null, 'm', 8, { needs_review: true, ocr_confidence: '0.580', attrs_unmapped: { thickness_mm: '3' } }),
      ],
      messages: [],
    }
    log(who, 'in-2', 'SAMPLE-A-002: uploaded')
    return docs['in-2'].doc
  }
  if (p === '/enquiries/simulate' && method === 'POST') {
    down(body.text)
    const qty = Number((String(body.text).match(/\d+/) ?? [])[0])
    if (!qty) throw new ApiError(422, 'no_items', 'could not find any items in the enquiry')
    const n = Object.values(docs).filter(d => d.doc.direction === 'out').length + 1
    const id = `out-${n}`
    docs[id] = {
      doc: D(id, 'out', `SAMPLE-QT-${String(n).padStart(4, '0')}`, cust, 'draft', qty * 60, null),
      lines: [L(`o${n}l1`, 1, 'SAMPLE acrylic signboard 60x30', qty, 'pcs', 60, { item_key: 'signboard_60x30', attrs: { finishing: 'gloss' } })],
      messages: [],
    }
    basis.push({ line: `o${n}l1`, item: 'acrylic_3mm_sheet', per: 0.25, snap: costs.acrylic_3mm_sheet, src: 'in-1', srcLine: 'i1l1' },
      { line: `o${n}l1`, item: 'vinyl_roll', per: 0.5, snap: costs.vinyl_roll, src: 'in-1', srcLine: 'i1l2' })
    log(who, id, `${docs[id].doc.doc_no}: draft created from a simulated ${body.channel} enquiry`)
    return docs[id].doc
  }
  if ((m = p.match(/^\/documents\/([^/]+)$/))) {
    const d = docs[m[1]]
    if (!d) throw new ApiError(404, 'not_found', 'Document not found.')
    return owner ? withProv(d) : staffView(withProv(d))
  }
  if ((m = p.match(/^\/documents\/([^/]+)\/transition$/)) && method === 'POST') {
    const d = docs[m[1]]
    if (!d) throw new ApiError(404, 'not_found', 'Document not found.')
    const a = (NEXT[d.doc.direction][d.doc.status] ?? []).find(x => x.to === body.to)
    if (!a) throw new ApiError(409, 'conflict', `Cannot move from ${d.doc.status} to ${body.to}.`)
    if (a.owner) need()
    log(who, d.doc.id, `${d.doc.doc_no}: ${d.doc.status} to ${body.to}${body.reason ? ` (${body.reason})` : ''}`)
    d.doc.status = body.to
    d.doc.updated_at = new Date().toISOString()
    if (d.doc.direction === 'in' && body.to === 'in_cost_book') {
      for (const l of d.lines) if (l.item_key && l.unit_price) costs[l.item_key] = Number(l.unit_price)
      Object.values(docs).forEach(withProv)
      log('system', d.doc.id, `${d.doc.doc_no}: cost book updated, ${alerts().length} open quote(s) flagged stale`)
    }
    return d.doc
  }
  if ((m = p.match(/^\/documents\/([^/]+)\/lines\/([^/]+)$/)) && method === 'POST') {
    const d = docs[m[1]]; const l = d?.lines.find(x => x.id === m![2])
    if (!l) throw new ApiError(404, 'not_found', 'Line not found.')
    if (d.doc.direction === 'out') throw new ApiError(403, 'rules_only', 'out lines are rules-engine output; only the owner may clear needs_review')
    if (!REVIEWABLE.includes(d.doc.status)) throw new ApiError(409, 'locked', `document is ${d.doc.status}; lines can only be edited while received/parsed`)
    if (body.item_key !== undefined) l.item_key = body.item_key
    if (body.qty !== undefined) l.qty = money(Number(body.qty))
    l.needs_review = body.needs_review ?? (l.qty === null || !l.item_key)
    d.doc.flags.needs_review = d.lines.some(x => x.needs_review)
    log(who, d.doc.id, `${d.doc.doc_no}: line ${l.line_no} edited`)
    return owner ? l : staffView({ ...d, lines: [l] }).lines[0]
  }
  if (p === '/alerts/stale-costs') { need(); return alerts() }
  if (p === '/cost-items') { need(); return [] }
  if (p === '/fields') return fields.filter(f => owner || !f.owner_only)
  if (p === '/reports/margin') { need(); return { days: 7, quotes: 0, revenue: '0', cost: '0', margin: '0', margin_pct: null, won: 0, lost: 0, stale_quotes: 0, stale_margin_lost: '0', lowest_margin: [] } }
  if (p === '/settings') { need(); return { min_margin_pct: '25.00', ssm_no: null, address: null, bank_details: null, sst_registered: false, sst_no: null } }
  if (p === '/dashboard') {
    const all = Object.values(docs).map(d => d.doc), stale = all.filter(d => d.flags.cost_is_stale)
    return { customer_replies: [], contacts: { customers: 1, suppliers: 2, contractors: 0 }, needs_review: all.filter(d => d.flags.needs_review).length,
      open_quotes: all.filter(d => d.direction === 'out').length, jobs: { todo: 0, doing: 0, done: 0 },
      recent_contacts: contacts().slice(0, 3).map(c => ({ id: c.id, name: c.name, role: c.role, last_activity: new Date().toISOString() })),
      recent_documents: all.slice(0, 5).map(d => (owner || d.direction === 'out' ? d : { ...d, total: null })),
      ...(owner ? { stale_quotes: stale.length, stale_margin_lost: '-400', followups_pending: 0 } : {}) }
  }
  if (p === '/assistant/suggestions') return ['What needs my attention?', 'Find the acrylic supplier']
  if (p === '/assistant' && method === 'POST') {
    const stale = owner && Object.values(docs).some(d => d.doc.flags.cost_is_stale)
    return { reply: stale ? 'SAMPLE answer (mock mode): 1 sent quote is hurt by a cost rise, RM400.00 of margin.' : 'SAMPLE answer (mock mode): nothing needs attention.',
      intent: 'attention', items: [{ label: 'Stale costs', href: '#/alerts' }], source: 'keywords', suggestions: [] }
  }
  if (p === '/search') {
    const term = (new URLSearchParams(q).get('q') ?? '').toLowerCase()
    const all = Object.values(docs).map(d => d.doc)
    return { query: term, contacts: contacts().filter(c => JSON.stringify(c).toLowerCase().includes(term)),
      documents: all.filter(d => JSON.stringify(d).toLowerCase().includes(term)).map(d => (owner || d.direction === 'out' ? d : { ...d, total: null })) }
  }
  if (p === '/contacts' && method === 'GET') {
    const term = (new URLSearchParams(q).get('q') ?? '').toLowerCase(), role = new URLSearchParams(q).get('role')
    return contacts().filter(c => (!role || c.role === role) && (!term || JSON.stringify(c).toLowerCase().includes(term)))
  }
  if ((m = p.match(/^\/contacts\/([^/]+)$/)) && method === 'GET') {
    const c = contacts().find(x => x.id === m![1])
    if (!c) throw new ApiError(404, 'not_found', 'contact not found')
    return { ...c, sst_no: null, recent_documents: Object.values(docs).map(d => d.doc).filter(d => d.party.name === c.name) }
  }
  if (p.startsWith('/contacts')) throw new ApiError(409, 'mock', 'Mock mode does not save contacts.')
  if (p === '/users') { need(); return [] }
  if (p === '/jobs') return []  // mock quotes never reach job_created
  if (p === '/followups') return []  // mock data has no quote old enough to chase
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
    log('SAMPLE Owner', pr.id, `Field "${pr.key}" ${pr.status}`)
    return pr
  }
  if (p === '/rfq' && method === 'POST') {
    const ids: string[] = body.getAll('supplier_ids').map(String), image = body.get('image')
    const names = new Map(contacts().map(c => [c.id, c.name]))
    const id = `rfq-${rfqs.length + 1}`
    rfqs.unshift({ id, description: String(body.get('description')), note: String(body.get('note') ?? ''), created_at: new Date().toISOString(),
      image_url: image instanceof Blob ? URL.createObjectURL(image) : dot('#ccc'), replies: ids.map((s, i) => rp(`${id}-r${i}`, s, names.get(s) ?? 'Supplier', '')) })
    log(who, id, `price request sent to ${ids.length} supplier(s)`)
    return { rfq_id: id, sends: ids.map(s => ({ supplier_id: s, status: 'sent', error: null })) }
  }
  if (p === '/rfq' && method === 'GET') {
    return rfqs.map(x => owner ? x : { ...x, replies: x.replies.map(r => ({ ...r, text: '', unit_price: null, min_qty: null, tiers: [] })) })
  }
  if ((m = p.match(/^\/rfq\/([^/]+)\/replies\/([^/]+)\/accept$/)) && method === 'POST') {
    need()
    const r = rfqs.find(x => x.id === m![1])?.replies.find(x => x.reply_id === m![2])
    if (!r) throw new ApiError(404, 'not_found', 'Reply not found.')
    if (!String(body.item_key ?? '').trim()) throw new ApiError(422, 'item_key_required', 'item_key is required')
    if (r.status === 'waiting') throw new ApiError(409, 'conflict', 'This supplier has not replied yet.')
    r.status = 'accepted'
    log(who, r.reply_id, `price accepted for ${body.item_key}`)
    return { ok: true }
  }
  if (p === '/audit') {
    const after = Number(new URLSearchParams(q).get('after') ?? 0)
    return audit.filter(e => e.id > after)
  }
  throw new ApiError(404, 'not_found', `No mock route for ${method} ${p}`)
}

// SAMPLE data only. Synthetic, invented for demo; no real suppliers, customers or prices.
// Mirrors docs/demo-script.md and db/seed_made_to_order.sql: acrylic RM100/sheet (SAMPLE-A-001), quote SAMPLE-QT-0001
// (40 signboards at RM60 = RM2,400, sent). Upload a newer acrylic quote (RM140), approve it and add it to the cost
// book: the quote goes stale, margin down RM400. Staff never get cost, margin or owner_only attrs.
import { ApiError, NEXT } from './api'
import type { Role, DocDetail, DocSummary, Line, Field, Proposal, AuditEvent, Alert, Provenance } from './api'

import { mockListings } from './mockListings'
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

// Mock sessions (Account page): this device plus two others, so sign out one and sign out all others both have something to do.
const minsAgo = (n: number) => new Date(Date.now() - n * 6e4).toISOString()
const sessions = [
  { id: 'se1', created_at: minsAgo(90), last_seen_at: minsAgo(0), user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', current: true },
  { id: 'se2', created_at: minsAgo(60 * 30), last_seen_at: minsAgo(45), user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1', current: false },
  { id: 'se3', created_at: minsAgo(60 * 24 * 6), last_seen_at: null, user_agent: null, current: false },
]

// Mock roles, users and branding (in memory): the Roles, Team and Settings pages work without a server.
const CATALOG = [
  { key: 'view_costs', label: 'See costs and prices', description: 'Supplier prices, cost items, margins and stale-cost alerts.', group: 'Costs and prices', default: false },
  { key: 'view_reports', label: 'See the margin report', description: 'The weekly margin report.', group: 'Costs and prices', default: false },
  { key: 'edit_supplier_contacts', label: 'Edit supplier contacts', description: 'Change a supplier name or number.', group: 'Contacts', default: false },
  { key: 'manage_contacts', label: 'Manage contacts', description: 'Create and edit contacts.', group: 'Contacts', default: true },
  { key: 'upload_documents', label: 'Upload documents', description: 'Add a supplier file or text, or key a document in.', group: 'Documents', default: true },
  { key: 'ask_suppliers', label: 'Ask suppliers', description: 'Send a photographed item to suppliers.', group: 'Suppliers', default: true },
  { key: 'view_replies_prices', label: 'See supplier reply prices', description: 'The words and prices in suppliers replies.', group: 'Suppliers', default: false },
  { key: 'manage_followups', label: 'Send or skip follow-ups', description: 'Act on quotes waiting for a reply.', group: 'Quotes', default: false },
  { key: 'export_data', label: 'Export data', description: 'Download the contact book as CSV.', group: 'Data', default: false },
  { key: 'view_audit', label: 'See the activity log', description: 'The activity feed.', group: 'Activity', default: true },
]
const NON_ASSIGNABLE = [{ key: 'manage_team', label: 'Manage the team' }, { key: 'manage_roles', label: 'Manage roles' }, { key: 'manage_settings', label: 'Manage settings and branding' },
  { key: 'decide_quotes', label: 'Approve, accept, reject or send quotes' }, { key: 'promote_costs', label: 'Add supplier prices to the cost book' }]
const roles = [
  { id: 'r-owner', key: 'owner', name: 'Owner', class: 'owner', is_system: true, permissions: CATALOG.map(p => p.key) },
  { id: 'r-staff', key: 'staff', name: 'Staff', class: 'staff', is_system: true, permissions: CATALOG.filter(p => p.default).map(p => p.key) },
]
const members = [
  { id: 'sample-owner', name: 'SAMPLE Owner', username: 'owner', role: 'owner', role_id: 'r-owner', role_key: 'owner', role_name: 'Owner', active: true, has_password: true, sessions: 1 },
  { id: 'sample-staff', name: 'SAMPLE Staff', username: 'staff', role: 'staff', role_id: 'r-staff', role_key: 'staff', role_name: 'Staff', active: true, has_password: true, sessions: 0 },
]
const checkRole = (name: string, perms: unknown) => {
  if (!name) throw new ApiError(422, 'name_required', 'Name the role.')
  for (const k of (Array.isArray(perms) ? perms : []) as string[]) {
    if (NON_ASSIGNABLE.some(x => x.key === k)) throw new ApiError(422, 'not_assignable', `${k} cannot be given to a role.`)
    if (!CATALOG.some(x => x.key === k)) throw new ApiError(422, 'unknown_permission', `Unknown permission ${k}.`)
  }
}
const roleOf = (key: string) => roles.find(r => r.key === key)
const branding = { display_name: null as string | null, brand_color: null as string | null, logo_data_url: null as string | null }
const setting = { min_margin_pct: '25.00', ssm_no: null as string | null, address: null as string | null, bank_details: null as string | null, sst_registered: false, sst_no: null as string | null }

export function mock(method: string, path: string, role: Role, body: any): unknown {
  const [p, q = ''] = path.split('?')
  const owner = role === 'owner'
  const who = owner ? 'SAMPLE Owner' : 'SAMPLE Staff'
  const need = () => { if (!owner) throw new ApiError(403, 'owner_only', 'owner role required') }
  let m: RegExpMatchArray | null
  if (p === '/me') {
    const r = roleOf(role)!
    return { id: owner ? 'sample-owner' : 'sample-staff', role, role_key: r.key, role_name: r.name, permissions: r.permissions, name: who,
      org: { name: branding.display_name || 'SAMPLE Signage Works (synthetic)', brand_color: branding.brand_color, logo_url: branding.logo_data_url } }
  }
  if (p === '/me/password' && method === 'POST') return { ok: true }
  if (p === '/me/sessions' && method === 'GET') return sessions
  if (p === '/me/sessions/revoke-others' && method === 'POST') {
    const n = sessions.filter(x => !x.current).length
    for (let i = sessions.length - 1; i >= 0; i--) if (!sessions[i].current) sessions.splice(i, 1)
    return { revoked: n }
  }
  if ((m = p.match(/^\/me\/sessions\/([^/]+)$/)) && method === 'DELETE') {
    const i = sessions.findIndex(x => x.id === m![1] && !x.current)
    if (i < 0) throw new ApiError(404, 'not_found', 'Session not found.')
    sessions.splice(i, 1)
    return { ok: true }
  }
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
  if (p === '/settings') {
    need()
    if (method === 'POST') {
      const { display_name, brand_color, logo_data_url, ...rest } = body
      if (brand_color != null && !/^#[0-9a-f]{6}$/i.test(brand_color)) throw new ApiError(422, 'bad_colour', 'brand_color must be #rrggbb')
      if (logo_data_url != null && !/^data:image\/(png|jpeg|webp);base64,/.test(logo_data_url)) throw new ApiError(415, 'unsupported_media', 'logo must be png, jpeg or webp')
      if (logo_data_url != null && logo_data_url.length > 280000) throw new ApiError(413, 'too_large', 'logo is over 200 KB')
      Object.assign(setting, rest); Object.assign(branding, { display_name: display_name || null, brand_color: brand_color ?? null, logo_data_url: logo_data_url ?? null })
    }
    return { ...setting, ...branding }
  }
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
  if (p === '/users' && method === 'GET') { need(); return members }
  if (p === '/users' && method === 'POST') {
    need()
    const r = roleOf(body.role)
    if (!r) throw new ApiError(422, 'unknown_role', 'No such role.')
    members.push({ id: 'u' + (members.length + 1), name: body.name, username: body.username, role: r.class, role_id: r.id, role_key: r.key, role_name: r.name, active: true, has_password: true, sessions: 0 })
    return members[members.length - 1]
  }
  if ((m = p.match(/^\/users\/([^/]+)$/)) && method === 'POST') {
    need()
    const u = members.find(x => x.id === m![1])
    if (!u) throw new ApiError(404, 'not_found', 'User not found.')
    if (body.role) {
      const r = roleOf(body.role)
      if (!r) throw new ApiError(422, 'unknown_role', 'No such role.')
      if (u.role === 'owner' && r.class !== 'owner' && members.filter(x => x.role === 'owner' && x.active).length < 2) throw new ApiError(409, 'last_owner', 'The last active owner cannot be changed.')
      Object.assign(u, { role: r.class, role_id: r.id, role_key: r.key, role_name: r.name, sessions: 0 })
    }
    if (typeof body.active === 'boolean') u.active = body.active
    return u
  }
  if (p === '/roles' && method === 'GET') { need(); return { roles: roles.map(r => ({ ...r, users: members.filter(x => x.role_id === r.id).length })), catalog: CATALOG, non_assignable: NON_ASSIGNABLE } }
  if (p === '/roles' && method === 'POST') {
    need()
    const name = String(body.name ?? '').trim()
    checkRole(name, body.permissions)
    if (roles.some(r => r.name.toLowerCase() === name.toLowerCase())) throw new ApiError(409, 'name_taken', 'A role with that name already exists.')
    const r = { id: 'r-' + Date.now(), key: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, class: 'staff', is_system: false, permissions: body.permissions as string[] }
    roles.push(r)
    return { ...r, users: 0 }
  }
  if ((m = p.match(/^\/roles\/([^/]+)$/)) && (method === 'PATCH' || method === 'DELETE')) {
    need()
    const i = roles.findIndex(x => x.id === m![1])
    if (i < 0) throw new ApiError(404, 'not_found', 'Role not found.')
    const r = roles[i]
    if (method === 'DELETE') {
      if (r.is_system) throw new ApiError(409, 'system_role', 'Built-in roles cannot be deleted.')
      if (members.some(x => x.role_id === r.id)) throw new ApiError(409, 'role_in_use', 'People still hold this role.')
      roles.splice(i, 1)
      return { ok: true }
    }
    if (r.class === 'owner' || (r.is_system && body.name !== undefined && body.name !== r.name)) throw new ApiError(409, 'system_role', 'Built-in role.')
    if (body.permissions !== undefined) checkRole('x', body.permissions)
    if (body.name !== undefined && roles.some(x => x !== r && x.name.toLowerCase() === String(body.name).trim().toLowerCase())) throw new ApiError(409, 'name_taken', 'A role with that name already exists.')
    if (body.name !== undefined) r.name = String(body.name).trim()
    if (body.permissions !== undefined) r.permissions = body.permissions
    return { ...r, users: members.filter(x => x.role_id === r.id).length }
  }
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
  if (p.startsWith('/listings')) { const r = mockListings(method, p, owner, body); if (r !== undefined) return r }
  if (p === '/audit') {
    const after = Number(new URLSearchParams(q).get('after') ?? 0)
    return audit.filter(e => e.id > after)
  }
  throw new ApiError(404, 'not_found', `No mock route for ${method} ${p}`)
}

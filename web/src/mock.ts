// SAMPLE data only. Synthetic, invented for demo; no real suppliers, customers or prices.
// Mirrors docs/demo-script.md and db/seed_made_to_order.sql: acrylic RM100/sheet (SAMPLE-A-001), quote SAMPLE-QT-0001
// (40 signboards at RM60 = RM2,400, sent). Upload a newer acrylic quote (RM140), approve it and add it to the cost
// book: the quote goes stale, margin down RM400. Staff never get cost, margin or owner_only attrs.
import { applyOnb } from './tours'
import type { Onb } from './tours'
import { ApiError, NEXT } from './api'
import type { Role, DocDetail, DocSummary, Line, Field, Proposal, AuditEvent, Alert, Provenance } from './api'

import { mockListings } from './mockListings'
import { mockPrivacy } from './mockPrivacy'
import { mockAi, mockAiOn } from './mockAi'
import { mockAccept } from './mockAccept'
import { mockChain, mockDelivery } from './mockChain'
import { mockReports } from './mockReports'
import { mockRevenue } from './mockRevenue'
import { mockTrack, jobStats, dashTrack, extraMembers, heatOf, mockJobMove } from './mockTrack'
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

// ?approved=1 adds an approved quote with a section header, three lines (one discounted) and messages by email and by an unknown channel. ?sst=1 adds an SST line to previews.
if (new URLSearchParams(location.search).get('approved') === '1') docs['out-2'] = {
  doc: D('out-2', 'out', 'QT-2026-0002', cust, 'approved', 1650, ago(1)),
  lines: [
    L('o2h', 1, 'Shopfront signage', null, '', null, { is_header: true, section: 'Shopfront signage' }),
    L('o2l1', 2, 'SAMPLE acrylic signboard 60x30, gloss', 20, 'pcs', 60, { item_key: 'signboard_60x30' }),
    L('o2l2', 3, 'SAMPLE vinyl lettering, per metre', 15, 'm', 20, { discount_pct: '10.0000' }),
    L('o2l3', 4, 'SAMPLE installation (one visit)', 1, 'job', 150),
  ],
  messages: [{ direction: 'out', channel: 'email', body: 'SAMPLE message: quotation QT-2026-0002 attached.', at: new Date().toISOString() }, { direction: 'in', channel: 'carrier_pigeon', body: 'SAMPLE unknown channel message.', at: new Date().toISOString() }],
}
const mockPreview = (d: DocDetail) => {
  const q = new URLSearchParams(location.search)
  const lines = d.lines.map(l => ({ no: l.line_no, description: l.description, qty: l.qty, uom: l.uom, unit_price: l.unit_price, discount_pct: l.discount_pct, is_header: l.is_header, section: l.section,
    amount: l.is_header ? null : money(Number(l.qty) * Number(l.unit_price) * (1 - Number(l.discount_pct ?? 0) / 100)) }))
  const sub = lines.reduce((a, l) => a + Number(l.amount ?? 0), 0), tax = q.get('sst') === '1' ? sub * 0.08 : null
  const noEmail = q.get('noemail') === '1'
  return {
    doc_no: d.doc.doc_no, status: d.doc.status, customer: { name: d.doc.party.name, attention: 'Ms Aisyah', address: '12 Jalan Contoh\n50000 Kuala Lumpur', email: noEmail ? null : 'hello@cafe.example' },
    issued_on: d.doc.issued_on ?? ago(0), valid_until: d.doc.valid_until, currency: 'MYR', lines, subtotal: money(sub), tax_total: tax === null ? null : money(tax), total: money(sub + (tax ?? 0)),
    payment_terms: setting.quote_payment_terms ?? '50% deposit, balance on delivery.', terms_text: setting.quote_terms_text ?? 'Prices in MYR. Artwork approval needed before production.',
    issuer: { name: branding.display_name || 'SAMPLE Signage Works (synthetic)', address: setting.address ?? '1 Jalan Sampel, 40000 Shah Alam', ssm_no: setting.ssm_no ?? '202401000001', sst_no: setting.sst_registered ? setting.sst_no : null,
      email: setting.issuer_email, phone: setting.issuer_phone, logo_url: branding.logo_data_url, brand_color: branding.brand_color, bank_details: setting.bank_details ?? 'SAMPLE Bank 1234-5678-90' },
    channels: [
      { channel: 'email', to_hint: noEmail ? null : 'h***@cafe.example', available: !noEmail, ...(noEmail ? { reason: 'no_email' } : {}) },
      { channel: 'whatsapp', to_hint: '+60 12-***-4567', available: true },
      { channel: 'telegram', to_hint: null, available: false, reason: 'no_contact' },
    ],
  }
}
const newIn2 = (supplier: string): DocDetail => ({
  doc: D('in-2', 'in', 'SAMPLE-A-002', { ...supA, name: supplier }, 'parsed', 140, ago(3), { cost_is_stale: false, needs_review: true }),
  lines: [
    L('i2l1', 1, 'SAMPLE acrylic 3mm sheet', 1, 'sheet', 140, { item_key: 'acrylic_3mm_sheet', ocr_confidence: '0.970' }),
    L('i2l2', 2, 'SAMPLE vinyl roll (quantity unclear on the photo)', null, 'm', 8, { needs_review: true, ocr_confidence: '0.580', attrs_unmapped: { thickness_mm: '3' } }),
  ],
  messages: [],
})
// ?seed=1 starts with the supplier quote SAMPLE-A-002 already uploaded (status parsed), so line editing can be seen without uploading first.
if (new URLSearchParams(location.search).get('seed') === '1') docs['in-2'] = newIn2(supA.name)
const audit: AuditEvent[] = []
const log = (actor: string, entity_id: string, event: string) => audit.push({ id: audit.length + 1, at: new Date().toISOString(), actor, entity: 'document', entity_id, event })
// SAMPLE history so the activity log has something to filter in mock mode (oldest first, like the server's ids).
;([[30, 'SAMPLE Owner', 'tenants', 'settings changed: name'], [12, 'SAMPLE Staff', 'listing_items', 'catalog product confirmed'], [9, 'system:scheduler', 'documents', 'status sent->expired'],
  [6, 'SAMPLE Owner', 'documents', 'insert'], [5, 'SAMPLE Owner', 'documents', 'status draft->approved'], [4, 'SAMPLE Staff', 'jobs', 'job changed: status'],
  [3, 'SAMPLE Owner', 'followups', 'follow-up skipped'], [2, 'SAMPLE Owner', 'jobs', 'insert'], [1, 'SAMPLE Staff', 'parties', 'contact created'], [0.2, 'SAMPLE Owner', 'jobs', 'job changed: priority']] as const)
  .forEach(([d, actor, entity, event]) => audit.push({ id: audit.length + 1, at: new Date(Date.now() - d * 864e5).toISOString(), actor, entity, entity_id: `sample-${audit.length + 1}`, event }))
// Sample before/after for a few entries so the detail view has something to show.
const BA: Record<string, [Record<string, unknown>, Record<string, unknown>]> = {
  'job changed: priority': [{ priority: 'normal' }, { priority: 'urgent' }], 'job changed: status': [{ status: 'todo' }, { status: 'doing' }],
  'status draft->approved': [{ status: 'draft' }, { status: 'approved' }], 'settings changed: name': [{ display_name: 'SAMPLE Shop' }, { display_name: 'SAMPLE Signs Sdn Bhd' }],
}
const myDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })
const actionOf = (e: string) => e === 'insert' ? 'created' : /^status .+->/.test(e) ? 'status' : 'other'
function auditMatch(q: URLSearchParams) {
  const from = q.get('from'), to = q.get('to'), words = (q.get('q') ?? '').toLowerCase()
  return audit.map(e => ({ ...e, action: actionOf(e.event) })).filter(e => (!from || myDay(e.at) >= from) && (!to || myDay(e.at) <= to)
    && (!q.get('actor') || e.actor === q.get('actor')) && (!q.get('module') || e.entity === q.get('module')) && (!q.get('action') || e.action === q.get('action'))
    && (!words || e.event.toLowerCase().includes(words))).sort((a, b) => b.id - a.id)
}
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
  { id: 'rfq-1', description: 'ballet flat, cream, strap', note: 'How much for the marked one? Any MOQ or bulk price?', created_at: new Date(Date.now() - 36e5).toISOString(), image_url: dot('#e8dcc8'),
    replies: [
      rp('r1', 'p1', supA.name, 'RM 18 each, min 12 pairs. 100 pairs or more RM 16.', { unit_price: '18.0000', min_qty: '12', tiers: [{ min_qty: '100', unit_price: '16.0000' }], status: 'ready' }),
      rp('r2', 'p4', 'SAMPLE Supplier B Footwear (synthetic)', 'RM 15.50 per pair, MOQ 24.', { unit_price: '15.5000', min_qty: '24', status: 'ready' }),
      rp('r3', 'p5', 'SAMPLE Supplier C Leather (synthetic)', ''),
    ] },
  { id: 'rfq-2', description: 'brass buckle 25mm', note: 'How much for the marked one? Any MOQ or bulk price?', created_at: new Date(Date.now() - 864e5).toISOString(), image_url: dot('#d6d9e0'),
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
  { key: 'view_revenue', label: 'See revenue and profit', description: 'The Revenue page: money in and out, untung kasar and untung bersih. Also needs See costs and prices.', group: 'Costs and prices', default: false },
  { key: 'record_expenses', label: 'Record running costs', description: 'Add rent, wages and bills to the Revenue page. Only the owner can void one.', group: 'Costs and prices', default: false },
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
// Test switches (query before the hash): ?perms=none gives the staff role no permissions at all, ?deny=1 makes every gated write answer 403 permission_required
// even though /me lists the permissions (shows the 403 handling), ?jobs=0 starts with no jobs (see mockTrack.ts for the track and jobs switches), ?tenants=one hides the channels warning, ?wa=1 starts with WhatsApp mapped.
const Q = new URLSearchParams(location.search)
const permsOf = (r: { key: string; permissions: string[] }) => (Q.get('perms') === 'none' && r.key !== 'owner' ? [] : r.permissions)
const channels = { wa: Q.get('wa') === '1' ? '60123456789' : null as string | null }
const tg = { on: null as boolean | null, linked: new Set(['sample-owner']), gets: 0 }
const BOT_DEFAULTS = { welcome: 'Hi! Thanks for messaging us. Tell us what you need and we will get back to you.', help: 'Send us a message, a photo or a voice note. We will reply as soon as we can.', after_hours_message: 'We are closed right now. We will reply when we open.' }
const botSettings = { welcome: BOT_DEFAULTS.welcome, help: BOT_DEFAULTS.help, language: 'auto', quick_replies: ['Get a quote', 'Opening hours'], reactions: true,
  after_hours: { enabled: true, message: BOT_DEFAULTS.after_hours_message, open: '09:00', close: '18:00', days: [1, 2, 3, 4, 5] } }
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
const setting = { min_margin_pct: '25.00', ssm_no: null as string | null, address: null as string | null, bank_details: null as string | null, sst_registered: false, sst_no: null as string | null,
  quote_validity_days: 30 as number | null, quote_prefix: 'QT' as string | null, quote_payment_terms: null as string | null, quote_terms_text: null as string | null, issuer_email: null as string | null, issuer_phone: null as string | null }
// Quote settings validation like the server (422 with fields[]).
function checkQuoteSettings(b: any) {
  const bad = (field: string, message: string) => { const e = new ApiError(422, 'invalid', message); e.fields = [{ field, message }]; return e }
  const v = b.quote_validity_days
  if (v != null && !(Number.isInteger(v) && v >= 1 && v <= 365)) throw bad('quote_validity_days', 'must be a whole number from 1 to 365')
  if (b.quote_prefix != null && !/^[A-Z0-9-]{1,8}$/.test(b.quote_prefix)) throw bad('quote_prefix', 'must be 1 to 8 capital letters, digits or dashes')
  if (b.quote_payment_terms != null && String(b.quote_payment_terms).length > 500) throw bad('quote_payment_terms', 'at most 500 characters')
  if (b.quote_terms_text != null && String(b.quote_terms_text).length > 2000) throw bad('quote_terms_text', 'at most 2000 characters')
  if (b.issuer_email != null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.issuer_email)) throw bad('issuer_email', 'must be an email address')
  if (b.issuer_phone != null && String(b.issuer_phone).length > 40) throw bad('issuer_phone', 'at most 40 characters')
  if ('quote_validity_days' in b && v == null) b.quote_validity_days = 30
  if ('quote_prefix' in b && b.quote_prefix == null) b.quote_prefix = 'QT'
}


// ---- onboarding and licence (step 97). Verify accepts 123456. Licence is off (enforced:false) unless the URL has ?licence=missing|expired|expiring.
const flag = new URLSearchParams(location.search).get('licence') ?? ''
const lic = { status: flag === 'expiring' ? 'expiring' : flag === 'expired' ? 'expired' : flag === 'missing' ? 'missing' : 'active', plan: null as string | null, seats: null as number | null, expires_at: null as string | null, days_left: null as number | null }
if (flag === 'expiring') Object.assign(lic, { plan: 'standard', seats: 10, expires_at: ago(-9), days_left: 9 })
if (flag === 'expired') Object.assign(lic, { plan: 'standard', seats: 10, expires_at: ago(3), days_left: -3 })
const licBlocked = () => !!flag && !['active', 'expiring'].includes(lic.status)
const PLANS = [{ key: 'starter', name: 'Starter', seats: 3, price: 'Contact us' }, { key: 'standard', name: 'Standard', seats: 10, price: 'Contact us' }, { key: 'pro', name: 'Pro', seats: 25, price: 'Contact us' }]
const NEUTRAL = 'If this email can be used, we sent a 6-digit code'
const devCode = () => (flag === 'nodev' ? {} : { dev_code: '123456' })
function mockPublic(method: string, p: string, body: any): unknown {
  const email = String(body?.email ?? '').trim()
  if (method === 'POST' && p === '/signup/check') return { available: !/^(taken|demo|acme)/i.test(String(body.name).trim()) }  // mock: names starting taken, demo or acme are in use
  if (method === 'POST' && p === '/signup') {
    if (!['made_to_order', 'fnb_catering', 'tailoring', 'aircon_service'].includes(body.trade_template)) throw new ApiError(422, 'unknown_template', 'That business type is not available.')
    if (String(body.password).length < 10) throw new ApiError(422, 'weak_password', 'That password is too weak. Use at least 10 characters.')
    if (/^(password|1234567890)/i.test(String(body.password))) throw new ApiError(422, 'weak_password', 'That password is too common. Pick a longer, less guessable one.')
    return { ok: true, message: NEUTRAL, ...devCode() }
  }
  if (method === 'POST' && (p === '/signup/resend' || p === '/password/forgot')) return { ok: true, message: NEUTRAL, ...devCode() }
  if (method === 'POST' && (p === '/signup/verify' || p === '/password/reset')) {
    if (body.code !== '123456') throw new ApiError(400, 'invalid_code', 'invalid or expired code')
    if (p === '/password/reset' && String(body.new_password).length < 10) throw new ApiError(422, 'weak_password', 'That password is too weak. Use at least 10 characters.')
    return { ok: true, email }
  }
  return undefined
}
function mockLicense(method: string, p: string, owner: boolean, body: any): unknown {
  if (method === 'GET' && p === '/license/plans') return { plans: PLANS }
  if (method === 'GET' && p === '/license') {
    return { ...lic, seats_used: 2, enforced: !!flag, read_only: licBlocked(), clock: flag ? { source: 'system', trusted_at: null, rollback: flag === 'expired' } : null }
  }
  if (method === 'POST' && p === '/license') {
    if (!owner) throw new ApiError(403, 'owner_only', 'owner role required')
    const key = String(body.key ?? '').trim()
    if (!key.startsWith('LARIS1.') || key.length < 14) throw new ApiError(422, 'invalid_license', 'That licence key is not valid. (not for this email)')
    Object.assign(lic, { status: 'active', plan: 'standard', seats: 10, expires_at: ago(-365), days_left: 365 })
    return { ...lic, seats_used: 2, enforced: !!flag, read_only: false, clock: { source: 'system', trusted_at: null, rollback: false } }
  }
  if (method === 'POST' && p === '/license/request') {
    if (!owner) throw new ApiError(403, 'owner_only', 'owner role required')
    if (flag === 'noemail') throw new ApiError(422, 'email_needed', 'The owner account needs a verified email.')
    return { ok: true, id: 'req-1' }
  }
  return undefined
}

// ---- invites (step 100). Tokens: 'good' previews Acme Printing / Staff / new.hire@demo.test, 'bad' is invalid. Accept refuses username 'taken'.
const at = (hours: number) => new Date(Date.now() + hours * 36e5).toISOString()
type Inv = { id: string; email: string; role_key: string; role_name: string; status: 'pending' | 'accepted' | 'revoked' | 'expired'; invited_by_name: string; created_at: string; expires_at: string }
const invites: Inv[] = [
  { id: 'inv-1', email: 'alex.tan@demo.test', role_key: 'staff', role_name: 'Staff', status: 'pending', invited_by_name: 'SAMPLE Owner', created_at: at(-3), expires_at: at(24 * 7 - 3) },
  { id: 'inv-2', email: 'old.offer@demo.test', role_key: 'staff', role_name: 'Staff', status: 'expired', invited_by_name: 'SAMPLE Owner', created_at: at(-24 * 10), expires_at: at(-24 * 3) },
  { id: 'inv-3', email: 'sam.lee@demo.test', role_key: 'staff', role_name: 'Staff', status: 'accepted', invited_by_name: 'SAMPLE Owner', created_at: at(-24 * 4), expires_at: at(24 * 3) },
]
function mockInvites(method: string, p: string, owner: boolean, body: any): unknown {
  const need = () => { if (!owner) throw new ApiError(403, 'owner_only', 'owner role required') }
  const gone = () => new ApiError(404, 'invite_invalid', 'This invitation is no longer valid')
  let m: RegExpMatchArray | null
  if (method === 'POST' && p === '/invites/preview') {
    if (body?.token !== 'good') throw gone()
    return { business_name: 'Acme Printing', role_name: 'Staff', email: 'new.hire@demo.test' }
  }
  if (method === 'POST' && p === '/invites/accept') {
    if (body?.token !== 'good') throw gone()
    if (String(body.username).toLowerCase() === 'taken') throw new ApiError(409, 'username_taken', 'That username is already used. Choose another.')
    if (String(body.password).length < 10) throw new ApiError(422, 'weak_password', 'That password is too weak. Use at least 10 characters.')
    return { ok: true }
  }
  if (p === '/invites' && method === 'GET') { need(); return invites }
  if (p === '/invites' && method === 'POST') {
    need()
    const email = String(body?.email ?? '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(422, 'invalid_email', 'Enter a valid email address.')
    const r = roleOf(body.role ?? 'staff')
    if (!r) throw new ApiError(422, 'unknown_role', 'No such role.')
    if (members.some(x => x.username?.toLowerCase() === email) || email === 'member@demo.test') throw new ApiError(409, 'already_member', 'That person already belongs to this business.')
    if (email === 'full@demo.test') throw new ApiError(409, 'seat_limit', 'No free seat. Raise the plan or deactivate someone first.')
    invites.forEach(i => { if (i.email === email && i.status === 'pending') i.status = 'revoked' })
    const inv: Inv = { id: 'inv-' + Date.now(), email, role_key: r.key, role_name: r.name, status: 'pending', invited_by_name: 'SAMPLE Owner', created_at: at(0), expires_at: at(24 * 7) }
    invites.unshift(inv)
    return inv
  }
  if ((m = p.match(/^\/invites\/([^/]+)\/resend$/)) && method === 'POST') {
    need()
    const i = invites.find(x => x.id === m![1])
    if (!i || !['pending', 'expired'].includes(i.status)) throw new ApiError(404, 'not_found', 'Invitation not found.')
    Object.assign(i, { status: 'pending', created_at: at(0), expires_at: at(24 * 7) })
    return i
  }
  if ((m = p.match(/^\/invites\/([^/]+)$/)) && method === 'DELETE') {
    need()
    const i = invites.find(x => x.id === m![1])
    if (!i) throw new ApiError(404, 'not_found', 'Invitation not found.')
    i.status = 'revoked'
    return { ok: true }
  }
  return undefined
}

// SAMPLE follow-ups, one per age band (days since the quote was sent).
const followupDone = new Set<string>()
const FOLLOWUPS = ([[9, 'QT-2026-0003', 'Kopi Corner'], [5, 'QT-2026-0007', 'Pak Hassan Printing'], [3, 'QT-2026-0009', 'Studio Lim'], [2, 'QT-2026-0011', 'Warung Ali']] as const)
  .map(([d, no, who], i) => ({ id: `fu-${i + 1}`, document_id: `doc-fu-${i + 1}`, doc_no: no, customer: `${who} (SAMPLE)`, status: 'sent', days_waiting: d,
    due_at: new Date(Date.now() - (d - 2) * 864e5).toISOString(), reason: 'no reply since sent', suggested_text: i === 2 ? null : `Hi ${who}, just checking on quote ${no}. Any questions? (SAMPLE)` }))
export function mock(method: string, path: string, role: Role, body: any): unknown {
  const [p, q = ''] = path.split('?')
  const owner = role === 'owner'
  const who = owner ? 'SAMPLE Owner' : 'SAMPLE Staff'
  const need = () => { if (!owner) throw new ApiError(403, 'owner_only', 'owner role required') }
  let m: RegExpMatchArray | null
  // Server-side permission check for a write route: 403 permission_required without the key (or always with ?deny=1).
  const perm = (k: string) => { if (Q.get('deny') === '1' || !permsOf(roleOf(role)!).includes(k)) throw new ApiError(403, 'permission_required', `missing permission: ${k}`) }
  if (p.startsWith('/invites')) { const r = mockInvites(method, p, owner, body); if (r !== undefined) return r }
  if (/^\/(signup|password\/(forgot|reset))/.test(p)) { const r = mockPublic(method, p, body); if (r !== undefined) return r }
  if (p.startsWith('/license')) { const r = mockLicense(method, p, owner, body); if (r !== undefined) return r }
  if (method !== 'GET' && licBlocked() && !p.startsWith('/me')) throw new ApiError(402, 'license_required', 'Your licence is missing or expired, so changes are not allowed.')
  if (method === 'GET' && p === '/system/health') {  // ?health=ok|info|warn|critical|fail (default warn)
    need()
    const k = Q.get('health') ?? 'warn'
    if (k === 'fail') throw new ApiError(500, 'internal', 'Internal error')
    const all = [
      { level: 'critical', code: 'database_backup_missing', message: 'No database backup has run in 7 days.', fix: 'Run scripts/backup.sh or schedule it, then check again.' },
      { level: 'warn', code: 'email_off', message: 'Email is not set up, so sign-up codes and invitations are not sent.', fix: 'Set MAILTRAP_API_TOKEN in the server environment and restart.' },
      { level: 'info', code: 'whatsapp_unmapped', message: 'WhatsApp is not connected.', fix: 'Open Settings, Channels and enter your WhatsApp phone number ID.' },
    ]
    const rank = ['info', 'warn', 'critical']
    const items = k === 'ok' ? [] : all.filter(i => rank.indexOf(i.level) <= rank.indexOf(k))
    const base = [['database', 'ok'], ['licence', 'ok'], ['clock', 'warn'], ['scheduler', 'ok'], ['rag', 'off'], ['mcp', 'off'], ['ilmu', 'set'], ['vision', 'set'], ['ocr', 'ok'],
      ['email', 'set'], ['telegram', 'set'], ['telegram_helper', 'off'], ['whatsapp', 'off']]
    const isLive = new URLSearchParams(q).get('live') === '1'  // ?live=1: the services that were only "set" are called now (plausible answers; nothing is sent anywhere)
    const found: Record<string, object> = { ilmu: { state: 'ok', ms: 212 }, vision: { state: 'down', why: 'timeout', ms: 4000 }, telegram: { state: 'down', why: 'webhook_missing', ms: 340 },
      email: { state: 'down', why: 'key_rejected', ms: 180 } }
    const services = base.map(([key, state]) => ({ key, state, ...(isLive ? found[key] : {}) }))
    return { level: items.length ? rank[Math.max(...items.map(i => rank.indexOf(i.level)))] : 'ok', items, services, ...(isLive ? { checked_at: new Date().toISOString() } : {}) }
  }
  { const r = mockAccept(method, p, body, owner, id => docs[id]?.doc.status); if (r !== undefined) return r }
  { const r = mockDelivery(method, p, body); if (r !== undefined) return r }
  if (p === '/me/onboarding') return mockOnboarding(method, owner, body)
  { const r = mockPrivacy(method, p, owner, body); if (r !== undefined) return r }
  { const r = mockAi(method, p, owner, body); if (r !== undefined) return r }
  if (p === '/me') {
    const r = roleOf(role)!
    return { id: owner ? 'sample-owner' : 'sample-staff', role, role_key: r.key, role_name: r.name, permissions: permsOf(r), telegram_linked: tg.linked.has(owner ? 'sample-owner' : 'sample-staff'), name: who, ai_guide: mockAiOn,
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
    docs['in-2'] = newIn2(supplier)
    log(who, 'in-2', 'SAMPLE-A-002: uploaded')
    return docs['in-2'].doc
  }
  if (p === '/documents/import-sent' && method === 'POST') {
    // The file or text is not really read: any upload becomes a sent quote for the named customer.
    need()
    const name = String(body.get('customer') ?? '').trim()
    if (!name) throw new ApiError(422, 'validation', 'customer is required')
    const id = 'out-imp-' + Object.keys(docs).length
    docs[id] = { doc: D(id, 'out', `QT-2026-${String(900 + Object.keys(docs).length).padStart(4, '0')}`, { id: 'p-imp', name }, 'sent', 780, ago(0)),
      lines: [L(id + 'l1', 1, 'SAMPLE acrylic signboard 60x30', 6, 'pcs', 120, {}), L(id + 'l2', 2, 'SAMPLE installation', 1, 'job', 60, {})], messages: [] }
    log(who, id, 'own quotation added as sent')
    return docs[id].doc
  }
  if (p === '/enquiries/simulate' && method === 'POST') {
    perm('manage_contacts')
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
  if ((m = p.match(/^\/documents\/([^/]+)\/(preview|export|send)$/))) {
    const d = docs[m[1]]
    if (!d || d.doc.direction !== 'out') throw new ApiError(404, 'not_found', 'Document not found.')
    if (m[2] === 'preview') return mockPreview(d)
    if (m[2] === 'export') {
      const sp = new URLSearchParams(q), fmt = sp.get('format') ?? '', variant = sp.get('variant') ?? 'customer'
      if (!['pdf', 'xlsx', 'csv'].includes(fmt) || !['customer', 'internal'].includes(variant)) throw new ApiError(400, 'bad_param', 'format or variant is not valid')
      if (variant === 'internal') {
        if (fmt === 'pdf') throw new ApiError(415, 'unsupported_media', 'internal PDF is not available')
        perm('export_data'); perm('view_costs')
      }
      const type = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv' }[fmt]
      return new Blob([`SAMPLE ${variant} ${fmt} for ${d.doc.doc_no} (mock mode)\n`], { type })
    }
    need()
    if (method !== 'POST') throw new ApiError(404, 'not_found', 'No mock route.')
    if (!['approved', 'sent', 'read'].includes(d.doc.status)) throw new ApiError(409, 'not_sendable', `Cannot send a ${d.doc.status} quote.`)
    const ch = mockPreview(d).channels.find(c => c.channel === body?.channel)
    if (!ch) throw new ApiError(422, 'bad_channel', 'Unknown channel.')
    if (!ch.available) throw new ApiError(422, ch.reason!, ch.reason === 'no_email' ? 'This customer has no email.' : 'This customer has no chat contact.')
    if (Q.get('slowdown') === '1') throw new ApiError(429, 'slow_down', 'Too many sends. Wait a moment.')
    if (Q.get('sendfail') === '1') return { delivery: { channel: ch.channel, status: 'failed', error: 'The mail server refused the message (simulated).' }, status: d.doc.status }
    d.messages.push({ direction: 'out', channel: ch.channel, body: body?.message || `SAMPLE message: quotation ${d.doc.doc_no} sent.`, at: new Date().toISOString() })
    if (d.doc.status === 'approved') { log(who, d.doc.id, `${d.doc.doc_no}: approved to sent`); d.doc.status = 'sent'; d.doc.updated_at = new Date().toISOString() }
    return { delivery: { channel: ch.channel, status: 'delivered' }, status: d.doc.status }
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
    if (a.owner) need(); else perm('upload_documents')
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
    perm('upload_documents'); if (body.unit_price !== undefined) perm('view_costs')
    const d = docs[m[1]]; const l = d?.lines.find(x => x.id === m![2])
    if (!l) throw new ApiError(404, 'not_found', 'Line not found.')
    if (d.doc.direction === 'out') throw new ApiError(403, 'rules_only', 'out lines are rules-engine output; only the owner may clear needs_review')
    if (!REVIEWABLE.includes(d.doc.status)) throw new ApiError(409, 'locked', `document is ${d.doc.status}; lines can only be edited while received/parsed`)
    if (body.item_key !== undefined) l.item_key = body.item_key
    if (body.qty !== undefined) l.qty = money(Number(body.qty))
    if (body.unit_price !== undefined) l.unit_price = money(Number(body.unit_price))
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
      checkQuoteSettings(rest)
      Object.assign(setting, rest); Object.assign(branding, { display_name: display_name || null, brand_color: brand_color ?? null, logo_data_url: logo_data_url ?? null })
    }
    return { ...setting, ...branding }
  }
  if (p === '/dashboard') {
    const all = Object.values(docs).map(d => d.doc), stale = all.filter(d => d.flags.cost_is_stale)
    return { customer_replies: [], contacts: { customers: 1, suppliers: 2, contractors: 0 }, needs_review: all.filter(d => d.flags.needs_review).length,
      open_quotes: all.filter(d => d.direction === 'out').length, ...jobStats(), track: dashTrack(),
      recent_contacts: contacts().slice(0, 3).map(c => ({ id: c.id, name: c.name, role: c.role, last_activity: new Date().toISOString() })),
      recent_documents: all.slice(0, 5).map(d => (owner || d.direction === 'out' ? d : { ...d, total: null })),
      ...(owner ? { stale_quotes: stale.length, stale_margin_lost: '-400', followups_pending: 0, quote_speed: { median_minutes: 4.5, quotes: 6, days: 30 } } : {}) }
  }
  if (p === '/assistant/suggestions') return ['What needs my attention?', 'Move job QT-2026-0005 to done', 'Skip the follow-up for Kopi Corner']
  if (p === '/assistant' && method === 'POST') {
    const jm = mockJobMove(String(body?.message ?? ''))
    if (jm) return jm
    if (/skip/i.test(body?.message ?? '') && /follow/i.test(body?.message ?? '')) {
      const open = FOLLOWUPS.filter(f => !followupDone.has(f.id)).slice(0, 3)
      return { reply: 'SAMPLE (mock mode): skipping means no chase message is sent. Nothing changes until you confirm.', intent: 'followup_skip', source: 'keywords', suggestions: [],
        items: [{ label: 'Open Follow-ups', href: '#/followups' }], actions: open.map(f => ({ kind: 'followup_skip', id: f.id, label: `Skip the follow-up for ${f.doc_no} (${f.customer})` })) }
    }
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
  if (p.startsWith('/contacts')) {
    perm('manage_contacts')
    if (body?.role === 'supplier' || (p !== '/contacts' && (body?.name !== undefined || body?.contact !== undefined) && contacts().find(c => c.id === p.split('/')[2])?.role === 'supplier')) perm('edit_supplier_contacts')
  }
  if (p.startsWith('/contacts')) throw new ApiError(409, 'mock', 'Mock mode does not save contacts.')
  if (p === '/users' && method === 'GET') { need(); return [...members, ...extraMembers()].map(x => ({ ...x, telegram_linked: tg.linked.has(x.id) })) }
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
  { const r = mockReports(method, p, q, owner); if (r !== undefined) return r }
  { const r = mockChain(method, p, q, owner, body); if (r !== undefined) return r }
  { const r = mockRevenue(method, p, q, { owner, perm }, body); if (r !== undefined) return r }
  { const r = mockTrack(method, p, q, { owner, me: owner ? 'sample-owner' : 'sample-staff', perm, people: members.filter(x => x.active).map(x => x.id), doc: id => docs[id]?.doc }, body); if (r !== undefined) return r }
  // Telegram. Switches: ?tg=1 connected, ?tg=none (or no switch) shows one-tap create and flips to connected after about 3 polls, ?tg=link_first, ?tg=unavailable, ?tg=attention, ?tg=env, ?tg=checking, ?helper=off. Token "bad", "inuse", "down", "nourl", "nokey" give each error.
  if (p === '/settings/telegram') {
    need()
    const src = Q.get('tg') === 'env' ? 'environment' : 'dashboard'
    if (tg.on === null) tg.on = ['1', 'attention', 'env', 'checking'].includes(Q.get('tg') ?? '')
    const bot = tg.on ? { connected: true, username: 'acme_shop_bot', name: 'Acme Shop', webhook_ok: Q.get('tg') === 'attention' ? false : Q.get('tg') === 'checking' ? null : true, last_error: Q.get('tg') === 'attention' ? 'Wrong response from the webhook: 502' : null, source: src }
      : { connected: false, username: null, name: null, webhook_ok: null, last_error: null, source: null }
    const t = Q.get('tg')
    Object.assign(bot, { create_link: t === 'unavailable' || t === 'link_first' ? null : 'https://t.me/newbot/laris_helper_bot/acme_shop_bot?name=Acme+Shop', create_blocked: t === 'link_first' || t === 'unavailable' ? t : null })
    if (!tg.on && t === 'none' && ++tg.gets >= 5) tg.on = true  // load + 3 polls, then the owner "tapped Create"
    return { helper: Q.get('helper') === 'off' ? { configured: false, username: null, link: null } : { configured: true, username: 'laris_helper_bot', link: 'https://t.me/laris_helper_bot' }, bot,
      staff: members.map(x => ({ user_id: x.id, name: x.name, role: x.role_name, linked: tg.linked.has(x.id) })) }
  }
  if (p === '/settings/telegram/bot-settings') {
    need()
    if (method === 'POST') {
      const b = body ?? {}, bad = (field: string, message: string) => { const e = new ApiError(422, 'invalid', message); e.fields = [{ field, message }]; throw e }
      if (typeof b.welcome === 'string' && !b.welcome.trim()) bad('welcome', 'cannot be empty')
      if (typeof b.help === 'string' && b.help.length > 1000) bad('help', 'must be 1000 characters or fewer')
      if (Array.isArray(b.quick_replies) && b.quick_replies.some((x: string) => x.length < 1 || x.length > 40)) bad('quick_replies', 'each button must be 1 to 40 characters')
      Object.assign(botSettings, b, b.after_hours ? { after_hours: { ...botSettings.after_hours, ...b.after_hours } } : {})
    }
    return { ...botSettings, defaults: BOT_DEFAULTS }
  }
  if (p === '/settings/telegram/connect' || p === '/settings/telegram/disconnect') {
    need()
    if (p.endsWith('connect') && !p.endsWith('disconnect')) {
      const t = String(body?.token ?? '')
      const bad: Record<string, [number, string]> = { bad: [422, 'bad_token'], inuse: [409, 'bot_in_use'], down: [502, 'telegram_unreachable'], nourl: [422, 'public_url_unset'], nokey: [422, 'secret_key_unset'] }
      if (bad[t]) throw new ApiError(bad[t][0], bad[t][1], bad[t][1])
      tg.on = true
    } else tg.on = false
    return tg.on ? { connected: true, username: 'acme_shop_bot', name: 'Acme Shop', webhook_ok: true, last_error: null, source: 'dashboard' } : { connected: false, username: null, name: null, webhook_ok: null, last_error: null, source: null }
  }
  if ((m = p.match(/^\/(?:users\/([^/]+)|me)\/telegram-link$/))) {
    const uid = m[1] ?? (owner ? 'sample-owner' : 'sample-staff')
    if (m[1]) need()
    if (method === 'DELETE') { tg.linked.delete(uid); return { ok: true } }
    if (Q.get('helper') === 'off') throw new ApiError(409, 'helper_not_configured', 'helper bot not configured')
    return { url: 'https://t.me/laris_helper_bot?start=7Hk2mQ9xPz', code: '7Hk2mQ9xPz', expires_at: new Date(Date.now() + 15 * 60_000).toISOString() }
  }
  if (p === '/settings/channels') {
    need()
    if (method === 'POST') {
      const v = body?.wa_phone_number_id
      if (v !== null && !/^\d{5,32}$/.test(String(v))) throw new ApiError(422, 'invalid', 'wa_phone_number_id must be 5 to 32 digits')
      if (v === '99999999') throw new ApiError(409, 'number_in_use', 'that number is connected to another business')
      channels.wa = v
    }
    return { wa_phone_number_id: channels.wa, whatsapp_mapped: channels.wa !== null, telegram_mapped: false, tenants_total_hint: Q.get('tenants') !== 'one' }
  }
  if (p === '/followups' && Q.get('perms') === 'none' && role !== 'owner') throw new ApiError(403, 'permission_required', 'missing permission: manage_followups')
  if (p === '/followups') return FOLLOWUPS.filter(f => !followupDone.has(f.id)).map(f => ({ ...f, heat: heatOf('sent', f.days_waiting) }))
  if (p.startsWith('/followups/') && method === 'POST') { followupDone.add(p.split('/')[2]); return { id: p.split('/')[2], state: body.action === 'send' ? 'sent' : 'skipped' } }
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
  if (p.startsWith('/listings') || p.startsWith('/catalog')) { const r = mockListings(method, p, owner, body); if (r !== undefined) return r }
  if (p === '/audit/facets') return { people: [...new Set(audit.map(e => e.actor))].sort(), modules: [...new Set(audit.map(e => e.entity))].sort() }
  if (p === '/audit/days') {
    const n: Record<string, number> = {}
    audit.forEach(e => { n[myDay(e.at)] = (n[myDay(e.at)] ?? 0) + 1 })
    return Object.keys(n).sort().reverse().map(day => ({ day, entries: n[day] }))
  }
  if ((m = p.match(/^\/audit\/(\d+)$/))) {
    const e = audit.find(x => x.id === Number(m![1]))
    if (!e) throw new ApiError(404, 'not_found', 'no such entry')
    const [before, after] = BA[e.event] ?? [null, null]
    return { ...e, action: actionOf(e.event), before, after }
  }
  if (p === '/audit/search') {
    const sp = new URLSearchParams(q), after = Number(sp.get('after') ?? 0), before = Number(sp.get('before') ?? 0), limit = Number(sp.get('limit') ?? 100)
    const hit = auditMatch(sp).filter(e => e.id > after && (!before || e.id < before))
    return { items: hit.slice(0, limit), has_more: hit.length > limit }
  }
  if (p === '/audit/export') {
    perm('view_audit'); perm('export_data')
    const sp = new URLSearchParams(q), ids = (sp.get('ids') ?? '').split(',').filter(Boolean).map(Number)
    const rows = auditMatch(ids.length ? new URLSearchParams() : sp).filter(e => !ids.length || ids.includes(e.id))
    if (!rows.length) throw new ApiError(404, 'nothing_to_export', 'no entries match; choose some entries or widen the filters')
    return new Blob([`SAMPLE activity log, ${rows.length} entries (mock mode)\n` + rows.map(e => `${e.id},${e.at},${e.actor},${e.entity},${e.action},${e.event}`).join('\n')], { type: sp.get('format') === 'pdf' ? 'application/pdf' : 'text/csv' })
  }
  if (p === '/audit') {
    const after = Number(new URLSearchParams(q).get('after') ?? 0)
    return audit.filter(e => e.id > after)
  }
  throw new ApiError(404, 'not_found', `No mock route for ${method} ${p}`)
}

// Guided tour state (GET/POST /me/onboarding). Switches: ?tour=new (first-timer, default is done), ?tour=staff (first-timer, staff tour), ?tour=done.
let onb: Onb | undefined
function mockOnboarding(method: string, owner: boolean, body: any): Onb {
  const sw = Q.get('tour')
  onb ??= { tour: sw === 'staff' || !owner ? 'staff' : 'owner', state: sw === 'new' || sw === 'staff' ? 'new' : 'done', step: 0, later_count: 0 }
  if (method === 'POST') onb = applyOnb(onb, body)
  return onb
}

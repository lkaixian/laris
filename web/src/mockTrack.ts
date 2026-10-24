// SAMPLE data only (mock mode). /track, /documents/{id}/timeline, /jobs, /jobs/agenda: shapes from docs/api-contract.md.
// Switches (query before the hash): ?trackpage=5 caps the page size of /track (to see Load more), ?notrack=1 makes dashboard.track null,
// ?jobs=0 starts with no jobs, ?baduser=1 adds an owner-visible person (id 'bad') the server refuses as assignee.
import { ApiError } from './api'

const Q = new URLSearchParams(location.search)
const DAY = 864e5
const LAB: Record<string, string> = { draft: 'Draft', approved: 'Approved', sent: 'Sent', read: 'Opened by customer', accepted: 'Accepted', job_created: 'Job created', rejected: 'Rejected', cancelled: 'Cancelled', expired: 'Expired', superseded: 'Superseded',
  received: 'Received', parsed: 'Parsed', reviewed: 'Reviewed', in_cost_book: 'In cost book', waiting: 'Waiting for supplier', needs_review: 'Needs review', ready: 'Ready', confirmed: 'Confirmed', discarded: 'Discarded' }
const ZERO = { outbound: ['draft', 'approved', 'sent', 'read', 'accepted', 'job_created', 'rejected', 'expired', 'superseded', 'cancelled'],
  inbound: ['received', 'parsed', 'reviewed', 'accepted', 'in_cost_book', 'rejected', 'expired', 'superseded', 'cancelled'], rfq: ['waiting', 'needs_review', 'ready', 'accepted'], listing: ['needs_review', 'confirmed', 'discarded'] }
const TERMINAL = ['accepted', 'rejected', 'expired', 'superseded', 'cancelled', 'in_cost_book', 'job_created', 'confirmed', 'discarded']
const GROUP = { quote: 'outbound', supplier_doc: 'inbound', rfq: 'rfq', listing: 'listing' } as const
type Kind = keyof typeof GROUP

const myToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date())
const shift = (s: string, n: number) => new Date(new Date(s + 'T00:00:00Z').getTime() + n * DAY).toISOString().slice(0, 10)
const day = (s: string) => Math.round((Date.parse(s + 'T00:00:00Z') - Date.parse(myToday() + 'T00:00:00Z')) / DAY)

// ---- /track
const RAW: [Kind, string, string, string, number, string | null, number | null, number | null, string][] = [
  // kind, ref, party, status, days in stage, overdue reason, due in days, total, link
  ['quote', 'SAMPLE-QT-0001', 'SAMPLE Customer Cafe (synthetic)', 'sent', 5, 'no reply since sent', 20, 2400, '#/doc/out-1'],
  ['quote', 'QT-2026-0008', 'Mega Mart Sdn Bhd', 'draft', 4, 'quote waiting for approval/sending', 25, 1200, '#/doc/mock-q8'],
  ['quote', 'QT-2026-0010', 'Kopi Corner', 'sent', 1, 'expires soon', 2, 3300, '#/doc/mock-q10'],
  ['quote', 'QT-2026-0009', 'Bright Catering', 'approved', 1, null, 28, 860, '#/doc/mock-q9'],
  ['quote', 'QT-2026-0011', 'Studio Lim', 'read', 2, null, 14, 540, '#/doc/mock-q11'],
  ['quote', 'QT-2026-0012', 'Warung Ali', 'draft', 0, null, 30, 975, '#/doc/mock-q12'],
  ['quote', 'QT-2026-0006', 'Warung Ali', 'accepted', 6, null, null, 4100, '#/doc/mock-q6'],
  ['quote', 'QT-2026-0005', 'Pak Hassan Printing', 'job_created', 9, null, null, 1850, '#/doc/mock-q5'],
  ['supplier_doc', 'SAMPLE-A-002', 'SAMPLE Supplier A Acrylic Sdn Bhd', 'parsed', 3, 'waiting for review', null, 140, '#/doc/in-2'],
  ['supplier_doc', 'SAMPLE-B-014', 'SAMPLE Supplier B Footwear (synthetic)', 'reviewed', 3, 'waiting for owner decision', null, 920, '#/doc/mock-s14'],
  ['supplier_doc', 'SAMPLE-A-001', 'SAMPLE Supplier A Acrylic Sdn Bhd', 'in_cost_book', 45, null, null, 108, '#/doc/in-1'],
  ['rfq', 'ballet flat, cream, strap', 'SAMPLE Supplier C Leather (synthetic)', 'waiting', 3, 'supplier has not replied', null, null, '#/ask'],
  ['rfq', 'brass buckle 25mm', 'SAMPLE Supplier B Footwear (synthetic)', 'ready', 1, null, null, 2.2, '#/ask'],
  ['listing', 'Leather belt 30mm', 'Catalog photo', 'needs_review', 4, 'catalog item waiting for review', null, 18, '#/catalog/lst-1'],
  ['listing', 'Canvas tote', 'Catalog photo', 'confirmed', 8, null, null, 24, '#/catalog/lst-2'],
]
const trackItems = (owner: boolean) => RAW.map(([kind, ref, party, status, d, reason, due, total, link], i) => ({
  kind, id: `trk-${i + 1}`, ref, party, status, stage_label: LAB[status] ?? status, since: new Date(Date.now() - d * DAY).toISOString(), days_in_stage: d,
  overdue: !!reason, overdue_reason: reason, due_on: due == null ? null : shift(myToday(), due),
  total: total == null || (kind !== 'quote' && !owner) ? null : total.toFixed(4), link,
})).sort((a, b) => Number(b.overdue) - Number(a.overdue) || Number(TERMINAL.includes(a.status)) - Number(TERMINAL.includes(b.status)) || b.days_in_stage - a.days_in_stage)

export function trackStats() {
  const open = trackItems(true).filter(i => !TERMINAL.includes(i.status))
  return { overdue: open.filter(i => i.overdue).length, waiting_supplier: open.filter(i => i.kind === 'rfq' && i.status === 'waiting').length, waiting_approval: open.filter(i => i.kind === 'quote' && i.status === 'draft').length }
}
export const dashTrack = () => (Q.get('notrack') === '1' ? null : trackStats())

function track(q: URLSearchParams, owner: boolean) {
  const bad = (field: string, message: string) => { const e = new ApiError(422, 'invalid_request', `${field}: ${message}`); e.fields = [{ field, message }]; return e }
  const kind = q.get('kind') ?? 'all'
  if (kind !== 'all' && !(kind in GROUP)) throw bad('kind', 'must be all, quote, supplier_doc, rfq or listing')
  const limit = q.has('limit') ? Number(q.get('limit')) : 50, offset = Number(q.get('offset') ?? 0)
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw bad('limit', 'must be from 1 to 200')
  if (!Number.isInteger(offset) || offset < 0) throw bad('offset', 'must be 0 or more')
  const stage = q.get('stage'), term = (q.get('q') ?? '').trim().toLowerCase(), cap = Number(Q.get('trackpage')) || limit
  const all = trackItems(owner)
  const hit = all.filter(i => (kind === 'all' || i.kind === kind) && (!stage || (stage === 'open' ? !TERMINAL.includes(i.status) : i.status === stage)) && (!term || `${i.party} ${i.ref}`.toLowerCase().includes(term)))
  const rows = hit.filter(i => q.get('overdue') !== '1' || i.overdue)
  const counts = Object.fromEntries(Object.entries(ZERO).map(([g, keys]) => [g, Object.fromEntries(keys.map(k => [k, all.filter(i => GROUP[i.kind] === g && i.status === k).length]))]))
  const size = Math.min(limit, cap)
  return { items: rows.slice(offset, offset + size), counts, overdue_total: hit.filter(i => i.overdue).length, has_more: offset + size < rows.length,
    ...(owner ? { stats: { draft: { avg_days: 1.4, n: 22 }, approved: { avg_days: 0.8, n: 19 }, sent: { avg_days: 3.2, n: 17 }, read: { avg_days: 2.1, n: 9 }, parsed: { avg_days: 1.2, n: 14 }, reviewed: { avg_days: 2.6, n: 11 }, waiting: { avg_days: 2.9, n: 8 } } } : {}) }
}

// ---- timeline
const ev = (days: number, kind: string, title: string, actor: string | null, detail?: string) => ({ at: new Date(Date.now() - days * DAY).toISOString(), kind, title, actor, ...(detail ? { detail } : {}) })
function timeline(doc: { direction: string; status: string }) {
  const out = doc.direction === 'out'
  const events = out
    ? [ev(6, 'created', 'Quote created from a customer enquiry', 'system'), ev(5.2, 'status', 'Approved', 'SAMPLE Owner'), ev(5, 'sent', 'Sent to customer', 'SAMPLE Owner', 'Sent by WhatsApp'),
      ev(4.1, 'message', 'Message received', null, 'Can you do 40 pieces by next Friday?'), ev(4, 'message', 'Message sent', 'SAMPLE Owner'), ev(3, 'status', 'Opened by customer', 'system')]
    : [ev(3.2, 'created', 'Supplier quote received', 'SAMPLE Staff'), ev(3, 'status', 'Supplier quote read', 'system', '2 lines read, 1 needs review')]
  const d = out ? 3 : 3, overdue = ['sent', 'read', 'parsed', 'reviewed', 'draft', 'approved'].includes(doc.status) && d > 2
  return { events, stage: { status: doc.status, label: LAB[doc.status] ?? doc.status, since: new Date(Date.now() - d * DAY).toISOString(), days_in_stage: d, overdue, reason: overdue ? (out ? 'no reply since sent' : 'waiting for review') : null } }
}

// ---- jobs
type J = { id: string; status: 'todo' | 'doing' | 'done'; created_at: string; quote_id: string; quote_no: string; customer: string; total: string; quote_total: string; summary: string | null
  due_on: string | null; assignee_id: string | null; priority: 'low' | 'normal' | 'high'; notes: string | null; started_at: string | null; done_at: string | null }
const PEOPLE: Record<string, string> = { 'sample-owner': 'SAMPLE Owner', 'sample-staff': 'SAMPLE Staff' }
const SEED: [J['status'], string, string, number | null, string | null, J['priority'], string][] = [
  ['todo', 'SAMPLE-QT-0001', 'SAMPLE Customer Cafe (synthetic)', -3, 'sample-owner', 'high', '40 signboards 60x30'],
  ['todo', 'QT-2026-0006', 'Warung Ali', 0, 'sample-staff', 'normal', 'Menu boards, 6 pieces'],
  ['doing', 'QT-2026-0005', 'Pak Hassan Printing', 2, 'sample-staff', 'high', 'Vinyl lettering, shopfront'],
  ['doing', 'QT-2026-0004', 'Kopi Corner', -6, null, 'normal', 'Counter display stand'],
  ['todo', 'QT-2026-0013', 'Studio Lim', 9, null, 'low', 'Acrylic nameplates, 12 pieces'],
  ['todo', 'QT-2026-0014', 'Bright Catering', null, null, 'normal', 'Table number stands'],
  ['done', 'QT-2026-0002', 'Mega Mart Sdn Bhd', -5, 'sample-owner', 'normal', 'Window stickers'],
  ['doing', 'QT-2026-0003', 'Bright Catering', 1, 'sample-owner', 'normal', 'Banner stand, 3 pieces'],
]
const jobs: J[] = Q.get('jobs') === '0' ? [] : SEED.map(([status, no, customer, due, who, priority, summary], i) => ({
  id: `job-${i + 1}`, status, created_at: new Date(Date.now() - (i + 2) * DAY).toISOString(), quote_id: no === 'SAMPLE-QT-0001' ? 'out-1' : `mock-job-q${i + 1}`, quote_no: no, customer,
  total: (1000 + i * 350).toFixed(4), quote_total: (1000 + i * 350).toFixed(4), summary, due_on: due == null ? null : shift(myToday(), due), assignee_id: who, priority, notes: i === 0 ? 'Customer wants the gloss finish.' : null,
  started_at: status === 'todo' ? null : new Date(Date.now() - DAY).toISOString(), done_at: status === 'done' ? new Date(Date.now() - DAY).toISOString() : null,
}))
const view = (j: J) => {
  const { assignee_id, ...rest } = j
  const d = j.due_on ? day(j.due_on) : null
  return { ...rest, assignee: assignee_id ? { id: assignee_id, name: PEOPLE[assignee_id] ?? assignee_id } : null, overdue: d != null && d < 0 && j.status !== 'done', days_to_due: d }
}
export const jobStats = () => ({
  jobs: { todo: jobs.filter(j => j.status === 'todo').length, doing: jobs.filter(j => j.status === 'doing').length, done: jobs.filter(j => j.status === 'done').length },
  jobs_overdue: jobs.map(view).filter(j => j.overdue).length, jobs_due_today: jobs.filter(j => j.status !== 'done' && j.due_on === myToday()).length,
})
export const extraMembers = () => (Q.get('baduser') === '1' ? [{ id: 'bad', name: 'Ghost (mock: cannot be assigned)', username: 'ghost', role: 'staff', role_id: 'r-staff', role_key: 'staff', role_name: 'Staff', active: true, has_password: false, sessions: 0 }] : [])

function agenda(q: URLSearchParams) {
  const bad = () => new ApiError(422, 'bad_range', 'from and to must be dates, from first, at most 62 days apart.')
  const ok = (s: string | null) => s === null || /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
  let from = q.get('from'), to = q.get('to')
  if (!ok(from) || !ok(to)) throw bad()
  if (!from && !to) { const t = myToday(), dow = (new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7; from = shift(t, -dow); to = shift(from, 6) }
  else if (!to) to = shift(from!, 6)
  else if (!from) from = shift(to!, -6)
  const span = day(to!) - day(from!)
  if (span < 0 || span > 61) throw bad()
  const all = jobs.map(view), rank = { high: 0, normal: 1, low: 2 }
  const dates = Array.from({ length: span + 1 }, (_, i) => shift(from!, i))
  return {
    from, to,
    days: dates.map(date => ({ date, weekday: new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }), jobs: all.filter(j => j.due_on === date).sort((a, b) => rank[a.priority] - rank[b.priority]) })),
    unscheduled: all.filter(j => !j.due_on && j.status !== 'done'), overdue: all.filter(j => j.due_on && j.due_on < from! && j.status !== 'done'),
  }
}

type Ctx = { owner: boolean; me: string; perm: (k: string) => void; people: string[]; doc: (id: string) => { direction: string; status: string } | undefined }
export function mockTrack(method: string, p: string, query: string, c: Ctx, body: any): unknown {  // eslint-disable-line @typescript-eslint/no-explicit-any
  const q = new URLSearchParams(query)
  let m: RegExpMatchArray | null
  if (method === 'GET' && p === '/track') return track(q, c.owner)
  if (method === 'GET' && (m = p.match(/^\/documents\/([^/]+)\/timeline$/))) {
    c.perm('view_audit')
    const d = c.doc(m[1])
    if (!d) throw new ApiError(404, 'not_found', 'Document not found.')
    return timeline(d)
  }
  if (method === 'GET' && p === '/jobs/agenda') return agenda(q)
  if (method === 'GET' && p === '/jobs') {
    const limit = q.has('limit') ? Number(q.get('limit')) : 200
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new ApiError(422, 'invalid_request', 'limit: must be from 1 to 500')
    const st = q.get('status'), as = q.get('assignee'), before = q.get('due_before')
    if (st && !['todo', 'doing', 'done'].includes(st)) throw new ApiError(422, 'invalid_request', 'status: not a job status')
    const who = as === 'me' ? c.me : as
    return jobs.map(view).filter(j => (!st || j.status === st) && (!who || j.assignee?.id === who) && (q.get('overdue') !== '1' || j.overdue) && (!before || (j.due_on != null && j.due_on < before))).slice(0, limit)
  }
  if (method === 'POST' && (m = p.match(/^\/jobs\/([^/]+)$/))) {
    c.perm('manage_contacts')
    const j = jobs.find(x => x.id === m![1])
    if (!j) throw new ApiError(404, 'not_found', 'Job not found.')
    const b = body ?? {}, keys = Object.keys(b)
    const bad = (field: string, message: string, code = 'invalid_request') => { const e = new ApiError(422, code, `${field}: ${message}`); e.fields = [{ field, message }]; return e }
    if (!keys.length) throw new ApiError(422, 'empty', 'Nothing to change.')
    for (const k of keys) if (!['status', 'due_on', 'assignee_id', 'priority', 'notes'].includes(k)) throw bad(k, 'unknown field')
    if ('status' in b && !['todo', 'doing', 'done'].includes(b.status)) throw bad('status', 'must be todo, doing or done')
    if ('priority' in b && !['low', 'normal', 'high'].includes(b.priority)) throw bad('priority', 'must be low, normal or high')
    if ('due_on' in b && b.due_on !== null && !(/^\d{4}-\d{2}-\d{2}$/.test(b.due_on) && !Number.isNaN(Date.parse(b.due_on)))) throw bad('due_on', 'must be a date, YYYY-MM-DD')
    if ('notes' in b && b.notes !== null && (typeof b.notes !== 'string' || b.notes.length > 2000)) throw bad('notes', 'at most 2000 characters')
    if ('assignee_id' in b && b.assignee_id !== null && (b.assignee_id === 'bad' || !c.people.includes(b.assignee_id))) throw bad('assignee_id', 'That person cannot be assigned.', 'bad_assignee')
    if ('status' in b && b.status !== j.status) {
      if (b.status === 'doing' && !j.started_at) j.started_at = new Date().toISOString()
      j.done_at = b.status === 'done' ? new Date().toISOString() : null
      j.status = b.status
    }
    if ('due_on' in b) j.due_on = b.due_on
    if ('assignee_id' in b) j.assignee_id = b.assignee_id
    if ('priority' in b) j.priority = b.priority
    if ('notes' in b) j.notes = b.notes === '' ? null : b.notes
    return view(j)
  }
  return undefined
}

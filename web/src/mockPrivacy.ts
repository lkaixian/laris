// SAMPLE data for the Privacy and API access pages (mock mode only). Switches: ?privacy=empty | overdue (default: one open, one closed incident),
// ?requests=none | many (default: three, two pending), ?api=none (no keys) | over (over the free allowance). Shapes follow src/api/privacy.py and src/api/public_api.py.
import { ApiError } from './api'

const Q = new URLSearchParams(location.search)
const H = 36e5
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * H).toISOString()
const RULE_NOTE = "Deadlines are 72 hours to the Commissioner and 7 days after that to the people affected (Commissioner's Circular 2/2025 and Breach Guideline). The 72 hours are counted from the earlier of when the breach happened and when you detected it. A lawyer has not yet confirmed when the clock starts."

interface B { id: string; detected_at: string; occurred_at: string | null; harm_factors: string[]; summary: string; data_types: string[]; people_affected: number | null; significant_harm: boolean
  commissioner_notified_at: string | null; subjects_notified_at: string | null; status: 'open' | 'closed'; notes: string | null; created_at: string }
const mk = (id: string, hoursAgo: number, summary: string, extra: Partial<B> = {}): B => ({ id, detected_at: iso(hoursAgo), occurred_at: null, harm_factors: [], summary, data_types: ['name', 'phone number'], people_affected: 12, significant_harm: false,
  commissioner_notified_at: null, subjects_notified_at: null, status: 'open', notes: null, created_at: iso(hoursAgo), ...extra })
const mode = Q.get('privacy')
const incidents: B[] = mode === 'empty' ? [] : mode === 'overdue'
  ? [mk('b1', 100, 'A staff phone with customer chats was lost.', { significant_harm: true, people_affected: 40 })]
  : [mk('b1', 20, 'A quote PDF was emailed to the wrong customer.', { significant_harm: true, people_affected: 1 }),
     mk('b2', 24 * 30, 'A shared spreadsheet was open to anyone with the link for one day.', { status: 'closed', people_affected: 8, notes: 'Link switched off. No sign it was opened.' })]
let dpo: { dpo_name: string | null; dpo_email: string | null; dpo_phone: string | null; notice_version: number; require_optin: boolean } = mode === 'empty' ? { dpo_name: null, dpo_email: null, dpo_phone: null, notice_version: 1, require_optin: false }
  : { dpo_name: 'SAMPLE Aisyah Rahman', dpo_email: 'privacy@sample.example', dpo_phone: null, notice_version: 1, require_optin: false }

const view = (b: B) => {
  const t = Date.now(), at = (s: string, ms: number) => new Date(new Date(s).getTime() + ms).toISOString()
  const harm = b.significant_harm || b.harm_factors.length > 0, notifiable = harm || (b.people_affected ?? 0) > 1000
  const c_due = at(b.occurred_at && b.occurred_at < b.detected_at ? b.occurred_at : b.detected_at, 72 * H), s_due = harm && b.commissioner_notified_at ? at(b.commissioner_notified_at, 7 * 24 * H) : null
  const cWait = notifiable && !b.commissioner_notified_at && b.status === 'open', sWait = !!s_due && !b.subjects_notified_at && b.status === 'open'
  const due = cWait ? c_due : sWait ? s_due : null
  return { ...b, notifiable, commissioner_due: c_due, subjects_due: s_due, commissioner_overdue: cWait && t > +new Date(c_due), subjects_overdue: sWait && t > +new Date(s_due!),
    hours_left: due ? Math.round((+new Date(due) - t) / H * 10) / 10 : null, rule_note: RULE_NOTE }
}

const keys = Q.get('api') === 'none' ? [] : [
  { id: 'k1', name: 'Office ERP', key_prefix: 'lar_Xk3a', created_at: iso(24 * 20), last_used_at: iso(3), revoked: false },
  { id: 'k2', name: 'Old test key', key_prefix: 'lar_9fQ2', created_at: iso(24 * 60), last_used_at: null, revoked: true },
]

const RQ = Q.get('requests')
const rq = (id: string, n: string, kind: 'erase' | 'export', status: string, hoursAgo: number, channel = 'telegram') =>
  ({ id, party_id: 'p-' + id, party_name: n, kind, status, channel, requested_at: iso(hoursAgo), decided_at: status === 'pending' ? null : iso(hoursAgo - 2) })
const requests = RQ === 'none' ? [] : [rq('r1', 'SAMPLE Customer', 'erase', 'pending', 50), rq('r2', 'SAMPLE Buyer Two', 'export', 'pending', 5, 'whatsapp'), rq('r3', 'SAMPLE Old Customer', 'erase', 'done', 24 * 9),
  ...(RQ === 'many' ? Array.from({ length: 12 }, (_, i) => rq('m' + i, `SAMPLE Customer ${i + 4}`, i % 3 ? 'erase' : 'export', i % 4 ? 'pending' : 'dismissed', 3 + i * 20, i % 2 ? 'whatsapp' :  'telegram')) : [])]

// Returns undefined when the path is not one of ours.
export function mockPrivacy(method: string, p: string, owner: boolean, body: any): unknown {
  let m: RegExpMatchArray | null
  if (!/^\/(settings\/(privacy|api-keys)|privacy\/|usage|parties\/[^/]+\/(export|erase))/.test(p)) return undefined
  if (!owner) throw new ApiError(403, 'owner_only', 'owner role required')
  if (p === '/settings/privacy') {
    if (method === 'POST') dpo = { ...dpo, dpo_name: body.dpo_name?.trim() || null, dpo_email: body.dpo_email?.trim() || null, dpo_phone: body.dpo_phone?.trim() || null, require_optin: body.require_optin ?? dpo.require_optin }
    return { ...dpo, configured: !!(dpo.dpo_name && (dpo.dpo_email || dpo.dpo_phone)) }
  }
  if (p === '/privacy/breaches' && method === 'GET') return { incidents: [...incidents].sort((a, b) => b.detected_at.localeCompare(a.detected_at)).map(view), rule_note: RULE_NOTE }
  if (p === '/privacy/breaches' && method === 'POST') {
    const b = mk('b' + (incidents.length + 1), 0, body.summary, { detected_at: body.detected_at, occurred_at: body.occurred_at ?? null, harm_factors: body.harm_factors ?? [], data_types: body.data_types ?? [], people_affected: body.people_affected ?? null, significant_harm: !!body.significant_harm })
    incidents.push(b); return view(b)
  }
  if ((m = p.match(/^\/privacy\/breaches\/([^/]+)$/)) && method === 'POST') {
    const b = incidents.find(x => x.id === m![1]); if (!b) throw new ApiError(404, 'not_found', 'incident not found')
    Object.assign(b, body); return view(b)
  }
  if (p === '/privacy/requests' && method === 'GET') return [...requests].sort((a, b) => +(b.status === 'pending') - +(a.status === 'pending'))
  if ((m = p.match(/^\/privacy\/requests\/([^/]+)$/)) && method === 'POST') {
    const q = requests.find(x => x.id === m![1]); if (!q) throw new ApiError(404, 'not_found', 'request not found')
    if (q.status !== 'pending') throw new ApiError(409, 'already_decided', 'this request was already decided')
    if (body.action === 'erase' && q.kind !== 'erase') throw new ApiError(422, 'bad_action', 'only an erase request can be erased')
    q.status = body.action === 'erase' ? 'done' : 'dismissed'; q.decided_at = new Date().toISOString(); return q
  }
  if (p === '/usage') {
    const over = Q.get('api') === 'over'
    return { period: new Date().toISOString().slice(0, 7), approved_quotes: over ? 27 : 14, quotes_sent: over ? 25 : 12, api_calls: Q.get('api') === 'none' ? 0 : 63, free_allowance: 20, over_allowance: over, note: 'Shown for planning. LARIS does not bill anything yet.' }
  }
  if (p === '/settings/api-keys' && method === 'GET') return keys
  if (p === '/settings/api-keys' && method === 'POST') {
    const k = { id: 'k' + (keys.length + 1), name: String(body.name).trim(), key_prefix: 'lar_Zt8w', created_at: new Date().toISOString(), last_used_at: null, revoked: false, mcp_role: body.mcp_role_id ? 'Staff' : null }
    keys.push(k); return { id: k.id, name: k.name, key: 'lar_Zt8wSAMPLEdoNotUseThisKey0123456789', note: 'Copy it now, it is shown once.' }
  }
  if ((m = p.match(/^\/settings\/api-keys\/([^/]+)$/)) && method === 'DELETE') {
    const k = keys.find(x => x.id === m![1]); if (!k) throw new ApiError(404, 'not_found', 'no such key')
    k.revoked = true; return { id: k.id, revoked: true }
  }
  if ((m = p.match(/^\/parties\/([^/]+)\/export$/))) return { party: { id: m[1], role: 'customer', name: 'SAMPLE Customer', contact: '+60120000000', email: null }, enquiries: [], messages: [], quotes: [], replies: [], truncated: false }
  if (p.endsWith('/erase') && method === 'POST') return { id: p.split('/')[2], messages_erased: 7, replies_erased: 0 }
  return undefined
}

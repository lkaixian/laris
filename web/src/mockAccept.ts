// SAMPLE data for the public customer page and the owner's "Copy customer link" (mock mode only). Shapes follow src/api/accept.py.
// Switches: ?accept=ok (default) | decided | expired | error. ?link=nourl shows the "public address missing" answer.
import { ApiError } from './api'

const Q = new URLSearchParams(location.search)
const mode = Q.get('accept') ?? 'ok'
let decision: { decision: 'accepted' | 'declined'; at: string; name: string | null } | null =
  mode === 'decided' ? { decision: 'accepted', at: new Date(Date.now() - 36e5).toISOString(), name: 'SAMPLE Customer' } : null

const quote = () => ({
  simulated: true, notice: 'Simulated signature for demonstration; not a legal e-signature.',
  issuer: { name: 'SAMPLE Signage Works (synthetic)', logo_url: null },
  quote: {
    doc_no: 'SAMPLE-QT-0001', valid_until: '2026-12-31', status: decision ? decision.decision : 'sent', currency: 'RM', total: '2400.00',
    note: 'SAMPLE terms: 50% deposit to start. Balance on delivery. Prices exclude installation unless listed.',
    lines: [
      { description: 'SAMPLE acrylic signboard 60x30, gloss', qty: '40', uom: 'pcs', unit_price: '50.00', line_total: '2000.00' },
      { description: 'SAMPLE vinyl lettering, per metre, with a long description to check that the text wraps on a narrow phone screen', qty: '20', uom: 'm', unit_price: '20.00', line_total: '400.00' },
    ],
  },
  can_accept: !decision, decided: decision,
})

export function mockAccept(method: string, p: string, body: any, owner: boolean, status: (id: string) => string | undefined): unknown {  // eslint-disable-line @typescript-eslint/no-explicit-any
  let m = p.match(/^\/documents\/([^/]+)\/accept-link$/)
  if (m && method === 'POST') {
    if (!owner) throw new ApiError(403, 'owner_only', 'owner role required')
    if (!['approved', 'sent', 'read'].includes(status(m[1]) ?? '')) throw new ApiError(409, 'not_linkable', 'quote is not approved, sent or read')
    if (Q.get('link') === 'nourl') throw new ApiError(409, 'public_url_missing', 'no public address')
    return { url: `${location.origin}/#/q/SampleToken_0123456789abcdef`, expires_at: new Date(Date.now() + 30 * 864e5).toISOString() }
  }
  m = p.match(/^\/public\/quote\/[^/]+(\/accept|\/decline)?$/)
  if (!m) return undefined
  if (mode === 'expired') throw new ApiError(404, 'not_found', 'This link is not valid.')
  if (mode === 'error') throw new ApiError(503, 'unavailable', 'Service unavailable')
  if (method === 'GET') return quote()
  if (decision) throw new ApiError(409, 'already_decided', 'This quotation has already been decided.')
  if (m[1] === '/accept') {
    const name = String(body?.name ?? '').trim()
    if (name.length < 2 || name.length > 80) throw new ApiError(422, 'bad_name', 'Type your full name (2 to 80 characters).')
    if (body?.agree !== true) throw new ApiError(422, 'must_agree', 'Tick the box to confirm you accept this quotation.')
    decision = { decision: 'accepted', at: new Date().toISOString(), name }
    return { status: 'accepted', job_created: true, simulated: true }
  }
  decision = { decision: 'declined', at: new Date().toISOString(), name: null }
  return { status: 'rejected', simulated: true }
}

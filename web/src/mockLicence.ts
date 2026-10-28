// Mock of the licence admin API and the customer offer (mock mode only). Test switches: ?issuer=0 (not the platform admin), nokey, env, empty, noemail; ?offer=1 shows an offer to the customer.
import { ApiError } from './api'

const Q = new URLSearchParams(location.search)
const mode = Q.get('issuer') ?? ''
const KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA='
const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString()
let cfg = { public_key: mode === 'nokey' ? null as string | null : KEY, source: (mode === 'nokey' ? null : mode === 'env' ? 'environment' : 'dashboard') as 'environment' | 'dashboard' | null, enforced: true }
type Req = { id: string; org: string; email: string; plan: string; seats: number; note?: string; requested_at: string; status: 'pending' | 'issued'; offer_expires_at: string | null }
const reqs: Req[] = mode === 'empty' ? [] : [
  { id: 'r1', org: 'Acme Printing', email: 'owner@acme.test', plan: 'standard', seats: 10, note: 'We have 8 staff and may hire two more.', requested_at: day(-2), status: 'pending', offer_expires_at: null },
  { id: 'r2', org: 'Bright Catering', email: 'hello@bright.test', plan: 'pro', seats: 25, requested_at: day(-5), status: 'pending', offer_expires_at: null },
  { id: 'r3', org: 'Cedar Signs', email: 'cedar@signs.test', plan: 'starter', seats: 3, requested_at: day(-20), status: 'issued', offer_expires_at: day(340) },
]
let offer: { plan: string; seats: number; expires_at: string } | null = Q.get('offer') === '1' ? { plan: 'standard', seats: 10, expires_at: day(365) } : null

// `base(method, path)` answers the existing mock for the plain licence status.
export function mockLicence(method: string, p: string, body: any, base: (m: string, p: string) => unknown): unknown {  // eslint-disable-line @typescript-eslint/no-explicit-any
  if (p.startsWith('/license/admin')) {
    if (mode === '0') throw new ApiError(404, 'not_found', 'Not found')
    if (method === 'GET' && p === '/license/admin/config') return cfg
    if (method === 'GET' && p === '/license/admin/requests') return reqs
    if (method === 'POST' && p === '/license/admin/public-key') {
      if (cfg.source === 'environment') throw new ApiError(409, 'key_from_environment', 'The public key is set in the server environment.')
      const k = String(body.public_key ?? '').trim()
      if (!/^[A-Za-z0-9+/]{43}=$/.test(k)) throw new ApiError(422, 'bad_key', 'That is not a valid Ed25519 public key.')
      if (cfg.public_key && cfg.public_key !== k && !body.confirm) { const e = new ApiError(409, 'would_invalidate', 'Existing licences would stop working.'); e.details = { licences: 3 }; throw e }
      cfg = { ...cfg, public_key: k, source: 'dashboard' }
      return cfg
    }
    if (method === 'POST' && p === '/license/admin/issue') {
      const r = reqs.find(x => x.id === body.request_id)
      if (!r) throw new ApiError(404, 'not_found', 'Request not found')
      let email = ''
      try { email = JSON.parse(atob(String(body.token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email } catch { /* fall through */ }
      if (!String(body.token).startsWith('LARIS1.') || email !== r.email.toLowerCase()) throw new ApiError(422, 'token_mismatch', 'The licence does not match the request.')
      Object.assign(r, { status: 'issued', offer_expires_at: day(365) })
      return { ok: true, emailed: mode !== 'noemail' }
    }
  }
  if (method === 'POST' && p === '/license/accept-offer') {
    if (!offer) throw new ApiError(404, 'no_offer', 'There is no licence offer.')
    offer = null
    return { ...(base('GET', '/license') as object), status: 'active', plan: 'standard', seats: 10, expires_at: day(365), days_left: 365, read_only: false, offer: null }
  }
  if (method === 'GET' && p === '/license') return { ...(base(method, p) as object), offer }
  return base(method, p)
}

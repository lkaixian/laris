// Typed client for docs/api-contract.md (v0). Mock mode (VITE_MOCK=1) swaps fetch for src/mock.ts.
export type Role = 'owner' | 'staff'
export type Direction = 'in' | 'out'
export type Status = string // enum doc_status in db/schema.sql

export interface DocSummary {
  id: string; direction: Direction; kind: string; doc_no: string | null
  party: { id: string; name: string }; status: Status
  issued_on: string | null; valid_until: string | null
  total: string | null; currency: string; updated_at: string
  flags: { cost_is_stale: boolean; needs_review: boolean }
}
export interface Line {
  id: string; line_no: number; description: string; qty: string | null; uom: string
  unit_price: string | null; discount_pct: string | null; tax_rate: string | null
  section: string | null; is_header: boolean; needs_review: boolean; ocr_confidence: string | number | null
  attrs: Record<string, unknown>; attrs_unmapped: Record<string, unknown>
  item_key: string | null
}
export interface Provenance {
  cost_item_id: string; supplier: string; source_doc_id: string; source_doc_no: string
  line_id: string; source_line_id: string; qty_consumed?: string; cost_date: string; unit_cost: string; cost_snapshot: string
  current_unit_cost: string; cost_is_stale: boolean; line_margin: string
}
export interface Me { id: string; role: Role; role_key?: string; role_name?: string; permissions?: string[]; telegram_linked?: boolean; ai_guide?: boolean; name: string; org: { name: string; brand_color?: string | null; logo_url: string | null } }
export interface DocDetail {
  doc: DocSummary
  lines: Line[]
  provenance?: Provenance[]
  messages: { direction: string; channel: string; body: string; at: string }[]
}
export interface Tracker { received: DocSummary[]; sent: DocSummary[] }
export interface Alert {
  quote_id: string; quote_no: string; customer: string; item_key: string
  old_cost: string; current_cost: string; margin_delta: string; status: Status
}
export interface Field {
  key: string; label: string; type: 'text' | 'number' | 'integer' | 'date' | 'select' | 'boolean'
  unit: string | null; options: string[] | null; show_in_grid: boolean; sort_order: number
}
export interface Followup { id: string; document_id: string; doc_no: string; customer: string; status: Status; due_at: string; reason: string; suggested_text: string | null }
export interface MarginReport {
  // cost, margin, margin_pct, stale_quotes, stale_margin_lost and lowest_margin are scrubbed without view_costs: treat them as maybe missing
  days: number; quotes: number; revenue: string; cost?: string; margin?: string; margin_pct?: string | number | null
  won: number; lost: number; stale_quotes?: number; stale_margin_lost?: string
  lowest_margin?: { quote_id: string; quote_no: string; margin: string; margin_pct: string | number | null }[]
}
export interface Assignee { id: string; name: string }
export interface Job {
  id: string; status: 'todo' | 'doing' | 'done'; created_at?: string; quote_id: string; quote_no: string; customer: string; total: string; quote_total?: string; summary: string | null
  due_on?: string | null; assignee?: Assignee | null; priority?: 'low' | 'normal' | 'high'; notes?: string | null; started_at?: string | null; done_at?: string | null
  overdue?: boolean; days_to_due?: number | null  // days_to_due: negative = late
}
export interface Settings { display_name?: string | null; brand_color?: string | null; logo_data_url?: string | null; min_margin_pct: string; ssm_no: string | null; address: string | null; bank_details: string | null; sst_registered: boolean; sst_no: string | null
  quote_validity_days?: number | null; quote_prefix?: string | null; quote_payment_terms?: string | null; quote_terms_text?: string | null; issuer_email?: string | null; issuer_phone?: string | null }
export interface Proposal { id: string; key: string; sample_values: unknown[]; status: string }
export interface AuditEvent { id: number; at: string; actor: string; entity: string; entity_id: string; event: string }

// Client copy of the state machine (knowledge/07-data-model/state-machines.md) for button labels only.
// The server stays the authority: it answers 403 or 409 and the UI shows that message.
export interface Action { to: Status; label: string; owner: boolean; danger?: boolean; primary?: boolean }
export const NEXT: Record<Direction, Record<string, Action[]>> = {
  in: {
    received: [{ to: 'parsed', label: 'Mark supplier quote parsed', owner: false }, { to: 'rejected', label: 'Reject supplier quote', owner: true, danger: true }],
    parsed: [{ to: 'reviewed', label: 'Mark supplier quote reviewed', owner: false }, { to: 'rejected', label: 'Reject supplier quote', owner: true, danger: true }],
    reviewed: [{ to: 'accepted', label: 'Approve supplier quote', owner: true, primary: true }, { to: 'rejected', label: 'Reject supplier quote', owner: true, danger: true }],
    accepted: [{ to: 'in_cost_book', label: 'Add prices to cost book', owner: true, primary: true }],
  },
  out: {
    draft: [{ to: 'approved', label: 'Approve quote', owner: true, primary: true }, { to: 'cancelled', label: 'Cancel quote', owner: true, danger: true }],
    approved: [{ to: 'sent', label: 'Send quote to customer', owner: true, primary: true }, { to: 'cancelled', label: 'Cancel quote', owner: true, danger: true }],
    sent: [{ to: 'accepted', label: 'Record customer accepted', owner: true, primary: true }, { to: 'rejected', label: 'Record customer rejected', owner: true, danger: true }],
    read: [{ to: 'accepted', label: 'Record customer accepted', owner: true, primary: true }, { to: 'rejected', label: 'Record customer rejected', owner: true, danger: true }],
    accepted: [{ to: 'job_created', label: 'Create job from quote', owner: true, primary: true }],
  },
}

export const MOCK = import.meta.env.VITE_MOCK === '1'

let role: Role = (() => { try { return localStorage.getItem('role') === 'staff' ? 'staff' : 'owner' } catch { return 'owner' } })()
export const getRole = () => role
export const setRole = (r: Role) => { role = r; userId = ''; try { localStorage.setItem('role', r) } catch { /* storage blocked */ } }

// Simulated user id: resolved from GET /api/me (sent with X-Role only), kept in memory, never persisted.
let userId = ''
export async function resolveMe(r: Role): Promise<Me> {
  userId = ''
  const me = await call<Me>('GET', '/me', r, undefined, false)
  if (r === role) { userId = me.id; perms = me.permissions ?? [] }
  return me
}

// Permissions of the signed-in person, from GET /api/me. UI only: the server answers 403 permission_required either way.
let perms: string[] = []
export const can = (k: string) => perms.includes(k)
// The ONE map of permission key -> label (same wording as the server catalog, GET /api/roles). Add a key here when you gate a control on it.
export const PERM_LABEL: Record<string, string> = {
  view_costs: 'See costs and prices', view_reports: 'See the margin report', edit_supplier_contacts: 'Edit supplier contacts', manage_contacts: 'Manage contacts',
  upload_documents: 'Upload documents', ask_suppliers: 'Ask suppliers', view_replies_prices: 'See supplier reply prices', manage_followups: 'Send or skip follow-ups',
  export_data: 'Export data', view_audit: 'See the activity log', decide_quotes: 'Approve, accept, reject or send quotes',
}
export const why = (k: string) => `Needs the “${PERM_LABEL[k] ?? k}” permission`
// Spread on a button: `<button {...needs('manage_contacts', onClick)}>`. Without the permission it is aria-disabled, explains why in its title and does nothing.
// Courtesy only: the server answers 403 either way.
export const needs = (k: string, onClick?: () => void) => can(k) ? { onClick } : { 'aria-disabled': true as const, title: why(k), 'data-locked': true as const }
export const DENIED = 'You do not have permission to do that. Ask the owner.'
const isDenied = (e: unknown) => e instanceof ApiError && e.status === 403 && (e.code === 'permission_required' || e.code === 'owner_only')
// A 403 may mean the role changed since /me was read: ask the shell to re-read it, at most once every 10 s.
let lastPerms = 0
const denied403 = (e: unknown) => { if (isDenied(e) && Date.now() - lastPerms > 10_000) { lastPerms = Date.now(); window.dispatchEvent(new Event('laris:perms')) } }
// Pages that need a permission. Team, Roles, Settings, Privacy and API access are owner-class only (docs/roles.md, "Owner only, not assignable").
const NEED: Record<string, string> = { alerts: 'view_costs', activity: 'view_audit', ask: 'ask_suppliers', followups: 'manage_followups' }
export const canOpen = (route: string, owner: boolean) => ['team', 'roles', 'settings', 'status', 'privacy', 'api-access', 'ai-settings'].includes(route) ? owner : !NEED[route] || can(NEED[route])

// ---- sign-in. The session token lives in sessionStorage (this tab only); only its hash is stored on the server.
export const getToken = (): string | null => { try { return sessionStorage.getItem('token') } catch { return null } }
const setToken = (t: string | null) => { try { if (t) sessionStorage.setItem('token', t); else { sessionStorage.removeItem('token'); sessionStorage.removeItem('acct') } } catch { /* storage blocked */ } }
// Username of the real account signed in on this tab (null for a shared access token or demo header mode).
export const getAccount = (): string | null => { try { return sessionStorage.getItem('acct') } catch { return null } }
// One-time notice for the sign-in screen, set when the server ended the session (not on a deliberate sign out).
let notice = ''
export const takeNotice = () => { const n = notice; notice = ''; return n }
export const setNotice = (t: string) => { notice = t }
// Email carried from the sign-up or reset flow to the sign-in form; read once.
let prefill = ''
export const setPrefill = (e: string) => { prefill = e }
export const takePrefill = () => { const e = prefill; prefill = ''; return e }
export const signedOut = (ended = false) => { if (ended) notice = 'Your session ended, please sign in again.'; setToken(null); userId = ''; window.dispatchEvent(new Event('laris:signedout')) }
// Single flight: only a 401 for the token still in use signs out. The first one clears it, so parallel 401s (and late ones after a new sign-in) do nothing.
// A 401 with no token at all (for example /me after the auth config failed) goes to sign-in too, without the 'session ended' notice.
const expired = (res: Response, sent: string | null) => { if (res.status === 401 && getToken() === sent) signedOut(!!sent) }

export async function authConfig(): Promise<{ login_required: boolean }> {
  if (MOCK) return { login_required: false }
  return publicApi('GET', '/auth/config')
}

export interface Business { id: string; name: string }
// businessId: set after the server answered 409 choose_business (the error then carries `businesses`).
export async function login(username: string, password: string, businessId?: string): Promise<void> {
  if (MOCK) {  // mock mode has no accounts: any entry signs in, except multi@demo.test which has two businesses
    if (username.toLowerCase() === 'multi@demo.test' && !businessId)
      throw new ApiError(409, 'choose_business', 'This email is used by more than one business. Choose one.', [{ id: 'biz-acme', name: 'Acme Printing' }, { id: 'biz-bright', name: 'Bright Catering' }])
    return
  }
  const data = await publicApi<{ token: string }>('POST', '/login', businessId ? { username, password, business_id: businessId } : { username, password })
  setToken(data.token)
  try { sessionStorage.setItem('acct', username) } catch { /* storage blocked */ }
}

// Shared access token (APP_TOKEN, demo deployments): same header, no account behind it.
export const setAccessToken = (t: string) => setToken(t.trim())

export async function logout(): Promise<void> {
  if (!MOCK && getToken()) await fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + getToken() } }).catch(() => undefined)
  signedOut()
}

// requestId: server reference (error.request_id or X-Request-Id), optional on older servers. retryAfter: seconds, from Retry-After on a 429.
// shown: a page put this error in front of the user (msg(), Async). toasted: the global error toast was raised for it instead.
export class ApiError extends Error {
  requestId?: string
  retryAfter?: number
  fields?: { field: string; message: string }[]
  details?: { licences?: number }
  shown = false
  toasted = false
  constructor(public status: number, public code: string, message: string, public businesses?: Business[]) { super(message) }
}

// ---- licence (docs/licensing.md). A 402 license_required on a write never signs out: it raises an event, the shell refreshes the licence and shows a toast with a link.
export interface License {
  status: 'missing' | 'active' | 'expiring' | 'expired' | 'invalid' | 'clock_unverified'; plan: string | null; seats: number | null; seats_used: number
  expires_at: string | null; days_left: number | null; enforced: boolean; read_only: boolean
  clock: { source: 'ntp' | 'system'; trusted_at: string | null; rollback: boolean } | null
  offer?: { plan: string; seats: number; expires_at: string } | null  // a licence the platform operator issued for this business, ready to activate
}
const licence402 = (e: unknown) => { if (e instanceof ApiError && e.status === 402 && e.code === 'license_required') window.dispatchEvent(new Event('laris:license402')) }


// ---- request core: one place for timeout, retry, the error envelope ({error:{code,message,request_id,fields?}} + X-Request-Id) and the 5xx toast.
export interface ReqOpts { timeoutMs?: number; signal?: AbortSignal; quiet?: boolean }
const sleep = (ms: number, s?: AbortSignal) => new Promise<void>((res, rej) => { const t = setTimeout(res, ms); s?.addEventListener('abort', () => { clearTimeout(t); rej(s.reason) }, { once: true }) })
const mockQ = (k: string) => new URLSearchParams(location.search).get(k)  // mock-only test switches (docs/ux-refactor.md)
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const LONG = /^\/(listings|rfq|documents\/ingest|assistant)/  // uploads and vision routes: 120 s

// Mock mode answers through the same pipeline as a real server (a Response), so timeout, retry and error handling run in mock too.
async function mockFetch(method: string, path: string, r: Role, body: unknown, signal: AbortSignal): Promise<Response> {
  const { mock } = await import('./mock')
  const [p] = path.split('?')
  const contacts = p === '/contacts' && method === 'GET'
  await sleep((contacts ? Number(mockQ('slow')) || 0 : 0) + 120, signal)
  const err = (status: number, error: object) => new Response(JSON.stringify({ error: { request_id: `mock-${status}-7f3a`, ...error } }), { status, headers: { 'X-Request-Id': `mock-${status}-7f3a` } })
  if (method === 'GET' && p === (mockQ('failpath') ?? '/contacts') && mockQ('fail') === '500') return err(500, { code: 'internal', message: 'Internal error' })
  try { const out = p.startsWith('/license') ? (await import('./mockLicence')).mockLicence(method, p, body, (m, q) => mock(m, q, r, body)) : mock(method, path, r, body); return new Response(out instanceof Blob ? out : JSON.stringify(out), { status: 200 }) }
  catch (e) {
    if (e instanceof ApiError) return err(e.status, { code: e.code, message: e.message, fields: e.fields, details: e.details })
    return err(500, { code: 'internal', message: String(e) })
  }
}

function toError(res: Response, data: any): ApiError {  // eslint-disable-line @typescript-eslint/no-explicit-any
  const er = data?.error
  const rid: string | undefined = er?.request_id ?? res.headers.get('X-Request-Id') ?? undefined
  let message: string = er?.message ?? `Request failed (${res.status})`
  // 5xx: never show server internals; a 503 that carries its own message (db_unavailable, vision not set up) keeps it
  if (res.status >= 500 && !(res.status === 503 && er?.message)) message = rid ? `Server error. Reference: ${rid}` : `Server error (${res.status})`
  const f = res.status === 422 && Array.isArray(er?.fields) ? er.fields[0] : undefined
  if (f?.message) message = f.field ? `${cap(String(f.field).replace(/_/g, ' '))}: ${f.message}` : f.message
  const e = new ApiError(res.status, er?.code ?? 'error', message, er?.businesses)
  e.requestId = rid; e.fields = er?.fields; e.details = er?.details
  const ra = Number(res.headers.get('Retry-After'))
  if (res.status === 429 && ra > 0) e.retryAfter = ra
  return e
}

interface Req extends ReqOpts { body?: unknown; as?: 'json' | 'blob'; auth?: boolean; user?: boolean; quiet?: boolean; role?: Role }

async function once<T>(method: string, path: string, o: Req, ms: number): Promise<T> {
  const sent = getToken()
  const form = o.body instanceof FormData
  const headers: Record<string, string> = {}
  if (o.auth) { headers['X-Role'] = o.role ?? role; if (o.user && userId) headers['X-User'] = userId; if (sent) headers['Authorization'] = 'Bearer ' + sent }
  if (o.body !== undefined && !form) headers['Content-Type'] = 'application/json'
  const signal = AbortSignal.any([AbortSignal.timeout(ms), ...(o.signal ? [o.signal] : [])])
  try {
    const res = MOCK ? await mockFetch(method, path, o.role ?? role, o.body, signal)
      : await fetch('/api' + path, { method, headers, signal, body: o.body === undefined ? undefined : form ? (o.body as FormData) : JSON.stringify(o.body) })
    if (o.auth) expired(res, sent)  // expired or revoked: back to the sign-in screen with a notice
    if (res.ok) return (o.as === 'blob' ? await res.blob() : await res.json().catch(() => null)) as T
    throw toError(res, await res.json().catch(() => null))
  } catch (e) {
    if (e instanceof ApiError) throw e
    if (o.signal?.aborted) throw e  // the caller cancelled: not our error
    if (signal.aborted) throw new ApiError(0, 'timeout', 'The server took too long to answer. Check your connection and try again.')
    throw new ApiError(0, 'network', 'Cannot reach the server.')
  }
}

// Only GET/HEAD are retried (once, after 800 ms): repeating a POST could save twice.
async function request<T>(method: string, path: string, o: Req = {}): Promise<T> {
  const ms = o.timeoutMs ?? ((MOCK && Number(mockQ('timeout'))) || (o.body instanceof FormData || LONG.test(path) ? 120_000 : 30_000))
  const safe = method === 'GET' || method === 'HEAD'
  for (let n = 0; ; n++) {
    try { return await once<T>(method, path, o, ms) } catch (e) {
      if (n === 0 && safe && !o.signal?.aborted && e instanceof ApiError && (e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504)) { await sleep(800, o.signal); continue }
      // A 5xx nobody put on screen (msg(), Async) within 300 ms gets the global error toast, once.
      if (e instanceof ApiError && !o.quiet && ((e.status >= 500 && e.status !== 503) || e.code === 'db_unavailable'))
        setTimeout(() => { if (!e.shown) { e.toasted = true; window.dispatchEvent(new CustomEvent('laris:error', { detail: e.message })) } }, 300)
      throw e
    }
  }
}

// Public endpoints (signup, verify, password reset, sign-in): no identity headers, no sign-out on 401.
export const publicApi = <T,>(method: 'GET' | 'POST', path: string, body?: unknown, opts?: ReqOpts): Promise<T> => request<T>(method, path, { ...opts, body, quiet: true })

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
const call = <T,>(method: Method, path: string, r: Role, body: unknown, withUser: boolean, opts?: ReqOpts): Promise<T> =>
  request<T>(method, path, { ...opts, body, auth: true, user: withUser, role: r }).catch(e => { licence402(e); denied403(e); throw e })

// File download (PDF, xlsx, csv): same identity headers as api(), result saved through a temporary link.
export async function download(path: string, filename: string, opts?: ReqOpts): Promise<void> {
  const url = URL.createObjectURL(await request<Blob>('GET', path, { ...opts, auth: true, user: true, as: 'blob' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// Same as download() but hands back an object URL (for "Open PDF in a new tab"). The caller revokes it.
export async function blobUrl(path: string, opts?: ReqOpts): Promise<string> {
  return URL.createObjectURL(await request<Blob>('GET', path, { ...opts, auth: true, user: true, as: 'blob' }))
}

// Image for <img>: the API needs the identity headers, so fetch it as a blob. Mock data and data/blob URLs pass through.
export async function imageUrl(path: string, opts?: ReqOpts): Promise<string> {
  if (MOCK || !path.startsWith('/api/')) return path
  return URL.createObjectURL(await request<Blob>('GET', path.slice(4), { ...opts, auth: true, user: true, as: 'blob', quiet: true }))
}

export const api = <T,>(method: Method, path: string, body?: unknown, opts?: ReqOpts) => call<T>(method, path, role, body, true, opts)

// ---- Telegram bot settings (GET/POST /settings/telegram/bot-settings). days: ISO weekdays, 1 = Monday ... 7 = Sunday.
export interface BotSettingsView {
  welcome: string; help: string; language: 'auto' | 'en' | 'ms'; quick_replies: string[]; reactions: boolean
  after_hours: { enabled: boolean; message: string; open: string; close: string; days: number[] }
  defaults: { welcome: string; help: string; after_hours_message: string }
}

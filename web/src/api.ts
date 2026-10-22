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
export interface Me { id: string; role: Role; name: string; org: { name: string; logo_url: string | null } }
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
  days: number; quotes: number; revenue: string; cost: string; margin: string; margin_pct: string | number | null
  won: number; lost: number; stale_quotes: number; stale_margin_lost: string
  lowest_margin: { quote_id: string; quote_no: string; margin: string; margin_pct: string | number | null }[]
}
export interface Job { id: string; status: 'todo' | 'doing' | 'done'; quote_id: string; quote_no: string; customer: string; total: string; summary: string | null }
export interface Settings { min_margin_pct: string; ssm_no: string | null; address: string | null; bank_details: string | null; sst_registered: boolean; sst_no: string | null }
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
  if (r === role) userId = me.id
  return me
}

// ---- sign-in. The session token lives in sessionStorage (this tab only); only its hash is stored on the server.
export const getToken = (): string | null => { try { return sessionStorage.getItem('token') } catch { return null } }
const setToken = (t: string | null) => { try { if (t) sessionStorage.setItem('token', t); else sessionStorage.removeItem('token') } catch { /* storage blocked */ } }
export const signedOut = () => { setToken(null); userId = ''; window.dispatchEvent(new Event('laris:signedout')) }

export async function authConfig(): Promise<{ login_required: boolean }> {
  if (MOCK) return { login_required: false }
  try { return await (await fetch('/api/auth/config')).json() } catch { throw new ApiError(0, 'network', 'Cannot reach the server.') }
}

export async function login(username: string, password: string): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
  } catch { throw new ApiError(0, 'network', 'Cannot reach the server.') }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Sign-in failed (${res.status})`)
  setToken(data.token)
}

// Shared access token (APP_TOKEN, demo deployments): same header, no account behind it.
export const setAccessToken = (t: string) => setToken(t.trim())

export async function logout(): Promise<void> {
  if (!MOCK && getToken()) await fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + getToken() } }).catch(() => undefined)
  signedOut()
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

const call = async <T,>(method: 'GET' | 'POST', path: string, r: Role, body: unknown, withUser: boolean): Promise<T> => {
  if (MOCK) {
    const { mock } = await import('./mock')
    await new Promise(res => setTimeout(res, 120))
    return mock(method, path, r, body) as T
  }
  const form = body instanceof FormData
  const headers: Record<string, string> = { 'X-Role': r }
  if (!form) headers['Content-Type'] = 'application/json'
  if (withUser && userId) headers['X-User'] = userId
  if (getToken()) headers['Authorization'] = 'Bearer ' + getToken()
  let res: Response
  try {
    res = await fetch('/api' + path, { method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body) })
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the server.')
  }
  const data = await res.json().catch(() => null)
  if (res.status === 401 && data?.error?.code === 'bad_token' && getToken()) signedOut()  // expired or revoked: back to the sign-in screen
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Request failed (${res.status})`)
  return data as T
}

// File download (PDF, xlsx, csv): same identity headers as api(), result saved through a temporary link.
export async function download(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = { 'X-Role': role }
  if (userId) headers['X-User'] = userId
  if (getToken()) headers['Authorization'] = 'Bearer ' + getToken()
  let res: Response
  try { res = await fetch('/api' + path, { headers }) } catch { throw new ApiError(0, 'network', 'Cannot reach the server.') }
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Download failed (${res.status})`)
  }
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export const api = <T,>(method: 'GET' | 'POST', path: string, body?: unknown) => call<T>(method, path, role, body, true)

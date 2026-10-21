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
  section: string | null; is_header: boolean; needs_review: boolean; ocr_confidence: number | null
  attrs: Record<string, unknown>; attrs_unmapped: Record<string, unknown>
  item_key: string | null
}
export interface Provenance {
  cost_item_id: string; supplier: string; source_doc_id: string; source_doc_no: string
  line_id: string; source_line_id: string; cost_date: string; unit_cost: string; cost_snapshot: string
  current_unit_cost: string; cost_is_stale: boolean; line_margin: string
}
export interface Me { role: Role; name: string; org: { name: string; logo_url: string | null } }
export interface DocDetail {
  doc: DocSummary & { terms?: Record<string, unknown> }
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
const USER = '00000000-0000-0000-0000-000000000001' // simulated X-User

let role: Role = (() => { try { return localStorage.getItem('role') === 'staff' ? 'staff' : 'owner' } catch { return 'owner' } })()
export const getRole = () => role
export const setRole = (r: Role) => { role = r; try { localStorage.setItem('role', r) } catch { /* storage blocked */ } }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

export async function api<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  if (MOCK) {
    const { mock } = await import('./mock')
    await new Promise(r => setTimeout(r, 120))
    return mock(method, path, role, body) as T
  }
  let res: Response
  try {
    res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Role': role, 'X-User': USER },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the server.')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Request failed (${res.status})`)
  return data as T
}

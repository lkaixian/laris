import { useEffect, useRef, useState } from 'react'
import { ApiError, can } from './api'
import { Async, useFetch } from './ui'
import { Icon } from './icons'

// "History" of one document (GET /api/documents/{id}/timeline, needs view_audit). Fetched only when opened. A 403 removes the section.
interface Ev { at: string; kind: 'created' | 'status' | 'message' | 'sent' | 'decision'; title: string; actor: string | null; detail?: string | null }
interface TL { events: Ev[]; stage?: { status: string; label: string; since: string; days_in_stage: number; overdue: boolean; reason: string | null } }

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
export function relTime(iso: string, now = Date.now()): string {
  const s = (new Date(iso).getTime() - now) / 1000
  if (Number.isNaN(s)) return iso
  const a = Math.abs(s)
  if (a < 60) return 'just now'
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  return rtf.format(Math.round(s / 86400), 'day')
}
const abs = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' }) }
const KIND: Record<Ev['kind'], string> = { created: 'Created', status: 'Status', message: 'Message', sent: 'Sent', decision: 'Decision' }

function Body({ id, status, onForbidden }: { id: string; status: string; onForbidden: () => void }) {
  const s = useFetch<TL>(`/documents/${id}/timeline`)
  const forbidden = s.err instanceof ApiError && s.err.status === 403
  useEffect(() => { if (forbidden) onForbidden() }, [forbidden])  // eslint-disable-line react-hooks/exhaustive-deps
  const first = useRef(true)
  useEffect(() => { if (first.current) { first.current = false; return } s.reload() }, [status])  // eslint-disable-line react-hooks/exhaustive-deps
  if (forbidden) return null
  const st = s.data?.stage
  const events = s.data?.events ?? []
  return (
    <Async s={s} rows={3} shape="text">
      {st && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span>{/^in /i.test(st.label) ? '' : 'In '}<strong>{st.label}</strong> {st.days_in_stage < 1 ? 'since today' : `for ${st.days_in_stage} ${st.days_in_stage === 1 ? 'day' : 'days'}`}</span>
          {st.overdue && <span className="badge badge-warn"><Icon name="warn" className="mr-1 inline size-3.5 align-text-bottom" />Overdue{st.reason ? `: ${st.reason}` : ''}</span>}
        </p>
      )}
      {events.length === 0 ? <p className="text-sm text-muted">No history recorded yet.</p> : (
        <ol className="ml-2 border-l-2 border-soft">
          {events.map((e, i) => (
            <li key={i} className="relative pb-4 pl-4 last:pb-0">
              <span aria-hidden="true" className="absolute -left-[7px] top-1.5 size-3 rounded-full border-2 border-accent bg-surface" />
              <p className="text-sm"><span className="font-semibold">{e.title}</span> <span className="badge ml-1">{KIND[e.kind] ?? e.kind}</span></p>
              <p className="text-xs text-muted"><time dateTime={e.at} title={abs(e.at)}>{relTime(e.at)}</time> · {e.actor ? (e.actor === 'system' ? 'System' : e.actor) : 'Customer or supplier chat'}</p>
              {e.detail && <p className="mt-1 whitespace-pre-line break-words text-sm">{e.detail}</p>}
            </li>
          ))}
        </ol>
      )}
    </Async>
  )
}

export function Timeline({ id, status }: { id: string; status: string }) {
  const [open, setOpen] = useState(false)
  const [gone, setGone] = useState(false)
  if (!can('view_audit') || gone) return null
  return (
    <section className="card" aria-labelledby="hist-h">
      <h2 id="hist-h" className="font-semibold">
        <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 text-left" aria-expanded={open} aria-controls="hist-body" onClick={() => setOpen(o => !o)}>
          History<Icon name={open ? 'down' : 'right'} className="size-4" />
        </button>
      </h2>
      <div id="hist-body" hidden={!open}>{open && <Body id={id} status={status} onForbidden={() => setGone(true)} />}</div>
    </section>
  )
}

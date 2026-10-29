import { useEffect, useRef, useState } from 'react'
import { ApiError, can } from './api'
import { Async, useFetch } from './ui'
import { Icon } from './icons'
import { locale, t, useLang } from './i18n'
import type { Text } from './i18n'
import { tx } from './strings'

const S = {
  now: { en: 'just now', ms: 'baru sebentar tadi', zh: '刚刚', ta: 'இப்போதுதான்' },
  today: { en: 'since today', ms: 'sejak hari ini', zh: '自今天起', ta: 'இன்று முதல்' },
  in: { en: 'In ', ms: 'Dalam ', zh: '处于 ', ta: 'நிலை: ' },
  none: { en: 'No history recorded yet.', ms: 'Belum ada sejarah direkodkan.', zh: '尚无历史记录。', ta: 'இன்னும் வரலாறு பதிவு செய்யப்படவில்லை.' },
  system: { en: 'System', ms: 'Sistem', zh: '系统', ta: 'அமைப்பு' },
  chat: { en: 'Customer or supplier chat', ms: 'Sembang pelanggan atau pembekal', zh: '客户或供应商聊天', ta: 'வாடிக்கையாளர் அல்லது சப்ளையர் அரட்டை' },
  history: { en: 'History', ms: 'Sejarah', zh: '历史记录', ta: 'வரலாறு' },
} satisfies Record<string, Text>

// "History" of one document (GET /api/documents/{id}/timeline, needs view_audit). Fetched only when opened. A 403 removes the section.
interface Ev { at: string; kind: 'created' | 'status' | 'message' | 'sent' | 'decision'; title: string; actor: string | null; detail?: string | null }
interface TL { events: Ev[]; stage?: { status: string; label: string; since: string; days_in_stage: number; overdue: boolean; reason: string | null } }

export function relTime(iso: string, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })
  const s = (new Date(iso).getTime() - now) / 1000
  if (Number.isNaN(s)) return iso
  const a = Math.abs(s)
  if (a < 60) return t(S.now)
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  return rtf.format(Math.round(s / 86400), 'day')
}
const abs = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) }
const KIND: Record<Ev['kind'], Text> = {
  created: { en: 'Created', ms: 'Dicipta', zh: '已创建', ta: 'உருவாக்கப்பட்டது' }, status: { en: 'Status', ms: 'Status', zh: '状态', ta: 'நிலை' },
  message: { en: 'Message', ms: 'Mesej', zh: '消息', ta: 'செய்தி' }, sent: { en: 'Sent', ms: 'Dihantar', zh: '已发送', ta: 'அனுப்பப்பட்டது' },
  decision: { en: 'Decision', ms: 'Keputusan', zh: '决定', ta: 'முடிவு' },
}

function Body({ id, status, onForbidden }: { id: string; status: string; onForbidden: () => void }) {
  useLang()
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
          <span>{/^in /i.test(st.label) ? '' : t(S.in)}<strong>{st.label}</strong> {st.days_in_stage < 1 ? t(S.today) : t({ en: `for ${st.days_in_stage} ${st.days_in_stage === 1 ? 'day' : 'days'}`, ms: `selama ${st.days_in_stage} hari`, zh: `已 ${st.days_in_stage} 天`, ta: `${st.days_in_stage} நாட்களாக` })}</span>
          {st.overdue && <span className="badge badge-warn"><Icon name="warn" className="mr-1 inline size-3.5 align-text-bottom" />{tx('common.overdue')}{st.reason ? `: ${st.reason}` : ''}</span>}
        </p>
      )}
      {events.length === 0 ? <p className="text-sm text-muted">{t(S.none)}</p> : (
        <ol className="ml-2 border-l-2 border-soft">
          {events.map((e, i) => (
            <li key={i} className="relative pb-4 pl-4 last:pb-0">
              <span aria-hidden="true" className="absolute -left-[7px] top-1.5 size-3 rounded-full border-2 border-accent bg-surface" />
              <p className="text-sm"><span className="font-semibold">{e.title}</span> <span className="badge ml-1">{KIND[e.kind] ? t(KIND[e.kind]) : e.kind}</span></p>
              <p className="text-xs text-muted"><time dateTime={e.at} title={abs(e.at)}>{relTime(e.at)}</time> · {e.actor ? (e.actor === 'system' ? t(S.system) : e.actor) : t(S.chat)}</p>
              {e.detail && <p className="mt-1 whitespace-pre-line break-words text-sm">{e.detail}</p>}
            </li>
          ))}
        </ol>
      )}
    </Async>
  )
}

export function Timeline({ id, status }: { id: string; status: string }) {
  useLang()
  const [open, setOpen] = useState(false)
  const [gone, setGone] = useState(false)
  if (!can('view_audit') || gone) return null
  return (
    <section className="card" aria-labelledby="hist-h">
      <h2 id="hist-h" className="font-semibold">
        <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 text-left" aria-expanded={open} aria-controls="hist-body" onClick={() => setOpen(o => !o)}>
          {t(S.history)}<Icon name={open ? 'down' : 'right'} className="size-4" />
        </button>
      </h2>
      <div id="hist-body" hidden={!open}>{open && <Body id={id} status={status} onForbidden={() => setGone(true)} />}</div>
    </section>
  )
}

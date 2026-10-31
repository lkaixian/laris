import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError, DENIED } from './api'
import { tx, txOr } from './strings'
import { t, useLang, locale } from './i18n'
import type { Text } from './i18n'
import { hasGuide, openGuide } from './Guide'
import { useShowTutorialButton } from './helpPrefs'
import type { Me } from './api'
import { Icon } from './icons'
import { setThemePref } from './skin'
import type { IconName } from './icons'

const S = {
  notSet: { en: 'Not set', ms: 'Belum ditetapkan', zh: '未设置', ta: 'அமைக்கப்படவில்லை' },
  wrong: { en: 'Something went wrong.', ms: 'Ada masalah berlaku.', zh: '出了点问题。', ta: 'ஏதோ தவறு ஏற்பட்டது.' },
  denied: { en: DENIED, ms: 'Anda tiada kebenaran untuk berbuat demikian. Tanya pemilik.', zh: '您没有权限执行此操作。请询问老板。', ta: 'இதைச் செய்ய உங்களுக்கு அனுமதி இல்லை. உரிமையாளரிடம் கேளுங்கள்.' },
  ai: { en: 'The AI reading service is unavailable (ilmu_unavailable). Nothing was saved.', ms: 'Perkhidmatan bacaan AI tidak tersedia (ilmu_unavailable). Tiada apa yang disimpan.', zh: 'AI 读取服务暂时无法使用 (ilmu_unavailable)。没有保存任何内容。', ta: 'AI வாசிப்புச் சேவை கிடைக்கவில்லை (ilmu_unavailable). எதுவும் சேமிக்கப்படவில்லை.' },
  ref: { en: 'Reference:', ms: 'Rujukan:', zh: '参考编号：', ta: 'குறிப்பு எண்:' },
  again: { en: 'Try again', ms: 'Cuba lagi', zh: '重试', ta: 'மீண்டும் முயற்சிக்கவும்' },
  nothing: { en: 'Nothing here yet.', ms: 'Belum ada apa-apa di sini.', zh: '这里还没有内容。', ta: 'இங்கே இன்னும் எதுவும் இல்லை.' },
  loading: { en: 'Loading', ms: 'Memuatkan', zh: '加载中', ta: 'ஏற்றுகிறது' },
  crumb: { en: 'Breadcrumb', ms: 'Jejak navigasi', zh: '导航路径', ta: 'வழிப் பாதை' },
  scroll: { en: 'Scroll sideways to see more columns', ms: 'Tatal ke sisi untuk melihat lebih banyak lajur', zh: '向侧边滚动可查看更多列', ta: 'மேலும் நெடுவரிசைகளைக் காண பக்கவாட்டில் உருட்டவும்' },
  dark: { en: 'Dark theme', ms: 'Tema gelap', zh: '深色主题', ta: 'இருண்ட தீம்' },
  ages: { en: 'Age colours', ms: 'Warna umur', zh: '时长颜色', ta: 'வயது நிறங்கள்' },
  offline: { en: 'You are offline. Changes cannot be saved until you reconnect.', ms: 'Anda di luar talian. Perubahan tidak dapat disimpan sehingga anda bersambung semula.', zh: '您已离线。重新连接后才能保存更改。', ta: 'நீங்கள் ஆஃப்லைனில் உள்ளீர்கள். மீண்டும் இணைக்கும் வரை மாற்றங்களைச் சேமிக்க முடியாது.' },
  back: { en: 'Back online', ms: 'Kembali dalam talian', zh: '已重新联网', ta: 'மீண்டும் ஆன்லைனில்' },
} satisfies Record<string, Text>

// ---------- helpers ----------
export const rm = (s: string | null | undefined) => (s == null ? t(S.notSet) : 'RM ' + Number(s).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
export const label = (s: string) => s.replace(/_/g, ' ')
const errText = (e: unknown) => (e instanceof ApiError && e.status === 403 && (e.code === 'permission_required' || e.code === 'owner_only') ? t(S.denied) : e instanceof Error ? (e.message === DENIED ? t(S.denied) : e.message) : t(S.wrong))
// Text for putting an error in front of the user; marks it shown so api.ts does not also raise the global error toast for it.
export const msg = (e: unknown) => { if (e instanceof ApiError) e.shown = true; return errText(e) }
export const REVIEWABLE = ['received', 'parsed'] // 'in' statuses where the API still allows line edits (src/api/routes.py)
// Stable focus target after an action or a route change: the page h1, else the main landmark.
export const focusTop = (preventScroll = false) => (document.querySelector<HTMLElement>('main h1') ?? document.getElementById('main'))?.focus({ preventScroll })

// path === null means "do not fetch" (a call that only some roles can make).
export function useFetch<T>(path: string | null) {
  const [s, set] = useState<{ data?: T; error?: string; err?: unknown; loading: boolean }>({ loading: path !== null })
  const [n, setN] = useState(0)
  useEffect(() => {
    if (path === null) return set({ loading: false })
    let live = true
    set(p => ({ ...p, loading: true, error: undefined, err: undefined }))
    api<T>('GET', path).then(data => live && set({ data, loading: false }), e => live && set({ loading: false, error: errText(e), err: e }))
    return () => { live = false }
  }, [path, n])
  // Back online: a load that failed is tried again (one that worked is left alone).
  const failed = !!s.error
  useEffect(() => { if (!failed) return; const h = () => setN(x => x + 1); addEventListener('laris:online', h); return () => removeEventListener('laris:online', h) }, [failed])
  // Something changed the data from outside this page (the floating assistant after a confirmed action): load again.
  useEffect(() => { const h = () => setN(x => x + 1); addEventListener('laris:changed', h); return () => removeEventListener('laris:changed', h) }, [])
  return { ...s, reload: () => setN(x => x + 1) }
}

// One in-flight action with a shared error shape. Retry is offered when the failure is the AI service or the network.
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<{ text: string; retry: boolean }>()
  const run = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setErr(undefined)
    try { await fn() } catch (e) {
      const ai = e instanceof ApiError && e.code === 'ilmu_unavailable'
      setErr({ text: ai ? t(S.ai) : msg(e), retry: ai || (e instanceof ApiError && e.code === 'network') })
      if (e instanceof ApiError) e.shown = true
    } finally { setBusy(false) }
  }
  return { busy, err, run }
}

export function ActionError({ err, onRetry, label }: { err?: { text: string; retry: boolean }; onRetry: () => void; label: string }) {
  if (!err) return null
  return (
    <div role="alert" className="card mt-3 border-warn bg-warn-bg text-warn">
      <p>{err.text}</p>
      {err.retry && <button type="button" className="btn mt-3" onClick={onRetry}>{label}</button>}
    </div>
  )
}

// Loading, error and empty states in one place. `rows`/`shape` size the skeleton; `emptyHint`/`emptyAction` turn an empty list into a next step.
export function Async({ s, empty, emptyText, emptyHint, emptyAction, rows, shape, children }: {
  s: { loading: boolean; error?: string; err?: unknown; data?: unknown; reload: () => void }; empty?: boolean; emptyText?: string
  emptyHint?: string; emptyAction?: EmptyAction; rows?: number; shape?: SkeletonShape; children: ReactNode
}) {
  useEffect(() => { if (s.err instanceof ApiError) s.err.shown = true }, [s.err])  // on screen here: no extra toast
  useLang()
  if (s.error) return (
    <div role="alert" className="card border-warn bg-warn-bg text-warn">
      <p className="flex items-start gap-2"><Icon name="warn" className="mt-0.5 size-4 shrink-0" />{s.error}</p>
      {s.err instanceof ApiError && s.err.requestId && <p className="mt-1 text-xs">{t(S.ref)} {s.err.requestId}</p>}
      <button className="btn mt-3" onClick={s.reload}>{t(S.again)}</button>
    </div>
  )
  if (s.loading && !s.data) return <Skeleton rows={rows} shape={shape} />
  if (empty) return <EmptyState title={emptyText ?? t(S.nothing)} hint={emptyHint} action={emptyAction} />
  return <>{children}</>
}

// Placeholder bars while data loads. role=status + aria-busy so it is announced once; the pulse stops under prefers-reduced-motion.
export type SkeletonShape = 'list' | 'cards' | 'text' | 'table' | 'tiles' | 'detail'
export function Skeleton({ rows = 3, shape = 'list' }: { rows?: number; shape?: SkeletonShape }) {
  useLang()
  // table: header bar plus 40px rows (the DataTable row height); tiles: 76px tiles in one strip; detail: title, key facts, panel.
  if (shape === 'table' || shape === 'tiles' || shape === 'detail') return (
    <div role="status" aria-busy="true" className="card overflow-hidden p-0">
      <span className="sr-only">{tx('common.loading')}</span>
      {shape === 'table' && <><div aria-hidden="true" className="skeleton h-9 rounded-none" />{Array.from({ length: rows }, (_, i) => <div key={i} aria-hidden="true" className="skeleton m-2 h-6" style={{ width: `${96 - ((i * 7) % 25)}%` }} />)}</>}
      {shape === 'tiles' && <div aria-hidden="true" className="grid grid-cols-2 md:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-[76px] rounded-none border-r border-surface" />)}</div>}
      {shape === 'detail' && <div aria-hidden="true" className="grid gap-3 p-4"><div className="skeleton h-7 w-1/2" /><div className="grid grid-cols-2 gap-3"><div className="skeleton h-10" /><div className="skeleton h-10" /></div><div className="skeleton h-32" /></div>}
    </div>
  )
  const h = shape === 'cards' ? 'h-24' : shape === 'text' ? 'h-4' : 'h-16'
  return (
    <div role="status" aria-busy="true" className={`grid ${shape === 'cards' ? 'sm:grid-cols-2' : ''} gap-3`}>
      <span className="sr-only">{tx('common.loading')}</span>
      {Array.from({ length: rows }, (_, i) => <div key={i} aria-hidden="true" className={`skeleton ${h}`} style={shape === 'text' ? { width: `${95 - ((i * 17) % 40)}%` } : undefined} />)}
    </div>
  )
}

export interface EmptyAction { label: string; href?: string; onClick?: () => void }
// An empty list with a clear next step. One primary action at most.
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: EmptyAction }) {
  return (
    <div className="card px-4 py-6">
      <p className="text-md font-semibold">{title}</p>
      {hint && <p className="mt-1 max-w-[60ch] text-sm text-muted">{hint}</p>}
      {action && (action.href
        ? <a className="btn btn-primary mt-3" href={action.href}>{action.label}</a>
        : <button type="button" className="btn btn-primary mt-3" onClick={action.onClick}>{action.label}</button>)}
    </div>
  )
}

// The organisation name for document.title ("Tracker · SAMPLE Signing Works"). Provided by App once /api/me is known.
export const OrgCtx = createContext('LARIS')

// Standard top of every page: optional Back link (detail pages), the one h1 (focus target on navigation), description,
// meta line, and a slot for the page's primary action. Also keeps <title> in step. Pass no title while loading: a skeleton shows and no h1 exists yet.
export interface Crumb { href?: string; label: string }
// "? How to" beside a page title: opens the step-by-step guide for this page, when it has one.
function GuideButton() {
  const show = useShowTutorialButton()   // Settings > Help can turn the button off
  const key = (location.hash.split('/')[1] || 'home').split('?')[0]
  if (!show || !hasGuide(key)) return null
  return <button type="button" className="guide-q" data-guide="how-to" aria-label={tx('guide.button')} title={tx('guide.button')} onClick={() => openGuide(key)}><span aria-hidden="true">?</span></button>
}

const ROUTE_ICON: Record<string, IconName> = { home: 'home', revenue: 'revenue', tracker: 'tracker', track: 'pipeline', jobs: 'jobs', deals: 'contacts', customers: 'contacts', buying: 'tracker', templates: 'upload', followups: 'clock', contacts: 'contacts', contact: 'contacts',
  ask: 'ask', catalog: 'camera', alerts: 'alerts', reports: 'tracker', activity: 'activity', team: 'team', roles: 'roles', settings: 'settings', privacy: 'roles', 'api-access': 'key', 'ai-settings': 'ask',
  status: 'warn', licence: 'key', issuer: 'key', purchase: 'key', doc: 'tracker', assistant: 'ask', account: 'team', help: 'ask', search: 'ask' }
const routeNow = () => (location.hash.split('/')[1] || 'home').split('?')[0]

export function PageHeader({ title, description, meta, actions, back, crumbs, status }: {
  title?: string; description?: ReactNode; meta?: ReactNode; actions?: ReactNode; back?: { href: string; label: string }; crumbs?: Crumb[]; status?: ReactNode
}) {
  const org = useContext(OrgCtx)
  const [lang] = useLang()
  useEffect(() => { document.title = `${title ?? t(S.loading)} · ${org}` }, [title, org, lang])
  const trail = crumbs ?? (back ? [back] : undefined)  // `back` is a single crumb with an arrow; `crumbs` ends with the current page
  const icon = ROUTE_ICON[routeNow()]
  return (
    <div className="glass-lite mb-4 p-4 md:p-5">
      {trail && (
        <nav aria-label={t(S.crumb)} className="mb-1 text-sm text-muted">
          <ol className="flex flex-wrap items-center">
            {trail.map((c, k) => {
              const last = !!crumbs && k === trail.length - 1
              return (
                <li key={k} className="flex items-center">
                  {k > 0 && <span aria-hidden="true" className="px-1.5">/</span>}
                  {c.href && !last
                    ? <a className="inline-flex min-h-8 items-center gap-1 hover:text-ink hover:underline [@media(pointer:coarse)]:min-h-11" href={c.href}>{!crumbs && <Icon name="back" className="size-4" />}{c.label}</a>
                    : <span aria-current={last ? 'page' : undefined}>{c.label}</span>}
                </li>
              )
            })}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-72 items-start gap-3">
          {icon && <span aria-hidden="true" className="glass-icon"><Icon name={icon} /></span>}
          <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {title !== undefined ? <h1 tabIndex={-1} className="break-words text-xl font-semibold">{title}</h1> : <div aria-hidden="true" className="skeleton h-7 w-56 max-w-full" />}
            {status}
            {!trail && <GuideButton />}
          </div>
          {meta && <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">{meta}</div>}
          {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

// A wide table in its own horizontal scroll region (keyboard focusable), with a visible hint while columns are cut off.
export function TableRegion({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  useLang()
  const box = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const check = () => setMore(el.scrollWidth > el.clientWidth + 1 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check); ro.observe(el); if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => { el.removeEventListener('scroll', check); ro.disconnect() }
  }, [])
  return (
    <div className="min-w-0 max-w-full">
      <div ref={box} className={`relative max-w-full overflow-x-auto ${className} glass-lite`} role="region" aria-label={label} tabIndex={0}>{children}</div>
      {more && <p aria-hidden="true" className="mt-1 text-xs text-muted">{t(S.scroll)}</p>}
    </div>
  )
}

// One short help line under a jargon field. Wire it with aria-describedby={id} on the input.
export function Hint({ id, children }: { id: string; children: ReactNode }) {
  return <span id={id} className="text-xs font-normal text-muted">{children}</span>
}

// compact = icon-only button for the app bar (same accessible name and aria-pressed). Default is the text button used on the sign-in screen.
export function ThemeToggle({ dark, setDark, compact }: { dark: boolean; setDark: (d: boolean) => void; compact?: boolean }) {
  useLang()
  const flip = () => {
    setDark(setThemePref(dark ? 'light' : 'dark'))
  }
  return compact
    ? <button type="button" className="btn size-(--control-h) px-0 aria-pressed:bg-tint" aria-pressed={dark} aria-label={t(S.dark)} title={t(S.dark)} onClick={flip}><Icon name="moon" /></button>
    : <button className="btn" aria-pressed={dark} onClick={flip}>{t(S.dark)}</button>
}

// LARIS logo: laris-logo.png (light) or laris-logo-dark.png (dark); falls back to the text wordmark when no file is there.
export function Brand({ dark }: { dark: boolean }) {
  const [failed, setFailed] = useState(false)
  return !failed
    ? <img src={`/brand/laris-logo${dark ? '-dark' : ''}.png`} alt="LARIS" width={131} height={28} className="h-7 w-auto" onError={() => setFailed(true)} />
    : <strong className="text-xl font-semibold tracking-[0.2em]">LARIS</strong>
}

// Brand colour for primary buttons and the active nav tab (--brand in theme.css). Only a strict #rrggbb ever reaches CSS; null restores the stock look.
export function applyBrand(org?: Me['org']) {
  const st = document.documentElement.style
  const c = org?.brand_color
  if (c && /^#[0-9a-f]{6}$/i.test(c)) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
    const lin = (v: number) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    const light = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.179  // pick text colour that reads on the brand colour
    st.setProperty('--brand', c); st.setProperty('--brand-hover', `color-mix(in srgb, ${c} 80%, black)`); st.setProperty('--on-brand', light ? '#06140f' : '#ffffff')
  } else for (const k of ['--brand', '--brand-hover', '--on-brand']) st.removeProperty(k)
  // Favicon from the logo (data URLs only); the stock icon comes back when there is none.
  const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]') ?? document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }))
  link.dataset.orig ??= link.getAttribute('href') ?? ''
  const logo = org?.logo_url
  if (logo?.startsWith('data:image/')) link.href = logo; else if (link.dataset.orig) link.href = link.dataset.orig; else link.removeAttribute('href')
}

export function OrgMark({ org }: { org: Me['org'] }) {
  const [broken, setBroken] = useState(false)
  const initials = org.name.replace(/^SAMPLE\s+/i, '').split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
  // The logo goes where the initials would, and the shop name always stays beside it.
  return (
    <span className="flex min-w-0 items-center gap-2">
      {org.logo_url && !broken
        ? <img src={org.logo_url} alt="" className="h-8 max-w-24 shrink-0 object-contain" onError={() => setBroken(true)} />
        : <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-ui bg-tint text-sm font-semibold text-accent">{initials}</span>}
      <span className="truncate text-sm font-semibold">{org.name}</span>
    </span>
  )
}

// The one status vocabulary: label and chip look for every document, quote, ask and catalog state. Unknown states get the draft look.
export const STATUS_LABEL: Record<string, string> = {
  received: 'Received', draft: 'Draft', parsed: 'Parsed', reviewed: 'Reviewed', accepted: 'Accepted', in_cost_book: 'In cost book', approved: 'Approved', sent: 'Sent', read: 'Opened',
  job_created: 'Job created', expired: 'Expired', rejected: 'Rejected', cancelled: 'Cancelled', superseded: 'Superseded', waiting: 'Waiting for supplier', needs_review: 'Needs review', ready: 'Ready',
  confirmed: 'Confirmed', discarded: 'Discarded',
}
export const stageLabel = (s: string) => txOr(`st.${s}`, STATUS_LABEL[s] ?? s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()))
export const STATUS_CHIP: Record<string, string> = {
  received: 'draft', draft: 'draft', parsed: 'draft', waiting: 'draft', needs_review: 'warn',
  reviewed: 'approved', approved: 'approved', ready: 'approved', confirmed: 'approved', in_cost_book: 'approved',
  sent: 'sent', read: 'read', accepted: 'accepted', job_created: 'job_created', rejected: 'rejected',
  expired: 'expired', cancelled: 'expired', superseded: 'expired', discarded: 'expired',
}
export function Status({ v }: { v: string }) {
  const k = STATUS_CHIP[v] ?? 'draft'
  return <span className={`chip chip-${k}`}>{k === 'warn' && <Icon name="warn" className="size-3" />}{stageLabel(v)}</span>
}
// Age colour bands from the server (src/track_rules.py heat): fresh 0-1 days, waiting 2-3, late 4-7, stale 8+.
export type Heat = 'fresh' | 'waiting' | 'late' | 'stale'
export const HEAT_BANDS: Heat[] = ['fresh', 'waiting', 'late', 'stale']
// [band, name, day range] in the current language
export const heatRows = (): [Heat, string, string][] => HEAT_BANDS.map(h => [h, txOr(`heat.${h}`, h), txOr(`heat.range.${h}`, '')])
export const heatName = (h: Heat) => txOr(`heat.${h}`, h)
const dayWord = (n: number) => tx('common.days', n)
export const HeatChip = ({ heat, days }: { heat?: Heat | null; days: number }) =>
  // The legend above the list already names each colour, so a row shows only its dot (the colour and shape come from .chip.heat-*) and the days.
  // The name stays as the hover title and is read out to screen readers.
  heat ? <span className={`chip heat-${heat} tabular-nums`} title={heatName(heat)}><span className="sr-only">{heatName(heat)}, </span>{dayWord(days)}</span> : <span className="text-muted tabular-nums">{dayWord(days)}</span>
export function HeatLegend({ counts }: { counts?: Partial<Record<Heat, number>> }) {
  useLang()
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted" aria-label={t(S.ages)}>
      <span>{tx('heat.legend')}</span>
      {heatRows().map(([h, name, range]) => <span key={h} className={`chip heat-${h}`}>{`${name} ${range}${counts ? ` (${counts[h] ?? 0})` : ''}`}</span>)}
    </p>
  )
}

export const OverdueChip = ({ reason }: { reason?: string | null }) => <span className="chip chip-warn"><Icon name="warn" className="size-3" />{tx('common.overdue')}{reason ? `: ${txOr(`why.${reason}`, reason)}` : ''}</span>

// Slim status line in the shell's banner slot. Offline: say changes cannot be saved. Back online: say so for 3 s and tell loaders that failed to try again ('laris:online').
export function OfflineBanner() {
  useLang()
  const [state, setState] = useState<'on' | 'off' | 'back'>(navigator.onLine ? 'on' : 'off')
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const off = () => { clearTimeout(t); setState('off') }
    const on = () => { setState('back'); window.dispatchEvent(new Event('laris:online')); clearTimeout(t); t = setTimeout(() => setState('on'), 3000) }
    addEventListener('offline', off); addEventListener('online', on)
    return () => { clearTimeout(t); removeEventListener('offline', off); removeEventListener('online', on) }
  }, [])
  return (
    <div role="status" className={state === 'on' ? undefined : `flex min-h-7 items-center justify-center px-4 text-xs ${state === 'off' ? 'bg-warn-bg text-warn' : 'bg-surface-2 text-ink'}`}>
      {state === 'off' ? t(S.offline) : state === 'back' ? t(S.back) : ''}
    </div>
  )
}

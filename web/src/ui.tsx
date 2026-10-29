import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError, DENIED } from './api'
import type { Me } from './api'
import { Icon } from './icons'

// ---------- helpers ----------
export const rm = (s: string | null | undefined) => (s == null ? 'Not set' : 'RM ' + Number(s).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
export const label = (s: string) => s.replace(/_/g, ' ')
const errText = (e: unknown) => (e instanceof ApiError && e.status === 403 && (e.code === 'permission_required' || e.code === 'owner_only') ? DENIED : e instanceof Error ? e.message : 'Something went wrong.')
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
      setErr({ text: ai ? 'The AI reading service is unavailable (ilmu_unavailable). Nothing was saved.' : msg(e), retry: ai || (e instanceof ApiError && e.code === 'network') })
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
  if (s.error) return (
    <div role="alert" className="card border-warn bg-warn-bg text-warn">
      <p className="flex items-start gap-2"><Icon name="warn" className="mt-0.5 size-4 shrink-0" />{s.error}</p>
      {s.err instanceof ApiError && s.err.requestId && <p className="mt-1 text-xs">Reference: {s.err.requestId}</p>}
      <button className="btn mt-3" onClick={s.reload}>Try again</button>
    </div>
  )
  if (s.loading && !s.data) return <Skeleton rows={rows} shape={shape} />
  if (empty) return <EmptyState title={emptyText ?? 'Nothing here yet.'} hint={emptyHint} action={emptyAction} />
  return <>{children}</>
}

// Placeholder bars while data loads. role=status + aria-busy so it is announced once; the pulse stops under prefers-reduced-motion.
export type SkeletonShape = 'list' | 'cards' | 'text' | 'table' | 'tiles' | 'detail'
export function Skeleton({ rows = 3, shape = 'list' }: { rows?: number; shape?: SkeletonShape }) {
  // table: header bar plus 40px rows (the DataTable row height); tiles: 76px tiles in one strip; detail: title, key facts, panel.
  if (shape === 'table' || shape === 'tiles' || shape === 'detail') return (
    <div role="status" aria-busy="true" className="card overflow-hidden p-0">
      <span className="sr-only">Loading...</span>
      {shape === 'table' && <><div aria-hidden="true" className="skeleton h-9 rounded-none" />{Array.from({ length: rows }, (_, i) => <div key={i} aria-hidden="true" className="skeleton m-2 h-6" style={{ width: `${96 - ((i * 7) % 25)}%` }} />)}</>}
      {shape === 'tiles' && <div aria-hidden="true" className="grid grid-cols-2 md:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-[76px] rounded-none border-r border-surface" />)}</div>}
      {shape === 'detail' && <div aria-hidden="true" className="grid gap-3 p-4"><div className="skeleton h-7 w-1/2" /><div className="grid grid-cols-2 gap-3"><div className="skeleton h-10" /><div className="skeleton h-10" /></div><div className="skeleton h-32" /></div>}
    </div>
  )
  const h = shape === 'cards' ? 'h-24' : shape === 'text' ? 'h-4' : 'h-16'
  return (
    <div role="status" aria-busy="true" className={`grid ${shape === 'cards' ? 'sm:grid-cols-2' : ''} gap-3`}>
      <span className="sr-only">Loading...</span>
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
export function PageHeader({ title, description, meta, actions, back, crumbs, status }: {
  title?: string; description?: ReactNode; meta?: ReactNode; actions?: ReactNode; back?: { href: string; label: string }; crumbs?: Crumb[]; status?: ReactNode
}) {
  const org = useContext(OrgCtx)
  useEffect(() => { document.title = `${title ?? 'Loading'} · ${org}` }, [title, org])
  const trail = crumbs ?? (back ? [back] : undefined)  // `back` is a single crumb with an arrow; `crumbs` ends with the current page
  return (
    <div className="mb-5">
      {trail && (
        <nav aria-label="Breadcrumb" className="mb-1 text-sm text-muted">
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
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {title !== undefined ? <h1 tabIndex={-1} className="break-words text-lg font-semibold">{title}</h1> : <div aria-hidden="true" className="skeleton h-7 w-56 max-w-full" />}
            {status}
          </div>
          {meta && <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">{meta}</div>}
          {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

// A wide table in its own horizontal scroll region (keyboard focusable), with a visible hint while columns are cut off.
export function TableRegion({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
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
      <div ref={box} className={`relative max-w-full overflow-x-auto ${className} rounded-card border border-hairline bg-surface`} role="region" aria-label={label} tabIndex={0}>{children}</div>
      {more && <p aria-hidden="true" className="mt-1 text-xs text-muted">Scroll sideways to see more columns</p>}
    </div>
  )
}

// One short help line under a jargon field. Wire it with aria-describedby={id} on the input.
export function Hint({ id, children }: { id: string; children: ReactNode }) {
  return <span id={id} className="text-xs font-normal text-muted">{children}</span>
}

// compact = icon-only button for the app bar (same accessible name and aria-pressed). Default is the text button used on the sign-in screen.
export function ThemeToggle({ dark, setDark, compact }: { dark: boolean; setDark: (d: boolean) => void; compact?: boolean }) {
  const flip = () => {
    const t = dark ? 'light' : 'dark'
    document.documentElement.dataset.theme = t
    try { localStorage.setItem('theme', t) } catch { /* storage blocked: choice lasts for this visit only */ }
    setDark(!dark)
  }
  return compact
    ? <button type="button" className="btn size-(--control-h) px-0 aria-pressed:bg-tint" aria-pressed={dark} aria-label="Dark theme" title="Dark theme" onClick={flip}><Icon name="moon" /></button>
    : <button className="btn" aria-pressed={dark} onClick={flip}>Dark theme</button>
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
  if (org.logo_url && !broken) return <img src={org.logo_url} alt={org.name} className="h-8 max-w-40 object-contain" onError={() => setBroken(true)} />
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-ui bg-tint text-sm font-semibold text-accent">{initials}</span>
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
export const stageLabel = (s: string) => STATUS_LABEL[s] ?? s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
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
export const HEAT: [Heat, string, string][] = [['fresh', 'Fresh', '0 to 1 day'], ['waiting', 'Waiting', '2 to 3 days'], ['late', 'Late', '4 to 7 days'], ['stale', 'Stale', '8 days or more']]
export const heatName = (h: Heat) => HEAT.find(x => x[0] === h)?.[1] ?? h
const dayWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`
export const HeatChip = ({ heat, days }: { heat?: Heat | null; days: number }) =>
  heat ? <span className={`chip heat-${heat} tabular-nums`}>{`${heatName(heat)}, ${dayWord(days)}`}</span> : <span className="text-muted tabular-nums">{dayWord(days)}</span>
export function HeatLegend({ counts }: { counts?: Partial<Record<Heat, number>> }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted" aria-label="Age colours">
      <span>Age colours:</span>
      {HEAT.map(([h, name, range]) => <span key={h} className={`chip heat-${h}`}>{`${name} ${range}${counts ? ` (${counts[h] ?? 0})` : ''}`}</span>)}
    </p>
  )
}

export const OverdueChip = ({ reason }: { reason?: string | null }) => <span className="chip chip-warn"><Icon name="warn" className="size-3" />Overdue{reason ? `: ${reason}` : ''}</span>

// Slim status line in the shell's banner slot. Offline: say changes cannot be saved. Back online: say so for 3 s and tell loaders that failed to try again ('laris:online').
export function OfflineBanner() {
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
      {state === 'off' ? 'You are offline. Changes cannot be saved until you reconnect.' : state === 'back' ? 'Back online' : ''}
    </div>
  )
}

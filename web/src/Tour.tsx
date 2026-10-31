import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { api, can, canOpen } from './api'
import type { Me } from './api'
import { t, useLang } from './i18n'
import { FirstRun } from './FirstRun'
import { applyOnb, buildSteps, firstRunVisible, kindFor, resumable, routeOf } from './tours'
import type { Onb, OnbPatch, TourKind } from './tours'

export type { TourKind }

// ---- state shared with startTour(): which tour is running, and the person's saved answer (server first, localStorage when the call fails).
interface St { active: { kind: TourKind; i: number } | null; view: Onb | null; hide: boolean }
let st: St = { active: null, view: null, hide: false }
const subs = new Set<() => void>()
const set = (p: Partial<St>) => { st = { ...st, ...p }; subs.forEach(f => f()) }
const useSt = () => useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb) } }, () => st)

let ownerFlag = false, uid = ''
const kindNow = () => kindFor(ownerFlag, can('view_costs'))
const fresh = (): Onb => ({ tour: kindNow(), state: 'new', step: 0, later_count: 0 })
const readLocal = (): Onb | null => { try { const v = localStorage.getItem(`laris.onboarding.${uid}`); return v ? JSON.parse(v) : null } catch { return null } }
const writeLocal = (v: Onb) => { try { localStorage.setItem(`laris.onboarding.${uid}`, JSON.stringify(v)) } catch { /* storage blocked: the server copy still holds */ } }

async function load() {
  try { const v = await api<Onb>('GET', '/me/onboarding'); writeLocal(v); set({ view: v }) } catch { set({ view: readLocal() ?? fresh() }) }
}
function save(p: OnbPatch) {
  const next = applyOnb(st.view ?? fresh(), p)
  set({ view: next }); writeLocal(next)
  api<Onb>('POST', '/me/onboarding', p).then(v => set({ view: v }), () => undefined)  // failed call: the local copy above is the fallback
}

/** Start (or restart at step 0) the tour. Called by the Help Center and the account menu. */
export function startTour(kind?: TourKind): void {
  const k = kind ?? kindNow()
  set({ active: { kind: k, i: 0 } })
  save({ state: 'in_progress', step: 0, tour: k })
}

// ---- helpers
const visible = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
const findEl = (sel: string) => {
  for (const s of sel.split(' || ')) { const e = [...document.querySelectorAll<HTMLElement>(s)].find(visible); if (e) return e }
  return null
}
const useRoute = () => {
  const [h, setH] = useState(location.hash)
  useEffect(() => { const f = () => setH(location.hash); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  return routeOf(h)
}
const ctx = (bot: boolean) => ({ can, canOpen: (r: string) => canOpen(r, ownerFlag), bot })
interface Box { x: number; y: number; w: number; h: number }

const FADE = '@keyframes tourfade{from{opacity:0}to{opacity:1}}.tour-fade{animation:tourfade 150ms ease-out}.tour-glide{transition:top 320ms var(--ease-tile),left 320ms var(--ease-tile),width 320ms var(--ease-tile),height 320ms var(--ease-tile),right 320ms var(--ease-tile)}'  // reduced motion: the global rule in theme.css turns it off

export function TourHost({ me, owner }: { me: Me; owner: boolean }) {
  useLang()
  const s = useSt()
  const route = useRoute()
  useEffect(() => { ownerFlag = owner }, [owner])
  useEffect(() => {
    if (uid === me.id) return
    uid = me.id; ownerFlag = owner
    set({ active: null, view: null, hide: false }); load()
  }, [me.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (s.active) return <Tour kind={s.active.kind} i={s.active.i} />
  const v = s.view
  if (!v || s.hide || route !== 'home') return null
  const resume = resumable(v)
  if (!resume && !firstRunVisible(v)) return null
  const kind = kindNow()
  return <FirstRun name={me.name} resume={resume ? { step: v.step, total: buildSteps(kind, ctx(true)).length } : undefined}
    onYes={() => { if (resume) set({ active: { kind: v.tour, i: v.step } }); else startTour(kind) }}
    onNo={() => save({ state: 'skipped' })}
    onLater={() => { save({ state: 'later' }); set({ hide: true }) }}
    onHide={() => set({ hide: true })} />
}

function Tour({ kind, i }: { kind: TourKind; i: number }) {
  useLang()
  const [bot, setBot] = useState<boolean>()
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [, force] = useState(0)
  const [ch, setCh] = useState(260)
  const card = useRef<HTMLDivElement>(null)
  const dir = useRef(1)

  // The owner's last card depends on whether a customer bot exists.
  useEffect(() => {
    if (kind !== 'owner') return setBot(true)
    let live = true
    api<{ bot: { connected: boolean } }>('GET', '/settings/telegram').then(d => live && setBot(d.bot.connected), () => live && setBot(false))
    return () => { live = false }
  }, [kind])
  const steps = useMemo(() => bot === undefined ? [] : buildSteps(kind, ctx(bot)), [kind, bot])
  const idx = Math.min(i, steps.length - 1)
  const step = steps[idx]

  const go = (n: number, d = 1) => {
    if (n >= steps.length) return end('done')
    dir.current = d
    const k = Math.max(0, n)
    set({ active: { kind, i: k } }); save({ state: 'in_progress', step: k, tour: kind })
  }
  const end = (state: 'done' | 'skipped') => { set({ active: null }); save({ state, tour: kind }) }
  const close = () => set({ active: null })  // saved as in_progress, so "Continue the tour" is offered later
  const next = () => go(idx + 1)
  const back = () => go(idx - 1, -1)
  const missing = () => (idx + dir.current < 0 ? go(idx + 1) : go(idx + dir.current, dir.current))

  // Focus into the card, restore it afterwards.
  useEffect(() => {
    const from = document.activeElement as HTMLElement | null
    card.current?.focus()
    const f = () => force(n => n + 1)
    const nav = () => setTimeout(() => { if (card.current && !card.current.contains(document.activeElement)) card.current.focus() }, 150)  // the app moves focus to the new page heading
    addEventListener('resize', f); addEventListener('hashchange', nav)
    return () => { removeEventListener('resize', f); removeEventListener('hashchange', nav); if (from?.isConnected) from.focus() }
  }, [bot === undefined])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close() } }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { const h = card.current?.offsetHeight; if (h && h !== ch) setCh(h) })

  // Find the target (waits up to 3 s for the page and its data), keep the highlight on it, skip the step when it never shows.
  useEffect(() => {
    if (!step) return
    setEl(null); setBox(null)
    if (step.route && routeOf(location.hash) !== step.route) location.hash = '#/' + step.route
    if (!step.sel) return
    let cur: HTMLElement | null = null, miss = 0, revealed = false
    const id = setInterval(() => {
      if (!cur || !cur.isConnected) {
        cur = findEl(step.sel!)
        if (!cur) { if (!revealed && miss > 3) { const b = step.reveal?.(); if (b) { revealed = true; b.click() } } if (++miss > 30) { clearInterval(id); if (!step.soft) missing() } return }
        miss = 0; cur.scrollIntoView({ block: 'center' }); setEl(cur)
      }
      const r = cur.getBoundingClientRect()
      setBox(p => p && p.x === r.x && p.y === r.y && p.w === r.width && p.h === r.height ? p : { x: r.x, y: r.y, w: r.width, h: r.height })
    }, 100)
    return () => clearInterval(id)
  }, [step?.id, bot]) // eslint-disable-line react-hooks/exhaustive-deps

  // "Do it" steps move on when the person really does it.
  useEffect(() => {
    if (!step || (!step.doRoute && !step.doClick)) return
    const h = () => { if (step.doRoute && routeOf(location.hash) === step.doRoute) go(idx + 1) }
    const c = (e: MouseEvent) => { if (step.doClick && el?.contains(e.target as Node)) setTimeout(() => go(idx + 1), 0) }
    addEventListener('hashchange', h); document.addEventListener('click', c, true)
    return () => { removeEventListener('hashchange', h); document.removeEventListener('click', c, true) }
  }, [step?.id, el]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!step) return null
  const total = steps.length
  const title = t(step.title), body = t(step.body)

  // Keyboard: Tab stays in the card; n p s e only act while focus is in the card and not in a field (WCAG 2.1.4).
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      const f = [...card.current!.querySelectorAll<HTMLElement>('button,a[href]')], a = f[0], z = f[f.length - 1]
      if (!f.length) return e.preventDefault()
      if (e.shiftKey && (document.activeElement === a || document.activeElement === card.current)) { e.preventDefault(); z.focus() }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
      return
    }
    const tg = e.target as HTMLElement
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable) return
    const k = e.key.toLowerCase()
    if (k === 'n' && !step.bot) next(); else if (k === 'p' && idx > 0) back(); else if (k === 's') end('skipped'); else if (k === 'e') close()
  }
  const doIt = () => {
    if (step.doRoute) { const a = el?.closest('a') ?? el?.querySelector('a'); if (a) a.click(); else location.hash = '#/' + step.doRoute }
    else el?.click()
  }
  const simulate = () => {
    const d = el?.matches('details') ? el : el?.querySelector('details')
    if (d && !d.open) d.open = true
    requestAnimationFrame(() => document.getElementById('enquiry-text')?.focus())
  }

  const pad = 6, r = box && { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), w: box.w + pad * 2, h: box.h + pad * 2 }
  const narrow = innerWidth < 640, W = Math.min(352, innerWidth - 16)
  let pos: React.CSSProperties = { left: Math.max(8, (innerWidth - W) / 2), top: Math.max(8, (innerHeight - ch) / 2), width: W }
  if (narrow) pos = { left: 0, right: 0, bottom: 0 }
  else if (r) pos = { width: W, left: Math.min(Math.max(8, r.x), innerWidth - W - 8),
    top: r.y + r.h + 12 + ch < innerHeight ? r.y + r.h + 12 : r.y - ch - 12 > 8 ? r.y - ch - 12 : Math.max(8, innerHeight - ch - 8) }
  const dim = 'tour-fade tour-glide fixed z-[80] bg-bg/70 backdrop-blur-[6px]'
  const hint = (k: string) => <span aria-hidden="true" className="ml-1 text-xs">({k})</span>

  return (
    <>
      <style>{FADE}</style>
      {r ? <>
        <div aria-hidden="true" className={dim} style={{ top: 0, left: 0, right: 0, height: r.y }} />
        <div aria-hidden="true" className={dim} style={{ top: r.y + r.h, left: 0, right: 0, bottom: 0 }} />
        <div aria-hidden="true" className={dim} style={{ top: r.y, height: r.h, left: 0, width: r.x }} />
        <div aria-hidden="true" className={dim} style={{ top: r.y, height: r.h, left: r.x + r.w, right: 0 }} />
        <div aria-hidden="true" className="tour-glide pointer-events-none fixed z-[80] rounded-ui border-2 border-accent" style={{ top: r.y, left: r.x, width: r.w, height: r.h }} />
      </> : <div aria-hidden="true" className={dim} style={{ inset: 0 }} />}
      <div ref={card} role="dialog" aria-modal="true" aria-label={t({ en: 'Guided tour', ms: 'Lawatan berpandu' })} tabIndex={-1} onKeyDown={keys}
        className="tour-fade tour-glide card fixed z-[81] border-accent shadow-3 outline-none" style={pos}>
        <p aria-live="polite" className="sr-only">{`${idx + 1} / ${total}. ${title}. ${body}`}</p>
        <p className="text-sm font-semibold text-muted">{t({ en: `${idx + 1} of ${total}`, ms: `${idx + 1} daripada ${total}` })}</p>
        <h2 className="mt-1 text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm">{body}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {step.bot ? <>
            <a className="btn btn-primary" href="#/settings" onClick={() => end('done')}>{t({ en: 'Create my bot in Telegram', ms: 'Cipta bot saya di Telegram' })}</a>
            <button type="button" className="btn" onClick={() => end('done')}>{t({ en: 'Maybe later', ms: 'Mungkin nanti' })}</button>
          </> : <>
            {step.link && <a className="btn" href={step.link.href} onClick={() => end('done')}>{t(step.link.label)}</a>}
            {step.sim && <button type="button" className="btn" onClick={simulate}>{t({ en: 'Simulate an enquiry', ms: 'Simulasi pertanyaan' })}</button>}
            {(step.doRoute || step.doClick) && el && <button type="button" className="btn" onClick={doIt}>{t({ en: 'Do it for me', ms: 'Lakukan untuk saya' })}</button>}
          </>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn" aria-keyshortcuts="p" aria-disabled={idx === 0 || undefined} onClick={() => idx > 0 && back()}>{t({ en: 'Back', ms: 'Kembali' })}{hint('p')}</button>
          {!step.bot && <button type="button" className="btn btn-primary" aria-keyshortcuts="n" onClick={next}>{idx + 1 === total ? t({ en: 'Finish', ms: 'Selesai' }) : t({ en: 'Next', ms: 'Seterusnya' })}{hint('n')}</button>}
          <button type="button" className="link ml-auto min-h-11 px-2" aria-keyshortcuts="s" onClick={() => end('skipped')}>{t({ en: 'Skip tour', ms: 'Langkau lawatan' })}{hint('s')}</button>
        </div>
        <p className="mt-2 text-xs text-muted">{t({ en: 'Keys: n next, p back, s skip, e or Esc close.', ms: 'Kekunci: n seterusnya, p kembali, s langkau, e atau Esc tutup.' })}</p>
      </div>
    </>
  )
}

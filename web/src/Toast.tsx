import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './icons'
import { t, useLang } from './i18n'

// Light toast system.
//   const toast = useToast(); toast('Settings saved.')          confirmation: polite, gone after 5 s
//   toast.error('That did not work. Reference: abc')             unexpected error: assertive (role=alert), stays until dismissed
// Max 3 at once (oldest dropped), each has a Dismiss button. Form errors stay inline next to the thing that failed; the error variant is for
// failures nobody is looking at: 5xx from api.ts and uncaught errors / rejections (window listeners below), de-duplicated by text for 10 s.
//   toast('Contact removed.', { action: { label: 'Undo', onClick: restore } })   optional action button (a plain { href, label } link still works)
// Hover or keyboard focus on a toast pauses its 5 s timer.
type Link = { href: string; label: string }
type Action = { label: string; onClick: () => void }
type Toaster = ((text: string, link?: Link | { action: Action }) => void) & { error: (text: string) => void }
const Ctx = createContext<Toaster>(Object.assign(() => undefined, { error: () => undefined }))
export const useToast = () => useContext(Ctx)

const MAX = 3
const LIFE_MS = 5000
const DEDUPE_MS = 10_000
const generic = () => t({ en: 'Something went wrong. Reload the page if it keeps happening.', ms: 'Sesuatu tidak kena. Muat semula halaman jika ia berterusan.', zh: '出了点问题。如果问题持续出现，请重新加载页面。', ta: 'ஏதோ தவறு நடந்துவிட்டது. தொடர்ந்தால் பக்கத்தை மீண்டும் ஏற்றவும்.' })

export function ToastProvider({ children }: { children: ReactNode }) {
  useLang()
  const [list, setList] = useState<{ id: number; text: string; link?: Link; action?: Action; error?: boolean }[]>([])
  const n = useRef(0)
  const recent = useRef(new Map<string, number>())
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const dismiss = useCallback((id: number) => { clearTimeout(timers.current.get(id)); timers.current.delete(id); setList(l => l.filter(t => t.id !== id)) }, [])
  const arm = useCallback((id: number) => { clearTimeout(timers.current.get(id)); timers.current.set(id, setTimeout(() => dismiss(id), LIFE_MS)) }, [dismiss])
  const hold = (id: number) => { clearTimeout(timers.current.get(id)) }
  const push = useMemo<Toaster>(() => {
    const add = (text: string, extra?: Link | { action: Action }, error?: boolean) => {
      const id = ++n.current
      const link = extra && 'href' in extra ? extra : undefined, action = extra && 'action' in extra ? extra.action : undefined
      setList(l => [...l.slice(1 - MAX), { id, text, link, action, error }])
      if (!error) arm(id)
    }
    const error = (text: string) => {
      const now = Date.now(), seen = recent.current
      for (const [k, t] of seen) if (now - t > DEDUPE_MS) seen.delete(k)
      if (seen.has(text)) return
      seen.set(text, now); add(text, undefined, true)
    }
    return Object.assign((text: string, link?: Link | { action: Action }) => add(text, link), { error })
  }, [arm])
  useEffect(() => {
    const ev = (e: Event) => push.error(String((e as CustomEvent).detail || generic()))  // api.ts: unhandled 5xx
    const rej = (e: PromiseRejectionEvent) => {
      const r = e.reason
      if (r?.name === 'AbortError' || r?.toasted) return
      push.error(typeof r?.status === 'number' && r.message ? String(r.message) : generic())
    }
    const err = (e: ErrorEvent) => { if (!/ResizeObserver loop|^Script error/.test(e.message ?? '') && !/AbortError/.test(String(e.error?.name))) push.error(generic()) }
    addEventListener('laris:error', ev); addEventListener('unhandledrejection', rej); addEventListener('error', err)
    return () => { removeEventListener('laris:error', ev); removeEventListener('unhandledrejection', rej); removeEventListener('error', err) }
  }, [push])
  const row = (x: (typeof list)[number]) => (
    <div key={x.id} className="toast pointer-events-auto" onMouseEnter={() => hold(x.id)} onMouseLeave={() => !x.error && arm(x.id)} onFocus={() => hold(x.id)} onBlur={() => !x.error && arm(x.id)}>
      <Icon name={x.error ? 'warn' : 'check'} className={`mt-0.5 size-4 shrink-0 ${x.error ? 'text-warn' : 'text-accent'}`} />
      <span className="min-w-0 flex-1 break-words">{x.text}{x.link && <> <a className="link" href={x.link.href}>{x.link.label}</a></>}{x.action && <> <button type="button" className="link font-semibold" onClick={() => { x.action!.onClick(); dismiss(x.id) }}>{x.action.label}</button></>}</span>
      <button type="button" className="toast-x" aria-label={`${t({ en: 'Dismiss', ms: 'Tutup', zh: '关闭', ta: 'மூடு' })}: ${x.text}`} onClick={() => dismiss(x.id)}><Icon name="close" className="size-4" /></button>
    </div>
  )
  return (
    <Ctx value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] mx-auto grid max-w-[360px] justify-items-center gap-2 md:inset-x-auto md:bottom-4 md:left-64 md:mx-0 md:w-[360px] md:justify-items-start">
        <div role="alert" aria-live="assertive" className="grid w-full justify-items-end gap-2 empty:hidden">{list.filter(t => t.error).map(row)}</div>
        <div role="status" aria-live="polite" className="grid w-full justify-items-end gap-2 empty:hidden">{list.filter(t => !t.error).map(row)}</div>
      </div>
    </Ctx>
  )
}

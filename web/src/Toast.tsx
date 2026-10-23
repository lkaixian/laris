import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './icons'

// Light toast system.
//   const toast = useToast(); toast('Settings saved.')          confirmation: polite, gone after 5 s
//   toast.error('That did not work. Reference: abc')             unexpected error: assertive (role=alert), stays until dismissed
// Max 3 at once (oldest dropped), each has a Dismiss button. Form errors stay inline next to the thing that failed; the error variant is for
// failures nobody is looking at: 5xx from api.ts and uncaught errors / rejections (window listeners below), de-duplicated by text for 10 s.
type Link = { href: string; label: string }
type Toaster = ((text: string, link?: Link) => void) & { error: (text: string) => void }
const Ctx = createContext<Toaster>(Object.assign(() => undefined, { error: () => undefined }))
export const useToast = () => useContext(Ctx)

const MAX = 3
const LIFE_MS = 5000
const DEDUPE_MS = 10_000
const GENERIC = 'Something went wrong. Reload the page if it keeps happening.'

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<{ id: number; text: string; link?: Link; error?: boolean }[]>([])
  const n = useRef(0)
  const recent = useRef(new Map<string, number>())
  const dismiss = useCallback((id: number) => setList(l => l.filter(t => t.id !== id)), [])
  const push = useMemo<Toaster>(() => {
    const add = (text: string, link?: Link, error?: boolean) => {
      const id = ++n.current
      setList(l => [...l.slice(1 - MAX), { id, text, link, error }])
      if (!error) setTimeout(() => dismiss(id), LIFE_MS)
    }
    const error = (text: string) => {
      const now = Date.now(), seen = recent.current
      for (const [k, t] of seen) if (now - t > DEDUPE_MS) seen.delete(k)
      if (seen.has(text)) return
      seen.set(text, now); add(text, undefined, true)
    }
    return Object.assign((text: string, link?: Link) => add(text, link), { error })
  }, [dismiss])
  useEffect(() => {
    const ev = (e: Event) => push.error(String((e as CustomEvent).detail || GENERIC))  // api.ts: unhandled 5xx
    const rej = (e: PromiseRejectionEvent) => {
      const r = e.reason
      if (r?.name === 'AbortError' || r?.toasted) return
      push.error(typeof r?.status === 'number' && r.message ? String(r.message) : GENERIC)
    }
    const err = (e: ErrorEvent) => { if (!/ResizeObserver loop|^Script error/.test(e.message ?? '') && !/AbortError/.test(String(e.error?.name))) push.error(GENERIC) }
    addEventListener('laris:error', ev); addEventListener('unhandledrejection', rej); addEventListener('error', err)
    return () => { removeEventListener('laris:error', ev); removeEventListener('unhandledrejection', rej); removeEventListener('error', err) }
  }, [push])
  const row = (t: (typeof list)[number]) => (
    <div key={t.id} className={`toast pointer-events-auto ${t.error ? 'toast-err' : ''}`}>
      <span className="min-w-0 flex-1 break-words">{t.text}{t.link && <> <a className="link" href={t.link.href}>{t.link.label}</a></>}</span>
      <button type="button" className="toast-x" aria-label={`Dismiss: ${t.text}`} onClick={() => dismiss(t.id)}><Icon name="close" className="size-4" /></button>
    </div>
  )
  return (
    <Ctx value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] grid justify-items-end gap-2 sm:left-auto sm:right-4 sm:bottom-4 sm:w-96">
        <div role="alert" aria-live="assertive" className="grid w-full justify-items-end gap-2 empty:hidden">{list.filter(t => t.error).map(row)}</div>
        <div role="status" aria-live="polite" className="grid w-full justify-items-end gap-2 empty:hidden">{list.filter(t => !t.error).map(row)}</div>
      </div>
    </Ctx>
  )
}

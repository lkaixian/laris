import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError } from './api'
import type { Me } from './api'

// ---------- helpers ----------
export const rm = (s: string | null) => (s === null ? 'Not set' : 'RM ' + Number(s).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
export const label = (s: string) => s.replace(/_/g, ' ')
export const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')
export const REVIEWABLE = ['received', 'parsed'] // 'in' statuses where the API still allows line edits (src/api/routes.py)
// Stable focus target after an action or a route change: the page h1, else the main landmark.
export const focusTop = () => (document.querySelector<HTMLElement>('main h1') ?? document.getElementById('main'))?.focus()

export function useFetch<T>(path: string) {
  const [s, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true })
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    set(p => ({ ...p, loading: true, error: undefined }))
    api<T>('GET', path).then(data => live && set({ data, loading: false }), e => live && set({ loading: false, error: msg(e) }))
    return () => { live = false }
  }, [path, n])
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

export function Async({ s, empty, emptyText, children }: { s: { loading: boolean; error?: string; data?: unknown; reload: () => void }; empty?: boolean; emptyText?: string; children: ReactNode }) {
  if (s.error) return (
    <div role="alert" className="card border-warn bg-warn-bg text-warn">
      <p>{s.error}</p>
      <button className="btn mt-3" onClick={s.reload}>Retry loading</button>
    </div>
  )
  if (s.loading && !s.data) return <p role="status" className="text-muted">Loading...</p>
  if (empty) return <p className="card text-muted">{emptyText}</p>
  return <>{children}</>
}

export function ThemeToggle({ dark, setDark }: { dark: boolean; setDark: (d: boolean) => void }) {
  const flip = () => {
    const t = dark ? 'light' : 'dark'
    document.documentElement.dataset.theme = t
    try { localStorage.setItem('theme', t) } catch { /* storage blocked: choice lasts for this visit only */ }
    setDark(!dark)
  }
  return <button className="btn" aria-pressed={dark} onClick={flip}>Dark theme</button>
}

// LARIS logo: laris-logo.png (light) or laris-logo-dark.png (dark); falls back to the text wordmark when no file is there.
export function Brand({ dark }: { dark: boolean }) {
  const [failed, setFailed] = useState(false)
  return !failed
    ? <img src={`/brand/laris-logo${dark ? '-dark' : ''}.png`} alt="LARIS" width={131} height={28} className="h-7 w-auto" onError={() => setFailed(true)} />
    : <strong className="text-xl font-semibold tracking-[0.2em]">LARIS</strong>
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

export function Status({ v }: { v: string }) { return <span className="badge">{label(v)}</span> }

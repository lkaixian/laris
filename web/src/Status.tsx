import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { Async, PageHeader, useFetch } from './ui'
import { Icon } from './icons'

export type Level = 'ok' | 'info' | 'warn' | 'critical'
export interface HealthItem { level: Exclude<Level, 'ok'>; code: string; message: string; fix: string }
export interface Health { level: Level; items: HealthItem[] }

const ORDER: HealthItem['level'][] = ['critical', 'warn', 'info']
const NAME = { ok: 'OK', info: 'Info', warn: 'Warning', critical: 'Critical' } as const
const GROUP = { critical: 'Critical', warn: 'Warnings', info: 'For your information' } as const
const sorted = (items: HealthItem[]) => [...items].sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level))

function LevelBadge({ level }: { level: Level }) {
  const bad = level === 'warn' || level === 'critical'
  return <span className={`badge ${bad ? 'badge-warn' : ''}`}>{bad && <Icon name="warn" className="size-4" />}{NAME[level]}</span>
}

// #/status (owner only): what is not set up or not working, worst first, each with how to fix it.
export function StatusView() {
  const s = useFetch<Health>('/system/health')
  const h = s.data
  const items = h?.items ?? []
  return (
    <>
      <PageHeader title="System status" description="Checks that LARIS is set up and working, and what to do about anything that is not." />
      <Async s={s} empty={!!h && !items.length} emptyText="Everything is set up" emptyHint="Nothing needs your attention right now." rows={3}>
        {h && <>
          <p role="status" className="mb-4 flex flex-wrap items-center gap-2 text-lg font-semibold">Overall: <LevelBadge level={h.level} /> <span className="text-sm font-normal text-muted">{items.length} {items.length === 1 ? 'item' : 'items'}</span></p>
          {ORDER.map(l => {
            const g = items.filter(i => i.level === l)
            return g.length > 0 && (
              <section key={l} aria-labelledby={`st-${l}`} className="mb-6">
                <h2 id={`st-${l}`} className="mb-2 text-lg font-semibold">{GROUP[l]} <span className="text-sm font-normal text-muted">({g.length})</span></h2>
                <ul className="grid gap-2">
                  {g.map(i => (
                    <li key={i.code} className={`card ${l === 'info' ? '' : 'border-l-4 border-l-amber'}`}>
                      <p className="flex flex-wrap items-center gap-2"><LevelBadge level={l} /><span className="font-semibold">{i.message}</span></p>
                      <p className="mt-2 text-sm"><strong>How to fix: </strong>{i.fix}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </>}
      </Async>
    </>
  )
}

const KEY = 'laris.health.dismissed'
const read = () => { try { return sessionStorage.getItem(KEY) } catch { return null } }
const FIVE_MIN = 5 * 60_000

// Owner-only strip above the page when something is wrong. A non-owner never calls the endpoint. A failed read shows nothing.
export function HealthBanner({ owner, hash }: { owner: boolean; hash: string }) {
  const [h, setH] = useState<Health>()
  const [gone, setGone] = useState(read)
  const last = useRef(0)
  useEffect(() => {
    if (!owner) { setH(undefined); last.current = 0; return }
    if (Date.now() - last.current < FIVE_MIN) return
    last.current = Date.now()
    let live = true
    api<Health>('GET', '/system/health', undefined, { quiet: true }).then(r => live && setH(r), () => { if (live) setH(undefined) })
    return () => { live = false }
  }, [owner, hash])
  if (!owner || !h || (h.level !== 'warn' && h.level !== 'critical') || !h.items.length) return null
  const items = sorted(h.items)
  const sig = h.level + ':' + items.map(i => i.code).sort().join(',')
  if (gone === sig) return null
  const rest = items.length - 1
  return (
    <div role="region" aria-label="System status notice" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-warn-bg px-4 py-2 text-center text-sm text-warn">
      <span className="inline-flex items-center gap-2"><Icon name="warn" className="size-4 shrink-0" /><span><strong>{NAME[h.level]}: </strong>{items[0].message}{rest > 0 && ` (and ${rest} more ${rest === 1 ? 'item' : 'items'})`}</span></span>
      <span className="flex items-center gap-3 font-semibold">
        <a className="inline-flex min-h-11 items-center underline underline-offset-2" href="#/status">See all</a>
        <button type="button" className="inline-flex min-h-11 items-center underline underline-offset-2" onClick={() => { try { sessionStorage.setItem(KEY, sig) } catch { /* storage blocked */ } setGone(sig) }}>Dismiss<span className="sr-only"> this notice</span></button>
      </span>
    </div>
  )
}

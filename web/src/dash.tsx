import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from './icons'
import type { IconName } from './icons'

// Dashboard building blocks (Home). Styling lives in theme.css (.bento, .tile, .pipe, .gauge); motion is CSS only and
// switched off by the global prefers-reduced-motion rule, so every block renders its final state without animation.

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// Counts up from the previous value to `value` with an ease-out. Screen readers get the final value only.
export function CountUp({ value, format = n => Math.round(n).toLocaleString('en-MY') }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(reduced() ? value : 0)
  const from = useRef(shown)
  useEffect(() => {
    if (reduced()) { setShown(value); return }
    const start = from.current, t0 = performance.now(), dur = 900
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur), v = start + (value - start) * (1 - (1 - p) ** 3)
      from.current = v; setShown(v)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <span className="tabular-nums"><span aria-hidden="true">{format(shown)}</span><span className="sr-only">{format(value)}</span></span>
}

// One bento cell. A link when `href` is set (the whole tile is the target), else a plain section.
// `order` staggers the entry animation; `hero` is the solid-accent tile (one per page).
export function Tile({ href, label, order = 0, hero, className = '', children }: {
  href?: string; label?: string; order?: number; hero?: boolean; className?: string; children: ReactNode
}) {
  const cls = `tile ${hero ? 'tile-hero' : ''} ${href ? 'tile-link' : ''} ${className}`
  const style = { '--d': `${order * 50}ms` } as CSSProperties
  return href
    ? <a href={href} className={cls} style={style}>{children}</a>
    : <section aria-label={label} className={cls} style={style}>{children}</section>
}

export function TileHead({ title, id, link }: { title: string; id?: string; link?: { href: string; label: string } }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={id} className="text-md font-semibold tracking-tight">{title}</h2>
      {link && <a className="tile-more" href={link.href}>{link.label}<Icon name="right" className="size-3.5" /></a>}
    </div>
  )
}

export function TileIcon({ name, warn }: { name: IconName; warn?: boolean }) {
  return <span aria-hidden="true" className={`tile-icon ${warn ? 'tile-icon-warn' : ''}`}><Icon name={name} className="size-[18px]" /></span>
}

// Label, big number, optional hint and pill. `value` may be a preformatted string (no count-up then).
export function Metric({ label, value, format, hint, pill, size = 'md' }: {
  label: string; value: number | string; format?: (n: number) => string; hint?: ReactNode
  pill?: { text: string; warn?: boolean }; size?: 'md' | 'lg' | 'xl'
}) {
  return (
    <>
      <span className="metric-label">{label}</span>
      <span className={`metric metric-${size}`}>{typeof value === 'number' ? <CountUp value={value} format={format} /> : value}</span>
      {hint && <span className="metric-hint">{hint}</span>}
      {pill && <span className={`pill ${pill.warn ? 'pill-warn' : ''}`}>{pill.text}</span>}
    </>
  )
}

// Circular gauge, 0..1. Children sit in the middle.
export function Ring({ fraction, size = 112, children }: { fraction: number; size?: number; children?: ReactNode }) {
  const r = (size - 12) / 2, c = 2 * Math.PI * r
  const [off, setOff] = useState(c)
  useEffect(() => { const id = requestAnimationFrame(() => setOff(c * (1 - Math.max(0, Math.min(1, fraction))))); return () => cancelAnimationFrame(id) }, [c, fraction])
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg aria-hidden="true" className="gauge absolute inset-0" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="gauge-track" cx={size / 2} cy={size / 2} r={r} />
        <circle className="gauge-val" cx={size / 2} cy={size / 2} r={r} strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <span className="relative text-center">{children}</span>
    </span>
  )
}

// Stacked share bar with a legend. Tone 1..3 runs light to dark accent; the legend carries the numbers, so colour is never the only signal.
export interface Segment { label: string; value: number; tone: 1 | 2 | 3; href?: string }
export function Pipeline({ label, segments }: { label: string; segments: Segment[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0)
  const [ready, setReady] = useState(false)
  useEffect(() => { const id = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(id) }, [])
  return (
    <div>
      <div className="pipe" role="img" aria-label={`${label}: ${segments.map(s => `${s.value} ${s.label.toLowerCase()}`).join(', ')}`}>
        {total > 0 && segments.map(s => s.value > 0 && <span key={s.label} className={`pipe-${s.tone}`} style={{ width: ready ? `${(s.value / total) * 100}%` : 0 }} />)}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {segments.map(s => {
          const body = <><i aria-hidden="true" className={`pipe-key pipe-${s.tone}`} />{s.label} <b className="tabular-nums text-ink"><CountUp value={s.value} /></b></>
          return <li key={s.label}>{s.href ? <a className="inline-flex min-h-8 items-center gap-1.5 hover:text-ink" href={s.href}>{body}</a> : <span className="inline-flex min-h-8 items-center gap-1.5">{body}</span>}</li>
        })}
      </ul>
    </div>
  )
}

// Label/number rows inside a tile; each row links to the list it counts.
export function StatRows({ rows }: { rows: { label: string; value: number; href: string; warn?: boolean }[] }) {
  return (
    <ul className="-mx-2">
      {rows.map(r => (
        <li key={r.label}><a className="stat-row" href={r.href}>
          <span>{r.label}</span>
          <b className={`text-lg tabular-nums ${r.warn ? 'text-warn' : ''}`}><CountUp value={r.value} /></b>
        </a></li>
      ))}
    </ul>
  )
}

import type { CSSProperties, ReactNode } from 'react'
import { can, canOpen } from './api'
import { useFetch } from './ui'
import { CountUp } from './dash'
import { Icon } from './icons'
import type { IconName } from './icons'
import { tx } from './strings'

// Home: the four areas of the sidebar (Work, Suppliers, Insight, Audit Log) as a glass bento, each with a small "smart art"
// picture of how that area works, so a new user sees the whole system at a glance. Every shape is a link to the list it counts.
// Numbers come from /dashboard (already loaded by Home) and, for the Audit Log tile, /audit/days.
export interface AreaData {
  needs_review: number; open_quotes: number; jobs: { todo: number; doing: number; done: number }
  contacts: { suppliers: number }
  stale_quotes?: number; stale_margin_lost?: string; followups_pending?: number
  jobs_overdue?: number | null; jobs_due_today?: number | null
  track?: { overdue?: number | null; waiting_supplier?: number | null; waiting_approval?: number | null } | null
}
const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function AreaHead({ icon, title, href, lead }: { icon: IconName; title: string; href: string; lead: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span aria-hidden="true" className="glass-icon"><Icon name={icon} className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold tracking-tight"><a href={href} className="hover:underline">{title}</a></h2>
        <p className="text-sm text-muted">{lead}</p>
      </div>
      <a href={href} className="tile-more shrink-0">Open<Icon name="right" className="size-3.5" /><span className="sr-only"> {title}</span></a>
    </div>
  )
}

// Process (chevron) smart art: one arrow per stage, left to right; stacked top to bottom on a phone.
function Chevrons({ label, steps }: { label: string; steps: { label: string; value: number; href: string; warn?: boolean }[] }) {
  return (
    <ol className="chevrons" aria-label={label}>
      {steps.map((s, i) => (
        <li key={s.label} style={{ '--i': i } as CSSProperties}>
          <a href={s.href} className={`chev ${s.warn && s.value > 0 ? 'chev-warn' : ''}`}>
            <b className="text-xl tabular-nums leading-none"><CountUp value={s.value} /></b>
            <span className="text-xs font-semibold">{s.label}</span>
          </a>
        </li>
      ))}
    </ol>
  )
}

// Cycle smart art: four steps round a loop, the loop arrow drawn behind them.
function Cycle({ label, centre, steps }: { label: string; centre: ReactNode; steps: { label: string; value?: number; href: string }[] }) {
  return (
    <div className="cycle" role="group" aria-label={label}>
      <svg aria-hidden="true" viewBox="0 0 200 200" className="cycle-ring">
        <defs><marker id="cy-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor" /></marker></defs>
        {[0, 1, 2, 3].map(k => {
          const a0 = (-90 + k * 90 + 22) * Math.PI / 180, a1 = (-90 + k * 90 + 68) * Math.PI / 180
          return <path key={k} d={`M ${100 + 72 * Math.cos(a0)} ${100 + 72 * Math.sin(a0)} A 72 72 0 0 1 ${100 + 72 * Math.cos(a1)} ${100 + 72 * Math.sin(a1)}`} fill="none" stroke="currentColor" strokeWidth="3" markerEnd="url(#cy-arrow)" />
        })}
      </svg>
      <div className="cycle-centre">{centre}</div>
      <ol>
        {steps.map((s, i) => (
          <li key={s.label} className={`cycle-node cycle-${i}`}>
            <a href={s.href}><span className="cycle-num" aria-hidden="true">{i + 1}</span>{s.label}{s.value !== undefined && <b className="ml-1 tabular-nums">{s.value}</b>}</a>
          </li>
        ))}
      </ol>
    </div>
  )
}

// Bar smart art: one bar per measure, its length against the biggest.
function Bars({ label, rows }: { label: string; rows: { label: string; value: number; text?: string; href: string; warn?: boolean }[] }) {
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <ul className="grid gap-3" aria-label={label}>
      {rows.map(r => (
        <li key={r.label}><a href={r.href} className="block rounded-ui p-1 hover:bg-tint/60">
          <span className="flex items-baseline justify-between gap-2 text-sm"><span className="font-semibold">{r.label}</span><b className="tabular-nums">{r.text ?? r.value}</b></span>
          <span className="glass-bar mt-1" aria-hidden="true"><span className={r.warn && r.value > 0 ? 'glass-bar-warn' : ''} style={{ width: `${Math.max(4, (r.value / max) * 100)}%` }} /></span>
        </a></li>
      ))}
    </ul>
  )
}

// Timeline smart art: the last seven days with entries, one column each, height by count.
function Timeline() {
  const s = useFetch<{ day: string; entries: number }[]>('/audit/days?limit=7')
  if (s.error) return <p className="text-sm text-muted">The audit log could not be loaded. <a className="link" href="#/activity">Open it</a>.</p>
  if (!s.data) return <div className="h-28 animate-pulse rounded-ui bg-hairline/50" aria-hidden="true" />
  if (!s.data.length) return <p className="text-sm text-muted">No entries yet. Changes appear here as they happen.</p>
  const days = [...s.data].reverse()
  const max = Math.max(1, ...days.map(d => d.entries))
  const total = days.reduce((a, d) => a + d.entries, 0)
  return (
    <div>
      <ol className="timeline" aria-label={`${total} entries over the last ${days.length} active days`}>
        {days.map(d => {
          const label = new Date(`${d.day}T12:00:00+08:00`).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', timeZone: 'Asia/Kuala_Lumpur' })
          return (
            <li key={d.day}><a href={`#/activity?day=${d.day}`} title={`${label}: ${d.entries} entries`}>
              <span className="timeline-bar" style={{ height: `${Math.max(10, (d.entries / max) * 100)}%` }}><b className="text-xs tabular-nums">{d.entries}</b></span>
              <span className="timeline-dot" aria-hidden="true" />
              <span className="text-xs text-muted">{label}</span>
              <span className="sr-only">{d.entries} entries</span>
            </a></li>
          )
        })}
      </ol>
    </div>
  )
}

export function AreaBento({ d, owner }: { d: AreaData; owner: boolean }) {
  const t = d.track ?? {}
  const margin = Math.abs(Number(d.stale_margin_lost) || 0)
  const audit = can('view_audit')
  return (
    <div className="glass-stage mb-6" data-guide="home-tiles">
      <div className="bento">
        <section aria-label={tx('nav.group.Work')} className="glass lg:col-span-7" data-guide="home-work">
          <AreaHead icon="pipeline" title={tx('nav.group.Work')} href="#/track" lead="From a customer's enquiry to a finished job. Each arrow is a stage; the number is how many are in it." />
          <Chevrons label="Work stages" steps={[
            { label: 'To review', value: n(d.needs_review), href: '#/tracker/review', warn: true },
            { label: 'Quotes open', value: n(d.open_quotes), href: '#/tracker/open' },
            { label: 'Follow-ups', value: n(d.followups_pending), href: '#/followups', warn: true },
            { label: 'Jobs to do', value: n(d.jobs.todo), href: '#/jobs' },
            { label: 'In progress', value: n(d.jobs.doing), href: '#/jobs' },
            { label: 'Done', value: n(d.jobs.done), href: '#/jobs' },
          ]} />
          {(n(d.jobs_overdue) > 0 || n(t.overdue) > 0) && <p className="mt-3 flex flex-wrap gap-2 text-sm">
            {n(d.jobs_overdue) > 0 && <a className="chip heat-stale" href="#/jobs?overdue">{d.jobs_overdue} overdue {d.jobs_overdue === 1 ? 'job' : 'jobs'}</a>}
            {n(t.overdue) > 0 && <a className="chip heat-late" href="#/track?overdue=1">{t.overdue} overdue on Track</a>}
          </p>}
        </section>

        <section aria-label={tx('nav.group.Suppliers')} className="glass lg:col-span-5">
          <AreaHead icon="contacts" title={tx('nav.group.Suppliers')} href="#/contacts" lead="The buying loop: ask, get replies, compare, and keep the best price in your cost book." />
          <Cycle label="Supplier loop" centre={<><b className="block text-2xl tabular-nums leading-none"><CountUp value={n(d.contacts.suppliers)} /></b><span className="text-xs text-muted">suppliers</span></>} steps={[
            { label: 'Ask', href: canOpen('ask', owner) ? '#/ask' : '#/contacts' },
            { label: 'Replies', value: n(t.waiting_supplier), href: '#/track?kind=rfq&stage=waiting' },
            { label: 'Compare', href: '#/ask' },
            { label: 'Cost book', href: '#/catalog' },
          ]} />
        </section>

        <section aria-label={tx('nav.group.Insight')} className={`glass ${audit ? 'lg:col-span-5' : 'lg:col-span-12'}`}>
          <AreaHead icon="alerts" title={tx('nav.group.Insight')} href="#/alerts" lead="What deserves a look today. Longer bars need more attention." />
          <Bars label="Insight" rows={[
            ...(owner ? [{ label: 'Quotes hit by a cost rise', value: n(d.stale_quotes), href: '#/alerts', warn: true }] : []),
            ...(owner && margin ? [{ label: 'Margin at risk (RM)', value: margin, text: margin.toLocaleString('en-MY', { minimumFractionDigits: 2 }), href: '#/alerts', warn: true }] : []),
            { label: 'Quotes waiting for approval', value: n(t.waiting_approval), href: '#/track?kind=quote&stage=draft' },
            { label: 'Jobs due today', value: n(d.jobs_due_today), href: '#/jobs?view=agenda' },
          ]} />
        </section>

        {audit && (
          <section aria-label={tx('nav.group.Audit Log')} className="glass lg:col-span-7">
            <AreaHead icon="activity" title={tx('nav.group.Audit Log')} href="#/activity" lead="Every change, who made it and when. One column per day; select it to see that day." />
            <Timeline />
          </section>
        )}
      </div>
    </div>
  )
}

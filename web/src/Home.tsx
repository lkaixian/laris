import { useState } from 'react'
import { can, canOpen } from './api'
import type { DocSummary, Me, Settings } from './api'
import { canUpload } from './Listings'
import { Async, EmptyState, PageHeader, Status, rm, useFetch } from './ui'
import { MoreMenu } from './kit'
import { CountUp, Metric, Pipeline, Ring, StatRows, Tile, TileHead, TileIcon } from './dash'
import { Icon } from './icons'

interface Dash {
  contacts: { customers: number; suppliers: number; contractors: number }
  needs_review: number; open_quotes: number; jobs: { todo: number; doing: number; done: number }
  recent_contacts: { id: string; name: string; role: string; last_activity: string }[]
  recent_documents: DocSummary[]
  customer_replies: { document_id: string; doc_no: string; customer: string; text: string; at: string; kind: 'accept' | 'decline' | null }[]
  stale_quotes?: number; stale_margin_lost?: string; followups_pending?: number
  jobs_overdue?: number | null; jobs_due_today?: number | null
  quote_speed?: { median_minutes: number | null; quotes: number; days: number }
  track?: { overdue?: number | null; waiting_supplier?: number | null; waiting_approval?: number | null } | null
}
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const DISMISS_KEY = 'laris.getstarted.dismissed'
const wasDismissed = () => { try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false } }

// First-run checklist, worked out from data the page already has (dashboard counts) plus Settings and Team for the owner.
// Hidden when everything is done or when dismissed (remembered on this device).
function GetStarted({ d, owner }: { d: Dash; owner: boolean }) {
  const [hidden, setHidden] = useState(wasDismissed)
  const settings = useFetch<Settings>(owner && !hidden ? '/settings' : null)
  const users = useFetch<unknown[]>(owner && !hidden ? '/users' : null)
  if (hidden || (owner && (settings.loading || users.loading))) return null
  const quoteHref = can('upload_documents') ? '#/tracker/upload' : canOpen('ask', owner) ? '#/ask' : ''
  const steps: { text: string; hint: string; href: string; done: boolean }[] = [
    ...(can('edit_supplier_contacts') ? [{ text: 'Add a supplier', hint: 'Suppliers are who you buy from and ask for prices.', href: '#/contacts/new', done: d.contacts.suppliers > 0 }] : []),
    ...(quoteHref ? [{ text: 'Upload or ask for a quote', hint: 'Upload a supplier quote, or photograph an item and ask suppliers.', href: quoteHref, done: d.recent_documents.length > 0 || d.open_quotes > 0 }] : []),
    ...(owner ? [
      { text: 'Set your organisation details', hint: 'Address and registration numbers are printed on your quotes.', href: '#/settings', done: !!(settings.data?.address || settings.data?.ssm_no || settings.data?.bank_details) },
      { text: 'Invite a team member', hint: 'Give a colleague their own sign-in.', href: '#/team', done: (users.data?.length ?? 0) > 1 },
    ] : []),
  ]
  const n = steps.filter(x => x.done).length
  if (n === steps.length) return null
  return (
    <section aria-labelledby="gs" className="card mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="gs" className="text-md font-semibold">Get started <span className="text-sm font-normal text-muted">{n} of {steps.length} done</span></h2>
        <button type="button" className="btn btn-sm" onClick={() => { try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* storage blocked: hidden for this visit only */ } setHidden(true) }}>Hide this checklist</button>
      </div>
      <ol className="mt-2 grid gap-1">
        {steps.map((x, k) => (
          <li key={x.text} className="flex items-start gap-3 py-1">
            <span aria-hidden="true" className="w-5 shrink-0 pt-0.5 text-sm tabular-nums text-muted">{x.done ? <Icon name="check" className="size-4 text-accent" /> : `${k + 1}.`}</span>
            <span className="min-w-0">
              {x.done ? <span className="text-muted">{x.text}<span className="sr-only"> (done)</span></span>
                : <a className="inline-flex min-h-8 items-center font-semibold hover:underline" href={x.href}>{x.text}</a>}
              {!x.done && <span className="block text-sm text-muted">{x.hint}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

const rowLink = 'font-semibold text-ink group-hover:underline'

const money = (n: number) => rm(String(n))
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// Bento layout: the hero tile sums what needs a person, the rest is grouped by area. Every number links to the list it counts.
export function HomeView({ me, owner }: { me: Me; owner: boolean }) {
  const s = useFetch<Dash>('/dashboard')
  // One primary (rightmost), at most two secondary beside it; anything more goes in the More menu.
  const secondary = [
    ...(canOpen('ask', owner) ? [{ href: '#/ask', icon: 'ask' as const, text: 'Ask suppliers' }] : []),
    ...(canUpload(me) ? [{ href: '#/catalog', icon: 'camera' as const, text: 'Catalog photo' }] : []),
    ...(can('manage_contacts') ? [{ href: '#/contacts/new', icon: 'plus' as const, text: 'New contact' }] : []),
  ]
  const shown = secondary.length > 2 ? secondary.slice(0, 1) : secondary
  const rest = secondary.slice(shown.length)
  const actions = <>
    {shown.map(a => <a key={a.href} href={a.href} className="btn gap-2"><Icon name={a.icon} className="size-4" />{a.text}</a>)}
    {rest.length > 0 && <MoreMenu>{rest.map(a => <a key={a.href} href={a.href} className="sidelink"><Icon name={a.icon} />{a.text}</a>)}</MoreMenu>}
    {can('upload_documents') && <a href="#/tracker/upload" className="btn btn-primary gap-2"><Icon name="upload" className="size-4" />Upload quote</a>}
  </>
  return (
    <>
      <PageHeader title="Home" description={`Hello, ${me.name}. Here is where things stand.`} actions={actions} />
      <Async s={s} empty={false} rows={4} shape="tiles">
        {s.data && <><GetStarted d={s.data} owner={owner} /><Bento d={s.data} owner={owner} /></>}
      </Async>
    </>
  )
}

function Bento({ d, owner }: { d: Dash; owner: boolean }) {
  let order = 0
  const next = () => ++order
  const attention = [
    { label: 'To review', value: d.needs_review, href: '#/tracker/review' },
    ...(owner ? [{ label: 'Hit by a cost rise', value: d.stale_quotes ?? 0, href: '#/alerts' }] : []),
    ...(can('manage_followups') ? [{ label: 'Waiting for a reply', value: d.followups_pending ?? 0, href: '#/followups' }] : []),
  ]
  const waiting = attention.reduce((a, x) => a + x.value, 0)
  const stale = d.stale_quotes ?? 0
  const margin = stale ? Math.abs(Number(d.stale_margin_lost) || 0) : 0
  const speed = owner ? d.quote_speed : undefined
  const track = d.track && [d.track.overdue, d.track.waiting_supplier, d.track.waiting_approval].some(num) ? d.track : null
  return (
    <div className="bento">
      <Tile hero label="Needs a person" order={next()} className="lg:col-span-5">
        <div data-tour="home-stats" className="flex h-full flex-col">
          <h2 className="metric-label">Needs a person</h2>
          <span className="metric metric-xl"><CountUp value={waiting} /></span>
          <span className="metric-hint">{waiting ? `${waiting === 1 ? 'item is' : 'items are'} waiting on you` : 'Nothing is waiting on you.'}</span>
          <ul className="mt-auto grid grid-cols-1 gap-2 pt-6 sm:grid-cols-3">
            {attention.map(x => (
              <li key={x.label}><a className="hero-cell" href={x.href}>
                <span className="metric-label">{x.label}</span>
                <b className="text-xl tabular-nums"><CountUp value={x.value} /></b>
              </a></li>
            ))}
          </ul>
        </div>
      </Tile>

      <div className="col-span-12 grid grid-cols-12 gap-4 lg:col-span-7">
        <Tile href="#/tracker/open" order={next()} className="sm:col-span-6">
          <TileIcon name="tracker" />
          <Metric label="Open quotes" value={d.open_quotes} hint="Sent and not yet answered" />
        </Tile>
        {owner ? (
          <Tile href="#/alerts" order={next()} className="sm:col-span-6">
            <TileIcon name="alerts" warn={margin > 0} />
            <Metric label="Margin at risk" value={margin} format={money}
              pill={{ text: plural(stale, 'quote hit by a cost rise', 'quotes hit by a cost rise'), warn: stale > 0 }} />
          </Tile>
        ) : num(d.jobs_due_today) && (
          <Tile href="#/jobs?view=agenda" order={next()} className="sm:col-span-6">
            <TileIcon name="clock" />
            <Metric label="Jobs due today" value={d.jobs_due_today} />
          </Tile>
        )}
        {speed && (
          <Tile label="Speed to quote" order={next()} className="flex-row! flex-wrap items-center gap-5">
            {num(speed.median_minutes) ? <>
              <Ring fraction={1 - speed.median_minutes / 60}>
                <b className="block text-2xl leading-none tabular-nums"><CountUp value={speed.median_minutes} format={n => n.toFixed(1)} /></b>
                <span className="text-xs text-muted">min</span>
              </Ring>
              <div className="min-w-0 flex-1 basis-48">
                <h2 className="text-md font-semibold tracking-tight">Speed to quote</h2>
                <p className="mt-1 text-sm text-muted">Median time to send a quote, across {plural(speed.quotes, 'quote', 'quotes')} in the last {speed.days} days. The ring is on a one-hour scale: fuller is faster.</p>
              </div>
            </> : <div>
              <h2 className="text-md font-semibold tracking-tight">Speed to quote</h2>
              <p className="mt-1 text-sm text-muted">No quotes sent in the last {speed.days} days yet.</p>
            </div>}
          </Tile>
        )}
      </div>

      {d.customer_replies.length > 0 && (
        <Tile label="Customer replies" order={next()}>
          <TileHead title="Customers who replied to a quote" />
          <p className="-mt-2 mb-2 text-sm text-muted">Only you can accept or decline. Open the quote to record it.</p>
          <ul className="divide-y divide-hairline">
            {d.customer_replies.map((r, i) => (
              <li key={i}><a className="doc-row group" href={`#/doc/${r.document_id}`}>
                <span className="min-w-0">
                  <span className={rowLink}>{r.doc_no}</span> <span className="text-sm text-muted">{r.customer}</span>
                  <span className="block text-sm">"{r.text}"</span>
                </span>
                {r.kind && <span className={`pill mt-0 shrink-0 ${r.kind === 'decline' ? 'pill-warn' : ''}`}>Looks like {r.kind === 'accept' ? 'a yes' : 'a no'}</span>}
              </a></li>
            ))}
          </ul>
        </Tile>
      )}

      <Tile label="Latest documents" order={next()} className="lg:col-span-8">
        <TileHead title="Latest documents" link={{ href: '#/tracker', label: 'Open tracker' }} />
        {d.recent_documents.length === 0 ? <EmptyState title="No documents yet." hint="Quotes you upload or send are listed here." action={can('upload_documents') ? { label: 'Upload a quote', href: '#/tracker/upload' } : undefined} /> : (
          <ul className="divide-y divide-hairline">
            {d.recent_documents.map(x => (
              <li key={x.id}><a className="doc-row group" href={`#/doc/${x.id}`}>
                <span className="min-w-0">
                  <span className={`block truncate ${rowLink}`}>{x.doc_no ?? 'No document number'}</span>
                  <span className="block truncate text-sm text-muted">{x.party.name}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-medium tabular-nums">{x.total ? rm(x.total) : ''}</span>
                  <Status v={x.status} />
                </span>
              </a></li>
            ))}
          </ul>
        )}
      </Tile>

      <Tile label="Jobs" order={next()} className="lg:col-span-4">
        <TileHead title="Jobs" link={{ href: '#/jobs', label: 'Open board' }} />
        <Pipeline label="Jobs" segments={[
          { label: 'To do', value: d.jobs.todo, tone: 1, href: '#/jobs' },
          { label: 'In progress', value: d.jobs.doing, tone: 2, href: '#/jobs' },
          { label: 'Done', value: d.jobs.done, tone: 3, href: '#/jobs' },
        ]} />
        <div className="mt-3">
          <StatRows rows={[
            ...(num(d.jobs_overdue) ? [{ label: 'Overdue jobs', value: d.jobs_overdue, href: '#/jobs?overdue', warn: d.jobs_overdue > 0 }] : []),
            ...(num(d.jobs_due_today) ? [{ label: 'Due today', value: d.jobs_due_today, href: '#/jobs?view=agenda' }] : []),
          ]} />
        </div>
      </Tile>

      {track && (
        <Tile label="On track" order={next()} className="lg:col-span-5">
          <TileHead title="On track" link={{ href: '#/track', label: 'Open Track' }} />
          <StatRows rows={[
            ...(num(track.overdue) ? [{ label: 'Overdue items', value: track.overdue, href: '#/track?overdue=1', warn: track.overdue > 0 }] : []),
            ...(num(track.waiting_supplier) ? [{ label: 'Waiting for a supplier', value: track.waiting_supplier, href: '#/track?kind=rfq&stage=waiting' }] : []),
            ...(num(track.waiting_approval) ? [{ label: 'Quotes waiting for approval', value: track.waiting_approval, href: '#/track?kind=quote&stage=draft' }] : []),
          ]} />
        </Tile>
      )}

      <Tile label="Contact book" order={next()} className={track ? 'lg:col-span-7' : ''}>
        <TileHead title="Contact book" link={{ href: '#/contacts', label: 'Open all contacts' }} />
        <Pipeline label="Contacts" segments={[
          { label: 'Customers', value: d.contacts.customers, tone: 3 },
          { label: 'Suppliers', value: d.contacts.suppliers, tone: 2 },
          { label: 'Contractors', value: d.contacts.contractors, tone: 1 },
        ]} />
        <h3 className="mt-5 mb-1 text-sm font-semibold text-muted">Recently active</h3>
        {d.recent_contacts.length === 0 ? <p className="text-sm text-muted">Contacts show up here once you exchange documents with them.</p> : (
          <ul className="divide-y divide-hairline">
            {d.recent_contacts.map(c => (
              <li key={c.id}><a className="doc-row group" href={`#/contact/${c.id}`}>
                <span className="flex min-w-0 items-center gap-3">
                  <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-tint text-sm font-semibold text-accent">{c.name.trim().charAt(0).toUpperCase()}</span>
                  <span className="min-w-0"><span className={`block truncate ${rowLink}`}>{c.name}</span><span className="block text-sm text-muted">Last document {c.last_activity.slice(0, 10)}</span></span>
                </span>
                <span className="badge shrink-0">{c.role}</span>
              </a></li>
            ))}
          </ul>
        )}
      </Tile>
    </div>
  )
}

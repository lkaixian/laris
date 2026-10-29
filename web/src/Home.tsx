import { useState } from 'react'
import { can, canOpen } from './api'
import type { DocSummary, Me, Settings } from './api'
import { canUpload } from './Listings'
import { Async, EmptyState, PageHeader, Status, rm, useFetch } from './ui'
import { MoreMenu, StatStrip, StatTile } from './kit'
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

export function HomeView({ me, owner }: { me: Me; owner: boolean }) {
  const s = useFetch<Dash>('/dashboard')
  const d = s.data
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
  const tk = d?.track
  return (
    <>
      <PageHeader title="Home" description={`Hello, ${me.name}. Here is where things stand.`} actions={actions} />
      <Async s={s} empty={false} rows={4} shape="tiles">
        {d && <>
          <GetStarted d={d} owner={owner} />
          <section aria-labelledby="att" data-tour="home-stats">
            <h2 id="att" className="mb-3 text-md font-semibold">Needs attention</h2>
            <StatStrip label="Needs attention">
              <StatTile title="Documents to review" value={d.needs_review} href="#/tracker/review" warn={d.needs_review > 0} />
              {owner && <StatTile title="Quotes hit by a cost rise" value={d.stale_quotes ?? 0} href="#/alerts" warn={(d.stale_quotes ?? 0) > 0}
                hint={d.stale_quotes ? `Margin down ${rm(String(Math.abs(Number(d.stale_margin_lost) || 0)))}` : undefined} />}
              {can('manage_followups') && <StatTile title="Waiting for a reply" value={d.followups_pending ?? 0} href="#/followups" warn={(d.followups_pending ?? 0) > 0} />}
              {tk && num(tk.overdue) && <StatTile title="Overdue items" value={tk.overdue} href="#/track?overdue=1" warn={tk.overdue > 0} />}
            </StatStrip>
          </section>

          <section className="mt-6" aria-labelledby="pl">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="pl" className="text-md font-semibold">Pipeline</h2>
              {tk && <a className="link inline-flex min-h-8 items-center text-sm" href="#/track">Open Track</a>}
            </div>
            <StatStrip label="Pipeline">
              <StatTile title="Open quotes" value={d.open_quotes} href="#/tracker/open" />
              {tk && num(tk.waiting_supplier) && <StatTile title="Waiting for a supplier" value={tk.waiting_supplier} href="#/track?kind=rfq&stage=waiting" />}
              {tk && num(tk.waiting_approval) && <StatTile title="Quotes waiting for approval" value={tk.waiting_approval} href="#/track?kind=quote&stage=draft" />}
              {owner && d.quote_speed && (num(d.quote_speed.median_minutes)
                ? <StatTile title="Median time to send a quote" value={`${d.quote_speed.median_minutes} min`} hint={`from ${d.quote_speed.quotes} ${d.quote_speed.quotes === 1 ? 'quote' : 'quotes'} in ${d.quote_speed.days} days`} />
                : <StatTile title="Median time to send a quote" value="None yet" hint={`No quotes sent in the last ${d.quote_speed.days} days`} />)}
            </StatStrip>
          </section>

          <section className="mt-6" aria-labelledby="jb">
            <h2 id="jb" className="mb-3 text-md font-semibold">Jobs</h2>
            <StatStrip label="Jobs">
              <StatTile title="To do" value={d.jobs.todo} href="#/jobs" />
              <StatTile title="In progress" value={d.jobs.doing} href="#/jobs" />
              <StatTile title="Done" value={d.jobs.done} href="#/jobs" />
              {num(d.jobs_overdue) && <StatTile title="Overdue jobs" value={d.jobs_overdue} href="#/jobs?overdue" warn={d.jobs_overdue > 0} />}
              {num(d.jobs_due_today) && <StatTile title="Jobs due today" value={d.jobs_due_today} href="#/jobs?view=agenda" />}
            </StatStrip>
          </section>

          <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-semibold">Contact book</span>
            <a className="link inline-flex min-h-8 items-center" href="#/contacts">{d.contacts.customers} customers</a>
            <a className="link inline-flex min-h-8 items-center" href="#/contacts">{d.contacts.suppliers} suppliers</a>
            <a className="link inline-flex min-h-8 items-center" href="#/contacts">{d.contacts.contractors} contractors</a>
          </p>

          {d.customer_replies.length > 0 && (
            <section className="mt-6" aria-labelledby="cr">
              <h2 id="cr" className="mb-1 text-md font-semibold">Customers who replied to a quote</h2>
              <p className="mb-3 text-sm text-muted">Only you can accept or decline. Open the quote to record it.</p>
              <ul className="divide-y divide-hairline rounded-card border border-hairline bg-surface">
                {d.customer_replies.map((r, i) => (
                  <li key={i}><a className="row group" href={`#/doc/${r.document_id}`}>
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className={rowLink}>{r.doc_no}</span>
                      <span className="text-sm text-muted">{r.customer}</span></span>
                    <span className="block text-sm">"{r.text}"</span>
                    {r.kind && <span className="badge mt-1">Looks like {r.kind === 'accept' ? 'a yes' : 'a no'}</span>}
                  </a></li>
                ))}
              </ul>
            </section>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="rc">
              <h2 id="rc" className="mb-3 text-md font-semibold">Recently active contacts</h2>
              {d.recent_contacts.length === 0 ? <EmptyState title="No activity yet." hint="Contacts show up here once you exchange documents with them." action={can('manage_contacts') ? { label: 'Add a contact', href: '#/contacts/new' } : undefined} /> : (
                <ul className="divide-y divide-hairline rounded-card border border-hairline bg-surface">
                  {d.recent_contacts.map(c => (
                    <li key={c.id}><a className="row group" href={`#/contact/${c.id}`}>
                      <span className="flex items-baseline justify-between gap-3"><span className={rowLink}>{c.name}</span><span className="badge">{c.role}</span></span>
                      <span className="block text-sm text-muted">Last document {c.last_activity.slice(0, 10)}</span></a></li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="rd">
              <h2 id="rd" className="mb-3 text-md font-semibold">Latest documents</h2>
              {d.recent_documents.length === 0 ? <EmptyState title="No documents yet." hint="Quotes you upload or send are listed here." action={can('upload_documents') ? { label: 'Upload a quote', href: '#/tracker/upload' } : undefined} /> : (
                <ul className="divide-y divide-hairline rounded-card border border-hairline bg-surface">
                  {d.recent_documents.map(x => (
                    <li key={x.id}><a className="row group" href={`#/doc/${x.id}`}>
                      <span className="flex items-baseline justify-between gap-3">
                        <span className={rowLink}>{x.doc_no ?? 'No document number'}</span>
                        <span className="num text-sm">{x.total ? rm(x.total) : ''}</span></span>
                      <span className="mt-0.5 flex items-center justify-between gap-3"><span className="min-w-0 truncate text-sm">{x.party.name}</span><Status v={x.status} /></span></a></li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>}
      </Async>
    </>
  )
}

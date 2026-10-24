import { useState } from 'react'
import type { ReactNode } from 'react'
import { can, canOpen } from './api'
import type { DocSummary, Me, Settings } from './api'
import { canUpload } from './Listings'
import { Async, EmptyState, PageHeader, Status, rm, useFetch } from './ui'
import { Icon } from './icons'
import type { IconName } from './icons'

interface Dash {
  contacts: { customers: number; suppliers: number; contractors: number }
  needs_review: number; open_quotes: number; jobs: { todo: number; doing: number; done: number }
  recent_contacts: { id: string; name: string; role: string; last_activity: string }[]
  recent_documents: DocSummary[]
  customer_replies: { document_id: string; doc_no: string; customer: string; text: string; at: string; kind: 'accept' | 'decline' | null }[]
  stale_quotes?: number; stale_margin_lost?: string; followups_pending?: number
}

// Every counter is a link to the list it counts.
function Stat({ title, value, href, hint, warn }: { title: string; value: number | string; href: string; hint?: string; warn?: boolean }) {
  return (
    <a href={href} className={`card group block hover:bg-tint ${warn ? 'border-l-4 border-l-amber' : ''}`}>
      <span className="flex items-start justify-between gap-2 text-sm text-muted"><span>{title}</span><Icon name="right" className="size-4 opacity-60 transition-transform group-hover:translate-x-0.5" /></span>
      <span className="block text-3xl font-semibold tabular-nums">{value}</span>
      {hint && <span className="block text-sm">{hint}</span>}
    </a>
  )
}

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
    <section aria-labelledby="gs" className="card mb-6 border-l-4 border-l-accent">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="gs" className="text-lg font-semibold">Get started <span className="text-sm font-normal text-muted">{n} of {steps.length} done</span></h2>
        <button type="button" className="btn" onClick={() => { try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* storage blocked: hidden for this visit only */ } setHidden(true) }}>Hide this checklist</button>
      </div>
      <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-soft"><div className="h-full bg-accent" style={{ width: `${(n / steps.length) * 100}%` }} /></div>
      <ol className="mt-2 grid gap-1">
        {steps.map(x => (
          <li key={x.text} className="flex items-start gap-3 py-1">
            <span aria-hidden="true" className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border ${x.done ? 'border-accent bg-accent text-on-accent' : 'border-line'}`}>{x.done && <Icon name="check" className="size-4" />}</span>
            <span className="min-w-0">
              {x.done ? <span className="text-muted line-through">{x.text}<span className="sr-only"> (done)</span></span>
                : <a className="link inline-flex min-h-8 items-center font-semibold" href={x.href}>{x.text}</a>}
              {!x.done && <span className="block text-sm text-muted">{x.hint}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Quick({ href, icon, children, primary }: { href: string; icon: IconName; children: ReactNode; primary?: boolean }) {
  return <a href={href} className={`btn gap-2 ${primary ? 'btn-primary' : ''}`}><Icon name={icon} className="size-4" />{children}</a>
}

export function HomeView({ me, owner }: { me: Me; owner: boolean }) {
  const s = useFetch<Dash>('/dashboard')
  const d = s.data
  return (
    <>
      <PageHeader title="Home" description={`Hello, ${me.name}. Here is where things stand.`} />
      <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Quick actions">
        {can('upload_documents') && <Quick href="#/tracker/upload" icon="upload" primary>Upload quote</Quick>}
        {canOpen('ask', owner) && <Quick href="#/ask" icon="ask">Ask suppliers</Quick>}
        {canUpload(me) && <Quick href="#/catalog" icon="camera">Catalog photo</Quick>}
        {can('manage_contacts') && <Quick href="#/contacts/new" icon="plus">New contact</Quick>}
      </div>
      <Async s={s} empty={false} rows={4} shape="cards">
        {d && <>
          <GetStarted d={d} owner={owner} />
          <section aria-labelledby="att">
            <h2 id="att" className="mb-2 text-lg font-semibold">Needs a person</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat title="Documents to review" value={d.needs_review} href="#/tracker/review" warn={d.needs_review > 0} />
              <Stat title="Open quotes" value={d.open_quotes} href="#/tracker/open" />
              {owner && <Stat title="Quotes hit by a cost rise" value={d.stale_quotes ?? 0} href="#/alerts" warn={(d.stale_quotes ?? 0) > 0}
                hint={d.stale_quotes ? `Margin down ${rm(String(Math.abs(Number(d.stale_margin_lost) || 0)))}` : undefined} />}
              {can('manage_followups') && <Stat title="Waiting for a reply" value={d.followups_pending ?? 0} href="#/followups" warn={(d.followups_pending ?? 0) > 0} />}
            </div>
          </section>

          {d.customer_replies.length > 0 && (
            <section className="mt-8" aria-labelledby="cr">
              <h2 id="cr" className="mb-1 text-lg font-semibold">Customers who replied to a quote</h2>
              <p className="mb-2 text-sm text-muted">Only you can accept or decline. Open the quote to record it.</p>
              <ul className="divide-y divide-soft rounded-ui border border-soft bg-surface">
                {d.customer_replies.map((r, i) => (
                  <li key={i}><a className="row" href={`#/doc/${r.document_id}`}>
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-semibold text-accent underline underline-offset-2">{r.doc_no}</span>
                      <span className="text-sm text-muted">{r.customer}</span></span>
                    <span className="block text-sm">"{r.text}"</span>
                    {r.kind && <span className="badge mt-1">Looks like {r.kind === 'accept' ? 'a yes' : 'a no'}</span>}
                  </a></li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-8" aria-labelledby="jb">
            <h2 id="jb" className="mb-2 text-lg font-semibold">Jobs</h2>
            <div className="grid grid-cols-3 gap-3">
              <Stat title="To do" value={d.jobs.todo} href="#/jobs" />
              <Stat title="In progress" value={d.jobs.doing} href="#/jobs" />
              <Stat title="Done" value={d.jobs.done} href="#/jobs" />
            </div>
          </section>

          <section className="mt-8" aria-labelledby="cb">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="cb" className="text-lg font-semibold">Contact book</h2>
              <a className="link inline-flex min-h-11 items-center" href="#/contacts">Open all contacts</a>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat title="Customers" value={d.contacts.customers} href="#/contacts" />
              <Stat title="Suppliers" value={d.contacts.suppliers} href="#/contacts" />
              <Stat title="Contractors" value={d.contacts.contractors} href="#/contacts" />
            </div>
          </section>

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="rc">
              <h2 id="rc" className="mb-2 text-lg font-semibold">Recently active contacts</h2>
              {d.recent_contacts.length === 0 ? <EmptyState title="No activity yet." hint="Contacts show up here once you exchange documents with them." action={can('manage_contacts') ? { label: 'Add a contact', href: '#/contacts/new' } : undefined} /> : (
                <ul className="divide-y divide-soft rounded-ui border border-soft bg-surface">
                  {d.recent_contacts.map(c => (
                    <li key={c.id}><a className="row" href={`#/contact/${c.id}`}>
                      <span className="font-semibold text-accent underline underline-offset-2">{c.name}</span>{' '}<span className="badge">{c.role}</span>
                      <span className="block text-sm text-muted">Last document {c.last_activity.slice(0, 10)}</span></a></li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="rd">
              <h2 id="rd" className="mb-2 text-lg font-semibold">Latest documents</h2>
              {d.recent_documents.length === 0 ? <EmptyState title="No documents yet." hint="Quotes you upload or send are listed here." action={can('upload_documents') ? { label: 'Upload a quote', href: '#/tracker/upload' } : undefined} /> : (
                <ul className="divide-y divide-soft rounded-ui border border-soft bg-surface">
                  {d.recent_documents.map(x => (
                    <li key={x.id}><a className="row" href={`#/doc/${x.id}`}>
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="font-semibold text-accent underline underline-offset-2">{x.doc_no ?? 'No document number'}</span>
                        <span className="text-sm tabular-nums">{x.total ? rm(x.total) : ''}</span></span>
                      <span className="block text-sm">{x.party.name}</span>
                      <span className="mt-1 block"><Status v={x.status} /></span></a></li>
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

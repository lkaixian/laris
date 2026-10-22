import { useEffect } from 'react'
import type { DocSummary } from './api'
import { Async, Status, rm, useFetch } from './ui'

interface Dash {
  contacts: { customers: number; suppliers: number; contractors: number }
  needs_review: number; open_quotes: number; jobs: { todo: number; doing: number; done: number }
  recent_contacts: { id: string; name: string; role: string; last_activity: string }[]
  recent_documents: DocSummary[]
  customer_replies: { document_id: string; doc_no: string; customer: string; text: string; at: string; kind: 'accept' | 'decline' | null }[]
  stale_quotes?: number; stale_margin_lost?: string; followups_pending?: number
}

function Stat({ title, value, href, hint, warn }: { title: string; value: number | string; href: string; hint?: string; warn?: boolean }) {
  return (
    <a href={href} className={`card block hover:bg-tint ${warn ? 'border-l-4 border-l-amber' : ''}`}>
      <span className="block text-sm text-muted">{title}</span>
      <span className="block text-3xl font-semibold tabular-nums">{value}</span>
      {hint && <span className="block text-sm">{hint}</span>}
    </a>
  )
}

export function HomeView({ owner, name }: { owner: boolean; name: string }) {
  const s = useFetch<Dash>('/dashboard')
  useEffect(() => { document.title = 'Home · LARIS' }, [])
  const d = s.data
  return (
    <>
      <h1 tabIndex={-1} className="text-2xl font-semibold">Home</h1>
      <p className="mb-5 text-muted">Hello, {name}. Here is where things stand.</p>
      <Async s={s} empty={false}>
        {d && <>
          <section aria-labelledby="att">
            <h2 id="att" className="mb-2 text-lg font-semibold">Needs a person</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat title="Documents to review" value={d.needs_review} href="#/tracker" warn={d.needs_review > 0} />
              <Stat title="Open quotes" value={d.open_quotes} href="#/tracker" />
              {owner && <Stat title="Quotes hit by a cost rise" value={d.stale_quotes ?? 0} href="#/alerts" warn={(d.stale_quotes ?? 0) > 0}
                hint={d.stale_quotes ? `Margin down ${rm(String(Math.abs(Number(d.stale_margin_lost))))}` : undefined} />}
              {owner && <Stat title="Waiting for a reply" value={d.followups_pending ?? 0} href="#/alerts" warn={(d.followups_pending ?? 0) > 0} />}
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
              {d.recent_contacts.length === 0 ? <p className="card text-muted">No activity yet.</p> : (
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
              {d.recent_documents.length === 0 ? <p className="card text-muted">No documents yet.</p> : (
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

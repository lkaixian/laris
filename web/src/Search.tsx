import type { DocSummary } from './api'
import { Async, PageHeader, Status, TableRegion, rm, useFetch } from './ui'

interface Hit { id: string; role: string; name: string; contact: string | null; email: string | null; documents: number }
interface Result {
  query: string; contacts: Hit[]; documents: DocSummary[]
  cost_items?: { id: string; item_key: string; uom: string; unit_cost: string; supplier: string; supplier_id: string; effective_date: string }[]
}

export function SearchView({ q }: { q: string }) {
  const s = useFetch<Result>(`/search?q=${encodeURIComponent(q)}`)
  const r = s.data
  const n = r ? r.contacts.length + r.documents.length + (r.cost_items?.length ?? 0) : 0
  return (
    <>
      <PageHeader title={`Search results for "${q}"`} description={<span role="status">{r ? `${n} ${n === 1 ? 'result' : 'results'}` : ''}</span>} />
      <Async s={s} empty={q.trim().length < 2 || (!!r && n === 0)} emptyText={q.trim().length < 2 ? 'Type at least 2 characters.' : 'Nothing matches. Try a document number, a name, or an item.'}>
        {r && <div className="grid gap-6">
          {r.contacts.length > 0 && (
            <section aria-labelledby="sc"><h2 id="sc" className="mb-2 text-lg font-semibold">Contacts</h2>
              <ul className="grid gap-2 md:grid-cols-2">{r.contacts.map(c => (
                <li key={c.id}><a className="card block hover:bg-tint" href={`#/contact/${c.id}`}>
                  <span className="font-semibold text-accent underline underline-offset-2">{c.name}</span> <span className="badge">{c.role}</span>
                  <span className="block text-sm text-muted">{[c.contact, c.email].filter(Boolean).join(' · ') || 'No contact details'}</span>
                </a></li>))}</ul></section>
          )}
          {r.documents.length > 0 && (
            <section aria-labelledby="sd"><h2 id="sd" className="mb-2 text-lg font-semibold">Documents</h2>
              <ul className="divide-y divide-soft rounded-ui border border-soft bg-surface">{r.documents.map(d => (
                <li key={d.id}><a className="row" href={`#/doc/${d.id}`}>
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-semibold text-accent underline underline-offset-2">{d.doc_no ?? 'No document number'}</span>
                    <span className="text-sm tabular-nums">{d.total ? rm(d.total) : ''}</span></span>
                  <span className="block text-sm">{d.party.name}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-sm"><Status v={d.status} /><span className="text-muted">{d.direction === 'in' ? 'Received' : 'Sent'}</span></span>
                </a></li>))}</ul></section>
          )}
          {r.cost_items && r.cost_items.length > 0 && (
            <section aria-labelledby="si"><h2 id="si" className="mb-2 text-lg font-semibold">Current costs</h2>
              <TableRegion label="Current costs table">
                <table className="w-full min-w-max"><caption className="sr-only">Cost items matching {q}</caption>
                  <thead><tr><th scope="col">Item</th><th scope="col">Supplier</th><th scope="col">Unit</th><th scope="col">Unit cost</th><th scope="col">Since</th></tr></thead>
                  <tbody>{r.cost_items.map(c => (
                    <tr key={c.id}><td>{c.item_key}</td><td><a className="link" href={`#/contact/${c.supplier_id}`}>{c.supplier}</a></td>
                      <td>{c.uom}</td><td className="tabular-nums">{rm(c.unit_cost)}</td><td>{c.effective_date}</td></tr>))}</tbody>
                </table></TableRegion></section>
          )}
        </div>}
      </Async>
    </>
  )
}

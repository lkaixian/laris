import { useEffect, useState } from 'react'
import { api, download, MOCK } from './api'
import type { DocSummary } from './api'
import { Async, Status, msg, rm, useFetch } from './ui'

type Kind = 'customer' | 'supplier' | 'contractor'
interface Contact {
  id: string; role: Kind; name: string; contact: string | null; email: string | null; attention: string | null
  ssm_no: string | null; address: string | null; notes: string | null; documents: number; last_activity: string | null; value: string | null
}
interface ContactDetail extends Contact {
  sst_no: string | null; recent_documents: DocSummary[]
  current_costs?: { item_key: string; uom: string; unit_cost: string; effective_date: string }[]
}

const KINDS: [Kind | '', string][] = [['', 'All'], ['customer', 'Customers'], ['supplier', 'Suppliers'], ['contractor', 'Contractors']]
const KIND_ONE: Record<Kind, string> = { customer: 'Customer', supplier: 'Supplier', contractor: 'Contractor' }
const day = (s: string | null) => (s ? s.slice(0, 10) : 'No activity yet')

const empty = { role: 'customer' as Kind, name: '', contact: '', email: '', attention: '', ssm_no: '', sst_no: '', address: '', notes: '' }
type Form = typeof empty
const clean = (f: Partial<Form>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]))

function Fields({ f, set, kind }: { f: Form; set: (f: Form) => void; kind: boolean }) {
  const t = (k: keyof Form, name: string, extra = '') => (
    <label className={`flex flex-col gap-1 text-sm font-semibold ${extra}`}>{name}
      <input className="input font-normal" value={f[k]} onChange={e => set({ ...f, [k]: e.target.value })} /></label>
  )
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {kind && (
        <label className="flex flex-col gap-1 text-sm font-semibold">Type
          <select className="input font-normal" value={f.role} onChange={e => set({ ...f, role: e.target.value as Kind })}>
            {(Object.keys(KIND_ONE) as Kind[]).map(k => <option key={k} value={k}>{KIND_ONE[k]}</option>)}</select></label>
      )}
      {t('name', 'Name')}
      {t('contact', 'WhatsApp or Telegram number')}
      {t('email', 'Email')}
      {t('attention', 'Person to contact')}
      {t('ssm_no', 'SSM number')}
      {t('sst_no', 'SST number')}
      {t('address', 'Address', 'sm:col-span-2')}
      <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">Notes
        <textarea className="input min-h-20 py-2 font-normal" value={f.notes} onChange={e => set({ ...f, notes: e.target.value })} /></label>
    </div>
  )
}

export function ContactsView({ owner, initialQuery = '' }: { owner: boolean; initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery)
  const [kind, setKind] = useState<Kind | ''>('')
  const [applied, setApplied] = useState(initialQuery)
  useEffect(() => { const t = setTimeout(() => setApplied(q), 250); return () => clearTimeout(t) }, [q])
  const s = useFetch<Contact[]>(`/contacts?q=${encodeURIComponent(applied)}${kind ? `&role=${kind}` : ''}`)
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState<Form>(empty)
  const [err, setErr] = useState('')

  const add = async () => {
    if (!f.name.trim()) return setErr('Enter a name.')
    setErr('')
    try {
      const r = await api<{ id: string }>('POST', '/contacts', clean(f))
      location.hash = `#/contact/${r.id}`
    } catch (e) { setErr(msg(e)) }
  }
  const n = s.data?.length ?? 0
  return (
    <>
      <h1 tabIndex={-1} className="text-2xl font-semibold">Contacts</h1>
      <p className="mb-4 text-muted">Customers, suppliers and contractors in one place. Chat numbers saved here are how LARIS recognises who is writing.</p>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm font-semibold">Search contacts
          <input type="search" className="input font-normal" value={q} placeholder="Name, number, email, notes" onChange={e => setQ(e.target.value)} /></label>
        <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-2">
          {KINDS.map(([k, t]) => <button key={k} type="button" className="btn" aria-pressed={kind === k} onClick={() => setKind(k)}>{t}</button>)}
        </div>
        {owner && !MOCK && <button type="button" className="btn" onClick={() => download('/export/contacts.csv', 'contacts.csv').catch(e => setErr(msg(e)))}>Export contacts (csv)</button>}
        <button type="button" className="btn btn-primary" aria-expanded={adding} onClick={() => setAdding(!adding)}>Add contact</button>
      </div>
      {adding && (
        <form className="card mb-4 grid gap-3" onSubmit={e => { e.preventDefault(); add() }} aria-label="Add contact">
          <Fields f={f} set={setF} kind />
          {err && <p role="alert" className="text-sm text-warn">{err}</p>}
          <div className="flex gap-2"><button type="submit" className="btn btn-primary">Save contact</button>
            <button type="button" className="btn" onClick={() => { setAdding(false); setErr('') }}>Cancel</button></div>
        </form>
      )}
      {err && !adding && <p role="alert" className="mb-2 text-sm text-warn">{err}</p>}
      <p role="status" className="sr-only">{s.data ? `${n} ${n === 1 ? 'contact' : 'contacts'} found` : ''}</p>
      <Async s={s} empty={!n} emptyText={applied || kind ? 'No contact matches. Try fewer words or another type.' : 'No contacts yet. Add the first one.'}>
        <ul className="grid gap-2 md:grid-cols-2">
          {s.data?.map(c => (
            <li key={c.id}>
              <a className="card block hover:bg-tint" href={`#/contact/${c.id}`}>
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-accent underline underline-offset-2">{c.name}</span>
                  <span className="badge">{KIND_ONE[c.role]}</span>
                </span>
                {c.attention && <span className="block text-sm">{c.attention}</span>}
                <span className="block text-sm text-muted">{[c.contact, c.email].filter(Boolean).join(' · ') || 'No contact details'}</span>
                <span className="mt-2 block text-sm text-muted">
                  {c.documents} {c.documents === 1 ? 'document' : 'documents'} · last {day(c.last_activity)}
                  {owner && c.value && Number(c.value) > 0 ? ` · ${rm(c.value)}` : ''}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </Async>
    </>
  )
}

export function ContactDetail({ id, owner }: { id: string; owner: boolean }) {
  const s = useFetch<ContactDetail>(`/contacts/${id}`)
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState<Form>(empty)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const c = s.data
  useEffect(() => { if (c) document.title = `${c.name} · LARIS` }, [c])
  const start = () => {
    if (!c) return
    setF({ role: c.role, name: c.name, contact: c.contact ?? '', email: c.email ?? '', attention: c.attention ?? '', ssm_no: c.ssm_no ?? '', sst_no: c.sst_no ?? '', address: c.address ?? '', notes: c.notes ?? '' })
    setEditing(true); setNote('')
  }
  const save = async () => {
    if (!f.name.trim()) return setErr('A contact needs a name.')
    setErr('')
    const { role: _role, ...body } = clean(f) as Form
    try { await api('POST', `/contacts/${id}`, body); setEditing(false); setNote('Contact saved.'); s.reload() } catch (e) { setErr(msg(e)) }
  }
  const row = (k: string, v: string | null) => v ? <div><dt className="text-sm text-muted">{k}</dt><dd>{v}</dd></div> : null
  return (
    <>
      <p className="mb-2"><a className="link inline-flex min-h-11 items-center" href="#/contacts">Back to contacts</a></p>
      <Async s={s} empty={false}>
        {c && <>
          <h1 tabIndex={-1} className="text-2xl font-semibold">{c.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm"><span className="badge">{KIND_ONE[c.role]}</span>
            <span className="text-muted">{c.documents} {c.documents === 1 ? 'document' : 'documents'}{owner && c.value && Number(c.value) > 0 ? ` · ${rm(c.value)} in total` : ''}</span></p>
          <p role="status" className="mt-2 text-sm">{note}</p>
          {editing ? (
            <form className="card mt-3 grid gap-3" onSubmit={e => { e.preventDefault(); save() }} aria-label="Edit contact">
              <Fields f={f} set={setF} kind={false} />
              {err && <p role="alert" className="text-sm text-warn">{err}</p>}
              <div className="flex gap-2"><button type="submit" className="btn btn-primary">Save changes</button>
                <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button></div>
            </form>
          ) : (
            <section className="card mt-3" aria-label="Details">
              <dl className="grid gap-3 sm:grid-cols-2">
                {row('WhatsApp or Telegram', c.contact)}{row('Email', c.email)}{row('Person to contact', c.attention)}
                {row('SSM number', c.ssm_no)}{row('SST number', c.sst_no)}{row('Address', c.address)}
              </dl>
              {c.notes && <p className="mt-3 whitespace-pre-wrap border-t border-soft pt-3 text-sm">{c.notes}</p>}
              {!c.contact && !c.email && !c.attention && !c.address && !c.notes && <p className="text-muted">No details saved yet.</p>}
              <div className="mt-3"><button type="button" className="btn" onClick={start}>Edit {c.name}</button></div>
            </section>
          )}
          {c.current_costs && c.current_costs.length > 0 && (
            <section className="mt-6" aria-labelledby="costs">
              <h2 id="costs" className="mb-2 text-lg font-semibold">What they charge now</h2>
              <div className="max-w-full overflow-x-auto rounded-ui border border-soft bg-surface" role="region" aria-label="Current costs" tabIndex={0}>
                <table className="w-full min-w-max"><caption className="sr-only">Current supplier costs for {c.name}</caption>
                  <thead><tr><th scope="col">Item</th><th scope="col">Unit</th><th scope="col">Unit cost</th><th scope="col">Since</th></tr></thead>
                  <tbody>{c.current_costs.map(x => <tr key={x.item_key}><td>{x.item_key}</td><td>{x.uom}</td><td className="tabular-nums">{rm(x.unit_cost)}</td><td>{x.effective_date}</td></tr>)}</tbody>
                </table>
              </div>
            </section>
          )}
          <section className="mt-6" aria-labelledby="docs">
            <h2 id="docs" className="mb-2 text-lg font-semibold">Documents</h2>
            {c.recent_documents.length === 0 ? <p className="card text-muted">No documents with {c.name} yet.</p> : (
              <ul className="divide-y divide-soft rounded-ui border border-soft bg-surface">
                {c.recent_documents.map(d => (
                  <li key={d.id}><a className="row" href={`#/doc/${d.id}`}>
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-semibold text-accent underline underline-offset-2">{d.doc_no ?? 'No document number'}</span>
                      <span className="text-sm tabular-nums">{d.total ? rm(d.total) : ''}</span></span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-sm"><Status v={d.status} /><span className="text-muted">{d.direction === 'in' ? 'Received' : 'Sent'}</span></span>
                  </a></li>
                ))}
              </ul>
            )}
          </section>
        </>}
      </Async>
    </>
  )
}

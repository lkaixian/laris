import { useEffect, useRef, useState } from 'react'
import type { Ref } from 'react'
import { api, can, download, MOCK, needs, why } from './api'
import type { DocSummary } from './api'
import { useWriteGate } from './Licence'
import { Async, EmptyState, PageHeader, Status, msg, rm, useFetch } from './ui'
import { DataTable, FilterBar, Tabs } from './kit'
import type { Col } from './kit'
import { useToast } from './Toast'
import { PersonData } from './Privacy'

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
const COSTS: Col<NonNullable<ContactDetail['current_costs']>[number]>[] = [
  { key: 'item', head: 'Item', cell: x => x.item_key, mobile: 'title' },
  { key: 'uom', head: 'Unit', cell: x => x.uom, mobile: 'meta' },
  { key: 'cost', head: 'Unit cost', cell: x => rm(x.unit_cost), num: true, mobile: 'meta' },
  { key: 'upd', head: 'Updated', cell: x => x.effective_date.slice(0, 10), mobile: 'meta', className: 'whitespace-nowrap tabular-nums' },
]
const day = (s: string | null) => (s ? s.slice(0, 10) : 'No activity yet')

const cols = (owner: boolean): Col<Contact>[] => [
  { key: 'name', head: 'Name', cell: c => <a href={`#/contact/${c.id}`}>{c.name}</a>, mobile: 'title' },
  { key: 'role', head: 'Role', cell: c => <span className="badge">{KIND_ONE[c.role]}</span>, mobile: 'badge' },
  { key: 'phone', head: 'Phone', cell: c => c.contact ?? <span className="text-muted">None</span>, mobile: 'sub', className: 'whitespace-nowrap tabular-nums' },
  { key: 'docs', head: 'Documents', cell: c => c.documents, num: true },
  ...(owner ? [{ key: 'value', head: 'Value', cell: (c: Contact) => c.value && Number(c.value) > 0 ? rm(c.value) : '', num: true }] : []),
  { key: 'last', head: 'Last activity', cell: c => day(c.last_activity), mobile: 'meta' as const, className: 'whitespace-nowrap tabular-nums' },
]

const empty = { role: 'customer' as Kind, name: '', contact: '', email: '', attention: '', ssm_no: '', sst_no: '', address: '', notes: '' }
type Form = typeof empty
const clean = (f: Partial<Form>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]))

// lock: the person may not change a supplier's name or number (needs edit_supplier_contacts). Those two fields show as read-only text with the reason.
function Fields({ f, set, kind, kindRef, lock }: { f: Form; set: (f: Form) => void; kind: boolean; kindRef?: Ref<HTMLSelectElement>; lock?: boolean }) {
  const t = (k: keyof Form, name: string, extra = '', locked = false) => (
    <label className={`flex flex-col gap-1 text-sm font-semibold ${extra}`}>{name}
      <input className="input font-normal read-only:bg-soft" value={f[k]} onChange={e => set({ ...f, [k]: e.target.value })} {...(locked ? { readOnly: true, title: why('edit_supplier_contacts'), 'aria-describedby': 'sup-lock' } : {})} /></label>
  )
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {kind && (
        <label className="flex flex-col gap-1 text-sm font-semibold">Type
          <select ref={kindRef} className="input font-normal" value={f.role} aria-describedby={can('edit_supplier_contacts') ? undefined : 'kind-why'} onChange={e => set({ ...f, role: e.target.value as Kind })}>
            {(Object.keys(KIND_ONE) as Kind[]).map(k => k === 'supplier' && !can('edit_supplier_contacts')
              ? <option key={k} value={k} disabled>{KIND_ONE[k]} (needs permission)</option>
              : <option key={k} value={k}>{KIND_ONE[k]}</option>)}</select>
          {!can('edit_supplier_contacts') && <span id="kind-why" className="text-xs font-normal text-muted">{why('edit_supplier_contacts')} to add a supplier.</span>}</label>
      )}
      {lock && <p id="sup-lock" className="text-sm text-muted sm:col-span-2">{why('edit_supplier_contacts')} to change a supplier&apos;s name or number. The other details can be changed.</p>}
      {t('name', 'Name', '', lock)}
      {t('contact', 'WhatsApp or Telegram number', '', lock)}
      {t('email', 'Email')}
      {t('attention', 'Person to contact')}
      {t('ssm_no', 'SSM number (company registration)')}
      {t('sst_no', 'SST number (sales and service tax)')}
      {t('address', 'Address', 'sm:col-span-2')}
      <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">Notes
        <textarea className="input min-h-20 py-2 font-normal" value={f.notes} onChange={e => set({ ...f, notes: e.target.value })} /></label>
    </div>
  )
}

let saved = { q: '', kind: '' as Kind | '' }  // list state kept for this visit, so Back from a contact returns to the same search

// arg 'new' opens the Add contact form (Home quick action).
export function ContactsView({ owner, arg, initialQuery = '' }: { owner: boolean; arg?: string; initialQuery?: string }) {
  const gate = useWriteGate()
  const [q, setQRaw] = useState(initialQuery || saved.q)
  const [kind, setKindRaw] = useState<Kind | ''>(saved.kind)
  const setQ = (v: string) => { saved.q = v; setQRaw(v) }
  const setKind = (v: Kind | '') => { saved.kind = v; setKindRaw(v) }
  const [applied, setApplied] = useState(initialQuery || saved.q)
  useEffect(() => { const t = setTimeout(() => setApplied(q), 250); return () => clearTimeout(t) }, [q])
  const s = useFetch<Contact[]>(`/contacts?q=${encodeURIComponent(applied)}${kind ? `&role=${kind}` : ''}`)
  const [adding, setAdding] = useState(arg === 'new' && can('manage_contacts'))
  const [f, setF] = useState<Form>(empty)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLSelectElement>(null)
  useEffect(() => { if (adding) first.current?.focus() }, [adding])

  const add = async () => {
    if (busy) return
    if (!f.name.trim()) return setErr('Enter a name.')
    setErr(''); setBusy(true)
    try {
      const r = await api<{ id: string }>('POST', '/contacts', clean(f))
      location.hash = `#/contact/${r.id}`
    } catch (e) { setErr(msg(e)); setBusy(false) }
  }
  const n = s.data?.length ?? 0
  const filtered = !!(applied || kind)
  return (
    <>
      <PageHeader title="Contacts" description="Customers, suppliers and contractors in one place. Chat numbers saved here are how LARIS recognises who is writing."
        actions={<>
          {can('export_data') && !MOCK && <button type="button" className="btn" onClick={() => download('/export/contacts.csv', 'contacts.csv').catch(e => setErr(msg(e)))}>Export contacts (csv)</button>}
          <button type="button" className={`btn ${adding ? '' : 'btn-primary'}`} aria-expanded={adding} {...(can('manage_contacts') ? gate(() => setAdding(!adding)) : needs('manage_contacts'))}>Add contact</button>
        </>} />
      <Tabs label="Filter by type" value={kind} options={KINDS.map(([k, t]) => ({ value: k, label: t }))} onChange={v => setKind(v as Kind | '')} />
      <FilterBar label="Contact search" search={{ value: q, onChange: setQ, label: 'Search name, number, email, notes' }}
        chips={q ? [{ label: `Search: ${q}`, onRemove: () => setQ('') }] : []} />
      {adding && (
        <form className="card mb-4 grid gap-3" onSubmit={e => { e.preventDefault(); add() }} aria-label="Add contact">
          <Fields f={f} set={setF} kind kindRef={first} />
          {err && <p role="alert" className="text-sm text-warn">{err}</p>}
          <div className="flex gap-2"><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Saving...' : 'Save contact'}</button>
            <button type="button" className="btn" onClick={() => { setAdding(false); setErr('') }}>Cancel</button></div>
        </form>
      )}
      {err && !adding && <p role="alert" className="mb-2 text-sm text-warn">{err}</p>}
      <p role="status" className="sr-only">{s.data ? `${n} ${n === 1 ? 'contact' : 'contacts'} found` : ''}</p>
      <Async s={s} rows={8} shape="table" empty={!n} emptyText={filtered ? 'No contact matches.' : 'No contacts yet.'}
        emptyHint={filtered ? 'Try fewer words or another type.' : 'Add your first supplier or customer. Saved chat numbers let LARIS recognise who is writing.'}
        emptyAction={filtered ? { label: 'Clear search', onClick: () => { setQ(''); setApplied(''); setKind('') } } : can('manage_contacts') ? { label: 'Add the first contact', onClick: () => setAdding(true) } : undefined}>
        <DataTable label="Contacts" caption="Contacts" rows={s.data ?? []} rowKey={c => c.id} cols={cols(owner)} />
      </Async>
    </>
  )
}

export function ContactDetail({ id, owner }: { id: string; owner: boolean }) {
  const s = useFetch<ContactDetail>(`/contacts/${id}`)
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState<Form>(empty)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const c = s.data
  const start = () => {
    if (!c) return
    setF({ role: c.role, name: c.name, contact: c.contact ?? '', email: c.email ?? '', attention: c.attention ?? '', ssm_no: c.ssm_no ?? '', sst_no: c.sst_no ?? '', address: c.address ?? '', notes: c.notes ?? '' })
    setEditing(true)
  }
  const save = async () => {
    if (busy) return
    if (!f.name.trim()) return setErr('A contact needs a name.')
    setErr(''); setBusy(true)
    const { role: _role, ...body0 } = clean(f) as Form
    const body: Partial<Form> = { ...body0 }
    if (c?.role === 'supplier' && !can('edit_supplier_contacts')) { delete body.name; delete body.contact }  // not ours to change: the server would answer 403
    try { await api('POST', `/contacts/${id}`, body); setEditing(false); toast('Contact saved.'); s.reload() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  const row = (k: string, v: string | null) => v ? <div><dt className="text-sm text-muted">{k}</dt><dd>{v}</dd></div> : null
  return (
    <>
      {!c && <PageHeader crumbs={[{ href: '#/contacts', label: 'Contacts' }]} />}
      <Async s={s} empty={false} rows={4}>
        {c && <>
          <PageHeader crumbs={[{ href: '#/contacts', label: 'Contacts' }, { label: c.name }]} title={c.name} status={<span className="badge">{KIND_ONE[c.role]}</span>}
            meta={<>{c.contact && <span>{c.contact}</span>}{c.email && <span>{c.email}</span>}
              <span className="text-muted">{c.documents} {c.documents === 1 ? 'document' : 'documents'}{owner && c.value && Number(c.value) > 0 ? ` · ${rm(c.value)} in total` : ''}</span></>}
            actions={!editing && <button type="button" className="btn" {...needs('manage_contacts', start)}>Edit {c.name}</button>} />
          {editing ? (
            <form className="card mt-3 grid gap-3" onSubmit={e => { e.preventDefault(); save() }} aria-label="Edit contact">
              <Fields f={f} set={setF} kind={false} lock={c.role === 'supplier' && !can('edit_supplier_contacts')} />
              {err && <p role="alert" className="text-sm text-warn">{err}</p>}
              <div className="flex gap-2"><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Saving...' : 'Save changes'}</button>
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
            </section>
          )}
          {c.current_costs && c.current_costs.length > 0 && (
            <section className="mt-6" aria-labelledby="costs">
              <h2 id="costs" className="mb-3 text-md font-semibold">What they charge now</h2>
              <DataTable label="Current costs table" caption={`Current supplier costs for ${c.name}`} rows={c.current_costs} rowKey={x => x.item_key} cols={COSTS} />
            </section>
          )}
          <section className="mt-6" aria-labelledby="docs">
            <h2 id="docs" className="mb-3 text-md font-semibold">Documents</h2>
            {c.recent_documents.length === 0 ? <EmptyState title={`No documents with ${c.name} yet.`} /> : (
              <ul className="divide-y divide-hairline rounded-card border border-hairline bg-surface">
                {c.recent_documents.map(d => (
                  <li key={d.id}><a className="row group" href={`#/doc/${d.id}`}>
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-semibold text-ink group-hover:underline">{d.doc_no ?? 'No document number'}</span>
                      <span className="num text-sm">{d.total ? rm(d.total) : ''}</span></span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-sm"><Status v={d.status} /><span className="text-muted">{d.direction === 'in' ? 'Received' : 'Sent'}</span></span>
                  </a></li>
                ))}
              </ul>
            )}
          </section>
          <PersonData id={id} name={c.name} customer={c.role === 'customer'} onDone={s.reload} />
        </>}
      </Async>
    </>
  )
}

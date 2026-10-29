import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, download, NEXT, MOCK, can, needs, why, ApiError } from './api'
import { QuotePanel, Messages } from './QuoteDoc'
import { Timeline } from './Timeline'
import { useToast } from './Toast'
import { rm, label, msg, REVIEWABLE, focusTop, useFetch, Async, PageHeader, TableRegion, Status } from './ui'
import type { DocDetail, Line, Field } from './api'

// ---------- Document detail ----------
function cell(f: Field, v: unknown): ReactNode {
  if (v === undefined || v === null || v === '') return <span className="text-muted">Not set</span>
  if (f.type === 'boolean') return v ? 'Yes' : 'No'
  return `${String(v)}${f.unit ? ' ' + f.unit : ''}`
}

function LineRow({ docId, l, cols, edit, showPrice, onSaved }: { docId: string; l: Line; cols: Field[]; edit: boolean; showPrice: boolean; onSaved: (n: number) => void }) {
  // `edit` = the document is still reviewable; the permission only decides whether the inputs are there (the server stays the authority).
  const editable = edit && can('upload_documents')
  const priceEdit = editable && can('view_costs') && l.unit_price !== null
  const [key, setKey] = useState(l.item_key ?? '')
  const [qty, setQty] = useState(l.qty ? String(Number(l.qty)) : '')
  const [price, setPrice] = useState(l.unit_price !== null ? String(Number(l.unit_price)) : '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const errId = `line-err-${l.id}`
  const bad = err ? { 'aria-invalid': true, 'aria-describedby': errId } : {}
  const save = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try {
      const changed = priceEdit && price !== '' && Number(price) !== Number(l.unit_price)
      await api('POST', `/documents/${docId}/lines/${l.id}`, { item_key: key.trim() || undefined, qty: qty === '' ? undefined : qty, ...(changed ? { unit_price: price } : {}) })
      onSaved(l.line_no)
    } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  if (l.is_header) return <tr><th colSpan={6 + cols.length} scope="colgroup" className="bg-soft text-ink">{l.description}</th></tr>
  const unmapped = Object.entries(l.attrs_unmapped)
  return (
    <tr>
      <td>{l.line_no}</td>
      <td>
        {l.description}
        {l.needs_review && <span className="badge badge-warn ml-2">Needs review{l.ocr_confidence !== null ? `, OCR ${Math.round(Number(l.ocr_confidence) * 100)}%` : ''}</span>}
        {unmapped.length > 0 && <p className="text-xs text-muted">Unmapped field: {unmapped.map(([k, v]) => `${k} = ${String(v)}`).join(', ')}</p>}
        {err && <p id={errId} role="alert" className="text-xs text-warn">{err}</p>}
      </td>
      <td>
        {editable ? <input className="input w-36" aria-label={`Item key for line ${l.line_no}`} value={key} onChange={e => setKey(e.target.value)} {...bad} /> : l.item_key ?? <span className="text-muted">Not set</span>}
      </td>
      <td className="num">
        {editable ? <input className="input w-24" type="number" min="0" step="any" inputMode="decimal" aria-label={`Quantity for line ${l.line_no}`} value={qty} onChange={e => setQty(e.target.value)} {...bad} /> : l.qty ? Number(l.qty) : <span className="text-muted">Not set</span>}
      </td>
      <td>{l.uom}</td>
      <td className="num">{!showPrice ? <span className="text-muted">Hidden for staff</span>
        : priceEdit ? <input className="input w-28" type="number" min="0" step="any" inputMode="decimal" aria-label={`Unit cost for line ${l.line_no}`} value={price} onChange={e => setPrice(e.target.value)} {...bad} />
        : rm(l.unit_price)}</td>
      {cols.map(f => <td key={f.key}>{cell(f, l.attrs[f.key])}</td>)}
      {editable && <td><button className="btn" aria-disabled={busy || undefined} onClick={save}>{busy ? 'Saving...' : `Save line ${l.line_no}`}</button></td>}
    </tr>
  )
}

export function DetailView({ id, owner }: { id: string; owner: boolean }) {
  const costs = can('view_costs')  // cost, margin and provenance follow the permission; deciding on a quote stays owner-class
  const s = useFetch<DocDetail>(`/documents/${id}`)
  const f = useFetch<Field[]>('/fields')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')  // the status being moved to, shown on that button while it runs
  const toast = useToast()
  const d = s.data
  const cols = (f.data ?? []).filter(x => x.show_in_grid).sort((a, b) => a.sort_order - b.sort_order)
  const actions = d ? NEXT[d.doc.direction][d.doc.status] ?? [] : []
  const edit = !!d && d.doc.direction === 'in' && REVIEWABLE.includes(d.doc.status)
  const docNo = d?.doc.id === id ? d.doc.doc_no ?? 'Document' : undefined
  // Arrived by navigation (focus is parked on main): move it to the heading once the document is there.
  useEffect(() => { if (docNo && document.activeElement === document.getElementById('main')) focusTop() }, [docNo])
  const move = async (to: string) => {
    if (busy) return
    setBusy(to); setErr('')
    try {
      const r = await api<{ delivery?: string }>('POST', `/documents/${id}/transition`, { to, reason: reason.trim() || undefined })
      setReason(''); s.reload(); focusTop()
      if (r.delivery === 'not_sent') toast(`${docNo} moved to ${label(to)}. No chat contact on file, so nothing was sent.`)
      else toast(`${docNo} moved to ${label(to)}.`)
      if (r.delivery === 'failed') setErr('Marked as sent, but the message to the customer did not go through. Send the quote PDF by hand.')
    } catch (e) { setErr(msg(e)); if (e instanceof ApiError && e.status === 409) s.reload() } finally { setBusy('') }  // 409: the document changed under us, show its real state
  }
  const save = async (path: string, name: string) => {
    setErr('')
    try { await download(path, name); toast(`${name} downloaded.`) } catch (e) { setErr(msg(e)) }
  }
  const lineOf = (lineId?: string) => d?.lines.find(l => l.id === lineId)
  return (
    <>
      {!d && <PageHeader crumbs={[{ href: '#/tracker', label: 'Tracker' }]} />}
      <Async s={s} empty={false} rows={5}>
        {d && (
          <>
            <PageHeader crumbs={[{ href: '#/tracker', label: 'Tracker' }, { label: d.doc.doc_no ?? 'No document number' }]} title={d.doc.doc_no ?? 'No document number'} status={<Status v={d.doc.status} />}
              meta={<>
                <span>{d.doc.direction === 'in' ? 'Supplier quote from' : 'Customer quote for'} {d.doc.party.name}</span>
                {costs && d.doc.flags.cost_is_stale && <span className="badge badge-warn">Cost is stale</span>}
                <span className="text-muted">Total {rm(d.doc.total)}</span>
              </>}
              actions={d.doc.direction === 'out' && !MOCK && <>
                {can('export_data') && costs && ['accepted', 'sent', 'read', 'job_created'].includes(d.doc.status) && <>
                  <button type="button" className="btn" onClick={() => save(`/export/bom.xlsx?quote_id=${id}`, `bom-${d.doc.doc_no}.xlsx`)}>Download BOM (xlsx)</button>
                  <button type="button" className="btn" onClick={() => save(`/export/po.csv?quote_id=${id}`, `po-${d.doc.doc_no}.csv`)}>Download purchase list (csv)</button>
                </>}
              </>} />

            <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
            <div className="min-w-0 lg:order-1">
            {d.doc.direction === 'out' && <QuotePanel key={id} id={id} status={d.doc.status} owner={owner} onChanged={s.reload} />}
            <h2 className="mb-2 text-md font-semibold">Lines</h2>
            {edit && !can('upload_documents') && <p className="mb-2 text-sm text-muted">{why('upload_documents')} to edit these lines. You can read them here.</p>}
            {edit && can('upload_documents') && <p className="mb-2 text-sm text-muted">Review step: set the item key and quantity for each line, then save the line. The item key is a short code that links the line to your cost book, for example acrylic_3mm_sheet. Lines marked Needs review are unclear on the source document.</p>}
            {f.error && <p role="alert" className="mb-2 text-sm text-warn">Could not load extra columns: {f.error}</p>}
            {d.lines.length === 0 ? <p className="card text-muted">This document has no lines.</p> : (
              <TableRegion label="Lines">
                <table className="w-full min-w-max">
                  <caption className="sr-only">Lines of {d.doc.doc_no ?? 'this document'}</caption>
                  <thead><tr>
                    <th scope="col">No.</th><th scope="col">Description</th><th scope="col">Item key</th><th scope="col" className="text-right">Qty</th><th scope="col">Unit</th>
                    <th scope="col" className="text-right">{d.doc.direction === 'in' ? 'Unit cost' : 'Unit price'}</th>
                    {cols.map(c => <th key={c.key} scope="col">{c.label}</th>)}
                    {edit && can('upload_documents') && <th scope="col">Action</th>}
                  </tr></thead>
                  <tbody>{d.lines.map(l => <LineRow key={l.id} docId={id} l={l} cols={cols} edit={edit} showPrice={costs || d.doc.direction === 'out' || REVIEWABLE.includes(d.doc.status)} onSaved={n => { toast(`Line ${n} saved.`); s.reload() }} />)}</tbody>
                </table>
              </TableRegion>
            )}
            <Messages list={d.messages} />
            </div>

            <aside className="grid gap-6 lg:order-2">
            <section className="card" aria-labelledby="actions">
              <h2 id="actions" className="text-md font-semibold">Decision</h2>
              {!actions.length && <p className="text-sm text-muted">This document is {label(d.doc.status)}. No further actions.</p>}
              {actions.length > 0 && !owner && !actions.some(a => !a.owner) && <p className="text-sm text-muted">Only the owner can decide on this quote. Switch the simulated role to owner to try it.</p>}
              {actions.some(a => !a.owner || owner) && (
                <>
                  {owner && <label className="mt-2 flex flex-col gap-1 text-sm font-semibold">Reason (optional, saved to the activity log)
                    <input className="input max-w-md font-normal" value={reason} onChange={e => setReason(e.target.value)} />
                  </label>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {actions.filter(a => !a.owner || owner).map(a => (
                      <button key={a.to} aria-disabled={!!busy || undefined} {...(a.owner ? { onClick: () => move(a.to) } : needs('upload_documents', () => move(a.to)))} className={`btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`}>{busy === a.to ? 'Working...' : a.label}</button>
                    ))}
                  </div>
                </>
              )}
              {err && <p role="alert" className="mt-2 text-sm text-warn">{err}</p>}
            </section>

            <Timeline key={id} id={id} status={d.doc.status} />

            {costs && d.provenance && (
              <section aria-labelledby="prov">
                <h2 id="prov" className="text-md font-semibold">Cost provenance <span className="text-sm font-normal text-muted">(owner only)</span></h2>
                {d.provenance.length === 0 ? <p className="card mt-2 text-muted">No supplier cost is linked to this document.</p> : (
                  <ul className="mt-2 grid gap-2">
                    {d.provenance.map(p => {
                      const ln = lineOf(p.line_id)
                      const perUnit = Number(p.cost_snapshot) - Number(p.current_unit_cost)
                      // margin impact = cost change x qty of the cost item per unit sold x units sold
                      const total = ln?.qty ? perUnit * Number(p.qty_consumed ?? 1) * Number(ln.qty) : null
                      return (
                        <li key={p.cost_item_id + p.line_id} className="card">
                          <p className="font-semibold">{ln ? `Line ${ln.line_no}: ${ln.description}` : `Cost item ${p.cost_item_id}`}</p>
                          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
                            <dt className="text-muted">Supplier</dt><dd>{p.supplier}</dd>
                            <dt className="text-muted">Source document</dt><dd><a className="link" href={`#/doc/${p.source_doc_id}`}>{p.source_doc_no}</a></dd>
                            <dt className="text-muted">Cost date</dt><dd>{p.cost_date}</dd>
                            <dt className="text-muted">Cost used in quote</dt><dd>{rm(p.cost_snapshot)}</dd>
                            <dt className="text-muted">Current cost</dt><dd>{rm(p.current_unit_cost)}</dd>
                            <dt className="text-muted">Line margin</dt><dd>{rm(p.line_margin)}</dd>
                          </dl>
                          {p.cost_is_stale && (
                            <p className="badge badge-warn mt-2">Cost is stale: margin down {rm(String(Math.abs(total ?? perUnit)))}{total === null ? ' per unit' : ''}</p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )}
            {!costs && <p className="text-sm text-muted">Cost and margin are not available to your role.</p>}
            </aside>
            </div>
          </>
        )}
      </Async>
    </>
  )
}

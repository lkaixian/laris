import { useCallback, useEffect, useRef, useState } from 'react'
import { api, can, download, why } from './api'
import { EmptyState, PageHeader, Skeleton, msg } from './ui'
import { FilterBar, FilterSelect } from './kit'
import { useToast } from './Toast'

// Activity log: filters (dates, person, module, action, words), newest first, older pages on demand, new rows every 4 s,
// and a download of only the ticked entries (or of everything that matches the filters) as CSV or PDF.
interface Entry { id: number; at: string; actor: string; entity: string; entity_id: string; event: string; action: 'created' | 'status' | 'other' }
interface Page { items: Entry[]; has_more: boolean }
interface Filters { from: string; to: string; actor: string; module: string; action: string; q: string }
const EMPTY: Filters = { from: '', to: '', actor: '', module: '', action: '', q: '' }
const PAGE = 100
const MAX_EXPORT = 1000

// Friendly names for the modules the log records (the table each entry is about). Unknown ones show their own name.
const MODULES: Record<string, string> = {
  documents: 'Quotes and supplier documents', document_lines: 'Quote lines', cost_items: 'Cost book', jobs: 'Jobs', followups: 'Follow-ups',
  parties: 'Contacts', listing_items: 'Catalog products', listings: 'Catalog photos', rfq_items: 'Ask suppliers', tenants: 'Settings',
  users: 'Team', roles: 'Roles', audit_log: 'Activity log', licenses: 'Licence', api_keys: 'API access',
}
const ACTIONS: [string, string][] = [['created', 'Created'], ['status', 'Status changed'], ['other', 'Other changes']]
const moduleName = (m: string) => MODULES[m] ?? m.replace(/_/g, ' ')
const actionName = (a: string) => ACTIONS.find(x => x[0] === a)?.[1] ?? a

const qs = (f: Filters, extra: Record<string, string> = {}) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v.trim()) p.set(k, v.trim())
  for (const [k, v] of Object.entries(extra)) p.set(k, v)
  return p.toString()
}

export function ActivityView() {
  const toast = useToast()
  const [f, setF] = useState<Filters>(EMPTY)
  const [qd, setQd] = useState('')  // debounced words
  const [rows, setRows] = useState<Entry[]>([])
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [checked, setChecked] = useState('')
  const [announce, setAnnounce] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [facets, setFacets] = useState<{ people: string[]; modules: string[] }>({ people: [], modules: [] })
  const [busy, setBusy] = useState('')
  const seq = useRef(0)
  const top = useRef(0)
  const filters = { ...f, q: qd }
  const key = qs(filters)
  const exportOk = can('export_data')

  useEffect(() => { const t = setTimeout(() => setQd(f.q), 300); return () => clearTimeout(t) }, [f.q])
  useEffect(() => { api<{ people: string[]; modules: string[] }>('GET', '/audit/facets').then(setFacets, () => undefined) }, [])

  const load = useCallback(async (before?: number) => {
    const my = ++seq.current
    setLoading(true); setError('')
    try {
      const d = await api<Page>('GET', `/audit/search?${qs(filters, { limit: String(PAGE), ...(before ? { before: String(before) } : {}) })}`)
      if (my !== seq.current) return
      setRows(r => before ? [...r, ...d.items] : d.items); setMore(d.has_more)
      if (!before) { top.current = d.items[0]?.id ?? 0; setPicked(new Set()) }
      setChecked(new Date().toLocaleTimeString())
    } catch (e) { if (my === seq.current) setError(msg(e)) } finally { if (my === seq.current) setLoading(false) }
  }, [key])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [load])

  // New entries that match the filters are added at the top every 4 seconds.
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden) return
      try {
        const d = await api<Page>('GET', `/audit/search?${qs(filters, { after: String(top.current), limit: '200' })}`)
        if (d.items.length) {
          top.current = d.items[0].id
          setRows(r => [...d.items.filter(x => !r.some(y => y.id === x.id)), ...r])
          setAnnounce(`${d.items.length} new ${d.items.length === 1 ? 'entry' : 'entries'}`)
        }
        setChecked(new Date().toLocaleTimeString())
      } catch { /* the next tick tries again; the error banner is for the main load */ }
    }, 4000)
    return () => clearInterval(t)
  }, [key])  // eslint-disable-line react-hooks/exhaustive-deps

  const set = (p: Partial<Filters>) => setF(x => ({ ...x, ...p }))
  const active = Object.values(f).some(v => v.trim())
  const chips = [
    ...(f.from ? [{ label: `From ${f.from}`, onRemove: () => set({ from: '' }) }] : []),
    ...(f.to ? [{ label: `To ${f.to}`, onRemove: () => set({ to: '' }) }] : []),
    ...(f.actor ? [{ label: `Person: ${f.actor}`, onRemove: () => set({ actor: '' }) }] : []),
    ...(f.module ? [{ label: `Module: ${moduleName(f.module)}`, onRemove: () => set({ module: '' }) }] : []),
    ...(f.action ? [{ label: `Action: ${actionName(f.action)}`, onRemove: () => set({ action: '' }) }] : []),
    ...(f.q ? [{ label: `Words: ${f.q}`, onRemove: () => { set({ q: '' }); setQd('') } }] : []),
  ]
  const allShown = rows.length > 0 && rows.every(r => picked.has(r.id))
  const toggle = (id: number) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleAll = () => setPicked(allShown ? new Set() : new Set(rows.map(r => r.id)))

  const exportAs = async (format: 'csv' | 'pdf', chosen: boolean) => {
    if (busy) return
    if (chosen && picked.size > MAX_EXPORT) return setError(`Choose at most ${MAX_EXPORT} entries to download.`)
    setBusy(`${chosen ? 'sel' : 'all'}-${format}`); setError('')
    const day = new Date().toISOString().slice(0, 10)
    try {
      const p = chosen ? `format=${format}&ids=${[...picked].join(',')}` : qs(filters, { format })
      await download(`/audit/export?${p}`, `activity-log-${day}.${format}`)
      toast(`Activity log downloaded as ${format.toUpperCase()}${chosen ? `, ${picked.size} ${picked.size === 1 ? 'entry' : 'entries'}` : ''}.`)
    } catch (e) { setError(msg(e)) } finally { setBusy('') }
  }

  return (
    <>
      <PageHeader title="Activity log" description={`Newest first. New entries appear every 4 seconds.${checked ? ` Last checked ${checked}.` : ''}`} />
      <p role="status" className="sr-only">{announce}</p>
      <FilterBar label="Activity filters" search={{ value: f.q, onChange: v => set({ q: v }), label: 'Search the event words' }} chips={chips}
        onClear={active ? () => { setF(EMPTY); setQd('') } : undefined}>
        <label className="input flex items-center gap-1 bg-surface py-0"><span className="text-muted">From:</span>
          <input type="date" className="min-w-0 bg-transparent py-1 font-medium text-ink" value={f.from} max={f.to || undefined} onChange={e => set({ from: e.target.value })} /></label>
        <label className="input flex items-center gap-1 bg-surface py-0"><span className="text-muted">To:</span>
          <input type="date" className="min-w-0 bg-transparent py-1 font-medium text-ink" value={f.to} min={f.from || undefined} onChange={e => set({ to: e.target.value })} /></label>
        <FilterSelect label="Person" value={f.actor} onChange={v => set({ actor: v })}>
          <option value="">Anyone</option>{facets.people.map(p => <option key={p} value={p}>{p}</option>)}
        </FilterSelect>
        <FilterSelect label="Module" value={f.module} onChange={v => set({ module: v })}>
          <option value="">All</option>{facets.modules.map(m => <option key={m} value={m}>{moduleName(m)}</option>)}
        </FilterSelect>
        <FilterSelect label="Action" value={f.action} onChange={v => set({ action: v })}>
          <option value="">Any</option>{ACTIONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </FilterSelect>
      </FilterBar>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-card border border-hairline p-2" role="group" aria-label="Download">
        <span className="text-sm font-semibold">{picked.size ? `${picked.size} ${picked.size === 1 ? 'entry' : 'entries'} chosen` : 'No entries chosen'}</span>
        {exportOk ? <>
          <button type="button" className="btn btn-primary" aria-disabled={!picked.size || !!busy || undefined} onClick={() => picked.size && exportAs('csv', true)}>{busy === 'sel-csv' ? 'Preparing...' : 'Download chosen as CSV'}</button>
          <button type="button" className="btn" aria-disabled={!picked.size || !!busy || undefined} onClick={() => picked.size && exportAs('pdf', true)}>{busy === 'sel-pdf' ? 'Preparing...' : 'Download chosen as PDF'}</button>
          <span className="text-sm text-muted">or everything that matches the filters (up to {MAX_EXPORT}):</span>
          <button type="button" className="btn" aria-disabled={!!busy || !rows.length || undefined} onClick={() => rows.length && exportAs('csv', false)}>{busy === 'all-csv' ? 'Preparing...' : 'All matching as CSV'}</button>
          <button type="button" className="btn" aria-disabled={!!busy || !rows.length || undefined} onClick={() => rows.length && exportAs('pdf', false)}>{busy === 'all-pdf' ? 'Preparing...' : 'All matching as PDF'}</button>
        </> : <span className="text-sm text-muted">{why('export_data')} to download entries.</span>}
      </div>

      {error && <div role="alert" className="card mb-3 border-warn bg-warn-bg text-warn"><p>{error}</p><button type="button" className="btn mt-3" onClick={() => void load()}>Retry loading</button></div>}
      {loading && !rows.length ? <Skeleton rows={5} shape="text" /> : !rows.length && !error
        ? (active ? <EmptyState title="No entries match these filters." action={{ label: 'Clear filters', onClick: () => { setF(EMPTY); setQd('') } }} />
          : <EmptyState title="No activity yet." hint="Uploads, approvals and sign-ins are listed here as they happen." />)
        : <>
          <label className="mb-2 flex min-h-11 items-center gap-3 px-1 text-sm font-semibold">
            <input type="checkbox" className="size-5" checked={allShown} onChange={toggleAll} />Choose all {rows.length} shown
          </label>
          <ol className="grid gap-2">
            {rows.map(e => (
              <li key={e.id} className={`card flex items-start gap-3 text-sm ${picked.has(e.id) ? 'bg-tint' : ''}`}>
                <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={picked.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Choose entry ${e.id}: ${e.event}`} />
                <div className="min-w-0">
                  <p className="break-words font-semibold">{e.event}</p>
                  <p className="text-muted"><time dateTime={e.at}>{new Date(e.at).toLocaleString()}</time>, by {e.actor} · {moduleName(e.entity)} · {actionName(e.action)} · entry {e.id}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted">{rows.length} shown{more ? ', older entries available' : ''}</span>
            {more && <button type="button" className="btn" aria-disabled={loading || undefined} onClick={() => !loading && void load(rows[rows.length - 1].id)}>{loading ? 'Loading...' : 'Load older entries'}</button>}
          </div>
        </>}
    </>
  )
}

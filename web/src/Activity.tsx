import { useCallback, useEffect, useRef, useState } from 'react'
import { api, can, download, why } from './api'
import { EmptyState, PageHeader, Skeleton, msg } from './ui'
import { FilterBar, FilterSelect } from './kit'
import { useToast } from './Toast'
import { tx, txOr } from './strings'
import { locale } from './i18n'

// Activity log: filters (dates, person, module, action, words), newest first, older pages on demand, new rows every 4 s,
// and a download of only the ticked entries (or of everything that matches the filters) as CSV or PDF.
interface Entry { id: number; at: string; actor: string; entity: string; entity_id: string; event: string; action: 'created' | 'status' | 'other' }
interface Page { items: Entry[]; has_more: boolean }
interface Filters { from: string; to: string; actor: string; module: string; action: string; q: string }
const EMPTY: Filters = { from: '', to: '', actor: '', module: '', action: '', q: '' }
const PAGE = 100
const MAX_EXPORT = 1000

// Friendly names for the modules the log records (the table each entry is about). Unknown ones show their own name.
// (strings.ts, keys mod.<table>; unknown tables show their own name)
const ACTION_KEYS = ['created', 'status', 'other'] as const
const moduleName = (m: string) => txOr(`mod.${m}`, m.replace(/_/g, ' '))
const actionName = (a: string) => txOr(`act.a.${a}`, a)

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
          setAnnounce(tx('act.newEntries', d.items.length))
        }
        setChecked(new Date().toLocaleTimeString())
      } catch { /* the next tick tries again; the error banner is for the main load */ }
    }, 4000)
    return () => clearInterval(t)
  }, [key])  // eslint-disable-line react-hooks/exhaustive-deps

  const set = (p: Partial<Filters>) => setF(x => ({ ...x, ...p }))
  const active = Object.values(f).some(v => v.trim())
  const chips = [
    ...(f.from ? [{ label: tx('act.chip.from', f.from), onRemove: () => set({ from: '' }) }] : []),
    ...(f.to ? [{ label: tx('act.chip.to', f.to), onRemove: () => set({ to: '' }) }] : []),
    ...(f.actor ? [{ label: tx('act.chip.person', f.actor), onRemove: () => set({ actor: '' }) }] : []),
    ...(f.module ? [{ label: tx('act.chip.module', moduleName(f.module)), onRemove: () => set({ module: '' }) }] : []),
    ...(f.action ? [{ label: tx('act.chip.action', actionName(f.action)), onRemove: () => set({ action: '' }) }] : []),
    ...(f.q ? [{ label: tx('act.chip.words', f.q), onRemove: () => { set({ q: '' }); setQd('') } }] : []),
  ]
  const allShown = rows.length > 0 && rows.every(r => picked.has(r.id))
  const toggle = (id: number) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleAll = () => setPicked(allShown ? new Set() : new Set(rows.map(r => r.id)))

  const exportAs = async (format: 'csv' | 'pdf', chosen: boolean) => {
    if (busy) return
    if (chosen && picked.size > MAX_EXPORT) return setError(tx('act.tooMany', MAX_EXPORT))
    setBusy(`${chosen ? 'sel' : 'all'}-${format}`); setError('')
    const day = new Date().toISOString().slice(0, 10)
    try {
      const p = chosen ? `format=${format}&ids=${[...picked].join(',')}` : qs(filters, { format })
      await download(`/audit/export?${p}`, `activity-log-${day}.${format}`)
      toast(tx('act.downloaded', format.toUpperCase(), chosen ? picked.size : 0))
    } catch (e) { setError(msg(e)) } finally { setBusy('') }
  }

  return (
    <>
      <PageHeader title={tx('act.title')} description={tx('act.lead', checked)} />
      <p role="status" className="sr-only">{announce}</p>
      <FilterBar label={tx('act.filters')} search={{ value: f.q, onChange: v => set({ q: v }), label: tx('act.search') }} chips={chips}
        onClear={active ? () => { setF(EMPTY); setQd('') } : undefined}>
        <label className="input flex items-center gap-1 bg-surface py-0"><span className="text-muted">{tx('act.from')}:</span>
          <input type="date" className="min-w-0 bg-transparent py-1 font-medium text-ink" value={f.from} max={f.to || undefined} onChange={e => set({ from: e.target.value })} /></label>
        <label className="input flex items-center gap-1 bg-surface py-0"><span className="text-muted">{tx('act.to')}:</span>
          <input type="date" className="min-w-0 bg-transparent py-1 font-medium text-ink" value={f.to} min={f.from || undefined} onChange={e => set({ to: e.target.value })} /></label>
        <FilterSelect label={tx('act.person')} value={f.actor} onChange={v => set({ actor: v })}>
          <option value="">{tx('act.anyone')}</option>{facets.people.map(p => <option key={p} value={p}>{p}</option>)}
        </FilterSelect>
        <FilterSelect label={tx('act.module')} value={f.module} onChange={v => set({ module: v })}>
          <option value="">{tx('common.all')}</option>{facets.modules.map(m => <option key={m} value={m}>{moduleName(m)}</option>)}
        </FilterSelect>
        <FilterSelect label={tx('act.action')} value={f.action} onChange={v => set({ action: v })}>
          <option value="">{tx('common.any')}</option>{ACTION_KEYS.map(v => <option key={v} value={v}>{actionName(v)}</option>)}
        </FilterSelect>
      </FilterBar>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-card border border-hairline p-2" role="group" aria-label={tx('act.download')}>
        <span className="text-sm font-semibold">{picked.size ? tx('act.chosen', picked.size) : tx('act.noneChosen')}</span>
        {exportOk ? <>
          <button type="button" className="btn btn-primary" aria-disabled={!picked.size || !!busy || undefined} onClick={() => picked.size && exportAs('csv', true)}>{busy === 'sel-csv' ? tx('act.preparing') : tx('act.dlChosen', 'CSV')}</button>
          <button type="button" className="btn" aria-disabled={!picked.size || !!busy || undefined} onClick={() => picked.size && exportAs('pdf', true)}>{busy === 'sel-pdf' ? tx('act.preparing') : tx('act.dlChosen', 'PDF')}</button>
          <span className="text-sm text-muted">{tx('act.orAll', MAX_EXPORT)}</span>
          <button type="button" className="btn" aria-disabled={!!busy || !rows.length || undefined} onClick={() => rows.length && exportAs('csv', false)}>{busy === 'all-csv' ? tx('act.preparing') : tx('act.dlAll', 'CSV')}</button>
          <button type="button" className="btn" aria-disabled={!!busy || !rows.length || undefined} onClick={() => rows.length && exportAs('pdf', false)}>{busy === 'all-pdf' ? tx('act.preparing') : tx('act.dlAll', 'PDF')}</button>
        </> : <span className="text-sm text-muted">{tx('act.needExport', why('export_data'))}</span>}
      </div>

      {error && <div role="alert" className="card mb-3 border-warn bg-warn-bg text-warn"><p>{error}</p><button type="button" className="btn mt-3" onClick={() => void load()}>{tx('common.retry')}</button></div>}
      {loading && !rows.length ? <Skeleton rows={5} shape="text" /> : !rows.length && !error
        ? (active ? <EmptyState title={tx('act.noMatch')} action={{ label: tx('common.clearFilters'), onClick: () => { setF(EMPTY); setQd('') } }} />
          : <EmptyState title={tx('act.none')} hint={tx('act.noneHint')} />)
        : <>
          <label className="mb-2 flex min-h-11 items-center gap-3 px-1 text-sm font-semibold">
            <input type="checkbox" className="size-5" checked={allShown} onChange={toggleAll} />{tx('act.chooseAll', rows.length)}
          </label>
          <ol className="grid gap-2">
            {rows.map(e => (
              <li key={e.id} className={`card flex items-start gap-3 text-sm ${picked.has(e.id) ? 'bg-tint' : ''}`}>
                <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={picked.has(e.id)} onChange={() => toggle(e.id)} aria-label={tx('act.chooseOne', e.id, e.event)} />
                <div className="min-w-0">
                  <p className="break-words font-semibold">{e.event}</p>
                  <p className="text-muted"><time dateTime={e.at}>{new Date(e.at).toLocaleString(locale())}</time>, {tx('act.by', e.actor)} · {moduleName(e.entity)} · {actionName(e.action)} · {tx('act.entry', e.id)}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted">{tx('act.shownOlder', rows.length, more)}</span>
            {more && <button type="button" className="btn" aria-disabled={loading || undefined} onClick={() => !loading && void load(rows[rows.length - 1].id)}>{loading ? tx('common.loading') : tx('act.loadOlder')}</button>}
          </div>
        </>}
    </>
  )
}

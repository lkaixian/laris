import { useCallback, useEffect, useRef, useState } from 'react'
import { api, can, download, why } from './api'
import { EmptyState, PageHeader, Skeleton, msg } from './ui'
import { FilterBar, FilterSelect } from './kit'
import { useToast } from './Toast'
import { tx, txOr } from './strings'
import { locale } from './i18n'

// Audit log: grouped by Malaysian calendar day. The page shows only the days (simple buttons with a count); select a day to see its
// entries, select an entry to see its details (who, when, what changed). Filters sit behind one Filters button. Tick entries to
// download only those, or download everything that matches, as CSV or PDF.
interface Entry { id: number; at: string; actor: string; entity: string; entity_id: string; event: string; action: 'created' | 'status' | 'other' }
interface Full extends Entry { before: Record<string, unknown> | null; after: Record<string, unknown> | null }
interface Page { items: Entry[]; has_more: boolean }
interface Day { day: string; entries: number }
interface Filters { from: string; to: string; actor: string; module: string; action: string; q: string }
const EMPTY: Filters = { from: '', to: '', actor: '', module: '', action: '', q: '' }
const DAY_LIMIT = 500
const MAX_EXPORT = 1000
const TZ = 'Asia/Kuala_Lumpur'

const ACTION_KEYS = ['created', 'status', 'other'] as const
const moduleName = (m: string) => txOr(`mod.${m}`, m.replace(/_/g, ' '))
const actionName = (a: string) => txOr(`act.a.${a}`, a)
export const myDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
const dayLabel = (d: string) => {
  const today = myDay(new Date().toISOString())
  const yest = myDay(new Date(Date.now() - 864e5).toISOString())
  const long = new Date(`${d}T12:00:00+08:00`).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ })
  return d === today ? `${tx('act.today')}, ${long}` : d === yest ? `${tx('act.yesterday')}, ${long}` : long
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', timeZone: TZ })

const qs = (f: Partial<Filters>, extra: Record<string, string> = {}) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v?.trim()) p.set(k, v.trim())
  for (const [k, v] of Object.entries(extra)) p.set(k, v)
  return p.toString()
}

export function ActivityView() {
  const toast = useToast()
  const [f, setF] = useState<Filters>(EMPTY)
  const [qd, setQd] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [days, setDays] = useState<Day[]>([])
  const [byDay, setByDay] = useState<Record<string, Entry[]>>({})  // filled when a day is opened (or all at once when filtering)
  const [open, setOpen] = useState('')
  const [loading, setLoading] = useState(true)
  const [dayLoading, setDayLoading] = useState(false)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [detail, setDetail] = useState<number>()
  const [facets, setFacets] = useState<{ people: string[]; modules: string[] }>({ people: [], modules: [] })
  const [busy, setBusy] = useState('')
  const seq = useRef(0)
  const openRef = useRef('')
  openRef.current = open
  const filters = { ...f, q: qd }
  const active = Object.values(filters).some(v => v.trim())
  const key = qs(filters)
  const exportOk = can('export_data')
  const entriesRef = useRef<HTMLElement>(null)

  useEffect(() => { const t = setTimeout(() => setQd(f.q), 300); return () => clearTimeout(t) }, [f.q])
  useEffect(() => { api<{ people: string[]; modules: string[] }>('GET', '/audit/facets').then(setFacets, () => undefined) }, [])

  const fetchDay = async (d: string) => {
    const r = await api<Page>('GET', `/audit/search?${qs({ from: d, to: d }, { limit: String(DAY_LIMIT) })}`)
    setByDay(b => ({ ...b, [d]: r.items }))
  }

  // The days. With no filters the server counts them; with filters the matching entries (up to 500) are grouped here.
  const load = useCallback(async (quiet = false) => {
    const my = ++seq.current
    if (!quiet) { setLoading(true); setError('') }
    try {
      if (active) {
        const d = await api<Page>('GET', `/audit/search?${qs(filters, { limit: String(DAY_LIMIT) })}`)
        if (my !== seq.current) return
        const g: Record<string, Entry[]> = {}
        for (const e of d.items) (g[myDay(e.at)] ??= []).push(e)
        setByDay(g); setDays(Object.keys(g).sort().reverse().map(day => ({ day, entries: g[day].length })))
      } else {
        const d = await api<Day[]>('GET', '/audit/days')
        if (my !== seq.current) return
        setDays(d)
        if (quiet && openRef.current) await fetchDay(openRef.current)
        else setByDay({})
      }
      if (!quiet) setPicked(new Set())
    } catch (e) { if (my === seq.current && !quiet) setError(msg(e)) } finally { if (my === seq.current && !quiet) setLoading(false) }
  }, [key])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [load])
  useEffect(() => {  // keep the counts (and the open day) fresh while the page is open
    const t = setInterval(() => { if (!document.hidden) void load(true) }, 15000)
    return () => clearInterval(t)
  }, [load])

  // #/activity?day=YYYY-MM-DD (from the Home timeline) opens that day once the days have loaded.
  const asked = useRef(new URLSearchParams(location.hash.split('?')[1] ?? '').get('day') ?? '')
  useEffect(() => {
    if (asked.current && days.some(x => x.day === asked.current)) { const d = asked.current; asked.current = ''; void openDay(d) }
  }, [days])  // eslint-disable-line react-hooks/exhaustive-deps

  const openDay = async (d: string) => {
    if (open === d) return setOpen('')
    setOpen(d)
    if (!active && !byDay[d]) {
      setDayLoading(true)
      try { await fetchDay(d) } catch (e) { setError(msg(e)) } finally { setDayLoading(false) }
    }
    if (matchMedia('(max-width: 767px)').matches) requestAnimationFrame(() => entriesRef.current?.scrollIntoView({ block: 'start' }))
  }

  const set = (p: Partial<Filters>) => { setF(x => ({ ...x, ...p })); setOpen('') }
  const clear = () => { setF(EMPTY); setQd(''); setOpen('') }
  const chips = [
    ...(f.from ? [{ label: tx('act.chip.from', f.from), onRemove: () => set({ from: '' }) }] : []),
    ...(f.to ? [{ label: tx('act.chip.to', f.to), onRemove: () => set({ to: '' }) }] : []),
    ...(f.actor ? [{ label: tx('act.chip.person', f.actor), onRemove: () => set({ actor: '' }) }] : []),
    ...(f.module ? [{ label: tx('act.chip.module', moduleName(f.module)), onRemove: () => set({ module: '' }) }] : []),
    ...(f.action ? [{ label: tx('act.chip.action', actionName(f.action)), onRemove: () => set({ action: '' }) }] : []),
    ...(f.q ? [{ label: tx('act.chip.words', f.q), onRemove: () => { set({ q: '' }); setQd('') } }] : []),
  ]
  const rows = open ? byDay[open] ?? [] : []
  const allShown = rows.length > 0 && rows.every(r => picked.has(r.id))
  const toggle = (id: number) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleAll = () => setPicked(p => { const n = new Set(p); rows.forEach(r => allShown ? n.delete(r.id) : n.add(r.id)); return n })

  // "All matching": the filters, or with no filters the open day.
  const exportAs = async (format: 'csv' | 'pdf', chosen: boolean) => {
    if (busy) return
    if (chosen && picked.size > MAX_EXPORT) return setError(tx('act.tooMany', MAX_EXPORT))
    setBusy(`${chosen ? 'sel' : 'all'}-${format}`); setError('')
    const today = new Date().toISOString().slice(0, 10)
    try {
      const p = chosen ? `format=${format}&ids=${[...picked].join(',')}` : qs(active ? filters : { from: open, to: open }, { format })
      await download(`/audit/export?${p}`, `audit-log-${today}.${format}`)
      toast(tx('act.downloaded', format.toUpperCase(), chosen ? picked.size : 0))
    } catch (e) { setError(msg(e)) } finally { setBusy('') }
  }

  return (
    <>
      <PageHeader title={tx('act.title')} description={tx('act.lead2')}
        actions={<div className="flex flex-wrap gap-2" data-guide="act-filters">
          <button type="button" className={`btn ${showFilters || active ? 'btn-primary' : ''}`} aria-expanded={showFilters} aria-controls="act-filters" onClick={() => setShowFilters(!showFilters)}>
            {tx('act.filtersBtn')}{active ? ` (${chips.length})` : ''}</button>
          <button type="button" className="btn" onClick={() => void load()}>{tx('act.refresh')}</button>
        </div>} />

      {(showFilters || active) && <div id="act-filters">
        <FilterBar label={tx('act.filters')} search={{ value: f.q, onChange: v => set({ q: v }), label: tx('act.search') }} chips={chips} onClear={active ? clear : undefined}>
          {showFilters && <>
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
          </>}
        </FilterBar>
      </div>}

      {error && <div role="alert" className="card mb-3 border-warn bg-warn-bg text-warn"><p>{error}</p><button type="button" className="btn mt-3" onClick={() => void load()}>{tx('common.retry')}</button></div>}
      {loading && !days.length ? <Skeleton rows={5} shape="text" /> : !days.length && !error
        ? (active ? <EmptyState title={tx('act.noMatch')} action={{ label: tx('common.clearFilters'), onClick: clear }} />
          : <EmptyState title={tx('act.none')} hint={tx('act.noneHint')} />)
        : (
          <div className="grid gap-4 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
            <nav aria-label={tx('act.days')} data-guide="act-days">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{tx('act.days')}</h2>
              <ul className="grid gap-2">
                {days.map(d => (
                  <li key={d.day}>
                    <button type="button" aria-pressed={open === d.day} onClick={() => void openDay(d.day)}
                      className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-ui border px-3 py-2 text-left text-sm transition-colors ${open === d.day ? 'border-accent bg-tint font-semibold' : 'border-hairline bg-surface hover:border-accent'}`}>
                      <span className="min-w-0 break-words">{dayLabel(d.day)}</span>
                      <span className="shrink-0 rounded-full bg-hairline px-2 py-0.5 text-xs tabular-nums text-ink">{tx('act.dayCount', d.entries)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            <section ref={entriesRef} aria-labelledby="act-day-h" className="min-w-0 scroll-mt-20">
              {!open ? <p id="act-day-h" className="card text-sm text-muted">{tx('act.pickDay')}</p> : <>
                <h2 id="act-day-h" className="mb-2 text-md font-semibold">{tx('act.dayTitle', dayLabel(open), rows.length)}</h2>
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-card border border-hairline p-2" role="group" aria-label={tx('act.download')}>
                  <span className="text-sm font-semibold">{picked.size ? tx('act.chosen', picked.size) : tx('act.noneChosen')}</span>
                  {exportOk ? <>
                    <button type="button" className="btn btn-primary" aria-disabled={!picked.size || !!busy || undefined} onClick={() => picked.size && exportAs('csv', true)}>{busy === 'sel-csv' ? tx('act.preparing') : tx('act.dlChosen', 'CSV')}</button>
                    <button type="button" className="btn" aria-disabled={!picked.size || !!busy || undefined} onClick={() => picked.size && exportAs('pdf', true)}>{busy === 'sel-pdf' ? tx('act.preparing') : tx('act.dlChosen', 'PDF')}</button>
                    <button type="button" className="btn" aria-disabled={!!busy || !rows.length || undefined} onClick={() => rows.length && exportAs('csv', false)}>{busy === 'all-csv' ? tx('act.preparing') : tx('act.dlAll', 'CSV')}</button>
                    <button type="button" className="btn" aria-disabled={!!busy || !rows.length || undefined} onClick={() => rows.length && exportAs('pdf', false)}>{busy === 'all-pdf' ? tx('act.preparing') : tx('act.dlAll', 'PDF')}</button>
                  </> : <span className="text-sm text-muted">{tx('act.needExport', why('export_data'))}</span>}
                </div>
                {dayLoading ? <Skeleton rows={4} shape="text" /> : <>
                  <label className="mb-1 flex min-h-11 items-center gap-3 px-1 text-sm font-semibold">
                    <input type="checkbox" className="size-5" checked={allShown} onChange={toggleAll} />{tx('act.chooseAll', rows.length)}
                  </label>
                  <ol className="grid gap-1.5">
                    {rows.map(e => (
                      <li key={e.id} className={`flex items-center gap-2 rounded-ui border border-hairline pl-3 ${picked.has(e.id) ? 'bg-tint' : 'bg-surface'}`}>
                        <input type="checkbox" className="size-5 shrink-0" checked={picked.has(e.id)} onChange={() => toggle(e.id)} aria-label={tx('act.chooseOne', e.id, e.event)} />
                        <button type="button" className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-ui px-2 py-2 text-left text-sm hover:bg-tint" onClick={() => setDetail(e.id)}>
                          <time dateTime={e.at} className="w-14 shrink-0 tabular-nums text-muted">{timeOf(e.at)}</time>
                          <span className="min-w-0 flex-1 break-words font-semibold">{e.event}</span>
                          <span className="hidden shrink-0 text-muted sm:inline">{e.actor}</span>
                          <span aria-hidden="true" className="shrink-0 text-muted">&rsaquo;</span>
                          <span className="sr-only">{tx('act.open', e.id)}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                  {rows.length >= DAY_LIMIT && <p className="mt-2 text-sm text-muted">{tx('act.shownOlder', rows.length, true)}</p>}
                </>}
              </>}
            </section>
          </div>
        )}
      {detail !== undefined && <EntryDialog id={detail} onClose={() => setDetail(undefined)} />}
    </>
  )
}

const show = (v: unknown) => v === null || v === undefined || v === '' ? tx('act.empty') : typeof v === 'object' ? JSON.stringify(v) : String(v)

function EntryDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [d, setD] = useState<Full>()
  const [err, setErr] = useState('')
  useEffect(() => { const x = ref.current; if (x && !x.open) x.showModal() }, [])
  useEffect(() => { api<Full>('GET', `/audit/${id}`).then(setD, e => setErr(msg(e))) }, [id])
  const keys = d ? [...new Set([...Object.keys(d.before ?? {}), ...Object.keys(d.after ?? {})])].filter(k => show(d.before?.[k]) !== show(d.after?.[k])) : []
  return (
    <dialog ref={ref} aria-labelledby="ent-h" onCancel={e => { e.preventDefault(); onClose() }} onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-card bg-surface p-0 text-ink shadow-3 backdrop:bg-ink/50">
      <div className="flex items-start justify-between gap-3 border-b border-hairline p-4">
        <h2 id="ent-h" className="text-md font-semibold">{tx('act.details')}<span className="ml-2 text-sm font-normal text-muted">{tx('act.entry', id)}</span></h2>
        <button type="button" className="btn" onClick={onClose} autoFocus>{tx('as.close')}</button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto p-4 text-sm">
        {err ? <p role="alert" className="text-warn">{err}</p> : !d ? <Skeleton rows={4} shape="text" /> : <>
          <p className="mb-3 break-words text-base font-semibold">{d.event}</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
            <dt className="text-muted">{tx('act.when')}</dt><dd><time dateTime={d.at}>{new Date(d.at).toLocaleString(locale(), { timeZone: TZ })}</time></dd>
            <dt className="text-muted">{tx('act.who')}</dt><dd className="break-words">{d.actor}</dd>
            <dt className="text-muted">{tx('act.module')}</dt><dd>{moduleName(d.entity)}</dd>
            <dt className="text-muted">{tx('act.action')}</dt><dd>{actionName(d.action)}</dd>
            <dt className="text-muted">{tx('act.record')}</dt><dd className="break-all font-mono text-xs">{d.entity_id}</dd>
          </dl>
          <h3 className="mt-4 mb-2 font-semibold">{tx('act.changes')}</h3>
          {keys.length === 0 ? <p className="text-muted">{tx('act.noChanges')}</p> : (
            <table className="w-full table-fixed border-collapse text-left">
              <thead><tr className="border-b border-hairline text-muted"><th scope="col" className="w-1/4 py-1 pr-2 font-semibold">{tx('act.field')}</th><th scope="col" className="py-1 pr-2 font-semibold">{tx('act.before')}</th><th scope="col" className="py-1 font-semibold">{tx('act.after')}</th></tr></thead>
              <tbody>{keys.map(k => (
                <tr key={k} className="border-b border-hairline align-top">
                  <th scope="row" className="py-1.5 pr-2 font-semibold break-words">{k.replace(/_/g, ' ')}</th>
                  <td className="py-1.5 pr-2 break-words text-muted">{show(d.before?.[k])}</td>
                  <td className="py-1.5 break-words">{show(d.after?.[k])}</td>
                </tr>))}</tbody>
            </table>
          )}
        </>}
      </div>
    </dialog>
  )
}

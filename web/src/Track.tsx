import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import { ActionError, EmptyState, HEAT, HeatChip, HeatLegend, heatName, OverdueChip, PageHeader, Skeleton, Status, TableRegion, msg, rm, stageLabel } from './ui'
import { DataTable, FilterBar, FilterSelect, Tabs, ToggleChip } from './kit'
import type { Col } from './kit'
import type { Heat } from './ui'
import { Icon } from './icons'
import type { IconName } from './icons'

// Track page (#/track): everything in flight, inbound and outbound, from GET /api/track (docs/tracker.md).
export type Kind = 'quote' | 'supplier_doc' | 'rfq' | 'listing'
interface Item {
  kind: Kind; id: string; ref: string; party: string; status: string; stage_label: string; since: string; days_in_stage: number
  overdue: boolean; overdue_reason: string | null; due_on: string | null; total: string | null; link: string; heat?: Heat | null
}
type Counts = Record<'outbound' | 'inbound' | 'rfq' | 'listing', Record<string, number>>
interface TrackData { items: Item[]; counts?: Partial<Counts>; overdue_total?: number; heat_counts?: Partial<Record<Heat, number>>; has_more?: boolean; stats?: Record<string, { avg_days: number; n: number }> }

const KINDS: [string, string][] = [['all', 'All'], ['quote', 'Quotes'], ['supplier_doc', 'Supplier documents'], ['rfq', 'Asks'], ['listing', 'Catalog']]
const KIND_INFO: Record<Kind, { label: string; icon: IconName }> = {
  quote: { label: 'Customer quote', icon: 'tracker' }, supplier_doc: { label: 'Supplier document', icon: 'upload' },
  rfq: { label: 'Ask to suppliers', icon: 'ask' }, listing: { label: 'Catalog item', icon: 'camera' },
}
// counts group -> the `kind` filter that shows it
const GROUPS: [keyof Counts, Kind][] = [['outbound', 'quote'], ['inbound', 'supplier_doc'], ['rfq', 'rfq'], ['listing', 'listing']]
const BOARD = ['draft', 'approved', 'sent', 'read', 'accepted', 'job_created']  // outbound columns of the board
const PAGE = 20
const sum = (o?: Record<string, number>) => Object.values(o ?? {}).reduce((a, b) => a + b, 0)
const when = (d: string) => new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

// Query part of the hash ("#/track?overdue=1&kind=rfq"). Unknown or malformed parameters are ignored by the callers.
export function hashParams(): URLSearchParams { try { return new URLSearchParams(location.hash.split('?')[1] ?? '') } catch { return new URLSearchParams() } }
export const flagOn = (p: URLSearchParams, k: string) => p.has(k) && !['0', 'false'].includes(p.get(k) ?? '')

interface Filters { kind: string; stage: string; overdue: boolean; q: string; view: 'list' | 'board'; heat: string }
let saved: Filters = { kind: 'all', stage: '', overdue: false, q: '', view: 'list', heat: '' }  // kept for this visit, like the other filters
const initial = (): Filters => {
  const p = hashParams()
  if (![...p.keys()].some(k => ['kind', 'stage', 'overdue', 'q', 'heat'].includes(k))) return saved
  const kind = p.get('kind') ?? 'all'
  return { ...saved, kind: KINDS.some(k => k[0] === kind) ? kind : 'all', stage: /^[a-z_]{1,24}$/.test(p.get('stage') ?? '') ? p.get('stage')! : '', overdue: flagOn(p, 'overdue'), q: (p.get('q') ?? '').slice(0, 100), heat: HEAT.some(h => h[0] === p.get('heat')) ? p.get('heat')! : '' }
}

function Open({ i }: { i: Item }) {
  return <a href={i.link}>{i.ref}<span className="sr-only"> ({KIND_INFO[i.kind]?.label ?? i.kind} for {i.party})</span></a>
}
const KindIcon = ({ k }: { k: Kind }) => <span title={KIND_INFO[k]?.label ?? k}><Icon name={KIND_INFO[k]?.icon ?? 'tracker'} className="size-4 text-muted" /><span className="sr-only">{KIND_INFO[k]?.label ?? k}</span></span>
const Stage = ({ i }: { i: Item }) => <span className="inline-flex flex-wrap items-center gap-1"><Status v={i.status} />{i.overdue && <OverdueChip reason={i.overdue_reason} />}</span>

const COLS: Col<Item>[] = [
  { key: 'ref', head: 'Reference', cell: i => <Open i={i} />, mobile: 'title', className: 'min-w-[8.5rem]' },
  { key: 'party', head: 'Party', cell: i => i.party, mobile: 'sub' },
  { key: 'kind', head: 'Kind', cell: i => <KindIcon k={i.kind} /> },
  { key: 'stage', head: 'Stage', cell: i => <Stage i={i} />, mobile: 'badge' },
  { key: 'time', head: 'Time in stage', cell: i => <HeatChip heat={i.heat} days={i.days_in_stage} />, mobile: 'meta', className: 'whitespace-nowrap' },
  { key: 'due', head: 'Due', cell: i => i.due_on ? when(i.due_on) : <span className="text-muted">None</span>, mobile: 'meta', className: 'whitespace-nowrap tabular-nums' },
  { key: 'total', head: 'Total', cell: i => i.total == null ? <span aria-hidden="true">-</span> : rm(i.total), num: true, mobile: 'meta' },
]

function Board({ items, counts, kind, more }: { items: Item[]; counts?: Partial<Counts>; kind: string; more: boolean }) {
  const quotes = items.filter(i => i.kind === 'quote')
  if (kind !== 'all' && kind !== 'quote') return <p className="card text-muted">The board shows customer quotes. Set Kind to All or Quotes to use it.</p>
  return (
    <>
      <p className="mb-2 text-sm text-muted">The board shows the first {quotes.length} customer {quotes.length === 1 ? 'quote' : 'quotes'} that match the filters{more ? ' (use Load more below for the rest)' : ''}. The number in each heading counts all quotes in that stage.</p>
      <div className="relative max-w-full overflow-x-auto pb-2" role="region" aria-label="Quote board" tabIndex={0}>
        <div className="grid min-w-max auto-cols-[16rem] grid-flow-col gap-2">
          {BOARD.map(st => {
            const list = quotes.filter(i => i.status === st)
            const total = counts?.outbound?.[st]
            return (
              <section key={st} aria-labelledby={`board-${st}`} className="rounded-card bg-surface-2 p-2">
                <h3 id={`board-${st}`} className="mb-2 flex items-center gap-2 text-sm font-semibold"><Status v={st} /><span className="font-normal text-muted">{total ?? list.length}{total != null && total !== list.length ? `, ${list.length} shown` : ''}</span></h3>
                {list.length ? (
                  <ul className="grid gap-2">
                    {list.map(i => (
                      <li key={i.id}>
                        <a href={i.link} className={`card group block p-3 text-sm hover:bg-surface-2 ${i.heat ? `heat-edge heat-${i.heat}` : ''}`}>
                          <span className="block font-semibold group-hover:underline">{i.ref}</span>
                          <span className="block">{i.party}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-1 text-muted"><HeatChip heat={i.heat} days={i.days_in_stage} /> in stage{i.total != null && <> · {rm(i.total)}</>}</span>
                          {i.overdue && <span className="mt-1 block"><OverdueChip reason={i.overdue_reason} /></span>}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted">None shown</p>}
              </section>
            )
          })}
        </div>
      </div>
    </>
  )
}

function Stats({ stats }: { stats: NonNullable<TrackData['stats']> }) {
  const rows = Object.entries(stats)
  if (!rows.length) return null
  return (
    <details className="mt-6">
      <summary className="inline-flex min-h-(--control-h) cursor-pointer items-center text-sm font-semibold">Stage timings, last 90 days</summary>
      <div className="mt-2">
        <TableRegion label="Stage averages">
          <table className="w-full">
            <thead><tr><th scope="col">Stage</th><th scope="col" className="text-right">Average days</th><th scope="col" className="text-right">Items</th></tr></thead>
            <tbody>{rows.map(([st, v]) => <tr key={st}><th scope="row" className="font-normal">{stageLabel(st)}</th><td className="num">{Number(v.avg_days).toLocaleString('en-MY', { maximumFractionDigits: 1 })}</td><td className="num">{v.n}</td></tr>)}</tbody>
          </table>
        </TableRegion>
      </div>
    </details>
  )
}

export function TrackView() {
  const [f, setF] = useState<Filters>(initial)
  const set = (p: Partial<Filters>) => setF(x => { saved = { ...x, ...p }; return saved })
  const [qd, setQd] = useState(f.q)  // debounced search text
  // Same page, new hash (Back/Forward or a link to #/track?...): apply the parameters again.
  useEffect(() => { const h = () => { const n = initial(); if (n !== saved || hashParams().size) { saved = n; setF(n); setQd(n.q) } }; addEventListener('hashchange', h); return () => removeEventListener('hashchange', h) }, [])
  useEffect(() => { const t = setTimeout(() => setQd(f.q), 300); return () => clearTimeout(t) }, [f.q])
  const [data, setData] = useState<TrackData>()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [err, setErr] = useState<{ text: string; retry: boolean }>()
  const [stages, setStages] = useState<string[]>([])
  const seq = useRef(0)
  const load = useCallback(async (offset: number) => {
    const my = ++seq.current
    setLoading(true); setErr(undefined)
    const p = new URLSearchParams({ kind: f.kind, limit: String(PAGE), offset: String(offset) })
    if (f.stage) p.set('stage', f.stage)
    if (f.overdue) p.set('overdue', '1')
    if (qd.trim()) p.set('q', qd.trim())
    if (f.heat) p.set('heat', f.heat)
    try {
      const d = await api<TrackData>('GET', `/track?${p}`)
      if (my !== seq.current) return
      const list = Array.isArray(d?.items) ? d.items : []
      setData(d); setItems(x => offset ? [...x, ...list] : list); setMore(!!d?.has_more)
      const c = d?.counts ?? {}
      setStages(s => [...new Set([...s, ...Object.values(c).flatMap(g => Object.keys(g ?? {}))])])
    } catch (e) { if (my === seq.current) setErr({ text: msg(e), retry: true }) } finally { if (my === seq.current) setLoading(false) }
  }, [f.kind, f.stage, f.overdue, f.heat, qd])
  useEffect(() => { void load(0) }, [load])
  useEffect(() => { const h = () => { if (err) void load(0) }; addEventListener('laris:online', h); return () => removeEventListener('laris:online', h) }, [err, load])

  const active = f.kind !== 'all' || !!f.stage || f.overdue || !!f.q || !!f.heat
  const reset = () => { set({ kind: 'all', stage: '', overdue: false, q: '', heat: '' }); setQd('') }
  const counts = data?.counts
  const kindName = KINDS.find(k => k[0] === f.kind)?.[1] ?? f.kind
  const tabs = KINDS.map(([v, t]) => {
    const n = counts ? (v === 'all' ? GROUPS.reduce((a, [g]) => a + sum(counts[g]), 0) : sum(counts[GROUPS.find(g => g[1] === v)![0]])) : undefined
    return { value: v, label: t, count: n }
  })
  const chips = [
    ...(f.kind !== 'all' ? [{ label: `Kind: ${kindName}`, onRemove: () => set({ kind: 'all' }) }] : []),
    ...(f.stage ? [{ label: `Stage: ${f.stage === 'open' ? 'Open' : stageLabel(f.stage)}`, onRemove: () => set({ stage: '' }) }] : []),
    ...(f.overdue ? [{ label: 'Overdue only', onRemove: () => set({ overdue: false }) }] : []),
    ...(f.heat ? [{ label: `Age: ${heatName(f.heat as Heat)}`, onRemove: () => set({ heat: '' }) }] : []),
    ...(f.q ? [{ label: `Search: ${f.q}`, onRemove: () => { set({ q: '' }); setQd('') } }] : []),
  ]
  let body: ReactNode
  if (err) body = null
  else if (loading && !items.length) body = <Skeleton rows={8} shape="table" />
  else if (!items.length) body = active
    ? <EmptyState title="No items match these filters." action={{ label: 'Clear filters', onClick: reset }} />
    : <EmptyState title="Nothing is waiting." hint="Quotes, supplier documents, asks and catalog items show here while they are in flight." />
  else if (f.view === 'board') body = <Board items={items} counts={counts} kind={f.kind} more={more} />
  else body = <DataTable label="Tracked items" caption="Items in flight, overdue first" rows={items} rowKey={i => i.kind + i.id} cols={COLS} />

  return (
    <>
      <PageHeader title="Track" description="Everything in flight, how long it has been in its stage, and what is overdue." />
      <Tabs label="Kind" value={f.kind} options={tabs} onChange={v => set({ kind: v })} />
      <FilterBar label="Track filters" search={{ value: f.q, onChange: v => set({ q: v }), label: 'Search party or reference' }} chips={chips} onClear={reset}
        right={<>
          <ToggleChip pressed={f.view === 'list'} onClick={() => set({ view: 'list' })}><Icon name="tracker" className="size-4" />List</ToggleChip>
          <ToggleChip pressed={f.view === 'board'} onClick={() => set({ view: 'board' })}><Icon name="pipeline" className="size-4" />Board</ToggleChip>
        </>}>
        <FilterSelect label="Stage" value={f.stage} onChange={v => set({ stage: v })}>
          <option value="">Any</option><option value="open">Open (not finished)</option>
          {[...new Set([...stages, ...(f.stage && f.stage !== 'open' ? [f.stage] : [])])].sort().map(s => <option key={s} value={s}>{stageLabel(s)}</option>)}
        </FilterSelect>
        <FilterSelect label="Age" value={f.heat} onChange={v => set({ heat: v })}>
          <option value="">Any</option>
          {HEAT.map(([h, name, range]) => <option key={h} value={h}>{name}, {range}{data?.heat_counts ? ` (${data.heat_counts[h] ?? 0})` : ''}</option>)}
        </FilterSelect>
        <ToggleChip pressed={f.overdue} warn={(data?.overdue_total ?? 0) > 0} onClick={() => set({ overdue: !f.overdue })}>
          {(data?.overdue_total ?? 0) > 0 && <Icon name="warn" className="size-4" />}Overdue <span className="tabular-nums">{data?.overdue_total ?? 0}</span>
        </ToggleChip>
      </FilterBar>

      <div className="mb-3"><HeatLegend counts={data?.heat_counts} /></div>
      <p role="status" className="sr-only">{!loading && !err ? `${items.length} ${items.length === 1 ? 'item' : 'items'} shown${more ? ', more available' : ''}` : ''}</p>
      <ActionError err={err} onRetry={() => void load(0)} label="Retry loading" />
      {body}
      {items.length > 0 && !err && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted">{items.length} shown{more ? ', more available' : ''}</span>
          {more && <button type="button" className="btn" aria-disabled={loading || undefined} onClick={() => { if (!loading) void load(items.length) }}>{loading ? 'Loading...' : 'Load more'}</button>}
        </div>
      )}
      {data?.stats && <Stats stats={data.stats} />}
    </>
  )
}

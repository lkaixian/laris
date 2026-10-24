import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import { ActionError, EmptyState, PageHeader, Skeleton, TableRegion, msg, rm } from './ui'
import { Icon } from './icons'
import type { IconName } from './icons'

// Track page (#/track): everything in flight, inbound and outbound, from GET /api/track (docs/tracker.md).
export type Kind = 'quote' | 'supplier_doc' | 'rfq' | 'listing'
interface Item {
  kind: Kind; id: string; ref: string; party: string; status: string; stage_label: string; since: string; days_in_stage: number
  overdue: boolean; overdue_reason: string | null; due_on: string | null; total: string | null; link: string
}
type Counts = Record<'outbound' | 'inbound' | 'rfq' | 'listing', Record<string, number>>
interface TrackData { items: Item[]; counts?: Partial<Counts>; overdue_total?: number; has_more?: boolean; stats?: Record<string, { avg_days: number; n: number }> }

const KINDS: [string, string][] = [['all', 'All'], ['quote', 'Quotes'], ['supplier_doc', 'Supplier documents'], ['rfq', 'Asks'], ['listing', 'Catalog']]
const KIND_INFO: Record<Kind, { label: string; icon: IconName }> = {
  quote: { label: 'Customer quote', icon: 'tracker' }, supplier_doc: { label: 'Supplier document', icon: 'upload' },
  rfq: { label: 'Ask to suppliers', icon: 'ask' }, listing: { label: 'Catalog item', icon: 'camera' },
}
// counts group -> the `kind` filter that shows it, and its heading in the summary strip
const GROUPS: [keyof Counts, Kind, string][] = [['outbound', 'quote', 'Customer quotes'], ['inbound', 'supplier_doc', 'Supplier documents'], ['rfq', 'rfq', 'Asks'], ['listing', 'listing', 'Catalog']]
const LABELS: Record<string, string> = {
  received: 'Received', draft: 'Draft', parsed: 'Parsed', reviewed: 'Reviewed', accepted: 'Accepted', in_cost_book: 'In cost book', approved: 'Approved', sent: 'Sent', read: 'Opened by customer',
  job_created: 'Job created', expired: 'Expired', rejected: 'Rejected', cancelled: 'Cancelled', superseded: 'Superseded', waiting: 'Waiting for supplier', needs_review: 'Needs review', ready: 'Ready',
  confirmed: 'Confirmed', discarded: 'Discarded',
}
export const stageLabel = (s: string) => LABELS[s] ?? s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
const BOARD = ['draft', 'approved', 'sent', 'read', 'accepted', 'job_created']  // outbound columns of the board
const PAGE = 20
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

// Query part of the hash ("#/track?overdue=1&kind=rfq"). Unknown or malformed parameters are ignored by the callers.
export function hashParams(): URLSearchParams { try { return new URLSearchParams(location.hash.split('?')[1] ?? '') } catch { return new URLSearchParams() } }
export const flagOn = (p: URLSearchParams, k: string) => p.has(k) && !['0', 'false'].includes(p.get(k) ?? '')

interface Filters { kind: string; stage: string; overdue: boolean; q: string; view: 'list' | 'board' }
let saved: Filters = { kind: 'all', stage: '', overdue: false, q: '', view: 'list' }  // kept for this visit, like the other filters
const initial = (): Filters => {
  const p = hashParams()
  if (![...p.keys()].some(k => ['kind', 'stage', 'overdue', 'q'].includes(k))) return saved
  const kind = p.get('kind') ?? 'all'
  return { ...saved, kind: KINDS.some(k => k[0] === kind) ? kind : 'all', stage: /^[a-z_]{1,24}$/.test(p.get('stage') ?? '') ? p.get('stage')! : '', overdue: flagOn(p, 'overdue'), q: (p.get('q') ?? '').slice(0, 100) }
}

function Why({ i }: { i: Item }) {
  return i.overdue ? <span className="badge badge-warn">Overdue{i.overdue_reason ? `: ${i.overdue_reason}` : ''}</span> : null
}
function Open({ i }: { i: Item }) {
  return <a className="link" href={i.link}>{i.ref}<span className="sr-only"> ({KIND_INFO[i.kind]?.label ?? i.kind} for {i.party})</span></a>
}
const KindTag = ({ k }: { k: Kind }) => <span className="inline-flex items-center gap-1 whitespace-nowrap"><Icon name={KIND_INFO[k]?.icon ?? 'tracker'} className="size-4" />{KIND_INFO[k]?.label ?? k}</span>
const Total = ({ t }: { t: string | null }) => t == null ? <span aria-hidden="true">-</span> : <>{rm(t)}</>

function ItemCard({ i }: { i: Item }) {
  return (
    <li className="card">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 font-semibold"><Open i={i} /><span className="text-sm font-normal text-muted"><KindTag k={i.kind} /></span></p>
      <p className="text-sm">{i.party}</p>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm"><span className="badge">{i.stage_label}</span><span>{days(i.days_in_stage)} in stage</span></p>
      {i.overdue && <p className="mt-1"><Why i={i} /></p>}
      <p className="mt-1 text-sm text-muted">{i.due_on ? `Due ${i.due_on}` : 'No due date'}{i.total != null && <> · Total {rm(i.total)}</>}</p>
    </li>
  )
}

function ItemTable({ items }: { items: Item[] }) {
  return (
    <TableRegion label="Tracked items">
      <table className="w-full">
        <caption className="sr-only">Items in flight, overdue first</caption>
        <thead><tr><th scope="col">Reference</th><th scope="col">Party</th><th scope="col">Kind</th><th scope="col">Stage</th><th scope="col">Time in stage</th><th scope="col">Due</th><th scope="col">Total</th></tr></thead>
        <tbody>
          {items.map(i => (
            <tr key={i.kind + i.id}>
              <td className="min-w-[8.5rem] font-semibold"><Open i={i} /></td>
              <td>{i.party}</td>
              <td className="text-sm"><KindTag k={i.kind} /></td>
              <td><span className="badge">{i.stage_label}</span>{i.overdue && <div className="mt-1"><Why i={i} /></div>}</td>
              <td className="whitespace-nowrap">{days(i.days_in_stage)}</td>
              <td className="whitespace-nowrap">{i.due_on ?? <span className="text-muted">None</span>}</td>
              <td className="whitespace-nowrap tabular-nums"><Total t={i.total} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableRegion>
  )
}

function Board({ items, counts, kind, more }: { items: Item[]; counts?: Partial<Counts>; kind: string; more: boolean }) {
  const quotes = items.filter(i => i.kind === 'quote')
  if (kind !== 'all' && kind !== 'quote') return <p className="card text-muted">The board shows customer quotes. Set Kind to All or Quotes to use it.</p>
  return (
    <>
      <p className="mb-2 text-sm text-muted">The board shows the first {quotes.length} customer {quotes.length === 1 ? 'quote' : 'quotes'} that match the filters{more ? ' (use Load more below for the rest)' : ''}. The number in each heading counts all quotes in that stage.</p>
      <div className="relative max-w-full overflow-x-auto pb-2" role="region" aria-label="Quote board" tabIndex={0}>
        <div className="grid min-w-max auto-cols-[16rem] grid-flow-col gap-3">
          {BOARD.map(st => {
            const list = quotes.filter(i => i.status === st)
            const total = counts?.outbound?.[st]
            return (
              <section key={st} aria-labelledby={`board-${st}`} className="rounded-ui border border-soft bg-soft/40 p-2">
                <h3 id={`board-${st}`} className="mb-2 text-sm font-semibold">{stageLabel(st)} <span className="font-normal text-muted">({total ?? list.length}{total != null && total !== list.length ? `, ${list.length} shown` : ''})</span></h3>
                {list.length ? (
                  <ul className="grid gap-2">
                    {list.map(i => (
                      <li key={i.id}>
                        <a href={i.link} className="card block text-sm hover:bg-tint">
                          <span className="block font-semibold text-accent underline underline-offset-2">{i.ref}</span>
                          <span className="block">{i.party}</span>
                          <span className="block text-muted">{days(i.days_in_stage)} in stage{i.total != null && <> · {rm(i.total)}</>}</span>
                          {i.overdue && <span className="badge badge-warn mt-1">Overdue{i.overdue_reason ? `: ${i.overdue_reason}` : ''}</span>}
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
    <section aria-labelledby="trk-stats" className="mt-6">
      <h2 id="trk-stats" className="mb-1 text-lg font-semibold">Average days per stage</h2>
      <p className="mb-2 text-sm text-muted">Over the last 90 days.</p>
      <TableRegion label="Stage averages">
        <table className="w-full">
          <thead><tr><th scope="col">Stage</th><th scope="col" className="text-right">Average days</th><th scope="col" className="text-right">Items</th></tr></thead>
          <tbody>{rows.map(([st, v]) => <tr key={st}><th scope="row" className="font-normal">{stageLabel(st)}</th><td className="text-right tabular-nums">{Number(v.avg_days).toLocaleString('en-MY', { maximumFractionDigits: 1 })}</td><td className="text-right tabular-nums">{v.n}</td></tr>)}</tbody>
        </table>
      </TableRegion>
    </section>
  )
}

function Seg({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap gap-1">
      {options.map(([v, t]) => <button key={v} type="button" className={`btn ${value === v ? 'bg-tint' : ''}`} aria-pressed={value === v} onClick={() => onChange(v)}>{t}</button>)}
    </div>
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
    try {
      const d = await api<TrackData>('GET', `/track?${p}`)
      if (my !== seq.current) return
      const list = Array.isArray(d?.items) ? d.items : []
      setData(d); setItems(x => offset ? [...x, ...list] : list); setMore(!!d?.has_more)
      const c = d?.counts ?? {}
      setStages(s => [...new Set([...s, ...Object.values(c).flatMap(g => Object.keys(g ?? {}))])])
    } catch (e) { if (my === seq.current) setErr({ text: msg(e), retry: true }) } finally { if (my === seq.current) setLoading(false) }
  }, [f.kind, f.stage, f.overdue, qd])
  useEffect(() => { void load(0) }, [load])
  useEffect(() => { const h = () => { if (err) void load(0) }; addEventListener('laris:online', h); return () => removeEventListener('laris:online', h) }, [err, load])

  const active = f.kind !== 'all' || !!f.stage || f.overdue || !!f.q
  const reset = () => { set({ kind: 'all', stage: '', overdue: false, q: '' }); setQd('') }
  const counts = data?.counts
  const chip = (g: keyof Counts, kind: Kind, st: string, n: number) => {
    const on = f.kind === kind && f.stage === st
    return (
      <li key={g + st}><button type="button" aria-pressed={on} className={`btn min-h-9 gap-1 px-3 ${on ? 'bg-tint' : ''}`} onClick={() => set(on ? { kind: 'all', stage: '' } : { kind, stage: st })}>
        {stageLabel(st)} <span className="tabular-nums">{n}</span></button></li>
    )
  }
  let body: ReactNode
  if (err) body = null
  else if (loading && !items.length) body = <Skeleton rows={4} shape="cards" />
  else if (!items.length) body = <EmptyState title="Nothing is waiting. Nice." hint={active ? 'No item matches these filters.' : 'Quotes, supplier documents, asks and catalog items show here while they are in flight.'} action={active ? { label: 'Reset filters', onClick: reset } : undefined} />
  else if (f.view === 'board') body = <Board items={items} counts={counts} kind={f.kind} more={more} />
  else body = <>
    <div className="hidden md:block"><ItemTable items={items} /></div>
    <ul className="grid gap-3 md:hidden">{items.map(i => <ItemCard key={i.kind + i.id} i={i} />)}</ul>
  </>

  return (
    <>
      <PageHeader title="Track" description="Everything in flight, how long it has been in its stage, and what is overdue." />
      <section aria-labelledby="trk-sum" className="mb-4">
        <h2 id="trk-sum" className="sr-only">Summary</h2>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button type="button" aria-pressed={f.overdue} className={`btn gap-2 ${f.overdue ? 'bg-tint' : ''} ${(data?.overdue_total ?? 0) > 0 ? 'border-warn text-warn' : ''}`} onClick={() => set({ overdue: !f.overdue })}>
            {(data?.overdue_total ?? 0) > 0 && <Icon name="warn" className="size-4" />}Overdue <span className="tabular-nums">{data?.overdue_total ?? 0}</span>
          </button>
        </div>
        {counts && <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
          {GROUPS.map(([g, kind, title]) => {
            const c = Object.entries(counts[g] ?? {}).filter(([, n]) => n > 0)
            return c.length ? (
              <div key={g}><h3 id={`trk-g-${g}`} className="mb-1 text-sm font-semibold text-muted">{title}</h3><ul aria-labelledby={`trk-g-${g}`} className="flex flex-wrap gap-1">{c.map(([st, n]) => chip(g, kind, st, n))}</ul></div>
            ) : null
          })}
        </div>}
      </section>

      <form role="search" aria-label="Track filters" className="mb-4 grid gap-3" onSubmit={e => e.preventDefault()}>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="grid gap-1 text-sm font-semibold"><span aria-hidden="true">Kind</span><Seg label="Kind" value={f.kind} options={KINDS} onChange={v => set({ kind: v })} /></div>
          <label className="grid gap-1 text-sm font-semibold">Stage
            <select className="input font-normal" value={f.stage} onChange={e => set({ stage: e.target.value })}>
              <option value="">Any stage</option><option value="open">Open (not finished)</option>
              {[...new Set([...stages, ...(f.stage && f.stage !== 'open' ? [f.stage] : [])])].sort().map(s => <option key={s} value={s}>{stageLabel(s)}</option>)}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" className="size-5" checked={f.overdue} onChange={e => set({ overdue: e.target.checked })} />Overdue only</label>
          <label className="grid min-w-0 flex-1 basis-56 gap-1 text-sm font-semibold">Search party or reference
            <input type="search" className="input font-normal" maxLength={100} value={f.q} onChange={e => set({ q: e.target.value })} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Seg label="View" value={f.view} options={[['list', 'List'], ['board', 'Board']]} onChange={v => set({ view: v as Filters['view'] })} />
          {active && <button type="button" className="link inline-flex min-h-11 items-center" onClick={reset}>Reset filters</button>}
        </div>
      </form>

      <p role="status" className="sr-only">{!loading && !err ? `${items.length} ${items.length === 1 ? 'item' : 'items'} shown${more ? ', more available' : ''}` : ''}</p>
      <ActionError err={err} onRetry={() => void load(0)} label="Retry loading" />
      {body}
      {items.length > 0 && !err && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {more && <button type="button" className="btn" aria-disabled={loading || undefined} onClick={() => { if (!loading) void load(items.length) }}>{loading ? 'Loading...' : 'Load more'}</button>}
          <span className="text-sm text-muted">{items.length} shown{more ? ', more available' : ''}</span>
        </div>
      )}
      {data?.stats && <Stats stats={data.stats} />}
    </>
  )
}

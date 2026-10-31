import { useEffect, useRef, useState } from 'react'
import { api, ApiError, getRole, needs, why, can } from './api'
import type { Assignee, Job, Me } from './api'
import { Async, OverdueChip, PageHeader, TableRegion, msg, rm, useFetch } from './ui'
import { FilterBar, FilterSelect, ToggleChip } from './kit'
import { useToast } from './Toast'
import { flagOn, hashParams } from './Track'
import { locale, t } from './i18n'
import { tx, txOr } from './strings'

// Jobs page: Board (todo / doing / done) and Agenda (one week). Edits go through POST /api/jobs/{id} and send only what changed.
const STATUSES: Job['status'][] = ['todo', 'doing', 'done']
const COLS = (): [Job['status'], string][] => STATUSES.map(s => [s, txOr(`jobs.col.${s}`, s)])
const PRIOS: NonNullable<Job['priority']>[] = ['high', 'normal', 'low']
const PRIORITY = (): [NonNullable<Job['priority']>, string][] => PRIOS.map(p => [p, txOr(`jobs.priOpt.${p}`, p)])
const colName = (s: string) => txOr(`jobs.col.${s}`, s)
const MAX_NOTES = 2000
const jl = (j: Job) => j.label ?? j.quote_no ?? j.title ?? tx('jobs.job')  // a job made by hand has no quote number

// ---- dates (Malaysia calendar, like the server)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (s: string, n: number) => iso(new Date(new Date(s + 'T00:00:00Z').getTime() + n * 864e5))
export const todayMY = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date())
const mondayOf = (s: string) => { const d = new Date(s + 'T00:00:00Z'); return addDays(s, -((d.getUTCDay() + 6) % 7)) }
const fmt = (s: string, o: Intl.DateTimeFormatOptions) => new Date(s + 'T00:00:00Z').toLocaleDateString(locale(), { timeZone: 'UTC', ...o })

// Due-date colour bands, the same four colours as the follow-up ages: green on track (4+ days), yellow due soon (1 to 3),
// orange due today, red overdue. Done jobs and jobs with no due date get no colour.
type Band = 'fresh' | 'waiting' | 'late' | 'stale'
const BANDS: Band[] = ['fresh', 'waiting', 'late', 'stale']
export function dueBand(j: Job): Band | null {
  if (j.status === 'done' || !j.due_on || j.days_to_due == null) return null
  const d = j.days_to_due
  return d < 0 ? 'stale' : d === 0 ? 'late' : d <= 3 ? 'waiting' : 'fresh'
}
function DueLegend() {
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted" data-guide="jobs-legend">
      <span>{tx('jobs.legend')}</span>
      {BANDS.map(b => <span key={b} className={`chip heat-${b}`}>{`${txOr(`jobs.band.${b}`, b)}, ${txOr(`jobs.range.${b}`, '')}`}</span>)}
    </p>
  )
}

function dueText(j: Job): { text: string; late: boolean } {
  if (!j.due_on) return { text: tx('jobs.noDue'), late: false }
  const d = j.days_to_due
  const date = fmt(j.due_on, { day: 'numeric', month: 'short' })
  if (j.status === 'done') return { text: tx('jobs.wasDue', date), late: false }
  if (d == null) return { text: tx('jobs.due', date), late: !!j.overdue }
  if (d < 0) return { text: tx('jobs.overdueBy', -d, date), late: true }
  if (d === 0) return { text: tx('jobs.dueToday', date), late: false }
  return { text: tx('jobs.dueIn', d, date), late: false }
}

// ---- who can be assigned: owners see everyone (GET /api/users is owner only), everyone else only themselves or nobody
function usePeople(me: Me): [Assignee[], boolean] {
  const owner = getRole() === 'owner'
  const u = useFetch<{ id: string; name: string; active?: boolean }[]>(owner ? '/users' : null)
  const list: Assignee[] = [{ id: me.id, name: me.name }]
  for (const x of u.data ?? []) if (x.active !== false && !list.some(p => p.id === x.id)) list.push({ id: x.id, name: x.name })
  return [list, !!u.error]
}

type Errs = Partial<Record<'due_on' | 'assignee_id' | 'priority' | 'notes' | 'form', string>>

function EditForm({ j, people, me, onSaved }: { j: Job; people: Assignee[]; me: Me; onSaved: () => void }) {
  const toast = useToast()
  const [due, setDue] = useState(j.due_on ?? '')
  const [who, setWho] = useState(j.assignee?.id ?? '')
  const [pri, setPri] = useState<string>(j.priority ?? 'normal')
  const [notes, setNotes] = useState(j.notes ?? '')
  const [errs, setErrs] = useState<Errs>({})
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState('')
  const opts = j.assignee && !people.some(p => p.id === j.assignee!.id) ? [...people, j.assignee] : people
  const save = async () => {
    if (busy) return
    const body: Record<string, unknown> = {}
    if (due !== (j.due_on ?? '')) body.due_on = due || null
    if (who !== (j.assignee?.id ?? '')) body.assignee_id = who || null
    if (pri !== (j.priority ?? 'normal')) body.priority = pri
    if (notes !== (j.notes ?? '')) body.notes = notes.trim() === '' ? null : notes
    setErrs({}); setInfo('')
    if (!Object.keys(body).length) { setInfo(tx('jobs.nothingChanged')); return }
    setBusy(true)
    try { await api('POST', `/jobs/${j.id}`, body); toast(tx('jobs.saved', jl(j))); onSaved() }
    catch (e) {
      const next: Errs = {}
      if (e instanceof ApiError && e.status === 422) {
        e.shown = true
        if (e.code === 'bad_assignee') next.assignee_id = tx('jobs.badAssignee')
        for (const f of e.fields ?? []) if (f.field in { due_on: 1, assignee_id: 1, priority: 1, notes: 1 }) next[f.field as keyof Errs] = f.message
        if (!Object.keys(next).length) next.form = msg(e)
      } else next.form = msg(e)
      setErrs(next)
    } finally { setBusy(false) }
  }
  const p = `job-${j.id}`
  const bad = (k: keyof Errs) => errs[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${p}-${k}-e` } : {}
  const E = ({ k }: { k: keyof Errs }) => errs[k] ? <span id={`${p}-${k}-e`} role="alert" className="text-xs font-normal text-warn">{errs[k]}</span> : null
  return (
    <div className="mt-2 grid gap-3">
      <label className="grid gap-1 text-sm font-semibold">{tx('jobs.dueDate')}
        <input type="date" className="input font-normal" value={due} onChange={e => setDue(e.target.value)} {...bad('due_on')} /><E k="due_on" />
      </label>
      <label className="grid gap-1 text-sm font-semibold">{tx('jobs.assignee')}
        <select className="input font-normal" value={who} onChange={e => setWho(e.target.value)} {...bad('assignee_id')}>
          <option value="">{tx('jobs.unassigned')}</option>
          {opts.map(a => <option key={a.id} value={a.id}>{a.id === me.id ? tx('jobs.me', a.name) : a.name}</option>)}
        </select><E k="assignee_id" />
        {getRole() !== 'owner' && <span className="text-xs font-normal text-muted">{tx('jobs.ownerAssigns')}</span>}
      </label>
      <label className="grid gap-1 text-sm font-semibold">{tx('jobs.priority')}
        <select className="input font-normal" value={pri} onChange={e => setPri(e.target.value)} {...bad('priority')}>{PRIORITY().map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select><E k="priority" />
      </label>
      <label className="grid gap-1 text-sm font-semibold">{tx('jobs.notes')}
        <textarea className="input min-h-24 py-2 font-normal" rows={3} maxLength={MAX_NOTES} value={notes} onChange={e => setNotes(e.target.value)} {...bad('notes')} />
        <span className="text-xs font-normal text-muted">{tx('jobs.chars', notes.length, MAX_NOTES)}</span><E k="notes" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" aria-disabled={busy || undefined} {...needs('manage_contacts', save)}>{busy ? tx('jobs.saving') : tx('jobs.save', jl(j))}</button>
        {!can('manage_contacts') && <span className="text-sm text-muted">{tx('jobs.needPerm', why('manage_contacts'))}</span>}
      </div>
      {info && <p role="status" className="text-sm text-muted">{info}</p>}
      {errs.form && <p role="alert" className="text-sm text-warn">{errs.form}</p>}
    </div>
  )
}

function JobCard({ j, people, me, compact, onChanged }: { j: Job; people: Assignee[]; me: Me; compact?: boolean; onChanged: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const due = dueText(j)
  const move = async (to: Job['status']) => {
    if (busy) return
    setErr(''); setBusy(to)
    try { await api('POST', `/jobs/${j.id}`, { status: to }); toast(tx('jobs.moved', jl(j), colName(to))); onChanged() }
    catch (e) { setErr(msg(e)) } finally { setBusy('') }
  }
  const pr = j.priority ?? 'normal'
  return (
    <li className={`card min-w-0 p-3 text-sm ${dueBand(j) ? `heat-edge heat-${dueBand(j)}` : ''}`}>
      <p className="break-words font-semibold">{j.quote_id ? <a className="text-ink underline-offset-2 hover:underline" href={`#/doc/${j.quote_id}`}>{jl(j)}</a> : jl(j)}
        {j.customer && <span className="font-normal">{tx('jobs.for', j.customer)}</span>}{j.manual && <span className="badge ml-2 font-normal">{tx('jobs.byHand')}</span>}</p>
      {j.summary && <p className="mt-1 break-words text-sm">{j.summary}</p>}
      {!j.manual && <p className="mt-1 text-sm"><a className="link" href={`#/deals/${j.id}`}>{t({ en: 'Open order (proforma, delivery, invoice)', ms: 'Buka pesanan (proforma, penghantaran, invois)', zh: '打开订单（形式发票、送货、发票）', ta: 'ஆர்டரைத் திற' })}</a></p>}
      {j.total != null && <p className="mt-1 text-sm text-muted">{tx('jobs.total', rm(j.total))}</p>}
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">{dueBand(j) && dueBand(j) !== 'stale' ? <span className={`chip heat-${dueBand(j)}`}>{txOr(`jobs.band.${dueBand(j)}`, '')}</span> : null}{due.text}{due.late && <OverdueChip />}</p>
      <p className="mt-1 flex flex-wrap items-center gap-1 text-sm">
        {compact && <span className="badge">{colName(j.status)}</span>}
        <span className={`badge ${pr === 'high' ? 'badge-warn' : ''}`}>{txOr(`jobs.pri.${pr}`, pr)}</span>
        <span className="text-muted">{j.assignee ? (j.assignee.id === me.id ? tx('jobs.assignedMe') : tx('jobs.assignedTo', j.assignee.name)) : tx('jobs.unassigned')}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {COLS().filter(c => c[0] !== j.status).map(([to, label]) => (
          <button key={to} type="button" className="btn" aria-disabled={!!busy || undefined} {...(compact ? { 'aria-label': tx('jobs.move', jl(j), label) } : {})} {...needs('manage_contacts', () => move(to))}>
            {busy === to ? tx('jobs.moving') : compact ? tx('jobs.moveTo', label) : tx('jobs.move', jl(j), label)}
          </button>
        ))}
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-warn">{err}</p>}
      <details className="mt-2">
        <summary className="inline-flex min-h-(--control-h) cursor-pointer items-center font-semibold text-accent hover:underline">{tx('jobs.edit')}<span className="sr-only"> {jl(j)}</span></summary>
        <EditForm j={j} people={people} me={me} onSaved={onChanged} />
      </details>
    </li>
  )
}

type Filters = { view: 'board' | 'agenda'; mine: boolean; overdue: boolean; status: string }
let saved: Filters = { view: 'board', mine: false, overdue: false, status: '' }  // kept for this visit
const initial = (): Filters => {
  const p = hashParams()
  if (![...p.keys()].some(k => ['overdue', 'mine', 'status', 'view'].includes(k))) return saved
  const st = p.get('status') ?? ''
  return { view: p.get('view') === 'agenda' ? 'agenda' : 'board', mine: flagOn(p, 'mine'), overdue: flagOn(p, 'overdue'), status: STATUSES.some(c => c === st) ? st : '' }
}

function Board({ f, me, people }: { f: Filters; me: Me; people: Assignee[] }) {
  const q = new URLSearchParams()
  if (f.status) q.set('status', f.status)
  if (f.mine) q.set('assignee', 'me')
  if (f.overdue) q.set('overdue', '1')
  const s = useFetch<Job[]>(`/jobs${q.size ? `?${q}` : ''}`)
  const active = f.mine || f.overdue || !!f.status
  const cols = f.status ? COLS().filter(c => c[0] === f.status) : COLS()
  const empty = !!s.data && s.data.length === 0
  return (
    <Async s={s} rows={3} shape="list" empty={empty}
      emptyText={active ? tx('jobs.noMatch') : tx('jobs.none')} emptyHint={active ? undefined : tx('jobs.noneHint')}
      emptyAction={active ? undefined : { label: tx('jobs.openTracker'), href: '#/tracker/open' }}>
      <div data-guide="jobs-board" className={`grid gap-4 ${cols.length > 1 ? 'md:grid-cols-3' : ''}`}>
        {cols.map(([st, title]) => {
          const list = (s.data ?? []).filter(j => j.status === st)
          return (
            <section key={st} aria-labelledby={`jobs-${st}`} className="min-w-0 glass-lite p-2">
              <h2 id={`jobs-${st}`} className="mb-2 flex items-baseline gap-2 text-md font-semibold">{title}<span className="text-sm font-normal tabular-nums text-muted">{list.length}</span></h2>
              <ul className="grid gap-2">{list.map(j => <JobCard key={j.id} j={j} people={people} me={me} onChanged={s.reload} />)}</ul>
              {list.length === 0 && <p className="text-sm text-muted">{tx('jobs.nothingHere')}</p>}
            </section>
          )
        })}
      </div>
    </Async>
  )
}

interface Agenda { from: string; to: string; days: { date: string; weekday: string; jobs: Job[] }[]; unscheduled: Job[]; overdue: Job[] }

function AgendaView({ f, me, people }: { f: Filters; me: Me; people: Assignee[] }) {
  const today = todayMY()
  const [from, setFrom] = useState(mondayOf(today))
  const to = addDays(from, 6)
  const s = useFetch<Agenda>(`/jobs/agenda?from=${from}&to=${to}`)
  const mine = (l: Job[] = []) => f.mine ? l.filter(j => j.assignee?.id === me.id) : l
  const a = s.data
  const section = (id: string, title: string, list: Job[], hint: string) => (
    <section aria-labelledby={id} className="min-w-0">
      <h3 id={id} className="mb-2 text-md font-semibold">{title} ({list.length})</h3>
      {list.length ? <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">{list.map(j => <JobCard key={j.id} j={j} people={people} me={me} compact onChanged={s.reload} />)}</ul> : <p className="text-sm text-muted">{hint}</p>}
    </section>
  )
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn" onClick={() => setFrom(addDays(from, -7))}>{tx('jobs.prevWeek')}</button>
        <button type="button" className="btn" aria-disabled={from === mondayOf(today) || undefined} onClick={() => setFrom(mondayOf(today))}>{tx('jobs.thisWeek')}</button>
        <button type="button" className="btn" onClick={() => setFrom(addDays(from, 7))}>{tx('jobs.nextWeek')}</button>
        <h2 className="text-md font-semibold" aria-live="polite">{fmt(from, { day: 'numeric', month: 'short' })} – {fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}</h2>
      </div>
      <Async s={s} rows={3} shape="cards">
        {a && <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <div className="grid gap-5 lg:grid-cols-2">
            {section('ag-over', tx('common.overdue'), mine(a.overdue), tx('jobs.nothingOverdue'))}
            {section('ag-un', tx('jobs.unscheduled'), mine(a.unscheduled), tx('jobs.allScheduled'))}
          </div>
          <TableRegion label={tx('jobs.weekAgenda')}>
            <div className="grid gap-3 p-3 md:grid-cols-[repeat(7,minmax(12rem,1fr))]">
              {a.days.map(d => {
                const list = mine(d.jobs), isToday = d.date === today
                return (
                  <section key={d.date} aria-labelledby={`ag-${d.date}`} className={`min-w-0 rounded-card border p-2 ${isToday ? 'border-accent bg-tint' : 'border-hairline'}`}>
                    <h3 id={`ag-${d.date}`} className="mb-2 text-sm font-semibold">{fmt(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}{isToday && <> <span className="badge ml-2">{tx('jobs.today')}</span></>}</h3>
                    {list.length ? <ul className="grid gap-2">{list.map(j => <JobCard key={j.id} j={j} people={people} me={me} compact onChanged={s.reload} />)}</ul> : <p className="text-sm text-muted">{tx('jobs.noJobs')}</p>}
                  </section>
                )
              })}
            </div>
          </TableRegion>
        </div>}
      </Async>
    </>
  )
}

// ---- a job made by hand: work that did not start as a quote (POST /api/jobs). It starts in To do.
function NewJobForm({ me, people, onDone, onCancel }: { me: Me; people: Assignee[]; onDone: (label: string) => void; onCancel: () => void }) {
  const customers = useFetch<{ id: string; name: string }[]>('/contacts?role=customer')
  const [v, setV] = useState({ title: '', customer_id: '', amount: '', due_on: '', assignee_id: '', priority: 'normal', notes: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.focus(), [])
  const save = async () => {
    if (busy) return
    if (!v.title.trim()) { setErr(tx('jobs.needTitle')); first.current?.focus(); return }
    if (v.amount.trim() && !(Number(v.amount) >= 0)) return setErr(tx('jobs.badAmount'))
    const body: Record<string, unknown> = { title: v.title.trim(), priority: v.priority }
    if (v.customer_id) body.customer_id = v.customer_id
    if (v.amount.trim()) body.amount = Number(v.amount).toFixed(2)
    if (v.due_on) body.due_on = v.due_on
    if (v.assignee_id) body.assignee_id = v.assignee_id
    if (v.notes.trim()) body.notes = v.notes.trim()
    setErr(''); setBusy(true)
    try { await api('POST', '/jobs', body); onDone(v.title.trim()) } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  const field = 'flex flex-col gap-1 text-sm font-semibold'
  return (
    <section aria-labelledby="new-job-h" className="card mb-4 max-w-3xl">
      <h2 id="new-job-h" className="text-md font-semibold">{tx('jobs.new')}</h2>
      <p className="mt-1 text-sm text-muted">{tx('jobs.newLead')}</p>
      <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); save() }}>
        <label className={`${field} sm:col-span-2`}>{tx('jobs.titleField')}
          <input ref={first} className="input font-normal" maxLength={200} value={v.title} onChange={e => setV({ ...v, title: e.target.value })} aria-invalid={err && !v.title.trim() ? true : undefined} />
        </label>
        <label className={field}>{tx('jobs.customer')}
          <select className="input font-normal" value={v.customer_id} onChange={e => setV({ ...v, customer_id: e.target.value })}>
            <option value="">{tx('jobs.noCustomer')}</option>{(customers.data ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className={field}>{tx('jobs.amount')}
          <input className="input font-normal" inputMode="decimal" value={v.amount} onChange={e => setV({ ...v, amount: e.target.value })} />
        </label>
        <label className={field}>{tx('jobs.dueDate')}
          <input type="date" className="input font-normal" value={v.due_on} onChange={e => setV({ ...v, due_on: e.target.value })} />
        </label>
        <label className={field}>{tx('jobs.assignee')}
          <select className="input font-normal" value={v.assignee_id} onChange={e => setV({ ...v, assignee_id: e.target.value })}>
            <option value="">{tx('jobs.unassigned')}</option>{people.map(a => <option key={a.id} value={a.id}>{a.id === me.id ? tx('jobs.me', a.name) : a.name}</option>)}
          </select>
        </label>
        <label className={field}>{tx('jobs.priority')}
          <select className="input font-normal" value={v.priority} onChange={e => setV({ ...v, priority: e.target.value })}>{PRIORITY().map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
        </label>
        <label className={`${field} sm:col-span-2`}>{tx('jobs.notes')}
          <textarea className="input min-h-20 py-2 font-normal" maxLength={MAX_NOTES} value={v.notes} onChange={e => setV({ ...v, notes: e.target.value })} />
        </label>
        {err && <p role="alert" className="text-sm text-warn sm:col-span-2">{err}</p>}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? tx('jobs.creating') : tx('jobs.create')}</button>
          <button type="button" className="btn" onClick={onCancel}>{tx('common.cancel')}</button>
        </div>
      </form>
    </section>
  )
}

export function JobsView({ me }: { me: Me }) {
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [rev, setRev] = useState(0)
  const [f, setF] = useState<Filters>(initial)
  const set = (p: Partial<Filters>) => setF(x => { saved = { ...x, ...p }; return saved })
  const [people, peopleFailed] = usePeople(me)
  useEffect(() => { const h = () => { if (hashParams().size) { const n = initial(); saved = n; setF(n) } }; addEventListener('hashchange', h); return () => removeEventListener('hashchange', h) }, [])
  const tab = (v: Filters['view'], t: string) => <ToggleChip key={v} pressed={f.view === v} onClick={() => set({ view: v })}>{t}</ToggleChip>
  const filtered = f.mine || (f.view === 'board' && (f.overdue || !!f.status))
  const clear = () => set({ mine: false, overdue: false, status: '' })
  const chips = [
    ...(f.mine ? [{ label: tx('jobs.mine'), onRemove: () => set({ mine: false }) }] : []),
    ...(f.view === 'board' && f.overdue ? [{ label: tx('common.overdue'), onRemove: () => set({ overdue: false }) }] : []),
    ...(f.view === 'board' && f.status ? [{ label: tx('jobs.statusChip', colName(f.status)), onRemove: () => set({ status: '' }) }] : []),
  ]
  return (
    <>
      <PageHeader title={tx('jobs.title')} description={tx('jobs.lead')}
        actions={can('manage_contacts') ? <button type="button" className={`btn ${adding ? '' : 'btn-primary'}`} aria-expanded={adding} data-guide="jobs-new" onClick={() => setAdding(!adding)}>{tx('jobs.new')}</button> : undefined} />
      {adding && <NewJobForm me={me} people={people} onCancel={() => setAdding(false)} onDone={t => { setAdding(false); setRev(r => r + 1); toast(tx('jobs.added', t)) }} />}
      {peopleFailed && <p role="alert" className="mb-2 text-sm text-warn">{tx('jobs.teamFailed')}</p>}
      {!can('manage_contacts') && <p className="mb-2 text-sm text-muted">{tx('jobs.needPerm', why('manage_contacts'))}</p>}
      <div data-guide="jobs-filters"><FilterBar label={tx('jobs.filters')} chips={chips} onClear={filtered ? clear : undefined}
        right={<div role="group" aria-label={tx('jobs.view')} className="inline-flex gap-1">{tab('board', tx('jobs.board'))}{tab('agenda', tx('jobs.agenda'))}</div>}>
        <ToggleChip pressed={f.mine} onClick={() => set({ mine: !f.mine })}>{tx('jobs.mine')}</ToggleChip>
        {f.view === 'board' && <>
          <ToggleChip pressed={f.overdue} onClick={() => set({ overdue: !f.overdue })}>{tx('common.overdue')}</ToggleChip>
          <FilterSelect label={tx('common.status')} value={f.status} onChange={v => set({ status: v })}><option value="">{tx('common.all')}</option>{COLS().map(([v, t]) => <option key={v} value={v}>{t}</option>)}</FilterSelect>
        </>}
      </FilterBar></div>
      <div className="mb-3"><DueLegend /></div>
      {f.view === 'board' ? <Board key={rev} f={f} me={me} people={people} /> : <AgendaView key={rev} f={f} me={me} people={people} />}
    </>
  )
}

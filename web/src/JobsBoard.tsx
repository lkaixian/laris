import { useEffect, useState } from 'react'
import { api, ApiError, getRole, needs, why, can } from './api'
import type { Assignee, Job, Me } from './api'
import { Async, PageHeader, TableRegion, msg, rm, useFetch } from './ui'
import { useToast } from './Toast'
import { flagOn, hashParams } from './Track'

// Jobs page: Board (todo / doing / done) and Agenda (one week). Edits go through POST /api/jobs/{id} and send only what changed.
const COLS: [Job['status'], string][] = [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']]
const PRIORITY: [NonNullable<Job['priority']>, string][] = [['high', 'High'], ['normal', 'Normal'], ['low', 'Low']]
const colName = (s: string) => COLS.find(c => c[0] === s)?.[1] ?? s
const MAX_NOTES = 2000

// ---- dates (Malaysia calendar, like the server)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (s: string, n: number) => iso(new Date(new Date(s + 'T00:00:00Z').getTime() + n * 864e5))
export const todayMY = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date())
const mondayOf = (s: string) => { const d = new Date(s + 'T00:00:00Z'); return addDays(s, -((d.getUTCDay() + 6) % 7)) }
const fmt = (s: string, o: Intl.DateTimeFormatOptions) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-MY', { timeZone: 'UTC', ...o })
const n = (x: number, w: string) => `${x} ${w}${x === 1 ? '' : 's'}`

function dueText(j: Job): { text: string; late: boolean } {
  if (!j.due_on) return { text: 'No due date', late: false }
  const d = j.days_to_due
  const date = fmt(j.due_on, { day: 'numeric', month: 'short' })
  if (j.status === 'done') return { text: `Was due ${date}`, late: false }
  if (d == null) return { text: `Due ${date}`, late: !!j.overdue }
  if (d < 0) return { text: `Overdue by ${n(-d, 'day')} (${date})`, late: true }
  if (d === 0) return { text: `Due today (${date})`, late: false }
  return { text: `Due in ${n(d, 'day')} (${date})`, late: false }
}

// ---- who can be assigned: owners see everyone (GET /api/users is owner only), everyone else only themselves or nobody
function usePeople(me: Me): Assignee[] {
  const owner = getRole() === 'owner'
  const u = useFetch<{ id: string; name: string; active?: boolean }[]>(owner ? '/users' : null)
  const list: Assignee[] = [{ id: me.id, name: me.name }]
  for (const x of u.data ?? []) if (x.active !== false && !list.some(p => p.id === x.id)) list.push({ id: x.id, name: x.name })
  return list
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
    if (!Object.keys(body).length) { setInfo('Nothing changed.'); return }
    setBusy(true)
    try { await api('POST', `/jobs/${j.id}`, body); toast(`${j.quote_no} updated.`); onSaved() }
    catch (e) {
      const next: Errs = {}
      if (e instanceof ApiError && e.status === 422) {
        e.shown = true
        if (e.code === 'bad_assignee') next.assignee_id = 'That person cannot be assigned.'
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
      <label className="grid gap-1 text-sm font-semibold">Due date
        <input type="date" className="input font-normal" value={due} onChange={e => setDue(e.target.value)} {...bad('due_on')} /><E k="due_on" />
      </label>
      <label className="grid gap-1 text-sm font-semibold">Assignee
        <select className="input font-normal" value={who} onChange={e => setWho(e.target.value)} {...bad('assignee_id')}>
          <option value="">Unassigned</option>
          {opts.map(a => <option key={a.id} value={a.id}>{a.id === me.id ? `Me (${a.name})` : a.name}</option>)}
        </select><E k="assignee_id" />
        {getRole() !== 'owner' && <span className="text-xs font-normal text-muted">Only the owner can assign other people.</span>}
      </label>
      <label className="grid gap-1 text-sm font-semibold">Priority
        <select className="input font-normal" value={pri} onChange={e => setPri(e.target.value)} {...bad('priority')}>{PRIORITY.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select><E k="priority" />
      </label>
      <label className="grid gap-1 text-sm font-semibold">Notes
        <textarea className="input min-h-24 py-2 font-normal" rows={3} maxLength={MAX_NOTES} value={notes} onChange={e => setNotes(e.target.value)} {...bad('notes')} />
        <span className="text-xs font-normal text-muted">{notes.length} of {MAX_NOTES} characters</span><E k="notes" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" aria-disabled={busy || undefined} {...needs('manage_contacts', save)}>{busy ? 'Saving...' : `Save ${j.quote_no}`}</button>
        {!can('manage_contacts') && <span className="text-sm text-muted">{why('manage_contacts')} to edit jobs.</span>}
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
    try { await api('POST', `/jobs/${j.id}`, { status: to }); toast(`${j.quote_no} moved to ${colName(to)}.`); onChanged() }
    catch (e) { setErr(msg(e)) } finally { setBusy('') }
  }
  const pr = j.priority ?? 'normal'
  return (
    <li className="card min-w-0">
      <p className="break-words font-semibold"><a className="link" href={`#/doc/${j.quote_id}`}>{j.quote_no}</a> <span className="font-normal">for {j.customer}</span></p>
      {j.summary && <p className="mt-1 break-words text-sm">{j.summary}</p>}
      <p className="mt-1 text-sm text-muted">Total {rm(j.total)}</p>
      <p className={`mt-1 text-sm ${due.late ? 'font-semibold text-warn' : ''}`}>{due.text}</p>
      <p className="mt-1 flex flex-wrap items-center gap-1 text-sm">
        {compact && <span className="badge">{colName(j.status)}</span>}
        <span className={`badge ${pr === 'high' ? 'badge-warn' : ''}`}>{PRIORITY.find(x => x[0] === pr)?.[1]} priority</span>
        <span className="text-muted">{j.assignee ? `Assigned to ${j.assignee.id === me.id ? 'me' : j.assignee.name}` : 'Unassigned'}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {COLS.filter(c => c[0] !== j.status).map(([to, label]) => (
          <button key={to} type="button" className="btn" aria-disabled={!!busy || undefined} {...(compact ? { 'aria-label': `Move to ${label}: ${j.quote_no}` } : {})} {...needs('manage_contacts', () => move(to))}>
            {busy === to ? 'Moving...' : compact ? `Move to ${label}` : `Move ${j.quote_no} to ${label}`}
          </button>
        ))}
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-warn">{err}</p>}
      <details className="mt-2">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-accent underline underline-offset-2">Edit<span className="sr-only"> {j.quote_no}</span></summary>
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
  return { view: p.get('view') === 'agenda' ? 'agenda' : 'board', mine: flagOn(p, 'mine'), overdue: flagOn(p, 'overdue'), status: COLS.some(c => c[0] === st) ? st : '' }
}

function Board({ f, me, people }: { f: Filters; me: Me; people: Assignee[] }) {
  const q = new URLSearchParams()
  if (f.status) q.set('status', f.status)
  if (f.mine) q.set('assignee', 'me')
  if (f.overdue) q.set('overdue', '1')
  const s = useFetch<Job[]>(`/jobs${q.size ? `?${q}` : ''}`)
  const active = f.mine || f.overdue || !!f.status
  const cols = f.status ? COLS.filter(c => c[0] === f.status) : COLS
  const empty = !!s.data && s.data.length === 0
  return (
    <Async s={s} rows={3} shape="cards" empty={empty}
      emptyText={active ? 'No jobs match these filters.' : 'No jobs yet.'} emptyHint={active ? undefined : 'A job appears when a customer accepts a quote and it is signed.'}
      emptyAction={active ? undefined : { label: 'Open the tracker', href: '#/tracker/open' }}>
      <div className={`grid gap-4 ${cols.length > 1 ? 'md:grid-cols-3' : ''}`}>
        {cols.map(([st, title]) => {
          const list = (s.data ?? []).filter(j => j.status === st)
          return (
            <section key={st} aria-labelledby={`jobs-${st}`} className="min-w-0">
              <h2 id={`jobs-${st}`} className="mb-2 text-base font-semibold">{title} ({list.length})</h2>
              <ul className="grid gap-2">{list.map(j => <JobCard key={j.id} j={j} people={people} me={me} onChanged={s.reload} />)}</ul>
              {list.length === 0 && <p className="text-sm text-muted">Nothing here.</p>}
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
      <h3 id={id} className="mb-2 text-base font-semibold">{title} ({list.length})</h3>
      {list.length ? <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">{list.map(j => <JobCard key={j.id} j={j} people={people} me={me} compact onChanged={s.reload} />)}</ul> : <p className="text-sm text-muted">{hint}</p>}
    </section>
  )
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn" onClick={() => setFrom(addDays(from, -7))}>Previous week</button>
        <button type="button" className="btn" aria-disabled={from === mondayOf(today) || undefined} onClick={() => setFrom(mondayOf(today))}>This week</button>
        <button type="button" className="btn" onClick={() => setFrom(addDays(from, 7))}>Next week</button>
        <h2 className="text-base font-semibold" aria-live="polite">{fmt(from, { day: 'numeric', month: 'short' })} to {fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}</h2>
      </div>
      <Async s={s} rows={3} shape="cards">
        {a && <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <div className="grid gap-5 lg:grid-cols-2">
            {section('ag-over', 'Overdue', mine(a.overdue), 'Nothing is overdue.')}
            {section('ag-un', 'Unscheduled', mine(a.unscheduled), 'Every open job has a due date.')}
          </div>
          <TableRegion label="Week agenda">
            <div className="grid gap-3 p-3 md:grid-cols-[repeat(7,minmax(12rem,1fr))]">
              {a.days.map(d => {
                const list = mine(d.jobs), isToday = d.date === today
                return (
                  <section key={d.date} aria-labelledby={`ag-${d.date}`} className={`min-w-0 rounded-ui border p-2 ${isToday ? 'border-accent bg-tint' : 'border-soft'}`}>
                    <h3 id={`ag-${d.date}`} className="mb-2 text-sm font-semibold">{fmt(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}{isToday && <> <span className="badge ml-2">Today</span></>}</h3>
                    {list.length ? <ul className="grid gap-2">{list.map(j => <JobCard key={j.id} j={j} people={people} me={me} compact onChanged={s.reload} />)}</ul> : <p className="text-sm text-muted">No jobs</p>}
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

export function JobsView({ me }: { me: Me }) {
  const [f, setF] = useState<Filters>(initial)
  const set = (p: Partial<Filters>) => setF(x => { saved = { ...x, ...p }; return saved })
  const people = usePeople(me)
  useEffect(() => { const h = () => { if (hashParams().size) { const n = initial(); saved = n; setF(n) } }; addEventListener('hashchange', h); return () => removeEventListener('hashchange', h) }, [])
  const tab = (v: Filters['view'], t: string) => <button key={v} type="button" className={`btn ${f.view === v ? 'bg-tint' : ''}`} aria-pressed={f.view === v} onClick={() => set({ view: v })}>{t}</button>
  return (
    <>
      <PageHeader title="Jobs" description={'Created when a customer accepts a quote ("Sign and create job" on the quote).'} />
      {!can('manage_contacts') && <p className="mb-2 text-sm text-muted">{why('manage_contacts')} to move or edit jobs. You can see the board.</p>}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label="View" className="inline-flex gap-1">{tab('board', 'Board')}{tab('agenda', 'Agenda')}</div>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" className="size-5" checked={f.mine} onChange={e => set({ mine: e.target.checked })} />Mine</label>
        {f.view === 'board' && <>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" className="size-5" checked={f.overdue} onChange={e => set({ overdue: e.target.checked })} />Overdue</label>
          <label className="flex items-center gap-2 text-sm font-semibold">Status
            <select className="input font-normal" value={f.status} onChange={e => set({ status: e.target.value })}><option value="">All</option>{COLS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
          </label>
        </>}
        {(f.mine || (f.view === 'board' && (f.overdue || f.status))) && <button type="button" className="link inline-flex min-h-11 items-center" onClick={() => set({ mine: false, overdue: false, status: '' })}>Reset filters</button>}
      </div>
      {f.view === 'board' ? <Board f={f} me={me} people={people} /> : <AgendaView f={f} me={me} people={people} />}
    </>
  )
}

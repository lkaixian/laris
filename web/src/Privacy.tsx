import { useEffect, useRef, useState } from 'react'
import { api, download, getRole } from './api'
import { Async, Hint, PageHeader, useFetch, useAction, ActionError } from './ui'
import { useToast } from './Toast'

interface Dpo { dpo_name: string | null; dpo_email: string | null; dpo_phone: string | null; configured: boolean }
interface Incident {
  id: string; detected_at: string; summary: string; data_types: string[]; people_affected: number | null; significant_harm: boolean
  commissioner_notified_at: string | null; subjects_notified_at: string | null; status: 'open' | 'closed'; notes: string | null
  notifiable: boolean; commissioner_due: string; subjects_due: string | null; commissioner_overdue: boolean; subjects_overdue: boolean; hours_left: number | null
}
interface Breaches { incidents: Incident[]; rule_note: string }

const when = (s: string) => new Date(s).toLocaleString()
const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16)  // value for datetime-local
const left = (h: number | null) => (h === null ? '' : h <= 0 ? ' (overdue)' : ` (${Math.round(h)} ${Math.round(h) === 1 ? 'hour' : 'hours'} left)`)

const CONFIRM_KEY = 'laris.confirm.incidents'  // per-viewer convenience: "0" means do not ask
const readConfirm = () => { try { return localStorage.getItem(CONFIRM_KEY) !== '0' } catch { return true } }
const writeConfirm = (on: boolean) => { try { localStorage.setItem(CONFIRM_KEY, on ? '1' : '0') } catch { /* private window: the choice lasts until reload */ } }

function DpoCard() {
  const s = useFetch<Dpo>('/settings/privacy')
  const [f, setF] = useState({ dpo_name: '', dpo_email: '', dpo_phone: '' })
  const a = useAction()
  const toast = useToast()
  useEffect(() => { if (s.data) setF({ dpo_name: s.data.dpo_name ?? '', dpo_email: s.data.dpo_email ?? '', dpo_phone: s.data.dpo_phone ?? '' }) }, [s.data])
  const save = () => a.run(async () => { await api('POST', '/settings/privacy', f); toast('Contact saved.'); s.reload() })
  const t = (k: keyof typeof f, name: string, type = 'text') => (
    <label className="flex flex-col gap-1 text-sm font-semibold">{name}
      <input className="input font-normal" type={type} maxLength={k === 'dpo_email' ? 254 : 120} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>
  )
  return (
    <section className="card mb-6" aria-labelledby="dpo">
      <h2 id="dpo" className="text-lg font-semibold">Who customers contact about their data</h2>
      <p className="mt-1 text-sm text-muted">Malaysian privacy law (PDPA) asks a business to publish a contact person for questions about personal data. Customers use it to ask what you hold about them.</p>
      <Async s={s} empty={false} rows={2}>
        {s.data && !s.data.configured && <p className="mt-2 font-semibold">Not set yet. Add a name and an email or phone number.</p>}
        <form className="mt-3 grid max-w-xl gap-3" onSubmit={e => { e.preventDefault(); save() }}>
          {t('dpo_name', 'Name')}{t('dpo_email', 'Email', 'email')}{t('dpo_phone', 'Phone')}
          <div><button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? 'Saving...' : 'Save contact'}</button></div>
        </form>
        <ActionError err={a.err} onRetry={save} label="Retry saving" />
      </Async>
    </section>
  )
}

function AddIncident({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ detected_at: localNow(), summary: '', types: '', people: '', harm: false })
  const [err, setErr] = useState('')
  const a = useAction()
  const toast = useToast()
  const submit = () => {
    if (!f.summary.trim()) return setErr('Write a short summary of what happened. Do not include names or phone numbers.')
    if (!f.detected_at) return setErr('Enter when you found out.')
    setErr('')
    a.run(async () => {
      await api('POST', '/privacy/breaches', { detected_at: new Date(f.detected_at).toISOString(), summary: f.summary.trim(), significant_harm: f.harm,
        data_types: f.types.split(',').map(x => x.trim()).filter(Boolean), people_affected: f.people === '' ? null : Math.max(0, Math.floor(Number(f.people))) })
      toast('Incident recorded.'); setF({ detected_at: localNow(), summary: '', types: '', people: '', harm: false }); onDone()
    })
  }
  return (
    <details className="card mb-4">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-accent">Add incident</summary>
      <form className="mt-2 grid max-w-xl gap-3" onSubmit={e => { e.preventDefault(); submit() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">When did you find out?
          <input type="datetime-local" className="input font-normal" value={f.detected_at} onChange={e => setF({ ...f, detected_at: e.target.value })} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">What happened (short summary)
          <textarea className="input min-h-20 py-2 font-normal" maxLength={1000} aria-describedby="b-sum" value={f.summary} onChange={e => setF({ ...f, summary: e.target.value })} />
          <Hint id="b-sum">Do not write names, phone numbers or message text here.</Hint></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">What kinds of data (separate with commas)
          <input className="input font-normal" placeholder="name, phone number, address" value={f.types} onChange={e => setF({ ...f, types: e.target.value })} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">How many people are affected
          <input className="input w-40 font-normal" type="number" min="0" inputMode="numeric" value={f.people} onChange={e => setF({ ...f, people: e.target.value })} /></label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={f.harm} onChange={e => setF({ ...f, harm: e.target.checked })} /> This could cause serious harm to the people affected</label>
        {err && <p role="alert" className="text-sm text-warn">{err}</p>}
        <div><button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? 'Saving...' : 'Add incident'}</button></div>
      </form>
      <ActionError err={a.err} onRetry={submit} label="Retry saving" />
    </details>
  )
}

function IncidentCard({ i, onDone, confirmOn }: { i: Incident; onDone: () => void; confirmOn: boolean }) {
  const [notes, setNotes] = useState(i.notes ?? '')
  const [pending, setPending] = useState<{ label: string; body: Record<string, unknown>; done: string } | null>(null)
  const confirmRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (pending) confirmRef.current?.focus() }, [pending])
  const a = useAction()
  const toast = useToast()
  const last = useRef(() => {})
  const open = i.status === 'open'
  const patch = (body: object, done: string) => { last.current = () => patch(body, done); a.run(async () => { await api('POST', `/privacy/breaches/${i.id}`, body); toast(done); onDone() }) }
  const cWait = i.notifiable && !i.commissioner_notified_at && open
  const sWait = !!i.subjects_due && !i.subjects_notified_at && open
  const overdue = i.commissioner_overdue || i.subjects_overdue
  const now = () => new Date().toISOString()
  const act = (label: string, body: Record<string, unknown>, done: string) => (confirmOn ? setPending({ label, body, done }) : patch(body, done))
  return (
    <li className={`card ${overdue ? 'border-warn bg-warn-bg' : ''}`}>
      <p className="flex flex-wrap items-center gap-2">
        <span className="badge">{open ? 'Open' : 'Closed'}</span>
        {overdue && <span className="badge badge-warn">Overdue</span>}
        <span className="text-sm text-muted">Found out {when(i.detected_at)}</span>
      </p>
      <p className="mt-2 font-semibold">{i.summary}</p>
      <p className="mt-1 text-sm">{i.notifiable ? 'You must report this one (serious harm or many people).' : 'Reporting is not required by the rule we check, but ask a professional if unsure.'}</p>
      <p className="text-sm text-muted">{[i.people_affected !== null && `${i.people_affected} ${i.people_affected === 1 ? 'person' : 'people'} affected`, i.data_types.length > 0 && i.data_types.join(', ')].filter(Boolean).join('. ')}</p>
      {i.notifiable && (
        <ul className="mt-2 grid gap-1 text-sm">
          <li className={i.commissioner_overdue ? 'font-semibold text-warn' : ''}>
            {i.commissioner_notified_at ? `Commissioner told on ${when(i.commissioner_notified_at)}.`
              : i.commissioner_overdue ? `Overdue: tell the Commissioner. The deadline was ${when(i.commissioner_due)}.`
              : `Tell the Commissioner by ${when(i.commissioner_due)}${cWait ? left(i.hours_left) : ''}.`}
          </li>
          {i.subjects_due && <li className={i.subjects_overdue ? 'font-semibold text-warn' : ''}>
            {i.subjects_notified_at ? `Affected people told on ${when(i.subjects_notified_at)}.`
              : i.subjects_overdue ? `Overdue: tell the affected people. The deadline was ${when(i.subjects_due)}.`
              : `Tell affected people by ${when(i.subjects_due)}${sWait && !cWait ? left(i.hours_left) : ''}.`}
          </li>}
          {!i.subjects_due && i.significant_harm && <li>The date to tell affected people appears once the Commissioner is told.</li>}
        </ul>
      )}
      <details className="mt-3">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-accent">Update this incident<span className="sr-only">: {i.summary}</span></summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {!i.commissioner_notified_at && <button type="button" className="btn" aria-disabled={a.busy || undefined} onClick={() => act('Commissioner told now', { commissioner_notified_at: now() }, 'Marked: Commissioner told.')}>Commissioner told now</button>}
          {!i.subjects_notified_at && <button type="button" className="btn" aria-disabled={a.busy || undefined} onClick={() => act('Affected people told now', { subjects_notified_at: now() }, 'Marked: affected people told.')}>Affected people told now</button>}
          {open && <button type="button" className="btn" aria-disabled={a.busy || undefined} onClick={() => act('Close incident', { status: 'closed' }, 'Incident closed.')}>Close incident</button>}
        </div>
        {pending && (
          <div ref={confirmRef} tabIndex={-1} role="group" aria-label="Confirm this change" className="mt-3 grid gap-2 rounded-ui border border-warn p-3 text-sm">
            <p>Record on the register: <strong>{pending.label}</strong>. The time is saved now and shown in the audit log.{pending.body.status === 'closed' && ' A closed incident cannot be reopened from this page.'}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary" aria-disabled={a.busy || undefined} onClick={() => { const p = pending; setPending(null); patch(p.body, p.done) }}>Yes, record it</button>
              <button type="button" className="btn" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        )}
        <form className="mt-3 grid max-w-xl gap-2" onSubmit={e => { e.preventDefault(); patch({ notes: notes.trim() || null }, 'Notes saved.') }}>
          <label className="flex flex-col gap-1 text-sm font-semibold">Notes
            <textarea className="input min-h-20 py-2 font-normal" maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
          <div><button type="submit" className="btn" aria-disabled={a.busy || undefined}>Save notes</button></div>
        </form>
        <ActionError err={a.err} onRetry={() => last.current()} label="Try again" />
      </details>
    </li>
  )
}

function BreachRegister() {
  const s = useFetch<Breaches>('/privacy/breaches')
  const list = s.data?.incidents ?? []
  const [confirmOn, setConfirmOn] = useState(readConfirm)
  return (
    <section className="mb-6" aria-labelledby="breach">
      <h2 id="breach" className="text-lg font-semibold">Breach register</h2>
      <p className="mb-3 mt-1 text-sm text-muted">Write down any time personal data was lost, sent to the wrong person or seen by someone who should not. Incidents are kept as a record and cannot be deleted.</p>
      <label className="mb-3 flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={confirmOn} onChange={e => { setConfirmOn(e.target.checked); writeConfirm(e.target.checked) }} />
        Ask me to confirm before changing an incident
      </label>
      <AddIncident onDone={s.reload} />
      <Async s={s} rows={2} empty={!list.length} emptyText="No incidents recorded." emptyHint="That is good news. If something goes wrong, add it here the same day.">
        <p className="mb-3 border-l-4 border-l-amber pl-3 text-sm">{s.data?.rule_note} Confirm the deadlines at pdp.gov.my before you rely on them.</p>
        <ul className="grid gap-3">{list.map(i => <IncidentCard key={i.id + i.status + (i.commissioner_notified_at ?? '') + (i.subjects_notified_at ?? '')} i={i} onDone={s.reload} confirmOn={confirmOn} />)}</ul>
      </Async>
    </section>
  )
}

export function PrivacyView() {
  return (
    <>
      <PageHeader title="Privacy and data" description="Keep your privacy contact up to date, record data incidents and handle customer data requests." />
      <DpoCard />
      <BreachRegister />
      <section className="card" aria-labelledby="dsr">
        <h2 id="dsr" className="text-lg font-semibold">Customer data requests</h2>
        <p className="mt-1 text-sm">When a customer asks what you hold about them, or asks you to delete it, open their page in Contacts. There you can download their data or erase their personal data.</p>
        <p className="mt-2"><a className="link" href="#/contacts">Open Contacts</a></p>
      </section>
    </>
  )
}

// Owner-only buttons on a contact page: download everything held about this person, and (customers only) erase their personal data.
export function PersonData({ id, name, customer, onDone }: { id: string; name: string; customer: boolean; onDone: () => void }) {
  const [ask, setAsk] = useState(false)
  const [res, setRes] = useState<{ messages_erased: number; replies_erased: number }>()
  const a = useAction()
  const toast = useToast()
  if (getRole() !== 'owner') return null
  const file = `data-${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'contact'}.json`
  const get = () => a.run(async () => { await download(`/parties/${id}/export`, file); toast(`${file} downloaded.`) })
  const erase = () => a.run(async () => { setRes(await api('POST', `/parties/${id}/erase`)); setAsk(false); toast('Personal data erased.'); onDone() })
  return (
    <section className="card mt-6" aria-labelledby="pd">
      <h2 id="pd" className="text-lg font-semibold">Personal data (owner only)</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn" aria-disabled={a.busy || undefined} onClick={get}>Download this person&apos;s data</button>
        {customer && !ask && <button type="button" className="btn btn-danger" onClick={() => setAsk(true)}>Erase this person&apos;s personal data</button>}
      </div>
      {ask && (
        <div role="group" aria-label="Confirm erasing personal data" className="mt-3 grid gap-2 rounded-ui border border-warn p-3 text-sm">
          <p className="font-semibold">Erase the personal data of {name}? This cannot be undone.</p>
          <p><strong>Erased:</strong> name, phone or chat number, email, address, notes, and the text of every message with this person.</p>
          <p><strong>Kept:</strong> the quotes, their lines, dates and prices, as financial records. Earlier entries in the activity log cannot be removed. Telegram, Meta and the AI providers keep their own copies.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-danger" autoFocus aria-disabled={a.busy || undefined} onClick={erase}>{a.busy ? 'Erasing...' : 'Yes, erase it'}</button>
            <button type="button" className="btn" onClick={() => setAsk(false)}>Cancel</button>
          </div>
        </div>
      )}
      {res && <p role="status" className="mt-3 text-sm">Done. {res.messages_erased} {res.messages_erased === 1 ? 'message' : 'messages'} and {res.replies_erased} supplier {res.replies_erased === 1 ? 'reply' : 'replies'} erased.</p>}
      <ActionError err={a.err} onRetry={get} label="Retry" />
    </section>
  )
}

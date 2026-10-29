import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, getAccount, logout, ApiError } from './api'
import type { License } from './api'
import { Brand, EmptyState, PageHeader, Skeleton, ThemeToggle, focusTop, msg, useFetch } from './ui'
import { Icon } from './icons'
import { useToast } from './Toast'

/*
  Licence UI (docs/licensing.md). `enforced:false` shows nothing at all. The shell reads GET /api/license once per sign-in and again on a 402.
  useLicense().readOnly is true only when licensing is enforced and the server is refusing writes; write controls use useWriteGate().
*/
interface Ctx { lic?: License; readOnly: boolean; reload: () => void }
const LicCtx = createContext<Ctx>({ readOnly: false, reload: () => undefined })
export const LicenseProvider = ({ value, children }: { value: Ctx; children: ReactNode }) => <LicCtx value={value}>{children}</LicCtx>
export const useLicense = () => useContext(LicCtx)

export const RO_TITLE = 'Read-only mode: the licence is missing or expired. Open the Licence page to fix it.'
// Spread on a write button: `<button {...gate(onClick)}>`. In read-only mode it is aria-disabled with an explanation and does nothing.
export function useWriteGate() {
  const { readOnly } = useLicense()
  return (onClick: () => void) => readOnly ? { 'aria-disabled': true as const, title: RO_TITLE } : { onClick }
}

// Module flag so the nav (a plain filter in Shell.tsx) can hide the Licence item when licensing is off. Set by the shell when it reads GET /api/license.
let on = false
export const licenceOn = () => on
export const setLicenceOn = (v: boolean) => { on = v }
export const blocked = (l?: License) => !!l?.enforced && l.status !== 'active' && l.status !== 'expiring'
const STATUS: Record<License['status'], string> = {
  active: 'Active', expiring: 'Expiring soon', missing: 'No licence installed', expired: 'Expired', invalid: 'Not valid', clock_unverified: 'Date could not be confirmed',
}
// The platform operator's page (Issuer.tsx) is only for the LARIS team: the nav shows it once GET /license/admin/config answers (a 404 means not the admin).
let issuer = false
export const issuerOn = () => issuer
export function useIssuerProbe() {
  const [, set] = useState(0)
  useEffect(() => { api('GET', '/license/admin/config', undefined, { quiet: true }).then(() => { issuer = true; set(n => n + 1) }, () => { issuer = false }) }, [])
}
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not set'

// Minimal frame for screens shown instead of the app: logo, organisation, theme, sign out. Page content is the <main>.
export function Frame({ org, dark, setDark, children, wide }: { org?: string; dark: boolean; setDark: (d: boolean) => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-soft bg-surface">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
          <Brand dark={dark} />
          {org && <span className="min-w-0 flex-1 truncate text-sm font-semibold">{org}</span>}
          {!org && <span className="flex-1" />}
          <ThemeToggle dark={dark} setDark={setDark} compact />
          <button type="button" className="btn" onClick={() => logout()}><Icon name="logout" className="size-4" /><span className="ml-2">Sign out</span></button>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={`mx-auto w-full px-4 py-8 ${wide ? 'max-w-4xl' : 'max-w-xl'}`}>{children}</main>
    </div>
  )
}

// Licence key box shared by the gate and the Licence page.
export function KeyForm({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const id = useId()
  const submit = async () => {
    if (busy) return
    const k = key.trim()
    if (!k.startsWith('LARIS1.')) return setErr('A licence key starts with LARIS1. Paste the whole key from your email.')
    setBusy(true); setErr('')
    try { await api('POST', '/license', { key: k }); toast('Licence activated.'); setKey(''); onDone() }
    catch (e) { setErr(e instanceof ApiError || e instanceof Error ? msg(e) : 'Could not activate the licence.') }
    finally { setBusy(false) }
  }
  return (
    <form className="grid gap-3" onSubmit={e => { e.preventDefault(); submit() }}>
      <label className="flex flex-col gap-1 text-sm font-semibold" htmlFor={id}>Licence key
        <textarea id={id} className="input min-h-24 break-all py-2 font-mono font-normal" rows={3} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="LARIS1...."
          aria-invalid={err ? true : undefined} aria-describedby={err ? `${id}-e` : undefined} value={key} onChange={e => setKey(e.target.value)} />
      </label>
      {err && <p id={`${id}-e`} role="alert" className="text-sm text-warn">{err}</p>}
      <div><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Activating...' : 'Activate'}</button></div>
    </form>
  )
}

// A licence the platform operator already issued for this business: one click to activate.
function OfferCard({ offer, onDone }: { offer: NonNullable<License['offer']>; onDone: () => void }) {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const go = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try { await api('POST', '/license/accept-offer'); toast('Licence activated.'); onDone() }
    catch (e) {
      setErr(e instanceof ApiError && e.code === 'no_offer' ? 'This licence is no longer available. Ask the LARIS team to send it again.' : msg(e))
      if (e instanceof ApiError && e.code === 'no_offer') onDone()
    } finally { setBusy(false) }
  }
  return (
    <section aria-labelledby="lic-o" className="card mb-4 border-l-4 border-l-accent">
      <h2 id="lic-o" className="font-semibold">A licence is ready for your business</h2>
      <p className="mt-1">{offer.plan[0].toUpperCase() + offer.plan.slice(1)}, {offer.seats} seats, valid until {fmtDate(offer.expires_at)}.</p>
      {err && <p role="alert" className="mt-2 text-sm text-warn">{err}</p>}
      <button type="button" className="btn btn-primary mt-3" aria-disabled={busy || undefined} onClick={go}>{busy ? 'Activating...' : 'Activate licence'}</button>
    </section>
  )
}
// The offer card (when there is an offer) with the paste-a-key box tucked under it; just the box otherwise.
function Activate({ lic, onDone }: { lic: License; onDone: () => void }) {
  return <>
    {lic.offer && <OfferCard offer={lic.offer} onDone={onDone} />}
    <details className="card"><summary className="cursor-pointer font-semibold">Have a key instead?</summary><div className="mt-3"><KeyForm onDone={onDone} /></div></details>
  </>
}

const WHY: Record<string, string> = {
  missing: 'No licence is installed yet.', expired: 'The licence has expired.', invalid: 'The installed licence is not valid.',
  clock_unverified: 'The server could not confirm today\'s date, so the licence cannot be checked. Try again in a moment.',
}

// Full-page screen when licensing is enforced and the licence is not usable. Owners activate, staff are told to ask the owner.
export function LicenceGate({ lic, owner, org, dark, setDark, reload, onReadOnly }: { lic: License; owner: boolean; org: string; dark: boolean; setDark: (d: boolean) => void; reload: () => void; onReadOnly: () => void }) {
  useEffect(() => { document.title = `Licence · ${org}`; focusTop() }, [org])
  return (
    <Frame org={org} dark={dark} setDark={setDark}>
      {owner ? <>
        <h1 tabIndex={-1} className="text-2xl font-semibold tracking-tight">Activate your licence</h1>
        <p className="mt-1 text-muted">{WHY[lic.status] ?? ''} Paste the licence key we emailed you to unlock changes for {org}.</p>
        <div className="mt-4">{lic.offer ? <Activate lic={lic} onDone={reload} /> : <div className="card"><KeyForm onDone={reload} /></div>}</div>
        <p className="mt-4 text-sm">Don't have a licence? <a className="link" href="#/purchase">Request one</a></p>
      </> : <>
        <h1 tabIndex={-1} className="text-2xl font-semibold tracking-tight">Licence needed</h1>
        <p className="mt-2">Your organisation's licence has expired or is missing. Ask the owner to activate it.</p>
      </>}
      <div className="card mt-6">
        <h2 className="font-semibold">Continue in read-only mode</h2>
        <p className="mt-1 text-sm text-muted">You can look at everything, but anything that saves or sends is blocked until the licence is active.</p>
        <button type="button" className="btn mt-3" onClick={onReadOnly}>Continue in read-only mode</button>
      </div>
      {lic.status === 'clock_unverified' && <p className="mt-4"><button type="button" className="btn" onClick={reload}>Check again</button></p>}
    </Frame>
  )
}

// Slim notice above the page: read-only, or a licence about to end. Nothing when licensing is not enforced.
export function LicenceBanner({ lic, owner }: { lic?: License; owner: boolean }) {
  if (!lic?.enforced) return null
  const ro = lic.read_only
  if (!ro && lic.status !== 'expiring') return null
  const d = lic.days_left ?? 0
  return (
    <div role="region" aria-label="Licence notice" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-warn-bg px-4 py-2 text-center text-sm text-warn">
      <span>{ro ? 'Read-only mode: the licence is missing or expired, so changes are blocked.' : `Your licence ends in ${d} ${d === 1 ? 'day' : 'days'}.`}</span>
      <span className="flex gap-3 font-semibold">
        <a className="underline underline-offset-2" href="#/licence">{owner ? 'Open licence' : 'See licence status'}</a>
        {owner && <a className="underline underline-offset-2" href="#/purchase">{ro ? 'Get a licence' : 'Request a renewal'}</a>}
      </span>
    </div>
  )
}

export function LicenceView({ owner }: { owner: boolean }) {
  const { lic, reload } = useLicense()
  if (!lic) return <><PageHeader title="Licence" /><Skeleton rows={3} shape="text" /></>
  if (!lic.enforced) return <><PageHeader title="Licence" /><EmptyState title="Licensing is not switched on here." hint="Nothing to activate. Every feature is available." /></>
  const days = lic.days_left
  const row = (k: string, v: ReactNode) => <><dt className="text-muted">{k}</dt><dd className="font-semibold">{v}</dd></>
  return (
    <>
      <PageHeader title="Licence" description={owner ? 'Your plan, seats and expiry. Activate a new key here to renew.' : 'The licence status of your organisation. Only the owner can change it.'} />
      {owner && lic.offer && <div className="max-w-xl" data-guide="lic-offer"><OfferCard offer={lic.offer} onDone={reload} /></div>}
      {lic.clock?.rollback && <p role="alert" className="card mb-4 border-warn bg-warn-bg text-warn">The computer clock appears to have been set back. Licence checks may be wrong until the date is corrected.</p>}
      <section aria-labelledby="lic-s" className="card max-w-xl" data-guide="lic-status">
        <h2 id="lic-s" className="sr-only">Licence status</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          {row('Status', <span className={`badge ${lic.read_only ? 'badge-warn' : ''}`}>{STATUS[lic.status]}</span>)}
          {row('Plan', lic.plan ? lic.plan[0].toUpperCase() + lic.plan.slice(1) : 'None')}
          {row('Seats', lic.seats === null ? `${lic.seats_used} in use` : `${lic.seats_used} of ${lic.seats} in use`)}
          {row('Expires', lic.expires_at ? `${fmtDate(lic.expires_at)}${days === null ? '' : days < 0 ? ` (${-days} ${days === -1 ? 'day' : 'days'} ago)` : ` (${days} ${days === 1 ? 'day' : 'days'} left)`}` : 'Not set')}
          {row('Date checked by', !lic.clock ? 'Not checked' : lic.clock.source === 'ntp' ? 'Verified by internet time' : "This computer's clock")}
        </dl>
        {lic.read_only && <p className="mt-3 text-sm text-warn">Read-only mode is on: you can look but changes are blocked.</p>}
      </section>
      {owner ? (
        <section aria-labelledby="lic-a" className="card mt-4 max-w-xl" data-guide="lic-activate">
          {lic.offer ? <details><summary id="lic-a" className="cursor-pointer font-semibold">Have a key instead?</summary><div className="mt-3"><KeyForm onDone={reload} /></div></details>
            : <><h2 id="lic-a" className="mb-2 font-semibold">Activate or renew</h2><KeyForm onDone={reload} /></>}
          <p className="mt-3 text-sm">Need a new key? <a className="link" data-guide="lic-request" href="#/purchase">Request a licence</a></p>
        </section>
      ) : <p className="mt-4 max-w-xl text-sm text-muted">Ask the owner to activate or renew the licence.</p>}
    </>
  )
}

interface Plan { key: string; name: string; seats: number; price: string }
export function PurchaseView({ owner, backHref }: { owner: boolean; backHref: string }) {
  const s = useFetch<{ plans: Plan[] }>('/license/plans')
  const [plan, setPlan] = useState('')
  const [seats, setSeats] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const done = useRef<HTMLDivElement>(null)
  const plans = s.data?.plans ?? []
  useEffect(() => { if (plans.length && !plan) { setPlan(plans[0].key); setSeats(String(plans[0].seats)) } }, [plans, plan])
  useEffect(() => { if (sent) done.current?.focus() }, [sent])
  const email = (getAccount() ?? '').includes('@') ? getAccount() : 'the email address on your account'
  const submit = async () => {
    if (busy) return
    const n = Number(seats)
    if (!plan) return setErr('Choose a plan.')
    if (!Number.isInteger(n) || n < 1 || n > 1000) return setErr('Seats must be a whole number from 1 to 1000.')
    setBusy(true); setErr('')
    try { await api('POST', '/license/request', { plan, seats: n, note: note.trim() || undefined }); setSent(true) }
    catch (e) {
      setErr(e instanceof ApiError && e.code === 'email_needed' ? 'Your account needs a verified email before we can send a licence. Add a verified email to the owner account, then try again.' : msg(e))
    } finally { setBusy(false) }
  }
  return (
    <>
      <PageHeader back={{ href: backHref, label: 'Back' }} title="Get a licence" description="Pick a plan and tell us how many people will sign in. Prices are agreed with our team, there is no card payment here." />
      {!owner ? <p role="alert" className="card max-w-xl text-muted">Only the owner can request a licence. Ask the owner.</p> : sent ? (
        <div ref={done} tabIndex={-1} role="status" className="card max-w-xl border-l-4 border-l-accent">
          <h2 className="font-semibold">Request sent</h2>
          <p className="mt-1">We emailed you and our team. We will send your licence key to {email}.</p>
          <p className="mt-3"><a className="link" href={backHref}>Back</a></p>
        </div>
      ) : (
        <>
          <Async2 s={s} />
          {!s.loading && !s.error && plans.length === 0 && <EmptyState title="No plans are available yet." />}
          {plans.length > 0 && <>
            <ul aria-label="Plans" className="mb-4 grid gap-3 sm:grid-cols-3">
              {plans.map(p => (
                <li key={p.key} className={`card ${p.key === plan ? 'border-accent' : ''}`}>
                  <h2 className="text-lg font-semibold">{p.name}</h2>
                  {p.key === plan && <p className="text-sm font-semibold text-accent">Selected</p>}
                  <p className="text-sm text-muted">{p.seats} seats</p>
                  <p className="mt-2 font-semibold">{p.price}</p>
                </li>
              ))}
            </ul>
            <form className="card grid max-w-xl gap-3" onSubmit={e => { e.preventDefault(); submit() }} aria-label="Licence request">
              <label className="flex flex-col gap-1 text-sm font-semibold">Plan
                <select className="input font-normal" value={plan} onChange={e => { setPlan(e.target.value); setSeats(String(plans.find(p => p.key === e.target.value)?.seats ?? seats)) }}>
                  {plans.map(p => <option key={p.key} value={p.key}>{p.name} ({p.seats} seats)</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">Seats
                <input className="input w-32 font-normal" type="number" min={1} max={1000} inputMode="numeric" value={seats} onChange={e => setSeats(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">Note (optional)
                <textarea className="input min-h-20 py-2 font-normal" maxLength={500} value={note} onChange={e => setNote(e.target.value)} />
              </label>
              {err && <p role="alert" className="text-sm text-warn">{err}</p>}
              <div><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Sending...' : 'Send request'}</button></div>
            </form>
          </>}
        </>
      )}
    </>
  )
}

// Loading / error for the plans list only (the form itself is not hidden by an error banner in the same place as Async would).
function Async2({ s }: { s: { loading: boolean; error?: string; data?: unknown; reload: () => void } }) {
  if (s.error) return <div role="alert" className="card mb-4 border-warn bg-warn-bg text-warn"><p>{s.error}</p><button type="button" className="btn mt-3" onClick={s.reload}>Retry loading</button></div>
  if (s.loading && !s.data) return <Skeleton rows={3} shape="cards" />
  return null
}

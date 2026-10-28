import { useRef, useState } from 'react'
import { api, ApiError, getAccount, MOCK } from './api'
import { ActionError, Async, PageHeader, msg, useAction, useFetch } from './ui'
import { useToast } from './Toast'
import { TelegramLinkControls } from './TelegramLink'

interface Member { id: string; name: string; username: string | null; role: 'owner' | 'staff'; role_key?: string; role_name?: string; active: boolean; has_password: boolean; sessions: number; telegram_linked?: boolean }

interface Invite { id: string; email: string; role_key: string; role_name: string; status: 'pending' | 'accepted' | 'revoked' | 'expired'; invited_by_name?: string; created_at: string; expires_at: string }

// Owner: invite by email. The person sets their own name, username and password on #/invite. Accepted and revoked ones are not listed (the person shows above).
function Invites({ opts, onChange }: { opts: { key: string; name: string }[]; onChange: () => void }) {
  const s = useFetch<Invite[]>('/invites')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('staff')
  const [formErr, setFormErr] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busyId, setBusyId] = useState('')
  const [rowErr, setRowErr] = useState('')
  const a = useAction()
  const toast = useToast()
  const list = (s.data ?? []).filter(i => i.status === 'pending' || i.status === 'expired')
  const send = () => {
    const em = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) || em.length > 254) return setFormErr('Enter a valid email address.')
    setFormErr('')
    a.run(async () => { await api('POST', '/invites', { email: em, role }); setEmail(''); toast(`Invitation sent to ${em}`); s.reload(); onChange() })
  }
  const row = async (i: Invite, fn: () => Promise<unknown>, done: string) => {
    if (busyId) return
    setBusyId(i.id); setRowErr('')
    try { await fn(); toast(done); s.reload() } catch (e) { setRowErr(msg(e)); if (e instanceof ApiError && e.status === 409) s.reload() } finally { setBusyId(''); setConfirm('') }  // 409: it changed meanwhile, show the current list
  }
  return (
    <section className="mt-8 border-t border-soft pt-6" aria-labelledby="inv" data-tour="team-invite">
      <h2 id="inv" className="text-base font-semibold">Invite by email</h2>
      <p className="mb-2 text-sm text-muted">We email a link. The person chooses their own username and password, so you never see it.</p>
      <form className="card grid max-w-xl gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" noValidate onSubmit={e => { e.preventDefault(); send() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">Email address
          <input className="input font-normal" type="email" name="invite_email" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={254} value={email}
            aria-invalid={formErr ? true : undefined} aria-describedby={formErr ? 'inv-err' : undefined} onChange={e => { setEmail(e.target.value); setFormErr('') }} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Role
          <select className="input font-normal" value={role} onChange={e => setRole(e.target.value)}>{opts.map(o => <option key={o.key} value={o.key}>{o.name}</option>)}</select></label>
        <div><button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? 'Sending...' : 'Send invitation'}</button></div>
        {formErr && <p id="inv-err" role="alert" className="text-sm text-warn sm:col-span-2">{formErr}</p>}
      </form>
      <ActionError err={a.err} onRetry={send} label="Try again" />
      <h3 className="mt-6 text-base font-semibold">Pending invitations</h3>
      {rowErr && <p role="alert" className="mt-2 text-sm text-warn">{rowErr}</p>}
      <div className="mt-2">
        <Async s={s} rows={2} empty={!list.length} emptyText="No pending invitations." emptyHint="Invite a colleague by email and they show up here until they accept.">
          <ul className="grid gap-2">
            {list.map(i => (
              <li key={i.id} className="card">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 break-all font-semibold">{i.email}</span>
                  <span className="badge">{i.role_name}</span>
                  <span className={i.status === 'expired' ? 'badge badge-warn' : 'badge'}>{i.status === 'expired' ? 'Expired' : 'Pending'}</span>
                </p>
                <p className="mt-1 text-sm text-muted">Sent {relTime(i.created_at)}. {i.status === 'expired' ? `Expired ${relTime(i.expires_at)}.` : `Expires ${relTime(i.expires_at)}.`}</p>
                {confirm === i.id ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={`Confirm revoking the invitation for ${i.email}`}>
                    <span className="text-sm font-semibold">Revoke the invitation for {i.email}?</span>
                    <button type="button" className="btn btn-danger" autoFocus aria-disabled={!!busyId || undefined} onClick={() => row(i, () => api('DELETE', `/invites/${i.id}`), `Invitation for ${i.email} revoked.`)}>Yes, revoke<span className="sr-only"> {i.email}</span></button>
                    <button type="button" className="btn" onClick={() => { setConfirm(''); requestAnimationFrame(() => document.getElementById('rv-' + i.id)?.focus()) }}>Cancel</button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn" aria-disabled={!!busyId || undefined} onClick={() => row(i, () => api('POST', `/invites/${i.id}/resend`), `Invitation sent again to ${i.email}.`)}>{busyId === i.id ? 'Sending...' : 'Resend'}<span className="sr-only"> invitation to {i.email}</span></button>
                    {i.status === 'pending' && <button id={'rv-' + i.id} type="button" className="btn" onClick={() => setConfirm(i.id)}>Revoke<span className="sr-only"> invitation to {i.email}</span></button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Async>
      </div>
    </section>
  )
}

// Owner: who can sign in. Passwords are never shown; a reset signs that person out everywhere.
export function TeamView({ owner, meId }: { owner: boolean; meId: string }) {
  const s = useFetch<Member[]>('/users')
  const roles = useFetch<{ roles: { key: string; name: string }[] }>('/roles')
  const opts = roles.data?.roles ?? [{ key: 'owner', name: 'Owner' }, { key: 'staff', name: 'Staff (no cost or margin)' }]  // class options until /roles answers
  const [pick, setPick] = useState<Record<string, string>>({})
  const a = useAction()
  const last = useRef<() => void>(undefined)
  const [f, setF] = useState({ name: '', username: '', role: 'staff', password: '' })
  const [reset, setReset] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const toast = useToast()
  if (!owner) return <><PageHeader title="Team" /><p className="card text-muted">Owner only.</p></>

  const run = (fn: () => Promise<unknown>, done: string) => {
    last.current = () => run(fn, done); setErr('')
    a.run(async () => { await fn(); toast(done); s.reload() })
  }
  const add = () => {
    if (!f.name.trim() || !f.username.trim()) return setErr('Enter a name and a username.')
    if (f.password.length < 10) return setErr('The password needs at least 10 characters.')
    run(async () => { await api('POST', '/users', { ...f, name: f.name.trim(), username: f.username.trim() }); setF({ name: '', username: '', role: 'staff', password: '' }) }, `${f.name.trim()} can now sign in.`)
  }
  const edit = (m: Member, body: object, done: string) => run(() => api('POST', `/users/${m.id}`, body), done)

  return (
    <>
      <PageHeader title="Team" description="People who can sign in. Staff cannot see cost or margin. Deactivating someone ends their session at once." />
      {roles.error && <p role="alert" className="mb-2 text-sm text-warn">Could not load the role list, so only the standard roles are shown.</p>}
      {err && <p role="alert" className="mb-2 text-sm text-warn">{err}</p>}
      <ActionError err={a.err} onRetry={() => last.current?.()} label="Try again" />
      <Async s={s} rows={3} empty={!s.data?.length} emptyText="No users yet." emptyHint="Add the first person below." >
        <ul className="grid gap-2">
          {s.data?.map(m => (
            <li key={m.id} className="card">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{m.name}</span>
                <span className="badge">{m.role_name ?? m.role}</span>
                {!m.active && <span className="badge badge-warn">Deactivated</span>}
                {m.id === meId && <span className="badge">You</span>}
              </p>
              <p className="mt-1 text-sm text-muted">
                {m.username ? <>Signs in as <span className="font-semibold text-ink">{m.username}</span></> : 'No sign-in account yet'}
                {m.sessions > 0 && ` · ${m.sessions} active ${m.sessions === 1 ? 'session' : 'sessions'}`}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                <span>Telegram: <span className="font-semibold text-ink">{m.telegram_linked ? 'Linked' : 'Not linked'}</span></span>
                <TelegramLinkControls base={`/users/${m.id}`} who={m.name} linked={!!m.telegram_linked} onChange={s.reload} />
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm font-semibold">New password for {m.name}
                  <input className="input font-normal" type="password" autoComplete="new-password" value={reset[m.id] ?? ''}
                    onChange={e => setReset({ ...reset, [m.id]: e.target.value })} />
                </label>
                <button type="button" className="btn" onClick={() => {
                  const p = reset[m.id] ?? ''
                  if (p.length < 10) return setErr('The password needs at least 10 characters.')
                  edit(m, { password: p }, `Password for ${m.name} changed.`); setReset({ ...reset, [m.id]: '' })
                }}>Set password for {m.name}</button>
                {(() => {
                  const cur = m.role_key ?? m.role, sel = pick[m.id] ?? cur, changed = sel !== cur
                  return <>
                    <label className="flex flex-col gap-1 text-sm font-semibold">Role for {m.name}
                      <select className="input font-normal" value={sel} aria-describedby={changed ? `rw-${m.id}` : undefined} onChange={e => setPick({ ...pick, [m.id]: e.target.value })}>
                        {opts.map(o => <option key={o.key} value={o.key}>{o.name}</option>)}</select></label>
                    <button type="button" className="btn" aria-disabled={!changed || undefined} onClick={() => {
                      if (changed) edit(m, { role: sel }, `${m.name} now holds the ${opts.find(o => o.key === sel)?.name ?? sel} role.`)
                    }}>Change role for {m.name}</button>
                    {changed && <p id={`rw-${m.id}`} className="basis-full text-sm font-semibold text-warn">They will be signed out on every device when you save a new role.</p>}
                  </>
                })()}
                <button type="button" className={m.active ? 'btn btn-danger' : 'btn'} onClick={() => edit(m, { active: !m.active }, `${m.name} ${m.active ? 'deactivated' : 'reactivated'}.`)}>
                  {m.active ? 'Deactivate' : 'Reactivate'} {m.name}</button>
              </div>
            </li>
          ))}
        </ul>
      </Async>
      <Invites opts={opts} onChange={s.reload} />
      <section className="mt-8 border-t border-soft pt-6" aria-labelledby="newu">
        <h2 id="newu" className="text-base font-semibold">Add with a password</h2>
        <p className="text-sm text-muted">For people without an email address. You set the first password and tell them in person.</p>
        <form className="mt-2 grid max-w-xl gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); add() }}>
          <label className="flex flex-col gap-1 text-sm font-semibold">Name
            <input className="input font-normal" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">Username (letters, numbers, . _ -)
            <input className="input font-normal" autoCapitalize="none" value={f.username} onChange={e => setF({ ...f, username: e.target.value })} /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">Role
            <select className="input font-normal" value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>
              {opts.map(o => <option key={o.key} value={o.key}>{o.name}</option>)}</select></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">First password (10+ characters)
            <input className="input font-normal" type="password" autoComplete="new-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></label>
          <div className="sm:col-span-2"><button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? 'Working...' : 'Add with a password'}</button></div>
        </form>
      </section>
    </>
  )
}

const MIN_PASSWORD = 10 // server rule (docs/api-contract.md, POST /api/me/password); the common-password check is server-side only

// "Chrome on Windows" from a User-Agent string. No library: order matters (Edge and Opera also say Chrome).
export function deviceLabel(ua: string | null): string {
  const u = ua ?? ''
  const browser = /Edg(e|A|iOS)?\//.test(u) ? 'Edge' : /OPR\/|Opera/.test(u) ? 'Opera' : /Firefox\/|FxiOS/.test(u) ? 'Firefox'
    : /Chrome\/|CriOS/.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : ''
  const os = /Windows/.test(u) ? 'Windows' : /Android/.test(u) ? 'Android' : /iPhone|iPad|iPod/.test(u) ? 'iOS' : /Mac OS X|Macintosh/.test(u) ? 'macOS'
    : /CrOS/.test(u) ? 'ChromeOS' : /Linux/.test(u) ? 'Linux' : ''
  return browser && os ? `${browser} on ${os}` : browser || os || 'Unknown device'
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
export function relTime(iso: string | null): string {
  if (!iso) return 'unknown'
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  for (const [unit, secs] of [['day', 86400], ['hour', 3600], ['minute', 60]] as const)
    if (Math.abs(s) >= secs) return rtf.format(Math.trunc(s / secs), unit)
  return 'just now'
}

interface Session { id: string; created_at: string; last_seen_at: string | null; user_agent: string | null; current: boolean }

// Own devices. The current one is signed out with the header Sign out button, never by DELETE of its own row.
function Sessions() {
  const s = useFetch<Session[]>('/me/sessions')
  const [confirm, setConfirm] = useState('')
  const toast = useToast()
  const a = useAction()
  const last = useRef<() => Promise<void>>(undefined)
  const head = useRef<HTMLHeadingElement>(null)
  const go = (fn: () => Promise<void>) => { last.current = fn; a.run(fn) }
  const done = (text: string) => { setConfirm(''); toast(text); s.reload(); head.current?.focus() }
  const others = (s.data ?? []).filter(x => !x.current).length
  return (
    <section className="mt-8 max-w-xl border-t border-soft pt-6" aria-labelledby="dev">
      <h2 id="dev" ref={head} tabIndex={-1} className="text-base font-semibold">Devices and sessions</h2>
      <p className="mb-3 text-sm text-muted">Places you are signed in. Sign out any you do not recognise.</p>
      <Async s={s} rows={2} empty={!s.data?.length} emptyText="No active sessions.">
        <ul className="grid gap-2">
          {s.data?.map(x => {
            const name = deviceLabel(x.user_agent)
            return (
              <li key={x.id} className="card">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 break-words font-semibold">{name}</span>
                  {x.current && <span className="badge">This device</span>}
                </p>
                <p className="mt-1 text-sm text-muted">Signed in {relTime(x.created_at)}. Last active {relTime(x.last_seen_at)}.</p>
                {!x.current && (confirm === x.id ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={`Confirm signing out ${name}`}>
                    <span className="text-sm font-semibold">Sign out {name}?</span>
                    <button type="button" className="btn btn-danger" autoFocus aria-disabled={a.busy || undefined}
                      onClick={() => go(async () => { await api('DELETE', `/me/sessions/${x.id}`); done(`Signed out ${name}.`) })}>Yes, sign out<span className="sr-only"> {name}</span></button>
                    <button type="button" className="btn" onClick={() => { setConfirm(''); requestAnimationFrame(() => document.getElementById('so-' + x.id)?.focus()) }}>Cancel</button>
                  </div>
                ) : <div className="mt-3"><button id={'so-' + x.id} type="button" className="btn" onClick={() => setConfirm(x.id)}>Sign out<span className="sr-only"> {name}</span></button></div>)}
              </li>
            )
          })}
        </ul>
        {others > 0 && <div className="mt-3"><button type="button" className="btn" aria-disabled={a.busy || undefined}
          onClick={() => go(async () => { const r = await api<{ revoked: number }>('POST', '/me/sessions/revoke-others'); done(`Signed out ${r.revoked} other ${r.revoked === 1 ? 'device' : 'devices'}.`) })}>Sign out all other devices</button></div>}
      </Async>
      <ActionError err={a.err} onRetry={() => last.current && go(last.current)} label="Try again" />
    </section>
  )
}

// Everyone: change own password, then see and end own sessions.
export function AccountView({ name, role, linked, onChange }: { name: string; role: string; linked?: boolean; onChange?: () => void }) {
  const [cur, setCur] = useState('')
  const [nw, setNw] = useState('')
  const [err, setErr] = useState('')
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const username = (getAccount() ?? '').toLowerCase()
  const longEnough = nw.length >= MIN_PASSWORD
  const notUsername = !!nw && nw.toLowerCase() !== username
  const save = async () => {
    if (busy) return
    setErr('')
    if (!longEnough) return setErr(`The new password needs at least ${MIN_PASSWORD} characters.`)
    if (!notUsername) return setErr('The new password cannot be your username.')
    setBusy(true)
    try { await api('POST', '/me/password', { current: cur, new: nw }); setCur(''); setNw(''); toast('Password changed. Your other devices are signed out.') }
    catch (e) {
      setErr(e instanceof ApiError && e.status === 429 ? 'Too many attempts, wait a few minutes and try again.'
        : e instanceof ApiError && e.code === 'weak_password' ? `That password was not accepted: ${e.message}` : msg(e))
    } finally { setBusy(false) }
  }
  const rule = (good: boolean, text: string) => <li className={good ? '' : 'text-muted'}>{good ? 'Met: ' : 'Not yet: '}{text}</li>
  return (
    <>
      <PageHeader title="Account" description={`Signed in as ${name} (${role}).`} />
      <form className="grid max-w-sm gap-3" onSubmit={e => { e.preventDefault(); save() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">Current password
          <input className="input font-normal" type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">New password
          <input className="input font-normal" type="password" autoComplete="new-password" aria-describedby="pw-rules" value={nw} onChange={e => setNw(e.target.value)} /></label>
        <ul id="pw-rules" className="text-sm">
          {rule(longEnough, `at least ${MIN_PASSWORD} characters`)}
          {rule(notUsername, 'different from your username')}
          <li className="text-muted">The server also rejects very common passwords.</li>
        </ul>
        {err && <p role="alert" className="text-sm text-warn">{err}</p>}
        <div><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Changing...' : 'Change password'}</button></div>
      </form>
      <section className="mt-8 max-w-xl border-t border-soft pt-6" aria-labelledby="tgme" data-tour="account-telegram">
        <h2 id="tgme" className="text-base font-semibold">Telegram</h2>
        <p className="mb-3 text-sm text-muted">Link your Telegram to send product photos and supplier price lists to LARIS from your phone.</p>
        <div className="flex flex-wrap items-center gap-2">
          {linked !== undefined && <span>Status: <span className="font-semibold text-ink">{linked ? 'Linked' : 'Not linked'}</span></span>}
          <TelegramLinkControls base="/me" who="yourself" linked={linked} onChange={onChange} />
        </div>
      </section>
      {(MOCK || getAccount()) && <Sessions />}
    </>
  )
}

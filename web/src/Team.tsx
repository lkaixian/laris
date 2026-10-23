import { useRef, useState } from 'react'
import { api, ApiError, getAccount, MOCK } from './api'
import { ActionError, Async, msg, useAction, useFetch } from './ui'

interface Member { id: string; name: string; username: string | null; role: 'owner' | 'staff'; role_key?: string; role_name?: string; active: boolean; has_password: boolean; sessions: number }

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
  const [note, setNote] = useState('')
  if (!owner) return <><h1 tabIndex={-1} className="text-2xl font-semibold">Team</h1><p className="card mt-3 text-muted">Owner only.</p></>

  const run = (fn: () => Promise<unknown>, done: string) => {
    last.current = () => run(fn, done); setErr(''); setNote('')
    a.run(async () => { await fn(); setNote(done); s.reload() })
  }
  const add = () => {
    if (!f.name.trim() || !f.username.trim()) return setErr('Enter a name and a username.')
    if (f.password.length < 10) return setErr('The password needs at least 10 characters.')
    run(async () => { await api('POST', '/users', { ...f, name: f.name.trim(), username: f.username.trim() }); setF({ name: '', username: '', role: 'staff', password: '' }) }, `${f.name.trim()} can now sign in.`)
  }
  const edit = (m: Member, body: object, done: string) => run(() => api('POST', `/users/${m.id}`, body), done)

  return (
    <>
      <h1 tabIndex={-1} className="text-2xl font-semibold">Team</h1>
      <p className="mb-4 text-muted">People who can sign in. Staff cannot see cost or margin. Deactivating someone ends their session at once.</p>
      {err && <p role="alert" className="mb-2 text-sm text-warn">{err}</p>}
      <ActionError err={a.err} onRetry={() => last.current?.()} label="Try again" />
      <p role="status" className="mb-2 text-sm">{note}</p>
      <Async s={s} empty={!s.data?.length} emptyText="No users yet.">
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
      <section className="mt-8 border-t border-soft pt-6" aria-labelledby="newu">
        <h2 id="newu" className="text-base font-semibold">Add a person</h2>
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
          <div className="sm:col-span-2"><button type="submit" className="btn btn-primary">Add person</button></div>
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
  const [note, setNote] = useState('')
  const a = useAction()
  const last = useRef<() => Promise<void>>(undefined)
  const head = useRef<HTMLHeadingElement>(null)
  const go = (fn: () => Promise<void>) => { last.current = fn; setNote(''); a.run(fn) }
  const done = (text: string) => { setConfirm(''); setNote(text); s.reload(); head.current?.focus() }
  const others = (s.data ?? []).filter(x => !x.current).length
  return (
    <section className="mt-8 max-w-xl border-t border-soft pt-6" aria-labelledby="dev">
      <h2 id="dev" ref={head} tabIndex={-1} className="text-base font-semibold">Devices and sessions</h2>
      <p className="mb-3 text-sm text-muted">Places you are signed in. Sign out any you do not recognise.</p>
      <p role="status" className="mb-2 text-sm">{note}</p>
      <Async s={s} empty={!s.data?.length} emptyText="No active sessions.">
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
export function AccountView({ name, role }: { name: string; role: string }) {
  const [cur, setCur] = useState('')
  const [nw, setNw] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const username = (getAccount() ?? '').toLowerCase()
  const longEnough = nw.length >= MIN_PASSWORD
  const notUsername = !!nw && nw.toLowerCase() !== username
  const save = async () => {
    if (busy) return
    setErr(''); setNote('')
    if (!longEnough) return setErr(`The new password needs at least ${MIN_PASSWORD} characters.`)
    if (!notUsername) return setErr('The new password cannot be your username.')
    setBusy(true)
    try { await api('POST', '/me/password', { current: cur, new: nw }); setCur(''); setNw(''); setNote('Password changed. Your other devices are signed out.') }
    catch (e) {
      setErr(e instanceof ApiError && e.status === 429 ? 'Too many attempts, wait a few minutes and try again.'
        : e instanceof ApiError && e.code === 'weak_password' ? `That password was not accepted: ${e.message}` : msg(e))
    } finally { setBusy(false) }
  }
  const rule = (good: boolean, text: string) => <li className={good ? '' : 'text-muted'}>{good ? 'Met: ' : 'Not yet: '}{text}</li>
  return (
    <>
      <h1 tabIndex={-1} className="text-2xl font-semibold">Account</h1>
      <p className="mb-4 text-muted">Signed in as {name} ({role}).</p>
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
        <p role="status" className="text-sm">{note}</p>
        <div><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Changing...' : 'Change password'}</button></div>
      </form>
      {(MOCK || getAccount()) && <Sessions />}
    </>
  )
}

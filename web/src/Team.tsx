import { useState } from 'react'
import { api } from './api'
import { Async, msg, useFetch } from './ui'

interface Member { id: string; name: string; username: string | null; role: 'owner' | 'staff'; active: boolean; has_password: boolean; sessions: number }

// Owner: who can sign in. Passwords are never shown; a reset signs that person out everywhere.
export function TeamView({ owner, meId }: { owner: boolean; meId: string }) {
  const s = useFetch<Member[]>('/users')
  const [f, setF] = useState({ name: '', username: '', role: 'staff', password: '' })
  const [reset, setReset] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  if (!owner) return <><h1 tabIndex={-1} className="text-2xl font-semibold">Team</h1><p className="card mt-3 text-muted">Owner only.</p></>

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setErr(''); setNote('')
    try { await fn(); setNote(done); s.reload() } catch (e) { setErr(msg(e)) }
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
      <p role="status" className="mb-2 text-sm">{note}</p>
      <Async s={s} empty={!s.data?.length} emptyText="No users yet.">
        <ul className="grid gap-2">
          {s.data?.map(m => (
            <li key={m.id} className="card">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{m.name}</span>
                <span className="badge">{m.role}</span>
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
                <button type="button" className="btn" onClick={() => edit(m, { role: m.role === 'owner' ? 'staff' : 'owner' }, `${m.name} is now ${m.role === 'owner' ? 'staff' : 'an owner'}.`)}>
                  Make {m.name} {m.role === 'owner' ? 'staff' : 'owner'}</button>
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
              <option value="staff">Staff (no cost or margin)</option><option value="owner">Owner</option></select></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">First password (10+ characters)
            <input className="input font-normal" type="password" autoComplete="new-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></label>
          <div className="sm:col-span-2"><button type="submit" className="btn btn-primary">Add person</button></div>
        </form>
      </section>
    </>
  )
}

// Everyone: change own password.
export function AccountView({ name, role }: { name: string; role: string }) {
  const [cur, setCur] = useState('')
  const [nw, setNw] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const save = async () => {
    setErr(''); setNote('')
    if (nw.length < 10) return setErr('The new password needs at least 10 characters.')
    try { await api('POST', '/me/password', { current: cur, new: nw }); setCur(''); setNw(''); setNote('Password changed. Your other devices are signed out.') }
    catch (e) { setErr(msg(e)) }
  }
  return (
    <>
      <h1 tabIndex={-1} className="text-2xl font-semibold">Account</h1>
      <p className="mb-4 text-muted">Signed in as {name} ({role}).</p>
      <form className="grid max-w-sm gap-3" onSubmit={e => { e.preventDefault(); save() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">Current password
          <input className="input font-normal" type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">New password (10+ characters)
          <input className="input font-normal" type="password" autoComplete="new-password" value={nw} onChange={e => setNw(e.target.value)} /></label>
        {err && <p role="alert" className="text-sm text-warn">{err}</p>}
        <p role="status" className="text-sm">{note}</p>
        <div><button type="submit" className="btn btn-primary">Change password</button></div>
      </form>
    </>
  )
}

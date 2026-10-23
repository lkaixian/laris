import { useEffect, useRef, useState } from 'react'
import { login, setAccessToken, takeNotice, ApiError } from './api'
import { Brand, ThemeToggle } from './ui'

const COOLDOWN_MS = 3000 // button pause after a 429, so a held Enter key does not hammer the server

// Sign-in screen. Accounts are created by an owner (Team page) or with `scripts/create_token.py account`.
export default function Login({ dark, setDark, onDone }: { dark: boolean; setDark: (d: boolean) => void; onDone: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [token, setTokenText] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [cooling, setCooling] = useState(false)
  const [notice] = useState(takeNotice)  // 'Your session ended' after a server-side sign out; read once
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => { document.title = 'Sign in · LARIS'; first.current?.focus() }, [])

  const submit = async () => {
    if (busy || cooling) return
    if (!username.trim() || !password) return setErr('Enter your username and password.')
    setBusy(true); setErr('')
    try { await login(username.trim(), password); onDone() }
    catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not sign in.')
      if (e instanceof ApiError && e.status === 429) { setCooling(true); setTimeout(() => setCooling(false), COOLDOWN_MS) }
      setPassword('')
      first.current?.focus()
    } finally { setBusy(false) }
  }
  const submitToken = () => {
    if (!token.trim()) return setErr('Paste the access token.')
    setAccessToken(token)
    onDone()
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-md content-center gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <Brand dark={dark} />
        <ThemeToggle dark={dark} setDark={setDark} />
      </div>
      <form className="card grid gap-4" onSubmit={e => { e.preventDefault(); submit() }} aria-labelledby="signin">
        <div>
          <h1 id="signin" className="text-2xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Use the account your owner created for you.</p>
        </div>
        <label className="flex flex-col gap-1 text-sm font-semibold">Username
          <input ref={first} className="input font-normal" autoComplete="username" autoCapitalize="none" spellCheck={false}
            value={username} onChange={e => setUsername(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Password
          <span className="flex gap-2">
            <input className="input min-w-0 flex-1 font-normal" type={show ? 'text' : 'password'} autoComplete="current-password"
              value={password} onChange={e => setPassword(e.target.value)} />
            <button type="button" className="btn" aria-pressed={show} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}<span className="sr-only"> password</span></button>
          </span>
        </label>
        {notice && !err && <p role="status" className="text-sm">{notice}</p>}
        {err && <p role="alert" className="text-sm text-warn">{err}</p>}
        <button type="submit" className="btn btn-primary" aria-disabled={busy || cooling || undefined}>{busy ? 'Signing in...' : cooling ? 'Wait a moment...' : 'Sign in'}</button>
      </form>
      <details className="text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center text-muted">Demo deployment: use an access token instead</summary>
        <form className="mt-2 flex gap-2" onSubmit={e => { e.preventDefault(); submitToken() }}>
          <label className="sr-only" htmlFor="tok">Access token</label>
          <input id="tok" className="input min-w-0 flex-1" type="password" autoComplete="off" value={token} onChange={e => setTokenText(e.target.value)} />
          <button type="submit" className="btn">Use token</button>
        </form>
      </details>
    </main>
  )
}

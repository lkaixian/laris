import { useEffect, useRef, useState } from 'react'
import { MOCK, login, setAccessToken, takeNotice, takePrefill, ApiError } from './api'
import type { ReactNode } from 'react'
import { Brand, ThemeToggle } from './ui'

const COOLDOWN_MS = 3000 // button pause after a 429, so a held Enter key does not hammer the server

// Full-bleed centred page for sign-in, register, verify and reset: logo, theme toggle, then the card(s). No sidebar.
export function AuthPage({ dark, setDark, children }: { dark: boolean; setDark: (d: boolean) => void; children: ReactNode }) {
  return (
    <main id="main" className="mx-auto grid min-h-screen max-w-md content-center gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <Brand dark={dark} />
        <ThemeToggle dark={dark} setDark={setDark} />
      </div>
      {children}
    </main>
  )
}

// Sign-in screen. Accounts come from self-service sign-up (#/register), an owner (Team page) or `scripts/create_token.py account`.
// `demo` is true when the server still allows the shared access token (auth config says login is not required).
export default function Login({ dark, setDark, onDone, demo }: { dark: boolean; setDark: (d: boolean) => void; onDone: () => void; demo: boolean }) {
  const [username, setUsername] = useState(takePrefill)  // the email from sign-up or reset, when there is one
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [caps, setCaps] = useState(false)
  const [token, setTokenText] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [cooling, setCooling] = useState(false)
  const [notice] = useState(takeNotice)  // 'Your session ended' or 'Your account is ready'; read once
  const first = useRef<HTMLInputElement>(null)
  const pw = useRef<HTMLInputElement>(null)
  useEffect(() => { document.title = 'Sign in · LARIS'; (username ? pw : first).current?.focus() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (busy || cooling) return
    if (!username.trim() || !password) { setErr('Enter your email or username and your password.'); (username.trim() ? pw : first).current?.focus(); return }
    setBusy(true); setErr('')
    try { await login(username.trim(), password); onDone() }
    catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not sign in.')
      if (e instanceof ApiError && e.status === 429) { setCooling(true); setTimeout(() => setCooling(false), COOLDOWN_MS) }
      setPassword('')
      pw.current?.focus()
    } finally { setBusy(false) }
  }
  const submitToken = () => {
    if (!token.trim()) return setErr('Paste the access token.')
    setAccessToken(token)
    onDone()
  }

  return (
    <AuthPage dark={dark} setDark={setDark}>
      <form className="card grid gap-4" onSubmit={e => { e.preventDefault(); submit() }} aria-labelledby="signin" noValidate>
        <div>
          <h1 id="signin" tabIndex={-1} className="text-2xl font-semibold">Sign in to LARIS</h1>
          <p className="mt-1 text-sm text-muted">Quote with confidence when supplier prices move.</p>
        </div>
        {notice && !err && <p role="status" className="rounded-ui border border-soft bg-tint p-2 text-sm">{notice}</p>}
        <label className="flex flex-col gap-1 text-sm font-semibold">Email or username
          <input ref={first} className="input font-normal" autoComplete="username" autoCapitalize="none" spellCheck={false}
            aria-describedby={err ? 'signin-err' : undefined} value={username} onChange={e => setUsername(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Password
          <span className="flex gap-2">
            <input ref={pw} className="input min-w-0 flex-1 font-normal" type={show ? 'text' : 'password'} autoComplete="current-password"
              aria-describedby={err ? 'signin-err' : caps ? 'signin-caps' : undefined}
              value={password} onChange={e => setPassword(e.target.value)}
              onKeyUp={e => setCaps(e.getModifierState('CapsLock'))} onBlur={() => setCaps(false)} />
            <button type="button" className="btn" aria-pressed={show} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}<span className="sr-only"> password</span></button>
          </span>
        </label>
        {caps && <p id="signin-caps" role="status" className="text-sm text-muted">Caps Lock is on.</p>}
        {err && <p id="signin-err" role="alert" className="text-sm text-warn">{err}</p>}
        <button type="submit" className="btn btn-primary" aria-disabled={busy || cooling || undefined}>{busy ? 'Signing in...' : cooling ? 'Wait a moment...' : 'Sign in'}</button>
        <p className="flex flex-wrap items-center justify-between gap-x-4 text-sm">
          <a className="link inline-flex min-h-11 items-center" href="#/forgot">Forgot password?</a>
          <a className="link inline-flex min-h-11 items-center" href="#/register">Create a business account</a>
        </p>
      </form>
      {demo && !MOCK && (
        <details className="text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center text-muted">Demo deployment: use an access token instead</summary>
          <form className="mt-2 flex gap-2" onSubmit={e => { e.preventDefault(); submitToken() }}>
            <label className="sr-only" htmlFor="tok">Access token</label>
            <input id="tok" className="input min-w-0 flex-1" type="password" autoComplete="off" value={token} onChange={e => setTokenText(e.target.value)} />
            <button type="submit" className="btn">Use token</button>
          </form>
        </details>
      )}
    </AuthPage>
  )
}

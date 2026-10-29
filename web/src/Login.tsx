import { useEffect, useRef, useState } from 'react'
import { MOCK, login, setAccessToken, takeNotice, takePrefill, ApiError } from './api'
import type { Business } from './api'
import type { ReactNode } from 'react'
import { Brand, ThemeToggle } from './ui'

const COOLDOWN_MS = 3000 // button pause after a 429, so a held Enter key does not hammer the server

// Last business chosen per email, so the picker preselects it. Convenience only: a blocked or corrupt store is ignored.
const BIZ_KEY = 'laris.biz'
const lastBiz = (email: string): string => { try { return JSON.parse(localStorage.getItem(BIZ_KEY) ?? '{}')[email.toLowerCase()] ?? '' } catch { return '' } }
const rememberBiz = (email: string, id: string) => { try { const m = JSON.parse(localStorage.getItem(BIZ_KEY) ?? '{}'); m[email.toLowerCase()] = id; localStorage.setItem(BIZ_KEY, JSON.stringify(m)) } catch { /* storage blocked */ } }

// Full-bleed centred page for sign-in, register, verify and reset: logo, theme toggle, then the card(s). No sidebar.
// The logo always links to sign-in; `onBrand` lets a page intercept the click (e.g. confirm before leaving a half-done sign-up).
export function AuthPage({ dark, setDark, children, onBrand }: { dark: boolean; setDark: (d: boolean) => void; children: ReactNode; onBrand?: (e: { preventDefault: () => void }) => void }) {
  return (
    <main id="main" className="mx-auto grid min-h-screen max-w-md content-center gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <a href="#/login" aria-label="LARIS, go to sign in" onClick={onBrand} className="inline-flex min-h-11 items-center"><Brand dark={dark} /></a>
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
  const [choices, setChoices] = useState<Business[]>()  // set after 409 choose_business: the picker step. Credentials stay in this component's memory only.
  const [biz, setBiz] = useState('')
  const first = useRef<HTMLInputElement>(null)
  const pw = useRef<HTMLInputElement>(null)
  useEffect(() => { document.title = 'Sign in · LARIS'; (username ? pw : first).current?.focus() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (choices) document.getElementById('biz-' + biz)?.focus() }, [choices])  // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (businessId?: string) => {
    if (busy || cooling) return
    if (!username.trim() || !password) { setErr('Enter your email or username and your password.'); (username.trim() ? pw : first).current?.focus(); return }
    setBusy(true); setErr('')
    try { await login(username.trim(), password, businessId); if (businessId) rememberBiz(username.trim(), businessId); onDone() }
    catch (e) {
      if (e instanceof ApiError && e.code === 'choose_business' && e.businesses?.length) {
        const l = lastBiz(username.trim())
        setBiz(e.businesses.some(b => b.id === l) ? l : e.businesses[0].id); setChoices(e.businesses); setBusy(false); return
      }
      setChoices(undefined)  // any other answer (wrong password, 429) goes back to the form with the normal error
      setErr(e instanceof ApiError ? e.message : 'Could not sign in.')
      if (e instanceof ApiError && e.status === 429) { setCooling(true); setTimeout(() => setCooling(false), COOLDOWN_MS) }
      if (!(e instanceof ApiError) || (e.status >= 400 && e.status < 500 && e.status !== 429)) setPassword('')  // keep it on network, timeout and server errors: nothing was wrong with the password
      pw.current?.focus()
    } finally { setBusy(false) }
  }
  const submitToken = () => {
    if (!token.trim()) return setErr('Paste the access token.')
    setAccessToken(token)
    onDone()
  }

  if (choices) return (
    <AuthPage dark={dark} setDark={setDark}>
      <form className="card grid gap-4" onSubmit={e => { e.preventDefault(); submit(biz) }} aria-labelledby="choose-h" noValidate>
        <div>
          <h1 id="choose-h" tabIndex={-1} className="text-2xl font-semibold">Choose a business</h1>
          <p className="mt-1 text-sm text-muted">This email is used by more than one business. Pick the one to sign in to.</p>
        </div>
        <fieldset className="grid gap-2">
          <legend className="sr-only">Business</legend>
          {choices.map(b => (
            <label key={b.id} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-ui border p-3 text-sm font-semibold ${biz === b.id ? 'border-accent bg-tint' : 'border-soft'}`}>
              <input id={'biz-' + b.id} type="radio" name="business" value={b.id} checked={biz === b.id} onChange={() => setBiz(b.id)} />
              <span className="min-w-0 break-words">{b.name}</span>
            </label>
          ))}
        </fieldset>
        {err && <p role="alert" className="text-sm text-warn">{err}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Signing in...' : 'Continue'}</button>
          <button type="button" className="btn" onClick={() => { setChoices(undefined); setErr(''); requestAnimationFrame(() => pw.current?.focus()) }}>Back</button>
        </div>
      </form>
    </AuthPage>
  )

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

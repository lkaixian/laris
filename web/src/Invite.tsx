import { useEffect, useState } from 'react'
import { publicApi, setNotice, setPrefill, ApiError, getToken, getAccount, logout } from './api'
import { AuthPage } from './Login'
import { Card, Checklist, Field } from './Signup'
import { Skeleton, msg } from './ui'

/*
  Accept an invitation: public route #/invite?token=<token>. The token is read once from the hash, the visible URL is cleaned with
  history.replaceState, and the token then lives only in this module variable / component state (never storage, toast or log).
  Contract: POST /api/invites/preview {token}, POST /api/invites/accept {token, name, username, password}.
*/
let kept = ''
function readToken(): string {
  const m = location.hash.match(/[?&]token=([^&]*)/)
  if (m) {
    try { kept = decodeURIComponent(m[1]) } catch { kept = m[1] }
    try { history.replaceState(null, '', location.pathname + location.search + '#/invite') } catch { /* keep the token in the URL if blocked */ }
  }
  return kept
}
const MIN_PASSWORD = 10
const USERNAME = /^[A-Za-z0-9._-]{3,40}$/  // same rule as the server (3 to 40 characters)
interface Preview { business_name: string; role_name: string; email: string }
const gone = 'This invitation is no longer valid'

export default function AcceptInvite({ dark, setDark }: { dark: boolean; setDark: (d: boolean) => void }) {
  const [token] = useState(readToken)
  const [pv, setPv] = useState<Preview>()
  const [state, setState] = useState<'loading' | 'invalid' | 'error' | 'ok'>(token ? 'loading' : 'invalid')
  const [loadErr, setLoadErr] = useState('')
  const [tries, setTries] = useState(0)
  const [f, setF] = useState({ name: '', username: '', password: '', confirm: '' })
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [formErr, setFormErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [wasIn] = useState(() => !!getToken())  // opened while signed in: the new account is a different one, so end this session on success
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF(p => ({ ...p, [k]: e.target.value })); setErrs(p => ({ ...p, [k]: '' })) }

  useEffect(() => {
    if (!token) return
    let live = true
    setState('loading')
    publicApi<Preview>('POST', '/invites/preview', { token }).then(
      p => { if (live) { setPv(p); setState('ok') } },
      e => { if (!live) return; if (e instanceof ApiError && e.status === 404) setState('invalid'); else { setLoadErr(msg(e)); setState('error') } })
    return () => { live = false }
  }, [token, tries])

  const focusBad = () => requestAnimationFrame(() => document.querySelector<HTMLElement>('main [aria-invalid=true]')?.focus())
  const submit = async () => {
    if (busy || !pv) return
    const e: Record<string, string> = {}
    const name = f.name.trim(), username = f.username.trim()
    if (name.length < 2 || name.length > 80) e.name = 'Your name needs 2 to 80 characters.'
    if (!username) e.username = 'Choose a username.'
    else if (!USERNAME.test(username)) e.username = 'Use 3 to 40 letters, numbers, dots, dashes or underscores.'
    if (f.password.length < MIN_PASSWORD) e.password = `The password needs at least ${MIN_PASSWORD} characters.`
    else if ([pv.email, pv.email.split('@')[0], name, username].some(a => a && f.password.trim().toLowerCase() === a.toLowerCase())) e.password = 'The password must not be your email, name or username.'
    if (f.confirm !== f.password) e.confirm = 'The two passwords do not match.'
    setErrs(e); setFormErr('')
    if (Object.keys(e).length) return focusBad()
    setBusy(true)
    try {
      await publicApi('POST', '/invites/accept', { token, name, username, password: f.password })
      kept = ''
      if (wasIn) await logout()  // clears the old session first, otherwise #/login would keep showing the app
      setNotice('Your account is ready. Sign in to continue.'); setPrefill(username); location.hash = '#/login'
    } catch (x) {
      const t = x instanceof ApiError ? x : undefined
      if (t?.status === 404) setState('invalid')
      else if (t?.code === 'username_taken') setErrs({ username: t.message })
      else if (t?.code === 'seat_limit') setFormErr('This business has no free seat. Ask the owner.')
      else if (t?.code === 'weak_password') setErrs({ password: t.message })
      else setFormErr(msg(x))
      focusBad()
    } finally { setBusy(false) }
  }

  if (state === 'loading') return <AuthPage dark={dark} setDark={setDark}><div className="card" aria-busy="true"><p role="status" className="sr-only">Checking your invitation</p><Skeleton rows={3} /></div></AuthPage>
  if (state === 'invalid') return (
    <AuthPage dark={dark} setDark={setDark}>
      <Card title={gone} lead="It may have expired, been withdrawn or already been used. Ask the person who invited you to send a new one." focusKey="invalid" onSubmit={() => undefined}>
        <a className="btn btn-primary" href="#/login">Go to sign in</a>
      </Card>
    </AuthPage>
  )
  if (state === 'error') return (
    <AuthPage dark={dark} setDark={setDark}>
      <Card title="Could not check the invitation" lead={loadErr} focusKey="error" onSubmit={() => setTries(t => t + 1)}>
        <button type="submit" className="btn btn-primary">Try again</button>
      </Card>
    </AuthPage>
  )
  return (
    <AuthPage dark={dark} setDark={setDark}>
      <Card title={`You are invited to join ${pv!.business_name} as ${pv!.role_name}`} lead="Choose how you will sign in. Your email is fixed by the invitation." focusKey="form" onSubmit={submit}>
        {wasIn && <p role="note" className="rounded-lg border border-line bg-tint p-3 text-sm">You are signed in{getAccount() ? ` as ${getAccount()}` : ''}. This invitation creates a separate account in {pv!.business_name}. When it is ready you will be signed out of this session so you can sign in to the new one.</p>}
        <Field label="Email" name="email" type="email" value={pv!.email} readOnly autoComplete="email" />
        <Field label="Your name" name="name" autoComplete="name" maxLength={80} value={f.name} onChange={set('name')} error={errs.name} />
        <Field label="Username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={40} value={f.username} onChange={set('username')} error={errs.username}
          hint="Letters, numbers, dots, dashes. Must be unique across LARIS." />
        <Field label="Password" name="password" type="password" autoComplete="new-password" aria-describedby="inv-pw-rules" value={f.password} onChange={set('password')} error={errs.password} />
        <Checklist id="inv-pw-rules" pw={f.password} avoid={[pv!.email, pv!.email.split('@')[0], f.name.trim(), f.username.trim()]} />
        <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} error={errs.confirm} />
        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Creating account...' : 'Create my account'}</button>
      </Card>
      <p className="text-center text-sm">Already have an account? <a className="link inline-flex min-h-11 items-center" href="#/login">Sign in</a></p>
    </AuthPage>
  )
}

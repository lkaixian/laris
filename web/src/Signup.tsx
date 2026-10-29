import { useEffect, useId, useRef, useState } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { publicApi, setNotice, setPrefill, ApiError } from './api'
import { AuthPage } from './Login'
import { msg } from './ui'
import { Icon } from './icons'
import { useToast } from './Toast'
import { ConfirmDialog } from './kit'

/*
  Self-service onboarding, all public (no session): #/register (form, then code), #/forgot (email, then code + new password).
  Contract: docs/api-contract.md (POST /api/signup, /signup/verify, /signup/resend, /password/forgot, /password/reset).
  The pending email is kept in sessionStorage so a reload keeps the code step. The code itself is never stored.
*/
const MIN_PASSWORD = 10
const KEY = 'laris.pending'
const BAD_CODE = 'That code is wrong or has expired. Check the email, or ask for a new code.'
const TEMPLATES = [['made_to_order', 'Made to order (signage, printing, fabrication)'], ['fnb_catering', 'Food and catering'], ['tailoring', 'Tailoring and alterations'], ['aircon_service', 'Aircon servicing and installation']]
type Pending = { kind: 'signup' | 'reset'; email: string }
const readPending = (kind: Pending['kind']): string => { try { const p = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Pending | null; return p?.kind === kind ? p.email : '' } catch { return '' } }
const savePending = (p: Pending | null) => { try { if (p) sessionStorage.setItem(KEY, JSON.stringify(p)); else sessionStorage.removeItem(KEY) } catch { /* storage blocked: a reload restarts the form */ } }
const goSignIn = (email: string, notice: string) => { savePending(null); setNotice(notice); setPrefill(email); location.hash = '#/login' }

// ---- shared pieces
export function Field({ label, error, hint, ...p }: { label: string; error?: string; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  const desc = [hint ? `${id}-h` : '', error ? `${id}-e` : '', p['aria-describedby'] ?? ''].filter(Boolean).join(' ') || undefined
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <input id={id} {...p} aria-invalid={error ? true : undefined} aria-describedby={desc} className="input font-normal" />
      {hint && <span id={`${id}-h`} className="text-xs text-muted">{hint}</span>}
      {error && <span id={`${id}-e`} role="alert" className="text-sm text-warn">{error}</span>}
    </div>
  )
}

// Live checklist. `avoid` is the text a password must not equal: the email, its part before @, the person's name.
const tooLikeIdentity = (pw: string, avoid: string[]) => { const x = pw.trim().toLowerCase(); return avoid.some(a => a.length > 0 && x === a.trim().toLowerCase()) }
const identity = (email: string, name = '') => [email, email.split('@')[0], name]
export function Checklist({ id, pw, avoid, note = 'very common passwords are refused by the server' }: { id: string; pw: string; avoid: string[]; note?: string }) {
  const item = (ok: boolean, t: string) => (
    <li className={`flex items-center gap-2 ${ok ? '' : 'text-muted'}`}>
      <Icon name={ok ? 'check' : 'close'} className={`size-4 ${ok ? 'text-accent' : ''}`} />
      <span><span className="sr-only">{ok ? 'Met: ' : 'Not met: '}</span>{t}</span>
    </li>
  )
  return (
    <ul id={id} className="grid gap-1 text-sm">
      {item(pw.length >= MIN_PASSWORD, `at least ${MIN_PASSWORD} characters`)}
      {item(!!pw && !tooLikeIdentity(pw, avoid), 'not your email or name')}
      <li className="text-xs text-muted">Note: {note}.</li>
    </ul>
  )
}

function DevCode({ code }: { code?: string }) {
  if (!code) return null
  return <div role="note" aria-label="Demo code" className="rounded-ui border border-dashed border-line bg-tint p-3 text-sm"><span className="font-semibold">Demo code: {code}</span><span className="block text-xs text-muted">Shown only on demo deployments where email is off.</span></div>
}

// Tracks a countdown: start() sets it to `sec`, left counts down to 0.
function useCooldown(sec: number) {
  const [left, setLeft] = useState(0)
  useEffect(() => { if (left <= 0) return; const t = setTimeout(() => setLeft(left - 1), 1000); return () => clearTimeout(t) }, [left])
  return [left, () => setLeft(sec)] as const
}

function Resend({ send }: { send: () => Promise<void> }) {
  const [left, start] = useCooldown(30)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const [err, setErr] = useState('')
  const go = async () => {
    if (busy || left > 0) return
    setBusy(true); setErr(''); setSaid('')
    try { await send(); setSaid('If this email can be used, we sent a new code.'); start() }
    catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  return (
    <div>
      <button type="button" className="btn" aria-disabled={busy || left > 0 || undefined} onClick={go}>{busy ? 'Sending...' : left > 0 ? `Send a new code (${left}s)` : 'Send a new code'}</button>
      <p role="status" className="mt-1 text-sm text-muted">{said}</p>
      {err && <p role="alert" className="text-sm text-warn">{err}</p>}
    </div>
  )
}

// Six digits. The sixth one submits. `inflight` stops a second submit from a held key or a re-render while the first is running.
function CodeField({ value, onChange, onComplete, error, autoSubmit }: { value: string; onChange: (v: string) => void; onComplete?: (code: string) => void; error?: string; autoSubmit?: boolean }) {
  return (
    <Field label="6-digit code" name="code" value={value} error={error} inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]*" spellCheck={false}
      onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); onChange(v); if (autoSubmit && v.length === 6) onComplete?.(v) }} />
  )
}

export function Card({ title, lead, children, onSubmit, focusKey }: { title: string; lead?: ReactNode; children: ReactNode; onSubmit: () => void; focusKey: string }) {
  const h = useRef<HTMLHeadingElement>(null)
  useEffect(() => { document.title = `${title} · LARIS`; h.current?.focus() }, [focusKey, title])
  return (
    <form className="card grid gap-4" noValidate onSubmit={e => { e.preventDefault(); onSubmit() }} aria-labelledby="auth-h">
      <div>
        <h1 id="auth-h" ref={h} tabIndex={-1} className="text-2xl font-semibold">{title}</h1>
        {lead && <p className="mt-1 text-sm text-muted">{lead}</p>}
      </div>
      {children}
    </form>
  )
}
const Back = () => <p className="text-center text-sm">Already have an account? <a className="link inline-flex min-h-11 items-center" href="#/login">Sign in</a></p>

// ---- register: 3 steps (1 business name + type, 2 account, 3 email code)
const STEPS = ['Business', 'Account', 'Verify']
function Progress({ step }: { step: number }) {
  return (
    <ol aria-label="Sign-up progress" className="flex items-center gap-2 text-xs">
      {STEPS.map((t, i) => (
        <li key={t} aria-current={step === i + 1 ? 'step' : undefined} className="flex flex-1 flex-col gap-1">
          <span className={`h-1.5 rounded-full ${step >= i + 1 ? 'bg-accent' : 'bg-line'}`} />
          <span className={step === i + 1 ? 'font-semibold' : 'text-muted'}>{i + 1}. {t}</span>
        </li>
      ))}
    </ol>
  )
}

// Typing-style three dots while an availability check runs.
const Dots = () => <span aria-hidden className="ml-1 inline-flex gap-0.5">{[0, 1, 2].map(i => <span key={i} className="size-1 animate-bounce rounded-full bg-current" style={{ animationDelay: `${i * 150}ms` }} />)}</span>
function Avail({ state }: { state: 'idle' | 'checking' | 'ok' }) {
  return (
    <p role="status" className="flex min-h-5 items-center gap-1 text-sm text-muted">
      {state === 'checking' && <>Checking availability<Dots /></>}
      {state === 'ok' && <><Icon name="check" className="size-4 text-accent" />Available</>}
    </p>
  )
}

const pause = (ms: number) => new Promise(r => setTimeout(r, ms))
const isFree = async (name: string) => (await publicApi<{ available: boolean }>('POST', '/signup/check', { name })).available

export function Register({ dark, setDark }: { dark: boolean; setDark: (d: boolean) => void }) {
  const toast = useToast()
  const [pending, setPending] = useState(() => readPending('signup'))
  const [step, setStep] = useState(pending ? 3 : 1)
  const [f, setF] = useState({ business_name: '', owner_name: '', email: pending, password: '', confirm: '', trade_template: TEMPLATES[0][0] })
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [formErr, setFormErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [avail, setAvail] = useState<'idle' | 'checking' | 'ok'>('idle')
  const [info, setInfo] = useState('')
  const [dev, setDev] = useState<string>()
  const [code, setCode] = useState('')
  const [codeErr, setCodeErr] = useState('')
  const inflight = useRef(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF(p => ({ ...p, [k]: e.target.value })); setErrs(p => ({ ...p, [k]: '' })); setAvail('idle') }

  // Business name check with the dots, "Available" for a beat, then on to step 2. A taken name stays on the step with an error.
  const checkName = async (name: string) => {
    setBusy(true); setFormErr(''); setAvail('checking')
    try {
      const [free] = await Promise.all([isFree(name), pause(700)])
      if (!free) { setAvail('idle'); setErrs({ business_name: 'That business name is already taken. Try another.' }); requestAnimationFrame(focusFirstInvalid); return }
      setAvail('ok'); await pause(500); setAvail('idle'); setStep(2)
    } catch (x) { setAvail('idle'); setFormErr(msg(x)) } finally { setBusy(false) }
  }

  const step1 = () => {
    if (busy) return
    const bn = f.business_name.trim(), e: Record<string, string> = {}
    if (bn.length < 2 || bn.length > 80) e.business_name = 'Business name needs 2 to 80 characters.'
    setErrs(e)
    if (Object.keys(e).length) { requestAnimationFrame(focusFirstInvalid); return }
    void checkName(bn)
  }

  const step2 = () => {
    if (busy) return
    const on = f.owner_name.trim(), em = f.email.trim(), e: Record<string, string> = {}
    if (on.length < 2 || on.length > 80) e.owner_name = 'Your name needs 2 to 80 characters.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) || em.length > 254) e.email = 'Enter a valid email address.'
    if (f.password.length < MIN_PASSWORD) e.password = `The password needs at least ${MIN_PASSWORD} characters.`
    else if (tooLikeIdentity(f.password, identity(em, on))) e.password = 'The password must not be your email or name.'
    if (f.confirm !== f.password) e.confirm = 'The two passwords do not match.'
    setErrs(e)
    if (Object.keys(e).length) { requestAnimationFrame(focusFirstInvalid); return }
    setBusy(true); setFormErr(''); setAvail('checking')  // dots while the code is sent
    void (async () => {
      try {
        const r = await publicApi<{ message?: string; dev_code?: string }>('POST', '/signup', { business_name: f.business_name.trim(), owner_name: on, email: em, password: f.password, trade_template: f.trade_template })
        savePending({ kind: 'signup', email: em }); setPending(em); setInfo(r.message ?? 'If this email can be used, we sent a 6-digit code'); setDev(r.dev_code); setAvail('idle'); setStep(3)
      } catch (x) {
        const t = x instanceof ApiError ? x : undefined
        setAvail('idle')
        if (t?.code === 'weak_password') setErrs({ password: t.message })
        else if (t?.code === 'unknown_template') { setErrs({ trade_template: t.message }); setStep(1) }
        else setFormErr(msg(x))
        if (t?.status === 422 || t?.status === 429) requestAnimationFrame(focusFirstInvalid)
      } finally { setBusy(false) }
    })()
  }

  const verify = async (c: string) => {
    if (inflight.current) return
    inflight.current = true; setBusy(true); setCodeErr('')
    try {
      await publicApi('POST', '/signup/verify', { email: pending, code: c })
      toast('Account verified.')
      goSignIn(pending, 'Your account is ready. Sign in to continue.')
    } catch (x) {
      setCodeErr(x instanceof ApiError && x.status === 400 ? BAD_CODE : msg(x)); setCode('')
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[name=code]')?.focus())
    } finally { inflight.current = false; setBusy(false) }
  }

  const [leaving, setLeaving] = useState(false)  // confirm dialog for the logo link on steps 2 and 3
  const onBrand = (e: { preventDefault: () => void }) => { if (step > 1) { e.preventDefault(); setLeaving(true) } }
  const quit = () => { savePending(null); setLeaving(false); location.hash = '#/login' }
  const bar = <><Progress step={step} /><ConfirmDialog open={leaving} title="Leave sign-up?" body="Your progress will be lost. If a code was already sent, you can start again later." confirmLabel="Leave" danger onConfirm={quit} onCancel={() => setLeaving(false)} /></>
  if (step === 3) return (
    <AuthPage dark={dark} setDark={setDark} onBrand={onBrand}>
      {bar}
      <Card title="Enter your code" lead={<>{info || 'We sent a 6-digit code'} to <strong className="break-words text-ink">{pending}</strong>. It works for 10 minutes.</>} focusKey="code" onSubmit={() => code.length === 6 && verify(code)}>
        <DevCode code={dev} />
        <CodeField value={code} onChange={setCode} onComplete={verify} autoSubmit error={codeErr} />
        <button type="submit" className="btn btn-primary" aria-disabled={busy || code.length < 6 || undefined}>{busy ? 'Checking...' : 'Verify email'}</button>
        <Resend send={async () => { const r = await publicApi<{ dev_code?: string }>('POST', '/signup/resend', { email: pending }); setDev(r.dev_code) }} />
        <button type="button" className="link justify-self-start text-sm" onClick={() => { savePending(null); setPending(''); setCode(''); setCodeErr(''); setInfo(''); setDev(undefined); setStep(2) }}>‹ Back, use a different email</button>
      </Card>
    </AuthPage>
  )

  if (step === 2) {
    const pwHelp = 'reg-pw-rules'
    return (
      <AuthPage dark={dark} setDark={setDark} onBrand={onBrand}>
        {bar}
        <Card title="Your account" lead={<>Creating <strong className="break-words text-ink">{f.business_name.trim()}</strong>. We email a 6-digit code to confirm your address.</>} focusKey="account" onSubmit={step2}>
          <Field label="Your name" name="owner_name" autoComplete="name" maxLength={80} value={f.owner_name} onChange={set('owner_name')} error={errs.owner_name} />
          <Field label="Email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} value={f.email} onChange={set('email')} error={errs.email} hint="Already use this email for another business? That is fine. You choose between your businesses when you sign in." />
          <Field label="Password" name="password" type="password" autoComplete="new-password" aria-describedby={pwHelp} value={f.password} onChange={set('password')} error={errs.password} />
          <Checklist id={pwHelp} pw={f.password} avoid={identity(f.email.trim(), f.owner_name.trim())} />
          <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} error={errs.confirm} />
          {avail === 'checking' && <p role="status" className="flex items-center text-sm text-muted">Sending your code<Dots /></p>}
          {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
          <p className="text-xs text-muted">By creating an account you agree to use LARIS for your business and to keep your sign-in details private.</p>
          <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Please wait...' : 'Create account'}</button>
          <button type="button" className="link justify-self-start text-sm" onClick={() => { setErrs({}); setFormErr(''); setAvail('idle'); setStep(1) }}>‹ Back</button>
        </Card>
        <Back />
      </AuthPage>
    )
  }

  return (
    <AuthPage dark={dark} setDark={setDark} onBrand={onBrand}>
      {bar}
      <a className="link inline-flex min-h-11 items-center justify-self-start text-sm" href="#/login">‹ Back to sign in</a>
      <Card title="Create a business account" lead="Start with your business name and type. We check the name is free." focusKey="business" onSubmit={step1}>
        <Field label="Business name" name="business_name" autoComplete="organization" minLength={2} maxLength={80} value={f.business_name} onChange={set('business_name')} error={errs.business_name} />
        <label className="flex flex-col gap-1 text-sm font-semibold">Type of business
          <select name="trade_template" className="input font-normal" value={f.trade_template} onChange={set('trade_template')} aria-invalid={errs.trade_template ? true : undefined}>
            {TEMPLATES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          {errs.trade_template && <span role="alert" className="text-sm font-normal text-warn">{errs.trade_template}</span>}
        </label>
        <Avail state={avail} />
        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Please wait...' : 'Check availability'}</button>
      </Card>
      <Back />
    </AuthPage>
  )
}
const focusFirstInvalid = () => document.querySelector<HTMLElement>('main [aria-invalid=true]')?.focus()

// ---- forgot password
export function Forgot({ dark, setDark }: { dark: boolean; setDark: (d: boolean) => void }) {
  const toast = useToast()
  const [email, setEmail] = useState(() => readPending('reset'))
  const [step, setStep] = useState<'email' | 'reset'>(email ? 'reset' : 'email')
  const [emailErr, setEmailErr] = useState('')
  const [dev, setDev] = useState<string>()
  const [code, setCode] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [formErr, setFormErr] = useState('')
  const [busy, setBusy] = useState(false)
  const sendCode = () => publicApi<{ dev_code?: string }>('POST', '/password/forgot', { email: email.trim() })

  const askCode = async () => {
    if (busy) return
    const em = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) || em.length > 254) { setEmailErr('Enter a valid email address.'); requestAnimationFrame(focusFirstInvalid); return }
    setBusy(true); setEmailErr('')
    try { const r = await sendCode(); setDev(r.dev_code); savePending({ kind: 'reset', email: em }); setEmail(em); setStep('reset') }
    catch (x) { setEmailErr(msg(x)); requestAnimationFrame(focusFirstInvalid) } finally { setBusy(false) }
  }
  const reset = async () => {
    if (busy) return
    const e: Record<string, string> = {}
    if (code.length !== 6) e.code = 'Enter the 6-digit code from the email.'
    if (pw.length < MIN_PASSWORD) e.pw = `The password needs at least ${MIN_PASSWORD} characters.`
    else if (tooLikeIdentity(pw, identity(email))) e.pw = 'The password must not be your email.'
    if (confirm !== pw) e.confirm = 'The two passwords do not match.'
    setErrs(e); setFormErr('')
    if (Object.keys(e).length) { requestAnimationFrame(focusFirstInvalid); return }
    setBusy(true)
    try {
      await publicApi('POST', '/password/reset', { email, code, new_password: pw })
      toast('Password changed.')
      goSignIn(email, 'Your password was changed. Sign in with the new password.')
    } catch (x) {
      if (x instanceof ApiError && x.status === 400) { setErrs({ code: BAD_CODE }); setCode('') }
      else if (x instanceof ApiError && x.code === 'weak_password') setErrs({ pw: x.message })
      else setFormErr(msg(x))
      requestAnimationFrame(focusFirstInvalid)
    } finally { setBusy(false) }
  }

  if (step === 'email') return (
    <AuthPage dark={dark} setDark={setDark}>
      <Card title="Reset your password" lead="Enter the email you signed up with. If it can be used, we send a 6-digit code. The reset applies to every account that uses this email." focusKey="email" onSubmit={askCode}>
        <Field label="Email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} value={email} onChange={e => setEmail(e.target.value)} error={emailErr} />
        <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Sending...' : 'Send code'}</button>
      </Card>
      <Back />
    </AuthPage>
  )
  return (
    <AuthPage dark={dark} setDark={setDark}>
      <Card title="Choose a new password" lead={<>If this email can be used, we sent a 6-digit code to <strong className="break-words text-ink">{email}</strong>.</>} focusKey="reset" onSubmit={reset}>
        <DevCode code={dev} />
        <CodeField value={code} onChange={setCode} error={errs.code} />
        <Field label="New password" name="new_password" type="password" autoComplete="new-password" aria-describedby="fp-rules" value={pw} onChange={e => setPw(e.target.value)} error={errs.pw} />
        <Checklist id="fp-rules" pw={pw} avoid={identity(email)} />
        <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} error={errs.confirm} />
        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Saving...' : 'Change password'}</button>
        <Resend send={async () => { const r = await sendCode(); setDev(r.dev_code) }} />
        <button type="button" className="link justify-self-start text-sm" onClick={() => { savePending(null); setStep('email'); setCode(''); setErrs({}); setDev(undefined) }}>Use a different email</button>
      </Card>
      <Back />
    </AuthPage>
  )
}

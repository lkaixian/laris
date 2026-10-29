import { useEffect, useRef, useState } from 'react'
import { MOCK, login, setAccessToken, takeNotice, takePrefill, ApiError } from './api'
import type { Business } from './api'
import type { ReactNode } from 'react'
import { Brand, ThemeToggle } from './ui'
import { t, useLang } from './i18n'
import type { Text } from './i18n'

const S = {
  goSignIn: { en: 'LARIS, go to sign in', ms: 'LARIS, pergi ke log masuk', zh: 'LARIS，前往登录', ta: 'LARIS, உள்நுழைவுக்குச் செல்' },
  title: { en: 'Sign in', ms: 'Log masuk', zh: '登录', ta: 'உள்நுழை' },
  need: { en: 'Enter your email or username and your password.', ms: 'Masukkan e-mel atau nama pengguna dan kata laluan anda.', zh: '请输入您的邮箱或用户名以及密码。', ta: 'உங்கள் மின்னஞ்சல் அல்லது பயனர்பெயரையும் கடவுச்சொல்லையும் உள்ளிடவும்.' },
  fail: { en: 'Could not sign in.', ms: 'Tidak dapat log masuk.', zh: '无法登录。', ta: 'உள்நுழைய முடியவில்லை.' },
  paste: { en: 'Paste the access token.', ms: 'Tampal token akses.', zh: '请粘贴访问令牌。', ta: 'அணுகல் டோக்கனை ஒட்டவும்.' },
  choose: { en: 'Choose a business', ms: 'Pilih perniagaan', zh: '选择企业', ta: 'வணிகத்தைத் தேர்ந்தெடுக்கவும்' },
  chooseLead: { en: 'This email is used by more than one business. Pick the one to sign in to.', ms: 'E-mel ini digunakan oleh lebih daripada satu perniagaan. Pilih perniagaan untuk log masuk.', zh: '此邮箱被多家企业使用。请选择要登录的企业。', ta: 'இந்த மின்னஞ்சல் ஒன்றுக்கு மேற்பட்ட வணிகங்களால் பயன்படுத்தப்படுகிறது. உள்நுழைய வேண்டியதைத் தேர்ந்தெடுக்கவும்.' },
  business: { en: 'Business', ms: 'Perniagaan', zh: '企业', ta: 'வணிகம்' },
  signingIn: { en: 'Signing in...', ms: 'Sedang log masuk...', zh: '正在登录...', ta: 'உள்நுழைகிறது...' },
  next: { en: 'Continue', ms: 'Teruskan', zh: '继续', ta: 'தொடரவும்' },
  back: { en: 'Back', ms: 'Kembali', zh: '返回', ta: 'பின்செல்' },
  heading: { en: 'Sign in to LARIS', ms: 'Log masuk ke LARIS', zh: '登录 LARIS', ta: 'LARIS இல் உள்நுழைக' },
  tag: { en: 'Quote with confidence when supplier prices move.', ms: 'Beri sebut harga dengan yakin apabila harga pembekal berubah.', zh: '供应商价格变动时，报价依然有把握。', ta: 'சப்ளையர் விலைகள் மாறும்போதும் நம்பிக்கையுடன் மேற்கோள் தரவும்.' },
  user: { en: 'Email or username', ms: 'E-mel atau nama pengguna', zh: '邮箱或用户名', ta: 'மின்னஞ்சல் அல்லது பயனர்பெயர்' },
  pw: { en: 'Password', ms: 'Kata laluan', zh: '密码', ta: 'கடவுச்சொல்' },
  hide: { en: 'Hide', ms: 'Sembunyi', zh: '隐藏', ta: 'மறை' },
  show: { en: 'Show', ms: 'Tunjuk', zh: '显示', ta: 'காட்டு' },
  pwWord: { en: ' password', ms: ' kata laluan', zh: '密码', ta: ' கடவுச்சொல்' },
  caps: { en: 'Caps Lock is on.', ms: 'Caps Lock dihidupkan.', zh: '大写锁定已开启。', ta: 'Caps Lock இயக்கத்தில் உள்ளது.' },
  wait: { en: 'Wait a moment...', ms: 'Tunggu sebentar...', zh: '请稍候...', ta: 'சற்று காத்திருக்கவும்...' },
  forgot: { en: 'Forgot password?', ms: 'Lupa kata laluan?', zh: '忘记密码？', ta: 'கடவுச்சொல்லை மறந்துவிட்டீர்களா?' },
  create: { en: 'Create a business account', ms: 'Cipta akaun perniagaan', zh: '创建企业账户', ta: 'வணிகக் கணக்கை உருவாக்கு' },
  demo: { en: 'Demo deployment: use an access token instead', ms: 'Pelaksanaan demo: gunakan token akses sebaliknya', zh: '演示部署：改用访问令牌', ta: 'டெமோ வரிசைப்படுத்தல்: அதற்குப் பதிலாக அணுகல் டோக்கனைப் பயன்படுத்தவும்' },
  token: { en: 'Access token', ms: 'Token akses', zh: '访问令牌', ta: 'அணுகல் டோக்கன்' },
  useToken: { en: 'Use token', ms: 'Guna token', zh: '使用令牌', ta: 'டோக்கனைப் பயன்படுத்து' },
} satisfies Record<string, Text>

const COOLDOWN_MS = 3000 // button pause after a 429, so a held Enter key does not hammer the server

// Last business chosen per email, so the picker preselects it. Convenience only: a blocked or corrupt store is ignored.
const BIZ_KEY = 'laris.biz'
const lastBiz = (email: string): string => { try { return JSON.parse(localStorage.getItem(BIZ_KEY) ?? '{}')[email.toLowerCase()] ?? '' } catch { return '' } }
const rememberBiz = (email: string, id: string) => { try { const m = JSON.parse(localStorage.getItem(BIZ_KEY) ?? '{}'); m[email.toLowerCase()] = id; localStorage.setItem(BIZ_KEY, JSON.stringify(m)) } catch { /* storage blocked */ } }

// Full-bleed centred page for sign-in, register, verify and reset: logo, theme toggle, then the card(s). No sidebar.
// The logo always links to sign-in; `onBrand` lets a page intercept the click (e.g. confirm before leaving a half-done sign-up).
export function AuthPage({ dark, setDark, children, onBrand }: { dark: boolean; setDark: (d: boolean) => void; children: ReactNode; onBrand?: (e: { preventDefault: () => void }) => void }) {
  useLang()
  return (
    <main id="main" className="mx-auto grid min-h-screen max-w-md content-center gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <a href="#/login" aria-label={t(S.goSignIn)} onClick={onBrand} className="inline-flex min-h-11 items-center"><Brand dark={dark} /></a>
        <ThemeToggle dark={dark} setDark={setDark} />
      </div>
      {children}
    </main>
  )
}

// Sign-in screen. Accounts come from self-service sign-up (#/register), an owner (Team page) or `scripts/create_token.py account`.
// `demo` is true when the server still allows the shared access token (auth config says login is not required).
export default function Login({ dark, setDark, onDone, demo }: { dark: boolean; setDark: (d: boolean) => void; onDone: () => void; demo: boolean }) {
  const [lang] = useLang()
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
  useEffect(() => { document.title = `${t(S.title)} · LARIS`; (username ? pw : first).current?.focus() }, [lang])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (choices) document.getElementById('biz-' + biz)?.focus() }, [choices])  // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (businessId?: string) => {
    if (busy || cooling) return
    if (!username.trim() || !password) { setErr(t(S.need)); (username.trim() ? pw : first).current?.focus(); return }
    setBusy(true); setErr('')
    try { await login(username.trim(), password, businessId); if (businessId) rememberBiz(username.trim(), businessId); onDone() }
    catch (e) {
      if (e instanceof ApiError && e.code === 'choose_business' && e.businesses?.length) {
        const l = lastBiz(username.trim())
        setBiz(e.businesses.some(b => b.id === l) ? l : e.businesses[0].id); setChoices(e.businesses); setBusy(false); return
      }
      setChoices(undefined)  // any other answer (wrong password, 429) goes back to the form with the normal error
      setErr(e instanceof ApiError ? e.message : t(S.fail))
      if (e instanceof ApiError && e.status === 429) { setCooling(true); setTimeout(() => setCooling(false), COOLDOWN_MS) }
      if (!(e instanceof ApiError) || (e.status >= 400 && e.status < 500 && e.status !== 429)) setPassword('')  // keep it on network, timeout and server errors: nothing was wrong with the password
      pw.current?.focus()
    } finally { setBusy(false) }
  }
  const submitToken = () => {
    if (!token.trim()) return setErr(t(S.paste))
    setAccessToken(token)
    onDone()
  }

  if (choices) return (
    <AuthPage dark={dark} setDark={setDark}>
      <form className="card grid gap-4" onSubmit={e => { e.preventDefault(); submit(biz) }} aria-labelledby="choose-h" noValidate>
        <div>
          <h1 id="choose-h" tabIndex={-1} className="text-2xl font-semibold">{t(S.choose)}</h1>
          <p className="mt-1 text-sm text-muted">{t(S.chooseLead)}</p>
        </div>
        <fieldset className="grid gap-2">
          <legend className="sr-only">{t(S.business)}</legend>
          {choices.map(b => (
            <label key={b.id} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-ui border p-3 text-sm font-semibold ${biz === b.id ? 'border-accent bg-tint' : 'border-soft'}`}>
              <input id={'biz-' + b.id} type="radio" name="business" value={b.id} checked={biz === b.id} onChange={() => setBiz(b.id)} />
              <span className="min-w-0 break-words">{b.name}</span>
            </label>
          ))}
        </fieldset>
        {err && <p role="alert" className="text-sm text-warn">{err}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t(S.signingIn) : t(S.next)}</button>
          <button type="button" className="btn" onClick={() => { setChoices(undefined); setErr(''); requestAnimationFrame(() => pw.current?.focus()) }}>{t(S.back)}</button>
        </div>
      </form>
    </AuthPage>
  )

  return (
    <AuthPage dark={dark} setDark={setDark}>
      <form className="card grid gap-4" onSubmit={e => { e.preventDefault(); submit() }} aria-labelledby="signin" noValidate>
        <div>
          <h1 id="signin" tabIndex={-1} className="text-2xl font-semibold">{t(S.heading)}</h1>
          <p className="mt-1 text-sm text-muted">{t(S.tag)}</p>
        </div>
        {notice && !err && <p role="status" className="rounded-ui border border-soft bg-tint p-2 text-sm">{notice}</p>}
        <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.user)}
          <input ref={first} className="input font-normal" autoComplete="username" autoCapitalize="none" spellCheck={false}
            aria-describedby={err ? 'signin-err' : undefined} value={username} onChange={e => setUsername(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.pw)}
          <span className="flex gap-2">
            <input ref={pw} className="input min-w-0 flex-1 font-normal" type={show ? 'text' : 'password'} autoComplete="current-password"
              aria-describedby={err ? 'signin-err' : caps ? 'signin-caps' : undefined}
              value={password} onChange={e => setPassword(e.target.value)}
              onKeyUp={e => setCaps(e.getModifierState('CapsLock'))} onBlur={() => setCaps(false)} />
            <button type="button" className="btn" aria-pressed={show} onClick={() => setShow(!show)}>{show ? t(S.hide) : t(S.show)}<span className="sr-only">{t(S.pwWord)}</span></button>
          </span>
        </label>
        {caps && <p id="signin-caps" role="status" className="text-sm text-muted">{t(S.caps)}</p>}
        {err && <p id="signin-err" role="alert" className="text-sm text-warn">{err}</p>}
        <button type="submit" className="btn btn-primary" aria-disabled={busy || cooling || undefined}>{busy ? t(S.signingIn) : cooling ? t(S.wait) : t(S.title)}</button>
        <p className="flex flex-wrap items-center justify-between gap-x-4 text-sm">
          <a className="link inline-flex min-h-11 items-center" href="#/forgot">{t(S.forgot)}</a>
          <a className="link inline-flex min-h-11 items-center" href="#/register">{t(S.create)}</a>
        </p>
      </form>
      {demo && !MOCK && (
        <details className="text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center text-muted">{t(S.demo)}</summary>
          <form className="mt-2 flex gap-2" onSubmit={e => { e.preventDefault(); submitToken() }}>
            <label className="sr-only" htmlFor="tok">{t(S.token)}</label>
            <input id="tok" className="input min-w-0 flex-1" type="password" autoComplete="off" value={token} onChange={e => setTokenText(e.target.value)} />
            <button type="submit" className="btn">{t(S.useToken)}</button>
          </form>
        </details>
      )}
    </AuthPage>
  )
}

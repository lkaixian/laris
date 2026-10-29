import { useEffect, useState } from 'react'
import { publicApi, setNotice, setPrefill, ApiError, getToken, getAccount, logout } from './api'
import { AuthPage } from './Login'
import { Card, Checklist, Field } from './Signup'
import { Skeleton, msg } from './ui'
import { t, useLang } from './i18n'

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
const gone = () => t({ en: 'This invitation is no longer valid', ms: 'Jemputan ini tidak lagi sah', zh: '此邀请已失效', ta: 'இந்த அழைப்பு இனி செல்லுபடியாகாது' })

export default function AcceptInvite({ dark, setDark }: { dark: boolean; setDark: (d: boolean) => void }) {
  useLang()
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
    if (name.length < 2 || name.length > 80) e.name = t({ en: 'Your name needs 2 to 80 characters.', ms: 'Nama anda perlu 2 hingga 80 aksara.', zh: '您的姓名需要 2 到 80 个字符。', ta: 'உங்கள் பெயர் 2 முதல் 80 எழுத்துகள் இருக்க வேண்டும்.' })
    if (!username) e.username = t({ en: 'Choose a username.', ms: 'Pilih nama pengguna.', zh: '请选择用户名。', ta: 'பயனர்பெயரைத் தேர்ந்தெடுக்கவும்.' })
    else if (!USERNAME.test(username)) e.username = t({ en: 'Use 3 to 40 letters, numbers, dots, dashes or underscores.', ms: 'Guna 3 hingga 40 huruf, nombor, titik, sengkang atau garis bawah.', zh: '请使用 3 到 40 个字母、数字、点、短横线或下划线。', ta: '3 முதல் 40 எழுத்துகள், எண்கள், புள்ளிகள், கோடுகள் அல்லது அடிக்கோடுகளைப் பயன்படுத்தவும்.' })
    if (f.password.length < MIN_PASSWORD) e.password = t({ en: `The password needs at least ${MIN_PASSWORD} characters.`, ms: `Kata laluan perlu sekurang-kurangnya ${MIN_PASSWORD} aksara.`, zh: `密码至少需要 ${MIN_PASSWORD} 个字符。`, ta: `கடவுச்சொல் குறைந்தது ${MIN_PASSWORD} எழுத்துகள் இருக்க வேண்டும்.` })
    else if ([pv.email, pv.email.split('@')[0], name, username].some(a => a && f.password.trim().toLowerCase() === a.toLowerCase())) e.password = t({ en: 'The password must not be your email, name or username.', ms: 'Kata laluan tidak boleh sama dengan e-mel, nama atau nama pengguna anda.', zh: '密码不能与您的邮箱、姓名或用户名相同。', ta: 'கடவுச்சொல் உங்கள் மின்னஞ்சல், பெயர் அல்லது பயனர்பெயராக இருக்கக்கூடாது.' })
    if (f.confirm !== f.password) e.confirm = t({ en: 'The two passwords do not match.', ms: 'Kedua-dua kata laluan tidak sepadan.', zh: '两次输入的密码不一致。', ta: 'இரண்டு கடவுச்சொற்களும் பொருந்தவில்லை.' })
    setErrs(e); setFormErr('')
    if (Object.keys(e).length) return focusBad()
    setBusy(true)
    try {
      await publicApi('POST', '/invites/accept', { token, name, username, password: f.password })
      kept = ''
      if (wasIn) await logout()  // clears the old session first, otherwise #/login would keep showing the app
      setNotice(t({ en: 'Your account is ready. Sign in to continue.', ms: 'Akaun anda sudah sedia. Log masuk untuk teruskan.', zh: '您的账户已就绪。请登录以继续。', ta: 'உங்கள் கணக்கு தயாராகிவிட்டது. தொடர உள்நுழையவும்.' })); setPrefill(username); location.hash = '#/login'
    } catch (x) {
      const ae = x instanceof ApiError ? x : undefined
      if (ae?.status === 404) setState('invalid')
      else if (ae?.code === 'username_taken') setErrs({ username: ae.message })
      else if (ae?.code === 'seat_limit') setFormErr(t({ en: 'This business has no free seat. Ask the owner.', ms: 'Perniagaan ini tiada tempat kosong. Minta pemilik.', zh: '此企业没有空余席位。请联系所有者。', ta: 'இந்த வணிகத்தில் காலி இடம் இல்லை. உரிமையாளரிடம் கேளுங்கள்.' }))
      else if (ae?.code === 'weak_password') setErrs({ password: ae.message })
      else setFormErr(msg(x))
      focusBad()
    } finally { setBusy(false) }
  }

  if (state === 'loading') return <AuthPage dark={dark} setDark={setDark}><div className="card" aria-busy="true"><p role="status" className="sr-only">{t({ en: 'Checking your invitation', ms: 'Menyemak jemputan anda', zh: '正在检查您的邀请', ta: 'உங்கள் அழைப்பைச் சரிபார்க்கிறது' })}</p><Skeleton rows={3} /></div></AuthPage>
  if (state === 'invalid') return (
    <AuthPage dark={dark} setDark={setDark}>
      <Card title={gone()} lead={t({ en: 'It may have expired, been withdrawn or already been used. Ask the person who invited you to send a new one.', ms: 'Ia mungkin telah tamat tempoh, ditarik balik atau sudah digunakan. Minta orang yang menjemput anda menghantar yang baharu.', zh: '它可能已过期、被撤回或已被使用。请让邀请您的人重新发送一个。', ta: 'இது காலாவதியாகியிருக்கலாம், திரும்பப் பெறப்பட்டிருக்கலாம் அல்லது ஏற்கெனவே பயன்படுத்தப்பட்டிருக்கலாம். உங்களை அழைத்தவரிடம் புதியதை அனுப்பச் சொல்லுங்கள்.' })} focusKey="invalid" onSubmit={() => undefined}>
        <a className="btn btn-primary" href="#/login">{t({ en: 'Go to sign in', ms: 'Pergi ke log masuk', zh: '前往登录', ta: 'உள்நுழைவுக்குச் செல்' })}</a>
      </Card>
    </AuthPage>
  )
  if (state === 'error') return (
    <AuthPage dark={dark} setDark={setDark}>
      <Card title={t({ en: 'Could not check the invitation', ms: 'Tidak dapat menyemak jemputan', zh: '无法检查邀请', ta: 'அழைப்பைச் சரிபார்க்க முடியவில்லை' })} lead={loadErr} focusKey="error" onSubmit={() => setTries(n => n + 1)}>
        <button type="submit" className="btn btn-primary">{t({ en: 'Try again', ms: 'Cuba lagi', zh: '重试', ta: 'மீண்டும் முயற்சி' })}</button>
      </Card>
    </AuthPage>
  )
  return (
    <AuthPage dark={dark} setDark={setDark}>
      <Card title={t({ en: `You are invited to join ${pv!.business_name} as ${pv!.role_name}`, ms: `Anda dijemput menyertai ${pv!.business_name} sebagai ${pv!.role_name}`, zh: `邀请您以 ${pv!.role_name} 身份加入 ${pv!.business_name}`, ta: `${pv!.business_name} இல் ${pv!.role_name} ஆகச் சேர உங்களுக்கு அழைப்பு வந்துள்ளது` })} lead={t({ en: 'Choose how you will sign in. Your email is fixed by the invitation.', ms: 'Pilih cara anda log masuk. E-mel anda ditetapkan oleh jemputan.', zh: '选择您的登录方式。您的邮箱由邀请决定。', ta: 'நீங்கள் எவ்வாறு உள்நுழைவீர்கள் என்பதைத் தேர்ந்தெடுக்கவும். உங்கள் மின்னஞ்சல் அழைப்பால் நிர்ணயிக்கப்பட்டது.' })} focusKey="form" onSubmit={submit}>
        {wasIn && <p role="note" className="rounded-lg border border-line bg-tint p-3 text-sm">{t({ en: `You are signed in${getAccount() ? ` as ${getAccount()}` : ''}. This invitation creates a separate account in ${pv!.business_name}. When it is ready you will be signed out of this session so you can sign in to the new one.`, ms: `Anda telah log masuk${getAccount() ? ` sebagai ${getAccount()}` : ''}. Jemputan ini mencipta akaun berasingan dalam ${pv!.business_name}. Apabila siap, anda akan dilog keluar daripada sesi ini supaya boleh log masuk ke akaun baharu.`, zh: `您已登录${getAccount() ? `（${getAccount()}）` : ''}。此邀请会在 ${pv!.business_name} 中创建一个独立的账户。完成后，您将退出当前会话，以便登录新账户。`, ta: `நீங்கள் உள்நுழைந்துள்ளீர்கள்${getAccount() ? ` (${getAccount()})` : ''}. இந்த அழைப்பு ${pv!.business_name} இல் தனி கணக்கை உருவாக்குகிறது. அது தயாரானதும், புதிய கணக்கில் உள்நுழைய இந்த அமர்விலிருந்து வெளியேற்றப்படுவீர்கள்.` })}</p>}
        <Field label={t({ en: 'Email', ms: 'E-mel', zh: '邮箱', ta: 'மின்னஞ்சல்' })} name="email" type="email" value={pv!.email} readOnly autoComplete="email" />
        <Field label={t({ en: 'Your name', ms: 'Nama anda', zh: '您的姓名', ta: 'உங்கள் பெயர்' })} name="name" autoComplete="name" maxLength={80} value={f.name} onChange={set('name')} error={errs.name} />
        <Field label={t({ en: 'Username', ms: 'Nama pengguna', zh: '用户名', ta: 'பயனர்பெயர்' })} name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={40} value={f.username} onChange={set('username')} error={errs.username}
          hint={t({ en: 'Letters, numbers, dots, dashes. Must be unique across LARIS.', ms: 'Huruf, nombor, titik, sengkang. Mesti unik di seluruh LARIS.', zh: '字母、数字、点、短横线。在整个 LARIS 中必须唯一。', ta: 'எழுத்துகள், எண்கள், புள்ளிகள், கோடுகள். LARIS முழுவதும் தனித்துவமாக இருக்க வேண்டும்.' })} />
        <Field label={t({ en: 'Password', ms: 'Kata laluan', zh: '密码', ta: 'கடவுச்சொல்' })} name="password" type="password" autoComplete="new-password" aria-describedby="inv-pw-rules" value={f.password} onChange={set('password')} error={errs.password} />
        <Checklist id="inv-pw-rules" pw={f.password} avoid={[pv!.email, pv!.email.split('@')[0], f.name.trim(), f.username.trim()]} />
        <Field label={t({ en: 'Confirm password', ms: 'Sahkan kata laluan', zh: '确认密码', ta: 'கடவுச்சொல்லை உறுதிப்படுத்து' })} name="confirm" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} error={errs.confirm} />
        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t({ en: 'Creating account...', ms: 'Mencipta akaun...', zh: '正在创建账户...', ta: 'கணக்கை உருவாக்குகிறது...' }) : t({ en: 'Create my account', ms: 'Cipta akaun saya', zh: '创建我的账户', ta: 'என் கணக்கை உருவாக்கு' })}</button>
      </Card>
      <p className="text-center text-sm">{t({ en: 'Already have an account?', ms: 'Sudah ada akaun?', zh: '已有账户？', ta: 'ஏற்கெனவே கணக்கு உள்ளதா?' })} <a className="link inline-flex min-h-11 items-center" href="#/login">{t({ en: 'Sign in', ms: 'Log masuk', zh: '登录', ta: 'உள்நுழை' })}</a></p>
    </AuthPage>
  )
}

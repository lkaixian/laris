import { useEffect, useId, useRef, useState } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { publicApi, setNotice, setPrefill, ApiError } from './api'
import { AuthPage } from './Login'
import { msg } from './ui'
import { Icon } from './icons'
import { useToast } from './Toast'
import { ConfirmDialog } from './kit'
import { t, useLang } from './i18n'
import type { Text } from './i18n'

/*
  Self-service onboarding, all public (no session): #/register (form, then code), #/forgot (email, then code + new password).
  Contract: docs/api-contract.md (POST /api/signup, /signup/verify, /signup/resend, /password/forgot, /password/reset).
  The pending email is kept in sessionStorage so a reload keeps the code step. The code itself is never stored.
*/
const MIN_PASSWORD = 10
const pwMin = () => t({ en: `The password needs at least ${MIN_PASSWORD} characters.`, ms: `Kata laluan perlu sekurang-kurangnya ${MIN_PASSWORD} aksara.`, zh: `密码至少需要 ${MIN_PASSWORD} 个字符。`, ta: `கடவுச்சொல்லில் குறைந்தது ${MIN_PASSWORD} எழுத்துகள் இருக்க வேண்டும்.` })
const KEY = 'laris.pending'
const S = {
  badCode: { en: 'That code is wrong or has expired. Check the email, or ask for a new code.', ms: 'Kod itu salah atau telah tamat tempoh. Semak e-mel, atau minta kod baharu.', zh: '验证码有误或已过期。请查看邮件，或重新获取验证码。', ta: 'அந்தக் குறியீடு தவறானது அல்லது காலாவதியாகிவிட்டது. மின்னஞ்சலைச் சரிபார்க்கவும் அல்லது புதிய குறியீட்டைக் கேட்கவும்.' },
  madeToOrder: { en: 'Made to order (signage, printing, fabrication)', ms: 'Tempahan khas (papan tanda, percetakan, fabrikasi)', zh: '定制加工（招牌、印刷、制造）', ta: 'ஆர்டரின்படி தயாரிப்பு (பலகைகள், அச்சிடல், தயாரிப்பு)' },
  fnb: { en: 'Food and catering', ms: 'Makanan dan katering', zh: '餐饮与外烩', ta: 'உணவு மற்றும் கேட்டரிங்' },
  tailoring: { en: 'Tailoring and alterations', ms: 'Jahitan dan ubah suai pakaian', zh: '裁缝与修改衣物', ta: 'தையல் மற்றும் மாற்றங்கள்' },
  aircon: { en: 'Aircon servicing and installation', ms: 'Servis dan pemasangan penghawa dingin', zh: '冷气维修与安装', ta: 'ஏர்கண்டிஷனர் சேவை மற்றும் நிறுவல்' },
  met: { en: 'Met: ', ms: 'Dipenuhi: ', zh: '已满足：', ta: 'பூர்த்தியானது: ' },
  notMet: { en: 'Not met: ', ms: 'Belum dipenuhi: ', zh: '未满足：', ta: 'பூர்த்தியாகவில்லை: ' },
  notIdentity: { en: 'not your email or name', ms: 'bukan e-mel atau nama anda', zh: '不能是您的邮箱或姓名', ta: 'உங்கள் மின்னஞ்சல் அல்லது பெயர் அல்ல' },
  common: { en: 'very common passwords are refused by the server', ms: 'kata laluan yang terlalu biasa ditolak oleh pelayan', zh: '服务器会拒绝过于常见的密码', ta: 'மிகவும் பொதுவான கடவுச்சொற்களை சேவையகம் நிராகரிக்கும்' },
  demoCode: { en: 'Demo code', ms: 'Kod demo', zh: '演示验证码', ta: 'டெமோ குறியீடு' },
  demoOnly: { en: 'Shown only on demo deployments where email is off.', ms: 'Dipaparkan hanya pada pelaksanaan demo yang e-melnya dimatikan.', zh: '仅在邮件功能关闭的演示部署中显示。', ta: 'மின்னஞ்சல் அணைக்கப்பட்ட டெமோ வரிசைப்படுத்தல்களில் மட்டுமே காட்டப்படும்.' },
  newSent: { en: 'If this email can be used, we sent a new code.', ms: 'Jika e-mel ini boleh digunakan, kami telah menghantar kod baharu.', zh: '如果此邮箱可用，我们已发送新的验证码。', ta: 'இந்த மின்னஞ்சலைப் பயன்படுத்த முடிந்தால், புதிய குறியீட்டை அனுப்பியுள்ளோம்.' },
  sending: { en: 'Sending...', ms: 'Menghantar...', zh: '正在发送...', ta: 'அனுப்புகிறது...' },
  resend: { en: 'Send a new code', ms: 'Hantar kod baharu', zh: '重新发送验证码', ta: 'புதிய குறியீட்டை அனுப்பு' },
  code6: { en: '6-digit code', ms: 'Kod 6 digit', zh: '6 位验证码', ta: '6 இலக்கக் குறியீடு' },
  have: { en: 'Already have an account?', ms: 'Sudah ada akaun?', zh: '已有账户？', ta: 'ஏற்கனவே கணக்கு உள்ளதா?' },
  signIn: { en: 'Sign in', ms: 'Log masuk', zh: '登录', ta: 'உள்நுழை' },
  stBiz: { en: 'Business', ms: 'Perniagaan', zh: '企业', ta: 'வணிகம்' },
  stAcc: { en: 'Account', ms: 'Akaun', zh: '账户', ta: 'கணக்கு' },
  stVerify: { en: 'Verify', ms: 'Sahkan', zh: '验证', ta: 'சரிபார்' },
  progress: { en: 'Sign-up progress', ms: 'Kemajuan pendaftaran', zh: '注册进度', ta: 'பதிவு முன்னேற்றம்' },
  checking: { en: 'Checking availability', ms: 'Menyemak ketersediaan', zh: '正在检查是否可用', ta: 'கிடைப்பதைச் சரிபார்க்கிறது' },
  available: { en: 'Available', ms: 'Tersedia', zh: '可用', ta: 'கிடைக்கிறது' },
  taken: { en: 'That business name is already taken. Try another.', ms: 'Nama perniagaan itu sudah digunakan. Cuba nama lain.', zh: '该企业名称已被使用。请换一个。', ta: 'அந்த வணிகப் பெயர் ஏற்கனவே எடுக்கப்பட்டுள்ளது. வேறொன்றை முயற்சிக்கவும்.' },
  bnLen: { en: 'Business name needs 2 to 80 characters.', ms: 'Nama perniagaan perlu 2 hingga 80 aksara.', zh: '企业名称需为 2 至 80 个字符。', ta: 'வணிகப் பெயர் 2 முதல் 80 எழுத்துகள் இருக்க வேண்டும்.' },
  nameLen: { en: 'Your name needs 2 to 80 characters.', ms: 'Nama anda perlu 2 hingga 80 aksara.', zh: '您的姓名需为 2 至 80 个字符。', ta: 'உங்கள் பெயர் 2 முதல் 80 எழுத்துகள் இருக்க வேண்டும்.' },
  badEmail: { en: 'Enter a valid email address.', ms: 'Masukkan alamat e-mel yang sah.', zh: '请输入有效的邮箱地址。', ta: 'சரியான மின்னஞ்சல் முகவரியை உள்ளிடவும்.' },
  notEmailName: { en: 'The password must not be your email or name.', ms: 'Kata laluan tidak boleh sama dengan e-mel atau nama anda.', zh: '密码不能是您的邮箱或姓名。', ta: 'கடவுச்சொல் உங்கள் மின்னஞ்சல் அல்லது பெயராக இருக்கக்கூடாது.' },
  notEmail: { en: 'The password must not be your email.', ms: 'Kata laluan tidak boleh sama dengan e-mel anda.', zh: '密码不能是您的邮箱。', ta: 'கடவுச்சொல் உங்கள் மின்னஞ்சலாக இருக்கக்கூடாது.' },
  mismatch: { en: 'The two passwords do not match.', ms: 'Kedua-dua kata laluan tidak sepadan.', zh: '两次输入的密码不一致。', ta: 'இரண்டு கடவுச்சொற்களும் பொருந்தவில்லை.' },
  verified: { en: 'Account verified.', ms: 'Akaun disahkan.', zh: '账户已验证。', ta: 'கணக்கு சரிபார்க்கப்பட்டது.' },
  ready: { en: 'Your account is ready. Sign in to continue.', ms: 'Akaun anda sudah sedia. Log masuk untuk teruskan.', zh: '您的账户已就绪。请登录以继续。', ta: 'உங்கள் கணக்கு தயாராக உள்ளது. தொடர உள்நுழையவும்.' },
  leaveTitle: { en: 'Leave sign-up?', ms: 'Tinggalkan pendaftaran?', zh: '离开注册？', ta: 'பதிவிலிருந்து வெளியேறவா?' },
  leaveBody: { en: 'Your progress will be lost. If a code was already sent, you can start again later.', ms: 'Kemajuan anda akan hilang. Jika kod sudah dihantar, anda boleh mula semula kemudian.', zh: '您的进度将会丢失。如果验证码已发送，您可以稍后重新开始。', ta: 'உங்கள் முன்னேற்றம் இழக்கப்படும். குறியீடு ஏற்கனவே அனுப்பப்பட்டிருந்தால், பின்னர் மீண்டும் தொடங்கலாம்.' },
  leave: { en: 'Leave', ms: 'Tinggalkan', zh: '离开', ta: 'வெளியேறு' },
  enterCode: { en: 'Enter your code', ms: 'Masukkan kod anda', zh: '输入验证码', ta: 'உங்கள் குறியீட்டை உள்ளிடவும்' },
  ifSent: { en: 'If this email can be used, we sent a 6-digit code', ms: 'Jika e-mel ini boleh digunakan, kami telah menghantar kod 6 digit', zh: '如果此邮箱可用，我们已发送 6 位验证码', ta: 'இந்த மின்னஞ்சலைப் பயன்படுத்த முடிந்தால், 6 இலக்கக் குறியீட்டை அனுப்பியுள்ளோம்' },
  sent: { en: 'We sent a 6-digit code', ms: 'Kami telah menghantar kod 6 digit', zh: '我们已发送 6 位验证码', ta: '6 இலக்கக் குறியீட்டை அனுப்பியுள்ளோம்' },
  to: { en: 'to', ms: 'ke', zh: '至', ta: 'முகவரி:' },
  tenMin: { en: 'It works for 10 minutes.', ms: 'Kod ini sah selama 10 minit.', zh: '验证码 10 分钟内有效。', ta: 'இது 10 நிமிடங்களுக்குச் செல்லுபடியாகும்.' },
  checkingBtn: { en: 'Checking...', ms: 'Menyemak...', zh: '正在检查...', ta: 'சரிபார்க்கிறது...' },
  verify: { en: 'Verify email', ms: 'Sahkan e-mel', zh: '验证邮箱', ta: 'மின்னஞ்சலைச் சரிபார்' },
  backEmail: { en: '‹ Back, use a different email', ms: '‹ Kembali, guna e-mel lain', zh: '‹ 返回，使用其他邮箱', ta: '‹ பின்செல், வேறு மின்னஞ்சலைப் பயன்படுத்து' },
  yourAcc: { en: 'Your account', ms: 'Akaun anda', zh: '您的账户', ta: 'உங்கள் கணக்கு' },
  creating: { en: 'Creating', ms: 'Mencipta', zh: '正在创建', ta: 'உருவாக்கப்படுவது:' },
  weEmail: { en: 'We email a 6-digit code to confirm your address.', ms: 'Kami e-melkan kod 6 digit untuk mengesahkan alamat anda.', zh: '我们会发送 6 位验证码到您的邮箱以确认地址。', ta: 'உங்கள் முகவரியை உறுதிப்படுத்த 6 இலக்கக் குறியீட்டை மின்னஞ்சலில் அனுப்புவோம்.' },
  yourName: { en: 'Your name', ms: 'Nama anda', zh: '您的姓名', ta: 'உங்கள் பெயர்' },
  email: { en: 'Email', ms: 'E-mel', zh: '邮箱', ta: 'மின்னஞ்சல்' },
  emailHint: { en: 'Already use this email for another business? That is fine. You choose between your businesses when you sign in.', ms: 'Sudah guna e-mel ini untuk perniagaan lain? Tidak mengapa. Anda memilih antara perniagaan anda semasa log masuk.', zh: '已用此邮箱注册其他企业？没问题。登录时您可以在多家企业之间选择。', ta: 'இந்த மின்னஞ்சலை ஏற்கனவே வேறு வணிகத்திற்குப் பயன்படுத்துகிறீர்களா? பரவாயில்லை. உள்நுழையும்போது உங்கள் வணிகங்களில் ஒன்றைத் தேர்ந்தெடுக்கலாம்.' },
  password: { en: 'Password', ms: 'Kata laluan', zh: '密码', ta: 'கடவுச்சொல்' },
  confirmPw: { en: 'Confirm password', ms: 'Sahkan kata laluan', zh: '确认密码', ta: 'கடவுச்சொல்லை உறுதிசெய்' },
  sendingCode: { en: 'Sending your code', ms: 'Menghantar kod anda', zh: '正在发送验证码', ta: 'உங்கள் குறியீட்டை அனுப்புகிறது' },
  agree: { en: 'By creating an account you agree to use LARIS for your business and to keep your sign-in details private.', ms: 'Dengan mencipta akaun, anda bersetuju menggunakan LARIS untuk perniagaan anda dan menjaga butiran log masuk anda secara peribadi.', zh: '创建账户即表示您同意将 LARIS 用于您的业务，并保管好您的登录信息。', ta: 'கணக்கை உருவாக்குவதன் மூலம், உங்கள் வணிகத்திற்காக LARIS ஐப் பயன்படுத்தவும், உங்கள் உள்நுழைவு விவரங்களை ரகசியமாக வைத்திருக்கவும் ஒப்புக்கொள்கிறீர்கள்.' },
  wait: { en: 'Please wait...', ms: 'Sila tunggu...', zh: '请稍候...', ta: 'தயவுசெய்து காத்திருக்கவும்...' },
  create: { en: 'Create account', ms: 'Cipta akaun', zh: '创建账户', ta: 'கணக்கை உருவாக்கு' },
  back: { en: '‹ Back', ms: '‹ Kembali', zh: '‹ 返回', ta: '‹ பின்செல்' },
  backSignIn: { en: '‹ Back to sign in', ms: '‹ Kembali ke log masuk', zh: '‹ 返回登录', ta: '‹ உள்நுழைவுக்குத் திரும்பு' },
  createBiz: { en: 'Create a business account', ms: 'Cipta akaun perniagaan', zh: '创建企业账户', ta: 'வணிகக் கணக்கை உருவாக்கு' },
  createLead: { en: 'Start with your business name and type. We check the name is free.', ms: 'Mulakan dengan nama dan jenis perniagaan anda. Kami semak nama itu belum digunakan.', zh: '先填写企业名称和类型。我们会检查名称是否可用。', ta: 'உங்கள் வணிகப் பெயர் மற்றும் வகையுடன் தொடங்கவும். பெயர் கிடைக்கிறதா என்று சரிபார்ப்போம்.' },
  bizName: { en: 'Business name', ms: 'Nama perniagaan', zh: '企业名称', ta: 'வணிகப் பெயர்' },
  bizType: { en: 'Type of business', ms: 'Jenis perniagaan', zh: '企业类型', ta: 'வணிக வகை' },
  checkBtn: { en: 'Check availability', ms: 'Semak ketersediaan', zh: '检查是否可用', ta: 'கிடைப்பதைச் சரிபார்' },
  sixDigit: { en: 'Enter the 6-digit code from the email.', ms: 'Masukkan kod 6 digit daripada e-mel.', zh: '请输入邮件中的 6 位验证码。', ta: 'மின்னஞ்சலில் உள்ள 6 இலக்கக் குறியீட்டை உள்ளிடவும்.' },
  pwChanged: { en: 'Password changed.', ms: 'Kata laluan ditukar.', zh: '密码已更改。', ta: 'கடவுச்சொல் மாற்றப்பட்டது.' },
  pwChangedNote: { en: 'Your password was changed. Sign in with the new password.', ms: 'Kata laluan anda telah ditukar. Log masuk dengan kata laluan baharu.', zh: '您的密码已更改。请用新密码登录。', ta: 'உங்கள் கடவுச்சொல் மாற்றப்பட்டது. புதிய கடவுச்சொல்லுடன் உள்நுழையவும்.' },
  resetTitle: { en: 'Reset your password', ms: 'Tetapkan semula kata laluan anda', zh: '重置密码', ta: 'உங்கள் கடவுச்சொல்லை மீட்டமைக்கவும்' },
  resetLead: { en: 'Enter the email you signed up with. If it can be used, we send a 6-digit code. The reset applies to every account that uses this email.', ms: 'Masukkan e-mel yang anda gunakan untuk mendaftar. Jika boleh digunakan, kami hantar kod 6 digit. Penetapan semula ini terpakai pada setiap akaun yang menggunakan e-mel ini.', zh: '请输入注册时使用的邮箱。如果可用，我们会发送 6 位验证码。重置将适用于使用此邮箱的所有账户。', ta: 'நீங்கள் பதிவு செய்த மின்னஞ்சலை உள்ளிடவும். அதைப் பயன்படுத்த முடிந்தால், 6 இலக்கக் குறியீட்டை அனுப்புவோம். இந்த மீட்டமைப்பு இந்த மின்னஞ்சலைப் பயன்படுத்தும் ஒவ்வொரு கணக்கிற்கும் பொருந்தும்.' },
  sendCode: { en: 'Send code', ms: 'Hantar kod', zh: '发送验证码', ta: 'குறியீட்டை அனுப்பு' },
  newPwTitle: { en: 'Choose a new password', ms: 'Pilih kata laluan baharu', zh: '设置新密码', ta: 'புதிய கடவுச்சொல்லைத் தேர்ந்தெடுக்கவும்' },
  resetSent: { en: 'If this email can be used, we sent a 6-digit code to', ms: 'Jika e-mel ini boleh digunakan, kami telah menghantar kod 6 digit ke', zh: '如果此邮箱可用，我们已向以下地址发送 6 位验证码：', ta: 'இந்த மின்னஞ்சலைப் பயன்படுத்த முடிந்தால், 6 இலக்கக் குறியீட்டை இந்த முகவரிக்கு அனுப்பியுள்ளோம்:' },
  newPw: { en: 'New password', ms: 'Kata laluan baharu', zh: '新密码', ta: 'புதிய கடவுச்சொல்' },
  confirmNew: { en: 'Confirm new password', ms: 'Sahkan kata laluan baharu', zh: '确认新密码', ta: 'புதிய கடவுச்சொல்லை உறுதிசெய்' },
  saving: { en: 'Saving...', ms: 'Menyimpan...', zh: '正在保存...', ta: 'சேமிக்கிறது...' },
  changePw: { en: 'Change password', ms: 'Tukar kata laluan', zh: '更改密码', ta: 'கடவுச்சொல்லை மாற்று' },
  otherEmail: { en: 'Use a different email', ms: 'Guna e-mel lain', zh: '使用其他邮箱', ta: 'வேறு மின்னஞ்சலைப் பயன்படுத்து' },
} satisfies Record<string, Text>
const TEMPLATES = [['made_to_order', S.madeToOrder], ['fnb_catering', S.fnb], ['tailoring', S.tailoring], ['aircon_service', S.aircon]] as const
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
export function Checklist({ id, pw, avoid, note }: { id: string; pw: string; avoid: string[]; note?: string }) {
  useLang()
  const item = (ok: boolean, x: string) => (
    <li className={`flex items-center gap-2 ${ok ? '' : 'text-muted'}`}>
      <Icon name={ok ? 'check' : 'close'} className={`size-4 ${ok ? 'text-accent' : ''}`} />
      <span><span className="sr-only">{ok ? t(S.met) : t(S.notMet)}</span>{x}</span>
    </li>
  )
  return (
    <ul id={id} className="grid gap-1 text-sm">
      {item(pw.length >= MIN_PASSWORD, t({ en: `at least ${MIN_PASSWORD} characters`, ms: `sekurang-kurangnya ${MIN_PASSWORD} aksara`, zh: `至少 ${MIN_PASSWORD} 个字符`, ta: `குறைந்தது ${MIN_PASSWORD} எழுத்துகள்` }))}
      {item(!!pw && !tooLikeIdentity(pw, avoid), t(S.notIdentity))}
      <li className="text-xs text-muted">{t({ en: `Note: ${note ?? t(S.common)}.`, ms: `Nota: ${note ?? t(S.common)}.`, zh: `说明：${note ?? t(S.common)}。`, ta: `குறிப்பு: ${note ?? t(S.common)}.` })}</li>
    </ul>
  )
}

function DevCode({ code }: { code?: string }) {
  if (!code) return null
  return <div role="note" aria-label={t(S.demoCode)} className="rounded-ui border border-dashed border-line bg-tint p-3 text-sm"><span className="font-semibold">{t(S.demoCode)}: {code}</span><span className="block text-xs text-muted">{t(S.demoOnly)}</span></div>
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
    try { await send(); setSaid(t(S.newSent)); start() }
    catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  return (
    <div>
      <button type="button" className="btn" aria-disabled={busy || left > 0 || undefined} onClick={go}>{busy ? t(S.sending) : left > 0 ? `${t(S.resend)} (${left}s)` : t(S.resend)}</button>
      <p role="status" className="mt-1 text-sm text-muted">{said}</p>
      {err && <p role="alert" className="text-sm text-warn">{err}</p>}
    </div>
  )
}

// Six digits. The sixth one submits. `inflight` stops a second submit from a held key or a re-render while the first is running.
function CodeField({ value, onChange, onComplete, error, autoSubmit }: { value: string; onChange: (v: string) => void; onComplete?: (code: string) => void; error?: string; autoSubmit?: boolean }) {
  return (
    <Field label={t(S.code6)} name="code" value={value} error={error} inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]*" spellCheck={false}
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
const Back = () => { useLang(); return <p className="text-center text-sm">{t(S.have)} <a className="link inline-flex min-h-11 items-center" href="#/login">{t(S.signIn)}</a></p> }

// ---- register: 3 steps (1 business name + type, 2 account, 3 email code)
const STEPS = [S.stBiz, S.stAcc, S.stVerify]
function Progress({ step }: { step: number }) {
  useLang()
  return (
    <ol aria-label={t(S.progress)} className="flex items-center gap-2 text-xs">
      {STEPS.map((x, i) => (
        <li key={x.en} aria-current={step === i + 1 ? 'step' : undefined} className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={`h-1.5 rounded-full ${step >= i + 1 ? 'bg-accent' : 'bg-line'}`} />
          <span className={`truncate ${step === i + 1 ? 'font-semibold' : 'text-muted'}`}>{i + 1}. {t(x)}</span>
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
      {state === 'checking' && <>{t(S.checking)}<Dots /></>}
      {state === 'ok' && <><Icon name="check" className="size-4 text-accent" />{t(S.available)}</>}
    </p>
  )
}

const pause = (ms: number) => new Promise(r => setTimeout(r, ms))
const isFree = async (name: string) => (await publicApi<{ available: boolean }>('POST', '/signup/check', { name })).available

export function Register({ dark, setDark }: { dark: boolean; setDark: (d: boolean) => void }) {
  useLang()
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
      if (!free) { setAvail('idle'); setErrs({ business_name: t(S.taken) }); requestAnimationFrame(focusFirstInvalid); return }
      setAvail('ok'); await pause(500); setAvail('idle'); setStep(2)
    } catch (x) { setAvail('idle'); setFormErr(msg(x)) } finally { setBusy(false) }
  }

  const step1 = () => {
    if (busy) return
    const bn = f.business_name.trim(), e: Record<string, string> = {}
    if (bn.length < 2 || bn.length > 80) e.business_name = t(S.bnLen)
    setErrs(e)
    if (Object.keys(e).length) { requestAnimationFrame(focusFirstInvalid); return }
    void checkName(bn)
  }

  const step2 = () => {
    if (busy) return
    const on = f.owner_name.trim(), em = f.email.trim(), e: Record<string, string> = {}
    if (on.length < 2 || on.length > 80) e.owner_name = t(S.nameLen)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) || em.length > 254) e.email = t(S.badEmail)
    if (f.password.length < MIN_PASSWORD) e.password = pwMin()
    else if (tooLikeIdentity(f.password, identity(em, on))) e.password = t(S.notEmailName)
    if (f.confirm !== f.password) e.confirm = t(S.mismatch)
    setErrs(e)
    if (Object.keys(e).length) { requestAnimationFrame(focusFirstInvalid); return }
    setBusy(true); setFormErr(''); setAvail('checking')  // dots while the code is sent
    void (async () => {
      try {
        const r = await publicApi<{ message?: string; dev_code?: string }>('POST', '/signup', { business_name: f.business_name.trim(), owner_name: on, email: em, password: f.password, trade_template: f.trade_template })
        savePending({ kind: 'signup', email: em }); setPending(em); setInfo(r.message ?? ''); setDev(r.dev_code); setAvail('idle'); setStep(3)
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
      toast(t(S.verified))
      goSignIn(pending, t(S.ready))
    } catch (x) {
      setCodeErr(x instanceof ApiError && x.status === 400 ? t(S.badCode) : msg(x)); setCode('')
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[name=code]')?.focus())
    } finally { inflight.current = false; setBusy(false) }
  }

  const [leaving, setLeaving] = useState(false)  // confirm dialog for the logo link on steps 2 and 3
  const onBrand = (e: { preventDefault: () => void }) => { if (step > 1) { e.preventDefault(); setLeaving(true) } }
  const quit = () => { savePending(null); setLeaving(false); location.hash = '#/login' }
  const bar = <><Progress step={step} /><ConfirmDialog open={leaving} title={t(S.leaveTitle)} body={t(S.leaveBody)} confirmLabel={t(S.leave)} danger onConfirm={quit} onCancel={() => setLeaving(false)} /></>
  if (step === 3) return (
    <AuthPage dark={dark} setDark={setDark} onBrand={onBrand}>
      {bar}
      <Card title={t(S.enterCode)} lead={<>{info ? t(S.ifSent) : t(S.sent)} {t(S.to)} <strong className="break-words text-ink">{pending}</strong>. {t(S.tenMin)}</>} focusKey="code" onSubmit={() => code.length === 6 && verify(code)}>
        <DevCode code={dev} />
        <CodeField value={code} onChange={setCode} onComplete={verify} autoSubmit error={codeErr} />
        <button type="submit" className="btn btn-primary" aria-disabled={busy || code.length < 6 || undefined}>{busy ? t(S.checkingBtn) : t(S.verify)}</button>
        <Resend send={async () => { const r = await publicApi<{ dev_code?: string }>('POST', '/signup/resend', { email: pending }); setDev(r.dev_code) }} />
        <button type="button" className="link justify-self-start text-sm" onClick={() => { savePending(null); setPending(''); setCode(''); setCodeErr(''); setInfo(''); setDev(undefined); setStep(2) }}>{t(S.backEmail)}</button>
      </Card>
    </AuthPage>
  )

  if (step === 2) {
    const pwHelp = 'reg-pw-rules'
    return (
      <AuthPage dark={dark} setDark={setDark} onBrand={onBrand}>
        {bar}
        <Card title={t(S.yourAcc)} lead={<>{t(S.creating)} <strong className="break-words text-ink">{f.business_name.trim()}</strong>. {t(S.weEmail)}</>} focusKey="account" onSubmit={step2}>
          <Field label={t(S.yourName)} name="owner_name" autoComplete="name" maxLength={80} value={f.owner_name} onChange={set('owner_name')} error={errs.owner_name} />
          <Field label={t(S.email)} name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} value={f.email} onChange={set('email')} error={errs.email} hint={t(S.emailHint)} />
          <Field label={t(S.password)} name="password" type="password" autoComplete="new-password" aria-describedby={pwHelp} value={f.password} onChange={set('password')} error={errs.password} />
          <Checklist id={pwHelp} pw={f.password} avoid={identity(f.email.trim(), f.owner_name.trim())} />
          <Field label={t(S.confirmPw)} name="confirm" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} error={errs.confirm} />
          {avail === 'checking' && <p role="status" className="flex items-center text-sm text-muted">{t(S.sendingCode)}<Dots /></p>}
          {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
          <p className="text-xs text-muted">{t(S.agree)}</p>
          <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t(S.wait) : t(S.create)}</button>
          <button type="button" className="link justify-self-start text-sm" onClick={() => { setErrs({}); setFormErr(''); setAvail('idle'); setStep(1) }}>{t(S.back)}</button>
        </Card>
        <Back />
      </AuthPage>
    )
  }

  return (
    <AuthPage dark={dark} setDark={setDark} onBrand={onBrand}>
      {bar}
      <a className="link inline-flex min-h-11 items-center justify-self-start text-sm" href="#/login">{t(S.backSignIn)}</a>
      <Card title={t(S.createBiz)} lead={t(S.createLead)} focusKey="business" onSubmit={step1}>
        <Field label={t(S.bizName)} name="business_name" autoComplete="organization" minLength={2} maxLength={80} value={f.business_name} onChange={set('business_name')} error={errs.business_name} />
        <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.bizType)}
          <select name="trade_template" className="input font-normal" value={f.trade_template} onChange={set('trade_template')} aria-invalid={errs.trade_template ? true : undefined}>
            {TEMPLATES.map(([k, x]) => <option key={k} value={k}>{t(x)}</option>)}
          </select>
          {errs.trade_template && <span role="alert" className="text-sm font-normal text-warn">{errs.trade_template}</span>}
        </label>
        <Avail state={avail} />
        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t(S.wait) : t(S.checkBtn)}</button>
      </Card>
      <Back />
    </AuthPage>
  )
}
const focusFirstInvalid = () => document.querySelector<HTMLElement>('main [aria-invalid=true]')?.focus()

// ---- forgot password
export function Forgot({ dark, setDark }: { dark: boolean; setDark: (d: boolean) => void }) {
  useLang()
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) || em.length > 254) { setEmailErr(t(S.badEmail)); requestAnimationFrame(focusFirstInvalid); return }
    setBusy(true); setEmailErr('')
    try { const r = await sendCode(); setDev(r.dev_code); savePending({ kind: 'reset', email: em }); setEmail(em); setStep('reset') }
    catch (x) { setEmailErr(msg(x)); requestAnimationFrame(focusFirstInvalid) } finally { setBusy(false) }
  }
  const reset = async () => {
    if (busy) return
    const e: Record<string, string> = {}
    if (code.length !== 6) e.code = t(S.sixDigit)
    if (pw.length < MIN_PASSWORD) e.pw = pwMin()
    else if (tooLikeIdentity(pw, identity(email))) e.pw = t(S.notEmail)
    if (confirm !== pw) e.confirm = t(S.mismatch)
    setErrs(e); setFormErr('')
    if (Object.keys(e).length) { requestAnimationFrame(focusFirstInvalid); return }
    setBusy(true)
    try {
      await publicApi('POST', '/password/reset', { email, code, new_password: pw })
      toast(t(S.pwChanged))
      goSignIn(email, t(S.pwChangedNote))
    } catch (x) {
      if (x instanceof ApiError && x.status === 400) { setErrs({ code: t(S.badCode) }); setCode('') }
      else if (x instanceof ApiError && x.code === 'weak_password') setErrs({ pw: x.message })
      else setFormErr(msg(x))
      requestAnimationFrame(focusFirstInvalid)
    } finally { setBusy(false) }
  }

  if (step === 'email') return (
    <AuthPage dark={dark} setDark={setDark}>
      <Card title={t(S.resetTitle)} lead={t(S.resetLead)} focusKey="email" onSubmit={askCode}>
        <Field label={t(S.email)} name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} value={email} onChange={e => setEmail(e.target.value)} error={emailErr} />
        <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t(S.sending) : t(S.sendCode)}</button>
      </Card>
      <Back />
    </AuthPage>
  )
  return (
    <AuthPage dark={dark} setDark={setDark}>
      <Card title={t(S.newPwTitle)} lead={<>{t(S.resetSent)} <strong className="break-words text-ink">{email}</strong>.</>} focusKey="reset" onSubmit={reset}>
        <DevCode code={dev} />
        <CodeField value={code} onChange={setCode} error={errs.code} />
        <Field label={t(S.newPw)} name="new_password" type="password" autoComplete="new-password" aria-describedby="fp-rules" value={pw} onChange={e => setPw(e.target.value)} error={errs.pw} />
        <Checklist id="fp-rules" pw={pw} avoid={identity(email)} />
        <Field label={t(S.confirmNew)} name="confirm" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} error={errs.confirm} />
        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t(S.saving) : t(S.changePw)}</button>
        <Resend send={async () => { const r = await sendCode(); setDev(r.dev_code) }} />
        <button type="button" className="link justify-self-start text-sm" onClick={() => { savePending(null); setStep('email'); setCode(''); setErrs({}); setDev(undefined) }}>{t(S.otherEmail)}</button>
      </Card>
      <Back />
    </AuthPage>
  )
}

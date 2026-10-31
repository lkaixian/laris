import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, getAccount, logout, ApiError } from './api'
import type { License } from './api'
import { Brand, EmptyState, PageHeader, Skeleton, ThemeToggle, focusTop, msg, useFetch } from './ui'
import { Icon } from './icons'
import { useToast } from './Toast'
import { t, useLang, locale } from './i18n'
import type { Text } from './i18n'

/*
  Licence UI (docs/licensing.md). `enforced:false` shows nothing at all. The shell reads GET /api/license once per sign-in and again on a 402.
  useLicense().readOnly is true only when licensing is enforced and the server is refusing writes; write controls use useWriteGate().
*/
interface Ctx { lic?: License; readOnly: boolean; reload: () => void }
const LicCtx = createContext<Ctx>({ readOnly: false, reload: () => undefined })
export const LicenseProvider = ({ value, children }: { value: Ctx; children: ReactNode }) => <LicCtx value={value}>{children}</LicCtx>
export const useLicense = () => useContext(LicCtx)

export const RO_TITLE = () => t({ en: 'Read-only mode: the licence is missing or expired. Open the Licence page to fix it.', ms: 'Mod baca sahaja: lesen tiada atau telah tamat tempoh. Buka halaman Lesen untuk membetulkannya.', zh: '只读模式：许可证缺失或已过期。请打开“许可证”页面解决。', ta: 'படிக்க மட்டும் பயன்முறை: உரிமம் இல்லை அல்லது காலாவதியாகிவிட்டது. சரிசெய்ய உரிமம் பக்கத்தைத் திறக்கவும்.' })
// Spread on a write button: `<button {...gate(onClick)}>`. In read-only mode it is aria-disabled with an explanation and does nothing.
export function useWriteGate() {
  const { readOnly } = useLicense()
  useLang()
  return (onClick: () => void) => readOnly ? { 'aria-disabled': true as const, title: RO_TITLE() } : { onClick }
}

// Module flag so the nav (a plain filter in Shell.tsx) can hide the Licence item when licensing is off. Set by the shell when it reads GET /api/license.
let on = false
export const licenceOn = () => on
export const setLicenceOn = (v: boolean) => { on = v }
export const blocked = (l?: License) => !!l?.enforced && l.status !== 'active' && l.status !== 'expiring'
const STATUS = {
  active: { en: 'Active', ms: 'Aktif', zh: '有效', ta: 'செயலில்' },
  expiring: { en: 'Expiring soon', ms: 'Akan tamat tidak lama lagi', zh: '即将到期', ta: 'விரைவில் காலாவதியாகும்' },
  missing: { en: 'No licence installed', ms: 'Tiada lesen dipasang', zh: '未安装许可证', ta: 'உரிமம் நிறுவப்படவில்லை' },
  expired: { en: 'Expired', ms: 'Tamat tempoh', zh: '已过期', ta: 'காலாவதியானது' },
  invalid: { en: 'Not valid', ms: 'Tidak sah', zh: '无效', ta: 'செல்லாதது' },
  clock_unverified: { en: 'Date could not be confirmed', ms: 'Tarikh tidak dapat disahkan', zh: '无法确认日期', ta: 'தேதியை உறுதிப்படுத்த முடியவில்லை' },
} satisfies Record<License['status'], Text>
const days = (n: number) => t({ en: `${n} ${n === 1 ? 'day' : 'days'}`, ms: `${n} hari`, zh: `${n} 天`, ta: `${n} நாட்கள்` })
const unset = () => t({ en: 'Not set', ms: 'Belum ditetapkan', zh: '未设置', ta: 'அமைக்கப்படவில்லை' })
// The platform operator's page (Issuer.tsx) is only for the LARIS team: the nav shows it once GET /license/admin/config answers (a 404 means not the admin).
let issuer = false
export const issuerOn = () => issuer
export function useIssuerProbe() {
  const [, set] = useState(0)
  useEffect(() => { api('GET', '/license/admin/config', undefined, { quiet: true }).then(() => { issuer = true; set(n => n + 1) }, () => { issuer = false }) }, [])
}
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : unset()

// Minimal frame for screens shown instead of the app: logo, organisation, theme, sign out. Page content is the <main>.
export function Frame({ org, dark, setDark, children, wide }: { org?: string; dark: boolean; setDark: (d: boolean) => void; children: ReactNode; wide?: boolean }) {
  useLang()
  return (
    <div className="min-h-screen">
      <header className="border-b border-soft bg-surface">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
          <Brand dark={dark} />
          {org && <span className="min-w-0 flex-1 truncate text-sm font-semibold">{org}</span>}
          {!org && <span className="flex-1" />}
          <ThemeToggle dark={dark} setDark={setDark} compact />
          <button type="button" className="btn" onClick={() => logout()}><Icon name="logout" className="size-4" /><span className="ml-2">{t({ en: 'Sign out', ms: 'Log keluar', zh: '退出登录', ta: 'வெளியேறு' })}</span></button>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={`mx-auto w-full px-4 py-8 ${wide ? 'max-w-4xl' : 'max-w-xl'}`}>{children}</main>
    </div>
  )
}

// Licence key box shared by the gate and the Licence page.
export function KeyForm({ onDone }: { onDone: () => void }) {
  useLang()
  const [key, setKey] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const id = useId()
  const submit = async () => {
    if (busy) return
    const k = key.trim()
    if (!k.startsWith('LARIS1.')) return setErr(t({ en: 'A licence key starts with LARIS1. Paste the whole key from your email.', ms: 'Kunci lesen bermula dengan LARIS1. Tampal keseluruhan kunci daripada e-mel anda.', zh: '许可证密钥以 LARIS1 开头。请粘贴邮件中的完整密钥。', ta: 'உரிம விசை LARIS1 இல் தொடங்கும். உங்கள் மின்னஞ்சலில் உள்ள முழு விசையையும் ஒட்டவும்.' }))
    setBusy(true); setErr('')
    try { await api('POST', '/license', { key: k }); toast(t({ en: 'Licence activated.', ms: 'Lesen diaktifkan.', zh: '许可证已激活。', ta: 'உரிமம் செயல்படுத்தப்பட்டது.' })); setKey(''); onDone() }
    catch (e) { setErr(e instanceof ApiError || e instanceof Error ? msg(e) : t({ en: 'Could not activate the licence.', ms: 'Tidak dapat mengaktifkan lesen.', zh: '无法激活许可证。', ta: 'உரிமத்தைச் செயல்படுத்த முடியவில்லை.' })) }
    finally { setBusy(false) }
  }
  return (
    <form className="grid gap-3" onSubmit={e => { e.preventDefault(); submit() }}>
      <label className="flex flex-col gap-1 text-sm font-semibold" htmlFor={id}>{t({ en: 'Licence key', ms: 'Kunci lesen', zh: '许可证密钥', ta: 'உரிம விசை' })}
        <textarea id={id} className="input min-h-24 break-all py-2 font-mono font-normal" rows={3} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="LARIS1...."
          aria-invalid={err ? true : undefined} aria-describedby={err ? `${id}-e` : undefined} value={key} onChange={e => setKey(e.target.value)} />
      </label>
      {err && <p id={`${id}-e`} role="alert" className="text-sm text-warn">{err}</p>}
      <div><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t({ en: 'Activating...', ms: 'Mengaktifkan...', zh: '正在激活...', ta: 'செயல்படுத்துகிறது...' }) : t({ en: 'Activate', ms: 'Aktifkan', zh: '激活', ta: 'செயல்படுத்து' })}</button></div>
    </form>
  )
}

// A licence the platform operator already issued for this business: one click to activate.
function OfferCard({ offer, onDone }: { offer: NonNullable<License['offer']>; onDone: () => void }) {
  useLang()
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const go = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try { await api('POST', '/license/accept-offer'); toast(t({ en: 'Licence activated.', ms: 'Lesen diaktifkan.', zh: '许可证已激活。', ta: 'உரிமம் செயல்படுத்தப்பட்டது.' })); onDone() }
    catch (e) {
      setErr(e instanceof ApiError && e.code === 'no_offer' ? t({ en: 'This licence is no longer available. Ask the LARIS team to send it again.', ms: 'Lesen ini tidak lagi tersedia. Minta pasukan LARIS menghantarnya semula.', zh: '此许可证已不可用。请让 LARIS 团队重新发送。', ta: 'இந்த உரிமம் இனி கிடைக்காது. LARIS குழுவிடம் மீண்டும் அனுப்பச் சொல்லுங்கள்.' }) : msg(e))
      if (e instanceof ApiError && e.code === 'no_offer') onDone()
    } finally { setBusy(false) }
  }
  return (
    <section aria-labelledby="lic-o" className="card mb-4 border-l-4 border-l-accent">
      <h2 id="lic-o" className="font-semibold">{t({ en: 'A licence is ready for your business', ms: 'Lesen sedia untuk perniagaan anda', zh: '您的企业有一个许可证已就绪', ta: 'உங்கள் வணிகத்திற்கான உரிமம் தயாராக உள்ளது' })}</h2>
      <p className="mt-1">{t({ en: `${offer.plan[0].toUpperCase() + offer.plan.slice(1)}, ${offer.seats} seats, valid until ${fmtDate(offer.expires_at)}.`, ms: `${offer.plan[0].toUpperCase() + offer.plan.slice(1)}, ${offer.seats} tempat, sah sehingga ${fmtDate(offer.expires_at)}.`, zh: `${offer.plan[0].toUpperCase() + offer.plan.slice(1)}，${offer.seats} 个席位，有效期至 ${fmtDate(offer.expires_at)}。`, ta: `${offer.plan[0].toUpperCase() + offer.plan.slice(1)}, ${offer.seats} இடங்கள், ${fmtDate(offer.expires_at)} வரை செல்லுபடியாகும்.` })}</p>
      {err && <p role="alert" className="mt-2 text-sm text-warn">{err}</p>}
      <button type="button" className="btn btn-primary mt-3" aria-disabled={busy || undefined} onClick={go}>{busy ? t({ en: 'Activating...', ms: 'Mengaktifkan...', zh: '正在激活...', ta: 'செயல்படுத்துகிறது...' }) : t({ en: 'Activate licence', ms: 'Aktifkan lesen', zh: '激活许可证', ta: 'உரிமத்தைச் செயல்படுத்து' })}</button>
    </section>
  )
}
// The offer card (when there is an offer) with the paste-a-key box tucked under it; just the box otherwise.
function Activate({ lic, onDone }: { lic: License; onDone: () => void }) {
  useLang()
  return <>
    {lic.offer && <OfferCard offer={lic.offer} onDone={onDone} />}
    <details className="card"><summary className="cursor-pointer font-semibold">{t({ en: 'Have a key instead?', ms: 'Ada kunci sebaliknya?', zh: '改用密钥？', ta: 'அதற்குப் பதிலாக விசை உள்ளதா?' })}</summary><div className="mt-3"><KeyForm onDone={onDone} /></div></details>
  </>
}

const WHY: Record<string, Text> = {
  missing: { en: 'No licence is installed yet.', ms: 'Belum ada lesen dipasang.', zh: '尚未安装许可证。', ta: 'உரிமம் இன்னும் நிறுவப்படவில்லை.' },
  expired: { en: 'The licence has expired.', ms: 'Lesen telah tamat tempoh.', zh: '许可证已过期。', ta: 'உரிமம் காலாவதியாகிவிட்டது.' },
  invalid: { en: 'The installed licence is not valid.', ms: 'Lesen yang dipasang tidak sah.', zh: '已安装的许可证无效。', ta: 'நிறுவப்பட்ட உரிமம் செல்லாதது.' },
  clock_unverified: { en: 'The server could not confirm today\'s date, so the licence cannot be checked. Try again in a moment.', ms: 'Pelayan tidak dapat mengesahkan tarikh hari ini, jadi lesen tidak dapat disemak. Cuba lagi sebentar lagi.', zh: '服务器无法确认今天的日期，因此无法检查许可证。请稍后再试。', ta: 'இன்றைய தேதியை சேவையகத்தால் உறுதிப்படுத்த முடியவில்லை, எனவே உரிமத்தைச் சரிபார்க்க முடியாது. சிறிது நேரம் கழித்து மீண்டும் முயற்சிக்கவும்.' },
}

// Full-page screen when licensing is enforced and the licence is not usable. Owners activate, staff are told to ask the owner.
export function LicenceGate({ lic, owner, org, dark, setDark, reload, onReadOnly }: { lic: License; owner: boolean; org: string; dark: boolean; setDark: (d: boolean) => void; reload: () => void; onReadOnly: () => void }) {
  useLang()
  useEffect(() => { document.title = `${t({ en: 'Licence', ms: 'Lesen', zh: '许可证', ta: 'உரிமம்' })} · ${org}`; focusTop() }, [org])
  return (
    <Frame org={org} dark={dark} setDark={setDark}>
      {owner ? <>
        <h1 tabIndex={-1} className="text-2xl font-semibold tracking-tight">{t({ en: 'Activate your licence', ms: 'Aktifkan lesen anda', zh: '激活您的许可证', ta: 'உங்கள் உரிமத்தைச் செயல்படுத்துங்கள்' })}</h1>
        <p className="mt-1 text-muted">{WHY[lic.status] ? t(WHY[lic.status]) : ''} {t({ en: `Paste the licence key we emailed you to unlock changes for ${org}.`, ms: `Tampal kunci lesen yang kami e-melkan kepada anda untuk membuka kunci perubahan bagi ${org}.`, zh: `请粘贴我们通过邮件发给您的许可证密钥，以解除 ${org} 的修改限制。`, ta: `${org} க்கான மாற்றங்களைத் திறக்க நாங்கள் மின்னஞ்சலில் அனுப்பிய உரிம விசையை ஒட்டவும்.` })}</p>
        <div className="mt-4">{lic.offer ? <Activate lic={lic} onDone={reload} /> : <div className="card"><KeyForm onDone={reload} /></div>}</div>
        <p className="mt-4 text-sm">{t({ en: "Don't have a licence?", ms: 'Tiada lesen?', zh: '没有许可证？', ta: 'உரிமம் இல்லையா?' })} <a className="link" href="#/purchase">{t({ en: 'Request one', ms: 'Mohon satu', zh: '申请一个', ta: 'ஒன்றைக் கோரவும்' })}</a></p>
      </> : <>
        <h1 tabIndex={-1} className="text-2xl font-semibold tracking-tight">{t({ en: 'Licence needed', ms: 'Lesen diperlukan', zh: '需要许可证', ta: 'உரிமம் தேவை' })}</h1>
        <p className="mt-2">{t({ en: "Your organisation's licence has expired or is missing. Ask the owner to activate it.", ms: 'Lesen organisasi anda telah tamat tempoh atau tiada. Minta pemilik mengaktifkannya.', zh: '您所在组织的许可证已过期或缺失。请让所有者激活它。', ta: 'உங்கள் நிறுவனத்தின் உரிமம் காலாவதியாகிவிட்டது அல்லது இல்லை. அதைச் செயல்படுத்த உரிமையாளரிடம் கேளுங்கள்.' })}</p>
      </>}
      <div className="card mt-6">
        <h2 className="font-semibold">{t({ en: 'Continue in read-only mode', ms: 'Teruskan dalam mod baca sahaja', zh: '以只读模式继续', ta: 'படிக்க மட்டும் பயன்முறையில் தொடரவும்' })}</h2>
        <p className="mt-1 text-sm text-muted">{t({ en: 'You can look at everything, but anything that saves or sends is blocked until the licence is active.', ms: 'Anda boleh melihat semuanya, tetapi apa-apa yang menyimpan atau menghantar disekat sehingga lesen aktif.', zh: '您可以查看所有内容，但在许可证生效前，所有保存或发送操作都会被阻止。', ta: 'நீங்கள் அனைத்தையும் பார்க்கலாம், ஆனால் உரிமம் செயலில் வரும் வரை சேமிப்பது அல்லது அனுப்புவது தடுக்கப்படும்.' })}</p>
        <button type="button" className="btn mt-3" onClick={onReadOnly}>{t({ en: 'Continue in read-only mode', ms: 'Teruskan dalam mod baca sahaja', zh: '以只读模式继续', ta: 'படிக்க மட்டும் பயன்முறையில் தொடரவும்' })}</button>
      </div>
      {lic.status === 'clock_unverified' && <p className="mt-4"><button type="button" className="btn" onClick={reload}>{t({ en: 'Check again', ms: 'Semak semula', zh: '重新检查', ta: 'மீண்டும் சரிபார்' })}</button></p>}
    </Frame>
  )
}

// Slim notice above the page: read-only, or a licence about to end. Nothing when licensing is not enforced.
export function LicenceBanner({ lic, owner }: { lic?: License; owner: boolean }) {
  useLang()
  if (!lic?.enforced) return null
  const ro = lic.read_only
  if (!ro && lic.status !== 'expiring') return null
  const d = lic.days_left ?? 0
  return (
    <div role="region" aria-label={t({ en: 'Licence notice', ms: 'Notis lesen', zh: '许可证通知', ta: 'உரிம அறிவிப்பு' })} className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-warn-bg px-4 py-2 text-center text-sm text-warn">
      <span>{ro ? t({ en: 'Read-only mode: the licence is missing or expired, so changes are blocked.', ms: 'Mod baca sahaja: lesen tiada atau telah tamat tempoh, jadi perubahan disekat.', zh: '只读模式：许可证缺失或已过期，因此无法进行修改。', ta: 'படிக்க மட்டும் பயன்முறை: உரிமம் இல்லை அல்லது காலாவதியாகிவிட்டது, எனவே மாற்றங்கள் தடுக்கப்படுகின்றன.' }) : t({ en: `Your licence ends in ${days(d)}.`, ms: `Lesen anda tamat dalam ${days(d)}.`, zh: `您的许可证将在 ${days(d)}后到期。`, ta: `உங்கள் உரிமம் ${days(d)} இல் முடிவடைகிறது.` })}</span>
      <span className="flex gap-3 font-semibold">
        <a className="underline underline-offset-2" href="#/licence">{owner ? t({ en: 'Open licence', ms: 'Buka lesen', zh: '打开许可证', ta: 'உரிமத்தைத் திற' }) : t({ en: 'See licence status', ms: 'Lihat status lesen', zh: '查看许可证状态', ta: 'உரிம நிலையைப் பார்' })}</a>
        {owner && <a className="underline underline-offset-2" href="#/purchase">{ro ? t({ en: 'Get a licence', ms: 'Dapatkan lesen', zh: '获取许可证', ta: 'உரிமம் பெறுங்கள்' }) : t({ en: 'Request a renewal', ms: 'Mohon pembaharuan', zh: '申请续期', ta: 'புதுப்பிக்கக் கோரு' })}</a>}
      </span>
    </div>
  )
}

export function LicenceView({ owner }: { owner: boolean }) {
  const { lic, reload } = useLicense()
  useLang()
  const title = t({ en: 'Licence', ms: 'Lesen', zh: '许可证', ta: 'உரிமம்' })
  if (!lic) return <><PageHeader title={title} /><Skeleton rows={3} shape="text" /></>
  if (!lic.enforced) return <><PageHeader title={title} /><EmptyState title={t({ en: 'Licensing is not switched on here.', ms: 'Pelesenan tidak dihidupkan di sini.', zh: '此处未启用许可证。', ta: 'இங்கே உரிமம் இயக்கப்படவில்லை.' })} hint={t({ en: 'Nothing to activate. Every feature is available.', ms: 'Tiada apa yang perlu diaktifkan. Semua ciri tersedia.', zh: '无需激活。所有功能均可使用。', ta: 'செயல்படுத்த எதுவும் இல்லை. அனைத்து அம்சங்களும் கிடைக்கின்றன.' })} /></>
  const dl = lic.days_left
  const row = (k: string, v: ReactNode) => <><dt className="text-muted">{k}</dt><dd className="font-semibold">{v}</dd></>
  return (
    <>
      <PageHeader title={title} description={owner ? t({ en: 'Your plan, seats and expiry. Activate a new key here to renew.', ms: 'Pelan, tempat dan tarikh tamat anda. Aktifkan kunci baharu di sini untuk memperbaharui.', zh: '您的套餐、席位和到期日。在此激活新密钥即可续期。', ta: 'உங்கள் திட்டம், இடங்கள் மற்றும் காலாவதி. புதுப்பிக்க இங்கே புதிய விசையைச் செயல்படுத்துங்கள்.' }) : t({ en: 'The licence status of your organisation. Only the owner can change it.', ms: 'Status lesen organisasi anda. Hanya pemilik boleh mengubahnya.', zh: '您所在组织的许可证状态。只有所有者可以更改。', ta: 'உங்கள் நிறுவனத்தின் உரிம நிலை. உரிமையாளர் மட்டுமே மாற்ற முடியும்.' })} />
      {owner && !lic.offer && location.hash.includes('paid=1') && <p role="status" className="card mb-4 max-w-xl border-l-4 border-l-accent">{t({ en: 'Payment received. Your licence appears here in a moment; reload if it does not.', ms: 'Bayaran diterima. Lesen anda akan muncul di sini sebentar lagi; muat semula jika tidak.', zh: '已收到付款。您的许可证稍后会显示在此处；如未出现请刷新。', ta: 'கட்டணம் பெறப்பட்டது. உங்கள் உரிமம் சிறிது நேரத்தில் இங்கே தோன்றும்; தோன்றவில்லை என்றால் மீண்டும் ஏற்றவும்.' })}</p>}
      {owner && lic.offer && <div className="max-w-xl" data-guide="lic-offer"><OfferCard offer={lic.offer} onDone={reload} /></div>}
      {lic.clock?.rollback && <p role="alert" className="card mb-4 border-warn bg-warn-bg text-warn">{t({ en: 'The computer clock appears to have been set back. Licence checks may be wrong until the date is corrected.', ms: 'Jam komputer nampaknya telah diundurkan. Semakan lesen mungkin tidak tepat sehingga tarikh dibetulkan.', zh: '电脑时钟似乎被调回过。在日期更正之前，许可证检查可能不准确。', ta: 'கணினி கடிகாரம் பின்னோக்கி அமைக்கப்பட்டதாகத் தெரிகிறது. தேதி சரிசெய்யப்படும் வரை உரிமச் சோதனைகள் தவறாக இருக்கலாம்.' })}</p>}
      <section aria-labelledby="lic-s" className="card max-w-xl" data-guide="lic-status">
        <h2 id="lic-s" className="sr-only">{t({ en: 'Licence status', ms: 'Status lesen', zh: '许可证状态', ta: 'உரிம நிலை' })}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          {row(t({ en: 'Status', ms: 'Status', zh: '状态', ta: 'நிலை' }), <span className={`badge ${lic.read_only ? 'badge-warn' : ''}`}>{t(STATUS[lic.status])}</span>)}
          {row(t({ en: 'Plan', ms: 'Pelan', zh: '套餐', ta: 'திட்டம்' }), lic.plan ? lic.plan[0].toUpperCase() + lic.plan.slice(1) : t({ en: 'None', ms: 'Tiada', zh: '无', ta: 'இல்லை' }))}
          {row(t({ en: 'Seats', ms: 'Tempat', zh: '席位', ta: 'இடங்கள்' }), lic.seats === null ? t({ en: `${lic.seats_used} in use`, ms: `${lic.seats_used} digunakan`, zh: `已使用 ${lic.seats_used}`, ta: `${lic.seats_used} பயன்பாட்டில்` }) : t({ en: `${lic.seats_used} of ${lic.seats} in use`, ms: `${lic.seats_used} daripada ${lic.seats} digunakan`, zh: `已使用 ${lic.seats_used} / ${lic.seats}`, ta: `${lic.seats} இல் ${lic.seats_used} பயன்பாட்டில்` }))}
          {row(t({ en: 'Expires', ms: 'Tamat tempoh', zh: '到期', ta: 'காலாவதி' }), lic.expires_at ? `${fmtDate(lic.expires_at)}${dl === null ? '' : dl < 0 ? ' ' + t({ en: `(${days(-dl)} ago)`, ms: `(${days(-dl)} lalu)`, zh: `（${days(-dl)}前）`, ta: `(${days(-dl)} முன்பு)` }) : ' ' + t({ en: `(${days(dl)} left)`, ms: `(${days(dl)} lagi)`, zh: `（还剩 ${days(dl)}）`, ta: `(${days(dl)} மீதம்)` })}` : unset())}
          {row(t({ en: 'Date checked by', ms: 'Tarikh disemak melalui', zh: '日期检查方式', ta: 'தேதி சரிபார்க்கப்பட்ட முறை' }), !lic.clock ? t({ en: 'Not checked', ms: 'Belum disemak', zh: '未检查', ta: 'சரிபார்க்கப்படவில்லை' }) : lic.clock.source === 'ntp' ? t({ en: 'Verified by internet time', ms: 'Disahkan melalui masa internet', zh: '通过网络时间验证', ta: 'இணைய நேரத்தால் சரிபார்க்கப்பட்டது' }) : t({ en: "This computer's clock", ms: 'Jam komputer ini', zh: '此电脑的时钟', ta: 'இந்தக் கணினியின் கடிகாரம்' }))}
        </dl>
        {lic.read_only && <p className="mt-3 text-sm text-warn">{t({ en: 'Read-only mode is on: you can look but changes are blocked.', ms: 'Mod baca sahaja dihidupkan: anda boleh melihat tetapi perubahan disekat.', zh: '只读模式已开启：您可以查看，但无法修改。', ta: 'படிக்க மட்டும் பயன்முறை இயக்கத்தில் உள்ளது: பார்க்கலாம் ஆனால் மாற்றங்கள் தடுக்கப்படும்.' })}</p>}
      </section>
      {owner ? (
        <section aria-labelledby="lic-a" className="card mt-4 max-w-xl" data-guide="lic-activate">
          {lic.offer ? <details><summary id="lic-a" className="cursor-pointer font-semibold">{t({ en: 'Have a key instead?', ms: 'Ada kunci sebaliknya?', zh: '改用密钥？', ta: 'அதற்குப் பதிலாக விசை உள்ளதா?' })}</summary><div className="mt-3"><KeyForm onDone={reload} /></div></details>
            : <><h2 id="lic-a" className="mb-2 font-semibold">{t({ en: 'Activate or renew', ms: 'Aktifkan atau perbaharui', zh: '激活或续期', ta: 'செயல்படுத்து அல்லது புதுப்பி' })}</h2><KeyForm onDone={reload} /></>}
          <p className="mt-3 text-sm">{t({ en: 'Need a new key?', ms: 'Perlukan kunci baharu?', zh: '需要新密钥？', ta: 'புதிய விசை தேவையா?' })} <a className="link" data-guide="lic-request" href="#/purchase">{t({ en: 'Request a licence', ms: 'Mohon lesen', zh: '申请许可证', ta: 'உரிமம் கோருங்கள்' })}</a></p>
        </section>
      ) : <p className="mt-4 max-w-xl text-sm text-muted">{t({ en: 'Ask the owner to activate or renew the licence.', ms: 'Minta pemilik mengaktifkan atau memperbaharui lesen.', zh: '请让所有者激活或续期许可证。', ta: 'உரிமத்தைச் செயல்படுத்த அல்லது புதுப்பிக்க உரிமையாளரிடம் கேளுங்கள்.' })}</p>}
    </>
  )
}

interface Plan { key: string; name: string; seats: number; price: string }
export function PurchaseView({ owner, backHref }: { owner: boolean; backHref: string }) {
  useLang()
  const s = useFetch<{ plans: Plan[] }>('/license/plans')
  const [plan, setPlan] = useState('')
  const [seats, setSeats] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const done = useRef<HTMLDivElement>(null)
  const plans = s.data?.plans ?? []
  useEffect(() => { if (plans.length && !plan) { setPlan(plans[0].key); setSeats(String(plans[0].seats)) } }, [plans, plan])
  useEffect(() => { if (sent) done.current?.focus() }, [sent])
  const email = (getAccount() ?? '').includes('@') ? getAccount() : t({ en: 'the email address on your account', ms: 'alamat e-mel pada akaun anda', zh: '您账户上的邮箱地址', ta: 'உங்கள் கணக்கில் உள்ள மின்னஞ்சல் முகவரி' })
  const submit = async () => {
    if (busy) return
    const n = Number(seats)
    if (!plan) return setErr(t({ en: 'Choose a plan.', ms: 'Pilih pelan.', zh: '请选择套餐。', ta: 'திட்டத்தைத் தேர்ந்தெடுக்கவும்.' }))
    if (!Number.isInteger(n) || n < 1 || n > 1000) return setErr(t({ en: 'Seats must be a whole number from 1 to 1000.', ms: 'Bilangan tempat mesti nombor bulat dari 1 hingga 1000.', zh: '席位数必须是 1 到 1000 之间的整数。', ta: 'இடங்கள் 1 முதல் 1000 வரையிலான முழு எண்ணாக இருக்க வேண்டும்.' }))
    setBusy(true); setErr('')
    try { await api('POST', '/license/request', { plan, seats: n, note: note.trim() || undefined }); setSent(true) }
    catch (e) {
      setErr(e instanceof ApiError && e.code === 'email_needed' ? t({ en: 'Your account needs a verified email before we can send a licence. Add a verified email to the owner account, then try again.', ms: 'Akaun anda memerlukan e-mel yang disahkan sebelum kami boleh menghantar lesen. Tambah e-mel yang disahkan pada akaun pemilik, kemudian cuba lagi.', zh: '您的账户需要已验证的邮箱，我们才能发送许可证。请为所有者账户添加已验证的邮箱，然后重试。', ta: 'நாங்கள் உரிமத்தை அனுப்பும் முன் உங்கள் கணக்கிற்கு சரிபார்க்கப்பட்ட மின்னஞ்சல் தேவை. உரிமையாளர் கணக்கில் சரிபார்க்கப்பட்ட மின்னஞ்சலைச் சேர்த்து, மீண்டும் முயற்சிக்கவும்.' }) : msg(e))
    } finally { setBusy(false) }
  }
  const pay = async () => {
    if (busy || !plan) return
    setBusy(true); setErr('')
    try { const r = await api<{ url: string }>('POST', '/license/checkout', { plan }); window.location.assign(r.url) }
    catch (e) { setErr(e instanceof ApiError && e.code === 'payment_off' ? t({ en: 'Online payment is not switched on here. Send a request instead.', ms: 'Pembayaran dalam talian tidak dihidupkan di sini. Hantar permohonan sebaliknya.', zh: '此处未开通在线支付。请改为发送申请。', ta: 'இங்கே ஆன்லைன் கட்டணம் இயக்கப்படவில்லை. அதற்குப் பதிலாக கோரிக்கையை அனுப்பவும்.' }) : msg(e)); setBusy(false) }
  }
  return (
    <>
      <PageHeader back={{ href: backHref, label: t({ en: 'Back', ms: 'Kembali', zh: '返回', ta: 'பின்' }) }} title={t({ en: 'Get a licence', ms: 'Dapatkan lesen', zh: '获取许可证', ta: 'உரிமம் பெறுங்கள்' })} description={t({ en: 'Pick a plan and tell us how many people will sign in. Prices are agreed with our team, there is no card payment here.', ms: 'Pilih pelan dan beritahu kami berapa orang yang akan log masuk. Harga dipersetujui dengan pasukan kami, tiada pembayaran kad di sini.', zh: '选择套餐并告诉我们有多少人会登录。价格与我们的团队商定，此处不支持刷卡付款。', ta: 'ஒரு திட்டத்தைத் தேர்ந்தெடுத்து எத்தனை பேர் உள்நுழைவார்கள் என்று சொல்லுங்கள். விலைகள் எங்கள் குழுவுடன் ஒப்புக்கொள்ளப்படும்; இங்கே அட்டைக் கட்டணம் இல்லை.' })} />
      {!owner ? <p role="alert" className="card max-w-xl text-muted">{t({ en: 'Only the owner can request a licence. Ask the owner.', ms: 'Hanya pemilik boleh memohon lesen. Minta pemilik.', zh: '只有所有者可以申请许可证。请联系所有者。', ta: 'உரிமையாளர் மட்டுமே உரிமம் கோர முடியும். உரிமையாளரிடம் கேளுங்கள்.' })}</p> : sent ? (
        <div ref={done} tabIndex={-1} role="status" className="card max-w-xl border-l-4 border-l-accent">
          <h2 className="font-semibold">{t({ en: 'Request sent', ms: 'Permohonan dihantar', zh: '申请已发送', ta: 'கோரிக்கை அனுப்பப்பட்டது' })}</h2>
          <p className="mt-1">{t({ en: `We emailed you and our team. We will send your licence key to ${email}.`, ms: `Kami telah e-mel kepada anda dan pasukan kami. Kami akan menghantar kunci lesen anda ke ${email}.`, zh: `我们已向您和我们的团队发送了邮件。我们会把您的许可证密钥发送到 ${email}。`, ta: `நாங்கள் உங்களுக்கும் எங்கள் குழுவுக்கும் மின்னஞ்சல் அனுப்பினோம். உங்கள் உரிம விசையை ${email} க்கு அனுப்புவோம்.` })}</p>
          <p className="mt-3"><a className="link" href={backHref}>{t({ en: 'Back', ms: 'Kembali', zh: '返回', ta: 'பின்' })}</a></p>
        </div>
      ) : (
        <>
          <Async2 s={s} />
          {!s.loading && !s.error && plans.length === 0 && <EmptyState title={t({ en: 'No plans are available yet.', ms: 'Belum ada pelan tersedia.', zh: '暂无可用套餐。', ta: 'திட்டங்கள் எதுவும் இன்னும் கிடைக்கவில்லை.' })} />}
          {plans.length > 0 && <>
            <ul aria-label={t({ en: 'Plans', ms: 'Pelan', zh: '套餐', ta: 'திட்டங்கள்' })} className="mb-4 grid gap-3 sm:grid-cols-3">
              {plans.map(p => (
                <li key={p.key} className={`card ${p.key === plan ? 'border-accent' : ''}`}>
                  <h2 className="text-lg font-semibold">{p.name}</h2>
                  {p.key === plan && <p className="text-sm font-semibold text-accent">{t({ en: 'Selected', ms: 'Dipilih', zh: '已选', ta: 'தேர்ந்தெடுக்கப்பட்டது' })}</p>}
                  <p className="text-sm text-muted">{t({ en: `${p.seats} seats`, ms: `${p.seats} tempat`, zh: `${p.seats} 个席位`, ta: `${p.seats} இடங்கள்` })}</p>
                  <p className="mt-2 font-semibold">{p.price}</p>
                </li>
              ))}
            </ul>
            <form className="card grid max-w-xl gap-3" onSubmit={e => { e.preventDefault(); submit() }} aria-label={t({ en: 'Licence request', ms: 'Permohonan lesen', zh: '许可证申请', ta: 'உரிமக் கோரிக்கை' })}>
              <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Plan', ms: 'Pelan', zh: '套餐', ta: 'திட்டம்' })}
                <select className="input font-normal" value={plan} onChange={e => { setPlan(e.target.value); setSeats(String(plans.find(p => p.key === e.target.value)?.seats ?? seats)) }}>
                  {plans.map(p => <option key={p.key} value={p.key}>{`${p.name} (${t({ en: `${p.seats} seats`, ms: `${p.seats} tempat`, zh: `${p.seats} 个席位`, ta: `${p.seats} இடங்கள்` })})`}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Seats', ms: 'Tempat', zh: '席位', ta: 'இடங்கள்' })}
                <input className="input w-32 font-normal" type="number" min={1} max={1000} inputMode="numeric" value={seats} onChange={e => setSeats(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Note (optional)', ms: 'Nota (pilihan)', zh: '备注（可选）', ta: 'குறிப்பு (விருப்பம்)' })}
                <textarea className="input min-h-20 py-2 font-normal" maxLength={500} value={note} onChange={e => setNote(e.target.value)} />
              </label>
              {err && <p role="alert" className="text-sm text-warn">{err}</p>}
              <div><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t({ en: 'Sending...', ms: 'Menghantar...', zh: '正在发送...', ta: 'அனுப்புகிறது...' }) : t({ en: 'Send request', ms: 'Hantar permohonan', zh: '发送申请', ta: 'கோரிக்கையை அனுப்பு' })}</button> <button type="button" className="btn" aria-disabled={busy || undefined} onClick={pay}>{t({ en: 'Pay online', ms: 'Bayar dalam talian', zh: '在线支付', ta: 'ஆன்லைனில் செலுத்து' })}</button></div>
            </form>
          </>}
        </>
      )}
    </>
  )
}

// Loading / error for the plans list only (the form itself is not hidden by an error banner in the same place as Async would).
function Async2({ s }: { s: { loading: boolean; error?: string; data?: unknown; reload: () => void } }) {
  useLang()
  if (s.error) return <div role="alert" className="card mb-4 border-warn bg-warn-bg text-warn"><p>{s.error}</p><button type="button" className="btn mt-3" onClick={s.reload}>{t({ en: 'Retry loading', ms: 'Cuba muat semula', zh: '重新加载', ta: 'மீண்டும் ஏற்று' })}</button></div>
  if (s.loading && !s.data) return <Skeleton rows={3} shape="cards" />
  return null
}

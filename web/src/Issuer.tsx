import { useEffect, useId, useRef, useState } from 'react'
import { api, ApiError } from './api'
import { Async, EmptyState, PageHeader, Skeleton, msg, useFetch } from './ui'
import { useToast } from './Toast'
import { t, useLang, locale } from './i18n'
import { buildPayload, ed25519Supported, fingerprint, fromPem, generateKeys, publicKeyOf, signToken, toPem } from './licenseSign'

/*
  Operator page (#/issuer): create or load the signing key, then issue licences for requests. Signing happens in this browser tab with WebCrypto;
  the private key is held in component state only (never storage, never sent). The server gets the public key and finished tokens.
*/
interface Config { public_key: string | null; source: 'environment' | 'dashboard' | null; enforced: boolean }
interface Request { id: string; org: string; email: string; plan: string; seats: number; note?: string; requested_at: string; status: 'pending' | 'issued'; offer_expires_at: string | null }
interface Plan { key: string; name: string; seats: number }
interface Key { pkcs8: ArrayBuffer; pub: string }

const date = (s: string) => new Date(s).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

function useFingerprint(pub?: string | null) {
  const [fp, setFp] = useState('')
  useEffect(() => { setFp(''); if (pub) fingerprint(pub).then(setFp, () => setFp('')) }, [pub])
  return fp
}

// Confirmation before replacing a key that existing licences depend on.
function Confirm({ n, busy, onYes, onNo }: { n: number; busy: boolean; onYes: () => void; onNo: () => void }) {
  useLang()
  const box = useRef<HTMLDivElement>(null)
  const no = useRef<HTMLButtonElement>(null)
  useEffect(() => { no.current?.focus() }, [])
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return onNo()
    if (e.key !== 'Tab') return
    const b = box.current!.querySelectorAll<HTMLElement>('button')
    if (e.shiftKey && document.activeElement === b[0]) { e.preventDefault(); b[b.length - 1].focus() }
    else if (!e.shiftKey && document.activeElement === b[b.length - 1]) { e.preventDefault(); b[0].focus() }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4" onKeyDown={keys}>
      <div ref={box} role="alertdialog" aria-modal="true" aria-labelledby="ck-t" aria-describedby="ck-d" className="card w-full max-w-sm shadow-lg">
        <h2 id="ck-t" className="text-lg font-semibold">{t({ en: 'Replace the server key?', ms: 'Ganti kunci pelayan?', zh: '要更换服务器密钥吗？', ta: 'சேவையக விசையை மாற்றவா?' })}</h2>
        <p id="ck-d" className="mt-1 text-sm">{t({ en: `${n} ${n === 1 ? 'licence' : 'licences'} signed with the current key will stop working.`, ms: `${n} lesen yang ditandatangani dengan kunci semasa akan berhenti berfungsi.`, zh: `使用当前密钥签发的 ${n} 个许可证将失效。`, ta: `தற்போதைய விசையால் கையொப்பமிடப்பட்ட ${n} உரிமங்கள் செயல்படாது.` })}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button ref={no} type="button" className="btn btn-primary" onClick={onNo}>{t({ en: 'Keep the current key', ms: 'Kekalkan kunci semasa', zh: '保留当前密钥', ta: 'தற்போதைய விசையை வைத்திரு' })}</button>
          <button type="button" className="btn" aria-disabled={busy || undefined} onClick={() => !busy && onYes()}>{busy ? t({ en: 'Saving...', ms: 'Menyimpan...', zh: '正在保存...', ta: 'சேமிக்கிறது...' }) : t({ en: 'Replace anyway', ms: 'Tetap ganti', zh: '仍然更换', ta: 'எப்படியும் மாற்று' })}</button>
        </div>
      </div>
    </div>
  )
}

function KeyStep({ cfg, key_, setKey, reload }: { cfg: Config; key_: Key | null; setKey: (k: Key | null) => void; reload: () => void }) {
  useLang()
  const [fresh, setFresh] = useState<{ pem: string; url: string } | null>(null)
  const [paste, setPaste] = useState('')
  const [err, setErr] = useState('')
  const [saveErr, setSaveErr] = useState('')
  const [ask, setAsk] = useState<number | null>(null)  // licences that would stop working, while the dialog is open
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const id = useId()
  const fpServer = useFingerprint(cfg.public_key)
  const fpLoaded = useFingerprint(key_?.pub)
  useEffect(() => () => { if (fresh) URL.revokeObjectURL(fresh.url) }, [fresh])

  const create = async () => {
    setErr('')
    try {
      const k = await generateKeys()
      const pem = toPem(k.pkcs8)
      setFresh({ pem, url: URL.createObjectURL(new Blob([pem], { type: 'application/x-pem-file' })) })
      setKey({ pkcs8: k.pkcs8, pub: k.publicKey })
    } catch { setErr(t({ en: 'Could not create keys in this browser.', ms: 'Tidak dapat mencipta kunci dalam pelayar ini.', zh: '无法在此浏览器中创建密钥。', ta: 'இந்த உலாவியில் விசைகளை உருவாக்க முடியவில்லை.' })) }
  }
  const load = async (text: string) => {
    setErr('')
    try { const pkcs8 = fromPem(text); setKey({ pkcs8, pub: await publicKeyOf(pkcs8) }); setFresh(null); setPaste('') }
    catch { setErr(t({ en: 'That is not a private key. Use the private.pem file (it starts with BEGIN PRIVATE KEY) made for an Ed25519 key.', ms: 'Itu bukan kunci peribadi. Guna fail private.pem (bermula dengan BEGIN PRIVATE KEY) yang dibuat untuk kunci Ed25519.', zh: '这不是私钥。请使用为 Ed25519 密钥生成的 private.pem 文件（以 BEGIN PRIVATE KEY 开头）。', ta: 'இது தனிப்பட்ட விசை அல்ல. Ed25519 விசைக்காக உருவாக்கப்பட்ட private.pem கோப்பைப் (BEGIN PRIVATE KEY இல் தொடங்கும்) பயன்படுத்துங்கள்.' })) }
  }
  const save = async (confirm?: boolean) => {
    if (!key_ || busy) return
    setBusy(true); setSaveErr('')
    try { await api('POST', '/license/admin/public-key', confirm ? { public_key: key_.pub, confirm: true } : { public_key: key_.pub }); setAsk(null); toast(t({ en: 'Public key saved to this server.', ms: 'Kunci awam disimpan ke pelayan ini.', zh: '公钥已保存到此服务器。', ta: 'பொது விசை இந்த சேவையகத்தில் சேமிக்கப்பட்டது.' })); reload() }
    catch (e) {
      if (e instanceof ApiError && e.code === 'would_invalidate') setAsk(e.details?.licences ?? 0)
      else setSaveErr(e instanceof ApiError && e.code === 'key_from_environment' ? t({ en: 'The key is set in the server settings, so it cannot be changed here.', ms: 'Kunci ditetapkan dalam tetapan pelayan, jadi tidak boleh diubah di sini.', zh: '密钥在服务器设置中指定，因此无法在此更改。', ta: 'விசை சேவையக அமைப்புகளில் அமைக்கப்பட்டுள்ளதால் இங்கே மாற்ற முடியாது.' })
        : e instanceof ApiError && e.code === 'bad_key' ? t({ en: 'The server did not accept this public key.', ms: 'Pelayan tidak menerima kunci awam ini.', zh: '服务器不接受此公钥。', ta: 'சேவையகம் இந்த பொது விசையை ஏற்கவில்லை.' }) : msg(e))
    } finally { setBusy(false) }
  }
  const match = !key_ ? null : !cfg.public_key ? 'none' : key_.pub === cfg.public_key ? 'yes' : 'no'
  return (
    <section aria-labelledby={`${id}-h`} className="card mb-6" data-guide="iss-key">
      <h2 id={`${id}-h`} className="text-lg font-semibold">{t({ en: 'Step 1. Signing key', ms: 'Langkah 1. Kunci tandatangan', zh: '第 1 步：签名密钥', ta: 'படி 1. கையொப்ப விசை' })}</h2>
      <p className="mt-1 text-sm text-muted">{t({ en: 'The private key stays in this browser tab. It is never uploaded and never stored, so you load it again each time you open this page.', ms: 'Kunci peribadi kekal dalam tab pelayar ini. Ia tidak pernah dimuat naik atau disimpan, jadi anda memuatkannya semula setiap kali membuka halaman ini.', zh: '私钥只保留在此浏览器标签页中，不会上传也不会保存，因此每次打开此页面都需要重新加载。', ta: 'தனிப்பட்ட விசை இந்த உலாவி தாவலிலேயே இருக்கும். அது பதிவேற்றப்படுவதில்லை, சேமிக்கப்படுவதுமில்லை; எனவே இந்தப் பக்கத்தைத் திறக்கும் ஒவ்வொரு முறையும் மீண்டும் ஏற்றவும்.' })}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted">{t({ en: 'Server key', ms: 'Kunci pelayan', zh: '服务器密钥', ta: 'சேவையக விசை' })}</dt>
        <dd className="font-semibold">{cfg.public_key ? <>{fpServer}<span className="ml-2 font-normal text-muted">({cfg.source === 'environment' ? t({ en: 'set in server settings', ms: 'ditetapkan dalam tetapan pelayan', zh: '在服务器设置中指定', ta: 'சேவையக அமைப்புகளில் அமைக்கப்பட்டது' }) : t({ en: 'saved from this page', ms: 'disimpan dari halaman ini', zh: '从此页面保存', ta: 'இந்தப் பக்கத்திலிருந்து சேமிக்கப்பட்டது' })})</span></> : t({ en: 'None saved yet', ms: 'Belum ada disimpan', zh: '尚未保存', ta: 'இன்னும் சேமிக்கப்படவில்லை' })}</dd>
        <dt className="text-muted">{t({ en: 'Key in this tab', ms: 'Kunci dalam tab ini', zh: '此标签页中的密钥', ta: 'இந்த தாவலில் உள்ள விசை' })}</dt>
        <dd className="font-semibold">{key_ ? fpLoaded : t({ en: 'None loaded', ms: 'Tiada dimuatkan', zh: '未加载', ta: 'எதுவும் ஏற்றப்படவில்லை' })}</dd>
      </dl>
      {match && <p role="status" className={`mt-2 text-sm font-semibold ${match === 'no' ? 'text-warn' : ''}`}>
        {match === 'yes' ? t({ en: 'This key matches the server. You can issue licences.', ms: 'Kunci ini sepadan dengan pelayan. Anda boleh mengeluarkan lesen.', zh: '此密钥与服务器匹配。您可以签发许可证。', ta: 'இந்த விசை சேவையகத்துடன் பொருந்துகிறது. நீங்கள் உரிமங்களை வழங்கலாம்.' }) : match === 'no' ? t({ en: 'This key does NOT match the server key. Licences signed with it will be refused.', ms: 'Kunci ini TIDAK sepadan dengan kunci pelayan. Lesen yang ditandatangani dengannya akan ditolak.', zh: '此密钥与服务器密钥不匹配。用它签发的许可证将被拒绝。', ta: 'இந்த விசை சேவையக விசையுடன் பொருந்தவில்லை. இதனால் கையொப்பமிட்ட உரிமங்கள் நிராகரிக்கப்படும்.' }) : t({ en: 'The server has no key yet. Save the public key below first.', ms: 'Pelayan belum mempunyai kunci. Simpan kunci awam di bawah dahulu.', zh: '服务器还没有密钥。请先保存下面的公钥。', ta: 'சேவையகத்தில் இன்னும் விசை இல்லை. முதலில் கீழே உள்ள பொது விசையைச் சேமிக்கவும்.' })}</p>}

      {fresh && <div className="mt-3 rounded-ui border border-warn bg-warn-bg p-3 text-sm text-warn">
        <p className="font-semibold">{t({ en: 'Download your private key now and keep it safe.', ms: 'Muat turun kunci peribadi anda sekarang dan simpan dengan selamat.', zh: '请立即下载您的私钥并妥善保管。', ta: 'உங்கள் தனிப்பட்ட விசையை இப்போதே பதிவிறக்கி பாதுகாப்பாக வைத்திருங்கள்.' })}</p>
        <p className="mt-1">{t({ en: 'Anyone with this file can issue licences. We cannot recover it. Do not email it or put it in a shared folder.', ms: 'Sesiapa yang memiliki fail ini boleh mengeluarkan lesen. Kami tidak dapat memulihkannya. Jangan e-melkan atau letakkan dalam folder kongsi.', zh: '任何拥有此文件的人都可以签发许可证。我们无法找回它。请勿通过邮件发送或放入共享文件夹。', ta: 'இந்தக் கோப்பை வைத்திருப்பவர் யாரும் உரிமங்களை வழங்கலாம். இதை எங்களால் மீட்க முடியாது. மின்னஞ்சலில் அனுப்பவோ பகிர்ந்த கோப்புறையில் வைக்கவோ வேண்டாம்.' })}</p>
        <a className="btn mt-2" href={fresh.url} download="private.pem">{t({ en: 'Download private.pem', ms: 'Muat turun private.pem', zh: '下载 private.pem', ta: 'private.pem ஐப் பதிவிறக்கு' })}</a>
      </div>}
      {key_ && <div className="mt-3 text-sm">
        <p className="font-semibold">{t({ en: 'Public key', ms: 'Kunci awam', zh: '公钥', ta: 'பொது விசை' })}</p>
        <code className="mt-1 block break-all rounded-ui bg-tint p-2">{key_.pub}</code>
        {match !== 'yes' && <button type="button" className="btn btn-primary mt-2" aria-disabled={busy || cfg.source === 'environment' || undefined}
          title={cfg.source === 'environment' ? t({ en: 'The key is set in the server settings', ms: 'Kunci ditetapkan dalam tetapan pelayan', zh: '密钥在服务器设置中指定', ta: 'விசை சேவையக அமைப்புகளில் அமைக்கப்பட்டுள்ளது' }) : undefined} onClick={() => cfg.source !== 'environment' && save()}>{busy ? t({ en: 'Saving...', ms: 'Menyimpan...', zh: '正在保存...', ta: 'சேமிக்கிறது...' }) : t({ en: 'Save public key to this server', ms: 'Simpan kunci awam ke pelayan ini', zh: '将公钥保存到此服务器', ta: 'பொது விசையை இந்த சேவையகத்தில் சேமி' })}</button>}
        {saveErr && <p role="alert" className="mt-2 text-warn">{saveErr}</p>}
      </div>}

      <div className="mt-4 flex flex-wrap gap-2" data-guide="iss-create">
        <button type="button" className="btn" onClick={create}>{t({ en: 'Create new keys', ms: 'Cipta kunci baharu', zh: '创建新密钥', ta: 'புதிய விசைகளை உருவாக்கு' })}</button>
        {key_ && <button type="button" className="btn" onClick={() => { setKey(null); setFresh(null) }}>{t({ en: 'Remove key from this tab', ms: 'Buang kunci daripada tab ini', zh: '从此标签页移除密钥', ta: 'இந்த தாவலிலிருந்து விசையை நீக்கு' })}</button>}
      </div>
      <div className="mt-4 grid gap-2" data-guide="iss-load">
        <p className="text-sm font-semibold">{t({ en: 'Or load my private key', ms: 'Atau muatkan kunci peribadi saya', zh: '或加载我的私钥', ta: 'அல்லது என் தனிப்பட்ட விசையை ஏற்று' })}</p>
        <label className="flex flex-col gap-1 text-sm">{t({ en: 'Choose private.pem', ms: 'Pilih private.pem', zh: '选择 private.pem', ta: 'private.pem ஐத் தேர்ந்தெடு' })}
          <input type="file" accept=".pem,text/plain" className="input py-2" onChange={async e => { const f = e.target.files?.[0]; if (f) await load(await f.text()); e.target.value = '' }} />
        </label>
        <label className="flex flex-col gap-1 text-sm">{t({ en: 'Or paste its text', ms: 'Atau tampal teksnya', zh: '或粘贴其文本', ta: 'அல்லது அதன் உரையை ஒட்டு' })}
          <textarea className="input min-h-20 break-all py-2 font-mono" rows={3} autoComplete="off" spellCheck={false} placeholder="-----BEGIN PRIVATE KEY-----" value={paste} onChange={e => setPaste(e.target.value)} />
        </label>
        <div><button type="button" className="btn" aria-disabled={!paste.trim() || undefined} onClick={() => paste.trim() && load(paste)}>{t({ en: 'Use this key', ms: 'Guna kunci ini', zh: '使用此密钥', ta: 'இந்த விசையைப் பயன்படுத்து' })}</button></div>
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-warn">{err}</p>}
      {ask !== null && <Confirm n={ask} busy={busy} onYes={() => save(true)} onNo={() => setAsk(null)} />}
    </section>
  )
}

function RequestCard({ r, plans, key_, ready, onIssued }: { r: Request; plans: Plan[]; key_: Key | null; ready: boolean; onIssued: () => void }) {
  useLang()
  const asked = plans.find(p => p.key === r.plan)
  const options = [...new Set([r.plan, ...plans.filter(p => asked && p.seats <= asked.seats).map(p => p.key)])]  // never above what was asked
  const [plan, setPlan] = useState(r.plan)
  const [seats, setSeats] = useState(String(r.seats))
  const [days, setDays] = useState('365')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const id = useId()
  const issue = async () => {
    const n = Number(seats), d = Number(days)
    if (!key_ || !ready) return setErr(t({ en: 'Load the signing key that matches the server key in step 1 first.', ms: 'Muatkan kunci tandatangan yang sepadan dengan kunci pelayan dalam langkah 1 dahulu.', zh: '请先在第 1 步加载与服务器密钥匹配的签名密钥。', ta: 'முதலில் படி 1 இல் சேவையக விசைக்குப் பொருந்தும் கையொப்ப விசையை ஏற்றவும்.' }))
    if (!Number.isInteger(n) || n < 1 || n > r.seats) return setErr(t({ en: `Seats must be a whole number from 1 to ${r.seats}, the number asked for.`, ms: `Bilangan tempat mesti nombor bulat dari 1 hingga ${r.seats}, iaitu bilangan yang diminta.`, zh: `席位数必须是 1 到 ${r.seats} 之间的整数（即所申请的数量）。`, ta: `இடங்கள் 1 முதல் ${r.seats} வரையிலான முழு எண்ணாக இருக்க வேண்டும் (கேட்கப்பட்ட எண்ணிக்கை).` }))
    if (!Number.isInteger(d) || d < 1 || d > 1100) return setErr(t({ en: 'Days valid must be a whole number from 1 to 1100.', ms: 'Hari sah laku mesti nombor bulat dari 1 hingga 1100.', zh: '有效天数必须是 1 到 1100 之间的整数。', ta: 'செல்லுபடியாகும் நாட்கள் 1 முதல் 1100 வரையிலான முழு எண்ணாக இருக்க வேண்டும்.' }))
    setBusy(true); setErr('')
    try {
      const token = await signToken(key_.pkcs8, buildPayload({ email: r.email, org: r.org, plan, seats: n, days: d }))
      const out = await api<{ ok: boolean; emailed: boolean }>('POST', '/license/admin/issue', { request_id: r.id, token })
      toast(out.emailed ? t({ en: `Licence emailed to ${r.email}.`, ms: `Lesen dihantar melalui e-mel ke ${r.email}.`, zh: `许可证已通过邮件发送至 ${r.email}。`, ta: `உரிமம் ${r.email} க்கு மின்னஞ்சல் செய்யப்பட்டது.` }) : t({ en: 'Saved. The email could not be sent, the owner can still activate it from the Licence page.', ms: 'Disimpan. E-mel tidak dapat dihantar, pemilik masih boleh mengaktifkannya dari halaman Lesen.', zh: '已保存。邮件未能发出，所有者仍可在“许可证”页面激活。', ta: 'சேமிக்கப்பட்டது. மின்னஞ்சலை அனுப்ப முடியவில்லை; உரிமையாளர் இன்னும் உரிமம் பக்கத்திலிருந்து செயல்படுத்தலாம்.' }))
      onIssued()
    } catch (e) {
      setErr(e instanceof ApiError && e.code === 'token_mismatch' ? t({ en: 'The server rejected the licence. Check that the key in this tab matches the server key.', ms: 'Pelayan menolak lesen. Semak bahawa kunci dalam tab ini sepadan dengan kunci pelayan.', zh: '服务器拒绝了该许可证。请检查此标签页中的密钥是否与服务器密钥匹配。', ta: 'சேவையகம் உரிமத்தை நிராகரித்தது. இந்த தாவலில் உள்ள விசை சேவையக விசையுடன் பொருந்துகிறதா எனச் சரிபார்க்கவும்.' }) : msg(e))
    } finally { setBusy(false) }
  }
  return (
    <li className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="min-w-0 break-words font-semibold">{r.org}</h3>
        <span className={`badge ${r.status === 'pending' ? 'badge-warn' : ''}`}>{r.status === 'pending' ? t({ en: 'Waiting', ms: 'Menunggu', zh: '等待中', ta: 'காத்திருக்கிறது' }) : t({ en: 'Issued', ms: 'Dikeluarkan', zh: '已签发', ta: 'வழங்கப்பட்டது' })}</span>
      </div>
      <p className="break-all text-sm text-muted">{r.email}</p>
      <p className="mt-1 text-sm">{t({ en: `Asked for ${cap(r.plan)}, ${r.seats} seats, on ${date(r.requested_at)}.`, ms: `Memohon ${cap(r.plan)}, ${r.seats} tempat, pada ${date(r.requested_at)}.`, zh: `于 ${date(r.requested_at)} 申请 ${cap(r.plan)}，${r.seats} 个席位。`, ta: `${date(r.requested_at)} அன்று ${cap(r.plan)}, ${r.seats} இடங்கள் கோரப்பட்டன.` })}</p>
      {r.note && <p className="mt-1 text-sm text-muted">{t({ en: 'Note:', ms: 'Nota:', zh: '备注：', ta: 'குறிப்பு:' })} {r.note}</p>}
      {r.status === 'issued' && <p className="mt-1 text-sm">{r.offer_expires_at ? t({ en: `Licence valid until ${date(r.offer_expires_at)}.`, ms: `Lesen sah sehingga ${date(r.offer_expires_at)}.`, zh: `许可证有效期至 ${date(r.offer_expires_at)}。`, ta: `உரிமம் ${date(r.offer_expires_at)} வரை செல்லுபடியாகும்.` }) : t({ en: 'Licence issued.', ms: 'Lesen dikeluarkan.', zh: '许可证已签发。', ta: 'உரிமம் வழங்கப்பட்டது.' })}</p>}
      {r.status === 'pending' && (
        <form className="mt-3 grid gap-3 sm:grid-cols-3" data-guide="iss-issue" onSubmit={e => { e.preventDefault(); if (!busy) issue() }} aria-label={t({ en: `Issue licence for ${r.org}`, ms: `Keluarkan lesen untuk ${r.org}`, zh: `为 ${r.org} 签发许可证`, ta: `${r.org} க்கு உரிமம் வழங்கு` })}>
          <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Plan', ms: 'Pelan', zh: '套餐', ta: 'திட்டம்' })}
            <select className="input font-normal" value={plan} onChange={e => setPlan(e.target.value)}>
              {options.map(k => <option key={k} value={k}>{plans.find(p => p.key === k)?.name ?? cap(k)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: `Seats (up to ${r.seats})`, ms: `Tempat (sehingga ${r.seats})`, zh: `席位（最多 ${r.seats}）`, ta: `இடங்கள் (அதிகபட்சம் ${r.seats})` })}
            <input className="input font-normal" type="number" min={1} max={r.seats} inputMode="numeric" value={seats} onChange={e => setSeats(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Days valid', ms: 'Hari sah laku', zh: '有效天数', ta: 'செல்லுபடியாகும் நாட்கள்' })}
            <input className="input font-normal" type="number" min={1} max={1100} inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} />
          </label>
          {err && <p id={`${id}-e`} role="alert" className="text-sm text-warn sm:col-span-3">{err}</p>}
          <div className="sm:col-span-3">
            <button type="submit" className="btn btn-primary" aria-disabled={busy || !ready || undefined} title={ready ? undefined : t({ en: 'Load the matching signing key in step 1 first', ms: 'Muatkan kunci tandatangan yang sepadan dalam langkah 1 dahulu', zh: '请先在第 1 步加载匹配的签名密钥', ta: 'முதலில் படி 1 இல் பொருந்தும் கையொப்ப விசையை ஏற்றவும்' })}>{busy ? t({ en: 'Issuing...', ms: 'Mengeluarkan...', zh: '正在签发...', ta: 'வழங்குகிறது...' }) : t({ en: 'Issue and email', ms: 'Keluarkan dan e-mel', zh: '签发并发送邮件', ta: 'வழங்கி மின்னஞ்சல் செய்' })}</button>
          </div>
        </form>
      )}
    </li>
  )
}

function RequestsStep({ key_, ready }: { key_: Key | null; ready: boolean }) {
  useLang()
  const s = useFetch<Request[]>('/license/admin/requests')
  const plans = useFetch<{ plans: Plan[] }>('/license/plans')
  return (
    <section aria-labelledby="iss-r" data-guide="iss-requests">
      <h2 id="iss-r" className="mb-1 text-lg font-semibold">{t({ en: 'Step 2. Requests', ms: 'Langkah 2. Permohonan', zh: '第 2 步：申请', ta: 'படி 2. கோரிக்கைகள்' })}</h2>
      <p className="mb-3 text-sm text-muted">{t({ en: 'Seats and plan can be lowered but never raised above what was asked for.', ms: 'Tempat dan pelan boleh dikurangkan tetapi tidak boleh melebihi yang diminta.', zh: '席位和套餐可以调低，但不能高于所申请的。', ta: 'இடங்களையும் திட்டத்தையும் குறைக்கலாம், ஆனால் கேட்கப்பட்டதற்கு மேல் உயர்த்தக்கூடாது.' })}</p>
      <Async s={s} empty={s.data?.length === 0} emptyText={t({ en: 'No licence requests yet.', ms: 'Belum ada permohonan lesen.', zh: '暂无许可证申请。', ta: 'உரிம கோரிக்கைகள் இன்னும் இல்லை.' })} emptyHint={t({ en: 'When a business asks for a licence it appears here.', ms: 'Apabila perniagaan memohon lesen, ia akan muncul di sini.', zh: '有企业申请许可证时会显示在这里。', ta: 'ஒரு வணிகம் உரிமம் கேட்கும்போது அது இங்கே தோன்றும்.' })} rows={3}>
        <ul aria-label={t({ en: 'Licence requests', ms: 'Permohonan lesen', zh: '许可证申请', ta: 'உரிம கோரிக்கைகள்' })} className="grid gap-3">
          {s.data?.map(r => <RequestCard key={r.id} r={r} plans={plans.data?.plans ?? []} key_={key_} ready={ready} onIssued={s.reload} />)}
        </ul>
      </Async>
    </section>
  )
}

export function IssuerView() {
  useLang()
  const cfg = useFetch<Config>('/license/admin/config')
  const [key_, setKey] = useState<Key | null>(null)
  const [ok, setOk] = useState<boolean>()
  useEffect(() => { ed25519Supported().then(setOk) }, [])
  const header = <PageHeader title={t({ en: 'Issue licences', ms: 'Keluarkan lesen', zh: '签发许可证', ta: 'உரிமங்களை வழங்கு' })} description={t({ en: 'For the LARIS team: sign licences for customers who asked for one.', ms: 'Untuk pasukan LARIS: tandatangani lesen untuk pelanggan yang memintanya.', zh: '供 LARIS 团队使用：为申请许可证的客户签发许可证。', ta: 'LARIS குழுவுக்கு: கேட்ட வாடிக்கையாளர்களுக்கு உரிமங்களில் கையொப்பமிடுங்கள்.' })} />
  if (cfg.err instanceof ApiError && cfg.err.status === 404) return <><PageHeader title={t({ en: 'Issue licences', ms: 'Keluarkan lesen', zh: '签发许可证', ta: 'உரிமங்களை வழங்கு' })} /><EmptyState title={t({ en: 'This page is only for the LARIS team.', ms: 'Halaman ini hanya untuk pasukan LARIS.', zh: '此页面仅供 LARIS 团队使用。', ta: 'இந்தப் பக்கம் LARIS குழுவுக்கு மட்டுமே.' })} /></>
  if (ok === undefined || (cfg.loading && !cfg.data)) return <>{header}<Skeleton rows={3} shape="text" /></>
  if (!ok) return <>{header}<p role="alert" className="card border-warn bg-warn-bg text-warn">{t({ en: 'This browser cannot sign licences. Use a current Chrome, Edge, Firefox or Safari.', ms: 'Pelayar ini tidak boleh menandatangani lesen. Guna Chrome, Edge, Firefox atau Safari terkini.', zh: '此浏览器无法签署许可证。请使用最新版的 Chrome、Edge、Firefox 或 Safari。', ta: 'இந்த உலாவியால் உரிமங்களில் கையொப்பமிட முடியாது. புதிய Chrome, Edge, Firefox அல்லது Safari ஐப் பயன்படுத்துங்கள்.' })}</p></>
  if (!cfg.data) return <>{header}<Async s={cfg}><span /></Async></>
  return (
    <>
      {header}
      <KeyStep cfg={cfg.data} key_={key_} setKey={setKey} reload={cfg.reload} />
      <RequestsStep key_={key_} ready={!!key_ && (!cfg.data.public_key || key_.pub === cfg.data.public_key)} />
    </>
  )
}

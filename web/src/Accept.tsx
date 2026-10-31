import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { publicApi, ApiError } from './api'
import { rm, Skeleton } from './ui'
import { useLang, t, locale, LANGS } from './i18n'

/*
  Public customer page: #/q/<token>. Rendered by App before the shell, with no sign-in and no staff headers (publicApi sends none).
  Contract: GET /api/public/quote/{token}, POST .../accept {name, agree}, POST .../decline {reason?}. The signature is simulated; the server says so in `notice`.
*/
interface Line { description: string; qty: string; uom: string; unit_price: string; line_total: string }
interface Decided { decision: 'accepted' | 'declined'; at: string; name: string | null }
interface View {
  simulated: boolean; notice: string; issuer: { name: string; logo_url: string | null }
  quote: { doc_no: string; valid_until: string | null; status: string; currency: string; total: string; note: string | null; lines: Line[] }
  can_accept: boolean; decided: Decided | null
}
type Kind = 'gone' | 'decided' | 'name' | 'agree' | 'rate' | 'other'

// Which sentence an error gets. Pure, so it can be checked on its own.
export const kindOf = (status: number, code: string): Kind =>
  status === 404 ? 'gone' : status === 409 && code === 'already_decided' ? 'decided' : status === 422 && code === 'bad_name' ? 'name'
  : status === 422 && code === 'must_agree' ? 'agree' : status === 429 ? 'rate' : 'other'
const kindFrom = (e: unknown): Kind => (e instanceof ApiError ? kindOf(e.status, e.code) : 'other')

const S = {
  loading: { en: 'Loading your quotation', ms: 'Memuatkan sebut harga anda', zh: '正在加载您的报价单', ta: 'உங்கள் மேற்கோளை ஏற்றுகிறது' },
  quotation: { en: 'Quotation', ms: 'Sebut harga', zh: '报价单', ta: 'மேற்கோள்' },
  from: { en: 'From', ms: 'Daripada', zh: '来自', ta: 'அனுப்புநர்' },
  valid: { en: 'Valid until', ms: 'Sah sehingga', zh: '有效期至', ta: 'செல்லுபடியாகும் வரை' },
  lines: { en: 'Items', ms: 'Senarai barang', zh: '项目', ta: 'பொருட்கள்' },
  desc: { en: 'Description', ms: 'Perihal', zh: '说明', ta: 'விவரம்' }, qty: { en: 'Qty', ms: 'Kuantiti', zh: '数量', ta: 'அளவு' }, unit: { en: 'Unit', ms: 'Unit', zh: '单位', ta: 'அலகு' },
  price: { en: 'Unit price', ms: 'Harga seunit', zh: '单价', ta: 'அலகு விலை' }, amount: { en: 'Line total', ms: 'Jumlah baris', zh: '行合计', ta: 'வரி மொத்தம்' },
  total: { en: 'Total', ms: 'Jumlah', zh: '总计', ta: 'மொத்தம்' },
  terms: { en: 'Notes and terms', ms: 'Nota dan terma', zh: '备注与条款', ta: 'குறிப்புகளும் விதிமுறைகளும்' },
  sim: { en: 'Simulated signature for demonstration; not a legal e-signature.', ms: 'Tandatangan simulasi untuk demonstrasi; bukan tandatangan elektronik yang sah di sisi undang-undang.', zh: '此为演示用的模拟签名，不具法律效力的电子签名。', ta: 'செயல்விளக்கத்திற்கான உருவகப்படுத்தப்பட்ட கையொப்பம்; சட்டப்படி செல்லுபடியாகும் மின்னணுக் கையொப்பம் அல்ல.' },
  nameL: { en: 'Type your full name to accept', ms: 'Taip nama penuh anda untuk menerima', zh: '请输入您的全名以接受', ta: 'ஏற்க உங்கள் முழுப் பெயரை உள்ளிடவும்' },
  agree: { en: 'I agree to this quotation', ms: 'Saya bersetuju dengan sebut harga ini', zh: '我同意此报价单', ta: 'இந்த மேற்கோளுக்கு நான் ஒப்புக்கொள்கிறேன்' },
  accept: { en: 'Accept quotation', ms: 'Terima sebut harga', zh: '接受报价单', ta: 'மேற்கோளை ஏற்கவும்' }, working: { en: 'Working...', ms: 'Sedang diproses...', zh: '处理中...', ta: 'செயலாக்குகிறது...' },
  decline: { en: 'Decline', ms: 'Tolak', zh: '拒绝', ta: 'நிராகரி' },
  reason: { en: 'Reason (optional, up to 300 characters)', ms: 'Sebab (pilihan, sehingga 300 aksara)', zh: '原因（可选，最多 300 个字符）', ta: 'காரணம் (விருப்பம், 300 எழுத்துகள் வரை)' },
  sure: { en: 'Decline this quotation?', ms: 'Tolak sebut harga ini?', zh: '要拒绝此报价单吗？', ta: 'இந்த மேற்கோளை நிராகரிக்கவா?' },
  confirm: { en: 'Yes, decline', ms: 'Ya, tolak', zh: '是，拒绝', ta: 'ஆம், நிராகரி' }, back: { en: 'Go back', ms: 'Kembali', zh: '返回', ta: 'திரும்பு' },
  retry: { en: 'Try again', ms: 'Cuba lagi', zh: '重试', ta: 'மீண்டும் முயல்' },
  gone: { en: 'This link is not valid or has expired. Ask the business for a new one.', ms: 'Pautan ini tidak sah atau telah tamat tempoh. Minta pautan baharu daripada perniagaan.', zh: '此链接无效或已过期。请向商家索取新链接。', ta: 'இந்த இணைப்பு செல்லாதது அல்லது காலாவதியாகிவிட்டது. வணிகரிடம் புதிய ஒன்றைக் கேளுங்கள்.' },
  goneH: { en: 'This link cannot be used', ms: 'Pautan ini tidak boleh digunakan', zh: '此链接无法使用', ta: 'இந்த இணைப்பைப் பயன்படுத்த முடியாது' },
  rate: { en: 'Too many tries. Wait a minute and try again.', ms: 'Terlalu banyak percubaan. Tunggu seminit dan cuba lagi.', zh: '尝试次数过多。请等一分钟后再试。', ta: 'பல முயற்சிகள். ஒரு நிமிடம் காத்திருந்து மீண்டும் முயலவும்.' },
  other: { en: 'Something went wrong. Check your connection and try again.', ms: 'Sesuatu tidak kena. Semak sambungan anda dan cuba lagi.', zh: '出了点问题。请检查网络连接后重试。', ta: 'ஏதோ தவறு நடந்துவிட்டது. உங்கள் இணைப்பைச் சரிபார்த்து மீண்டும் முயலவும்.' },
  errH: { en: 'Could not load the quotation', ms: 'Tidak dapat memuatkan sebut harga', zh: '无法加载报价单', ta: 'மேற்கோளை ஏற்ற முடியவில்லை' },
  bad_name: { en: 'Type your full name (2 to 80 characters).', ms: 'Taip nama penuh anda (2 hingga 80 aksara).', zh: '请输入您的全名（2 至 80 个字符）。', ta: 'உங்கள் முழுப் பெயரை உள்ளிடவும் (2 முதல் 80 எழுத்துகள்).' },
  must_agree: { en: 'Tick the box to confirm you accept this quotation.', ms: 'Tandakan kotak untuk mengesahkan anda menerima sebut harga ini.', zh: '请勾选方框，确认您接受此报价单。', ta: 'இந்த மேற்கோளை ஏற்பதை உறுதிப்படுத்த பெட்டியைத் தேர்வு செய்யவும்.' },
  decidedA: { en: 'This quotation was accepted', ms: 'Sebut harga ini telah diterima', zh: '此报价单已被接受', ta: 'இந்த மேற்கோள் ஏற்கப்பட்டது' },
  decidedD: { en: 'This quotation was declined', ms: 'Sebut harga ini telah ditolak', zh: '此报价单已被拒绝', ta: 'இந்த மேற்கோள் நிராகரிக்கப்பட்டது' },
  by: { en: 'by', ms: 'oleh', zh: '由', ta: 'செய்தவர்' }, on: { en: 'on', ms: 'pada', zh: '于', ta: 'அன்று' },
}
const T = (k: keyof typeof S) => t(S[k])

export default function Accept({ token }: { token: string }) {
  const [lang, setLang] = useLang()
  const [state, setState] = useState<'loading' | 'ok' | Kind>('loading')
  const [v, setV] = useState<View>()
  const [tries, setTries] = useState(0)
  const [name, setName] = useState('')
  const [agree, setAgree] = useState(false)
  const [errs, setErrs] = useState({ name: '', agree: '', form: '' })
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ accepted: boolean; name: string }>()
  const [logoBad, setLogoBad] = useState(false)
  const h1 = useRef<HTMLHeadingElement>(null)
  const doneH = useRef<HTMLHeadingElement>(null)
  const nameIn = useRef<HTMLInputElement>(null)
  const why = useRef<HTMLTextAreaElement>(null)
  const kindText = (k: Kind) => (k === 'name' ? T('bad_name') : k === 'agree' ? T('must_agree') : k === 'rate' ? T('rate') : k === 'gone' ? T('gone') : T('other'))

  useEffect(() => {
    let live = true
    setState('loading')
    publicApi<View>('GET', `/public/quote/${encodeURIComponent(token)}`).then(
      d => { if (live) { setV(d); setState('ok') } },
      e => { if (live) setState(kindFrom(e) === 'gone' ? 'gone' : kindFrom(e) === 'rate' ? 'rate' : 'other') })
    return () => { live = false }
  }, [token, tries])

  useEffect(() => { document.title = v && state === 'ok' ? `${T('quotation')} ${v.quote.doc_no} · ${v.issuer.name}` : 'LARIS' }, [v, state, lang])
  useEffect(() => { if (state !== 'loading') h1.current?.focus() }, [state])
  useEffect(() => { if (done) doneH.current?.focus() }, [done])
  useEffect(() => { if (asking) why.current?.focus() }, [asking])

  const send = async (path: 'accept' | 'decline', body?: unknown) => {
    if (busy) return
    setBusy(true); setErrs(p => ({ ...p, form: '' }))
    try {
      await publicApi('POST', `/public/quote/${encodeURIComponent(token)}/${path}`, body)
      setDone({ accepted: path === 'accept', name: name.trim().replace(/\s+/g, ' ') })
    } catch (e) {
      const k = kindFrom(e)
      if (k === 'gone') setState('gone')
      else if (k === 'decided') setTries(n => n + 1)  // someone decided first: show the real decision
      else if (k === 'name') { setErrs(p => ({ ...p, name: T('bad_name') })); nameIn.current?.focus() }
      else if (k === 'agree') setErrs(p => ({ ...p, agree: T('must_agree') }))
      else setErrs(p => ({ ...p, form: kindText(k) }))
    } finally { setBusy(false) }
  }
  const accept = () => {
    const n = name.trim().replace(/\s+/g, ' ')
    const e = { name: n.length < 2 || n.length > 80 ? T('bad_name') : '', agree: agree ? '' : T('must_agree'), form: '' }
    setErrs(e)
    if (e.name) return nameIn.current?.focus()
    if (!e.agree) send('accept', { name: n, agree: true })
  }

  const shell = (children: ReactNode) => (
    <main id="main" data-plain className="mx-auto grid min-h-screen max-w-3xl content-start gap-5 px-4 py-6">
      <div className="flex flex-wrap justify-end gap-2">{LANGS.filter(l => l[0] !== lang).map(l => <button key={l[0]} type="button" lang={l[0]} className="btn" onClick={() => setLang(l[0])}>{l[1]}</button>)}</div>
      {children}
    </main>
  )
  if (state === 'loading') return shell(<div className="card" aria-busy="true"><p role="status" className="sr-only">{T('loading')}</p><Skeleton rows={4} /></div>)
  if (state !== 'ok' || !v) return shell(
    <div className="card" role="alert">
      <h1 ref={h1} tabIndex={-1} className="text-2xl font-semibold tracking-tight">{state === 'gone' ? T('goneH') : T('errH')}</h1>
      <p className="mt-2">{kindText(state as Kind)}</p>
      {state !== 'gone' && <button type="button" className="btn btn-primary mt-3" onClick={() => setTries(n => n + 1)}>{T('retry')}</button>}
    </div>)

  const { issuer, quote: q } = v
  const when = (s: string) => new Date(s).toLocaleDateString(locale(lang), { dateStyle: 'medium' })
  const num = (s: string) => Number(s).toLocaleString(locale(lang), { maximumFractionDigits: 4 })
  const d = v.decided
  const thanks = (a: boolean, n: string) => t(a
    ? { en: `Thank you, ${n}. Quote ${q.doc_no} is accepted. ${issuer.name} will start your job.`, ms: `Terima kasih, ${n}. Sebut harga ${q.doc_no} telah diterima. ${issuer.name} akan memulakan kerja anda.`, zh: `谢谢您，${n}。报价单 ${q.doc_no} 已接受。${issuer.name} 将开始处理您的工作。`, ta: `நன்றி, ${n}. மேற்கோள் ${q.doc_no} ஏற்கப்பட்டது. ${issuer.name} உங்கள் வேலையைத் தொடங்கும்.` }
    : { en: `You declined quote ${q.doc_no}. ${issuer.name} has been told.`, ms: `Anda telah menolak sebut harga ${q.doc_no}. ${issuer.name} telah dimaklumkan.`, zh: `您已拒绝报价单 ${q.doc_no}。已通知 ${issuer.name}。`, ta: `நீங்கள் மேற்கோள் ${q.doc_no} ஐ நிராகரித்தீர்கள். ${issuer.name} க்குத் தெரிவிக்கப்பட்டது.` })
  return shell(<>
    <header className="flex items-center gap-3">
      {issuer.logo_url && !logoBad
        ? <img src={issuer.logo_url} alt="" onError={() => setLogoBad(true)} className="h-12 max-w-40 rounded-ui border border-soft bg-white object-contain p-1" />
        : <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-ui border border-line bg-soft text-xl font-semibold">{issuer.name.trim().charAt(0).toUpperCase()}</span>}
      <div className="min-w-0">
        <p className="text-sm text-muted">{T('from')}</p>
        <p className="break-words font-semibold">{issuer.name}</p>
      </div>
    </header>

    <div>
      <h1 ref={h1} tabIndex={-1} className="break-words text-2xl font-semibold tracking-tight">{T('quotation')} {q.doc_no}</h1>
      <p className="mt-1 text-sm text-muted">{T('valid')}: {q.valid_until ?? '-'}</p>
    </div>

    <p role="note" className="card border-l-4 border-l-accent font-semibold">{lang !== 'en' ? T('sim') : v.notice}</p>

    {done && (
      <section className="card border-l-4 border-l-accent" role="status">
        <h2 ref={doneH} tabIndex={-1} className="font-semibold">{thanks(done.accepted, done.name)}</h2>
        <p className="mt-1 text-sm">{lang !== 'en' ? T('sim') : v.notice}</p>
      </section>
    )}
    {!done && d && (
      <section className="card border-l-4 border-l-accent">
        <h2 className="font-semibold">{d.decision === 'accepted' ? T('decidedA') : T('decidedD')}{d.name ? ` ${T('by')} ${d.name}` : ''} {T('on')} {when(d.at)}.</h2>
      </section>
    )}

    <section aria-labelledby="q-lines">
      <h2 id="q-lines" className="mb-2 text-lg font-semibold">{T('lines')}</h2>
      <div className="hidden sm:block">
        <table className="w-full">
          <caption className="sr-only">{T('quotation')} {q.doc_no}</caption>
          <thead><tr>
            <th scope="col">{T('desc')}</th><th scope="col" className="text-right">{T('qty')}</th><th scope="col">{T('unit')}</th>
            <th scope="col" className="text-right">{T('price')}</th><th scope="col" className="text-right">{T('amount')}</th>
          </tr></thead>
          <tbody>{q.lines.map((l, i) => (
            <tr key={i}><td className="break-words">{l.description}</td><td className="text-right tabular-nums">{num(l.qty)}</td><td>{l.uom}</td>
              <td className="whitespace-nowrap text-right tabular-nums">{rm(l.unit_price)}</td><td className="whitespace-nowrap text-right tabular-nums">{rm(l.line_total)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <ul className="grid gap-2 sm:hidden">{q.lines.map((l, i) => (
        <li key={i} className="card">
          <p className="break-words font-semibold">{l.description}</p>
          <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 text-sm">
            <dt className="text-muted">{T('qty')}</dt><dd className="text-right tabular-nums">{num(l.qty)} {l.uom}</dd>
            <dt className="text-muted">{T('price')}</dt><dd className="text-right tabular-nums">{rm(l.unit_price)}</dd>
            <dt className="text-muted">{T('amount')}</dt><dd className="text-right font-semibold tabular-nums">{rm(l.line_total)}</dd>
          </dl>
        </li>
      ))}</ul>
      <p className="mt-3 flex items-baseline justify-between gap-4 text-lg font-semibold"><span>{T('total')}</span><span className="tabular-nums">{rm(q.total)}</span></p>
    </section>

    {q.note && <section aria-labelledby="q-terms"><h2 id="q-terms" className="text-lg font-semibold">{T('terms')}</h2><p className="mt-1 whitespace-pre-line break-words">{q.note}</p></section>}

    {v.can_accept && !done && (
      <form className="card grid gap-3" noValidate onSubmit={e => { e.preventDefault(); if (!asking) accept() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">{T('nameL')}
          <input ref={nameIn} className="input font-normal" name="name" autoComplete="name" maxLength={80} value={name} aria-invalid={!!errs.name || undefined} aria-describedby={errs.name ? 'q-name-err' : undefined}
            onChange={e => { setName(e.target.value); setErrs(p => ({ ...p, name: '' })) }} /></label>
        {errs.name && <p id="q-name-err" role="alert" className="text-sm text-warn">{errs.name}</p>}
        <label className="flex min-h-11 items-center gap-2 font-semibold">
          <input type="checkbox" className="size-6 shrink-0 accent-(--accent)" checked={agree} aria-invalid={!!errs.agree || undefined} aria-describedby={errs.agree ? 'q-agree-err' : undefined}
            onChange={e => { setAgree(e.target.checked); setErrs(p => ({ ...p, agree: '' })) }} /> {T('agree')}</label>
        {errs.agree && <p id="q-agree-err" role="alert" className="text-sm text-warn">{errs.agree}</p>}
        {errs.form && <p role="alert" className="text-sm text-warn">{errs.form}</p>}
        {asking ? (
          <div role="group" aria-label={T('sure')} className="grid gap-2 rounded-ui border border-soft p-3">
            <p className="font-semibold">{T('sure')}</p>
            <label className="flex flex-col gap-1 text-sm font-semibold">{T('reason')}
              <textarea ref={why} className="input min-h-20 py-2 font-normal" maxLength={300} value={reason} onChange={e => setReason(e.target.value)} /></label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-danger" aria-disabled={busy || undefined} onClick={() => send('decline', reason.trim() ? { reason: reason.trim() } : undefined)}>{busy ? T('working') : T('confirm')}</button>
              <button type="button" className="btn" onClick={() => setAsking(false)}>{T('back')}</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? T('working') : T('accept')}</button>
            <button type="button" className="btn" onClick={() => setAsking(true)}>{T('decline')}</button>
          </div>
        )}
      </form>
    )}
  </>)
}

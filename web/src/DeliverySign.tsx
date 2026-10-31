import { useEffect, useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import { publicApi, ApiError } from './api'
import { rm, Skeleton } from './ui'
import { useLang, t, locale, LANGS } from './i18n'

/*
  Public delivery page: #/d/<token>. Rendered by App before the shell, with no sign-in and no staff headers (publicApi sends none).
  Contract: GET /api/public/delivery/{token}, POST .../sign {name, agree, problems?, mark?} (src/api/delivery.py). 404 is one generic answer,
  409 already_signed shows the real signature, 429 asks to wait. The optional drawn mark is a PNG of at most 600x300 pixels and 100 KB.
  What is recorded is said plainly; the page makes no claim about legal validity (that is a question for the lawyer, docs/order-chain-plan.md).
*/
interface Line { description: string; qty: string; uom: string; unit_price?: string; line_total?: string }
interface View {
  issuer: { name: string; logo_url: string | null }
  delivery_order: { doc_no: string; issued_on: string; status: string; show_prices: boolean; total?: string; lines: Line[] }
  can_sign: boolean; signed: { name: string; at: string; problems: string | null } | null
}
type Kind = 'gone' | 'signed' | 'name' | 'agree' | 'mark' | 'rate' | 'other'
export const kindOf = (status: number, code: string): Kind =>
  status === 404 ? 'gone' : status === 409 && code === 'already_signed' ? 'signed' : status === 422 && code === 'bad_name' ? 'name'
  : status === 422 && code === 'must_agree' ? 'agree' : status === 422 && code === 'bad_mark' ? 'mark' : status === 429 ? 'rate' : 'other'
const kindFrom = (e: unknown): Kind => (e instanceof ApiError ? kindOf(e.status, e.code) : 'other')
const MARK_W = 600, MARK_H = 300, MARK_MAX = 100_000

const S = {
  loading: { en: 'Loading your delivery order', ms: 'Memuatkan pesanan penghantaran anda', zh: '正在加载您的送货单', ta: 'உங்கள் டெலிவரி ஆணையை ஏற்றுகிறது' },
  title: { en: 'Delivery order', ms: 'Pesanan penghantaran', zh: '送货单', ta: 'டெலிவரி ஆணை' },
  from: { en: 'From', ms: 'Daripada', zh: '来自', ta: 'அனுப்புநர்' },
  issued: { en: 'Issued', ms: 'Dikeluarkan', zh: '开具日期', ta: 'வழங்கிய தேதி' },
  items: { en: 'Items delivered', ms: 'Barang dihantar', zh: '送达项目', ta: 'வழங்கிய பொருட்கள்' },
  desc: { en: 'Description', ms: 'Perihal', zh: '说明', ta: 'விவரம்' }, qty: { en: 'Qty', ms: 'Kuantiti', zh: '数量', ta: 'அளவு' }, unit: { en: 'Unit', ms: 'Unit', zh: '单位', ta: 'அலகு' },
  price: { en: 'Unit price', ms: 'Harga seunit', zh: '单价', ta: 'அலகு விலை' }, amount: { en: 'Line total', ms: 'Jumlah baris', zh: '行合计', ta: 'வரி மொத்தம்' },
  total: { en: 'Total', ms: 'Jumlah', zh: '总计', ta: 'மொத்தம்' },
  recorded: { en: 'What is recorded when you sign: your name, the time, and a code made from your device\'s network address (not the address itself), together with this delivery order. This is a record that you received the goods listed here.',
    ms: 'Apa yang direkodkan apabila anda menandatangani: nama anda, masa, dan kod yang dibuat daripada alamat rangkaian peranti anda (bukan alamat itu sendiri), bersama pesanan penghantaran ini. Ia ialah rekod bahawa anda menerima barang yang disenaraikan di sini.',
    zh: '签收时会记录：您的姓名、时间，以及由您设备网络地址生成的代码（不是地址本身），连同这张送货单。这是您收到上列货物的记录。',
    ta: 'நீங்கள் கையொப்பமிடும்போது பதிவாவது: உங்கள் பெயர், நேரம், உங்கள் சாதனத்தின் பிணைய முகவரியிலிருந்து உருவாக்கிய குறியீடு (முகவரியே அல்ல), மற்றும் இந்த டெலிவரி ஆணை. இங்கு பட்டியலிட்ட பொருட்களை நீங்கள் பெற்றதற்கான பதிவு இது.' },
  nameL: { en: 'Type your full name', ms: 'Taip nama penuh anda', zh: '请输入您的全名', ta: 'உங்கள் முழுப் பெயரை உள்ளிடவும்' },
  agree: { en: 'I received these goods', ms: 'Saya telah menerima barang ini', zh: '我已收到这些货物', ta: 'இந்தப் பொருட்களை நான் பெற்றேன்' },
  problems: { en: 'Anything missing or damaged? (optional, up to 300 characters)', ms: 'Ada yang hilang atau rosak? (pilihan, sehingga 300 aksara)', zh: '有缺少或损坏吗？（可选，最多 300 个字符）', ta: 'ஏதாவது குறைவா அல்லது சேதமா? (விருப்பம், 300 எழுத்துகள் வரை)' },
  markL: { en: 'Draw your mark (optional)', ms: 'Lukis tanda anda (pilihan)', zh: '画出您的签名标记（可选）', ta: 'உங்கள் குறியை வரையவும் (விருப்பம்)' },
  markHelp: { en: 'Use your finger or mouse in the box.', ms: 'Guna jari atau tetikus dalam kotak.', zh: '请用手指或鼠标在框内书写。', ta: 'பெட்டியில் விரல் அல்லது சுட்டியைப் பயன்படுத்தவும்.' },
  clear: { en: 'Clear', ms: 'Padam', zh: '清除', ta: 'அழி' },
  sign: { en: 'Sign for delivery', ms: 'Tandatangan penerimaan', zh: '签收', ta: 'டெலிவரிக்குக் கையொப்பமிடு' }, working: { en: 'Working...', ms: 'Sedang diproses...', zh: '处理中...', ta: 'செயலாக்குகிறது...' },
  retry: { en: 'Try again', ms: 'Cuba lagi', zh: '重试', ta: 'மீண்டும் முயல்' },
  gone: { en: 'This link is not valid or has expired. Ask the business for a new one.', ms: 'Pautan ini tidak sah atau telah tamat tempoh. Minta pautan baharu daripada perniagaan.', zh: '此链接无效或已过期。请向商家索取新链接。', ta: 'இந்த இணைப்பு செல்லாதது அல்லது காலாவதியாகிவிட்டது. வணிகரிடம் புதிய ஒன்றைக் கேளுங்கள்.' },
  goneH: { en: 'This link cannot be used', ms: 'Pautan ini tidak boleh digunakan', zh: '此链接无法使用', ta: 'இந்த இணைப்பைப் பயன்படுத்த முடியாது' },
  rate: { en: 'Too many tries. Wait a minute and try again.', ms: 'Terlalu banyak percubaan. Tunggu seminit dan cuba lagi.', zh: '尝试次数过多。请等一分钟后再试。', ta: 'பல முயற்சிகள். ஒரு நிமிடம் காத்திருந்து மீண்டும் முயலவும்.' },
  other: { en: 'Something went wrong. Check your connection and try again.', ms: 'Sesuatu tidak kena. Semak sambungan anda dan cuba lagi.', zh: '出了点问题。请检查网络连接后重试。', ta: 'ஏதோ தவறு நடந்துவிட்டது. உங்கள் இணைப்பைச் சரிபார்த்து மீண்டும் முயலவும்.' },
  errH: { en: 'Could not load the delivery order', ms: 'Tidak dapat memuatkan pesanan penghantaran', zh: '无法加载送货单', ta: 'டெலிவரி ஆணையை ஏற்ற முடியவில்லை' },
  bad_name: { en: 'Type your full name (2 to 80 characters).', ms: 'Taip nama penuh anda (2 hingga 80 aksara).', zh: '请输入您的全名（2 至 80 个字符）。', ta: 'உங்கள் முழுப் பெயரை உள்ளிடவும் (2 முதல் 80 எழுத்துகள்).' },
  must_agree: { en: 'Tick the box to confirm you received these goods.', ms: 'Tandakan kotak untuk mengesahkan anda menerima barang ini.', zh: '请勾选方框，确认您已收到这些货物。', ta: 'இந்தப் பொருட்களைப் பெற்றதை உறுதிப்படுத்த பெட்டியைத் தேர்வு செய்யவும்.' },
  bad_mark: { en: 'The drawing could not be used. Clear it and draw again, or leave it out.', ms: 'Lukisan tidak dapat digunakan. Padam dan lukis semula, atau tinggalkan.', zh: '该签名标记无法使用。请清除后重画，或不画。', ta: 'வரைபடத்தைப் பயன்படுத்த முடியவில்லை. அழித்து மீண்டும் வரையவும் அல்லது தவிர்க்கவும்.' },
  signedH: { en: 'This delivery order was signed', ms: 'Pesanan penghantaran ini telah ditandatangani', zh: '此送货单已签收', ta: 'இந்த டெலிவரி ஆணை கையொப்பமிடப்பட்டது' },
  by: { en: 'by', ms: 'oleh', zh: '由', ta: 'செய்தவர்' }, on: { en: 'on', ms: 'pada', zh: '于', ta: 'அன்று' },
  reported: { en: 'Reported problem:', ms: 'Masalah dilaporkan:', zh: '已报告的问题：', ta: 'தெரிவித்த சிக்கல்:' },
} satisfies Record<string, import('./i18n').Text>
const T = (k: keyof typeof S) => t(S[k])

// A mark as a PNG data URL within the server's limits, or null when empty; half size once if the first export is over 100 KB.
const exportMark = (c: HTMLCanvasElement): string | null => {
  let url = c.toDataURL('image/png')
  if (url.length * 0.75 > MARK_MAX) {
    const s = document.createElement('canvas'); s.width = MARK_W / 2; s.height = MARK_H / 2
    s.getContext('2d')?.drawImage(c, 0, 0, s.width, s.height)
    url = s.toDataURL('image/png')
  }
  return url.length * 0.75 > MARK_MAX ? null : url
}

export default function DeliverySign({ token }: { token: string }) {
  const [lang, setLang] = useLang()
  const [state, setState] = useState<'loading' | 'ok' | Kind>('loading')
  const [v, setV] = useState<View>()
  const [tries, setTries] = useState(0)
  const [name, setName] = useState('')
  const [agree, setAgree] = useState(false)
  const [problems, setProblems] = useState('')
  const [errs, setErrs] = useState({ name: '', agree: '', form: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string>()
  const [logoBad, setLogoBad] = useState(false)
  const [drawn, setDrawn] = useState(false)
  const h1 = useRef<HTMLHeadingElement>(null)
  const doneH = useRef<HTMLHeadingElement>(null)
  const nameIn = useRef<HTMLInputElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const pen = useRef<{ x: number; y: number } | null>(null)
  const kindText = (k: Kind) => (k === 'name' ? T('bad_name') : k === 'agree' ? T('must_agree') : k === 'mark' ? T('bad_mark') : k === 'rate' ? T('rate') : k === 'gone' ? T('gone') : T('other'))

  useEffect(() => {
    let live = true
    setState('loading')
    publicApi<View>('GET', `/public/delivery/${encodeURIComponent(token)}`).then(
      d => { if (live) { setV(d); setState('ok') } },
      e => { if (live) setState(kindFrom(e) === 'gone' ? 'gone' : kindFrom(e) === 'rate' ? 'rate' : 'other') })
    return () => { live = false }
  }, [token, tries])
  useEffect(() => { document.title = v && state === 'ok' ? `${T('title')} ${v.delivery_order.doc_no} · ${v.issuer.name}` : 'LARIS' }, [v, state, lang])
  useEffect(() => { if (state !== 'loading') h1.current?.focus() }, [state])
  useEffect(() => { if (done) doneH.current?.focus() }, [done])

  const at = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget, r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }
  }
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    const g = e.currentTarget.getContext('2d'); if (!g) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pen.current = at(e)
    g.fillStyle = '#111'; g.beginPath(); g.arc(pen.current.x, pen.current.y, 2, 0, 2 * Math.PI); g.fill(); setDrawn(true)
  }
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const g = e.currentTarget.getContext('2d'), a = pen.current; if (!g || !a) return
    const b = at(e)
    g.strokeStyle = '#111'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke()
    pen.current = b
  }
  const clear = () => { const c = cv.current; if (!c) return; const g = c.getContext('2d'); if (g) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height) } setDrawn(false) }
  useEffect(() => { if (state === 'ok') clear() }, [state, v?.can_sign])  // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (busy) return
    const n = name.trim().replace(/\s+/g, ' ')
    const e = { name: n.length < 2 || n.length > 80 ? T('bad_name') : '', agree: agree ? '' : T('must_agree'), form: '' }
    setErrs(e)
    if (e.name) return nameIn.current?.focus()
    if (e.agree) return
    const mark = drawn && cv.current ? exportMark(cv.current) : null
    if (drawn && !mark) return setErrs(p => ({ ...p, form: T('bad_mark') }))
    setBusy(true)
    try {
      await publicApi('POST', `/public/delivery/${encodeURIComponent(token)}/sign`, { name: n, agree: true, ...(problems.trim() ? { problems: problems.trim() } : {}), ...(mark ? { mark } : {}) })
      setDone(n)
    } catch (x) {
      const k = kindFrom(x)
      if (k === 'gone') setState('gone')
      else if (k === 'signed') setTries(c => c + 1)  // already signed: show the real signature
      else if (k === 'name') { setErrs(p => ({ ...p, name: T('bad_name') })); nameIn.current?.focus() }
      else if (k === 'agree') setErrs(p => ({ ...p, agree: T('must_agree') }))
      else setErrs(p => ({ ...p, form: kindText(k) }))
    } finally { setBusy(false) }
  }

  const shell = (children: ReactNode) => (
    <main id="main" className="mx-auto grid min-h-screen max-w-3xl content-start gap-5 px-4 py-6">
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

  const { issuer, delivery_order: d } = v
  const when = (s: string) => new Date(s).toLocaleString(locale(lang), { dateStyle: 'medium', timeStyle: 'short' })
  const num = (s: string) => Number(s).toLocaleString(locale(lang), { maximumFractionDigits: 4 })
  const px = d.show_prices
  const thanks = (n: string) => t({ en: `Thank you, ${n}. Delivery order ${d.doc_no} is signed. ${issuer.name} has been told.`, ms: `Terima kasih, ${n}. Pesanan penghantaran ${d.doc_no} telah ditandatangani. ${issuer.name} telah dimaklumkan.`,
    zh: `谢谢您，${n}。送货单 ${d.doc_no} 已签收。已通知 ${issuer.name}。`, ta: `நன்றி, ${n}. டெலிவரி ஆணை ${d.doc_no} கையொப்பமிடப்பட்டது. ${issuer.name} க்குத் தெரிவிக்கப்பட்டது.` })
  return shell(<>
    <header className="flex items-center gap-3">
      {issuer.logo_url && !logoBad
        ? <img src={issuer.logo_url} alt="" onError={() => setLogoBad(true)} className="h-12 max-w-40 rounded-ui border border-soft bg-white object-contain p-1" />
        : <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-ui border border-line bg-soft text-xl font-semibold">{issuer.name.trim().charAt(0).toUpperCase()}</span>}
      <div className="min-w-0"><p className="text-sm text-muted">{T('from')}</p><p className="break-words font-semibold">{issuer.name}</p></div>
    </header>
    <div>
      <h1 ref={h1} tabIndex={-1} className="break-words text-2xl font-semibold tracking-tight">{T('title')} {d.doc_no}</h1>
      <p className="mt-1 text-sm text-muted">{T('issued')}: {d.issued_on}</p>
    </div>

    {done && <section className="card border-l-4 border-l-accent" role="status"><h2 ref={doneH} tabIndex={-1} className="font-semibold">{thanks(done)}</h2></section>}
    {!done && v.signed && (
      <section className="card border-l-4 border-l-accent">
        <h2 className="font-semibold">{T('signedH')} {T('by')} {v.signed.name} {T('on')} {when(v.signed.at)}.</h2>
        {v.signed.problems && <p className="mt-1 text-sm">{T('reported')} {v.signed.problems}</p>}
      </section>
    )}

    <section aria-labelledby="d-lines">
      <h2 id="d-lines" className="mb-2 text-lg font-semibold">{T('items')}</h2>
      <ul className="grid gap-2">{d.lines.map((l, i) => (
        <li key={i} className="card">
          <p className="break-words font-semibold">{l.description}</p>
          <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 text-sm">
            <dt className="text-muted">{T('qty')}</dt><dd className="text-right tabular-nums">{num(l.qty)} {l.uom}</dd>
            {px && l.unit_price && <><dt className="text-muted">{T('price')}</dt><dd className="text-right tabular-nums">{rm(l.unit_price)}</dd></>}
            {px && l.line_total && <><dt className="text-muted">{T('amount')}</dt><dd className="text-right font-semibold tabular-nums">{rm(l.line_total)}</dd></>}
          </dl>
        </li>
      ))}</ul>
      {px && d.total && <p className="mt-3 flex items-baseline justify-between gap-4 text-lg font-semibold"><span>{T('total')}</span><span className="tabular-nums">{rm(d.total)}</span></p>}
    </section>

    {v.can_sign && !done && (
      <form className="card grid gap-3" noValidate onSubmit={e => { e.preventDefault(); void send() }}>
        <p role="note" className="text-sm">{T('recorded')}</p>
        <label className="flex flex-col gap-1 text-sm font-semibold">{T('nameL')}
          <input ref={nameIn} className="input font-normal" name="name" autoComplete="name" maxLength={80} value={name} aria-invalid={!!errs.name || undefined} aria-describedby={errs.name ? 'd-name-err' : undefined}
            onChange={e => { setName(e.target.value); setErrs(p => ({ ...p, name: '' })) }} /></label>
        {errs.name && <p id="d-name-err" role="alert" className="text-sm text-warn">{errs.name}</p>}
        <label className="flex min-h-11 items-center gap-2 font-semibold">
          <input type="checkbox" checked={agree} aria-invalid={!!errs.agree || undefined} aria-describedby={errs.agree ? 'd-agree-err' : undefined}
            onChange={e => { setAgree(e.target.checked); setErrs(p => ({ ...p, agree: '' })) }} /> {T('agree')}</label>
        {errs.agree && <p id="d-agree-err" role="alert" className="text-sm text-warn">{errs.agree}</p>}
        <label className="flex flex-col gap-1 text-sm font-semibold">{T('problems')}
          <textarea className="input min-h-20 py-2 font-normal" maxLength={300} value={problems} onChange={e => setProblems(e.target.value)} /></label>
        <div className="grid gap-1">
          <p className="text-sm font-semibold">{T('markL')}</p>
          <canvas ref={cv} width={MARK_W} height={MARK_H} className="block h-auto w-full touch-none rounded-ui border border-line bg-white" role="img" aria-label={T('markL')}
            onPointerDown={down} onPointerMove={move} onPointerUp={() => { pen.current = null }} onPointerCancel={() => { pen.current = null }} />
          <div className="flex flex-wrap items-center gap-2"><button type="button" className="btn" onClick={clear}>{T('clear')}</button><span className="text-sm text-muted">{T('markHelp')}</span></div>
        </div>
        {errs.form && <p role="alert" className="text-sm text-warn">{errs.form}</p>}
        <div className="flex flex-wrap gap-2"><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? T('working') : T('sign')}</button></div>
      </form>
    )}
  </>)
}

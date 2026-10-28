import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { publicApi, ApiError } from './api'
import { rm, Skeleton } from './ui'
import { useLang, t } from './i18n'

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
  loading: { en: 'Loading your quotation', ms: 'Memuatkan sebut harga anda' },
  quotation: { en: 'Quotation', ms: 'Sebut harga' },
  from: { en: 'From', ms: 'Daripada' },
  valid: { en: 'Valid until', ms: 'Sah sehingga' },
  lines: { en: 'Items', ms: 'Senarai barang' },
  desc: { en: 'Description', ms: 'Perihal' }, qty: { en: 'Qty', ms: 'Kuantiti' }, unit: { en: 'Unit', ms: 'Unit' },
  price: { en: 'Unit price', ms: 'Harga seunit' }, amount: { en: 'Line total', ms: 'Jumlah baris' },
  total: { en: 'Total', ms: 'Jumlah' },
  terms: { en: 'Notes and terms', ms: 'Nota dan terma' },
  sim: { en: 'Simulated signature for demonstration; not a legal e-signature.', ms: 'Tandatangan simulasi untuk demonstrasi; bukan tandatangan elektronik yang sah di sisi undang-undang.' },
  nameL: { en: 'Type your full name to accept', ms: 'Taip nama penuh anda untuk menerima' },
  agree: { en: 'I agree to this quotation', ms: 'Saya bersetuju dengan sebut harga ini' },
  accept: { en: 'Accept quotation', ms: 'Terima sebut harga' }, working: { en: 'Working...', ms: 'Sedang diproses...' },
  decline: { en: 'Decline', ms: 'Tolak' },
  reason: { en: 'Reason (optional, up to 300 characters)', ms: 'Sebab (pilihan, sehingga 300 aksara)' },
  sure: { en: 'Decline this quotation?', ms: 'Tolak sebut harga ini?' },
  confirm: { en: 'Yes, decline', ms: 'Ya, tolak' }, back: { en: 'Go back', ms: 'Kembali' },
  retry: { en: 'Try again', ms: 'Cuba lagi' },
  gone: { en: 'This link is not valid or has expired. Ask the business for a new one.', ms: 'Pautan ini tidak sah atau telah tamat tempoh. Minta pautan baharu daripada perniagaan.' },
  goneH: { en: 'This link cannot be used', ms: 'Pautan ini tidak boleh digunakan' },
  rate: { en: 'Too many tries. Wait a minute and try again.', ms: 'Terlalu banyak percubaan. Tunggu seminit dan cuba lagi.' },
  other: { en: 'Something went wrong. Check your connection and try again.', ms: 'Sesuatu tidak kena. Semak sambungan anda dan cuba lagi.' },
  errH: { en: 'Could not load the quotation', ms: 'Tidak dapat memuatkan sebut harga' },
  bad_name: { en: 'Type your full name (2 to 80 characters).', ms: 'Taip nama penuh anda (2 hingga 80 aksara).' },
  must_agree: { en: 'Tick the box to confirm you accept this quotation.', ms: 'Tandakan kotak untuk mengesahkan anda menerima sebut harga ini.' },
  decidedA: { en: 'This quotation was accepted', ms: 'Sebut harga ini telah diterima' },
  decidedD: { en: 'This quotation was declined', ms: 'Sebut harga ini telah ditolak' },
  by: { en: 'by', ms: 'oleh' }, on: { en: 'on', ms: 'pada' },
  lang: { en: 'Bahasa Melayu', ms: 'English' },
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
    <main id="main" className="mx-auto grid min-h-screen max-w-3xl content-start gap-5 px-4 py-6">
      <div className="flex justify-end"><button type="button" lang={lang === 'en' ? 'ms' : 'en'} className="btn" onClick={() => setLang(lang === 'en' ? 'ms' : 'en')}>{T('lang')}</button></div>
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
  const when = (s: string) => new Date(s).toLocaleDateString(lang === 'ms' ? 'ms-MY' : 'en-MY', { dateStyle: 'medium' })
  const num = (s: string) => Number(s).toLocaleString('en-MY', { maximumFractionDigits: 4 })
  const d = v.decided
  const thanks = lang === 'ms'
    ? (a: boolean, n: string) => a ? `Terima kasih, ${n}. Sebut harga ${q.doc_no} telah diterima. ${issuer.name} akan memulakan kerja anda.` : `Anda telah menolak sebut harga ${q.doc_no}. ${issuer.name} telah dimaklumkan.`
    : (a: boolean, n: string) => a ? `Thank you, ${n}. Quote ${q.doc_no} is accepted. ${issuer.name} will start your job.` : `You declined quote ${q.doc_no}. ${issuer.name} has been told.`
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

    <p role="note" className="card border-l-4 border-l-accent font-semibold">{lang === 'ms' ? T('sim') : v.notice}</p>

    {done && (
      <section className="card border-l-4 border-l-accent" role="status">
        <h2 ref={doneH} tabIndex={-1} className="font-semibold">{thanks(done.accepted, done.name)}</h2>
        <p className="mt-1 text-sm">{lang === 'ms' ? T('sim') : v.notice}</p>
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
          <input type="checkbox" checked={agree} aria-invalid={!!errs.agree || undefined} aria-describedby={errs.agree ? 'q-agree-err' : undefined}
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

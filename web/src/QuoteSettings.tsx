import { useEffect, useState } from 'react'
import { api, ApiError } from './api'
import { Hint, msg, useFetch } from './ui'
import { useToast } from './Toast'
import type { Settings } from './api'

type K = 'quote_validity_days' | 'quote_prefix' | 'quote_payment_terms' | 'quote_terms_text' | 'issuer_email' | 'issuer_phone'
type Form = Record<K, string>
const KEYS: K[] = ['quote_validity_days', 'quote_prefix', 'quote_payment_terms', 'quote_terms_text', 'issuer_email', 'issuer_phone']
const toForm = (s: Settings): Form => Object.fromEntries(KEYS.map(k => [k, s[k] == null ? '' : String(s[k])])) as Form
const LABEL: Record<K, string> = { quote_validity_days: 'Valid for (days)', quote_prefix: 'Quote number prefix', quote_payment_terms: 'Payment terms', quote_terms_text: 'Terms and conditions', issuer_email: 'Email on the quote', issuer_phone: 'Phone on the quote' }

function check(f: Form): Partial<Record<K, string>> {
  const e: Partial<Record<K, string>> = {}
  const d = f.quote_validity_days.trim()
  if (d && !(/^\d+$/.test(d) && +d >= 1 && +d <= 365)) e.quote_validity_days = 'Use a whole number from 1 to 365.'
  if (f.quote_prefix && !/^[A-Z0-9-]{1,8}$/.test(f.quote_prefix)) e.quote_prefix = 'Use 1 to 8 letters, digits or dashes.'
  if (f.issuer_email.trim() && (f.issuer_email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.issuer_email.trim()))) e.issuer_email = 'Enter an email address like name@company.com.'
  return e
}

// Settings > Quotations (owner only, under the settings form and Channels): defaults copied onto every new quote.
export function QuoteSettingsCard() {
  const s = useFetch<Settings>('/settings')
  const toast = useToast()
  const [f, setF] = useState<Form>()
  const [errs, setErrs] = useState<Partial<Record<K, string>>>({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (s.data) setF(toForm(s.data)) }, [s.data])
  const set = (k: K, v: string) => { setF(p => p && { ...p, [k]: v }); setErrs(p => ({ ...p, [k]: undefined })); setErr('') }
  const save = async () => {
    if (!f || !s.data || busy) return
    const e = check(f)
    setErrs(e)
    if (Object.keys(e).length) return setErr('Fix the fields marked below.')
    const base = toForm(s.data), body: Record<string, unknown> = {}
    for (const k of KEYS) {
      if (f[k].trim() === base[k].trim()) continue
      const v = f[k].trim()
      body[k] = v === '' ? null : k === 'quote_validity_days' ? Number(v) : v
    }
    if (!Object.keys(body).length) return setErr('Nothing changed.')
    setBusy(true); setErr('')
    try { await api('POST', '/settings', body); toast('Quotation settings saved.'); s.reload() }
    catch (x) {
      const fe: Partial<Record<K, string>> = {}
      if (x instanceof ApiError && x.status === 422) for (const it of x.fields ?? []) if (KEYS.includes(it.field as K)) fe[it.field as K] = it.message
      if (Object.keys(fe).length) { setErrs(fe); setErr('Fix the fields marked below.') } else setErr(msg(x))
    } finally { setBusy(false) }
  }
  const year = new Date().getFullYear()
  const field = (k: K, help: string, o: { area?: number; max: number; type?: string; ph?: string; mode?: 'numeric' | 'email' | 'tel' | 'text'; w?: string; extra?: string }) => {
    const v = f![k], bad = errs[k]
    const p = { id: `qs-${k}`, className: `input font-normal ${o.w ?? ''}`, value: v, maxLength: o.max, placeholder: o.ph, 'aria-invalid': !!bad || undefined, 'aria-describedby': `qs-${k}-h${bad ? ` qs-${k}-e` : ''}`,
      onChange: (ev: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => set(k, k === 'quote_prefix' ? ev.target.value.toUpperCase() : ev.target.value) }
    return (
      <div className="grid gap-1" key={k}>
        <label htmlFor={p.id} className="text-sm font-semibold">{LABEL[k]}</label>
        {o.area ? <textarea {...p} rows={o.area} className={`${p.className} py-2`} /> : <input {...p} type={o.type ?? 'text'} inputMode={o.mode} autoComplete="off" spellCheck={false} />}
        <Hint id={`qs-${k}-h`}>{help}{o.area ? ` ${o.max - v.length} characters left.` : ''}{o.extra}</Hint>
        {bad && <p id={`qs-${k}-e`} role="alert" className="text-sm text-warn">{bad}</p>}
      </div>
    )
  }
  return (
    <section className="card mt-8 max-w-xl" aria-labelledby="qs" data-guide="st-quotes">
      <h2 id="qs" className="text-lg font-semibold">Quotations</h2>
      <p className="mb-3 text-sm text-muted">Defaults for every new quote. Quotes you already made keep the values they had.</p>
      {s.error ? <div role="alert" className="text-sm text-warn"><p>{s.error}</p><button type="button" className="btn mt-2" onClick={s.reload}>Retry loading</button></div>
        : !f ? <div role="status" aria-busy="true" className="skeleton h-24"><span className="sr-only">Loading...</span></div>
        : <form className="grid gap-3" onSubmit={e => { e.preventDefault(); save() }} noValidate>
          {field('quote_validity_days', 'How long a quote stays open. Leave empty for 30 days.', { max: 3, mode: 'numeric', w: 'w-32', ph: '30' })}
          {field('quote_prefix', 'Capital letters, digits and dashes, up to 8. Leave empty for QT.', { max: 8, w: 'w-40', ph: 'QT' })}
          <p aria-live="polite" className="-mt-1 text-sm">Example: <strong>{f.quote_prefix || 'QT'}-{year}-0001</strong></p>
          {field('quote_payment_terms', 'Printed under the totals, for example "50% deposit, balance on delivery".', { area: 3, max: 500 })}
          {field('quote_terms_text', 'Your standard terms and conditions, printed at the end of the quote.', { area: 5, max: 2000 })}
          {field('issuer_email', 'Shown in the quote header so customers can reply. Leave empty to hide.', { max: 254, type: 'email', mode: 'email' })}
          {field('issuer_phone', 'Shown in the quote header. Leave empty to hide.', { max: 40, type: 'tel', mode: 'tel', w: 'w-56' })}
          {err && <p role="alert" className="text-sm text-warn">{err}</p>}
          <div><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Saving...' : 'Save quotation settings'}</button></div>
        </form>}
    </section>
  )
}

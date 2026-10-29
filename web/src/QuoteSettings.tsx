import { useEffect, useState } from 'react'
import { api, ApiError } from './api'
import { Hint, msg, useFetch } from './ui'
import { useToast } from './Toast'
import type { Settings } from './api'
import { t, useLang } from './i18n'
import type { Text } from './i18n'

type K = 'quote_validity_days' | 'quote_prefix' | 'quote_payment_terms' | 'quote_terms_text' | 'issuer_email' | 'issuer_phone'
type Form = Record<K, string>
const KEYS: K[] = ['quote_validity_days', 'quote_prefix', 'quote_payment_terms', 'quote_terms_text', 'issuer_email', 'issuer_phone']
const toForm = (s: Settings): Form => Object.fromEntries(KEYS.map(k => [k, s[k] == null ? '' : String(s[k])])) as Form
const LABEL: Record<K, Text> = {
  quote_validity_days: { en: 'Valid for (days)', ms: 'Sah selama (hari)', zh: '有效期（天）', ta: 'செல்லுபடியாகும் காலம் (நாட்கள்)' },
  quote_prefix: { en: 'Quote number prefix', ms: 'Awalan nombor sebut harga', zh: '报价单编号前缀', ta: 'விலைப்பட்டியல் எண் முன்னொட்டு' },
  quote_payment_terms: { en: 'Payment terms', ms: 'Terma pembayaran', zh: '付款条款', ta: 'பணம் செலுத்தும் விதிமுறைகள்' },
  quote_terms_text: { en: 'Terms and conditions', ms: 'Terma dan syarat', zh: '条款与条件', ta: 'விதிமுறைகளும் நிபந்தனைகளும்' },
  issuer_email: { en: 'Email on the quote', ms: 'E-mel pada sebut harga', zh: '报价单上的电子邮件', ta: 'விலைப்பட்டியலில் மின்னஞ்சல்' },
  issuer_phone: { en: 'Phone on the quote', ms: 'Telefon pada sebut harga', zh: '报价单上的电话', ta: 'விலைப்பட்டியலில் தொலைபேசி' },
}

function check(f: Form): Partial<Record<K, string>> {
  const e: Partial<Record<K, string>> = {}
  const d = f.quote_validity_days.trim()
  if (d && !(/^\d+$/.test(d) && +d >= 1 && +d <= 365)) e.quote_validity_days = t({ en: 'Use a whole number from 1 to 365.', ms: 'Gunakan nombor bulat dari 1 hingga 365.', zh: '请输入 1 到 365 之间的整数。', ta: '1 முதல் 365 வரையிலான முழு எண்ணை உள்ளிடவும்.' })
  if (f.quote_prefix && !/^[A-Z0-9-]{1,8}$/.test(f.quote_prefix)) e.quote_prefix = t({ en: 'Use 1 to 8 letters, digits or dashes.', ms: 'Gunakan 1 hingga 8 huruf, digit atau sengkang.', zh: '请使用 1 到 8 个字母、数字或连字符。', ta: '1 முதல் 8 எழுத்துகள், எண்கள் அல்லது கோடுகளைப் பயன்படுத்தவும்.' })
  if (f.issuer_email.trim() && (f.issuer_email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.issuer_email.trim()))) e.issuer_email = t({ en: 'Enter an email address like name@company.com.', ms: 'Masukkan alamat e-mel seperti name@company.com.', zh: '请输入类似 name@company.com 的电子邮件地址。', ta: 'name@company.com போன்ற மின்னஞ்சல் முகவரியை உள்ளிடவும்.' })
  return e
}

// Settings > Quotations (owner only, under the settings form and Channels): defaults copied onto every new quote.
export function QuoteSettingsCard() {
  useLang()
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
    if (Object.keys(e).length) return setErr(t({ en: 'Fix the fields marked below.', ms: 'Betulkan medan yang ditandakan di bawah.', zh: '请修正下方标记的字段。', ta: 'கீழே குறிக்கப்பட்ட புலங்களைச் சரிசெய்யவும்.' }))
    const base = toForm(s.data), body: Record<string, unknown> = {}
    for (const k of KEYS) {
      if (f[k].trim() === base[k].trim()) continue
      const v = f[k].trim()
      body[k] = v === '' ? null : k === 'quote_validity_days' ? Number(v) : v
    }
    if (!Object.keys(body).length) return setErr(t({ en: 'Nothing changed.', ms: 'Tiada perubahan.', zh: '没有更改。', ta: 'மாற்றம் எதுவும் இல்லை.' }))
    setBusy(true); setErr('')
    try { await api('POST', '/settings', body); toast(t({ en: 'Quotation settings saved.', ms: 'Tetapan sebut harga disimpan.', zh: '报价设置已保存。', ta: 'விலைப்பட்டியல் அமைப்புகள் சேமிக்கப்பட்டன.' })); s.reload() }
    catch (x) {
      const fe: Partial<Record<K, string>> = {}
      if (x instanceof ApiError && x.status === 422) for (const it of x.fields ?? []) if (KEYS.includes(it.field as K)) fe[it.field as K] = it.message
      if (Object.keys(fe).length) { setErrs(fe); setErr(t({ en: 'Fix the fields marked below.', ms: 'Betulkan medan yang ditandakan di bawah.', zh: '请修正下方标记的字段。', ta: 'கீழே குறிக்கப்பட்ட புலங்களைச் சரிசெய்யவும்.' })) } else setErr(msg(x))
    } finally { setBusy(false) }
  }
  const year = new Date().getFullYear()
  const field = (k: K, help: string, o: { area?: number; max: number; type?: string; ph?: string; mode?: 'numeric' | 'email' | 'tel' | 'text'; w?: string; extra?: string }) => {
    const v = f![k], bad = errs[k]
    const p = { id: `qs-${k}`, className: `input font-normal ${o.w ?? ''}`, value: v, maxLength: o.max, placeholder: o.ph, 'aria-invalid': !!bad || undefined, 'aria-describedby': `qs-${k}-h${bad ? ` qs-${k}-e` : ''}`,
      onChange: (ev: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => set(k, k === 'quote_prefix' ? ev.target.value.toUpperCase() : ev.target.value) }
    return (
      <div className="grid gap-1" key={k}>
        <label htmlFor={p.id} className="text-sm font-semibold">{t(LABEL[k])}</label>
        {o.area ? <textarea {...p} rows={o.area} className={`${p.className} py-2`} /> : <input {...p} type={o.type ?? 'text'} inputMode={o.mode} autoComplete="off" spellCheck={false} />}
        <Hint id={`qs-${k}-h`}>{help}{o.area ? ' ' + t({ en: `${o.max - v.length} characters left.`, ms: `${o.max - v.length} aksara lagi.`, zh: `还可输入 ${o.max - v.length} 个字符。`, ta: `${o.max - v.length} எழுத்துகள் மீதமுள்ளன.` }) : ''}{o.extra}</Hint>
        {bad && <p id={`qs-${k}-e`} role="alert" className="text-sm text-warn">{bad}</p>}
      </div>
    )
  }
  return (
    <section className="card mt-8 max-w-xl" aria-labelledby="qs" data-guide="st-quotes">
      <h2 id="qs" className="text-lg font-semibold">{t({ en: 'Quotations', ms: 'Sebut harga', zh: '报价单', ta: 'விலைப்பட்டியல்கள்' })}</h2>
      <p className="mb-3 text-sm text-muted">{t({ en: 'Defaults for every new quote. Quotes you already made keep the values they had.', ms: 'Nilai lalai untuk setiap sebut harga baharu. Sebut harga yang telah anda buat mengekalkan nilai asalnya.', zh: '每份新报价单的默认值。已创建的报价单保持原有数值。', ta: 'ஒவ்வொரு புதிய விலைப்பட்டியலுக்கும் இயல்புநிலைகள். ஏற்கெனவே உருவாக்கிய விலைப்பட்டியல்கள் தங்கள் மதிப்புகளை வைத்திருக்கும்.' })}</p>
      {s.error ? <div role="alert" className="text-sm text-warn"><p>{s.error}</p><button type="button" className="btn mt-2" onClick={s.reload}>{t({ en: 'Retry loading', ms: 'Cuba muat semula', zh: '重新加载', ta: 'மீண்டும் ஏற்று' })}</button></div>
        : !f ? <div role="status" aria-busy="true" className="skeleton h-24"><span className="sr-only">{t({ en: 'Loading...', ms: 'Memuatkan...', zh: '加载中...', ta: 'ஏற்றுகிறது...' })}</span></div>
        : <form className="grid gap-3" onSubmit={e => { e.preventDefault(); save() }} noValidate>
          {field('quote_validity_days', t({ en: 'How long a quote stays open. Leave empty for 30 days.', ms: 'Tempoh sebut harga kekal terbuka. Biarkan kosong untuk 30 hari.', zh: '报价单保持有效的时长。留空则为 30 天。', ta: 'விலைப்பட்டியல் எவ்வளவு காலம் திறந்திருக்கும். 30 நாட்களுக்கு காலியாக விடவும்.' }), { max: 3, mode: 'numeric', w: 'w-32', ph: '30' })}
          {field('quote_prefix', t({ en: 'Capital letters, digits and dashes, up to 8. Leave empty for QT.', ms: 'Huruf besar, digit dan sengkang, sehingga 8. Biarkan kosong untuk QT.', zh: '大写字母、数字和连字符，最多 8 个。留空则为 QT。', ta: 'பெரிய எழுத்துகள், எண்கள், கோடுகள், அதிகபட்சம் 8. QT க்கு காலியாக விடவும்.' }), { max: 8, w: 'w-40', ph: 'QT' })}
          <p aria-live="polite" className="-mt-1 text-sm">{t({ en: 'Example', ms: 'Contoh', zh: '示例', ta: 'எடுத்துக்காட்டு' })}: <strong>{f.quote_prefix || 'QT'}-{year}-0001</strong></p>
          {field('quote_payment_terms', t({ en: 'Printed under the totals, for example "50% deposit, balance on delivery".', ms: 'Dicetak di bawah jumlah, contohnya "deposit 50%, baki semasa penghantaran".', zh: '印在合计下方，例如“预付 50%，余款货到付清”。', ta: 'மொத்தங்களுக்குக் கீழே அச்சிடப்படும், எ.கா. "50% முன்பணம், மீதி டெலிவரியின்போது".' }), { area: 3, max: 500 })}
          {field('quote_terms_text', t({ en: 'Your standard terms and conditions, printed at the end of the quote.', ms: 'Terma dan syarat standard anda, dicetak di hujung sebut harga.', zh: '你的标准条款与条件，印在报价单末尾。', ta: 'உங்கள் நிலையான விதிமுறைகளும் நிபந்தனைகளும், விலைப்பட்டியலின் இறுதியில் அச்சிடப்படும்.' }), { area: 5, max: 2000 })}
          {field('issuer_email', t({ en: 'Shown in the quote header so customers can reply. Leave empty to hide.', ms: 'Dipaparkan pada pengepala sebut harga supaya pelanggan boleh membalas. Biarkan kosong untuk menyembunyikan.', zh: '显示在报价单抬头，方便客户回复。留空则不显示。', ta: 'வாடிக்கையாளர்கள் பதிலளிக்க விலைப்பட்டியல் தலைப்பில் காட்டப்படும். மறைக்க காலியாக விடவும்.' }), { max: 254, type: 'email', mode: 'email' })}
          {field('issuer_phone', t({ en: 'Shown in the quote header. Leave empty to hide.', ms: 'Dipaparkan pada pengepala sebut harga. Biarkan kosong untuk menyembunyikan.', zh: '显示在报价单抬头。留空则不显示。', ta: 'விலைப்பட்டியல் தலைப்பில் காட்டப்படும். மறைக்க காலியாக விடவும்.' }), { max: 40, type: 'tel', mode: 'tel', w: 'w-56' })}
          {err && <p role="alert" className="text-sm text-warn">{err}</p>}
          <div><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t({ en: 'Saving...', ms: 'Menyimpan...', zh: '保存中...', ta: 'சேமிக்கிறது...' }) : t({ en: 'Save quotation settings', ms: 'Simpan tetapan sebut harga', zh: '保存报价设置', ta: 'விலைப்பட்டியல் அமைப்புகளைச் சேமி' })}</button></div>
        </form>}
    </section>
  )
}

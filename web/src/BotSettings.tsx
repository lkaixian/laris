import { useEffect, useState } from 'react'
import { api, ApiError } from './api'
import type { BotSettingsView } from './api'
import { Hint, msg, useFetch } from './ui'
import { useToast } from './Toast'
import { t, useLang } from './i18n'
import type { Text } from './i18n'

type Form = Omit<BotSettingsView, 'defaults'>
const DAYS: Text[] = [
  { en: 'Monday', ms: 'Isnin', zh: '星期一', ta: 'திங்கள்' }, { en: 'Tuesday', ms: 'Selasa', zh: '星期二', ta: 'செவ்வாய்' },
  { en: 'Wednesday', ms: 'Rabu', zh: '星期三', ta: 'புதன்' }, { en: 'Thursday', ms: 'Khamis', zh: '星期四', ta: 'வியாழன்' },
  { en: 'Friday', ms: 'Jumaat', zh: '星期五', ta: 'வெள்ளி' }, { en: 'Saturday', ms: 'Sabtu', zh: '星期六', ta: 'சனி' },
  { en: 'Sunday', ms: 'Ahad', zh: '星期日', ta: 'ஞாயிறு' },
]
const LANGS: [Form['language'], Text][] = [['auto', { en: "Detect from the customer's message", ms: 'Kesan daripada mesej pelanggan', zh: '根据客户的消息自动识别', ta: 'வாடிக்கையாளர் செய்தியிலிருந்து கண்டறி' }], ['en', { en: 'English', ms: 'English', zh: 'English', ta: 'English' }], ['ms', { en: 'Bahasa Melayu', ms: 'Bahasa Melayu', zh: 'Bahasa Melayu', ta: 'Bahasa Melayu' }]]
const DEF: Text = { en: 'Use the default', ms: 'Guna nilai lalai', zh: '使用默认值', ta: 'இயல்புநிலையைப் பயன்படுத்து' }
const EMPTY: Text = { en: '(empty)', ms: '(kosong)', zh: '（空）', ta: '(காலி)' }
const MAX = { welcome: 600, help: 1000, after_hours: 300 }
const strip = ({ defaults: _d, ...f }: BotSettingsView): Form => f  // eslint-disable-line @typescript-eslint/no-unused-vars

// Settings > Channels (owner only): what the customer bot says, with a live preview.
export function BotSettings() {
  useLang()
  const s = useFetch<BotSettingsView>('/settings/telegram/bot-settings')
  const [f, setF] = useState<Form | null>(null)
  const [errs, setErrs] = useState<{ field: string; message: string }[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState(false)
  const toast = useToast()
  useEffect(() => { if (s.data) setF(strip(s.data)) }, [s.data])
  const d = s.data?.defaults
  const send = async (body: Partial<Form>, done: string) => {
    if (busy) return
    setErr(''); setErrs([]); setBusy(true)
    try { const v = await api<BotSettingsView>('POST', '/settings/telegram/bot-settings', body); setF(strip(v)); setAsk(false); toast(done); s.reload() }
    catch (e) {
      if (e instanceof ApiError && e.status === 422 && e.fields?.length) { e.shown = true; setErrs(e.fields) } else setErr(msg(e))
    } finally { setBusy(false) }
  }
  const fe = (k: string) => errs.filter(x => x.field === k || x.field.startsWith(k + '.') || x.field.startsWith(k + '[')).map(x => x.message).join(' ')
  const FieldErr = ({ k }: { k: string }) => (fe(k) ? <p id={`bs-${k}-err`} role="alert" className="text-sm text-warn">{fe(k)}</p> : null)
  const inv = (k: string) => ({ 'aria-invalid': fe(k) ? true : undefined, 'aria-describedby': fe(k) ? `bs-${k}-err` : undefined })
  const set = (p: Partial<Form>) => { setF(x => x && { ...x, ...p }); setErrs([]) }
  const ah = f?.after_hours
  const setAh = (p: Partial<Form['after_hours']>) => f && set({ after_hours: { ...f.after_hours, ...p } })

  const text = (k: 'welcome' | 'help', title: string, def: string) => f && (
    <div className="grid gap-1">
      <label htmlFor={`bs-${k}`} className="text-sm font-semibold">{title}</label>
      <textarea id={`bs-${k}`} className="input w-full py-2 font-normal" rows={3} maxLength={MAX[k]} value={f[k]} {...inv(k)} onChange={e => set({ [k]: e.target.value })} />
      <p className="flex flex-wrap justify-between gap-2 text-sm text-muted"><span>{f[k].length} / {MAX[k]}</span>
        <button type="button" className="link" onClick={() => set({ [k]: def })}>{t(DEF)}<span className="sr-only"> {title.toLowerCase()}</span></button></p>
      <FieldErr k={k} />
    </div>)

  return (
    <section className="card mt-8 max-w-4xl" aria-labelledby="bs">
      <h2 id="bs" className="text-lg font-semibold">{t({ en: 'How your bot talks to customers', ms: 'Cara bot anda bercakap dengan pelanggan', zh: '机器人如何与客户交流', ta: 'உங்கள் bot வாடிக்கையாளர்களுடன் எப்படிப் பேசுகிறது' })}</h2>
      <p className="mb-3 text-sm text-muted">{t({ en: 'Change what customers see when they message your bot on Telegram.', ms: 'Ubah apa yang pelanggan lihat apabila mereka menghantar mesej kepada bot anda di Telegram.', zh: '更改客户在 Telegram 上给你的机器人发消息时看到的内容。', ta: 'வாடிக்கையாளர்கள் Telegram இல் உங்கள் bot க்கு செய்தி அனுப்பும்போது அவர்கள் காண்பதை மாற்றவும்.' })}</p>
      {s.error ? <div role="alert" className="text-sm text-warn"><p>{s.error}</p><button type="button" className="btn mt-2" onClick={s.reload}>{t({ en: 'Retry loading', ms: 'Cuba muat semula', zh: '重新加载', ta: 'மீண்டும் ஏற்று' })}</button></div>
        : !f || !d || !ah ? <div role="status" aria-busy="true" className="skeleton h-32"><span className="sr-only">{t({ en: 'Loading...', ms: 'Memuatkan...', zh: '加载中...', ta: 'ஏற்றுகிறது...' })}</span></div> : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2">
          <form className="grid grid-cols-[minmax(0,1fr)] gap-4" onSubmit={e => { e.preventDefault(); send(f, t({ en: 'Bot messages saved.', ms: 'Mesej bot disimpan.', zh: '机器人消息已保存。', ta: 'Bot செய்திகள் சேமிக்கப்பட்டன.' })) }}>
            {text('welcome', t({ en: 'Welcome message', ms: 'Mesej alu-aluan', zh: '欢迎消息', ta: 'வரவேற்பு செய்தி' }), d.welcome)}
            {text('help', t({ en: 'Help message', ms: 'Mesej bantuan', zh: '帮助消息', ta: 'உதவிச் செய்தி' }), d.help)}

            <fieldset className="grid gap-1"><legend className="text-sm font-semibold">{t({ en: 'Language', ms: 'Bahasa', zh: '语言', ta: 'மொழி' })}</legend>
              {LANGS.map(([v, n]) => (
                <label key={v} className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="bs-lang" className="size-5" checked={f.language === v} onChange={() => set({ language: v })} />{t(n)}</label>))}
              <FieldErr k="language" />
            </fieldset>

            <fieldset className="grid gap-2"><legend className="text-sm font-semibold">{t({ en: 'Quick-reply buttons', ms: 'Butang balasan pantas', zh: '快速回复按钮', ta: 'விரைவு பதில் பொத்தான்கள்' })}</legend>
              <Hint id="bs-qr-h">{t({ en: 'Short buttons shown under the welcome message. Up to 4.', ms: 'Butang pendek yang dipaparkan di bawah mesej alu-aluan. Sehingga 4.', zh: '显示在欢迎消息下方的短按钮，最多 4 个。', ta: 'வரவேற்புச் செய்தியின் கீழே காட்டப்படும் சிறிய பொத்தான்கள். அதிகபட்சம் 4.' })}</Hint>
              {f.quick_replies.map((q, i) => (
                <div key={i} className="flex gap-2">
                  <input className="input min-w-0 flex-1" maxLength={40} value={q} aria-label={t({ en: `Button ${i + 1}`, ms: `Butang ${i + 1}`, zh: `按钮 ${i + 1}`, ta: `பொத்தான் ${i + 1}` })} aria-describedby="bs-qr-h" onChange={e => set({ quick_replies: f.quick_replies.map((x, j) => (j === i ? e.target.value : x)) })} />
                  <button type="button" className="btn" onClick={() => set({ quick_replies: f.quick_replies.filter((_, j) => j !== i) })}>{t({ en: 'Remove', ms: 'Buang', zh: '删除', ta: 'அகற்று' })}<span className="sr-only"> {t({ en: `button ${i + 1}`, ms: `butang ${i + 1}`, zh: `按钮 ${i + 1}`, ta: `பொத்தான் ${i + 1}` })}</span></button>
                </div>))}
              <FieldErr k="quick_replies" />
              {f.quick_replies.length < 4 && <div><button type="button" className="btn" onClick={() => set({ quick_replies: [...f.quick_replies, ''] })}>{t({ en: 'Add a button', ms: 'Tambah butang', zh: '添加按钮', ta: 'பொத்தானைச் சேர்' })}</button></div>}
            </fieldset>

            <fieldset className="grid gap-3"><legend className="text-sm font-semibold">{t({ en: 'After-hours message', ms: 'Mesej luar waktu operasi', zh: '非营业时间消息', ta: 'வேலை நேரத்திற்குப் பிந்தைய செய்தி' })}</legend>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" role="switch" className="size-5" checked={ah.enabled} onChange={e => setAh({ enabled: e.target.checked })} />{t({ en: 'Reply with a message when you are closed', ms: 'Balas dengan mesej apabila anda tutup', zh: '休息时自动回复一条消息', ta: 'நீங்கள் மூடியிருக்கும்போது செய்தியுடன் பதிலளி' })}</label>
              {ah.enabled && <>
                <div className="flex flex-wrap gap-3">
                  <label className="grid gap-1 text-sm font-semibold">{t({ en: 'Opening time', ms: 'Waktu buka', zh: '开门时间', ta: 'திறக்கும் நேரம்' })}<input type="time" className="input font-normal" value={ah.open} onChange={e => setAh({ open: e.target.value })} /></label>
                  <label className="grid gap-1 text-sm font-semibold">{t({ en: 'Closing time', ms: 'Waktu tutup', zh: '关门时间', ta: 'மூடும் நேரம்' })}<input type="time" className="input font-normal" value={ah.close} onChange={e => setAh({ close: e.target.value })} /></label>
                </div>
                <fieldset className="flex flex-wrap gap-x-4"><legend className="text-sm font-semibold">{t({ en: 'Open on', ms: 'Buka pada', zh: '营业日', ta: 'திறந்திருக்கும் நாட்கள்' })}</legend>
                  {DAYS.map((n, i) => (
                    <label key={i} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={ah.days.includes(i + 1)}
                      onChange={e => setAh({ days: e.target.checked ? [...ah.days, i + 1].sort() : ah.days.filter(x => x !== i + 1) })} />{t(n)}</label>))}
                </fieldset>
                <div className="grid gap-1">
                  <label htmlFor="bs-ahm" className="text-sm font-semibold">{t({ en: 'Message when closed', ms: 'Mesej apabila tutup', zh: '休息时的消息', ta: 'மூடியிருக்கும்போது செய்தி' })}</label>
                  <textarea id="bs-ahm" className="input w-full py-2 font-normal" rows={2} maxLength={MAX.after_hours} value={ah.message} {...inv('after_hours')} onChange={e => setAh({ message: e.target.value })} />
                  <p className="flex flex-wrap justify-between gap-2 text-sm text-muted"><span>{ah.message.length} / {MAX.after_hours}</span>
                    <button type="button" className="link" onClick={() => setAh({ message: d.after_hours_message })}>{t(DEF)}<span className="sr-only"> {t({ en: 'closed message', ms: 'mesej tutup', zh: '休息消息', ta: 'மூடியிருக்கும் செய்தி' })}</span></button></p>
                </div></>}
              <FieldErr k="after_hours" />
            </fieldset>

            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" role="switch" className="size-5" checked={f.reactions} onChange={e => set({ reactions: e.target.checked })} />{t({ en: "Show a received and done reaction on customers' messages", ms: 'Tunjukkan reaksi diterima dan selesai pada mesej pelanggan', zh: '在客户的消息上显示“已收到”和“已完成”的表情回应', ta: 'வாடிக்கையாளர் செய்திகளில் பெறப்பட்டது, முடிந்தது என்ற எதிர்வினையைக் காட்டு' })}</label>

            {err && <p role="alert" className="text-sm text-warn">{err}</p>}
            {ask ? (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t({ en: 'Confirm resetting the bot messages', ms: 'Sahkan penetapan semula mesej bot', zh: '确认重置机器人消息', ta: 'Bot செய்திகளை மீட்டமைப்பதை உறுதிப்படுத்தவும்' })}>
                <span className="text-sm font-semibold">{t({ en: 'Reset all of these messages to the defaults?', ms: 'Tetapkan semula semua mesej ini kepada nilai lalai?', zh: '把这些消息全部恢复为默认值？', ta: 'இந்த எல்லாச் செய்திகளையும் இயல்புநிலைக்கு மீட்டமைக்கவா?' })}</span>
                <button type="button" className="btn btn-danger" autoFocus aria-disabled={busy || undefined}
                  onClick={() => send({ welcome: d.welcome, help: d.help, language: 'auto', quick_replies: [], reactions: true, after_hours: { enabled: false, message: d.after_hours_message, open: '09:00', close: '18:00', days: [1, 2, 3, 4, 5, 6, 7] } }, t({ en: 'Bot messages reset to the defaults.', ms: 'Mesej bot ditetapkan semula kepada nilai lalai.', zh: '机器人消息已恢复为默认值。', ta: 'Bot செய்திகள் இயல்புநிலைக்கு மீட்டமைக்கப்பட்டன.' }))}>{busy ? t({ en: 'Working...', ms: 'Sedang diproses...', zh: '处理中...', ta: 'செயல்படுகிறது...' }) : t({ en: 'Yes, reset', ms: 'Ya, tetapkan semula', zh: '是，重置', ta: 'ஆம், மீட்டமை' })}</button>
                <button type="button" className="btn" onClick={() => setAsk(false)}>{t({ en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து செய்' })}</button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t({ en: 'Saving...', ms: 'Menyimpan...', zh: '保存中...', ta: 'சேமிக்கிறது...' }) : t({ en: 'Save messages', ms: 'Simpan mesej', zh: '保存消息', ta: 'செய்திகளைச் சேமி' })}</button>
                <button type="button" className="btn" onClick={() => setAsk(true)}>{t({ en: 'Reset to defaults', ms: 'Tetapkan semula kepada lalai', zh: '恢复默认值', ta: 'இயல்புநிலைக்கு மீட்டமை' })}</button>
              </div>)}
          </form>

          <aside aria-label={t({ en: 'Preview of what customers see', ms: 'Pratonton apa yang pelanggan lihat', zh: '客户所见内容的预览', ta: 'வாடிக்கையாளர்கள் காண்பதன் முன்னோட்டம்' })} className="min-w-0">
            <h3 className="mb-2 text-sm font-semibold">{t({ en: 'Preview', ms: 'Pratonton', zh: '预览', ta: 'முன்னோட்டம்' })}</h3>
            <div className="grid gap-2 rounded-ui border border-line bg-tint p-3">
              <div className="max-w-[90%] whitespace-pre-wrap break-words rounded-ui border border-line bg-surface p-3 text-sm">{f.welcome || <span className="text-muted">{t(EMPTY)}</span>}</div>
              {f.quick_replies.some(q => q.trim()) && (
                <div className="flex flex-wrap gap-2">{f.quick_replies.filter(q => q.trim()).map((q, i) => <span key={i} className="rounded-ui border border-line bg-surface px-3 py-1.5 text-sm font-semibold">{q}</span>)}</div>)}
              <div className="max-w-[90%] whitespace-pre-wrap break-words rounded-ui border border-line bg-surface p-3 text-sm">{f.help || <span className="text-muted">{t(EMPTY)}</span>}</div>
              {ah.enabled && <p className="break-words text-sm text-muted">{t({ en: `Customers messaging outside ${ah.open}-${ah.close} will also see: ${ah.message}`, ms: `Pelanggan yang menghantar mesej di luar ${ah.open}-${ah.close} juga akan melihat: ${ah.message}`, zh: `在 ${ah.open}-${ah.close} 之外发消息的客户还会看到：${ah.message}`, ta: `${ah.open}-${ah.close} நேரத்திற்கு வெளியே செய்தி அனுப்பும் வாடிக்கையாளர்கள் இதையும் காண்பார்கள்: ${ah.message}` })}</p>}
            </div>
          </aside>
        </div>)}
    </section>
  )
}

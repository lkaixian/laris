import { useEffect, useState } from 'react'
import { api, ApiError } from './api'
import type { BotSettingsView } from './api'
import { Hint, msg, useFetch } from './ui'
import { useToast } from './Toast'

type Form = Omit<BotSettingsView, 'defaults'>
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const LANGS: [Form['language'], string][] = [['auto', "Detect from the customer's message"], ['en', 'English'], ['ms', 'Bahasa Melayu']]
const MAX = { welcome: 600, help: 1000, after_hours: 300 }
const strip = ({ defaults: _d, ...f }: BotSettingsView): Form => f  // eslint-disable-line @typescript-eslint/no-unused-vars

// Settings > Channels (owner only): what the customer bot says, with a live preview.
export function BotSettings() {
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
      <textarea id={`bs-${k}`} className="input py-2 font-normal" rows={3} maxLength={MAX[k]} value={f[k]} {...inv(k)} onChange={e => set({ [k]: e.target.value })} />
      <p className="flex flex-wrap justify-between gap-2 text-sm text-muted"><span>{f[k].length} / {MAX[k]}</span>
        <button type="button" className="link" onClick={() => set({ [k]: def })}>Use the default<span className="sr-only"> {title.toLowerCase()}</span></button></p>
      <FieldErr k={k} />
    </div>)

  return (
    <section className="card mt-8 max-w-4xl" aria-labelledby="bs">
      <h2 id="bs" className="text-lg font-semibold">How your bot talks to customers</h2>
      <p className="mb-3 text-sm text-muted">Change what customers see when they message your bot on Telegram.</p>
      {s.error ? <div role="alert" className="text-sm text-warn"><p>{s.error}</p><button type="button" className="btn mt-2" onClick={s.reload}>Retry loading</button></div>
        : !f || !d || !ah ? <div role="status" aria-busy="true" className="skeleton h-32"><span className="sr-only">Loading...</span></div> : (
        <div className="grid gap-6 md:grid-cols-2">
          <form className="grid min-w-0 gap-4" onSubmit={e => { e.preventDefault(); send(f, 'Bot messages saved.') }}>
            {text('welcome', 'Welcome message', d.welcome)}
            {text('help', 'Help message', d.help)}

            <fieldset className="grid gap-1"><legend className="text-sm font-semibold">Language</legend>
              {LANGS.map(([v, t]) => (
                <label key={v} className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="bs-lang" className="size-5" checked={f.language === v} onChange={() => set({ language: v })} />{t}</label>))}
              <FieldErr k="language" />
            </fieldset>

            <fieldset className="grid gap-2"><legend className="text-sm font-semibold">Quick-reply buttons</legend>
              <Hint id="bs-qr-h">Short buttons shown under the welcome message. Up to 4.</Hint>
              {f.quick_replies.map((q, i) => (
                <div key={i} className="flex gap-2">
                  <input className="input min-w-0 flex-1" maxLength={40} value={q} aria-label={`Button ${i + 1}`} aria-describedby="bs-qr-h" onChange={e => set({ quick_replies: f.quick_replies.map((x, j) => (j === i ? e.target.value : x)) })} />
                  <button type="button" className="btn" onClick={() => set({ quick_replies: f.quick_replies.filter((_, j) => j !== i) })}>Remove<span className="sr-only"> button {i + 1}</span></button>
                </div>))}
              <FieldErr k="quick_replies" />
              {f.quick_replies.length < 4 && <div><button type="button" className="btn" onClick={() => set({ quick_replies: [...f.quick_replies, ''] })}>Add a button</button></div>}
            </fieldset>

            <fieldset className="grid gap-3"><legend className="text-sm font-semibold">After-hours message</legend>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" role="switch" className="size-5" checked={ah.enabled} onChange={e => setAh({ enabled: e.target.checked })} />Reply with a message when you are closed</label>
              {ah.enabled && <>
                <div className="flex flex-wrap gap-3">
                  <label className="grid gap-1 text-sm font-semibold">Opening time<input type="time" className="input font-normal" value={ah.open} onChange={e => setAh({ open: e.target.value })} /></label>
                  <label className="grid gap-1 text-sm font-semibold">Closing time<input type="time" className="input font-normal" value={ah.close} onChange={e => setAh({ close: e.target.value })} /></label>
                </div>
                <fieldset className="flex flex-wrap gap-x-4"><legend className="text-sm font-semibold">Open on</legend>
                  {DAYS.map((n, i) => (
                    <label key={n} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={ah.days.includes(i + 1)}
                      onChange={e => setAh({ days: e.target.checked ? [...ah.days, i + 1].sort() : ah.days.filter(x => x !== i + 1) })} />{n}</label>))}
                </fieldset>
                <div className="grid gap-1">
                  <label htmlFor="bs-ahm" className="text-sm font-semibold">Message when closed</label>
                  <textarea id="bs-ahm" className="input py-2 font-normal" rows={2} maxLength={MAX.after_hours} value={ah.message} {...inv('after_hours')} onChange={e => setAh({ message: e.target.value })} />
                  <p className="flex flex-wrap justify-between gap-2 text-sm text-muted"><span>{ah.message.length} / {MAX.after_hours}</span>
                    <button type="button" className="link" onClick={() => setAh({ message: d.after_hours_message })}>Use the default<span className="sr-only"> closed message</span></button></p>
                </div></>}
              <FieldErr k="after_hours" />
            </fieldset>

            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" role="switch" className="size-5" checked={f.reactions} onChange={e => set({ reactions: e.target.checked })} />Show a received and done reaction on customers' messages</label>

            {err && <p role="alert" className="text-sm text-warn">{err}</p>}
            {ask ? (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm resetting the bot messages">
                <span className="text-sm font-semibold">Reset all of these messages to the defaults?</span>
                <button type="button" className="btn btn-danger" autoFocus aria-disabled={busy || undefined}
                  onClick={() => send({ welcome: d.welcome, help: d.help, language: 'auto', quick_replies: [], reactions: true, after_hours: { enabled: false, message: d.after_hours_message, open: '09:00', close: '18:00', days: [1, 2, 3, 4, 5, 6, 7] } }, 'Bot messages reset to the defaults.')}>{busy ? 'Working...' : 'Yes, reset'}</button>
                <button type="button" className="btn" onClick={() => setAsk(false)}>Cancel</button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Saving...' : 'Save messages'}</button>
                <button type="button" className="btn" onClick={() => setAsk(true)}>Reset to defaults</button>
              </div>)}
          </form>

          <aside aria-label="Preview of what customers see" className="min-w-0">
            <h3 className="mb-2 text-sm font-semibold">Preview</h3>
            <div className="grid gap-2 rounded-ui border border-line bg-tint p-3">
              <div className="max-w-[90%] whitespace-pre-wrap break-words rounded-ui border border-line bg-surface p-3 text-sm">{f.welcome || <span className="text-muted">(empty)</span>}</div>
              {f.quick_replies.some(q => q.trim()) && (
                <div className="flex flex-wrap gap-2">{f.quick_replies.filter(q => q.trim()).map((q, i) => <span key={i} className="rounded-ui border border-line bg-surface px-3 py-1.5 text-sm font-semibold">{q}</span>)}</div>)}
              <div className="max-w-[90%] whitespace-pre-wrap break-words rounded-ui border border-line bg-surface p-3 text-sm">{f.help || <span className="text-muted">(empty)</span>}</div>
              {ah.enabled && <p className="break-words text-sm text-muted">Customers messaging outside {ah.open}-{ah.close} will also see: {ah.message}</p>}
            </div>
          </aside>
        </div>)}
    </section>
  )
}

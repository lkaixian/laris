import { useEffect, useState } from 'react'
import { api, ApiError } from './api'
import { Hint, msg, useFetch } from './ui'
import { Icon } from './icons'
import { useToast } from './Toast'

interface Channels { wa_phone_number_id: string | null; whatsapp_mapped: boolean; telegram_mapped: boolean; tenants_total_hint: boolean }

// Settings > Channels (owner only): which WhatsApp number belongs to this business. With several businesses on one system, an unmapped channel drops messages.
export function ChannelsCard() {
  const s = useFetch<Channels>('/settings/channels')
  const [wa, setWa] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  useEffect(() => { if (s.data) setWa(s.data.wa_phone_number_id ?? '') }, [s.data])
  const c = s.data
  const save = async () => {
    if (busy) return
    const v = wa.trim()
    if (v && !/^\d{5,32}$/.test(v)) return setErr('Digits only, 5 to 32 characters')
    setErr(''); setBusy(true)
    try { await api('POST', '/settings/channels', { wa_phone_number_id: v || null }); toast(v ? 'WhatsApp number saved.' : 'WhatsApp number disconnected.'); s.reload() }
    catch (e) {
      setErr(e instanceof ApiError && e.status === 422 ? 'Digits only, 5 to 32 characters'
        : e instanceof ApiError && e.status === 409 && e.code === 'number_in_use' ? 'That number is already connected to a business.' : msg(e))
    } finally { setBusy(false) }
  }
  const missing = c && c.tenants_total_hint && (!c.whatsapp_mapped || !c.telegram_mapped)
  const both = c && !c.whatsapp_mapped && !c.telegram_mapped
  return (
    <section className="card mt-8 max-w-xl" aria-labelledby="ch">
      <h2 id="ch" className="text-lg font-semibold">Channels</h2>
      <p className="mb-3 text-sm text-muted">Tell LARIS which chat number is yours, so customer messages reach your business.</p>
      {s.error ? <div role="alert" className="text-sm text-warn"><p>{s.error}</p><button type="button" className="btn mt-2" onClick={s.reload}>Retry loading</button></div>
        : !c ? <div role="status" aria-busy="true" className="skeleton h-16" /> : <>
          {missing && (
            <div className="mb-3 flex items-start gap-2 rounded-ui border border-warn bg-warn-bg p-3 text-sm text-warn" data-testid="channels-warning">
              <Icon name="warn" className="mt-0.5 size-5" />
              <p><strong>Warning: </strong>{both
                ? 'More than one business uses this system. Messages from people we cannot match to your business are ignored until you connect your WhatsApp number here (or set TELEGRAM_TENANT_ID for Telegram). Customers will get no reply.'
                : !c.whatsapp_mapped
                  ? 'More than one business uses this system. WhatsApp messages from people we cannot match to your business are ignored until you connect your WhatsApp number here. Customers will get no reply.'
                  : 'More than one business uses this system. Telegram messages from people we cannot match to your business are ignored until TELEGRAM_TENANT_ID is set for Telegram. Customers will get no reply.'}</p>
            </div>
          )}
          <form className="grid gap-3" onSubmit={e => { e.preventDefault(); save() }}>
            <label className="flex flex-col gap-1 text-sm font-semibold">WhatsApp phone number ID
              <input className="input font-normal" inputMode="numeric" autoComplete="off" maxLength={32} value={wa} aria-describedby={err ? 'wa-help wa-err' : 'wa-help'} aria-invalid={!!err || undefined}
                onChange={e => { setWa(e.target.value); setErr('') }} />
              <Hint id="wa-help">The Phone number ID from your Meta WhatsApp dashboard (digits only). Leave empty to disconnect.</Hint></label>
            {err && <p id="wa-err" role="alert" className="text-sm text-warn">{err}</p>}
            <p className="text-sm">WhatsApp: <strong>{c.whatsapp_mapped ? 'connected' : 'not connected'}</strong>. Telegram: <strong>{c.telegram_mapped ? 'connected' : 'not connected'}</strong>.</p>
            <div><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Saving...' : 'Save channels'}</button></div>
          </form></>}
    </section>
  )
}

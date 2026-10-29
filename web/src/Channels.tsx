import { useEffect, useState } from 'react'
import { api, ApiError } from './api'
import { Hint, msg, useFetch } from './ui'
import { ConfirmDialog } from './kit'
import { Icon } from './icons'
import { useToast } from './Toast'
import { BotSettings } from './BotSettings'

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
  const [ask, setAsk] = useState(false)
  const save = async (confirmed = false) => {
    if (busy) return
    const v = wa.trim()
    if (v && !/^\d{5,32}$/.test(v)) return setErr('Digits only, 5 to 32 characters')
    if (!v && s.data?.wa_phone_number_id && !confirmed) return setAsk(true)  // emptying the field disconnects: ask first
    setAsk(false); setErr(''); setBusy(true)
    try { await api('POST', '/settings/channels', { wa_phone_number_id: v || null }); toast(v ? 'WhatsApp number saved.' : 'WhatsApp number disconnected.'); s.reload() }
    catch (e) {
      setErr(e instanceof ApiError && e.status === 422 ? 'Digits only, 5 to 32 characters'
        : e instanceof ApiError && e.status === 409 && e.code === 'number_in_use' ? 'That number is already connected to a business.' : msg(e))
    } finally { setBusy(false) }
  }
  const missing = c && c.tenants_total_hint && (!c.whatsapp_mapped || !c.telegram_mapped)
  const both = c && !c.whatsapp_mapped && !c.telegram_mapped
  return (
    <>
    <TelegramCards />
    <section className="card mt-8 max-w-xl" aria-labelledby="ch">
      <h2 id="ch" className="text-md font-semibold">Channels</h2>
      <p className="mb-3 text-sm text-muted">Tell LARIS which chat number is yours, so customer messages reach your business.</p>
      {s.error ? <div role="alert" className="text-sm text-warn"><p>{s.error}</p><button type="button" className="btn mt-2" onClick={s.reload}>Retry loading</button></div>
        : !c ? <div role="status" aria-busy="true" className="grid gap-3"><span className="sr-only">Loading...</span><div aria-hidden="true" className="skeleton h-10" /><div aria-hidden="true" className="skeleton h-12" /></div> : <>
          {missing && (
            <div className="mb-3 flex items-start gap-2 rounded-card border border-warn bg-warn-bg p-3 text-sm text-warn" data-testid="channels-warning">
              <Icon name="warn" className="mt-0.5 size-5 shrink-0" />
              <div>
                <p className="font-semibold">Some customer messages are being ignored.</p>
                <p>More than one business uses this system, so messages we cannot match to yours get no reply.</p>
                <p className="mt-1"><strong>How to fix: </strong>{both
                  ? 'connect your WhatsApp number below, or set TELEGRAM_TENANT_ID for Telegram.'
                  : !c.whatsapp_mapped
                    ? 'connect your WhatsApp number below.'
                    : 'set TELEGRAM_TENANT_ID for Telegram.'}</p>
              </div>
            </div>
          )}
          <form className="grid gap-3" onSubmit={e => { e.preventDefault(); save() }}>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">WhatsApp</dt><dd><span className={`chip ${c.whatsapp_mapped ? 'chip-accepted' : 'chip-expired'}`}>{c.whatsapp_mapped ? 'Connected' : 'Not connected'}</span></dd>
              <dt className="text-muted">Telegram</dt><dd><span className={`chip ${c.telegram_mapped ? 'chip-accepted' : 'chip-expired'}`}>{c.telegram_mapped ? 'Connected' : 'Not connected'}</span></dd>
            </dl>
            <label className="flex flex-col gap-1 text-sm font-semibold">WhatsApp phone number ID
              <input className="input font-normal" inputMode="numeric" autoComplete="off" maxLength={32} value={wa} aria-describedby={err ? 'wa-help wa-err' : 'wa-help'} aria-invalid={!!err || undefined}
                onChange={e => { setWa(e.target.value); setErr('') }} />
              <Hint id="wa-help">The Phone number ID from your Meta WhatsApp dashboard (digits only). Leave empty to disconnect.</Hint></label>
            {err && <p id="wa-err" role="alert" className="text-sm text-warn">{err}</p>}
            <div className="flex justify-end border-t border-hairline pt-3"><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Saving...' : 'Save channels'}</button></div>
          </form>
          <ConfirmDialog open={ask} danger title="Disconnect WhatsApp?" confirmLabel="Disconnect" body="The number will be removed. Customers will no longer get replies on WhatsApp until you connect one again." onCancel={() => setAsk(false)} onConfirm={() => save(true)} /></>}
    </section>
    </>
  )
}

interface Bot { connected: boolean; username: string | null; name: string | null; webhook_ok: boolean | null; last_error: string | null; source: 'dashboard' | 'environment' | null; create_link?: string | null; create_blocked?: 'link_first' | 'unavailable' | null }
interface Tg { helper: { configured: boolean; username: string | null; link: string | null }; bot: Bot }

const CONNECT_ERR: Record<string, string> = {
  bad_token: 'Telegram did not accept that token. Copy it again from BotFather.',
  bot_in_use: 'That bot is already connected to another business. Make a new bot in BotFather and use its token.',
  telegram_unreachable: 'LARIS could not reach Telegram. Wait a minute and try again.',
  public_url_unset: 'The server does not know its public address yet. Ask whoever set up LARIS to set APP_PUBLIC_URL.',
  secret_key_unset: 'The server is missing a security key. Ask whoever set up LARIS to set it, then try again.',
}

// Settings > Channels, Telegram: the customer bot (owner pastes a BotFather token) and the LARIS helper bot (staff link their account).
function TelegramCards() {
  const s = useFetch<Tg>('/settings/telegram')
  const [token, setToken] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [gaveUp, setGaveUp] = useState(false)
  const toast = useToast()
  const connected = s.data?.bot.connected
  // After the owner taps Create in Telegram: look again every 4 s for up to 2 minutes.
  useEffect(() => {
    if (!waiting) return
    if (connected) { setWaiting(false); toast('Customer bot connected.'); return }
    const i = setInterval(s.reload, 4000), t = setTimeout(() => { setWaiting(false); setGaveUp(true) }, 120_000)
    return () => { clearInterval(i); clearTimeout(t) }
  }, [waiting, connected]) // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (path: string, body: unknown, done: string) => {
    if (busy) return
    setErr(''); setBusy(true)
    try { await api('POST', path, body); setToken(''); setShow(false); setAsk(false); toast(done); s.reload() }
    catch (e) { setErr(e instanceof ApiError && CONNECT_ERR[e.code] ? CONNECT_ERR[e.code] : msg(e)) }
    finally { setBusy(false) }
  }
  const b = s.data?.bot, h = s.data?.helper
  const wait = <div role="status" aria-busy="true" className="skeleton h-16"><span className="sr-only">Loading...</span></div>
  const fail = <div role="alert" className="text-sm text-warn"><p>{s.error}</p><button type="button" className="btn mt-2" onClick={s.reload}>Retry loading</button></div>
  const manual = (
        <form className="grid gap-3" onSubmit={e => { e.preventDefault(); if (token.trim()) act('/settings/telegram/connect', { token: token.trim() }, 'Customer bot connected.') }}>
          <ol className="list-decimal pl-5 text-sm">
            <li>Open <a className="link" href="https://t.me/BotFather" target="_blank" rel="noreferrer">BotFather</a> in Telegram.</li>
            <li>Send /newbot and pick a name for your shop's bot.</li>
            <li>Copy the token it gives you and paste it below.</li>
          </ol>
          <label className="flex flex-col gap-1 text-sm font-semibold">Bot token
            <span className="flex gap-2">
              <input className="input min-w-0 flex-1 font-normal" type={show ? 'text' : 'password'} autoComplete="off" autoCapitalize="none" spellCheck={false} value={token}
                aria-invalid={!!err || undefined} aria-describedby={err ? 'tg-err' : undefined} onChange={e => { setToken(e.target.value); setErr('') }} />
              <button type="button" className="btn" aria-pressed={show} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}<span className="sr-only"> token</span></button>
            </span></label>
          {err && <p id="tg-err" role="alert" className="text-sm text-warn">{err}</p>}
          <div><button type="submit" className="btn btn-primary" aria-disabled={busy || !token.trim() || undefined}>{busy ? 'Connecting...' : 'Connect bot'}</button></div>
        </form>
  )
  return (
    <>
      <section className="card mt-8 max-w-xl" aria-labelledby="tgb" data-tour="bot-card">
        <h2 id="tgb" className="text-md font-semibold">Your customer bot</h2>
        <p className="mb-3 text-sm text-muted">A Telegram bot with your shop's name, so customers can message you there and get replies.</p>
        {s.error ? fail : !b ? wait : b.connected ? (
          <div className="grid gap-3">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{b.name}</span>
              {b.username && <a className="link" href={`https://t.me/${b.username}`} target="_blank" rel="noreferrer">@{b.username}<span className="sr-only"> (opens Telegram)</span></a>}
              <span className={b.webhook_ok === false ? 'badge badge-warn' : 'badge'}>{b.webhook_ok === true ? 'Working' : b.webhook_ok === false ? 'Needs attention' : 'Checking...'}</span>
            </p>
            {b.webhook_ok === false && b.last_error && <p className="text-sm text-warn">{b.last_error}</p>}
            {b.source === 'environment' ? <p className="text-sm text-muted">Connected through the server settings. To change it, ask whoever set up LARIS.</p>
              : ask ? (
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm disconnecting the bot">
                  <span className="text-sm font-semibold">Disconnect this bot? Customers will no longer get replies on Telegram.</span>
                  <button type="button" className="btn btn-danger" autoFocus aria-disabled={busy || undefined} onClick={() => act('/settings/telegram/disconnect', undefined, 'Customer bot disconnected.')}>{busy ? 'Working...' : 'Yes, disconnect'}</button>
                  <button type="button" className="btn" onClick={() => setAsk(false)}>Cancel</button>
                </div>
              ) : <div><button type="button" className="btn" onClick={() => setAsk(true)}>Disconnect</button></div>}
            {err && <p role="alert" className="text-sm text-warn">{err}</p>}
          </div>
        ) : (
          <div className="grid gap-3">
            {b.create_link && <>
              <p className="text-sm">Telegram will show a confirmation screen with a name already filled in. Tap Create, then come back here.</p>
              <div className="flex flex-wrap items-center gap-3">
                <a className="btn btn-primary" data-tour="bot-create" href={b.create_link}target="_blank" rel="noopener noreferrer" onClick={() => { setWaiting(true); setGaveUp(false) }}>Create my bot in Telegram<span className="sr-only"> (opens Telegram)</span></a>
                {waiting && <><span role="status" className="text-sm text-muted">Waiting for Telegram...</span><button type="button" className="btn" onClick={() => setWaiting(false)}>Cancel</button></>}
              </div>
              {gaveUp && <p role="status" className="text-sm text-muted">We did not see your bot yet. If you tapped Create, wait a moment and reload this page.</p>}
            </>}
            {!b.create_link && b.create_blocked === 'link_first' && (
              <p className="text-sm">Link your own Telegram first (Account &gt; Link my Telegram) so LARIS knows the bot is yours. <a className="link" href="#/account">Go to Account</a></p>)}
            {b.create_link || b.create_blocked === 'link_first'
              ? <details><summary className="cursor-pointer text-sm font-semibold">Create it myself instead</summary><div className="mt-3">{manual}</div></details>
              : manual}
          </div>
        )}
      </section>
      {b && (b.connected || b.source === 'environment') && <BotSettings />}
      <section className="card mt-8 max-w-xl" aria-labelledby="tgh">
        <h2 id="tgh" className="text-md font-semibold">LARIS helper bot (for you and your staff)</h2>
        <p className="mb-3 text-sm text-muted">You and your staff link your own account to this bot. Then you can send product photos with /catalog and supplier price lists straight from Telegram. Link people on the Team page, or yours on the Account page.</p>
        {s.error ? fail : !h ? wait : h.configured && h.username
          ? <a className="link" href={h.link ?? `https://t.me/${h.username}`} target="_blank" rel="noreferrer">@{h.username}<span className="sr-only"> (opens Telegram)</span></a>
          : <p className="text-sm text-muted">Not available on this server yet.</p>}
      </section>
    </>
  )
}

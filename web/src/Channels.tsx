import { useEffect, useState } from 'react'
import { api, ApiError } from './api'
import { Hint, msg, useFetch } from './ui'
import { ConfirmDialog } from './kit'
import { Icon } from './icons'
import { useToast } from './Toast'
import { BotSettings } from './BotSettings'
import { t, useLang } from './i18n'
import type { Text } from './i18n'

interface Channels { wa_phone_number_id: string | null; whatsapp_mapped: boolean; telegram_mapped: boolean; tenants_total_hint: boolean }

// Settings > Channels (owner only): which WhatsApp number belongs to this business. With several businesses on one system, an unmapped channel drops messages.
export function ChannelsCard() {
  useLang()
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
    if (v && !/^\d{5,32}$/.test(v)) return setErr(t({ en: 'Digits only, 5 to 32 characters', ms: 'Digit sahaja, 5 hingga 32 aksara', zh: '仅限数字，5 到 32 个字符', ta: 'எண்கள் மட்டும், 5 முதல் 32 எழுத்துகள்' }))
    if (!v && s.data?.wa_phone_number_id && !confirmed) return setAsk(true)  // emptying the field disconnects: ask first
    setAsk(false); setErr(''); setBusy(true)
    try { await api('POST', '/settings/channels', { wa_phone_number_id: v || null }); toast(v ? t({ en: 'WhatsApp number saved.', ms: 'Nombor WhatsApp disimpan.', zh: 'WhatsApp 号码已保存。', ta: 'WhatsApp எண் சேமிக்கப்பட்டது.' }) : t({ en: 'WhatsApp number disconnected.', ms: 'Nombor WhatsApp diputuskan.', zh: 'WhatsApp 号码已断开连接。', ta: 'WhatsApp எண் துண்டிக்கப்பட்டது.' })); s.reload() }
    catch (e) {
      setErr(e instanceof ApiError && e.status === 422 ? t({ en: 'Digits only, 5 to 32 characters', ms: 'Digit sahaja, 5 hingga 32 aksara', zh: '仅限数字，5 到 32 个字符', ta: 'எண்கள் மட்டும், 5 முதல் 32 எழுத்துகள்' })
        : e instanceof ApiError && e.status === 409 && e.code === 'number_in_use' ? t({ en: 'That number is already connected to a business.', ms: 'Nombor itu sudah disambungkan kepada sebuah perniagaan.', zh: '该号码已连接到另一家商家。', ta: 'அந்த எண் ஏற்கெனவே ஒரு வணிகத்துடன் இணைக்கப்பட்டுள்ளது.' }) : msg(e))
    } finally { setBusy(false) }
  }
  const missing = c && c.tenants_total_hint && (!c.whatsapp_mapped || !c.telegram_mapped)
  const both = c && !c.whatsapp_mapped && !c.telegram_mapped
  return (
    <>
    <TelegramCards />
    <section className="card mt-8 max-w-xl" aria-labelledby="ch" data-guide="st-channels">
      <h2 id="ch" className="text-md font-semibold">{t({ en: 'Channels', ms: 'Saluran', zh: '渠道', ta: 'சேனல்கள்' })}</h2>
      <p className="mb-3 text-sm text-muted">{t({ en: 'Tell LARIS which chat number is yours, so customer messages reach your business.', ms: 'Beritahu LARIS nombor sembang mana milik anda, supaya mesej pelanggan sampai kepada perniagaan anda.', zh: '告诉 LARIS 哪个聊天号码是你的，这样客户消息才能送达你的生意。', ta: 'எந்த அரட்டை எண் உங்களுடையது என்று LARIS க்குச் சொல்லுங்கள், அப்போதுதான் வாடிக்கையாளர் செய்திகள் உங்கள் வணிகத்தை அடையும்.' })}</p>
      {s.error ? <div role="alert" className="text-sm text-warn"><p>{s.error}</p><button type="button" className="btn mt-2" onClick={s.reload}>{t({ en: 'Retry loading', ms: 'Cuba muat semula', zh: '重新加载', ta: 'மீண்டும் ஏற்று' })}</button></div>
        : !c ? <div role="status" aria-busy="true" className="grid gap-3"><span className="sr-only">{t({ en: 'Loading...', ms: 'Memuatkan...', zh: '加载中...', ta: 'ஏற்றுகிறது...' })}</span><div aria-hidden="true" className="skeleton h-10" /><div aria-hidden="true" className="skeleton h-12" /></div> : <>
          {missing && (
            <div className="mb-3 flex items-start gap-2 rounded-card border border-warn bg-warn-bg p-3 text-sm text-warn" data-testid="channels-warning">
              <Icon name="warn" className="mt-0.5 size-5 shrink-0" />
              <div>
                <p className="font-semibold">{t({ en: 'Some customer messages are being ignored.', ms: 'Sesetengah mesej pelanggan diabaikan.', zh: '部分客户消息被忽略了。', ta: 'சில வாடிக்கையாளர் செய்திகள் புறக்கணிக்கப்படுகின்றன.' })}</p>
                <p>{t({ en: 'More than one business uses this system, so messages we cannot match to yours get no reply.', ms: 'Lebih daripada satu perniagaan menggunakan sistem ini, jadi mesej yang tidak dapat dipadankan dengan anda tidak dibalas.', zh: '有多家商家使用此系统，无法对应到你的消息将得不到回复。', ta: 'ஒன்றுக்கு மேற்பட்ட வணிகங்கள் இந்த அமைப்பைப் பயன்படுத்துகின்றன, எனவே உங்களுடையதுடன் பொருத்த முடியாத செய்திகளுக்கு பதில் கிடைக்காது.' })}</p>
                <p className="mt-1"><strong>{t({ en: 'How to fix: ', ms: 'Cara membetulkan: ', zh: '解决方法：', ta: 'சரிசெய்யும் வழி: ' })}</strong>{both
                  ? t({ en: 'connect your WhatsApp number below, or set TELEGRAM_TENANT_ID for Telegram.', ms: 'sambungkan nombor WhatsApp anda di bawah, atau tetapkan TELEGRAM_TENANT_ID untuk Telegram.', zh: '在下方连接你的 WhatsApp 号码，或为 Telegram 设置 TELEGRAM_TENANT_ID。', ta: 'கீழே உங்கள் WhatsApp எண்ணை இணைக்கவும், அல்லது Telegram க்கு TELEGRAM_TENANT_ID ஐ அமைக்கவும்.' })
                  : !c.whatsapp_mapped
                    ? t({ en: 'connect your WhatsApp number below.', ms: 'sambungkan nombor WhatsApp anda di bawah.', zh: '在下方连接你的 WhatsApp 号码。', ta: 'கீழே உங்கள் WhatsApp எண்ணை இணைக்கவும்.' })
                    : t({ en: 'set TELEGRAM_TENANT_ID for Telegram.', ms: 'tetapkan TELEGRAM_TENANT_ID untuk Telegram.', zh: '为 Telegram 设置 TELEGRAM_TENANT_ID。', ta: 'Telegram க்கு TELEGRAM_TENANT_ID ஐ அமைக்கவும்.' })}</p>
              </div>
            </div>
          )}
          <form className="grid gap-3" onSubmit={e => { e.preventDefault(); save() }}>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">WhatsApp</dt><dd><span className={`chip ${c.whatsapp_mapped ? 'chip-accepted' : 'chip-expired'}`}>{c.whatsapp_mapped ? t({ en: 'Connected', ms: 'Bersambung', zh: '已连接', ta: 'இணைக்கப்பட்டது' }) : t({ en: 'Not connected', ms: 'Tidak bersambung', zh: '未连接', ta: 'இணைக்கப்படவில்லை' })}</span></dd>
              <dt className="text-muted">Telegram</dt><dd><span className={`chip ${c.telegram_mapped ? 'chip-accepted' : 'chip-expired'}`}>{c.telegram_mapped ? t({ en: 'Connected', ms: 'Bersambung', zh: '已连接', ta: 'இணைக்கப்பட்டது' }) : t({ en: 'Not connected', ms: 'Tidak bersambung', zh: '未连接', ta: 'இணைக்கப்படவில்லை' })}</span></dd>
            </dl>
            <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'WhatsApp phone number ID', ms: 'ID nombor telefon WhatsApp', zh: 'WhatsApp 电话号码 ID', ta: 'WhatsApp தொலைபேசி எண் ID' })}
              <input className="input font-normal" inputMode="numeric" autoComplete="off" maxLength={32} value={wa} aria-describedby={err ? 'wa-help wa-err' : 'wa-help'} aria-invalid={!!err || undefined}
                onChange={e => { setWa(e.target.value); setErr('') }} />
              <Hint id="wa-help">{t({ en: 'The Phone number ID from your Meta WhatsApp dashboard (digits only). Leave empty to disconnect.', ms: 'ID Nombor telefon daripada papan pemuka Meta WhatsApp anda (digit sahaja). Biarkan kosong untuk memutuskan sambungan.', zh: '来自 Meta WhatsApp 后台的电话号码 ID（仅数字）。留空即断开连接。', ta: 'உங்கள் Meta WhatsApp டேஷ்போர்டிலிருந்து தொலைபேசி எண் ID (எண்கள் மட்டும்). துண்டிக்க காலியாக விடவும்.' })}</Hint></label>
            {err && <p id="wa-err" role="alert" className="text-sm text-warn">{err}</p>}
            <div className="flex justify-end border-t border-hairline pt-3"><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t({ en: 'Saving...', ms: 'Menyimpan...', zh: '保存中...', ta: 'சேமிக்கிறது...' }) : t({ en: 'Save channels', ms: 'Simpan saluran', zh: '保存渠道', ta: 'சேனல்களைச் சேமி' })}</button></div>
          </form>
          <ConfirmDialog open={ask} danger title={t({ en: 'Disconnect WhatsApp?', ms: 'Putuskan sambungan WhatsApp?', zh: '断开 WhatsApp 连接？', ta: 'WhatsApp ஐத் துண்டிக்கவா?' })} confirmLabel={t(DISC)} body={t({ en: 'The number will be removed. Customers will no longer get replies on WhatsApp until you connect one again.', ms: 'Nombor akan dibuang. Pelanggan tidak lagi mendapat balasan di WhatsApp sehingga anda menyambungkan satu lagi.', zh: '该号码将被移除。在你重新连接之前，客户将无法在 WhatsApp 上收到回复。', ta: 'எண் நீக்கப்படும். நீங்கள் மீண்டும் ஒன்றை இணைக்கும் வரை வாடிக்கையாளர்களுக்கு WhatsApp இல் பதில் கிடைக்காது.' })} onCancel={() => setAsk(false)} onConfirm={() => save(true)} /></>}
    </section>
    </>
  )
}

const DISC: Text = { en: 'Disconnect', ms: 'Putuskan sambungan', zh: '断开连接', ta: 'துண்டி' }
const BOT_ON: Text = { en: 'Customer bot connected.', ms: 'Bot pelanggan disambungkan.', zh: '客户机器人已连接。', ta: 'வாடிக்கையாளர் bot இணைக்கப்பட்டது.' }
const OPENS: Text = { en: '(opens Telegram)', ms: '(membuka Telegram)', zh: '（打开 Telegram）', ta: '(Telegram ஐத் திறக்கும்)' }
interface Bot { connected: boolean; username: string | null; name: string | null; webhook_ok: boolean | null; last_error: string | null; source: 'dashboard' | 'environment' | null; create_link?: string | null; create_blocked?: 'link_first' | 'unavailable' | null }
interface Tg { helper: { configured: boolean; username: string | null; link: string | null }; bot: Bot }

const CONNECT_ERR: Record<string, Text> = {
  bad_token: { en: 'Telegram did not accept that token. Copy it again from BotFather.', ms: 'Telegram tidak menerima token itu. Salin semula daripada BotFather.', zh: 'Telegram 不接受该令牌。请从 BotFather 重新复制。', ta: 'அந்த token ஐ Telegram ஏற்கவில்லை. BotFather இலிருந்து மீண்டும் நகலெடுக்கவும்.' },
  bot_in_use: { en: 'That bot is already connected to another business. Make a new bot in BotFather and use its token.', ms: 'Bot itu sudah disambungkan kepada perniagaan lain. Buat bot baharu dalam BotFather dan guna tokennya.', zh: '该机器人已连接到另一家商家。请在 BotFather 创建新机器人并使用它的令牌。', ta: 'அந்த bot ஏற்கெனவே வேறொரு வணிகத்துடன் இணைக்கப்பட்டுள்ளது. BotFather இல் புதிய bot ஐ உருவாக்கி அதன் token ஐப் பயன்படுத்தவும்.' },
  telegram_unreachable: { en: 'LARIS could not reach Telegram. Wait a minute and try again.', ms: 'LARIS tidak dapat menghubungi Telegram. Tunggu seminit dan cuba lagi.', zh: 'LARIS 无法连接到 Telegram。请等一分钟后再试。', ta: 'LARIS ஆல் Telegram ஐ அடைய முடியவில்லை. ஒரு நிமிடம் காத்திருந்து மீண்டும் முயற்சிக்கவும்.' },
  public_url_unset: { en: 'The server does not know its public address yet. Ask whoever set up LARIS to set APP_PUBLIC_URL.', ms: 'Pelayan belum mengetahui alamat awamnya. Minta orang yang menyediakan LARIS menetapkan APP_PUBLIC_URL.', zh: '服务器还不知道自己的公开地址。请让设置 LARIS 的人设置 APP_PUBLIC_URL。', ta: 'சேவையகத்திற்கு அதன் பொது முகவரி இன்னும் தெரியவில்லை. LARIS ஐ அமைத்தவரிடம் APP_PUBLIC_URL ஐ அமைக்கச் சொல்லுங்கள்.' },
  secret_key_unset: { en: 'The server is missing a security key. Ask whoever set up LARIS to set it, then try again.', ms: 'Pelayan tiada kunci keselamatan. Minta orang yang menyediakan LARIS menetapkannya, kemudian cuba lagi.', zh: '服务器缺少安全密钥。请让设置 LARIS 的人设置，然后再试。', ta: 'சேவையகத்தில் பாதுகாப்பு விசை இல்லை. LARIS ஐ அமைத்தவரிடம் அதை அமைக்கச் சொல்லி, பின் மீண்டும் முயற்சிக்கவும்.' },
}

// Settings > Channels, Telegram: the customer bot (owner pastes a BotFather token) and the LARIS helper bot (staff link their account).
function TelegramCards() {
  useLang()
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
    if (connected) { setWaiting(false); toast(t(BOT_ON)); return }
    const i = setInterval(s.reload, 4000), to = setTimeout(() => { setWaiting(false); setGaveUp(true) }, 120_000)
    return () => { clearInterval(i); clearTimeout(to) }
  }, [waiting, connected]) // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (path: string, body: unknown, done: Text) => {
    if (busy) return
    setErr(''); setBusy(true)
    try { await api('POST', path, body); setToken(''); setShow(false); setAsk(false); toast(t(done)); s.reload() }
    catch (e) { setErr(e instanceof ApiError && CONNECT_ERR[e.code] ? t(CONNECT_ERR[e.code]) : msg(e)) }
    finally { setBusy(false) }
  }
  const b = s.data?.bot, h = s.data?.helper
  const wait = <div role="status" aria-busy="true" className="skeleton h-16"><span className="sr-only">{t({ en: 'Loading...', ms: 'Memuatkan...', zh: '加载中...', ta: 'ஏற்றுகிறது...' })}</span></div>
  const fail = <div role="alert" className="text-sm text-warn"><p>{s.error}</p><button type="button" className="btn mt-2" onClick={s.reload}>{t({ en: 'Retry loading', ms: 'Cuba muat semula', zh: '重新加载', ta: 'மீண்டும் ஏற்று' })}</button></div>
  const manual = (
        <form className="grid gap-3" onSubmit={e => { e.preventDefault(); if (token.trim()) act('/settings/telegram/connect', { token: token.trim() }, BOT_ON) }}>
          <ol className="list-decimal pl-5 text-sm">
            <li>{t({ en: 'Open', ms: 'Buka', zh: '在 Telegram 中打开', ta: 'Telegram இல் திற:' })} <a className="link" href="https://t.me/BotFather" target="_blank" rel="noreferrer">BotFather</a>{t({ en: ' in Telegram.', ms: ' dalam Telegram.', zh: '。', ta: '.' })}</li>
            <li>{t({ en: "Send /newbot and pick a name for your shop's bot.", ms: 'Hantar /newbot dan pilih nama untuk bot kedai anda.', zh: '发送 /newbot，并为你店铺的机器人取一个名称。', ta: '/newbot ஐ அனுப்பி உங்கள் கடையின் bot க்கு ஒரு பெயரைத் தேர்வு செய்யவும்.' })}</li>
            <li>{t({ en: 'Copy the token it gives you and paste it below.', ms: 'Salin token yang diberikan dan tampal di bawah.', zh: '复制它给你的令牌，粘贴到下方。', ta: 'அது தரும் token ஐ நகலெடுத்து கீழே ஒட்டவும்.' })}</li>
          </ol>
          <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Bot token', ms: 'Token bot', zh: '机器人令牌', ta: 'Bot token' })}
            <span className="flex gap-2">
              <input className="input min-w-0 flex-1 font-normal" type={show ? 'text' : 'password'} autoComplete="off" autoCapitalize="none" spellCheck={false} value={token}
                aria-invalid={!!err || undefined} aria-describedby={err ? 'tg-err' : undefined} onChange={e => { setToken(e.target.value); setErr('') }} />
              <button type="button" className="btn" aria-pressed={show} onClick={() => setShow(!show)}>{show ? t({ en: 'Hide', ms: 'Sembunyi', zh: '隐藏', ta: 'மறை' }) : t({ en: 'Show', ms: 'Tunjuk', zh: '显示', ta: 'காட்டு' })}<span className="sr-only"> {t({ en: 'token', ms: 'token', zh: '令牌', ta: 'token' })}</span></button>
            </span></label>
          {err && <p id="tg-err" role="alert" className="text-sm text-warn">{err}</p>}
          <div><button type="submit" className="btn btn-primary" aria-disabled={busy || !token.trim() || undefined}>{busy ? t({ en: 'Connecting...', ms: 'Menyambung...', zh: '连接中...', ta: 'இணைக்கிறது...' }) : t({ en: 'Connect bot', ms: 'Sambungkan bot', zh: '连接机器人', ta: 'Bot ஐ இணை' })}</button></div>
        </form>
  )
  return (
    <>
      <section className="card mt-8 max-w-xl" aria-labelledby="tgb" data-tour="bot-card">
        <h2 id="tgb" className="text-md font-semibold">{t({ en: 'Your customer bot', ms: 'Bot pelanggan anda', zh: '你的客户机器人', ta: 'உங்கள் வாடிக்கையாளர் bot' })}</h2>
        <p className="mb-3 text-sm text-muted">{t({ en: "A Telegram bot with your shop's name, so customers can message you there and get replies.", ms: 'Bot Telegram dengan nama kedai anda, supaya pelanggan boleh menghantar mesej di sana dan mendapat balasan.', zh: '以你店铺名称命名的 Telegram 机器人，客户可以在那里给你发消息并收到回复。', ta: 'உங்கள் கடையின் பெயரில் ஒரு Telegram bot, வாடிக்கையாளர்கள் அங்கே செய்தி அனுப்பி பதில் பெறலாம்.' })}</p>
        {s.error ? fail : !b ? wait : b.connected ? (
          <div className="grid gap-3">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{b.name}</span>
              {b.username && <a className="link" href={`https://t.me/${b.username}`} target="_blank" rel="noreferrer">@{b.username}<span className="sr-only"> {t(OPENS)}</span></a>}
              <span className={b.webhook_ok === false ? 'badge badge-warn' : 'badge'}>{b.webhook_ok === true ? t({ en: 'Working', ms: 'Berfungsi', zh: '运行正常', ta: 'செயல்படுகிறது' }) : b.webhook_ok === false ? t({ en: 'Needs attention', ms: 'Perlu perhatian', zh: '需要处理', ta: 'கவனம் தேவை' }) : t({ en: 'Checking...', ms: 'Menyemak...', zh: '检查中...', ta: 'சரிபார்க்கிறது...' })}</span>
            </p>
            {b.webhook_ok === false && b.last_error && <p className="text-sm text-warn">{b.last_error}</p>}
            {b.source === 'environment' ? <p className="text-sm text-muted">{t({ en: 'Connected through the server settings. To change it, ask whoever set up LARIS.', ms: 'Disambungkan melalui tetapan pelayan. Untuk mengubahnya, tanya orang yang menyediakan LARIS.', zh: '通过服务器设置连接。如需更改，请联系设置 LARIS 的人。', ta: 'சேவையக அமைப்புகள் வழியாக இணைக்கப்பட்டுள்ளது. மாற்ற, LARIS ஐ அமைத்தவரிடம் கேளுங்கள்.' })}</p>
              : ask ? (
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t({ en: 'Confirm disconnecting the bot', ms: 'Sahkan pemutusan sambungan bot', zh: '确认断开机器人连接', ta: 'Bot ஐத் துண்டிப்பதை உறுதிப்படுத்தவும்' })}>
                  <span className="text-sm font-semibold">{t({ en: 'Disconnect this bot? Customers will no longer get replies on Telegram.', ms: 'Putuskan sambungan bot ini? Pelanggan tidak lagi mendapat balasan di Telegram.', zh: '断开此机器人？客户将无法在 Telegram 上收到回复。', ta: 'இந்த bot ஐத் துண்டிக்கவா? வாடிக்கையாளர்களுக்கு Telegram இல் பதில் கிடைக்காது.' })}</span>
                  <button type="button" className="btn btn-danger" autoFocus aria-disabled={busy || undefined} onClick={() => act('/settings/telegram/disconnect', undefined, { en: 'Customer bot disconnected.', ms: 'Bot pelanggan diputuskan.', zh: '客户机器人已断开连接。', ta: 'வாடிக்கையாளர் bot துண்டிக்கப்பட்டது.' })}>{busy ? t({ en: 'Working...', ms: 'Sedang diproses...', zh: '处理中...', ta: 'செயல்படுகிறது...' }) : t({ en: 'Yes, disconnect', ms: 'Ya, putuskan', zh: '是，断开', ta: 'ஆம், துண்டி' })}</button>
                  <button type="button" className="btn" onClick={() => setAsk(false)}>{t({ en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து செய்' })}</button>
                </div>
              ) : <div><button type="button" className="btn" onClick={() => setAsk(true)}>{t(DISC)}</button></div>}
            {err && <p role="alert" className="text-sm text-warn">{err}</p>}
          </div>
        ) : (
          <div className="grid gap-3">
            {b.create_link && <>
              <p className="text-sm">{t({ en: 'Telegram will show a confirmation screen with a name already filled in. Tap Create, then come back here.', ms: 'Telegram akan memaparkan skrin pengesahan dengan nama yang telah diisi. Ketik Create, kemudian kembali ke sini.', zh: 'Telegram 会显示一个已填好名称的确认页面。点 Create，然后回到这里。', ta: 'பெயர் ஏற்கெனவே நிரப்பப்பட்ட உறுதிப்படுத்தல் திரையை Telegram காட்டும். Create ஐத் தட்டி, பின் இங்கே திரும்பி வாருங்கள்.' })}</p>
              <div className="flex flex-wrap items-center gap-3">
                <a className="btn btn-primary" data-tour="bot-create" href={b.create_link}target="_blank" rel="noopener noreferrer" onClick={() => { setWaiting(true); setGaveUp(false) }}>{t({ en: 'Create my bot in Telegram', ms: 'Cipta bot saya dalam Telegram', zh: '在 Telegram 中创建我的机器人', ta: 'Telegram இல் என் bot ஐ உருவாக்கு' })}<span className="sr-only"> {t(OPENS)}</span></a>
                {waiting && <><span role="status" className="text-sm text-muted">{t({ en: 'Waiting for Telegram...', ms: 'Menunggu Telegram...', zh: '等待 Telegram...', ta: 'Telegram க்காகக் காத்திருக்கிறது...' })}</span><button type="button" className="btn" onClick={() => setWaiting(false)}>{t({ en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து செய்' })}</button></>}
              </div>
              {gaveUp && <p role="status" className="text-sm text-muted">{t({ en: 'We did not see your bot yet. If you tapped Create, wait a moment and reload this page.', ms: 'Kami belum nampak bot anda. Jika anda telah mengetik Create, tunggu sebentar dan muat semula halaman ini.', zh: '我们还没有看到你的机器人。如果你已点了 Create，请稍等片刻并刷新此页面。', ta: 'உங்கள் bot ஐ இன்னும் காணவில்லை. Create ஐத் தட்டியிருந்தால், சற்றுக் காத்திருந்து இந்தப் பக்கத்தை மீண்டும் ஏற்றவும்.' })}</p>}
            </>}
            {!b.create_link && b.create_blocked === 'link_first' && (
              <p className="text-sm">{t({ en: 'Link your own Telegram first (Account > Link my Telegram) so LARIS knows the bot is yours.', ms: 'Pautkan Telegram anda sendiri dahulu (Akaun > Pautkan Telegram saya) supaya LARIS tahu bot itu milik anda.', zh: '请先链接你自己的 Telegram（账户 > 链接我的 Telegram），让 LARIS 知道这个机器人是你的。', ta: 'முதலில் உங்கள் Telegram ஐ இணைக்கவும் (கணக்கு > என் Telegram ஐ இணை), அப்போதுதான் அந்த bot உங்களுடையது என்று LARIS அறியும்.' })} <a className="link" href="#/account">{t({ en: 'Go to Account', ms: 'Pergi ke Akaun', zh: '前往账户', ta: 'கணக்கிற்குச் செல்' })}</a></p>)}
            {b.create_link || b.create_blocked === 'link_first'
              ? <details><summary className="cursor-pointer text-sm font-semibold">{t({ en: 'Create it myself instead', ms: 'Cipta sendiri sebaliknya', zh: '改为自己创建', ta: 'அதற்கு பதிலாக நானே உருவாக்குகிறேன்' })}</summary><div className="mt-3">{manual}</div></details>
              : manual}
          </div>
        )}
      </section>
      {b && (b.connected || b.source === 'environment') && <BotSettings />}
      <section className="card mt-8 max-w-xl" aria-labelledby="tgh">
        <h2 id="tgh" className="text-md font-semibold">{t({ en: 'LARIS helper bot (for you and your staff)', ms: 'Bot pembantu LARIS (untuk anda dan kakitangan anda)', zh: 'LARIS 助手机器人（供你和员工使用）', ta: 'LARIS உதவி bot (உங்களுக்கும் உங்கள் ஊழியர்களுக்கும்)' })}</h2>
        <p className="mb-3 text-sm text-muted">{t({ en: 'You and your staff link your own account to this bot. Then you can send product photos with /catalog and supplier price lists straight from Telegram. Link people on the Team page, or yours on the Account page.', ms: 'Anda dan kakitangan anda memautkan akaun sendiri kepada bot ini. Kemudian anda boleh menghantar gambar produk dengan /catalog dan senarai harga pembekal terus dari Telegram. Pautkan orang di halaman Pasukan, atau akaun anda di halaman Akaun.', zh: '你和员工把各自的账户链接到此机器人后，就可以直接在 Telegram 里用 /catalog 发送产品照片和供应商价格表。在“团队”页面链接成员，或在“账户”页面链接你自己的账户。', ta: 'நீங்களும் உங்கள் ஊழியர்களும் உங்கள் சொந்தக் கணக்கை இந்த bot உடன் இணைக்கிறீர்கள். பின்னர் Telegram இலிருந்தே /catalog மூலம் பொருள் புகைப்படங்களையும் சப்ளையர் விலைப் பட்டியல்களையும் அனுப்பலாம். குழு பக்கத்தில் நபர்களை இணைக்கவும், உங்களுடையதை கணக்கு பக்கத்தில் இணைக்கவும்.' })}</p>
        {s.error ? fail : !h ? wait : h.configured && h.username
          ? <a className="link" href={h.link ?? `https://t.me/${h.username}`} target="_blank" rel="noreferrer">@{h.username}<span className="sr-only"> {t(OPENS)}</span></a>
          : <p className="text-sm text-muted">{t({ en: 'Not available on this server yet.', ms: 'Belum tersedia pada pelayan ini.', zh: '此服务器上暂不可用。', ta: 'இந்தச் சேவையகத்தில் இன்னும் கிடைக்கவில்லை.' })}</p>}
      </section>
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'
import { msg } from './ui'
import { useToast } from './Toast'
import { t, useLang } from './i18n'

interface Link { url: string; code: string; expires_at: string }

export const linkError = (e: unknown) => e instanceof ApiError && e.code === 'helper_not_configured'
  ? t({ en: 'The LARIS helper bot is not available on this server yet, so Telegram cannot be linked.', ms: 'Bot pembantu LARIS belum tersedia pada pelayan ini, jadi Telegram tidak dapat dipautkan.', zh: '此服务器上暂时没有 LARIS 助手机器人，因此无法链接 Telegram。', ta: 'இந்தச் சேவையகத்தில் LARIS உதவி bot இன்னும் கிடைக்கவில்லை, எனவே Telegram ஐ இணைக்க முடியாது.' }) : msg(e)

// Modal with the one-time link. Escape closes, Tab stays inside, focus returns to the button that opened it.
function LinkDialog({ link, who, onClose }: { link: Link; who: string; onClose: () => void }) {
  useLang()
  const box = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState('')
  useEffect(() => {
    const from = document.activeElement as HTMLElement | null
    box.current?.querySelector<HTMLElement>('button')?.focus()
    return () => from?.focus()
  }, [])
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return onClose() }
    if (e.key !== 'Tab') return
    const b = box.current!.querySelectorAll<HTMLElement>('button')
    const first = b[0], end = b[b.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus() }
    else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus() }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(link.url); setCopied(t({ en: 'Link copied.', ms: 'Pautan disalin.', zh: '链接已复制。', ta: 'இணைப்பு நகலெடுக்கப்பட்டது.' })) }
    catch { field.current?.select(); setCopied(t({ en: 'Could not copy automatically. The link is selected: press Ctrl+C (or hold and tap Copy on a phone).', ms: 'Tidak dapat menyalin secara automatik. Pautan telah dipilih: tekan Ctrl+C (atau tekan lama dan ketik Salin pada telefon).', zh: '无法自动复制。链接已选中：请按 Ctrl+C（手机上请长按并点“复制”）。', ta: 'தானாக நகலெடுக்க முடியவில்லை. இணைப்பு தேர்ந்தெடுக்கப்பட்டுள்ளது: Ctrl+C அழுத்தவும் (தொலைபேசியில் அழுத்திப் பிடித்து நகலெடு என்பதைத் தட்டவும்).' })) }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4" onKeyDown={keys}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="tl-t" aria-describedby="tl-d" className="card max-h-full w-full max-w-md overflow-y-auto shadow-lg">
        <h2 id="tl-t" className="text-lg font-semibold">{t({ en: `Link Telegram for ${who}`, ms: `Pautkan Telegram untuk ${who}`, zh: `为 ${who} 链接 Telegram`, ta: `${who} க்கு Telegram ஐ இணை` })}</h2>
        <p id="tl-d" className="mt-1 text-sm">{t({ en: 'Valid for 15 minutes. Open it on the phone that has Telegram, then press Start.', ms: 'Sah selama 15 minit. Buka pada telefon yang mempunyai Telegram, kemudian tekan Start.', zh: '15 分钟内有效。请在装有 Telegram 的手机上打开，然后点 Start。', ta: '15 நிமிடங்களுக்குச் செல்லும். Telegram உள்ள தொலைபேசியில் திறந்து Start ஐ அழுத்தவும்.' })}</p>
        <label className="mt-3 flex flex-col gap-1 text-sm font-semibold">{t({ en: 'One-time link', ms: 'Pautan sekali guna', zh: '一次性链接', ta: 'ஒருமுறை இணைப்பு' })}
          <input ref={field} readOnly className="input font-normal" value={link.url} onFocus={e => e.currentTarget.select()} /></label>
        <p className="mt-3 text-sm font-semibold">{t({ en: 'Code', ms: 'Kod', zh: '验证码', ta: 'குறியீடு' })}</p>
        <p className="break-all text-3xl font-semibold tracking-widest" data-testid="tg-code">{link.code}</p>
        <p role="status" className="mt-2 min-h-5 text-sm text-muted">{copied}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={copy}>{t({ en: 'Copy link', ms: 'Salin pautan', zh: '复制链接', ta: 'இணைப்பை நகலெடு' })}</button>
          <button type="button" className="btn" onClick={onClose}>{t({ en: 'Close', ms: 'Tutup', zh: '关闭', ta: 'மூடு' })}</button>
        </div>
      </div>
    </div>
  )
}

// "Link Telegram" (and "Unlink" with a confirm) for one person. base: '/users/<id>' for the owner managing someone, '/me' for yourself.
// linked: true shows Unlink only; false shows Link only; undefined (own account, status unknown) shows both.
export function TelegramLinkControls({ base, who, linked, onChange }: { base: string; who: string; linked?: boolean; onChange?: () => void }) {
  useLang()
  const [link, setLink] = useState<Link>()
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState(false)
  const [err, setErr] = useState('')
  const toast = useToast()
  const url = `${base}/telegram-link`
  const go = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setErr('')
    try { await fn() } catch (e) { setErr(linkError(e)) } finally { setBusy(false) }
  }
  return (
    <>
      {linked !== true && <button type="button" className="btn" aria-disabled={busy || undefined}
        onClick={() => go(async () => setLink(await api<Link>('POST', url)))}>{busy ? t({ en: 'Working...', ms: 'Sedang diproses...', zh: '处理中...', ta: 'செயல்படுகிறது...' }) : t({ en: 'Link Telegram', ms: 'Pautkan Telegram', zh: '链接 Telegram', ta: 'Telegram ஐ இணை' })}<span className="sr-only"> {t({ en: `for ${who}`, ms: `untuk ${who}`, zh: `（${who}）`, ta: `${who} க்கு` })}</span></button>}
      {linked !== false && (ask ? (
        <span className="flex flex-wrap items-center gap-2" role="group" aria-label={t({ en: `Confirm unlinking Telegram for ${who}`, ms: `Sahkan nyahpautan Telegram untuk ${who}`, zh: `确认取消 ${who} 的 Telegram 链接`, ta: `${who} க்கான Telegram இணைப்பை நீக்குவதை உறுதிப்படுத்தவும்` })}>
          <span className="text-sm font-semibold">{t({ en: `Unlink Telegram for ${who}?`, ms: `Nyahpautkan Telegram untuk ${who}?`, zh: `取消 ${who} 的 Telegram 链接？`, ta: `${who} க்கான Telegram இணைப்பை நீக்கவா?` })}</span>
          <button type="button" className="btn btn-danger" autoFocus aria-disabled={busy || undefined}
            onClick={() => go(async () => { await api('DELETE', url); setAsk(false); toast(t({ en: 'Telegram unlinked.', ms: 'Telegram dinyahpautkan.', zh: '已取消 Telegram 链接。', ta: 'Telegram இணைப்பு நீக்கப்பட்டது.' })); onChange?.() })}>{t({ en: 'Yes, unlink', ms: 'Ya, nyahpautkan', zh: '是，取消链接', ta: 'ஆம், இணைப்பை நீக்கு' })}</button>
          <button type="button" className="btn" onClick={() => setAsk(false)}>{t({ en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து செய்' })}</button>
        </span>
      ) : <button type="button" className="btn" onClick={() => setAsk(true)}>{t({ en: 'Unlink', ms: 'Nyahpaut', zh: '取消链接', ta: 'இணைப்பை நீக்கு' })}<span className="sr-only"> {t({ en: `Telegram for ${who}`, ms: `Telegram untuk ${who}`, zh: `（${who} 的 Telegram）`, ta: `${who} க்கான Telegram` })}</span></button>)}
      {err && <p role="alert" className="basis-full text-sm text-warn">{err}</p>}
      {link && <LinkDialog link={link} who={who} onClose={() => { setLink(undefined); onChange?.() }} />}
    </>
  )
}

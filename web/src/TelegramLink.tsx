import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'
import { msg } from './ui'
import { useToast } from './Toast'

interface Link { url: string; code: string; expires_at: string }

export const linkError = (e: unknown) => e instanceof ApiError && e.code === 'helper_not_configured'
  ? 'The LARIS helper bot is not available on this server yet, so Telegram cannot be linked.' : msg(e)

// Modal with the one-time link. Escape closes, Tab stays inside, focus returns to the button that opened it.
function LinkDialog({ link, who, onClose }: { link: Link; who: string; onClose: () => void }) {
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
    try { await navigator.clipboard.writeText(link.url); setCopied('Link copied.') }
    catch { field.current?.select(); setCopied('Could not copy automatically. The link is selected: press Ctrl+C (or hold and tap Copy on a phone).') }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4" onKeyDown={keys}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="tl-t" aria-describedby="tl-d" className="card max-h-full w-full max-w-md overflow-y-auto shadow-lg">
        <h2 id="tl-t" className="text-lg font-semibold">Link Telegram for {who}</h2>
        <p id="tl-d" className="mt-1 text-sm">Valid for 15 minutes. Open it on the phone that has Telegram, then press Start.</p>
        <label className="mt-3 flex flex-col gap-1 text-sm font-semibold">One-time link
          <input ref={field} readOnly className="input font-normal" value={link.url} onFocus={e => e.currentTarget.select()} /></label>
        <p className="mt-3 text-sm font-semibold">Code</p>
        <p className="break-all text-3xl font-semibold tracking-widest" data-testid="tg-code">{link.code}</p>
        <p role="status" className="mt-2 min-h-5 text-sm text-muted">{copied}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={copy}>Copy link</button>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// "Link Telegram" (and "Unlink" with a confirm) for one person. base: '/users/<id>' for the owner managing someone, '/me' for yourself.
// linked: true shows Unlink only; false shows Link only; undefined (own account, status unknown) shows both.
export function TelegramLinkControls({ base, who, linked, onChange }: { base: string; who: string; linked?: boolean; onChange?: () => void }) {
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
        onClick={() => go(async () => setLink(await api<Link>('POST', url)))}>{busy ? 'Working...' : 'Link Telegram'}<span className="sr-only"> for {who}</span></button>}
      {linked !== false && (ask ? (
        <span className="flex flex-wrap items-center gap-2" role="group" aria-label={`Confirm unlinking Telegram for ${who}`}>
          <span className="text-sm font-semibold">Unlink Telegram for {who}?</span>
          <button type="button" className="btn btn-danger" autoFocus aria-disabled={busy || undefined}
            onClick={() => go(async () => { await api('DELETE', url); setAsk(false); toast('Telegram unlinked.'); onChange?.() })}>Yes, unlink</button>
          <button type="button" className="btn" onClick={() => setAsk(false)}>Cancel</button>
        </span>
      ) : <button type="button" className="btn" onClick={() => setAsk(true)}>Unlink<span className="sr-only"> Telegram for {who}</span></button>)}
      {err && <p role="alert" className="basis-full text-sm text-warn">{err}</p>}
      {link && <LinkDialog link={link} who={who} onClose={() => { setLink(undefined); onChange?.() }} />}
    </>
  )
}

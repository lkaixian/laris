import { useEffect, useRef, useState } from 'react'
import { logout } from './api'
import { t, useLang } from './i18n'

const IDLE_MS = 25 * 60 * 1000 // no pointer or key activity for this long shows the warning
const WARN_S = 60 // seconds the person has to answer before the existing sign out runs
const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const

// Client-side idle timeout. The server session lifetime is separate (SESSION_HOURS); this only ends an unattended screen sooner.
// Mount it only for a real signed-in account (not mock mode, not a shared access token).
export default function IdleGuard() {
  useLang()
  const last = useRef(Date.now())
  const [left, setLeft] = useState<number | null>(null)  // seconds remaining while the dialog is open
  const dlg = useRef<HTMLDivElement>(null)
  const stay = useRef<HTMLButtonElement>(null)
  const from = useRef<HTMLElement | null>(null)
  const open = left !== null

  // Deadlines come from timestamps, not tick counts, so a throttled background tab still signs out on time.
  useEffect(() => {
    const seen = () => { if (!dlg.current) last.current = Date.now() }  // while the dialog is open only its buttons count
    ACTIVITY.forEach(e => addEventListener(e, seen, { passive: true }))
    const timer = setInterval(() => {
      const idle = Date.now() - last.current
      if (idle < IDLE_MS) return setLeft(null)
      const s = Math.ceil((IDLE_MS + WARN_S * 1000 - idle) / 1000)
      if (s <= 0) { clearInterval(timer); setLeft(null); logout() } else setLeft(s)
    }, 1000)
    return () => { ACTIVITY.forEach(e => removeEventListener(e, seen)); clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!open) return
    from.current = document.activeElement as HTMLElement | null
    stay.current?.focus()
    return () => from.current?.focus()
  }, [open])

  const keep = () => { last.current = Date.now(); setLeft(null) }
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); return keep() }
    if (e.key !== 'Tab') return
    const b = dlg.current!.querySelectorAll<HTMLElement>('button')
    const first = b[0], end = b[b.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus() }
    else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus() }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4" onKeyDown={keys}>
      <div ref={dlg} role="alertdialog" aria-modal="true" aria-labelledby="idle-t" aria-describedby="idle-d" className="card w-full max-w-sm shadow-lg">
        <h2 id="idle-t" className="text-lg font-semibold">{t({ en: 'Still there?', ms: 'Masih di situ?', zh: '还在吗？', ta: 'இன்னும் இருக்கிறீர்களா?' })}</h2>
        <p id="idle-d" className="mt-1 text-sm">{t({ en: `You will be signed out in ${left} ${left === 1 ? 'second' : 'seconds'}.`, ms: `Anda akan dilog keluar dalam ${left} saat.`, zh: `您将在 ${left} 秒后退出登录。`, ta: `${left} வினாடிகளில் நீங்கள் வெளியேற்றப்படுவீர்கள்.` })}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button ref={stay} type="button" className="btn btn-primary" onClick={keep}>{t({ en: 'Stay signed in', ms: 'Kekal log masuk', zh: '保持登录', ta: 'உள்நுழைந்தே இரு' })}</button>
          <button type="button" className="btn" onClick={() => logout()}>{t({ en: 'Sign out', ms: 'Log keluar', zh: '退出登录', ta: 'வெளியேறு' })}</button>
        </div>
      </div>
    </div>
  )
}

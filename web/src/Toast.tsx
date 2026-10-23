import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './icons'

// Light toast system for one-line confirmations ("Settings saved."). Errors stay inline next to the thing that failed.
//   const toast = useToast(); toast('Settings saved.')
// One always-mounted polite live region, max 3 at once (oldest dropped), auto-dismiss after 5 s, each has a Dismiss button.
const Ctx = createContext<(text: string, link?: { href: string; label: string }) => void>(() => undefined)
export const useToast = () => useContext(Ctx)

const MAX = 3
const LIFE_MS = 5000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<{ id: number; text: string; link?: { href: string; label: string } }[]>([])
  const n = useRef(0)
  const dismiss = useCallback((id: number) => setList(l => l.filter(t => t.id !== id)), [])
  const push = useCallback((text: string, link?: { href: string; label: string }) => {
    const id = ++n.current
    setList(l => [...l.slice(1 - MAX), { id, text, link }])
    setTimeout(() => dismiss(id), LIFE_MS)
  }, [dismiss])
  return (
    <Ctx value={push}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] grid justify-items-end gap-2 sm:left-auto sm:right-4 sm:bottom-4 sm:w-96">
        {list.map(t => (
          <div key={t.id} className="toast pointer-events-auto">
            <span className="min-w-0 flex-1 break-words">{t.text}{t.link && <> <a className="link" href={t.link.href}>{t.link.label}</a></>}</span>
            <button type="button" className="toast-x" aria-label={`Dismiss: ${t.text}`} onClick={() => dismiss(t.id)}><Icon name="close" className="size-4" /></button>
          </div>
        ))}
      </div>
    </Ctx>
  )
}

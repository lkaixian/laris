import { useEffect, useState } from 'react'
import { api, ApiError } from './api'
import { matchFns } from './functions'
import type { Fn } from './functions'
import { t } from './i18n'
import type { Lang, Text } from './i18n'

/* The AI guide answer panel inside the search palette. Sends the typed question plus menu names only (never page data) and shows plain text.
   The question is held in this component's state only: no storage, not in Recent. */
interface Cand { id: string; label: string; path: string; href: string }
interface Answer { answer: string; links: { label: string; href: string }[] }

const S = {
  thinking: { en: 'Thinking...', ms: 'Sedang berfikir...' },
  back: { en: 'Back to search', ms: 'Kembali ke carian' },
  footer: { en: 'AI answers can be wrong. Nothing was changed.', ms: 'Jawapan AI boleh salah. Tiada apa yang diubah.' },
  off: { en: 'The AI guide is switched off. Ask the owner to turn it on under Admin, AI settings.', ms: 'Panduan AI dimatikan. Minta pemilik menghidupkannya di Admin, Tetapan AI.' },
  slow: { en: 'Please wait a moment.', ms: 'Sila tunggu sebentar.' },
  down: { en: 'The AI helper is not available right now. Use the search results above or open Help.', ms: 'Pembantu AI tidak tersedia sekarang. Guna hasil carian di atas atau buka Bantuan.' },
  links: { en: 'Open', ms: 'Buka' },
} satisfies Record<string, Text>

// Top matches from the registry (menu names only), Help Center last; Help Center and Home when nothing matches. Backend allows 1 to 8.
export function candidates(visible: Fn[], question: string, lang: Lang): Cand[] {
  const ok = visible.filter(f => f.href.startsWith('#/'))
  const help = ok.find(f => f.id === 'help-center')
  const top = matchFns(ok, question, lang).filter(f => f !== help).slice(0, help ? 7 : 8)
  const list = top.length ? [...top, ...(help ? [help] : [])] : [help, ok.find(f => f.id === 'nav-home')].filter((f): f is Fn => !!f)
  return list.map(f => ({ id: f.id.slice(0, 60), label: t(f.label, lang).slice(0, 80), path: f.path.join(' > ').slice(0, 120), href: f.href.slice(0, 120) }))
}

export function GuideChat({ question, visible, lang, onBack, onClose, onOff }: {
  question: string; visible: Fn[]; lang: Lang; onBack: () => void; onClose: () => void; onOff: () => void
}) {
  const [res, setRes] = useState<Answer>()
  const [err, setErr] = useState<Text>()
  useEffect(() => {
    const ac = new AbortController()
    api<Answer>('POST', '/assistant/guide', { question: question.slice(0, 300), lang, candidates: candidates(visible, question, lang) }, { quiet: true, signal: ac.signal })
      .then(setRes, e => {
        if (ac.signal.aborted) return
        if (e instanceof ApiError) e.shown = true
        const code = e instanceof ApiError ? e.code : ''
        if (code === 'ai_off') onOff()
        setErr(code === 'ai_off' ? S.off : e instanceof ApiError && e.status === 429 ? S.slow : S.down)
      })
    return () => ac.abort()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const links = (res?.links ?? []).filter(l => l.href.startsWith('#/'))  // client-side: only in-app links
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <div aria-live="polite">
        {!res && !err && <p className="text-muted">{t(S.thinking, lang)}</p>}
        {err && <p role="alert">{t(err, lang)}</p>}
        {res && <>
          <p className="whitespace-pre-wrap break-words">{res.answer}</p>
          {links.length > 0 && <ul className="mt-3 grid gap-1">
            {links.map(l => <li key={l.href}><a className="link inline-flex min-h-11 items-center break-words" href={l.href} onClick={onClose}>{t(S.links, lang)}: {l.label}</a></li>)}
          </ul>}
        </>}
      </div>
      <button type="button" className="btn mt-4" onClick={onBack}>{t(S.back, lang)}</button>
      <p className="mt-3 text-xs text-muted">{t(S.footer, lang)}</p>
    </div>
  )
}

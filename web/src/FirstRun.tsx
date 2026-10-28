import { useEffect } from 'react'
import { t, useLang } from './i18n'

// The first-run question (or "Continue the tour"). A small card pinned bottom right, not a modal: the page stays usable behind it.
export function FirstRun({ name, resume, onYes, onNo, onLater, onHide }: {
  name: string
  resume?: { step: number; total: number }
  onYes: () => void; onNo: () => void; onLater: () => void; onHide: () => void
}) {
  useLang()
  // Esc dismisses (to "later", or hides the resume offer), unless something else such as a dialog already handled it.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role="dialog"]')) return
      resume ? onHide() : onLater()
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [resume, onHide, onLater])
  return (
    <section role="region" aria-labelledby="fr-h" className="card fixed inset-x-2 bottom-2 z-[60] border-l-4 border-l-accent shadow-2 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-96">
      {resume ? <>
        <h2 id="fr-h" className="text-lg font-semibold">{t({ en: 'Continue the tour?', ms: 'Sambung lawatan?' })}</h2>
        <p className="mt-1 text-sm">{t({ en: `Continue the tour, step ${resume.step + 1} of ${resume.total}.`, ms: `Sambung lawatan, langkah ${resume.step + 1} daripada ${resume.total}.` })}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" onClick={onYes}>{t({ en: 'Continue', ms: 'Sambung' })}</button>
          <button type="button" className="btn" onClick={onNo}>{t({ en: 'No thanks', ms: 'Tidak, terima kasih' })}</button>
          <button type="button" className="link min-h-11 px-2" onClick={onHide}>{t({ en: 'Hide for now', ms: 'Sembunyi buat masa ini' })}</button>
        </div>
      </> : <>
        <h2 id="fr-h" className="text-lg font-semibold">{t({ en: `Welcome to LARIS, ${name}.`, ms: `Selamat datang ke LARIS, ${name}.` })}</h2>
        <p className="mt-1 text-sm">{t({ en: 'Is this your first time using LARIS?', ms: 'Adakah ini kali pertama anda menggunakan LARIS?' })}</p>
        <div className="mt-3 grid gap-2">
          <button type="button" className="btn btn-primary" onClick={onYes}>{t({ en: 'Yes, show me around (about 2 minutes)', ms: 'Ya, tunjukkan saya (kira-kira 2 minit)' })}</button>
          <button type="button" className="btn" onClick={onNo}>{t({ en: 'No, I have used it before', ms: 'Tidak, saya pernah menggunakannya' })}</button>
          <button type="button" className="link min-h-11 justify-self-end px-2" onClick={onLater}>{t({ en: 'Ask me later', ms: 'Tanya saya nanti' })}</button>
        </div>
      </>}
    </section>
  )
}

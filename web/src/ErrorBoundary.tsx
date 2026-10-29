import { Component, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { t, useLang } from './i18n'

// Render errors stop here instead of blanking the app. Two levels (docs/ux-refactor.md):
//   <ErrorBoundary level="root">  main.tsx: plain full-page fallback with Reload
//   <ErrorBoundary level="page">  App.tsx: one per page render, keyed by route, so the shell stays usable and navigating away recovers
// main.tsx silences React's own caught-error log (onCaughtError); componentDidCatch logs the error once.
const refOf = (e: unknown) => (e && typeof e === 'object' && 'requestId' in e && typeof e.requestId === 'string' ? e.requestId : undefined)

function PageFallback({ error, reset }: { error: unknown; reset: () => void }) {
  useLang()
  const h = useRef<HTMLHeadingElement>(null)
  useEffect(() => { h.current?.focus() }, [])
  const ref = refOf(error)
  return (
    <div role="alert" className="card border-warn bg-warn-bg text-warn">
      <h1 ref={h} tabIndex={-1} className="text-2xl font-semibold">{t({ en: 'This page hit a problem', ms: 'Halaman ini menghadapi masalah', zh: '此页面出现问题', ta: 'இந்தப் பக்கத்தில் சிக்கல் ஏற்பட்டது' })}</h1>
      <p className="mt-2">{t({ en: 'The rest of the app still works. Try again, or go back to Home.', ms: 'Bahagian lain aplikasi masih berfungsi. Cuba lagi, atau kembali ke Utama.', zh: '应用的其余部分仍可使用。请重试，或返回首页。', ta: 'பயன்பாட்டின் மற்ற பகுதிகள் தொடர்ந்து செயல்படுகின்றன. மீண்டும் முயலவும், அல்லது முகப்புக்குத் திரும்பவும்.' })}{ref && <> {t({ en: 'Reference', ms: 'Rujukan', zh: '参考编号', ta: 'குறிப்பு எண்' })}: {ref}</>}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={reset}>{t({ en: 'Try again', ms: 'Cuba lagi', zh: '重试', ta: 'மீண்டும் முயற்சி' })}</button>
        <a className="btn" href="#/home">{t({ en: 'Home', ms: 'Utama', zh: '首页', ta: 'முகப்பு' })}</a>
      </div>
    </div>
  )
}

function RootFallback({ error }: { error: unknown }) {
  useLang()
  const ref = refOf(error)
  return (
    <main className="mx-auto grid min-h-screen max-w-md content-center gap-4 px-4 py-8 text-center">
      <strong className="text-xl font-semibold tracking-[0.2em]">LARIS</strong>
      <h1 className="text-2xl font-semibold">{t({ en: 'Something went wrong', ms: 'Sesuatu tidak kena', zh: '出了点问题', ta: 'ஏதோ தவறு நடந்துவிட்டது' })}</h1>
      <p>{t({ en: 'Reload the page to carry on. Anything you had not saved may be lost.', ms: 'Muat semula halaman untuk meneruskan. Apa-apa yang belum disimpan mungkin hilang.', zh: '请重新加载页面以继续。尚未保存的内容可能会丢失。', ta: 'தொடர பக்கத்தை மீண்டும் ஏற்றவும். சேமிக்காதவை இழக்கப்படலாம்.' })}{ref && <> {t({ en: 'Reference', ms: 'Rujukan', zh: '参考编号', ta: 'குறிப்பு எண்' })}: {ref}</>}</p>
      <div><button type="button" className="btn btn-primary" onClick={() => location.reload()}>{t({ en: 'Reload', ms: 'Muat semula', zh: '重新加载', ta: 'மீண்டும் ஏற்று' })}</button></div>
    </main>
  )
}

export class ErrorBoundary extends Component<{ level: 'root' | 'page'; children: ReactNode }, { error?: { e: unknown } }> {
  state: { error?: { e: unknown } } = {}
  static getDerivedStateFromError(e: unknown) { return { error: { e } } }
  componentDidCatch(e: unknown) { console.error('Render error', e) }
  render() {
    const x = this.state.error
    if (!x) return this.props.children
    return this.props.level === 'root' ? <RootFallback error={x.e} /> : <PageFallback error={x.e} reset={() => this.setState({ error: undefined })} />
  }
}

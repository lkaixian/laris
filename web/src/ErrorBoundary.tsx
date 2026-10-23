import { Component, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

// Render errors stop here instead of blanking the app. Two levels (docs/ux-refactor.md):
//   <ErrorBoundary level="root">  main.tsx: plain full-page fallback with Reload
//   <ErrorBoundary level="page">  App.tsx: one per page render, keyed by route, so the shell stays usable and navigating away recovers
// main.tsx silences React's own caught-error log (onCaughtError); componentDidCatch logs the error once.
const refOf = (e: unknown) => (e && typeof e === 'object' && 'requestId' in e && typeof e.requestId === 'string' ? e.requestId : undefined)

function PageFallback({ error, reset }: { error: unknown; reset: () => void }) {
  const h = useRef<HTMLHeadingElement>(null)
  useEffect(() => { h.current?.focus() }, [])
  const ref = refOf(error)
  return (
    <div role="alert" className="card border-warn bg-warn-bg text-warn">
      <h1 ref={h} tabIndex={-1} className="text-2xl font-semibold">This page hit a problem</h1>
      <p className="mt-2">The rest of the app still works. Try again, or go back to Home.{ref && <> Reference: {ref}</>}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={reset}>Try again</button>
        <a className="btn" href="#/home">Home</a>
      </div>
    </div>
  )
}

function RootFallback({ error }: { error: unknown }) {
  const ref = refOf(error)
  return (
    <main className="mx-auto grid min-h-screen max-w-md content-center gap-4 px-4 py-8 text-center">
      <strong className="text-xl font-semibold tracking-[0.2em]">LARIS</strong>
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p>Reload the page to carry on. Anything you had not saved may be lost.{ref && <> Reference: {ref}</>}</p>
      <div><button type="button" className="btn btn-primary" onClick={() => location.reload()}>Reload</button></div>
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

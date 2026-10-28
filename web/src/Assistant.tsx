import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { PageHeader, msg, useFetch } from './ui'

interface Answer { reply: string; intent: string; items: { label: string; href: string }[]; source: 'model' | 'keywords'; suggestions: string[] }
type Turn = { from: 'me'; text: string } | { from: 'bot'; a: Answer } | { from: 'err'; text: string }

// Look-up assistant. The server lets the model pick what to look up; the answer is built from your data. It cannot change anything.
export function AssistantView() {
  const sug = useFetch<string[]>('/assistant/suggestions')
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [turns])

  const ask = async (q: string) => {
    const t = q.trim()
    if (!t || busy) return
    setBusy(true); setText('')
    setTurns(x => [...x, { from: 'me', text: t }])
    try {
      const a = await api<Answer>('POST', '/assistant', { message: t })
      setTurns(x => [...x, { from: 'bot', a }])
    } catch (e) { setTurns(x => [...x, { from: 'err', text: msg(e) }]) }
    finally { setBusy(false); input.current?.focus() }
  }

  return (
    <>
      <PageHeader title="Assistant" description="Ask about your quotes, contacts, costs and jobs. It looks things up for you. It cannot change, approve, price or send anything: you do that on the quote." />
      <div className="card flex max-w-2xl flex-col gap-3">
        <div role="log" aria-live="polite" aria-label="Conversation" className="flex min-h-48 flex-col gap-3">
          {turns.length === 0 && <p className="text-sm text-muted">Nothing asked yet. Pick a question below or type your own.</p>}
          {turns.map((t, i) => t.from === 'me' ? (
            <p key={i} className="self-end rounded-ui bg-tint px-3 py-2 text-sm"><span className="sr-only">You: </span>{t.text}</p>
          ) : t.from === 'err' ? (
            <p key={i} role="alert" className="self-start rounded-ui border border-warn bg-warn-bg px-3 py-2 text-sm text-warn">{t.text}</p>
          ) : (
            <div key={i} className="self-start rounded-ui border border-soft px-3 py-2 text-sm">
              <p><span className="sr-only">Assistant: </span>{t.a.reply}</p>
              {t.a.items.length > 0 && <ul className="mt-2 grid gap-1">{t.a.items.map((it, j) => <li key={j}><a className="link inline-flex min-h-11 items-center" href={it.href}>{it.label}</a></li>)}</ul>}
              {t.a.source === 'keywords' && <p className="mt-2 text-xs text-muted">The AI service is unavailable, so this answer used keywords only.</p>}
              {t.a.suggestions.length > 0 && <p className="mt-2 flex flex-wrap gap-2">{t.a.suggestions.map(s => <button key={s} type="button" className="btn" onClick={() => ask(s)}>{s}</button>)}</p>}
            </div>
          ))}
          {busy && <p role="status" className="text-sm text-muted">Looking...</p>}
          <div ref={end} />
        </div>
        {sug.error && turns.length === 0 && <p className="text-sm text-muted">Suggested questions could not be loaded. You can still type your own.</p>}
        {sug.data && turns.length === 0 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested questions">
            {sug.data.map(s => <button key={s} type="button" className="btn" onClick={() => ask(s)}>{s}</button>)}
          </div>
        )}
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); ask(text) }}>
          <label className="sr-only" htmlFor="ask">Your question</label>
          <input id="ask" ref={input} className="input min-w-0 flex-1" maxLength={500} autoComplete="off" value={text} placeholder="For example: who supplies acrylic?" onChange={e => setText(e.target.value)} />
          <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>Ask</button>
        </form>
      </div>
    </>
  )
}

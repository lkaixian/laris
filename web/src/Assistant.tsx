import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { AiActivity } from './AiActivity'
import { PageHeader, msg, useFetch } from './ui'
import { ConfirmDialog } from './kit'
import { useToast } from './Toast'
import { Icon } from './icons'
import { tx, txOr } from './strings'
import { useLang } from './i18n'

// Look-up assistant. The server lets the model pick what to look up; the answer is built from your data. For two safe actions (move a job,
// skip a follow-up) it only PROPOSES: this screen shows a confirm step, then calls the normal route, which checks the permission again.
// It never sets a price, approves, sends or deletes.
type Action = { kind: 'job_move'; id: string; to: 'todo' | 'doing' | 'done'; label: string } | { kind: 'followup_skip'; id: string; label: string }
interface Answer { reply: string; intent: string; items: { label: string; href: string }[]; actions?: Action[]; source: 'model' | 'keywords'; suggestions: string[]; hidden?: Record<string, number>; denied?: string[] }
type Turn = { from: 'me'; text: string } | { from: 'bot'; a: Answer } | { from: 'err'; text: string } | { from: 'done'; text: string }

const ID = /^[A-Za-z0-9-]{1,64}$/
// The request is built HERE from the action's kind; the server's answer never supplies a path or a body.
function request(a: Action): [string, Record<string, string>] | null {
  if (!ID.test(a.id)) return null
  if (a.kind === 'job_move' && ['todo', 'doing', 'done'].includes(a.to)) return [`/jobs/${a.id}`, { status: a.to }]
  if (a.kind === 'followup_skip') return [`/followups/${a.id}`, { action: 'skip' }]
  return null
}

export function AssistantChat({ compact, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const sug = useFetch<string[]>('/assistant/suggestions')
  const toast = useToast()
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Action>()
  const [done, setDone] = useState<Set<string>>(new Set())
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

  const run = async (a: Action) => {
    setPending(undefined)
    const req = request(a)
    if (!req || busy) return
    setBusy(true)
    try {
      await api('POST', req[0], req[1])
      setDone(d => new Set(d).add(a.kind + a.id))
      setTurns(x => [...x, { from: 'done', text: tx('as.done', a.label) }])
      toast(tx('as.done', a.label))
      dispatchEvent(new Event('laris:changed'))
    } catch (e) { setTurns(x => [...x, { from: 'err', text: msg(e) }]) }
    finally { setBusy(false); input.current?.focus() }
  }

  const id = compact ? 'ask-w' : 'ask'
  return (
    <div className={`flex flex-col gap-3 ${compact ? 'min-h-0 flex-1' : 'card max-w-2xl'}`}>
      <div role="log" aria-live="polite" aria-label={tx('as.conversation')} className={`flex flex-col gap-3 ${compact ? 'min-h-0 flex-1 overflow-y-auto pr-1' : 'min-h-48'}`}>
        {turns.length === 0 && <p className="text-sm text-muted">{tx('as.empty')}</p>}
        {turns.map((t, i) => t.from === 'me' ? (
          <p key={i} className="self-end rounded-ui bg-tint px-3 py-2 text-sm"><span className="sr-only">{tx('as.you')}</span>{t.text}</p>
        ) : t.from === 'err' ? (
          <p key={i} role="alert" className="self-start rounded-ui border border-warn bg-warn-bg px-3 py-2 text-sm text-warn">{t.text}</p>
        ) : t.from === 'done' ? (
          <p key={i} className="self-start rounded-ui border border-soft px-3 py-2 text-sm font-semibold"><Icon name="check" className="mr-1 inline size-4" />{t.text}</p>
        ) : (
          <div key={i} className="self-start rounded-ui border border-soft px-3 py-2 text-sm">
            <p><span className="sr-only">{tx('as.bot')}</span>{t.a.reply}</p>
            {t.a.items.length > 0 && <ul className="mt-2 grid gap-1">{t.a.items.map((it, j) => <li key={j}><a className="link inline-flex min-h-11 items-center" href={it.href} onClick={onNavigate}>{it.label}</a></li>)}</ul>}
            {!!t.a.actions?.length && (
              <ul className="mt-2 grid gap-2" aria-label={tx('as.proposed')}>
                {t.a.actions.map(a => (
                  <li key={a.kind + a.id}>
                    {done.has(a.kind + a.id) ? <span className="text-muted">{tx('as.done', a.label)}</span>
                      : <button type="button" className="btn text-left" aria-disabled={busy || undefined} onClick={() => !busy && setPending(a)}>{a.label}...</button>}
                  </li>
                ))}
              </ul>
            )}
            {!!t.a.denied?.length && <p className="mt-2 text-xs text-muted">{tx('as.denied', t.a.denied.map(s => txOr('as.s.' + s, s)).join(', '))}</p>}
            {!!Object.keys(t.a.hidden ?? {}).length && <p className="mt-2 text-xs text-muted">{tx('as.hidden', Object.entries(t.a.hidden!).map(([k, n]) => `${n} ${txOr('as.m.' + k, k.toLowerCase())}`).join(', '))}</p>}
            {t.a.source === 'keywords' && <p className="mt-2 text-xs text-muted">{tx('as.keywords')}</p>}
            {t.a.suggestions.length > 0 && <p className="mt-2 flex flex-wrap gap-2">{t.a.suggestions.map(s => <button key={s} type="button" className="btn" onClick={() => ask(s)}>{s}</button>)}</p>}
          </div>
        ))}
        {busy && <p role="status" className="text-sm text-muted">{tx('as.working')}</p>}
        <div ref={end} />
      </div>
      {sug.error && turns.length === 0 && <p className="text-sm text-muted">{tx('as.sugFailed')}</p>}
      {sug.data && turns.length === 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={tx('as.suggested')}>
          {sug.data.map(s => <button key={s} type="button" className="btn" onClick={() => ask(s)}>{s}</button>)}
        </div>
      )}
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); ask(text) }}>
        <label className="sr-only" htmlFor={id}>{tx('as.question')}</label>
        <input id={id} ref={input} className="input min-w-0 flex-1" maxLength={500} autoComplete="off" value={text} placeholder={tx('as.placeholder')} onChange={e => setText(e.target.value)} />
        <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{tx('as.ask')}</button>
      </form>
      <ConfirmDialog open={!!pending} title={tx('as.confirmTitle')} confirmLabel={tx('as.confirmYes')} onCancel={() => setPending(undefined)} onConfirm={() => pending && run(pending)}
        body={<><p className="font-semibold">{pending?.label}</p><p className="mt-2 text-sm text-muted">{tx('as.confirmNote')}</p></>} />
    </div>
  )
}

export function AssistantView() {
  return (
    <>
      <PageHeader title={tx('as.title')} description={tx('as.lead')} />
      <AssistantChat />
      <div className="mt-6"><AiActivity /></div>
    </>
  )
}

// Floating "Ask" button on every page (bottom right) that opens the same chat in a side panel. Hidden on the Assistant page itself.
export function AssistantWidget({ hidden }: { hidden?: boolean }) {
  useLang()  // redraw in the chosen language (the widget is outside the page that is redrawn)
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return
    panel.current?.querySelector('input')?.focus()
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { setOpen(false); btn.current?.focus() } }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [open])
  if (hidden) return null
  return (
    <>
      <div aria-hidden="true" className="h-16" />{/* room at the end of every page, so the button never covers the last line */}
      {open && (
        <section ref={panel} role="dialog" aria-modal="false" aria-labelledby="ask-w-h"
          className="fixed inset-x-2 bottom-20 z-40 flex max-h-[70vh] flex-col gap-2 rounded-card border border-hairline bg-surface p-3 shadow-lg sm:inset-x-auto sm:right-4 sm:w-[24rem]">
          <div className="flex items-center justify-between gap-2">
            <h2 id="ask-w-h" className="text-md font-semibold">{tx('as.title')}</h2>
            <button type="button" className="btn" onClick={() => { setOpen(false); btn.current?.focus() }}>{tx('as.close')}<span className="sr-only">{tx('as.theAssistant')}</span></button>
          </div>
          <AssistantChat compact onNavigate={() => setOpen(false)} />
        </section>
      )}
      <button ref={btn} type="button" aria-expanded={open} data-guide="ask-laris"
        className="btn btn-primary fixed right-4 bottom-4 z-40 min-h-12 gap-2 rounded-full px-4 shadow-lg" onClick={() => setOpen(!open)}>
        <Icon name="ask" className="size-5" />{tx('as.button')}<span className="sr-only">{tx('as.theAssistant')}</span>
      </button>
    </>
  )
}

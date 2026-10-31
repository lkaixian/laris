import { useEffect, useRef, useState } from 'react'
import { BOT_EVENT } from './bot'
import type { BotHole, BotMsg } from './bot'
import { hasGuide, startGuide } from './Guide'
import { t, useLang } from './i18n'
import type { Text } from './i18n'
import { tx } from './strings'

// The Ask Laris robot. It lives in the bottom-right corner (tap it to ask a question), walks to the part of the page a guide or tour step
// is about, thinks while an answer is being worked out, and talks while it is given. Only transform and opacity animate; with reduced
// motion it simply appears where it should be. It never reads or changes your data: it only reacts to messages from bot.ts.
const T = {
  look: { en: 'Look here!', ms: 'Tengok sini!', zh: '看这里！', ta: 'இங்கே பாருங்கள்!' },
  tap: { en: 'Try clicking it!', ms: 'Cuba klik!', zh: '点一下试试！', ta: 'கிளிக் செய்து பாருங்கள்!' },
  hello: { en: "Hi! I'm Ask Laris. Want a quick tour of this page?", ms: 'Hai! Saya Ask Laris. Nak lawatan ringkas halaman ini?', zh: '你好！我是 Ask Laris。要不要快速看看这一页？', ta: 'வணக்கம்! நான் Ask Laris. இந்தப் பக்கத்தின் சிறு சுற்றுலா வேண்டுமா?' },
  show: { en: 'Show me', ms: 'Tunjukkan', zh: '带我看看', ta: 'காட்டு' },
  no: { en: 'Not now', ms: 'Bukan sekarang', zh: '以后再说', ta: 'இப்போது வேண்டாம்' },
  think: { en: 'Thinking...', ms: 'Sedang berfikir...', zh: '思考中...', ta: 'யோசிக்கிறேன்...' },
} satisfies Record<string, Text>

const page = () => (location.hash.split('/')[1] || 'home').split('?')[0]
const seen = (k: string) => { try { return sessionStorage.getItem('laris.bot.' + k) === '1' } catch { return false } }
const mark = (k: string) => { try { sessionStorage.setItem('laris.bot.' + k, '1') } catch { /* private window: it may greet again */ } }
const overlap = (a: BotHole, b: BotHole) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

export function Bot({ open, onClick, onWarm }: { open: boolean; onClick: () => void; onWarm: () => void }) {
  useLang()
  const [s, setS] = useState<'idle' | 'think' | 'talk'>('idle')
  const [move, setMove] = useState({ dx: 0, dy: 0, tilt: 0 })
  const [spot, setSpot] = useState(false)
  const [line, setLine] = useState<{ text: Text | string; offer?: boolean } | null>(null)
  const [hop, setHop] = useState(0)
  const box = useRef<HTMLButtonElement>(null)
  const isOpen = useRef(open)
  isOpen.current = open
  const timer = useRef(0)
  const flight = useRef(0)
  const size = () => (matchMedia('(max-width: 639px)').matches ? { w: 64, h: 80 } : { w: 80, h: 100 })
  const home = (): BotHole => { const z = size(); return { x: innerWidth - 16 - z.w, y: innerHeight - 16 - z.h, ...z } }
  const say = (text: Text | string, ms = 3200, offer = false) => { setLine({ text, offer }); clearTimeout(timer.current); if (ms) timer.current = window.setTimeout(() => setLine(null), ms) }

  const fly = (to: { x: number; y: number } | null) => {
    const h = home(), dx = to ? to.x - h.x : 0, dy = to ? to.y - h.y : 0
    setMove(m => ({ dx, dy, tilt: Math.max(-14, Math.min(14, (dx - m.dx) / 22)) }))
    clearTimeout(flight.current)
    flight.current = window.setTimeout(() => setMove(m => ({ ...m, tilt: 0 })), 420)  // lean into the move, then stand up straight
  }

  useEffect(() => {
    let wait = 0
    const on = (e: Event) => {
      const m = (e as CustomEvent<BotMsg>).detail
      if (m.kind === 'state') { setS(m.s); if (m.s === 'think') { if (!isOpen.current) say(T.think, 0) } else setLine(l => (l && l.text === T.think ? null : l)); return }
      if (m.kind === 'say') { say(m.text, m.ms ?? 3200); return }
      if (m.kind === 'home') { clearTimeout(wait); setSpot(false); setLine(null); fly(null); return }
      // spot: wait a beat so the guide panel has settled in its corner, then stand where neither the part nor the panel is covered
      clearTimeout(wait)
      wait = window.setTimeout(() => {
        const z = size(), h0 = home(), hole = m.hole
        if (overlap(hole, h0) > h0.w * h0.h * 0.4) { setSpot(false); fly(null); return }  // the step is about the robot itself
        const pe = document.querySelector('.guide-panel, [data-tour-panel]') as HTMLElement | null
        const pr = pe?.getBoundingClientRect(), panel: BotHole | null = pr ? { x: pr.x, y: pr.y, w: pr.width, h: pr.height } : null
        const g = 8, clampX = (x: number) => Math.max(g, Math.min(innerWidth - z.w - g, x)), clampY = (y: number) => Math.max(g, Math.min(innerHeight - z.h - g, y))
        const cands = [
          { x: hole.x - z.w - g, y: hole.y }, { x: hole.x + hole.w + g, y: hole.y },
          { x: hole.x + hole.w - z.w, y: hole.y - z.h - g }, { x: hole.x, y: hole.y + hole.h + g },
        ].map(c => ({ x: clampX(c.x), y: clampY(c.y) }))
        const score = (c: { x: number; y: number }) => { const b = { x: c.x, y: c.y, w: z.w, h: z.h }; return overlap(b, hole) * 10 + (panel ? overlap(b, panel) : 0) }
        const best = cands.reduce((a, c) => (score(c) < score(a) ? c : a))
        setSpot(true); fly(best); say(m.act ? T.tap : T.look, 2600)
      }, 520)
    }
    addEventListener(BOT_EVENT, on)
    return () => { removeEventListener(BOT_EVENT, on); clearTimeout(wait) }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Page change: a little hop, and (once per page per visit) an offer to walk through the page.
  useEffect(() => {
    const arrive = () => {
      const p = page()
      setHop(n => n + 1)
      if (open || spot || !hasGuide(p) || seen('hi-' + p)) return
      mark('hi-' + p); setTimeout(() => { if (!document.querySelector('.guide-panel, [data-tour-panel]')) say(T.hello, 9000, true) }, 900)
    }
    addEventListener('hashchange', arrive)
    const first = setTimeout(arrive, 1600)
    return () => { removeEventListener('hashchange', arrive); clearTimeout(first) }
  }, [open, spot])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) setLine(null) }, [open])
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(flight.current) }, [])

  const top = move.dy + home().y < 150, left = move.dx + home().x < innerWidth / 2
  return (
    <div className="bot" data-s={s} data-spot={spot || undefined} style={{ ['--bx' as string]: `${move.dx}px`, ['--by' as string]: `${move.dy}px`, ['--br' as string]: `${move.tilt}deg` }}>
      {line && (
        <div role="status" className="bot-bubble" data-v={top ? 'b' : 't'} data-h={left ? 'l' : 'r'}>
          {s === 'think' && line.text === T.think
            ? <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="ask-dots inline-flex gap-1">{[0, 1, 2].map(i => <span key={i} style={{ ['--i' as string]: i }} className="size-1.5 rounded-full bg-current" />)}</span>{t(T.think)}</span>
            : <span>{typeof line.text === 'string' ? line.text : t(line.text)}</span>}
          {line.offer && <span className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary min-h-9 px-3" onClick={() => { setLine(null); startGuide(page()) }}>{t(T.show)}</button>
            <button type="button" className="btn min-h-9 px-3" onClick={() => setLine(null)}>{t(T.no)}</button></span>}
        </div>)}
      <button ref={box} type="button" aria-expanded={open} data-open={open} data-guide="ask-laris" className="bot-btn" onPointerEnter={onWarm} onFocus={onWarm} onClick={onClick}>
        <span key={hop} className="bot-hop"><span className="bot-inner"><img src="./brand/laris-bot.png" alt="" draggable={false} width="80" height="100" /></span></span>
        <span className="bot-shadow" aria-hidden="true" />
        <span className="sr-only">{tx('as.button')}</span>
      </button>
    </div>
  )
}

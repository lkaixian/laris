import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { guideFor } from './guides'
import { t, useLang } from './i18n'
import { tx } from './strings'

// The "?" guide: one step at a time, beside the page, pointing at the part of the page each step is about.
// A step that points at a part of the page blurs and dims the rest (a mask with a hole over that part); a step with nothing
// to point at leaves the page alone. When the part is not there yet (an empty list) the panel shows an Example of it instead.
// It closes by itself when you go to another page.
const EVENT = 'laris:guide'
const MOVE = { en: 'Move this panel', ms: 'Alih panel ini', zh: '移动此面板', ta: 'இந்த பலகையை நகர்த்து' }
export const openGuide = (navKey: string) => dispatchEvent(new CustomEvent(EVENT, { detail: navKey }))
export const hasGuide = (navKey: string) => !!guideFor(navKey)

// Open the page first (if needed), then the guide once it has drawn.
export function startGuide(navKey: string) {
  if ((location.hash.split('/')[1] || 'home').split('?')[0] !== navKey) location.hash = `#/${navKey}`
  setTimeout(() => openGuide(navKey), 350)
}

export function GuidePanel() {
  useLang()
  const [key, setKey] = useState<string | null>(null)
  const [i, setI] = useState(0)
  const [spot, setSpot] = useState<{ top: number; left: number; n: number; hole: { x: number; y: number; w: number; h: number } } | null>(null)
  const [missing, setMissing] = useState(false)  // the step points at something that is not on the screen
  const [glide, setGlide] = useState(false)  // the ring slides to the new part for a moment after a step change, then follows scrolling tightly
  const [pos, setPos] = useState<'br' | 'bl' | 'tr' | 'tl'>('br')  // which corner the panel sits in: the one that does not cover the ringed part
  const [done, setDone] = useState(false)  // "Try it" clicked: tick shown for a beat before the next step
  const dir = useRef(1)
  const manual = useRef(false)  // the person moved the panel themselves on this step
  const box = useRef<HTMLElement>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  const guide = key ? guideFor(key) : null

  useEffect(() => {
    const h = (e: Event) => { lastFocus.current = document.activeElement as HTMLElement; setKey((e as CustomEvent<string>).detail); setI(0); dir.current = 1 }
    addEventListener(EVENT, h)
    return () => removeEventListener(EVENT, h)
  }, [])
  const close = () => { setKey(null); setSpot(null); lastFocus.current?.focus?.() }
  const go = (n: number) => { dir.current = n >= i ? 1 : -1; setI(n) }
  // Going to another page ends the guide (the sidebar "?" for another page closes this one and opens that page's guide).
  useEffect(() => {
    if (!key) return
    const page = () => (location.hash.split('/')[1] || 'home').split('?')[0]
    const here = page()
    const h = () => { if (page() !== here) { setKey(null); setSpot(null) } }  // a filter changing ?query on the same page keeps it open
    addEventListener('hashchange', h)
    return () => removeEventListener('hashchange', h)
  }, [key])
  useEffect(() => { if (key) box.current?.querySelector<HTMLElement>('h2')?.focus() }, [key])
  useEffect(() => {
    if (!key) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) close() }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [key])  // eslint-disable-line react-hooks/exhaustive-deps

  // Point at this step's part of the page: scroll it into view, ring it, and put the step number beside it.
  useEffect(() => {
    document.querySelectorAll('.guide-spot').forEach(el => el.classList.remove('guide-spot', 'guide-try'))
    manual.current = false; setDone(false); setGlide(true)
    const gt = setTimeout(() => setGlide(false), 700)
    const target = guide?.steps[i]?.target
    const el = target ? [...document.querySelectorAll<HTMLElement>(`[data-guide="${target}"]`)].find(x => x.getClientRects().length > 0) : undefined
    setMissing(!!target && !el)
    if (!el) { setSpot(null); return () => clearTimeout(gt) }  // otherwise the old ring stays until here, so it can slide to the next part
    el.classList.add('guide-spot')
    if (guide!.steps[i].act) el.classList.add('guide-try')
    // On a phone the guide covers the lower half, so the part it points at goes to the top of the screen.
    const phone = matchMedia('(max-width: 639px)').matches
    el.style.scrollMarginTop = phone ? '72px' : ''
    el.scrollIntoView({ block: phone ? 'start' : 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    const place = () => {
      const r = el.getBoundingClientRect(), pad = 8
      // A part taller or wider than the screen is cut to what is on screen, so the mask and the ring never run off it.
      const x0 = Math.max(4, r.left - pad), y0 = Math.max(4, r.top - pad), x1 = Math.min(innerWidth - 4, r.right + pad), y1 = Math.min(innerHeight - 4, r.bottom + pad)
      const hole = { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
      setSpot({ top: Math.max(8, y0 - 6), left: Math.max(8, x0 - 6), n: i + 1, hole })
      const p = box.current
      if (p && !phone) {  // first corner where the panel and the ringed part do not overlap
        const pw = p.offsetWidth, ph = p.offsetHeight, m = 16
        const at: Record<string, [number, number]> = { br: [innerWidth - m - pw, innerHeight - 88 - ph], bl: [m, innerHeight - 88 - ph], tr: [innerWidth - m - pw, 72], tl: [m, 72] }
        const lap = (c: [number, number]) => Math.max(0, Math.min(c[0] + pw, hole.x + hole.w) - Math.max(c[0], hole.x)) * Math.max(0, Math.min(c[1] + ph, hole.y + hole.h) - Math.max(c[1], hole.y))
        if (!manual.current) setPos((['br', 'bl', 'tr', 'tl'] as const).reduce((b, k) => (lap(at[k]) < lap(at[b]) ? k : b), 'br'))  // the corner that covers the least of it
      }
    }
    place()
    const t1 = setTimeout(place, 400)
    // "Try it" step: the person really clicks the ringed element, a tick shows, then the guide moves on.
    let t2 = 0
    const tryIt = (e: MouseEvent) => {
      if (!guide!.steps[i].act || !el.contains(e.target as Node) || t2) return
      setDone(true)
      t2 = window.setTimeout(() => { dir.current = 1; setI(n => Math.min(n + 1, guide!.steps.length - 1)) }, 600)
    }
    document.addEventListener('click', tryIt, true)
    addEventListener('scroll', place, true); addEventListener('resize', place)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(gt); removeEventListener('scroll', place, true); removeEventListener('resize', place); document.removeEventListener('click', tryIt, true); el.classList.remove('guide-spot', 'guide-try') }
  }, [key, i, guide])

  if (!guide) return null
  const n = guide.steps.length
  const step = guide.steps[i]
  // The mask goes straight under <body>: a blur only reaches what is behind it when no parent has its own filter or animation.
  return (
    <>
      {spot && createPortal(<Mask hole={spot.hole} glide={glide} />, document.body)}
      {spot && <span aria-hidden="true" className={`guide-badge ${glide ? 'guide-glide' : ''}`} style={{ top: spot.top, left: spot.left }}>{spot.n}</span>}
      {createPortal(<section ref={box} role="dialog" aria-modal="false" aria-labelledby="guide-h" className="guide-panel" data-pos={pos}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{tx('guide.howto')}</p>
            <h2 id="guide-h" tabIndex={-1} className="text-md font-semibold">{t(guide.title)}</h2>
          </div>
          <span className="flex shrink-0 gap-2">
          <button type="button" className="btn min-h-9 px-3" title={t(MOVE)} onClick={() => { manual.current = true; setPos(p => (p === 'br' ? 'bl' : p === 'bl' ? 'tl' : p === 'tl' ? 'tr' : 'br')) }}><span aria-hidden="true">&#8644;</span><span className="sr-only">{t(MOVE)}</span></button>
          <button type="button" className="btn min-h-9 px-3" onClick={close}>{tx('as.close')}<span className="sr-only"> {tx('guide.howto')}</span></button>
          </span>
        </div>
        <ol className="mt-3 flex gap-1" aria-label={tx('guide.progress', i + 1, n)}>
          {guide.steps.map((_, j) => (
            <li key={j} className="flex-1"><button type="button" aria-current={j === i ? 'step' : undefined} aria-label={tx('guide.goto', j + 1)}
              className={`block h-2 w-full rounded-full transition-colors duration-300 ${j <= i ? 'bg-accent' : 'bg-hairline'}`} onClick={() => go(j)} /></li>
          ))}
        </ol>
        <p className="mt-3 text-sm font-semibold text-accent" aria-live="polite">{tx('guide.step', i + 1, n)}</p>
        <div key={i} className="guide-step mt-1 flex gap-3" style={{ '--dx': `${dir.current * 14}px` } as React.CSSProperties}>
          <span aria-hidden="true" key={String(done)} className={`grid size-9 shrink-0 place-items-center rounded-full bg-accent text-base font-bold text-on-accent ${done ? 'guide-pop' : ''}`}>{done ? '✓' : i + 1}</span>
          <p className="text-base leading-relaxed">{t(step.text)}</p>
        </div>
        {missing && <p className="mt-2 text-xs text-muted">{tx('guide.notHere')}</p>}
        {step.act && !missing && !done && <p className="guide-step mt-2 rounded-ui border border-accent bg-tint p-2 text-sm font-semibold">{tx('guide.tryIt')}</p>}
        {missing && step.sample && (
          <div className="guide-step mt-3 rounded-ui border border-dashed border-line bg-tint p-3" style={{ '--dx': '0px' } as React.CSSProperties}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{tx('guide.example')}</p>
            <p className="mt-1 text-sm font-semibold">{t(step.sample.title)}</p>
            <ul className="mt-1 grid gap-1 text-sm">{step.sample.lines.map((l, j) => <li key={j}>{t(l)}</li>)}</ul>
          </div>
        )}
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <button type="button" className="btn" aria-disabled={i === 0 || undefined} onClick={() => i > 0 && go(i - 1)}>{tx('guide.back')}</button>
          {i < n - 1
            ? <button type="button" className="btn btn-primary" onClick={() => go(i + 1)}>{tx('guide.next')}</button>
            : <button type="button" className="btn btn-primary" onClick={close}>{tx('guide.done')}</button>}
        </div>
      </section>, document.body)}
    </>
  )
}

// Blur and dim everything except the hole: four panels round it (top, bottom, left, right).
// The panels take the clicks, so only this step's part of the page (and the guide itself) can be used.
function Mask({ hole, glide }: { hole: { x: number; y: number; w: number; h: number }; glide: boolean }) {
  const { x, y, w, h } = hole
  return (
    <div className={glide ? 'guide-glide' : ''} style={{ display: 'contents' }}>
      <div aria-hidden="true" className="guide-mask" style={{ left: 0, right: 0, top: 0, height: Math.max(0, y) }} />
      <div aria-hidden="true" className="guide-mask" style={{ left: 0, right: 0, top: y + h, bottom: 0 }} />
      <div aria-hidden="true" className="guide-mask" style={{ left: 0, width: Math.max(0, x), top: y, height: h }} />
      <div aria-hidden="true" className="guide-mask" style={{ left: x + w, right: 0, top: y, height: h }} />
      <div aria-hidden="true" className="guide-hole" style={{ left: x, top: y, width: w, height: h }} />
    </div>
  )
}

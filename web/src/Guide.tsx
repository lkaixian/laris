import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { guideFor } from './guides'
import { t, useLang } from './i18n'
import { tx } from './strings'

// The "?" guide: one step at a time, beside the page, pointing at the part of the page each step is about.
// While it is open the rest of the page is blurred and dimmed (a mask with a hole over this step's part), and it closes by
// itself when you go to another page.
const EVENT = 'laris:guide'
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
  const box = useRef<HTMLElement>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  const guide = key ? guideFor(key) : null

  useEffect(() => {
    const h = (e: Event) => { lastFocus.current = document.activeElement as HTMLElement; setKey((e as CustomEvent<string>).detail); setI(0) }
    addEventListener(EVENT, h)
    return () => removeEventListener(EVENT, h)
  }, [])
  const close = () => { setKey(null); setSpot(null); lastFocus.current?.focus?.() }
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
    document.querySelectorAll('.guide-spot').forEach(el => el.classList.remove('guide-spot'))
    setSpot(null)
    const target = guide?.steps[i]?.target
    if (!target) return
    const el = [...document.querySelectorAll<HTMLElement>(`[data-guide="${target}"]`)].find(x => x.offsetParent !== null)
    if (!el) return
    el.classList.add('guide-spot')
    // On a phone the guide covers the lower half, so the part it points at goes to the top of the screen.
    const phone = matchMedia('(max-width: 639px)').matches
    el.style.scrollMarginTop = phone ? '72px' : ''
    el.scrollIntoView({ block: phone ? 'start' : 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    const place = () => {
      const r = el.getBoundingClientRect(), pad = 8
      setSpot({ top: Math.max(8, r.top - 14), left: Math.max(8, r.left - 14), n: i + 1, hole: { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 } })
    }
    const t1 = setTimeout(place, 400)
    addEventListener('scroll', place, true); addEventListener('resize', place)
    return () => { clearTimeout(t1); removeEventListener('scroll', place, true); removeEventListener('resize', place); el.classList.remove('guide-spot') }
  }, [key, i, guide])

  if (!guide) return null
  const n = guide.steps.length
  const step = guide.steps[i]
  const missing = !!step.target && !spot
  // The mask goes straight under <body>: a blur only reaches what is behind it when no parent has its own filter or animation.
  return (
    <>
      {createPortal(<Mask hole={spot?.hole} />, document.body)}
      {spot && <span aria-hidden="true" className="guide-badge" style={{ top: spot.top, left: spot.left }}>{spot.n}</span>}
      <section ref={box} role="dialog" aria-modal="false" aria-labelledby="guide-h" className="guide-panel">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{tx('guide.howto')}</p>
            <h2 id="guide-h" tabIndex={-1} className="text-md font-semibold">{t(guide.title)}</h2>
          </div>
          <button type="button" className="btn min-h-9 px-3" onClick={close}>{tx('as.close')}<span className="sr-only"> {tx('guide.howto')}</span></button>
        </div>
        <ol className="mt-3 flex gap-1" aria-label={tx('guide.progress', i + 1, n)}>
          {guide.steps.map((_, j) => (
            <li key={j} className="flex-1"><button type="button" aria-current={j === i ? 'step' : undefined} aria-label={tx('guide.goto', j + 1)}
              className={`block h-2 w-full rounded-full ${j <= i ? 'bg-accent' : 'bg-hairline'}`} onClick={() => setI(j)} /></li>
          ))}
        </ol>
        <p className="mt-3 text-sm font-semibold text-accent" aria-live="polite">{tx('guide.step', i + 1, n)}</p>
        <div className="mt-1 flex gap-3">
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-base font-bold text-on-accent">{i + 1}</span>
          <p className="text-base leading-relaxed">{t(step.text)}</p>
        </div>
        {step.target && <p className="mt-2 text-xs text-muted">{missing ? tx('guide.notHere') : tx('guide.pointing')}</p>}
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <button type="button" className="btn" aria-disabled={i === 0 || undefined} onClick={() => i > 0 && setI(i - 1)}>{tx('guide.back')}</button>
          {i < n - 1
            ? <button type="button" className="btn btn-primary" onClick={() => setI(i + 1)}>{tx('guide.next')}</button>
            : <button type="button" className="btn btn-primary" onClick={close}>{tx('guide.done')}</button>}
        </div>
      </section>
    </>
  )
}

// Blur and dim everything except the hole: four panels round it (top, bottom, left, right). No hole: the whole page.
// The panels take the clicks, so only this step's part of the page (and the guide itself) can be used.
function Mask({ hole }: { hole?: { x: number; y: number; w: number; h: number } }) {
  if (!hole) return <div aria-hidden="true" className="guide-mask" style={{ inset: 0 }} />
  const { x, y, w, h } = hole
  return (
    <>
      <div aria-hidden="true" className="guide-mask" style={{ left: 0, right: 0, top: 0, height: Math.max(0, y) }} />
      <div aria-hidden="true" className="guide-mask" style={{ left: 0, right: 0, top: y + h, bottom: 0 }} />
      <div aria-hidden="true" className="guide-mask" style={{ left: 0, width: Math.max(0, x), top: y, height: h }} />
      <div aria-hidden="true" className="guide-mask" style={{ left: x + w, right: 0, top: y, height: h }} />
      <div aria-hidden="true" className="guide-hole" style={{ left: x, top: y, width: w, height: h }} />
    </>
  )
}

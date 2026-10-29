import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject } from 'react'
import { t, useLang } from './i18n'
import type { Text } from './i18n'

// Mark the item in a photo, doodle style: add a circle, rectangle or square (or just drag on the photo to draw one), drag it onto the item,
// drag its corner dot to resize. Tap a mark and a bar appears under the photo with a big Delete at one end and a big OK at the other.
// The canvas holds the photo with every mark burned in: it is the image that gets uploaded. The marks on top are transparent buttons for touch.
type Kind = 'circle' | 'rect' | 'square'
interface Shape { id: number; kind: Kind; x: number; y: number; w: number; h: number }  // top-left corner and size, fractions of the photo
const MAX_SIDE = 1600, MIN = 0.04
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

const S = {
  help: { en: 'Tap Circle, Rectangle or Square to add a mark, then drag it onto the item. You can also drag on the photo to draw one. Tap a mark to change it. Marks are optional.',
    ms: 'Ketik Bulatan, Segi empat tepat atau Segi empat sama untuk menambah tanda, kemudian seret ke atas item. Anda juga boleh menyeret pada foto untuk melukis satu. Ketik tanda untuk mengubahnya. Tanda adalah pilihan.',
    zh: '点按“圆形”“矩形”或“正方形”添加标记，再把它拖到物品上。也可以直接在照片上拖动绘制。点按标记即可修改。标记是可选的。',
    ta: 'குறியைச் சேர்க்க வட்டம், செவ்வகம் அல்லது சதுரத்தைத் தொடவும், பிறகு பொருளின் மேல் இழுக்கவும். படத்தில் நேரடியாக இழுத்தும் வரையலாம். மாற்ற குறியைத் தொடவும். குறிகள் விருப்பமானவை.' },
  circle: { en: 'Circle', ms: 'Bulatan', zh: '圆形', ta: 'வட்டம்' },
  rect: { en: 'Rectangle', ms: 'Segi empat tepat', zh: '矩形', ta: 'செவ்வகம்' },
  square: { en: 'Square', ms: 'Segi empat sama', zh: '正方形', ta: 'சதுரம்' },
  clear: { en: 'Clear photo', ms: 'Buang foto', zh: '清除照片', ta: 'படத்தை நீக்கு' },
  ok: { en: 'OK', ms: 'OK', zh: '确定', ta: 'சரி' },
  del: { en: 'Delete', ms: 'Padam', zh: '删除', ta: 'நீக்கு' },
  size: { en: 'Resize', ms: 'Ubah saiz', zh: '调整大小', ta: 'அளவு மாற்று' },
  tools: { en: 'Marks', ms: 'Tanda', zh: '标记', ta: 'குறிகள்' },
  keys: { en: 'Arrow keys move, Shift and arrows resize, Enter keeps it, Delete removes it.', ms: 'Kekunci anak panah menggerak, Shift dan anak panah mengubah saiz, Enter mengekalkan, Delete memadam.',
    zh: '方向键移动，Shift 加方向键调整大小，Enter 保留，Delete 删除。', ta: 'அம்புக்குறிகள் நகர்த்தும், Shift மற்றும் அம்புக்குறிகள் அளவை மாற்றும், Enter வைத்திருக்கும், Delete நீக்கும்.' },
} satisfies Record<string, Text>
const KIND = { circle: S.circle, rect: S.rect, square: S.square }

export function MarkPhoto({ img, canvasRef, onClear }: { img: HTMLImageElement; canvasRef: RefObject<HTMLCanvasElement | null>; onClear: () => void }) {
  useLang()
  const [shapes, setShapes] = useState<Shape[]>([])
  const [sel, setSel] = useState<number | null>(null)
  const [announce, setAnnounce] = useState('')
  const wrap = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: 'draw' | 'move' | 'size'; id: number; sx: number; sy: number; o: Shape } | null>(null)
  const next = useRef(1), last = useRef<Kind>('circle'), cur = useRef(shapes)
  cur.current = shapes

  // The photo (long side capped at MAX_SIDE) with every mark drawn on it.
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  const W = Math.round(img.naturalWidth * k), H = Math.round(img.naturalHeight * k)
  useEffect(() => {
    const c = canvasRef.current, g = c?.getContext('2d')
    if (!c || !g) return
    c.width = W; c.height = H
    g.drawImage(img, 0, 0, W, H)
    g.strokeStyle = '#dc2626'; g.lineWidth = Math.max(4, W * 0.007)
    for (const s of shapes) {
      g.beginPath()
      if (s.kind === 'circle') g.ellipse((s.x + s.w / 2) * W, (s.y + s.h / 2) * H, (s.w / 2) * W, (s.h / 2) * H, 0, 0, Math.PI * 2)
      else g.rect(s.x * W, s.y * H, s.w * W, s.h * H)
      g.stroke()
    }
  }, [img, shapes, W, H, canvasRef])

  const pt = (e: PointerEvent) => { const b = wrap.current!.getBoundingClientRect(); return { x: clamp((e.clientX - b.left) / b.width, 0, 1), y: clamp((e.clientY - b.top) / b.height, 0, 1) } }
  const set = (id: number, p: Partial<Shape>) => setShapes(a => a.map(s => (s.id === id ? { ...s, ...p } : s)))
  // Circles and squares stay true in pixels: a width in photo fractions needs a different height fraction.
  const squareH = (w: number) => (w * W) / H

  const add = (kind: Kind) => {
    last.current = kind
    const w = kind === 'rect' ? 0.4 : 0.3, h = kind === 'rect' ? 0.25 : squareH(w)
    const s: Shape = { id: next.current++, kind, x: (1 - w) / 2, y: clamp((1 - h) / 2, 0, 1 - h), w, h }
    setShapes(a => [...a, s]); setSel(s.id); setAnnounce(`${t(KIND[kind])}`)
  }
  const remove = (id: number) => { setShapes(a => a.filter(s => s.id !== id)); setSel(null) }

  const startShape = (e: PointerEvent, s: Shape, mode: 'move' | 'size') => {
    e.stopPropagation(); wrap.current!.setPointerCapture(e.pointerId)
    const p = pt(e); drag.current = { mode, id: s.id, sx: p.x, sy: p.y, o: s }; setSel(s.id)
  }
  const down = (e: PointerEvent) => {
    if (e.target !== e.currentTarget && (e.target as HTMLElement).tagName !== 'CANVAS') return
    wrap.current!.setPointerCapture(e.pointerId)
    const p = pt(e), kind = last.current
    const s: Shape = { id: next.current++, kind, x: p.x, y: p.y, w: 0, h: 0 }
    drag.current = { mode: 'draw', id: s.id, sx: p.x, sy: p.y, o: s }; setSel(null); setShapes(a => [...a, s])
  }
  const move = (e: PointerEvent) => {
    const d = drag.current; if (!d) return
    const p = pt(e), dx = p.x - d.sx, dy = p.y - d.sy
    if (d.mode === 'move') set(d.id, { x: clamp(d.o.x + dx, 0, 1 - d.o.w), y: clamp(d.o.y + dy, 0, 1 - d.o.h) })
    else if (d.mode === 'size') {
      const w = clamp(d.o.w + dx, MIN, 1 - d.o.x)
      const h = d.o.kind === 'rect' ? clamp(d.o.h + dy, MIN, 1 - d.o.y) : squareH(w)
      if (d.o.y + h <= 1) set(d.id, { w, h })
    } else {
      let bw = Math.abs(dx) * W, bh = Math.abs(dy) * H
      if (d.o.kind !== 'rect') bw = bh = Math.max(bw, bh)
      const w = Math.min(bw / W, 1), h = Math.min(bh / H, 1)
      set(d.id, { x: clamp(dx >= 0 ? d.sx : d.sx - w, 0, 1 - w), y: clamp(dy >= 0 ? d.sy : d.sy - h, 0, 1 - h), w, h })
    }
  }
  const up = () => {
    const d = drag.current; drag.current = null
    if (d?.mode !== 'draw') return
    const s = cur.current.find(x => x.id === d.id)  // a tap on the photo (no real drag) draws nothing
    if (s && s.w >= MIN) setSel(s.id); else setShapes(a => a.filter(x => x.id !== d.id))
  }

  const keys = (e: KeyboardEvent, s: Shape) => {
    const step = e.key.startsWith('Arrow') ? 0.02 : 0, dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
    if (step) {
      e.preventDefault()
      if (e.shiftKey) { const w = clamp(s.w + dx - dy, MIN, 1 - s.x), h = s.kind === 'rect' ? clamp(s.h - dy + dx, MIN, 1 - s.y) : squareH(w); if (s.y + h <= 1) set(s.id, { w, h }) }
      else set(s.id, { x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) })
    } else if (e.key === 'Enter') { e.preventDefault(); setSel(null) }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(s.id) }
  }

  const pct = (v: number) => `${v * 100}%`
  return (
    <div className="grid gap-3">
      <p id="mark-help" className="text-sm">{t(S.help)}</p>
      <div role="group" aria-label={t(S.tools)} data-guide="ask-marks" className="flex flex-wrap gap-2">
        {(['circle', 'rect', 'square'] as const).map(kd => <button key={kd} type="button" className="btn" onClick={() => add(kd)}>{t(KIND[kd])}</button>)}
        <button type="button" className="btn ml-auto" onClick={onClear}>{t(S.clear)}</button>
      </div>
      <div ref={wrap} className="relative touch-none select-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <canvas ref={canvasRef} aria-hidden="true" className="block h-auto w-full cursor-crosshair rounded-ui border border-line" />
        {shapes.filter(s => s.w >= MIN).map((s, n) => {
          const on = s.id === sel
          return (
            <div key={s.id} role="button" tabIndex={0} aria-pressed={on} aria-describedby={on ? 'mark-keys' : undefined} aria-label={`${t(KIND[s.kind])} ${n + 1}`}
              className={`absolute cursor-move ${s.kind === 'circle' ? 'rounded-full' : 'rounded-sm'} ${on ? 'outline outline-2 outline-offset-2 outline-accent' : 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'}`}
              style={{ left: pct(s.x), top: pct(s.y), width: pct(s.w), height: pct(s.h) }}
              onPointerDown={e => startShape(e, s, 'move')} onKeyDown={e => keys(e, s)} onFocus={() => setSel(s.id)}>
              {on && <span role="presentation" aria-label={t(S.size)} className="absolute -bottom-4 -right-4 grid size-10 cursor-nwse-resize place-items-center rounded-full border-2 border-surface bg-accent shadow-2"
                onPointerDown={e => startShape(e, s, 'size')}><span aria-hidden="true" className="size-2 rounded-full bg-on-accent" /></span>}
            </div>
          )
        })}
      </div>
      <p id="mark-keys" className="sr-only">{t(S.keys)}</p>
      <p role="status" className="sr-only">{announce}</p>
      {sel !== null && (
        <div className="flex items-center justify-between gap-6">
          <button type="button" className="btn min-h-14 min-w-28 gap-2 border-warn text-lg font-bold text-warn" onClick={() => { setAnnounce(t(S.del)); remove(sel) }}><span aria-hidden="true">✕</span>{t(S.del)}</button>
          <button type="button" className="btn btn-primary min-h-14 min-w-28 gap-2 text-lg font-bold" onClick={() => { setAnnounce(t(S.ok)); setSel(null) }}><span aria-hidden="true">✓</span>{t(S.ok)}</button>
        </div>
      )}
    </div>
  )
}

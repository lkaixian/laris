import { useCallback, useEffect, useRef, useState } from 'react'
import { imageUrl } from './api'
import { t, useLang } from './i18n'
import type { Text } from './i18n'

// Cut a product out of its picture. The photo reader's box is the first guess; the person redraws it with a rectangle, an "add" brush and a
// "remove" brush. The result is a PNG at the crop's own size, transparent outside the product. All drawing happens in the browser.
type Tool = 'box' | 'add' | 'remove'
const TOOLS: [Tool, Text][] = [
  ['box', { en: 'Box', ms: 'Kotak', zh: '方框', ta: 'பெட்டி' }],
  ['add', { en: 'Add brush', ms: 'Berus tambah', zh: '添加画笔', ta: 'சேர்க்கும் தூரிகை' }],
  ['remove', { en: 'Remove brush', ms: 'Berus buang', zh: '擦除画笔', ta: 'நீக்கும் தூரிகை' }],
]
const S = {
  loadFail: { en: 'Could not load the picture.', ms: 'Gambar tidak dapat dimuatkan.', zh: '无法加载图片。', ta: 'படத்தை ஏற்ற முடியவில்லை.' },
  pngFail: { en: 'This browser could not make the PNG.', ms: 'Pelayar ini tidak dapat menghasilkan PNG.', zh: '此浏览器无法生成 PNG。', ta: 'இந்த உலாவியால் PNG உருவாக்க முடியவில்லை.' },
  saveFail: { en: 'Could not save the cut-out.', ms: 'Keratan tidak dapat disimpan.', zh: '无法保存抠图。', ta: 'வெட்டுப்படத்தைச் சேமிக்க முடியவில்லை.' },
  removeFail: { en: 'Could not remove the cut-out.', ms: 'Keratan tidak dapat dibuang.', zh: '无法移除抠图。', ta: 'வெட்டுப்படத்தை நீக்க முடியவில்லை.' },
} satisfies Record<string, Text>
const PAD = 0.06  // src/vision.py: the crop is the reader's box plus 6% padding, clamped to the photo

// The reader's box in the crop's own coordinates, as fractions.
export function boxInCrop([x0, y0, x1, y1]: number[]): [number, number, number, number] {
  const px = (x1 - x0) * PAD, py = (y1 - y0) * PAD
  const L = Math.max(0, x0 - px), T = Math.max(0, y0 - py), R = Math.min(1, x1 + px), B = Math.min(1, y1 + py)
  return [(x0 - L) / (R - L), (y0 - T) / (B - T), (x1 - L) / (R - L), (y1 - T) / (B - T)]
}

const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('image')); i.src = src })
const canvasOf = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h })

export function MaskEditor({ cropUrl, cutoutUrl, bbox, onSave, onRemove, onClose }: {
  cropUrl: string; cutoutUrl: string | null; bbox: number[]
  onSave: (png: Blob) => Promise<void>; onRemove?: () => Promise<void>; onClose: () => void
}) {
  useLang()
  const view = useRef<HTMLCanvasElement>(null)
  const img = useRef<HTMLImageElement | undefined>(undefined)
  const mask = useRef<HTMLCanvasElement | undefined>(undefined)  // opaque = keep, transparent = remove
  const undo = useRef<ImageData[]>([])
  const drag = useRef<{ x: number; y: number; px: number; py: number } | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const [tool, setTool] = useState<Tool>('add')
  const [size, setSize] = useState(24)
  const [ghost, setGhost] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [steps, setSteps] = useState(0)

  const draw = useCallback((preview?: [number, number, number, number]) => {
    const c = view.current, im = img.current, m = mask.current
    if (!c || !im || !m) return
    const x = c.getContext('2d')!
    x.clearRect(0, 0, c.width, c.height)
    const tile = canvasOf(16, 16), t = tile.getContext('2d')!  // checkerboard: what transparent will look like
    t.fillStyle = '#c9c9c9'; t.fillRect(0, 0, 16, 16); t.fillStyle = '#ececec'; t.fillRect(0, 0, 8, 8); t.fillRect(8, 8, 8, 8)
    x.fillStyle = x.createPattern(tile, 'repeat')!; x.fillRect(0, 0, c.width, c.height)
    if (ghost) { x.globalAlpha = 0.3; x.drawImage(im, 0, 0); x.globalAlpha = 1 }  // the removed part, faintly, so it can be redrawn
    const keep = canvasOf(c.width, c.height), k = keep.getContext('2d')!
    k.drawImage(im, 0, 0); k.globalCompositeOperation = 'destination-in'; k.drawImage(m, 0, 0)
    x.drawImage(keep, 0, 0)
    if (preview) {
      const [a, b, p, q] = preview
      x.strokeStyle = '#0f5c47'; x.lineWidth = 3; x.setLineDash([8, 6]); x.strokeRect(a, b, p - a, q - b); x.setLineDash([])
    }
  }, [ghost])

  const rect = (fr: [number, number, number, number]) => {
    const m = mask.current!, k = m.getContext('2d')!
    k.clearRect(0, 0, m.width, m.height); k.fillStyle = '#000'
    k.fillRect(fr[0] * m.width, fr[1] * m.height, (fr[2] - fr[0]) * m.width, (fr[3] - fr[1]) * m.height)
  }
  const remember = () => {
    const m = mask.current!
    undo.current.push(m.getContext('2d')!.getImageData(0, 0, m.width, m.height))
    if (undo.current.length > 20) undo.current.shift()
    setSteps(undo.current.length)
  }
  const reset = (fr: [number, number, number, number]) => { remember(); rect(fr); draw() }

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const im = await load(await imageUrl(cropUrl))
        if (!live) return
        img.current = im
        const m = canvasOf(im.naturalWidth, im.naturalHeight)
        if (cutoutUrl) m.getContext('2d')!.drawImage(await load(await imageUrl(cutoutUrl)), 0, 0, m.width, m.height)  // redraw starts from the saved cut-out
        mask.current = m
        if (!cutoutUrl) rect(boxInCrop(bbox))
        const c = view.current!; c.width = im.naturalWidth; c.height = im.naturalHeight
        setReady(true)
      } catch { if (live) setErr(t(S.loadFail)) }
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropUrl, cutoutUrl])
  useEffect(() => { if (ready) draw() }, [ready, draw])

  const at = (e: React.PointerEvent) => {
    const c = view.current!, r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height }
  }
  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const k = mask.current!.getContext('2d')!
    k.globalCompositeOperation = tool === 'remove' ? 'destination-out' : 'source-over'
    k.strokeStyle = k.fillStyle = '#000'; k.lineWidth = size; k.lineCap = k.lineJoin = 'round'
    k.beginPath(); k.moveTo(from.x, from.y); k.lineTo(to.x, to.y); k.stroke()
    k.globalCompositeOperation = 'source-over'
  }
  const down = (e: React.PointerEvent) => {
    if (!ready) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = at(e)
    remember()
    drag.current = { ...p, px: p.x, py: p.y }
    if (tool !== 'box') { stroke(p, p); draw() }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = at(e)
    if (tool === 'box') draw([Math.min(d.x, p.x), Math.min(d.y, p.y), Math.max(d.x, p.x), Math.max(d.y, p.y)])
    else { stroke({ x: d.px, y: d.py }, p); d.px = p.x; d.py = p.y; draw() }
  }
  const up = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = undefined
    if (!d) return
    if (tool === 'box') {
      const p = at(e), c = view.current!
      const fr: [number, number, number, number] = [Math.min(d.x, p.x) / c.width, Math.min(d.y, p.y) / c.height, Math.max(d.x, p.x) / c.width, Math.max(d.y, p.y) / c.height]
      if (fr[2] - fr[0] > 0.01 && fr[3] - fr[1] > 0.01) rect(fr); else { undo.current.pop(); setSteps(undo.current.length) }  // a click without a drag is not a box
      draw()
    }
  }
  const back = () => {
    const last = undo.current.pop()
    if (last) { mask.current!.getContext('2d')!.putImageData(last, 0, 0); setSteps(undo.current.length); draw() }
  }

  const save = async () => {
    const im = img.current, m = mask.current
    if (!im || !m || busy) return
    setBusy(true); setErr('')
    try {
      const out = canvasOf(im.naturalWidth, im.naturalHeight), o = out.getContext('2d')!
      o.drawImage(im, 0, 0); o.globalCompositeOperation = 'destination-in'; o.drawImage(m, 0, 0)
      const blob = await new Promise<Blob | null>(ok => { try { out.toBlob(ok, 'image/png') } catch { ok(null) } })
      if (!blob) throw new Error(t(S.pngFail))
      await onSave(blob)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save the cut-out.') } finally { setBusy(false) }
  }

  return (
    <div className="mt-3 grid gap-3 border-t border-hairline pt-3" role="group" aria-label={t({ en: 'Cut out the product', ms: 'Keratkan produk', zh: '抠出产品', ta: 'பொருளை வெட்டி எடு' })}>
      <p className="text-sm text-muted">{(() => {
        const [bx, ad, rm] = [TOOLS[0], TOOLS[1], TOOLS[2]].map(x => t(x[1]))
        return t({
          en: `The dashed start is the box the photo reader found. Draw with ${ad} to keep more, ${rm} to make parts transparent, or drag a new ${bx}. Drawing needs a mouse or touch; the buttons below also work from the keyboard.`,
          ms: `Kotak putus-putus ialah kotak yang ditemui pembaca foto. Lukis dengan ${ad} untuk simpan lebih banyak, ${rm} untuk jadikan bahagian lutsinar, atau seret ${bx} baharu. Melukis memerlukan tetikus atau sentuhan; butang di bawah juga berfungsi dengan papan kekunci.`,
          zh: `虚线框是照片识别器找到的方框。用“${ad}”保留更多，用“${rm}”让部分变透明，或拖出新的“${bx}”。绘制需要鼠标或触摸；下方按钮也可用键盘操作。`,
          ta: `புள்ளிக்கோட்டுப் பெட்டி புகைப்பட வாசிப்பான் கண்டறிந்த பெட்டி. அதிகம் வைத்திருக்க "${ad}", பகுதிகளை ஒளி ஊடுருவச் செய்ய "${rm}" பயன்படுத்தவும், அல்லது புதிய "${bx}" இழுக்கவும். வரைய சுட்டி அல்லது தொடுதல் தேவை; கீழுள்ள பொத்தான்கள் விசைப்பலகையிலும் செயல்படும்.`,
        })
      })()}</p>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t({ en: 'Tool', ms: 'Alat', zh: '工具', ta: 'கருவி' })} className="flex flex-wrap gap-2">
          {TOOLS.map(([k, name]) => <button key={k} type="button" className="btn aria-pressed:bg-tint aria-pressed:font-bold" aria-pressed={tool === k} onClick={() => setTool(k)}>{t(name)}</button>)}
        </div>
        <label className="flex items-center gap-2 text-sm">{t({ en: 'Brush size', ms: 'Saiz berus', zh: '画笔大小', ta: 'தூரிகை அளவு' })}
          <input type="range" min={4} max={80} value={size} onChange={e => setSize(Number(e.target.value))} disabled={tool === 'box'} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ghost} onChange={e => setGhost(e.target.checked)} /> {t({ en: 'Show removed part faintly', ms: 'Tunjuk bahagian dibuang secara samar', zh: '淡淡显示已移除的部分', ta: 'நீக்கிய பகுதியை மங்கலாகக் காட்டு' })}</label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={!steps} onClick={back}>{t({ en: 'Undo', ms: 'Buat asal', zh: '撤销', ta: 'செயல்தவிர்' })}</button>
        <button type="button" className="btn" disabled={!ready} onClick={() => reset(boxInCrop(bbox))}>{t({ en: "Back to the reader's box", ms: 'Kembali ke kotak pembaca', zh: '恢复识别器的方框', ta: 'வாசிப்பான் பெட்டிக்குத் திரும்பு' })}</button>
        <button type="button" className="btn" disabled={!ready} onClick={() => reset([0, 0, 1, 1])}>{t({ en: 'Keep everything', ms: 'Simpan semuanya', zh: '全部保留', ta: 'அனைத்தையும் வைத்திரு' })}</button>
      </div>
      <div className="overflow-auto rounded-ui border border-soft">
        <canvas ref={view} className="block h-auto max-w-full touch-none" style={{ cursor: 'crosshair' }} aria-label={t({ en: 'Product picture. Drawing area for the cut-out.', ms: 'Gambar produk. Kawasan lukisan untuk keratan.', zh: '产品图片。抠图的绘制区域。', ta: 'பொருள் படம். வெட்டுப்படத்திற்கான வரைபகுதி.' })}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        {!ready && !err && <p role="status" className="p-3 text-sm text-muted">{t({ en: 'Loading the picture...', ms: 'Memuatkan gambar...', zh: '正在加载图片...', ta: 'படம் ஏற்றப்படுகிறது...' })}</p>}
      </div>
      {err && <p role="alert" className="text-sm text-warn">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" aria-disabled={busy || !ready || undefined} onClick={save}>{busy ? t({ en: 'Saving...', ms: 'Menyimpan...', zh: '正在保存...', ta: 'சேமிக்கிறது...' }) : t({ en: 'Save cut-out', ms: 'Simpan keratan', zh: '保存抠图', ta: 'வெட்டுப்படத்தைச் சேமி' })}</button>
        {cutoutUrl && onRemove && <button type="button" className="btn" aria-disabled={busy || undefined} onClick={async () => { if (busy) return; setBusy(true); try { await onRemove() } catch { setErr(t(S.removeFail)) } finally { setBusy(false) } }}>{t({ en: 'Remove cut-out', ms: 'Buang keratan', zh: '移除抠图', ta: 'வெட்டுப்படத்தை நீக்கு' })}</button>}
        <button type="button" className="btn" onClick={onClose}>{t({ en: 'Close', ms: 'Tutup', zh: '关闭', ta: 'மூடு' })}</button>
      </div>
    </div>
  )
}

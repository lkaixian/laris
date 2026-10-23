import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { api, imageUrl } from './api'
import { rm, useFetch, useAction, ActionError, Async, Hint, PageHeader, TableRegion } from './ui'

// "Ask suppliers": photograph an item, circle it, ask suppliers on WhatsApp how much. Contract: docs/api-contract.md (RFQ).
interface Supplier { id: string; name: string; contact: string | null }
interface Tier { min_qty: string; unit_price: string }
interface Reply {
  reply_id: string; send_id: string; supplier_id: string; supplier_name: string; text: string
  unit_price: string | null; min_qty: string | null; tiers: Tier[]; status: 'waiting' | 'needs_review' | 'ready' | 'accepted'
}
interface Rfq { id: string; description: string; note: string; created_at: string; image_url: string; replies: Reply[] }
interface SendResult { rfq_id: string; sends: { supplier_id: string; status: 'sent' | 'failed'; error: string | null }[] }
// Circle is normalized: x and y are fractions of the width and height, r is a fraction of the width.
interface Circle { x: number; y: number; r: number }

const DEFAULT_NOTE = 'How much for the circled one? Any MOQ or bulk price?'
const MAX_SIDE = 1600
const RING_PX = 4
const STEP = 0.02
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function AskForm({ onSent }: { onSent: () => void }) {
  const sup = useFetch<Supplier[]>('/contacts?role=supplier')
  const [img, setImg] = useState<HTMLImageElement>()
  const [circle, setCircle] = useState<Circle>()
  const [desc, setDesc] = useState('')
  const [note, setNote] = useState(DEFAULT_NOTE)
  const [picked, setPicked] = useState<string[]>([])
  const [formErr, setFormErr] = useState('')
  const [skipNote, setSkipNote] = useState('')
  const [res, setRes] = useState<SendResult>()
  const canvas = useRef<HTMLCanvasElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const dragging = useRef(false)
  const out = useRef<HTMLDivElement>(null)
  const descBox = useRef<HTMLInputElement>(null)
  const a = useAction()
  useEffect(() => { if (res) out.current?.focus() }, [res])

  // Draw the photo (long side capped at MAX_SIDE) and the ring. The canvas is also the upload image, ring included.
  useEffect(() => {
    const c = canvas.current
    if (!c || !img) return
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k)
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0, w, h)
    if (circle) {
      g.beginPath(); g.arc(circle.x * w, circle.y * h, circle.r * w, 0, Math.PI * 2)
      g.strokeStyle = '#e00000'; g.lineWidth = RING_PX; g.stroke()
    }
  }, [img, circle])

  const choose = (f?: File) => {
    setCircle(undefined); setSkipNote(''); setRes(undefined)
    if (!f) return setImg(undefined)
    const url = URL.createObjectURL(f)
    const i = new Image()
    i.onload = () => { setImg(i); URL.revokeObjectURL(url) }
    i.onerror = () => { setImg(undefined); setFormErr('That file could not be read as a photo. Choose another one.'); URL.revokeObjectURL(url) }
    i.src = url
  }

  const at = (e: PointerEvent<HTMLCanvasElement>) => {
    const b = e.currentTarget.getBoundingClientRect()
    return { x: clamp((e.clientX - b.left) / b.width, 0, 1), y: clamp((e.clientY - b.top) / b.height, 0, 1), w: b.width }
  }
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId); dragging.current = true; setSkipNote('')
    const p = at(e); setCircle({ x: p.x, y: p.y, r: 0.01 })
  }
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!dragging.current || !circle) return
    const b = e.currentTarget.getBoundingClientRect()
    const r = Math.hypot(e.clientX - b.left - circle.x * b.width, e.clientY - b.top - circle.y * b.height) / b.width
    setCircle({ ...circle, r: clamp(r, 0.01, 1) })
  }
  const up = () => { dragging.current = false }

  // Keyboard path: the first press creates a ring in the middle, later presses move or resize it.
  const nudge = (dx: number, dy: number, dr: number) => {
    setSkipNote('')
    const c = circle ?? { x: 0.5, y: 0.5, r: 0.15 }
    setCircle({ x: clamp(c.x + dx, 0, 1), y: clamp(c.y + dy, 0, 1), r: clamp(c.r + dr, 0.01, 1) })
  }

  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))

  const submit = () => {
    if (!img || !canvas.current) return setFormErr('Choose a photo of the item first.')
    if (!desc.trim()) return setFormErr('Describe the item in a few words.')
    if (!picked.length) return setFormErr('Choose at least one supplier to ask.')
    setFormErr('')
    a.run(async () => {
      const blob = await new Promise<Blob | null>(r => canvas.current!.toBlob(r, 'image/jpeg', 0.85))
      if (!blob) throw new Error('The photo could not be prepared for sending.')
      const fd = new FormData()
      fd.append('image', new File([blob], 'item.jpg', { type: 'image/jpeg' }))
      fd.append('description', desc.trim())
      fd.append('note', note.trim())
      if (circle) fd.append('circle', JSON.stringify({ x: +circle.x.toFixed(4), y: +circle.y.toFixed(4), r: +circle.r.toFixed(4) }))
      picked.forEach(id => fd.append('supplier_ids', id))
      setRes(await api<SendResult>('POST', '/rfq', fd))
      setImg(undefined); setCircle(undefined); setDesc(''); setNote(DEFAULT_NOTE); setPicked([]); if (file.current) file.current.value = ''
      onSent()
    })
  }

  const nameOf = (id: string) => sup.data?.find(s => s.id === id)?.name ?? 'Supplier'
  return (
    <section aria-labelledby="ask-form">
      <h2 id="ask-form" className="mb-2 text-lg font-semibold">Ask for a price</h2>
      <form className="grid max-w-2xl gap-4" onSubmit={e => { e.preventDefault(); submit() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">Photo of the item (take one or choose from the gallery)
          <input id="ask-photo" ref={file} type="file" accept="image/*" capture="environment" className="input py-2 font-normal" onChange={e => choose(e.target.files?.[0])} />
        </label>

        {img && (
          <div className="grid gap-2">
            <p id="ring-help" className="text-sm">Circle the item: drag on the photo from the centre outwards, or use the buttons below. A circle is optional.</p>
            <canvas ref={canvas} role="img" aria-label={circle ? 'Photo of the item with a red circle drawn on it' : 'Photo of the item, no circle drawn'} aria-describedby="ring-help"
              className="h-auto max-w-full touch-none cursor-crosshair rounded-ui border border-line" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
            <div role="group" aria-label="Circle controls" className="flex flex-wrap gap-2">
              <button type="button" className="btn" onClick={() => nudge(-STEP, 0, 0)}>Move circle left</button>
              <button type="button" className="btn" onClick={() => nudge(STEP, 0, 0)}>Move circle right</button>
              <button type="button" className="btn" onClick={() => nudge(0, -STEP, 0)}>Move circle up</button>
              <button type="button" className="btn" onClick={() => nudge(0, STEP, 0)}>Move circle down</button>
              <button type="button" className="btn" onClick={() => nudge(0, 0, -STEP)}>Smaller circle</button>
              <button type="button" className="btn" onClick={() => nudge(0, 0, STEP)}>Bigger circle</button>
              <button type="button" className="btn" onClick={() => { setCircle(undefined); setSkipNote('Circle removed.') }}>Clear circle</button>
              <button type="button" className="btn" onClick={() => { setCircle(undefined); setSkipNote('No circle: the photo goes as it is.'); descBox.current?.focus() }}>Skip, no circle</button>
            </div>
            <p role="status" className="text-sm text-muted">{skipNote}</p>
          </div>
        )}

        <label className="flex flex-col gap-1 text-sm font-semibold">What is it? (required, up to 200 characters)
          <input ref={descBox} className="input font-normal" maxLength={200} placeholder="ballet flat, cream, strap" value={desc} onChange={e => setDesc(e.target.value)} />
        </label>

        <fieldset className="min-w-0">
          <legend className="mb-1 text-sm font-semibold">Which suppliers to ask? (choose at least one)</legend>
          <Async s={sup} rows={3} empty={!sup.data?.length} emptyText="No suppliers yet." emptyHint="Add the suppliers you want to ask under Contacts first." emptyAction={{ label: 'Add a supplier', href: '#/contacts/new' }}>
            <ul className="grid gap-1">
              {sup.data?.map(s => (
                <li key={s.id}>
                  <label className="flex min-h-11 items-center gap-3 rounded-ui border border-soft bg-surface px-3 text-sm">
                    <input type="checkbox" className="size-5 shrink-0" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
                    <span className="min-w-0 break-words"><span className="font-semibold">{s.name}</span> <span className="text-muted">{s.contact ?? 'no WhatsApp number'}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          </Async>
        </fieldset>

        <label className="flex flex-col gap-1 text-sm font-semibold">Message to the suppliers (optional, you can edit it, up to 300 characters)
          <textarea className="input min-h-20 py-2 font-normal" maxLength={300} value={note} onChange={e => setNote(e.target.value)} />
        </label>

        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        <div><button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? 'Sending...' : 'Send on WhatsApp'}</button></div>
      </form>
      <ActionError err={a.err} onRetry={submit} label="Retry sending" />
      {res && (
        <div ref={out} tabIndex={-1} className="card mt-3 max-w-2xl" aria-labelledby="ask-res">
          <h3 id="ask-res" className="font-semibold">Result</h3>
          <ul className="mt-1 grid gap-1 text-sm">
            {res.sends.map(s => (
              <li key={s.supplier_id}>
                <span className="font-semibold">{nameOf(s.supplier_id)}</span>: {s.status === 'sent' ? 'sent' : <span className="text-warn">not sent. {s.error ?? 'No reason was given.'}</span>}
              </li>
            ))}
          </ul>
          {res.sends.some(s => s.status === 'failed') && <p className="mt-2 text-sm text-muted">Nothing was lost. You can send this again from a new request, or call the supplier.</p>}
        </div>
      )}
    </section>
  )
}

// The image endpoint needs the identity headers, so a plain <img src> will not do: fetch it as a blob.
function Photo({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let live = true, made = ''
    imageUrl(url).then(u => { made = u; if (live) setSrc(u); else if (u.startsWith('blob:')) URL.revokeObjectURL(u) }, () => undefined)
    return () => { live = false; if (made.startsWith('blob:')) URL.revokeObjectURL(made) }
  }, [url])
  return src ? <img src={src} alt={alt} className="max-h-40 max-w-full rounded-ui border border-soft object-contain" /> : null
}

function AcceptCell({ rfq, r, onDone }: { rfq: string; r: Reply; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [formErr, setFormErr] = useState('')
  const a = useAction()
  const id = `acc-${r.reply_id}`
  const submit = () => {
    if (!key.trim()) return setFormErr('Enter the item key this price is for.')
    setFormErr('')
    a.run(async () => { await api('POST', `/rfq/${rfq}/replies/${r.reply_id}/accept`, { item_key: key.trim() }); setOpen(false); onDone() })
  }
  if (r.status === 'accepted') return <span className="badge">Accepted</span>
  if (r.status === 'waiting') return <span className="text-muted">Nothing to accept yet</span>
  return (
    <>
      <button type="button" className="btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>Accept {r.supplier_name}</button>
      {open && (
        <form id={id} className="mt-2 grid gap-2" onSubmit={e => { e.preventDefault(); submit() }}>
          <label className="flex flex-col gap-1 text-sm font-semibold">Item key for {r.supplier_name}
            <input className="input w-48 font-normal" aria-describedby={`${id}-help`} value={key} onChange={e => setKey(e.target.value)} autoFocus />
            <Hint id={`${id}-help`}>A short code for this item in your cost book, like acrylic_3mm_sheet.</Hint>
          </label>
          {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
          <div><button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? 'Saving...' : `Confirm accept for ${r.supplier_name}`}</button></div>
          <ActionError err={a.err} onRetry={submit} label="Retry accepting" />
        </form>
      )}
    </>
  )
}

function Comparison({ q, onDone }: { q: Rfq; onDone: () => void }) {
  const prices = q.replies.filter(r => r.unit_price !== null).map(r => Number(r.unit_price))
  const best = prices.length > 1 ? Math.min(...prices) : undefined
  return (
    <div className="mt-2"><TableRegion label={`Replies for ${q.description}`}>
      <table className="w-full min-w-max">
        <caption className="sr-only">Supplier replies for {q.description}</caption>
        <thead><tr><th scope="col">Supplier</th><th scope="col">Price</th><th scope="col"><abbr title="Minimum order quantity">MOQ</abbr></th><th scope="col">Price breaks</th><th scope="col">Their reply</th><th scope="col">Action</th></tr></thead>
        <tbody>
          {q.replies.map(r => {
            const cheapest = best !== undefined && r.unit_price !== null && Number(r.unit_price) === best
            return (
              <tr key={r.reply_id} className={cheapest ? 'bg-tint' : undefined}>
                <th scope="row" className="text-sm font-semibold text-ink">{r.supplier_name}</th>
                <td className={cheapest ? 'font-bold' : undefined}>{r.unit_price !== null ? rm(r.unit_price) : <span className="text-muted">{r.status === 'waiting' ? 'Waiting' : 'Not read'}</span>}{cheapest && <span className="badge ml-2">Cheapest</span>}</td>
                <td>{r.min_qty ?? <span className="text-muted">None</span>}</td>
                <td>{r.tiers.length ? <ul>{r.tiers.map(t => <li key={t.min_qty}>{t.min_qty}+ at {rm(t.unit_price)}</li>)}</ul> : <span className="text-muted">None</span>}</td>
                <td className="max-w-xs whitespace-normal">{r.text || <span className="text-muted">No reply yet</span>}</td>
                <td><AcceptCell rfq={q.id} r={r} onDone={onDone} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </TableRegion>
    <p className="mt-1 text-xs text-muted">MOQ is the least the supplier will sell. Price breaks are cheaper unit prices at higher quantities.</p></div>
  )
}

function Replies({ owner, s }: { owner: boolean; s: ReturnType<typeof useFetch<Rfq[]>> }) {
  return (
    <section className="mt-10 border-t border-soft pt-6" aria-labelledby="ask-replies">
      <h2 id="ask-replies" className="mb-2 text-lg font-semibold">Replies</h2>
      <Async s={s} rows={2} shape="cards" empty={!s.data?.length} emptyText="No price requests yet." emptyHint="Photograph an item above and ask your suppliers how much it costs. Their replies are compared here."
        emptyAction={{ label: 'Ask suppliers for a price', onClick: () => { const f = document.getElementById('ask-photo'); f?.scrollIntoView({ block: 'center' }); f?.focus() } }}>
        <ul className="grid gap-4">
          {s.data?.map(q => (
            <li key={q.id} className="card min-w-0">
              <div className="flex flex-wrap items-start gap-4">
                <Photo url={q.image_url} alt={`Photo of ${q.description}`} />
                <div className="min-w-0 flex-1 basis-56">
                  <h3 className="font-semibold">{q.description}</h3>
                  <p className="text-sm text-muted">Asked <time dateTime={q.created_at}>{new Date(q.created_at).toLocaleString()}</time>: {q.note}</p>
                </div>
              </div>
              {owner ? <Comparison q={q} onDone={s.reload} /> : (
                <ul className="mt-2 grid gap-1 text-sm">
                  {q.replies.map(r => <li key={r.reply_id}><span className="font-semibold">{r.supplier_name}</span>: <span className="badge">{r.status === 'waiting' ? 'waiting' : 'replied'}</span></li>)}
                </ul>
              )}
              {!owner && <p className="mt-2 text-xs text-muted">Prices are shown to the owner only.</p>}
              {owner && q.replies.length === 0 && <p className="mt-2 text-sm text-muted">No suppliers were asked.</p>}
            </li>
          ))}
        </ul>
      </Async>
    </section>
  )
}

export function AskView({ owner }: { owner: boolean }) {
  const s = useFetch<Rfq[]>('/rfq')
  return (
    <>
      <PageHeader title="Ask suppliers" description={`Photograph an item, circle it, and ask suppliers on WhatsApp how much it costs. ${owner ? 'Their replies are compared below.' : 'The owner sees the prices; you see who has replied.'}`} />
      <AskForm onSent={s.reload} />
      <Replies owner={owner} s={s} />
    </>
  )
}

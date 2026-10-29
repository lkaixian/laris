import { useEffect, useRef, useState } from 'react'
import { api, ApiError, blobUrl, can, download, MOCK, why } from './api'
import { msg, rm, useFetch } from './ui'
import { Icon } from './icons'
import { useToast } from './Toast'
import type { DocDetail } from './api'

// Quote document: preview (rendered from the JSON model, never an embedded PDF: the CSP has object-src 'none' and no frame-src for blob:),
// export menu and send dialog. Works for outgoing documents only (the preview route answers 404 for incoming ones).
interface PLine { no: number; description: string; qty: string | null; uom: string; unit_price: string | null; discount_pct: string | null; amount: string | null; is_header: boolean; section: string | null }
interface PChannel { channel: string; to_hint: string | null; available: boolean; reason?: string }
export interface Preview {
  doc_no: string | null; status: string
  customer: { name: string; attention: string | null; address: string | null; email: string | null }
  issued_on: string | null; valid_until: string | null; currency: string; lines: PLine[]
  subtotal: string | null; tax_total: string | null; total: string | null; payment_terms: string | null; terms_text: string | null
  issuer: { name: string; address: string | null; ssm_no: string | null; sst_no: string | null; email: string | null; phone: string | null; logo_url: string | null; brand_color: string | null; bank_details: string | null }
  channels: PChannel[]
}

const CHAN: Record<string, string> = { email: 'Email', whatsapp: 'WhatsApp', telegram: 'Telegram' }
// Unknown channels are shown as written, capitalised, never a crash.
export const chanLabel = (c: unknown) => { const k = String(c ?? ''); return CHAN[k] ?? (k ? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ') : 'Unknown channel') }
const REASON: Record<string, string> = { no_email: 'No email on file for this customer', no_contact: 'No chat contact on file' }
const linkFail = (e: unknown) => e instanceof ApiError && e.status === 409 && e.code === 'public_url_missing' ? 'Set APP_PUBLIC_URL in the server settings first.'
  : e instanceof ApiError && e.status === 409 && e.code === 'not_linkable' ? 'This quote cannot be shared yet. Approve it first, then try again.' : msg(e)
const num = (s: string | null) => (s == null ? '' : Number(s).toLocaleString('en-MY', { maximumFractionDigits: 4 }))
const date = (s: string | null) => s ?? 'Not set'
// Readable text colour on the brand colour (same rule as applyBrand in ui.tsx). Only a strict #rrggbb is ever used.
function onColour(hex: string | null): { bg: string; fg: string } {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return { bg: '#0f5c47', fg: '#ffffff' }
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  const lin = (v: number) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  return { bg: hex, fg: 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.179 ? '#06140f' : '#ffffff' }
}

// The paper: always white with dark text (like the printed quote), whatever the app theme.
export function QuotePaper({ p }: { p: Preview }) {
  const { bg, fg } = onColour(p.issuer.brand_color)
  const disc = p.lines.some(l => !l.is_header && l.discount_pct != null && Number(l.discount_pct) !== 0)
  const i = p.issuer
  const sub = 'text-[#475a50]'
  const th = { backgroundColor: bg, color: fg }
  return (
    <article aria-label={`Quotation ${p.doc_no ?? ''}`} className="mx-auto min-w-0 max-w-[860px] rounded-card border border-hairline bg-white p-4 text-[#16231d] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 basis-60">
          {i.logo_url?.startsWith('data:image/') && <img src={i.logo_url} alt={i.name} className="mb-2 max-h-16 max-w-48 object-contain" />}
          <p className="break-words text-base font-semibold">{i.name}</p>
          <div className={`text-sm ${sub}`}>
            {i.address && <p className="whitespace-pre-line break-words">{i.address}</p>}
            {i.phone && <p>Tel: {i.phone}</p>}
            {i.email && <p className="break-all">{i.email}</p>}
            {i.ssm_no && <p>SSM: {i.ssm_no}</p>}
            {i.sst_no && <p>SST: {i.sst_no}</p>}
          </div>
        </div>
        <div className="min-w-0 text-left sm:text-right">
          <h3 className="text-xl font-semibold">Quotation {p.doc_no}</h3>
          <dl className="mt-1 grid grid-cols-[auto_auto] justify-start gap-x-3 text-sm sm:justify-end">
            <dt className={sub}>Issued</dt><dd>{date(p.issued_on)}</dd>
            <dt className={sub}>Valid until</dt><dd>{date(p.valid_until)}</dd>
          </dl>
        </div>
      </div>

      <div className="mt-4 text-sm">
        <p className={`text-xs font-semibold uppercase tracking-wide ${sub}`}>Prepared for</p>
        <p className="font-semibold">{p.customer.name}</p>
        {p.customer.attention && <p>Attn: {p.customer.attention}</p>}
        {p.customer.address && <p className="whitespace-pre-line break-words">{p.customer.address}</p>}
        {p.customer.email && <p className="break-all">{p.customer.email}</p>}
      </div>

      <div className="mt-4 max-w-full overflow-x-auto rounded-ui border border-[#dce7e0]" role="region" aria-label="Quote lines" tabIndex={0}>
        <table className="w-full min-w-[34rem]">
          <caption className="sr-only">Lines of quotation {p.doc_no}</caption>
          <thead><tr>
            <th scope="col" style={th}>No.</th><th scope="col" style={th}>Description</th>
            <th scope="col" className="text-right" style={th}>Qty</th><th scope="col" style={th}>Unit</th>
            <th scope="col" className="text-right" style={th}>Unit price</th>
            {disc && <th scope="col" className="text-right" style={th}>Discount</th>}
            <th scope="col" className="text-right" style={th}>Amount ({p.currency})</th>
          </tr></thead>
          <tbody>{p.lines.map(l => l.is_header
            ? <tr key={l.no} className="!border-[#dce7e0] bg-[#e1f0e8]"><th scope="colgroup" colSpan={disc ? 7 : 6} className="!text-[#16231d] text-sm">{l.section || l.description}</th></tr>
            : <tr key={l.no} className="!border-[#dce7e0]">
                <td>{l.no}</td><td className="min-w-40 break-words">{l.description}</td>
                <td className="num">{num(l.qty)}</td><td>{l.uom}</td>
                <td className="num whitespace-nowrap">{l.unit_price == null ? '' : rm(l.unit_price)}</td>
                {disc && <td className="text-right">{l.discount_pct != null && Number(l.discount_pct) !== 0 ? `${num(l.discount_pct)}%` : ''}</td>}
                <td className="num whitespace-nowrap">{l.amount == null ? '' : rm(l.amount)}</td>
              </tr>)}</tbody>
        </table>
      </div>

      <dl className="mt-3 ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-[#dce7e0] pt-2 text-sm">
        <dt className={sub}>Subtotal</dt><dd className="text-right">{rm(p.subtotal)}</dd>
        {p.tax_total != null && <><dt className={sub}>SST</dt><dd className="text-right">{rm(p.tax_total)}</dd></>}
        <dt className="font-semibold">Total</dt><dd className="text-right text-base font-semibold">{rm(p.total)}</dd>
      </dl>

      {p.payment_terms && <div className="mt-4 text-sm"><h4 className="font-semibold">Payment terms</h4><p className="whitespace-pre-line break-words">{p.payment_terms}</p></div>}
      {p.terms_text && <div className="mt-3 text-sm"><h4 className="font-semibold">Terms and conditions</h4><p className="whitespace-pre-line break-words">{p.terms_text}</p></div>}
      {i.bank_details && <div className="mt-3 text-sm"><h4 className="font-semibold">Bank details</h4><p className="whitespace-pre-line break-words">{i.bank_details}</p></div>}
    </article>
  )
}

// Messages sent to or received from the customer. Email shows as Email; an unknown channel is shown as written.
export function Messages({ list }: { list: DocDetail['messages'] }) {
  if (!list?.length) return null
  return (
    <section className="mt-6" aria-labelledby="msgs">
      <h2 id="msgs" className="mb-2 text-md font-semibold">Messages</h2>
      <ul className="grid gap-2">
        {list.map((m, n) => (
          <li key={n} className="card text-sm">
            <p className="text-muted">{m.direction === 'out' ? 'Sent' : 'Received'} by {chanLabel(m.channel)}{m.at ? ` on ${new Date(m.at).toLocaleString('en-MY')}` : ''}</p>
            <p className="mt-1 whitespace-pre-line break-words">{m.body}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

const EXPORTS: { label: string; format: string; variant: 'customer' | 'internal'; ext: string }[] = [
  { label: 'PDF', format: 'pdf', variant: 'customer', ext: 'pdf' }, { label: 'Excel (.xlsx)', format: 'xlsx', variant: 'customer', ext: 'xlsx' }, { label: 'CSV', format: 'csv', variant: 'customer', ext: 'csv' },
  { label: 'Excel (.xlsx)', format: 'xlsx', variant: 'internal', ext: 'xlsx' }, { label: 'CSV', format: 'csv', variant: 'internal', ext: 'csv' },
]

export function QuotePanel({ id, status, owner, onChanged }: { id: string; status: string; owner: boolean; onChanged: () => void }) {
  const pv = useFetch<Preview>(`/documents/${id}/preview`)
  const toast = useToast()
  const [open, setOpen] = useState(status === 'draft' || status === 'approved')
  const [menu, setMenu] = useState(false)
  const [pending, setPending] = useState('')
  const [send, setSend] = useState(false)
  const [lk, setLk] = useState<{ url: string; until: string }>()
  const [lkBusy, setLkBusy] = useState(false)
  const [lkMsg, setLkMsg] = useState('')
  const lkField = useRef<HTMLInputElement>(null)
  const menuBtn = useRef<HTMLButtonElement>(null)
  const sendBtn = useRef<HTMLButtonElement>(null)
  const p = pv.data
  const internal = can('export_data') && can('view_costs')
  const docNo = p?.doc_no ?? 'quote'
  const run = async (key: string, f: () => Promise<void>) => {
    if (pending) return
    setPending(key)
    try { await f() } catch (e) { toast.error(msg(e)) } finally { setPending('') }
  }
  const exp = (x: (typeof EXPORTS)[number]) => run(x.variant + x.format, async () => {
    const name = `${docNo}${x.variant === 'internal' ? '-internal' : ''}.${x.ext}`
    await download(`/documents/${id}/export?format=${x.format}&variant=${x.variant}`, name); toast(`${name} downloaded.`)
  })
  // The window opens first (inside the click) so pop-up blockers allow it, then points at the PDF blob. Revoked after a minute.
  const openPdf = () => run('open', async () => {
    const w = window.open('', '_blank')
    if (!w) throw new Error('Your browser blocked the new tab. Allow pop-ups for this site, or use Export, PDF.')
    try { const u = await blobUrl(`/documents/${id}/export?format=pdf&variant=customer`); w.location.href = u; setTimeout(() => URL.revokeObjectURL(u), 60_000) }
    catch (e) { w.close(); throw e }
  })
  // Owner: make a fresh customer link (older ones stop) and copy it. If the browser refuses, the link sits in a selectable field.
  const copyLink = async () => {
    if (lkBusy) return
    setLkBusy(true); setLkMsg('')
    try {
      const r = await api<{ url: string; expires_at: string }>('POST', `/documents/${id}/accept-link`)
      const until = new Date(r.expires_at).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
      setLk({ url: r.url, until })
      try { await navigator.clipboard.writeText(r.url); toast(`Link copied. It works until ${until}.`) }
      catch { setLkMsg('Could not copy automatically. The link is selected below: press Ctrl+C.'); requestAnimationFrame(() => lkField.current?.select()) }
    } catch (e) { setLkMsg(linkFail(e)) } finally { setLkBusy(false) }
  }
  const keyClose = (e: React.KeyboardEvent) => { if (e.key === 'Escape' && menu) { e.stopPropagation(); setMenu(false); menuBtn.current?.focus() } }
  const sendable = ['approved', 'sent', 'read'].includes(status)
  const row = (v: 'customer' | 'internal') => EXPORTS.filter(x => x.variant === v).map(x => (
    <li key={x.variant + x.format}><button type="button" className="btn w-full justify-start" aria-disabled={!!pending || undefined} onClick={() => exp(x)}>
      {pending === x.variant + x.format ? 'Preparing...' : x.label}</button></li>))
  return (
    <section className="mb-6" aria-labelledby="qd">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="qd" className="text-md font-semibold">Quote document</h2>
        <div className="flex flex-wrap items-center gap-2" onKeyDown={keyClose}>
          {sendable && <button ref={sendBtn} type="button" className="btn btn-primary" aria-expanded={send} aria-controls="send-box"
            {...(owner ? { onClick: () => setSend(v => !v) } : { 'aria-disabled': true as const, title: why('decide_quotes'), 'data-locked': true as const })}>Send quote</button>}
          {sendable && owner && <button type="button" className="btn" aria-disabled={lkBusy || undefined} onClick={copyLink}>{lkBusy ? 'Making link...' : 'Copy customer link'}</button>}
          <button ref={menuBtn} type="button" className="btn" aria-expanded={menu} aria-controls="export-menu" onClick={() => setMenu(v => !v)}>Export<Icon name="down" className="ml-1 size-4" /></button>
          <button type="button" className="btn" aria-disabled={!!pending || undefined} onClick={openPdf}>{pending === 'open' ? 'Opening...' : 'Open PDF in a new tab'}</button>
        </div>
      </div>
      {sendable && !owner && <p className="mt-1 text-sm text-muted">Only the owner can send quotes.</p>}
      {sendable && owner && (lk || lkMsg) && (
        <div className="card mt-2 max-w-xl">
          {lk && <label className="flex flex-col gap-1 text-sm font-semibold">Customer link
            <input ref={lkField} readOnly className="input font-normal" value={lk.url} onFocus={e => e.currentTarget.select()} /></label>}
          {lk && <p className="mt-1 text-sm text-muted">Works until {lk.until}. Making a new link stops the older ones.</p>}
          <p role="status" className="mt-1 text-sm text-warn empty:hidden">{lkMsg}</p>
        </div>
      )}
      {sendable && owner && <p className="mt-1 text-sm text-muted">Copy customer link gives you a page where your customer can read this quote and accept it by typing their name. The signature is simulated, not a legal e-signature.</p>}
      {menu && (
        <div id="export-menu" className="card mt-2 grid max-w-xl gap-3 shadow-2 sm:grid-cols-2" onKeyDown={keyClose}>
          <div><h3 className="mb-1 text-sm font-semibold">Customer files</h3><ul className="grid gap-2">{row('customer')}</ul></div>
          {internal && <div><h3 className="mb-1 text-sm font-semibold">Internal (with cost and margin)</h3><ul className="grid gap-2">{row('internal')}</ul>
            <p className="mt-2 text-sm text-warn">Internal files show costs and margins. Do not send them to customers.</p></div>}
        </div>
      )}
      {send && p && <SendBox id={id} status={status} p={p} onClose={() => { setSend(false); sendBtn.current?.focus() }} onSent={() => { setSend(false); pv.reload(); onChanged() }} />}
      <div className="mt-3">
        <button type="button" className="btn" aria-expanded={open} aria-controls="quote-preview" onClick={() => setOpen(v => !v)}>{open ? 'Hide preview' : 'Show preview'}</button>
      </div>
      <div id="quote-preview" className="mt-3" hidden={!open}>
        {p && (
          <dl className="mb-3 grid grid-cols-2 gap-3 rounded-card border border-hairline bg-surface p-3 text-sm md:grid-cols-3">
            <div><dt className="text-muted">Customer</dt><dd className="font-semibold">{p.customer.name}</dd></div>
            <div><dt className="text-muted">Total</dt><dd className="font-semibold tabular-nums">{rm(p.total)}</dd></div>
            <div><dt className="text-muted">Valid until</dt><dd className="tabular-nums">{date(p.valid_until)}</dd></div>
          </dl>
        )}
        <p className="mb-2 flex items-center gap-2 text-sm text-muted"><Icon name="inbox" className="size-4" />This is what your customer receives. Costs and margins are never on it.</p>
        {pv.error ? <div role="alert" className="card border-warn bg-warn-bg text-sm text-warn"><p>{pv.error}</p><button type="button" className="btn mt-2" onClick={pv.reload}>Retry loading</button></div>
          : !p ? <div role="status" aria-busy="true" className="skeleton h-40"><span className="sr-only">Loading preview...</span></div> : <QuotePaper p={p} />}
      </div>
      {MOCK && <p className="sr-only">Mock mode: exports are tiny sample files.</p>}
    </section>
  )
}

function SendBox({ id, status, p, onClose, onSent }: { id: string; status: string; p: Preview; onClose: () => void; onSent: () => void }) {
  const toast = useToast()
  const first = p.channels.find(c => c.available)?.channel ?? ''
  const [ch, setCh] = useState(first)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { (box.current?.querySelector<HTMLElement>('input[type=radio]:not(:disabled)') ?? box.current)?.focus() }, [])
  const fail = (e: unknown) => {
    if (!(e instanceof ApiError)) return msg(e)
    const m = msg(e)
    if (e.status === 409 && e.code === 'not_sendable') return 'This quote cannot be sent right now. Reload the page to see where it stands.'
    if (e.status === 422 && e.code === 'no_email') return 'No email on file for this customer. Add one to the contact or pick another channel.'
    if (e.status === 422 && e.code === 'no_contact') return 'No chat contact on file for this customer. Add one to the contact or pick another channel.'
    if (e.status === 422) return m
    if (e.status === 429) return `You are sending too fast. Wait ${e.retryAfter ? `${e.retryAfter} seconds` : 'a moment'} and try again.`
    if (e.status === 403) return 'Only the owner can send quotes.'
    if (e.status === 402) return 'Sending needs an active licence. See the notice at the top of the page.'
    if (e.status === 404) return 'This quote no longer exists.'
    return m
  }
  const go = async () => {
    if (busy || !ch) return
    setBusy(true); setErr('')
    try {
      const r = await api<{ delivery: { channel: string; status: string; error?: string }; status: string }>('POST', `/documents/${id}/send`, { channel: ch, ...(text.trim() ? { message: text.trim() } : {}) })
      if (r.delivery.status === 'delivered') { toast(`Sent by ${chanLabel(r.delivery.channel)}`); onSent() }
      else setErr(`Not sent: ${(r.delivery.error || 'the message did not go through').replace(/[. ]+$/, '')}. The quote stays as it is. Try another channel.`)
    } catch (e) { setErr(fail(e)); if (e instanceof ApiError && e.status === 409) onSent() } finally { setBusy(false) }
  }
  return (
    <div ref={box} id="send-box" role="dialog" aria-labelledby="send-h" tabIndex={-1} className="card mt-2 max-w-xl shadow-3"
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <h3 id="send-h" className="text-md font-semibold">Send quote {p.doc_no}</h3>
      {status === 'approved' && <p className="mt-1 text-sm text-muted">Sending marks the quote as sent.</p>}
      <form className="mt-2 grid gap-3" onSubmit={e => { e.preventDefault(); go() }}>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold">Send by</legend>
          {p.channels.length === 0 && <p className="text-sm text-muted">No channel is set up for this customer.</p>}
          {p.channels.map(c => (
            <label key={c.channel} className={`flex min-h-11 items-start gap-2 rounded-ui border border-line p-2 text-sm ${c.available ? '' : 'text-muted'}`}>
              <input type="radio" name="chan" className="mt-1" value={c.channel} disabled={!c.available} checked={ch === c.channel} onChange={() => setCh(c.channel)} aria-describedby={`chan-${c.channel}`} />
              <span><span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{chanLabel(c.channel)}</span><span className={`chip ${c.available ? 'chip-approved' : 'chip-expired'}`}>{c.available ? 'Available' : 'Unavailable'}</span></span>
                <span id={`chan-${c.channel}`} className="block">{c.available ? (c.to_hint ? `To ${c.to_hint}` : 'Available') : (REASON[c.reason ?? ''] ?? 'Not available')}</span></span>
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 text-sm font-semibold">Message (optional)
          <textarea className="input min-h-20 py-2 font-normal" maxLength={500} rows={3} value={text} onChange={e => setText(e.target.value)} aria-describedby="send-count" />
          <span id="send-count" className="text-xs font-normal text-muted">{500 - text.length} characters left. Goes with the quote.</span></label>
        {err && <p role="alert" className="text-sm text-warn">{err}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primary" aria-disabled={busy || !ch || undefined}>{busy ? 'Sending...' : 'Send'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  )
}

import { MarkPhoto } from './MarkPhoto'
import { useEffect, useRef, useState } from 'react'
import { api, imageUrl } from './api'
import { t, useLang, locale } from './i18n'
import type { Text } from './i18n'
import { rm, useFetch, useAction, ActionError, Async, Hint, PageHeader, TableRegion } from './ui'

// "Ask suppliers": photograph an item, mark it, ask suppliers on WhatsApp how much. Contract: docs/api-contract.md (RFQ).
interface Supplier { id: string; name: string; contact: string | null }
interface Tier { min_qty: string; unit_price: string }
interface Reply {
  reply_id: string; send_id: string; supplier_id: string; supplier_name: string; text: string
  unit_price: string | null; min_qty: string | null; tiers: Tier[]; status: 'waiting' | 'needs_review' | 'ready' | 'accepted'
}
interface Rfq { id: string; description: string; note: string; created_at: string; image_url: string; replies: Reply[] }
interface SendResult { rfq_id: string; sends: { supplier_id: string; status: 'sent' | 'failed'; error: string | null }[] }
const DEFAULT_NOTE = 'How much for the marked one? Any MOQ or bulk price?'
const S = {
  badFile: { en: 'That file could not be read as a photo. Choose another one.', ms: 'Fail itu tidak dapat dibaca sebagai foto. Pilih fail lain.', zh: '该文件无法作为照片读取。请选择另一个文件。', ta: 'அந்தக் கோப்பை புகைப்படமாகப் படிக்க முடியவில்லை. வேறொன்றைத் தேர்ந்தெடுக்கவும்.' },
  needPhoto: { en: 'Choose a photo of the item first.', ms: 'Pilih foto item dahulu.', zh: '请先选择物品的照片。', ta: 'முதலில் பொருளின் புகைப்படத்தைத் தேர்ந்தெடுக்கவும்.' },
  needDesc: { en: 'Describe the item in a few words.', ms: 'Terangkan item dalam beberapa perkataan.', zh: '请用几个字描述该物品。', ta: 'பொருளை சில சொற்களில் விவரிக்கவும்.' },
  needSup: { en: 'Choose at least one supplier to ask.', ms: 'Pilih sekurang-kurangnya seorang pembekal untuk ditanya.', zh: '请至少选择一位供应商询问。', ta: 'கேட்பதற்கு குறைந்தது ஒரு சப்ளையரைத் தேர்ந்தெடுக்கவும்.' },
  noPrep: { en: 'The photo could not be prepared for sending.', ms: 'Foto tidak dapat disediakan untuk dihantar.', zh: '无法准备要发送的照片。', ta: 'அனுப்புவதற்கான புகைப்படத்தைத் தயார் செய்ய முடியவில்லை.' },
  findSup: { en: 'Search your supplier contacts', ms: 'Cari kenalan pembekal anda', zh: '搜索供应商联系人', ta: 'சப்ளையர் தொடர்புகளைத் தேடு' },
  clearSel: { en: 'Clear', ms: 'Kosongkan', zh: '清除', ta: 'அழி' },
  selected: { en: 'Selected suppliers', ms: 'Pembekal dipilih', zh: '已选供应商', ta: 'தேர்ந்த சப்ளையர்கள்' },
  selectShown: { en: 'Select all shown', ms: 'Pilih semua yang dipaparkan', zh: '选择当前显示的全部', ta: 'காட்டப்பட்ட அனைத்தையும் தேர்ந்தெடு' },
  noMatch: { en: 'No supplier contact matches.', ms: 'Tiada kenalan pembekal sepadan.', zh: '没有匹配的供应商联系人。', ta: 'பொருந்தும் சப்ளையர் தொடர்பு இல்லை.' },
  number: { en: 'WhatsApp or Telegram number', ms: 'Nombor WhatsApp atau Telegram', zh: 'WhatsApp 或 Telegram 号码', ta: 'WhatsApp அல்லது Telegram எண்' },
  supplier: { en: 'Supplier', ms: 'Pembekal', zh: '供应商', ta: 'சப்ளையர்' },
  noNumber: { en: 'no WhatsApp number', ms: 'tiada nombor WhatsApp', zh: '没有 WhatsApp 号码', ta: 'WhatsApp எண் இல்லை' },
  saving: { en: 'Saving...', ms: 'Menyimpan...', zh: '正在保存...', ta: 'சேமிக்கிறது...' },
  none: { en: 'None', ms: 'Tiada', zh: '无', ta: 'எதுவுமில்லை' },
} satisfies Record<string, Text>

function AskForm({ onSent }: { onSent: () => void }) {
  useLang()
  const [typed, setTyped] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { const id = setTimeout(() => setQ(typed.trim()), 250); return () => clearTimeout(id) }, [typed])
  const sup = useFetch<Supplier[]>(`/contacts?role=supplier${q ? `&q=${encodeURIComponent(q)}` : ''}`)
  const known = useRef(new Map<string, Supplier>())  // every supplier seen so far, so a ticked one stays named when a new search hides it
  sup.data?.forEach(s => known.current.set(s.id, s))
  const [img, setImg] = useState<HTMLImageElement>()
  const [desc, setDesc] = useState('')
  const [note, setNote] = useState(DEFAULT_NOTE)
  const [picked, setPicked] = useState<string[]>([])
  const [formErr, setFormErr] = useState('')
  const [res, setRes] = useState<SendResult>()
  const canvas = useRef<HTMLCanvasElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const out = useRef<HTMLDivElement>(null)
  const descBox = useRef<HTMLInputElement>(null)
  const a = useAction()
  useEffect(() => { if (res) out.current?.focus() }, [res])

  const choose = (f?: File) => {
    setRes(undefined)
    if (!f) return setImg(undefined)
    const url = URL.createObjectURL(f)
    const i = new Image()
    i.onload = () => { setImg(i); URL.revokeObjectURL(url) }
    i.onerror = () => { setImg(undefined); setFormErr(t(S.badFile)); URL.revokeObjectURL(url) }
    i.src = url
  }

  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  const usable = (sup.data ?? []).filter(s => s.contact)  // a supplier with no number cannot be asked
  const allShown = usable.length > 0 && usable.every(s => picked.includes(s.id))
  const toggleAll = () => setPicked(p => (allShown ? p.filter(id => !usable.some(s => s.id === id)) : [...new Set([...p, ...usable.map(s => s.id)])]))

  const submit = () => {
    if (!img || !canvas.current) return setFormErr(t(S.needPhoto))
    if (!desc.trim()) return setFormErr(t(S.needDesc))
    if (!picked.length) return setFormErr(t(S.needSup))
    setFormErr('')
    a.run(async () => {
      const blob = await new Promise<Blob | null>(r => canvas.current!.toBlob(r, 'image/jpeg', 0.85))
      if (!blob) throw new Error(t(S.noPrep))
      const fd = new FormData()
      fd.append('image', new File([blob], 'item.jpg', { type: 'image/jpeg' }))
      fd.append('description', desc.trim())
      fd.append('note', note.trim())
      picked.forEach(id => fd.append('supplier_ids', id))
      setRes(await api<SendResult>('POST', '/rfq', fd))
      setImg(undefined); setDesc(''); setNote(DEFAULT_NOTE); setPicked([]); if (file.current) file.current.value = ''
      onSent()
    })
  }

  const nameOf = (id: string) => known.current.get(id)?.name ?? t(S.supplier)
  return (
    <section aria-labelledby="ask-form">
      <h2 id="ask-form" className="mb-2 text-lg font-semibold">{t({ en: 'Ask for a price', ms: 'Tanya harga', zh: '询价', ta: 'விலை கேள்' })}</h2>
      <form className="grid max-w-2xl gap-4" onSubmit={e => { e.preventDefault(); submit() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Photo of the item (take one or choose from the gallery)', ms: 'Foto item (ambil satu atau pilih dari galeri)', zh: '物品照片（拍摄或从相册选择）', ta: 'பொருளின் புகைப்படம் (எடுக்கவும் அல்லது கேலரியிலிருந்து தேர்ந்தெடுக்கவும்)' })}
          <input id="ask-photo" data-guide="ask-photo" ref={file} type="file" accept="image/*" capture="environment" className="input py-2 font-normal" onChange={e => choose(e.target.files?.[0])} />
        </label>

        {img && <MarkPhoto img={img} canvasRef={canvas} onClear={() => { setImg(undefined); if (file.current) file.current.value = '' }} />}

        <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'What is it? (required, up to 200 characters)', ms: 'Apakah ini? (wajib, sehingga 200 aksara)', zh: '这是什么？（必填，最多 200 个字符）', ta: 'இது என்ன? (கட்டாயம், 200 எழுத்துகள் வரை)' })}
          <input ref={descBox} className="input font-normal" maxLength={200} placeholder={t({ en: 'ballet flat, cream, strap', ms: 'kasut balet, krim, tali', zh: '芭蕾平底鞋，奶油色，带子', ta: 'பாலே ஃப்ளாட், கிரீம், பட்டை' })} value={desc} onChange={e => setDesc(e.target.value)} />
        </label>

        <fieldset data-guide="ask-suppliers" className="min-w-0">
          <legend className="mb-1 text-sm font-semibold">{t({ en: 'Which suppliers to ask? (choose at least one)', ms: 'Pembekal mana untuk ditanya? (pilih sekurang-kurangnya satu)', zh: '要询问哪些供应商？（至少选择一位）', ta: 'எந்த சப்ளையர்களிடம் கேட்பது? (குறைந்தது ஒன்றைத் தேர்ந்தெடுக்கவும்)' })}</legend>
          <input type="search" className="input w-full font-normal" value={typed} onChange={e => setTyped(e.target.value)} aria-label={t(S.findSup)} placeholder={t(S.findSup)} />
          <p className="mt-1 text-sm text-muted" role="status">{t({ en: `${picked.length} selected`, ms: `${picked.length} dipilih`, zh: `已选 ${picked.length} 位` })}
            {picked.length > 0 && <> · <button type="button" className="link" onClick={() => setPicked([])}>{t(S.clearSel)}</button></>}</p>
          {picked.length > 0 && <ul className="mt-1 flex flex-wrap gap-1" aria-label={t(S.selected)}>{picked.map(id => <li key={id} className="badge">{nameOf(id)}</li>)}</ul>}
          <Async s={sup} rows={3} empty={!sup.data?.length} emptyText={q ? t(S.noMatch) : t({ en: 'No suppliers yet.', ms: 'Belum ada pembekal.', zh: '还没有供应商。', ta: 'இன்னும் சப்ளையர்கள் இல்லை.' })}>
            <div className="scroll-table mt-2" tabIndex={0} role="region" aria-label={t(S.supplier)}>
              <table className="w-full text-left text-sm">
                <thead><tr className="text-muted">
                  <th scope="col" className="w-10 py-1 pr-2"><input type="checkbox" className="size-5" checked={allShown} disabled={!usable.length} onChange={toggleAll} aria-label={t(S.selectShown)} /></th>
                  <th scope="col" className="py-1 pr-3 font-semibold">{t(S.supplier)}</th><th scope="col" className="py-1 pr-3 font-semibold">{t(S.number)}</th>
                </tr></thead>
                <tbody>
                  {sup.data?.map(s => (
                    <tr key={s.id} className="border-t border-soft align-middle">
                      <td className="py-1.5 pr-2"><input type="checkbox" className="size-5" checked={picked.includes(s.id)} disabled={!s.contact} onChange={() => toggle(s.id)} aria-label={s.name} /></td>
                      <td className="py-1.5 pr-3 font-semibold break-words">{s.name}</td>
                      <td className="py-1.5 pr-3 tabular-nums text-muted">{s.contact ?? t(S.noNumber)}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>
          </Async>
        </fieldset>

        <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Message to the suppliers (optional, you can edit it, up to 300 characters)', ms: 'Mesej kepada pembekal (pilihan, boleh disunting, sehingga 300 aksara)', zh: '给供应商的留言（可选，可修改，最多 300 个字符）', ta: 'சப்ளையர்களுக்கான செய்தி (விருப்பம், திருத்தலாம், 300 எழுத்துகள் வரை)' })}
          <textarea className="input min-h-20 py-2 font-normal" maxLength={300} value={note} onChange={e => setNote(e.target.value)} />
        </label>

        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        <div><button type="submit" data-guide="ask-send" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? t({ en: 'Sending...', ms: 'Menghantar...', zh: '正在发送...', ta: 'அனுப்புகிறது...' }) : t({ en: 'Send on WhatsApp', ms: 'Hantar melalui WhatsApp', zh: '通过 WhatsApp 发送', ta: 'WhatsApp இல் அனுப்பு' })}</button></div>
      </form>
      <ActionError err={a.err} onRetry={submit} label={t({ en: 'Retry sending', ms: 'Cuba hantar semula', zh: '重试发送', ta: 'மீண்டும் அனுப்பு' })} />
      {res && (
        <div ref={out} tabIndex={-1} className="card mt-3 max-w-2xl" aria-labelledby="ask-res">
          <h3 id="ask-res" className="font-semibold">{t({ en: 'Result', ms: 'Keputusan', zh: '结果', ta: 'முடிவு' })}</h3>
          <ul className="mt-1 grid gap-1 text-sm">
            {res.sends.map(s => (
              <li key={s.supplier_id}>
                <span className="font-semibold">{nameOf(s.supplier_id)}</span>: {s.status === 'sent' ? t({ en: 'sent', ms: 'dihantar', zh: '已发送', ta: 'அனுப்பப்பட்டது' }) : <span className="text-warn">{t({ en: 'not sent.', ms: 'tidak dihantar.', zh: '未发送。', ta: 'அனுப்பப்படவில்லை.' })} {s.error ?? t({ en: 'No reason was given.', ms: 'Tiada sebab diberikan.', zh: '未说明原因。', ta: 'காரணம் கொடுக்கப்படவில்லை.' })}</span>}
              </li>
            ))}
          </ul>
          {res.sends.some(s => s.status === 'failed') && <p className="mt-2 text-sm text-muted">{t({ en: 'Nothing was lost. You can send this again from a new request, or call the supplier.', ms: 'Tiada yang hilang. Anda boleh hantar semula melalui permintaan baharu, atau hubungi pembekal.', zh: '没有丢失任何内容。您可以通过新请求再次发送，或致电供应商。', ta: 'எதுவும் இழக்கப்படவில்லை. புதிய கோரிக்கையிலிருந்து மீண்டும் அனுப்பலாம், அல்லது சப்ளையரை அழைக்கலாம்.' })}</p>}
        </div>
      )}
    </section>
  )
}

// The image endpoint needs the identity headers, so a plain <img src> will not do: fetch it as a blob.
function Photo({ url, alt }: { url: string; alt: string }) {
  useLang()
  const [src, setSrc] = useState('')
  const [bad, setBad] = useState(false)
  useEffect(() => {
    let live = true, made = ''
    setBad(false)
    imageUrl(url).then(u => { made = u; if (live) setSrc(u); else if (u.startsWith('blob:')) URL.revokeObjectURL(u) }, () => live && setBad(true))
    return () => { live = false; if (made.startsWith('blob:')) URL.revokeObjectURL(made) }
  }, [url])
  if (bad) return <span className="text-sm text-muted">{t({ en: 'Photo not available.', ms: 'Foto tidak tersedia.', zh: '照片不可用。', ta: 'புகைப்படம் கிடைக்கவில்லை.' })}</span>
  return src ? <img src={src} alt={alt} className="max-h-40 max-w-full rounded-ui border border-soft object-contain" /> : <span role="status" aria-busy="true" className="skeleton block h-24 w-40 max-w-full"><span className="sr-only">{t({ en: 'Loading photo...', ms: 'Memuatkan foto...', zh: '正在加载照片...', ta: 'புகைப்படம் ஏற்றப்படுகிறது...' })}</span></span>
}

function AcceptCell({ rfq, r, onDone }: { rfq: string; r: Reply; onDone: () => void }) {
  useLang()
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [formErr, setFormErr] = useState('')
  const a = useAction()
  const id = `acc-${r.reply_id}`
  const submit = () => {
    if (!key.trim()) return setFormErr(t({ en: 'Enter the item key this price is for.', ms: 'Masukkan kunci item untuk harga ini.', zh: '请输入此价格对应的物品代码。', ta: 'இந்த விலைக்கான பொருள் குறியீட்டை உள்ளிடவும்.' }))
    setFormErr('')
    a.run(async () => { await api('POST', `/rfq/${rfq}/replies/${r.reply_id}/accept`, { item_key: key.trim() }); setOpen(false); onDone() })
  }
  if (r.status === 'accepted') return <span className="badge">{t({ en: 'Accepted', ms: 'Diterima', zh: '已接受', ta: 'ஏற்கப்பட்டது' })}</span>
  if (r.status === 'waiting') return <span className="text-muted">{t({ en: 'Nothing to accept yet', ms: 'Belum ada untuk diterima', zh: '暂无可接受的内容', ta: 'ஏற்க இன்னும் எதுவுமில்லை' })}</span>
  return (
    <>
      <button type="button" className="btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{t({ en: `Accept ${r.supplier_name}`, ms: `Terima ${r.supplier_name}`, zh: `接受 ${r.supplier_name}`, ta: `${r.supplier_name} ஐ ஏற்கவும்` })}</button>
      {open && (
        <form id={id} className="mt-2 grid gap-2" onSubmit={e => { e.preventDefault(); submit() }}>
          <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: `Item key for ${r.supplier_name}`, ms: `Kunci item untuk ${r.supplier_name}`, zh: `${r.supplier_name} 的物品代码`, ta: `${r.supplier_name} க்கான பொருள் குறியீடு` })}
            <input className="input w-48 font-normal" aria-describedby={`${id}-help`} value={key} onChange={e => setKey(e.target.value)} autoFocus />
            <Hint id={`${id}-help`}>{t({ en: 'A short code for this item in your cost book, like acrylic_3mm_sheet.', ms: 'Kod pendek untuk item ini dalam buku kos anda, seperti acrylic_3mm_sheet.', zh: '此物品在您成本簿中的简短代码，例如 acrylic_3mm_sheet。', ta: 'உங்கள் செலவுப் புத்தகத்தில் இந்தப் பொருளுக்கான சிறு குறியீடு, எ.கா. acrylic_3mm_sheet.' })}</Hint>
          </label>
          {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
          <div><button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? t(S.saving) : t({ en: `Confirm accept for ${r.supplier_name}`, ms: `Sahkan terima untuk ${r.supplier_name}`, zh: `确认接受 ${r.supplier_name}`, ta: `${r.supplier_name} ஐ ஏற்பதை உறுதிசெய்` })}</button></div>
          <ActionError err={a.err} onRetry={submit} label={t({ en: 'Retry accepting', ms: 'Cuba terima semula', zh: '重试接受', ta: 'மீண்டும் ஏற்கவும்' })} />
        </form>
      )}
    </>
  )
}

function Comparison({ q, onDone }: { q: Rfq; onDone: () => void }) {
  useLang()
  const prices = q.replies.filter(r => r.unit_price !== null).map(r => Number(r.unit_price))
  const best = prices.length > 1 ? Math.min(...prices) : undefined
  return (
    <div className="mt-2"><TableRegion label={t({ en: `Replies for ${q.description}`, ms: `Balasan untuk ${q.description}`, zh: `${q.description} 的回复`, ta: `${q.description} க்கான பதில்கள்` })}>
      <table className="w-full min-w-max">
        <caption className="sr-only">{t({ en: `Supplier replies for ${q.description}`, ms: `Balasan pembekal untuk ${q.description}`, zh: `供应商对 ${q.description} 的回复`, ta: `${q.description} க்கான சப்ளையர் பதில்கள்` })}</caption>
        <thead><tr><th scope="col">{t(S.supplier)}</th><th scope="col">{t({ en: 'Price', ms: 'Harga', zh: '价格', ta: 'விலை' })}</th><th scope="col"><abbr title={t({ en: 'Minimum order quantity', ms: 'Kuantiti pesanan minimum', zh: '最低订购量', ta: 'குறைந்தபட்ச ஆர்டர் அளவு' })}>MOQ</abbr></th><th scope="col">{t({ en: 'Price breaks', ms: 'Potongan harga', zh: '阶梯价', ta: 'விலை படிகள்' })}</th><th scope="col">{t({ en: 'Their reply', ms: 'Balasan mereka', zh: '对方回复', ta: 'அவர்களின் பதில்' })}</th><th scope="col">{t({ en: 'Action', ms: 'Tindakan', zh: '操作', ta: 'செயல்' })}</th></tr></thead>
        <tbody>
          {q.replies.map(r => {
            const cheapest = best !== undefined && r.unit_price !== null && Number(r.unit_price) === best
            return (
              <tr key={r.reply_id} className={cheapest ? 'bg-tint' : undefined}>
                <th scope="row" className="text-sm font-semibold text-ink">{r.supplier_name}</th>
                <td className={cheapest ? 'font-bold' : undefined}>{r.unit_price !== null ? rm(r.unit_price) : <span className="text-muted">{r.status === 'waiting' ? t({ en: 'Waiting', ms: 'Menunggu', zh: '等待中', ta: 'காத்திருக்கிறது' }) : t({ en: 'Not read', ms: 'Tidak dibaca', zh: '未读取', ta: 'படிக்கப்படவில்லை' })}</span>}{cheapest && <span className="badge ml-2">{t({ en: 'Cheapest', ms: 'Termurah', zh: '最便宜', ta: 'மலிவானது' })}</span>}</td>
                <td>{r.min_qty ?? <span className="text-muted">{t(S.none)}</span>}</td>
                <td>{r.tiers.length ? <ul>{r.tiers.map(x => <li key={x.min_qty}>{t({ en: `${x.min_qty}+ at ${rm(x.unit_price)}`, ms: `${x.min_qty}+ pada ${rm(x.unit_price)}`, zh: `${x.min_qty}+ 件，${rm(x.unit_price)}`, ta: `${x.min_qty}+ க்கு ${rm(x.unit_price)}` })}</li>)}</ul> : <span className="text-muted">{t(S.none)}</span>}</td>
                <td className="max-w-xs whitespace-normal">{r.text || <span className="text-muted">{t({ en: 'No reply yet', ms: 'Belum ada balasan', zh: '暂无回复', ta: 'இன்னும் பதில் இல்லை' })}</span>}</td>
                <td><AcceptCell rfq={q.id} r={r} onDone={onDone} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </TableRegion>
    <p className="mt-1 text-xs text-muted">{t({ en: 'MOQ is the least the supplier will sell. Price breaks are cheaper unit prices at higher quantities.', ms: 'MOQ ialah kuantiti minimum yang akan dijual pembekal. Potongan harga ialah harga seunit yang lebih murah pada kuantiti lebih tinggi.', zh: 'MOQ 是供应商愿意出售的最低数量。阶梯价是数量越多单价越低。', ta: 'MOQ என்பது சப்ளையர் விற்கும் குறைந்தபட்ச அளவு. விலை படிகள் என்பது அதிக அளவில் குறைந்த அலகு விலைகள்.' })}</p></div>
  )
}

function Replies({ owner, s }: { owner: boolean; s: ReturnType<typeof useFetch<Rfq[]>> }) {
  useLang()
  return (
    <section data-guide="ask-replies" className="mt-10 border-t border-soft pt-6" aria-labelledby="ask-replies">
      <h2 id="ask-replies" className="mb-2 text-lg font-semibold">{t({ en: 'Replies', ms: 'Balasan', zh: '回复', ta: 'பதில்கள்' })}</h2>
      <Async s={s} rows={2} shape="cards" empty={!s.data?.length} emptyText={t({ en: 'No price requests yet.', ms: 'Belum ada permintaan harga.', zh: '还没有询价请求。', ta: 'இன்னும் விலை கோரிக்கைகள் இல்லை.' })} emptyHint={t({ en: 'Photograph an item above and ask your suppliers how much it costs. Their replies are compared here.', ms: 'Ambil foto item di atas dan tanya pembekal berapa harganya. Balasan mereka dibandingkan di sini.', zh: '在上方拍摄物品并询问供应商价格，他们的回复会在这里比较。', ta: 'மேலே ஒரு பொருளைப் புகைப்படம் எடுத்து சப்ளையர்களிடம் விலை கேளுங்கள். அவர்களின் பதில்கள் இங்கே ஒப்பிடப்படும்.' })}
        emptyAction={{ label: t({ en: 'Ask suppliers for a price', ms: 'Tanya pembekal harga', zh: '向供应商询价', ta: 'சப்ளையர்களிடம் விலை கேள்' }), onClick: () => { const f = document.getElementById('ask-photo'); f?.scrollIntoView({ block: 'center' }); f?.focus() } }}>
        <ul className="grid gap-4">
          {s.data?.map(q => (
            <li key={q.id} className="card min-w-0">
              <div className="flex flex-wrap items-start gap-4">
                <Photo url={q.image_url} alt={t({ en: `Photo of ${q.description}`, ms: `Foto ${q.description}`, zh: `${q.description} 的照片`, ta: `${q.description} இன் புகைப்படம்` })} />
                <div className="min-w-0 flex-1 basis-56">
                  <h3 className="font-semibold">{q.description}</h3>
                  <p className="text-sm text-muted">{t({ en: 'Asked', ms: 'Ditanya', zh: '询问于', ta: 'கேட்டது' })} <time dateTime={q.created_at}>{new Date(q.created_at).toLocaleString(locale())}</time>: {q.note}</p>
                </div>
              </div>
              {owner ? <Comparison q={q} onDone={s.reload} /> : (
                <ul className="mt-2 grid gap-1 text-sm">
                  {q.replies.map(r => <li key={r.reply_id}><span className="font-semibold">{r.supplier_name}</span>: <span className="badge">{r.status === 'waiting' ? t({ en: 'waiting', ms: 'menunggu', zh: '等待中', ta: 'காத்திருக்கிறது' }) : t({ en: 'replied', ms: 'dibalas', zh: '已回复', ta: 'பதிலளித்தது' })}</span></li>)}
                </ul>
              )}
              {!owner && <p className="mt-2 text-xs text-muted">{t({ en: 'Prices are shown to the owner only.', ms: 'Harga hanya ditunjukkan kepada pemilik.', zh: '价格仅向店主显示。', ta: 'விலைகள் உரிமையாளருக்கு மட்டுமே காட்டப்படும்.' })}</p>}
              {owner && q.replies.length === 0 && <p className="mt-2 text-sm text-muted">{t({ en: 'No suppliers were asked.', ms: 'Tiada pembekal ditanya.', zh: '没有询问任何供应商。', ta: 'எந்த சப்ளையரிடமும் கேட்கப்படவில்லை.' })}</p>}
            </li>
          ))}
        </ul>
      </Async>
    </section>
  )
}

export function AskView({ owner }: { owner: boolean }) {
  useLang()
  const s = useFetch<Rfq[]>('/rfq')
  return (
    <>
      <PageHeader title={t({ en: 'Ask suppliers', ms: 'Tanya pembekal', zh: '询问供应商', ta: 'சப்ளையர்களிடம் கேள்' })} description={t({ en: 'Photograph an item, mark it, and ask suppliers on WhatsApp how much it costs. ', ms: 'Ambil foto item, tandakannya dan tanya pembekal di WhatsApp berapa harganya. ', zh: '拍摄物品，标记它，并通过 WhatsApp 询问供应商价格。', ta: 'ஒரு பொருளைப் புகைப்படம் எடுத்து, குறியிட்டு, WhatsApp இல் சப்ளையர்களிடம் விலை கேளுங்கள். ' }) + (owner ? t({ en: 'Their replies are compared below.', ms: 'Balasan mereka dibandingkan di bawah.', zh: '他们的回复在下方比较。', ta: 'அவர்களின் பதில்கள் கீழே ஒப்பிடப்படும்.' }) : t({ en: 'The owner sees the prices; you see who has replied.', ms: 'Pemilik melihat harga; anda melihat siapa yang telah membalas.', zh: '店主可看到价格；您可看到谁已回复。', ta: 'உரிமையாளர் விலைகளைப் பார்ப்பார்; யார் பதிலளித்தார்கள் என்று நீங்கள் பார்க்கலாம்.' }))} />
      <AskForm onSent={s.reload} />
      <Replies owner={owner} s={s} />
    </>
  )
}

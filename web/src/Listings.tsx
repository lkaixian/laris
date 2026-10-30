import { useEffect, useRef, useState } from 'react'
import { api, imageUrl, ApiError } from './api'
import type { Me } from './api'
import { useFetch, msg, Async, Hint, PageHeader, Status as Chip } from './ui'
import { ConfirmDialog, MoreMenu } from './kit'
import { MaskEditor } from './MaskEditor'
import { t, useLang, locale } from './i18n'
import type { Text } from './i18n'

// "Catalog photos": one photo with many labelled products -> one card per product to check, edit, confirm or ask suppliers about.
// Contract: docs/api-contract.md (listings), setup: docs/deploy.md 10b.
type Status = 'needs_review' | 'confirmed' | 'discarded'
interface Item {
  id: string; position: number; description: string; labels: string[]; sku: string | null; sizes: string[]
  price: string | number | null; currency: string | null; bbox: [number, number, number, number]
  status: Status; reasons: string[]; item_key: string | null; crop_url: string
  price_tiers?: Tier[]; stock_qty?: string | number | null; category?: string | null; category_suggestion?: string | null; cutout_url?: string | null
}
// One customer price: for one size (or every size when size is null) from min_qty up. Priced by the rules engine, never the model.
interface Tier { size: string | null; min_qty: string | number; price: string | number }
interface TierRow { size: string; min_qty: string; price: string }
interface ListingRow { id: string; party_name: string | null; note: string | null; created_at: string; items: number; to_review: number; image_url: string; thumb_url?: string }
interface Detail extends Omit<ListingRow, 'items'> { items: Item[] }
interface Supplier { id: string; name: string; contact: string | null }
interface SendResult { rfq_id: string; sends: { supplier_id: string; status: 'sent' | 'failed'; error: string | null }[] }

// Permissions arrive on GET /api/me. Missing (mock mode, older server): show the page and let the server say no.
const perms = (me?: Me) => (me as (Me & { permissions?: string[] }) | undefined)?.permissions
export const canUpload = (me?: Me) => perms(me)?.includes('upload_documents') ?? true
const canSeePrice = (me: Me | undefined, owner: boolean) => perms(me)?.includes('view_costs') ?? owner

const BADGE: Record<Status, Text> = {
  needs_review: { en: 'Needs review', ms: 'Perlu semakan', zh: '待审核', ta: 'மதிப்பாய்வு தேவை' },
  confirmed: { en: 'Confirmed', ms: 'Disahkan', zh: '已确认', ta: 'உறுதிசெய்யப்பட்டது' },
  discarded: { en: 'Discarded', ms: 'Dibuang', zh: '已丢弃', ta: 'நிராகரிக்கப்பட்டது' },
}
const HINT: Record<string, Text> = {
  unverified_sku: { en: 'SKU could not be confirmed from the photo text', ms: 'SKU tidak dapat disahkan daripada teks foto', zh: '无法从照片文字确认 SKU', ta: 'புகைப்பட எழுத்திலிருந்து SKU ஐ உறுதிசெய்ய முடியவில்லை' },
  unverified_price: { en: 'Price could not be confirmed from the photo text', ms: 'Harga tidak dapat disahkan daripada teks foto', zh: '无法从照片文字确认价格', ta: 'புகைப்பட எழுத்திலிருந்து விலையை உறுதிசெய்ய முடியவில்லை' },
  no_ocr_check: { en: 'The photo text was not double-checked, please compare with the photo', ms: 'Teks foto tidak disemak dua kali, sila bandingkan dengan foto', zh: '照片文字未经二次核对，请与照片对照', ta: 'புகைப்பட எழுத்து இருமுறை சரிபார்க்கப்படவில்லை, புகைப்படத்துடன் ஒப்பிடவும்' },
}
const S = {
  noSup: { en: 'No supplier', ms: 'Tiada pembekal', zh: '无供应商', ta: 'சப்ளையர் இல்லை' },
  supplier: { en: 'Supplier', ms: 'Pembekal', zh: '供应商', ta: 'சப்ளையர்' },
  noNumber: { en: 'no WhatsApp number', ms: 'tiada nombor WhatsApp', zh: '没有 WhatsApp 号码', ta: 'WhatsApp எண் இல்லை' },
  saving: { en: 'Saving...', ms: 'Menyimpan...', zh: '正在保存...', ta: 'சேமிக்கிறது...' },
  sending: { en: 'Sending...', ms: 'Menghantar...', zh: '正在发送...', ta: 'அனுப்புகிறது...' },
  cancel: { en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து செய்' },
  close: { en: 'Close', ms: 'Tutup', zh: '关闭', ta: 'மூடு' },
  none: { en: 'none', ms: 'tiada', zh: '无', ta: 'எதுவுமில்லை' },
  price: { en: 'Price', ms: 'Harga', zh: '价格', ta: 'விலை' },
  anySize: { en: 'Any size', ms: 'Mana-mana saiz', zh: '任意尺寸', ta: 'எந்த அளவும்' },
  wholePhoto: { en: 'The whole catalog photo', ms: 'Keseluruhan foto katalog', zh: '完整的目录照片', ta: 'முழு பட்டியல் படம்' },
  sendWa: { en: 'Send on WhatsApp', ms: 'Hantar melalui WhatsApp', zh: '通过 WhatsApp 发送', ta: 'WhatsApp இல் அனுப்பு' },
  chooseSup: { en: 'Which suppliers to ask? (choose at least one)', ms: 'Pembekal mana untuk ditanya? (pilih sekurang-kurangnya satu)', zh: '要询问哪些供应商？（至少选择一位）', ta: 'எந்த சப்ளையர்களிடம் கேட்பது? (குறைந்தது ஒன்றைத் தேர்ந்தெடுக்கவும்)' },
} satisfies Record<string, Text>
const photoFrom = (d?: string) => t({ en: `Photo from ${d ?? '...'}`, ms: `Foto dari ${d ?? '...'}`, zh: `${d ?? '...'} 的照片`, ta: `${d ?? '...'} இன் படம்` })
const KEY_RE = /^[a-z][a-z0-9_]{0,60}$/
const when = (s: string) => new Date(s).toLocaleString(locale())
const money = (cur: string | null, v: string | number) => `${cur ?? 'MYR'} ${Number(v).toLocaleString(locale(), { minimumFractionDigits: 2 })}`
const qtyText = (v: string | number) => Number(v).toLocaleString(locale(), { maximumFractionDigits: 3 })
const tierKey = (t: { size: string | null; min_qty: string | number; price: string | number }) => `${t.size ?? ''}|${Number(t.min_qty)}|${Number(t.price)}`
// Retry makes sense when the vision service was asleep or the connection dropped; not for a rejected file or a missing setup.
const transient = (e: unknown) => e instanceof ApiError && (e.status === 502 || e.status === 504 || e.code === 'network' || e.code === 'vision_unavailable')

// Images need the identity headers: fetch as a blob (data URLs in mock mode pass through).
function Pic({ url, alt, className }: { url: string; alt: string; className?: string }) {
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
  return src ? <img src={src} alt={alt} className={className} /> : <span role="status" aria-busy="true" className="skeleton block h-24 w-40 max-w-full"><span className="sr-only">{t({ en: 'Loading photo...', ms: 'Memuatkan foto...', zh: '正在加载照片...', ta: 'புகைப்படம் ஏற்றப்படுகிறது...' })}</span></span>
}

// ---------- Upload ----------
type CatMode = 'auto' | 'suggest' | 'manual'
const CAT_MODES: [CatMode, Text, Text][] = [
  ['auto', { en: 'Auto', ms: 'Automatik', zh: '自动', ta: 'தானியங்கி' }, { en: 'The photo reader sets the category of each product. You can still change it.', ms: 'Pembaca foto menetapkan kategori setiap produk. Anda masih boleh menukarnya.', zh: '照片识别器会设置每个产品的类别。您仍可更改。', ta: 'புகைப்பட வாசிப்பான் ஒவ்வொரு பொருளின் வகையையும் அமைக்கும். நீங்கள் இன்னும் மாற்றலாம்.' }],
  ['suggest', { en: 'Suggest', ms: 'Cadangkan', zh: '建议', ta: 'பரிந்துரை' }, { en: 'The photo reader proposes a category and you accept it with one click.', ms: 'Pembaca foto mencadangkan kategori dan anda menerimanya dengan satu klik.', zh: '照片识别器提出类别，您一键即可接受。', ta: 'புகைப்பட வாசிப்பான் ஒரு வகையைப் பரிந்துரைக்கும்; ஒரு கிளிக்கில் ஏற்கலாம்.' }],
  ['manual', { en: 'Manual', ms: 'Manual', zh: '手动', ta: 'கைமுறை' }, { en: 'No category is proposed. Pick or type one yourself.', ms: 'Tiada kategori dicadangkan. Pilih atau taip sendiri.', zh: '不提供类别建议。请自行选择或输入。', ta: 'வகை பரிந்துரைக்கப்படாது. நீங்களே தேர்ந்தெடுக்கவும் அல்லது தட்டச்சு செய்யவும்.' }],
]
const MODE_KEY = 'laris.catmode'
const readMode = (): CatMode => { try { const v = localStorage.getItem(MODE_KEY); return v === 'auto' || v === 'manual' ? v : 'suggest' } catch { return 'suggest' } }
function UploadCard({ owner, suppliers, onDone }: { owner: boolean; suppliers: Supplier[]; onDone: (id: string) => void }) {
  useLang()
  const [file, setFile] = useState<File>()
  const [sup, setSup] = useState('')
  const [note, setNote] = useState('')
  const [formErr, setFormErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<{ text: string; retry: boolean }>()
  const [mode, setMode] = useState<CatMode>(readMode)
  const input = useRef<HTMLInputElement>(null)

  const send = async () => {
    if (!file) return setFormErr(t({ en: 'Choose a photo first.', ms: 'Pilih foto dahulu.', zh: '请先选择照片。', ta: 'முதலில் ஒரு புகைப்படத்தைத் தேர்ந்தெடுக்கவும்.' }))
    if (busy) return
    setFormErr(''); setErr(undefined); setBusy(true)
    try {
      const fd = new FormData()
      fd.append('image', file)
      if (sup) fd.append('supplier_id', sup)
      if (note.trim()) fd.append('note', note.trim())
      fd.append('categorize', mode)
      const r = await api<{ listing_id: string }>('POST', '/listings', fd)
      setFile(undefined); setNote(''); if (input.current) input.current.value = ''
      onDone(r.listing_id)
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) setErr({ text: owner ? e.message : t({ en: 'Photo reading is not set up yet. Ask the owner to set up photo reading.', ms: 'Pembacaan foto belum disediakan. Minta pemilik menyediakannya.', zh: '照片识别尚未设置。请让店主设置照片识别。', ta: 'புகைப்பட வாசிப்பு இன்னும் அமைக்கப்படவில்லை. உரிமையாளரிடம் அமைக்கச் சொல்லுங்கள்.' }), retry: false })
      else if (e instanceof ApiError && (e.code === 'timeout' || e.status === 502 || e.status === 504)) setErr({ text: t({ en: 'The upload may still be processing. Check the list below before trying again.', ms: 'Muat naik mungkin masih diproses. Semak senarai di bawah sebelum mencuba lagi.', zh: '上传可能仍在处理中。再次尝试前请先查看下方列表。', ta: 'பதிவேற்றம் இன்னும் செயலாக்கத்தில் இருக்கலாம். மீண்டும் முயற்சிக்கும் முன் கீழுள்ள பட்டியலைப் பார்க்கவும்.' }), retry: false })  // the server may still finish
      else if (transient(e)) setErr({ text: t({ en: 'The photo reader is not answering yet (it may still be waking up). Nothing was saved. Try again in a minute.', ms: 'Pembaca foto belum menjawab (mungkin masih bangun). Tiada yang disimpan. Cuba lagi dalam seminit.', zh: '照片识别器尚未响应（可能仍在启动）。没有保存任何内容。请一分钟后再试。', ta: 'புகைப்பட வாசிப்பான் இன்னும் பதிலளிக்கவில்லை (இன்னும் தொடங்கிக்கொண்டிருக்கலாம்). எதுவும் சேமிக்கப்படவில்லை. ஒரு நிமிடத்தில் மீண்டும் முயற்சிக்கவும்.' }), retry: true })
      else setErr({ text: msg(e), retry: false })
    } finally { setBusy(false) }
  }

  return (
    <section aria-labelledby="cat-up" className="card max-w-2xl">
      <h2 id="cat-up" className="mb-2 text-md font-semibold">{t({ en: 'Read a catalog photo', ms: 'Baca foto katalog', zh: '识别目录照片', ta: 'பட்டியல் படத்தைப் படி' })}</h2>
      <form className="grid gap-3" onSubmit={e => { e.preventDefault(); send() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Photo with several labelled products (take one or choose from the gallery)', ms: 'Foto dengan beberapa produk berlabel (ambil satu atau pilih dari galeri)', zh: '含多个带标签产品的照片（拍摄或从相册选择）', ta: 'பல லேபிளிட்ட பொருட்கள் உள்ள புகைப்படம் (எடுக்கவும் அல்லது கேலரியிலிருந்து தேர்ந்தெடுக்கவும்)' })}
          <input id="cat-file" ref={input} type="file" accept="image/*" capture="environment" className="input py-2 font-normal" onChange={e => { setFile(e.target.files?.[0]); setFormErr('') }} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Supplier (optional)', ms: 'Pembekal (pilihan)', zh: '供应商（可选）', ta: 'சப்ளையர் (விருப்பம்)' })}
          <select className="input font-normal" value={sup} onChange={e => setSup(e.target.value)}>
            <option value="">{t({ en: 'Not sure / none', ms: 'Tidak pasti / tiada', zh: '不确定 / 无', ta: 'உறுதியில்லை / இல்லை' })}</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Note (optional)', ms: 'Nota (pilihan)', zh: '备注（可选）', ta: 'குறிப்பு (விருப்பம்)' })}
          <input className="input font-normal" maxLength={300} value={note} onChange={e => setNote(e.target.value)} />
        </label>
        <fieldset className="grid gap-1">
          <legend className="text-sm font-semibold">{t({ en: 'Categories', ms: 'Kategori', zh: '类别', ta: 'வகைகள்' })}</legend>
          <div role="group" aria-label={t({ en: 'How products are categorised', ms: 'Cara produk dikategorikan', zh: '产品如何分类', ta: 'பொருட்கள் எவ்வாறு வகைப்படுத்தப்படுகின்றன' })} className="flex flex-wrap gap-2">
            {CAT_MODES.map(([k, name]) => <button key={k} type="button" className="btn aria-pressed:bg-tint aria-pressed:font-bold" aria-pressed={mode === k}
              onClick={() => { setMode(k); try { localStorage.setItem(MODE_KEY, k) } catch { /* storage blocked: lasts for this visit */ } }}>{t(name)}</button>)}
          </div>
          <p className="text-sm text-muted">{t(CAT_MODES.find(([k]) => k === mode)![2])}</p>
        </fieldset>
        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        <div><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t({ en: 'Reading the photo...', ms: 'Membaca foto...', zh: '正在识别照片...', ta: 'புகைப்படத்தைப் படிக்கிறது...' }) : t({ en: 'Read the photo', ms: 'Baca foto', zh: '识别照片', ta: 'புகைப்படத்தைப் படி' })}</button></div>
        <p role="status" className="text-sm text-muted">{busy ? t({ en: 'Reading the photo… the first run after a quiet period can take a few minutes. Please keep this page open.', ms: 'Membaca foto… larian pertama selepas tempoh senyap boleh mengambil beberapa minit. Sila biarkan halaman ini terbuka.', zh: '正在识别照片……闲置一段时间后的首次运行可能需要几分钟。请保持此页面打开。', ta: 'புகைப்படத்தைப் படிக்கிறது… சிறிது நேரம் பயன்பாடின்றி இருந்த பின் முதல் முறை சில நிமிடங்கள் ஆகலாம். இந்தப் பக்கத்தைத் திறந்து வைக்கவும்.' }) : ''}</p>
      </form>
      {err && (
        <div role="alert" className="mt-3 rounded-ui border border-warn bg-warn-bg p-3 text-warn">
          <p>{err.text}</p>
          {err.retry && <button type="button" className="btn mt-3" onClick={send}>{t({ en: 'Retry reading the photo', ms: 'Cuba baca foto semula', zh: '重试识别照片', ta: 'புகைப்படத்தை மீண்டும் படி' })}</button>}
        </div>
      )}
    </section>
  )
}

// ---------- One product ----------
function ItemCard({ lid, n, it, cats, showPrice, suppliers, supErr, onChanged }: { lid: string; n: number; it: Item; cats: string[]; showPrice: boolean; suppliers: Supplier[]; supErr?: { error?: string; reload: () => void }; onChanged: () => void }) {
  useLang()
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState({ description: '', category: '', sku: '', sizes: '', item_key: '', price: '', stock: '' })
  const [tiers, setTiers] = useState<TierRow[]>([])
  const [formErr, setFormErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [asking, setAsking] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [askErr, setAskErr] = useState('')
  const [res, setRes] = useState<SendResult>()
  const [note, setNote] = useState('')
  const [confirmOff, setConfirmOff] = useState(false)
  const [masking, setMasking] = useState(false)
  const [ver, setVer] = useState(0)  // a saved cut-out keeps its URL, so the picture is asked for again
  const ref = useRef<HTMLLIElement>(null)
  const id = `it-${it.id}`

  const patch = async (body: Record<string, unknown>, done?: () => void) => {
    if (busy) return
    setBusy(true); setErr('')
    try { await api('PATCH', `/listings/${lid}/items/${it.id}`, body); done?.(); onChanged() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  const saveCut = async (png: Blob) => {
    const fd = new FormData()
    fd.append('file', png, 'cutout.png')
    await api('POST', `/listings/${lid}/items/${it.id}/cutout`, fd)
    setVer(v => v + 1); setMasking(false); onChanged()
  }
  const dropCut = async () => { await api('DELETE', `/listings/${lid}/items/${it.id}/cutout`); setVer(v => v + 1); setMasking(false); onChanged() }
  const open = () => {
    setF({ description: it.description, category: it.category ?? '', sku: it.sku ?? '', sizes: it.sizes.join(', '), item_key: it.item_key ?? '', price: it.price === null ? '' : String(it.price),
      stock: it.stock_qty === null || it.stock_qty === undefined ? '' : String(Number(it.stock_qty)) })
    setTiers((it.price_tiers ?? []).map(t => ({ size: t.size ?? '', min_qty: String(Number(t.min_qty)), price: String(Number(t.price)) })))
    setFormErr(''); setEdit(true)
  }
  const save = () => {
    const body: Record<string, unknown> = {}
    const sizes = f.sizes.split(',').map(s => s.trim()).filter(Boolean)
    if (!f.description.trim()) return setFormErr(t({ en: 'The description cannot be empty.', ms: 'Perihalan tidak boleh kosong.', zh: '描述不能为空。', ta: 'விளக்கம் காலியாக இருக்கக்கூடாது.' }))
    if (f.item_key.trim() && !KEY_RE.test(f.item_key.trim())) return setFormErr(t({ en: 'Item key: lower-case letters, digits and underscores, starting with a letter.', ms: 'Kunci item: huruf kecil, digit dan garis bawah, bermula dengan huruf.', zh: '物品代码：小写字母、数字和下划线，以字母开头。', ta: 'பொருள் குறியீடு: சிறிய எழுத்துகள், இலக்கங்கள், அடிக்கோடுகள்; எழுத்தில் தொடங்க வேண்டும்.' }))
    if (showPrice && f.price.trim() && !(Number(f.price) > 0)) return setFormErr(t({ en: 'Price must be a number above zero.', ms: 'Harga mestilah nombor lebih daripada sifar.', zh: '价格必须是大于零的数字。', ta: 'விலை பூஜ்ஜியத்திற்கு மேல் உள்ள எண்ணாக இருக்க வேண்டும்.' }))
    if (f.stock.trim() && !(Number(f.stock) >= 0)) return setFormErr(t({ en: 'Stock count must be zero or more, or left empty when you do not count it.', ms: 'Kiraan stok mestilah sifar atau lebih, atau dibiarkan kosong jika tidak dikira.', zh: '库存数量必须为零或更大；如不统计库存，请留空。', ta: 'இருப்பு எண்ணிக்கை பூஜ்ஜியம் அல்லது அதற்கு மேல் இருக்க வேண்டும்; எண்ணவில்லை என்றால் காலியாக விடவும்.' }))
    if (showPrice) {
      for (const [i, row] of tiers.entries()) {
        if (!(Number(row.price) > 0)) return setFormErr(t({ en: `Price row ${i + 1}: the price must be a number above zero.`, ms: `Baris harga ${i + 1}: harga mestilah nombor lebih daripada sifar.`, zh: `价格行 ${i + 1}：价格必须是大于零的数字。`, ta: `விலை வரிசை ${i + 1}: விலை பூஜ்ஜியத்திற்கு மேல் உள்ள எண்ணாக இருக்க வேண்டும்.` }))
        if (!(Number(row.min_qty) > 0)) return setFormErr(t({ en: `Price row ${i + 1}: the minimum quantity must be above zero.`, ms: `Baris harga ${i + 1}: kuantiti minimum mestilah lebih daripada sifar.`, zh: `价格行 ${i + 1}：最低数量必须大于零。`, ta: `விலை வரிசை ${i + 1}: குறைந்தபட்ச அளவு பூஜ்ஜியத்திற்கு மேல் இருக்க வேண்டும்.` }))
        if (row.size && !sizes.some(s => s.toLowerCase() === row.size.toLowerCase())) return setFormErr(t({ en: `Price row ${i + 1}: size ${row.size} is not in the sizes list.`, ms: `Baris harga ${i + 1}: saiz ${row.size} tiada dalam senarai saiz.`, zh: `价格行 ${i + 1}：尺寸 ${row.size} 不在尺寸列表中。`, ta: `விலை வரிசை ${i + 1}: அளவு ${row.size} அளவுகள் பட்டியலில் இல்லை.` }))
      }
      const keys = tiers.map(t => `${t.size.toLowerCase()}|${Number(t.min_qty)}`)
      if (new Set(keys).size !== keys.length) return setFormErr(t({ en: 'Two price rows have the same size and minimum quantity.', ms: 'Dua baris harga mempunyai saiz dan kuantiti minimum yang sama.', zh: '有两个价格行的尺寸和最低数量相同。', ta: 'இரண்டு விலை வரிசைகளுக்கு ஒரே அளவும் குறைந்தபட்ச அளவும் உள்ளன.' }))
    }
    if (f.description.trim() !== it.description) body.description = f.description.trim()
    if (f.category.trim() !== (it.category ?? '')) body.category = f.category.trim() || null
    if (f.sku.trim() !== (it.sku ?? '')) body.sku = f.sku.trim() || null
    if (sizes.join(',') !== it.sizes.join(',')) body.sizes = sizes
    if (f.item_key.trim() && f.item_key.trim() !== (it.item_key ?? '')) body.item_key = f.item_key.trim()
    if (showPrice && f.price.trim() && Number(f.price) !== Number(it.price)) body.price = Number(f.price)
    const stock = f.stock.trim() === '' ? null : Number(f.stock)
    const was = it.stock_qty === null || it.stock_qty === undefined ? null : Number(it.stock_qty)
    if (stock !== was) body.stock_qty = stock
    const next = tiers.map(t => ({ size: t.size || null, min_qty: t.min_qty.trim() || '1', price: t.price.trim() }))
    if (showPrice && next.map(tierKey).sort().join() !== (it.price_tiers ?? []).map(tierKey).sort().join()) body.price_tiers = next
    setFormErr('')
    if (!Object.keys(body).length) return setEdit(false)
    patch(body, () => setEdit(false))
  }

  const ask = async () => {
    if (!picked.length) return setAskErr(t({ en: 'Choose at least one supplier.', ms: 'Pilih sekurang-kurangnya seorang pembekal.', zh: '请至少选择一位供应商。', ta: 'குறைந்தது ஒரு சப்ளையரைத் தேர்ந்தெடுக்கவும்.' }))
    if (busy) return
    setAskErr(''); setBusy(true)
    try {
      setRes(await api<SendResult>('POST', `/listings/${lid}/items/${it.id}/ask`, { supplier_ids: picked, ...(note.trim() ? { note: note.trim() } : {}) }))
      setAsking(false); setPicked([])
    } catch (e) { setAskErr(msg(e)) } finally { setBusy(false) }
  }
  const nameOf = (sid: string) => suppliers.find(s => s.id === sid)?.name ?? t(S.supplier)
  const off = it.status === 'discarded'

  return (
    <li ref={ref} id={id} tabIndex={-1} className={`card scroll-mt-4 ${off ? 'opacity-80' : ''}`} aria-labelledby={`${id}-h`}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="w-[120px] max-w-full shrink-0 rounded-ui border border-hairline" style={it.cutout_url ? { background: 'repeating-conic-gradient(#c9c9c9 0 25%, #ececec 0 50%) 0 0 / 14px 14px' } : undefined}>
          <Pic key={ver} url={it.cutout_url ? `${it.cutout_url}${it.cutout_url.startsWith('/api/') ? `?v=${ver}` : ''}` : it.crop_url}
            alt={it.cutout_url ? t({ en: `Cut-out of product ${n}`, ms: `Keratan produk ${n}`, zh: `产品 ${n} 的抠图`, ta: `பொருள் ${n} இன் வெட்டுப்படம்` }) : t({ en: `Cropped photo of product ${n}`, ms: `Foto terpangkas produk ${n}`, zh: `产品 ${n} 的裁剪照片`, ta: `பொருள் ${n} இன் வெட்டிய படம்` })} className="max-h-40 w-full object-contain" />
        </div>
        <div className="min-w-0 flex-1 basis-60">
          <h3 id={`${id}-h`} className="flex flex-wrap items-center gap-2 font-semibold">
            <span>{n}. <span className={off ? 'line-through' : undefined}>{it.description}</span></span>
            <Chip v={it.status} />
            {it.category && <span className="rounded-ui border border-soft px-1.5 text-sm font-normal">{it.category}</span>}
          </h3>
          {!it.category && it.category_suggestion && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm"><span className="text-muted">{t({ en: 'Suggested category:', ms: 'Kategori dicadangkan:', zh: '建议类别：', ta: 'பரிந்துரைக்கப்பட்ட வகை:' })}</span> <b>{it.category_suggestion}</b>
              <button type="button" className="btn min-h-9 px-2" aria-disabled={busy || undefined} onClick={() => patch({ category: it.category_suggestion })}>{t({ en: 'Use this category', ms: 'Guna kategori ini', zh: '使用此类别', ta: 'இந்த வகையைப் பயன்படுத்து' })}</button></p>
          )}
          {it.labels.length > 0 && (
            <p className="mt-1 text-sm"><span className="text-muted">{t({ en: 'Printed on the label:', ms: 'Dicetak pada label:', zh: '标签上印有：', ta: 'லேபிளில் அச்சிடப்பட்டது:' })}</span>{' '}
              {it.labels.map((l, i) => <span key={i} dir="auto" className="mr-2 inline-block rounded-ui border border-soft px-1.5">{l}</span>)}</p>
          )}
          <dl className="mt-2 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">SKU</dt><dd className="break-words">{it.sku ?? t(S.none)}</dd></div>
            <div><dt className="text-muted">{t({ en: 'Sizes', ms: 'Saiz', zh: '尺寸', ta: 'அளவுகள்' })}</dt><dd className="break-words">{it.sizes.length ? it.sizes.join(', ') : t(S.none)}</dd></div>
            {it.item_key && <div><dt className="text-muted">{t({ en: 'Item key', ms: 'Kunci item', zh: '物品代码', ta: 'பொருள் குறியீடு' })}</dt><dd className="break-words">{it.item_key}</dd></div>}
            {it.price !== null && <div><dt className="text-muted">{t(S.price)}</dt><dd className="tabular-nums">{money(it.currency, it.price)}</dd></div>}
            <div><dt className="text-muted">{t({ en: 'Stock', ms: 'Stok', zh: '库存', ta: 'இருப்பு' })}</dt><dd className="tabular-nums">{it.stock_qty === null || it.stock_qty === undefined ? t({ en: 'Not counted', ms: 'Tidak dikira', zh: '未统计', ta: 'எண்ணப்படவில்லை' }) : qtyText(it.stock_qty)}</dd></div>
          </dl>
          {showPrice && (it.price_tiers?.length ?? 0) > 0 && (
            <div className="mt-2 text-sm">
              <p className="text-muted">{t({ en: 'Prices by size and quantity', ms: 'Harga mengikut saiz dan kuantiti', zh: '按尺寸和数量定价', ta: 'அளவு மற்றும் எண்ணிக்கை வாரியான விலைகள்' })}</p>
              <ul className="mt-1 grid gap-1">
                {[...it.price_tiers!].sort((x, y) => (x.size ?? '').localeCompare(y.size ?? '') || Number(x.min_qty) - Number(y.min_qty)).map(x => <li key={tierKey(x)} className="tabular-nums">{t({ en: `${x.size ?? 'Any size'}, from ${qtyText(x.min_qty)}: ${money(it.currency, x.price)} each`, ms: `${x.size ?? 'Mana-mana saiz'}, daripada ${qtyText(x.min_qty)}: ${money(it.currency, x.price)} setiap satu`, zh: `${x.size ?? '任意尺寸'}，${qtyText(x.min_qty)} 起：每件 ${money(it.currency, x.price)}`, ta: `${x.size ?? 'எந்த அளவும்'}, ${qtyText(x.min_qty)} முதல்: ஒவ்வொன்றும் ${money(it.currency, x.price)}` })}</li>)}
              </ul>
            </div>
          )}
          {it.reasons.length > 0 && (
            <ul className="mt-2 grid gap-1 text-sm text-warn">
              {it.reasons.map(r => <li key={r}><span className="font-semibold">{t({ en: 'Check:', ms: 'Semak:', zh: '请核对：', ta: 'சரிபார்:' })}</span> {HINT[r] ? t(HINT[r]) : r.replace(/_/g, ' ')}</li>)}
            </ul>
          )}
        </div>
      </div>

      {masking && <MaskEditor cropUrl={it.crop_url} cutoutUrl={it.cutout_url ?? null} bbox={it.bbox} onSave={saveCut} onRemove={dropCut} onClose={() => setMasking(false)} />}

      {edit ? (
        <form className="mt-3 grid gap-3 border-t border-hairline pt-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); save() }}>
          <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">{t({ en: 'Description', ms: 'Perihalan', zh: '描述', ta: 'விளக்கம்' })}
            <input className="input font-normal" maxLength={300} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">{t({ en: 'Category', ms: 'Kategori', zh: '类别', ta: 'வகை' })}
            <input className="input font-normal" maxLength={60} list={`${id}-cats`} value={f.category} onChange={e => setF({ ...f, category: e.target.value })} />
            <datalist id={`${id}-cats`}>{cats.map(c => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">SKU
            <input className="input font-normal" maxLength={80} value={f.sku} onChange={e => setF({ ...f, sku: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Sizes (separated by commas)', ms: 'Saiz (dipisahkan dengan koma)', zh: '尺寸（用逗号分隔）', ta: 'அளவுகள் (காற்புள்ளியால் பிரிக்கவும்)' })}
            <input className="input font-normal" value={f.sizes} onChange={e => setF({ ...f, sizes: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Item key', ms: 'Kunci item', zh: '物品代码', ta: 'பொருள் குறியீடு' })}
            <input className="input font-normal" aria-describedby={`${id}-key-help`} value={f.item_key} onChange={e => setF({ ...f, item_key: e.target.value })} />
            <Hint id={`${id}-key-help`}>{t({ en: 'A short code for this product in your cost book: lower-case letters, digits and underscores.', ms: 'Kod pendek untuk produk ini dalam buku kos anda: huruf kecil, digit dan garis bawah.', zh: '此产品在您成本簿中的简短代码：小写字母、数字和下划线。', ta: 'உங்கள் செலவுப் புத்தகத்தில் இந்தப் பொருளுக்கான சிறு குறியீடு: சிறிய எழுத்துகள், இலக்கங்கள், அடிக்கோடுகள்.' })}</Hint>
          </label>
          {showPrice && (
            <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.price)}
              <input className="input font-normal" inputMode="decimal" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Stock count', ms: 'Kiraan stok', zh: '库存数量', ta: 'இருப்பு எண்ணிக்கை' })}
            <input className="input font-normal" inputMode="decimal" aria-describedby={`${id}-stock-help`} value={f.stock} onChange={e => setF({ ...f, stock: e.target.value })} />
            <Hint id={`${id}-stock-help`}>{t({ en: 'Leave empty if you do not count it. Replies say "in stock" only when a count is set. Sales do not lower it.', ms: 'Biarkan kosong jika anda tidak mengiranya. Balasan hanya menyebut "ada stok" apabila kiraan ditetapkan. Jualan tidak mengurangkannya.', zh: '如不统计请留空。只有设置了数量，回复才会说“有货”。销售不会减少库存。', ta: 'எண்ணவில்லை என்றால் காலியாக விடவும். எண்ணிக்கை அமைக்கப்பட்டிருந்தால் மட்டுமே பதில்கள் "கையிருப்பில் உள்ளது" எனக் கூறும். விற்பனை இதைக் குறைக்காது.' })}</Hint>
          </label>
          {showPrice && (
            <fieldset className="min-w-0 sm:col-span-2">
              <legend className="mb-1 text-sm font-semibold">{t({ en: 'Prices by size and quantity (optional)', ms: 'Harga mengikut saiz dan kuantiti (pilihan)', zh: '按尺寸和数量定价（可选）', ta: 'அளவு மற்றும் எண்ணிக்கை வாரியான விலைகள் (விருப்பம்)' })}</legend>
              <p id={`${id}-tier-help`} className="mb-2 text-sm text-muted">{t({ en: 'Each row is the price per unit from that quantity up. The largest minimum the order reaches is used. "Any size" applies to sizes without their own rows.', ms: 'Setiap baris ialah harga seunit dari kuantiti itu ke atas. Minimum terbesar yang dicapai pesanan digunakan. "Mana-mana saiz" terpakai pada saiz tanpa baris sendiri.', zh: '每一行是从该数量起的单价。使用订单达到的最大起订量。“任意尺寸”适用于没有单独行的尺寸。', ta: 'ஒவ்வொரு வரிசையும் அந்த அளவிலிருந்து மேல் ஒரு அலகின் விலை. ஆர்டர் எட்டும் மிகப்பெரிய குறைந்தபட்சம் பயன்படுத்தப்படும். "எந்த அளவும்" தனி வரிசை இல்லாத அளவுகளுக்குப் பொருந்தும்.' })}</p>
              {tiers.length > 0 && (
                <ul className="grid gap-2">
                  {tiers.map((row, i) => {
                    const set = (k: keyof TierRow, v: string) => setTiers(ts => ts.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
                    const sizes = f.sizes.split(',').map(s => s.trim()).filter(Boolean)
                    return (
                      <li key={i} className="grid grid-cols-2 items-end gap-2 rounded-ui border border-soft p-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                        <label className="flex min-w-0 flex-col gap-1 text-sm">{t({ en: 'Size', ms: 'Saiz', zh: '尺寸', ta: 'அளவு' })}
                          <select className="input" value={row.size} onChange={e => set('size', e.target.value)}>
                            <option value="">{t(S.anySize)}</option>
                            {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                            {row.size && !sizes.includes(row.size) && <option value={row.size}>{row.size} {t({ en: '(not in sizes)', ms: '(tiada dalam saiz)', zh: '（不在尺寸中）', ta: '(அளவுகளில் இல்லை)' })}</option>}
                          </select>
                        </label>
                        <label className="flex min-w-0 flex-col gap-1 text-sm">{t({ en: 'From quantity', ms: 'Dari kuantiti', zh: '起始数量', ta: 'இந்த அளவு முதல்' })}
                          <input className="input" inputMode="decimal" value={row.min_qty} onChange={e => set('min_qty', e.target.value)} />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1 text-sm">{t({ en: 'Price each', ms: 'Harga seunit', zh: '单价', ta: 'ஒவ்வொன்றின் விலை' })}
                          <input className="input" inputMode="decimal" value={row.price} onChange={e => set('price', e.target.value)} />
                        </label>
                        <button type="button" className="btn" onClick={() => setTiers(ts => ts.filter((_, j) => j !== i))}>{t({ en: 'Remove', ms: 'Buang', zh: '移除', ta: 'நீக்கு' })}<span className="sr-only"> {t({ en: `price row ${i + 1}`, ms: `baris harga ${i + 1}`, zh: `价格行 ${i + 1}`, ta: `விலை வரிசை ${i + 1}` })}</span></button>
                      </li>
                    )
                  })}
                </ul>
              )}
              <button type="button" className="btn mt-2" aria-describedby={`${id}-tier-help`} onClick={() => setTiers(ts => [...ts, { size: '', min_qty: '1', price: '' }])}>{t({ en: 'Add a price row', ms: 'Tambah baris harga', zh: '添加价格行', ta: 'விலை வரிசையைச் சேர்' })}</button>
            </fieldset>
          )}
          {formErr && <p role="alert" className="text-sm text-warn sm:col-span-2">{formErr}</p>}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t(S.saving) : t({ en: 'Save changes', ms: 'Simpan perubahan', zh: '保存更改', ta: 'மாற்றங்களைச் சேமி' })}</button>
            <button type="button" className="btn" onClick={() => setEdit(false)}>{t(S.cancel)}</button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-hairline pt-3">
          <MoreMenu label={t({ en: `More for product ${n}`, ms: `Lagi untuk produk ${n}`, zh: `产品 ${n} 的更多操作`, ta: `பொருள் ${n} க்கான மேலும்` })}>
            <button type="button" data-close className="sidelink w-full text-left" onClick={open}>{t({ en: `Edit product ${n}`, ms: `Sunting produk ${n}`, zh: `编辑产品 ${n}`, ta: `பொருள் ${n} ஐத் திருத்து` })}</button>
            <button type="button" data-close className="sidelink w-full text-left" onClick={() => setMasking(true)}>{it.cutout_url ? t({ en: `Edit cut-out of product ${n}`, ms: `Sunting keratan produk ${n}`, zh: `编辑产品 ${n} 的抠图`, ta: `பொருள் ${n} இன் வெட்டுப்படத்தைத் திருத்து` }) : t({ en: `Cut out product ${n}`, ms: `Keratkan produk ${n}`, zh: `抠出产品 ${n}`, ta: `பொருள் ${n} ஐ வெட்டு` })}</button>
            <button type="button" data-close className="sidelink w-full text-left" aria-expanded={asking} aria-controls={`${id}-ask`} onClick={() => setAsking(!asking)}>{t({ en: `Ask suppliers about product ${n}`, ms: `Tanya pembekal tentang produk ${n}`, zh: `就产品 ${n} 询问供应商`, ta: `பொருள் ${n} பற்றி சப்ளையர்களிடம் கேள்` })}</button>
            {!off && <button type="button" data-close className="sidelink w-full text-left text-warn" aria-disabled={busy || undefined} onClick={() => setConfirmOff(true)}>{t({ en: `Discard product ${n}`, ms: `Buang produk ${n}`, zh: `丢弃产品 ${n}`, ta: `பொருள் ${n} ஐ நிராகரி` })}</button>}
          </MoreMenu>
          {it.status !== 'confirmed' && (
            <button type="button" className="btn btn-primary" aria-disabled={busy || undefined} onClick={() => patch({ status: 'confirmed' })}>
              {off ? t({ en: `Restore and confirm product ${n}`, ms: `Pulihkan dan sahkan produk ${n}`, zh: `恢复并确认产品 ${n}`, ta: `பொருள் ${n} ஐ மீட்டு உறுதிசெய்` }) : t({ en: `Confirm product ${n}`, ms: `Sahkan produk ${n}`, zh: `确认产品 ${n}`, ta: `பொருள் ${n} ஐ உறுதிசெய்` })}
            </button>
          )}
        </div>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-warn">{err}</p>}
      <ConfirmDialog open={confirmOff} danger title={t({ en: `Discard product ${n}?`, ms: `Buang produk ${n}?`, zh: `丢弃产品 ${n}？`, ta: `பொருள் ${n} ஐ நிராகரிக்கவா?` })} confirmLabel={t({ en: 'Discard', ms: 'Buang', zh: '丢弃', ta: 'நிராகரி' })} body={t({ en: 'It is kept in this photo as discarded, and you can restore it later.', ms: 'Ia disimpan dalam foto ini sebagai dibuang, dan anda boleh memulihkannya kemudian.', zh: '它会作为已丢弃保留在这张照片中，您以后可以恢复。', ta: 'இது இந்தப் படத்தில் நிராகரிக்கப்பட்டதாகவே இருக்கும்; பின்னர் மீட்டெடுக்கலாம்.' })}
        onCancel={() => setConfirmOff(false)} onConfirm={() => { setConfirmOff(false); patch({ status: 'discarded' }) }} />

      {asking && (
        <form id={`${id}-ask`} className="mt-3 grid gap-3 border-t border-soft pt-3" onSubmit={e => { e.preventDefault(); ask() }}>
          <fieldset className="min-w-0">
            <legend className="mb-1 text-sm font-semibold">{t(S.chooseSup)}</legend>
            {supErr?.error ? <div role="alert" className="text-sm text-warn"><p>{supErr.error}</p><button type="button" className="btn mt-2" onClick={supErr.reload}>{t({ en: 'Retry loading', ms: 'Cuba muat semula', zh: '重新加载', ta: 'மீண்டும் ஏற்று' })}</button></div> : suppliers.length === 0 ? <p className="text-sm text-muted">{t({ en: 'No suppliers yet. Add one under Contacts first.', ms: 'Belum ada pembekal. Tambah satu di bawah Kenalan dahulu.', zh: '还没有供应商。请先在“联系人”中添加。', ta: 'இன்னும் சப்ளையர்கள் இல்லை. முதலில் தொடர்புகளில் ஒன்றைச் சேர்க்கவும்.' })}</p> : (
              <ul className="grid gap-1">
                {suppliers.map(s => (
                  <li key={s.id}>
                    <label className="flex min-h-11 items-center gap-3 rounded-ui border border-soft bg-surface px-3 text-sm">
                      <input type="checkbox" className="size-5 shrink-0" checked={picked.includes(s.id)} onChange={() => setPicked(p => (p.includes(s.id) ? p.filter(x => x !== s.id) : [...p, s.id]))} />
                      <span className="min-w-0 break-words"><span className="font-semibold">{s.name}</span> <span className="text-muted">{s.contact ?? t(S.noNumber)}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
          <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Ask (optional, up to 300 characters)', ms: 'Soalan (pilihan, sehingga 300 aksara)', zh: '询问内容（可选，最多 300 个字符）', ta: 'கேள்வி (விருப்பம், 300 எழுத்துகள் வரை)' })}
            <textarea className="input min-h-20 py-2 font-normal" maxLength={300} value={note} onChange={e => setNote(e.target.value)} />
          </label>
          {askErr && <p role="alert" className="text-sm text-warn">{askErr}</p>}
          <div><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t(S.sending) : t(S.sendWa)}</button></div>
        </form>
      )}
      {res && (
        <div role="status" className="mt-3 rounded-ui border border-soft p-3 text-sm">
          <p className="font-semibold">{t({ en: `Asked about product ${n}`, ms: `Ditanya tentang produk ${n}`, zh: `已就产品 ${n} 询问`, ta: `பொருள் ${n} பற்றி கேட்கப்பட்டது` })}</p>
          <ul className="mt-1 grid gap-1">
            {res.sends.map(s => <li key={s.supplier_id}><span className="font-semibold">{nameOf(s.supplier_id)}</span>: {s.status === 'sent' ? t({ en: 'sent', ms: 'dihantar', zh: '已发送', ta: 'அனுப்பப்பட்டது' }) : <span className="text-warn">{t({ en: 'not sent.', ms: 'tidak dihantar.', zh: '未发送。', ta: 'அனுப்பப்படவில்லை.' })} {s.error ?? t({ en: 'No reason was given.', ms: 'Tiada sebab diberikan.', zh: '未说明原因。', ta: 'காரணம் கொடுக்கப்படவில்லை.' })}</span>}</li>)}
          </ul>
          <p className="mt-1 text-muted">{t({ en: 'Replies appear under Ask suppliers.', ms: 'Balasan dipaparkan di bawah Tanya pembekal.', zh: '回复会显示在“询问供应商”中。', ta: 'பதில்கள் "சப்ளையர்களிடம் கேள்" இல் தோன்றும்.' })}</p>
        </div>
      )}
    </li>
  )
}

// ---------- Whole photo + products ----------
function DetailView({ id, showPrice, suppliers, supErr, onList }: { id: string; showPrice: boolean; suppliers: Supplier[]; supErr?: { error?: string; reload: () => void }; onList: () => void }) {
  useLang()
  const s = useFetch<Detail>(`/listings/${id}`)
  const cats = useFetch<string[]>('/listings/categories')
  const jump = (itemId: string) => { const el = document.getElementById(`it-${itemId}`); el?.scrollIntoView({ block: 'center' }); el?.focus() }
  const d = s.data
  return (
    <section aria-labelledby="cat-d" className="mt-8 border-t border-hairline pt-6">
      <h2 id="cat-d" className="mb-1 text-md font-semibold">{photoFrom(d && when(d.created_at))}</h2>
      <p className="mb-3"><a className="link inline-flex min-h-11 items-center" href="#/catalog">{t({ en: 'Close this photo', ms: 'Tutup foto ini', zh: '关闭此照片', ta: 'இந்தப் படத்தை மூடு' })}</a></p>
      <Async s={s} rows={4} shape="detail" empty={d && !d.items.length} emptyText={t({ en: 'No products were found in this photo.', ms: 'Tiada produk ditemui dalam foto ini.', zh: '在这张照片中没有找到产品。', ta: 'இந்தப் படத்தில் பொருட்கள் எதுவும் கிடைக்கவில்லை.' })} emptyHint={t({ en: 'Try a sharper photo with the labels facing the camera.', ms: 'Cuba foto yang lebih jelas dengan label menghadap kamera.', zh: '请换一张更清晰、标签朝向镜头的照片。', ta: 'லேபிள்கள் கேமராவை நோக்கி இருக்கும் தெளிவான படத்தை முயற்சிக்கவும்.' })}>
        {d && (
          <>
            <p className="mb-2 text-sm text-muted">{d.party_name ? t({ en: `Supplier: ${d.party_name}. `, ms: `Pembekal: ${d.party_name}. `, zh: `供应商：${d.party_name}。`, ta: `சப்ளையர்: ${d.party_name}. ` }) : ''}{d.note ? t({ en: `Note: ${d.note}. `, ms: `Nota: ${d.note}. `, zh: `备注：${d.note}。`, ta: `குறிப்பு: ${d.note}. ` }) : ''}{t({ en: 'Numbered outlines mark each product; select one to jump to its card.', ms: 'Garis bernombor menandakan setiap produk; pilih satu untuk melompat ke kadnya.', zh: '编号轮廓标出每个产品；选择一个即可跳到它的卡片。', ta: 'எண்ணிடப்பட்ட வெளிக்கோடுகள் ஒவ்வொரு பொருளையும் குறிக்கும்; ஒன்றைத் தேர்ந்தெடுத்தால் அதன் அட்டைக்குச் செல்லும்.' })}</p>
            <div className="relative mb-4 w-fit max-w-full">
              <Pic url={d.image_url} alt={t(S.wholePhoto)} className="block h-auto max-w-full rounded-ui border border-soft" />
              {d.items.map((it, i) => {
                const [x0, y0, x1, y1] = it.bbox
                return (
                  <button key={it.id} type="button" aria-label={t({ en: `Product ${i + 1}: ${it.description}, ${t(BADGE[it.status])}`, ms: `Produk ${i + 1}: ${it.description}, ${t(BADGE[it.status])}`, zh: `产品 ${i + 1}：${it.description}，${t(BADGE[it.status])}`, ta: `பொருள் ${i + 1}: ${it.description}, ${t(BADGE[it.status])}` })} onClick={() => jump(it.id)}
                    style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }}
                    className={`absolute border-2 bg-transparent p-0 text-left ${it.status === 'discarded' ? 'border-dashed' : ''} border-accent hover:bg-tint/30`}>
                    <span aria-hidden="true" className="absolute left-0 top-0 min-w-5 bg-accent px-1 text-xs font-bold text-on-accent">{i + 1}</span>
                  </button>
                )
              })}
            </div>
            <ul className="grid gap-4">
              {d.items.map((it, i) => <ItemCard key={it.id} lid={id} n={i + 1} it={it} cats={cats.data ?? []} showPrice={showPrice} suppliers={suppliers} supErr={supErr} onChanged={() => { s.reload(); cats.reload(); onList() }} />)}
            </ul>
          </>
        )}
      </Async>
    </section>
  )
}

// Recent photos as a grid of the photos themselves. The photo and the date open the full review; View (beside the date)
// shows the photo and its products in a dialog without leaving the list.
function Gallery({ rows, current, onView }: { rows: ListingRow[]; current?: string; onView: (id: string) => void }) {
  useLang()
  return (
    <ul aria-label={t({ en: 'Recent catalog photos, newest first', ms: 'Foto katalog terkini, terbaru dahulu', zh: '最近的目录照片，最新的在前', ta: 'சமீபத்திய பட்டியல் படங்கள், புதியது முதலில்' })} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {rows.map(l => (
        <li key={l.id} className={`overflow-hidden rounded-ui border bg-surface hover:border-accent ${l.id === current ? 'border-accent ring-2 ring-accent' : 'border-hairline'}`}>
          <a href={`#/catalog/${l.id}`} aria-current={l.id === current ? 'page' : undefined} tabIndex={-1} aria-hidden="true" className="flex aspect-4/3 items-center justify-center bg-tint">
            <Pic url={l.thumb_url ?? l.image_url} alt="" className="size-full object-cover" />
          </a>
          <div className="grid gap-1 p-2 text-sm">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <a href={`#/catalog/${l.id}`} aria-current={l.id === current ? 'page' : undefined} className="font-semibold hover:underline"><time dateTime={l.created_at}>{when(l.created_at)}</time></a>
              <button type="button" className="btn min-h-8 px-3 text-sm" data-guide="cat-view" onClick={() => onView(l.id)}>{t({ en: 'View', ms: 'Lihat', zh: '查看', ta: 'பார்' })}<span className="sr-only"> {t({ en: `photo and details from ${when(l.created_at)}`, ms: `foto dan butiran dari ${when(l.created_at)}`, zh: `${when(l.created_at)} 的照片和详细信息`, ta: `${when(l.created_at)} இன் படமும் விவரங்களும்` })}</span></button>
            </span>
            <span className="truncate text-muted">{l.party_name ?? t(S.noSup)}</span>
            <span className="flex flex-wrap items-center gap-2"><span className="tabular-nums">{t({ en: `${l.items} ${l.items === 1 ? 'product' : 'products'}`, ms: `${l.items} produk`, zh: `${l.items} 个产品`, ta: `${l.items} பொருட்கள்` })}</span><Chip v={l.to_review ? 'needs_review' : 'confirmed'} /></span>
          </div>
        </li>
      ))}
    </ul>
  )
}

// The photo and its products at a glance, from the list (View beside the date). The full review stays at #/catalog/<id>.
function PhotoDialog({ id, showPrice, onClose }: { id: string; showPrice: boolean; onClose: () => void }) {
  useLang()
  const ref = useRef<HTMLDialogElement>(null)
  const s = useFetch<Detail>(`/listings/${id}`)
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal() }, [])
  const d = s.data
  const counts = d ? (['confirmed', 'needs_review', 'discarded'] as const).map(k => [k, d.items.filter(i => i.status === k).length] as const) : []
  return (
    <dialog ref={ref} aria-labelledby="pd-title" onCancel={e => { e.preventDefault(); onClose() }} onClose={onClose}
      className="m-auto open:flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden w-[calc(100%-2rem)] max-w-3xl rounded-card bg-surface p-0 text-ink shadow-3 backdrop:bg-ink/50">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline p-4">
        <div className="min-w-0">
          <h2 id="pd-title" className="text-md font-semibold">{photoFrom(d && when(d.created_at))}</h2>
          {d && <p className="text-sm text-muted">{d.party_name ? t({ en: `Supplier: ${d.party_name}`, ms: `Pembekal: ${d.party_name}`, zh: `供应商：${d.party_name}`, ta: `சப்ளையர்: ${d.party_name}` }) : t(S.noSup)}{d.note ? ` · ${d.note}` : ''}</p>}
        </div>
        <button type="button" className="btn" onClick={onClose} autoFocus>{t(S.close)}</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <Async s={s} rows={3} shape="detail">
          {d && (
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Pic url={d.image_url} alt={t(S.wholePhoto)} className="block h-auto max-w-full rounded-ui border border-soft" />
              <div className="min-w-0">
                <p className="mb-2 flex flex-wrap gap-2 text-sm">{counts.map(([k, n]) => <span key={k} className="inline-flex items-center gap-1"><Chip v={k} />{n}</span>)}</p>
                <ul className="grid gap-2">
                  {d.items.map((it, n) => (
                    <li key={it.id} className="flex gap-3 rounded-ui border border-hairline p-2 text-sm">
                      <Pic url={it.crop_url} alt={t({ en: `Product ${n + 1}`, ms: `Produk ${n + 1}`, zh: `产品 ${n + 1}`, ta: `பொருள் ${n + 1}` })} className="h-14 w-14 shrink-0 rounded-ui object-contain" />
                      <div className="min-w-0">
                        <p className="break-words font-semibold">{n + 1}. {it.description}</p>
                        <p className="text-muted">{[it.sku && `SKU ${it.sku}`, it.sizes.length ? t({ en: `Sizes ${it.sizes.join(', ')}`, ms: `Saiz ${it.sizes.join(', ')}`, zh: `尺寸 ${it.sizes.join(', ')}`, ta: `அளவுகள் ${it.sizes.join(', ')}` }) : '', showPrice && it.price !== null ? money(it.currency, it.price) : '',
                          it.stock_qty != null ? t({ en: `Stock ${qtyText(it.stock_qty)}`, ms: `Stok ${qtyText(it.stock_qty)}`, zh: `库存 ${qtyText(it.stock_qty)}`, ta: `இருப்பு ${qtyText(it.stock_qty)}` }) : ''].filter(Boolean).join(' · ') || t({ en: 'No details yet', ms: 'Belum ada butiran', zh: '暂无详细信息', ta: 'இன்னும் விவரங்கள் இல்லை' })}</p>
                        <Chip v={it.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </Async>
      </div>
      <div className="flex shrink-0 justify-end border-t border-hairline p-4">
        <a className="btn btn-primary" href={`#/catalog/${id}`} onClick={onClose}>{t({ en: 'Open to review and edit', ms: 'Buka untuk semak dan sunting', zh: '打开以审核和编辑', ta: 'மதிப்பாய்வு செய்து திருத்த திற' })}</a>
      </div>
    </dialog>
  )
}


export function CatalogView({ me, owner, id }: { me?: Me; owner: boolean; id?: string }) {
  useLang()
  const list = useFetch<ListingRow[]>('/listings')
  const sup = useFetch<Supplier[]>('/contacts?role=supplier')
  const [up, setUp] = useState<boolean>()
  const [viewing, setViewing] = useState<string>()
  const upOpen = up ?? (list.loading && !list.data ? false : !list.data?.length)  // open until the first photo exists
  return (
    <>
      <PageHeader title={t({ en: 'Catalog photos', ms: 'Foto katalog', zh: '目录照片', ta: 'பட்டியல் படங்கள்' })} description={t({ en: 'Photograph shelves of labelled products, then check what LARIS read.', ms: 'Ambil foto rak produk berlabel, kemudian semak apa yang dibaca LARIS.', zh: '拍摄带标签产品的货架，然后核对 LARIS 识别的内容。', ta: 'லேபிளிட்ட பொருட்களின் அடுக்குகளைப் புகைப்படம் எடுங்கள், பின்னர் LARIS படித்ததைச் சரிபார்க்கவும்.' })}
        actions={<button type="button" className={`btn ${upOpen ? '' : 'btn-primary'}`} aria-expanded={upOpen} aria-controls="cat-up" data-guide="cat-upload" onClick={() => setUp(!upOpen)}>{t({ en: 'Upload photo', ms: 'Muat naik foto', zh: '上传照片', ta: 'படத்தைப் பதிவேற்று' })}</button>} />
      {upOpen && <UploadCard owner={owner} suppliers={sup.data ?? []} onDone={lid => { list.reload(); location.hash = `#/catalog/${lid}` }} />}
      <section aria-labelledby="cat-list" className="mt-8" data-guide="cat-list">
        <h2 id="cat-list" className="mb-3 text-md font-semibold">{t({ en: 'Recent photos', ms: 'Foto terkini', zh: '最近的照片', ta: 'சமீபத்திய படங்கள்' })}</h2>
        <Async s={list} rows={5} shape="table" empty={!list.data?.length} emptyText={t({ en: 'No catalog photos yet.', ms: 'Belum ada foto katalog.', zh: '还没有目录照片。', ta: 'இன்னும் பட்டியல் படங்கள் இல்லை.' })} emptyHint={t({ en: 'Photograph a page or shelf of labelled products and LARIS lists each one for you to check.', ms: 'Ambil foto halaman atau rak produk berlabel dan LARIS menyenaraikan setiap satu untuk anda semak.', zh: '拍摄一页或一架带标签的产品，LARIS 会逐一列出供您核对。', ta: 'லேபிளிட்ட பொருட்களின் ஒரு பக்கம் அல்லது அடுக்கைப் புகைப்படம் எடுங்கள்; LARIS ஒவ்வொன்றையும் பட்டியலிடும், நீங்கள் சரிபார்க்கலாம்.' })}
          emptyAction={{ label: t({ en: 'Read your first catalog photo', ms: 'Baca foto katalog pertama anda', zh: '识别您的第一张目录照片', ta: 'உங்கள் முதல் பட்டியல் படத்தைப் படி' }), onClick: () => { setUp(true); requestAnimationFrame(() => { const f = document.getElementById('cat-file'); f?.scrollIntoView({ block: 'center' }); f?.focus() }) } }}>
          <Gallery rows={list.data ?? []} current={id} onView={setViewing} />
        </Async>
      </section>
      {viewing && <PhotoDialog key={viewing} id={viewing} showPrice={canSeePrice(me, owner)} onClose={() => setViewing(undefined)} />}
      {id && <DetailView key={id} id={id} showPrice={canSeePrice(me, owner)} suppliers={sup.data ?? []} supErr={sup} onList={list.reload} />}
    </>
  )
}

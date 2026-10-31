import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, download, NEXT, MOCK, can, needs, why, ApiError } from './api'
import { QuotePanel, Messages } from './QuoteDoc'
import { Timeline } from './Timeline'
import { useToast } from './Toast'
import { rm, stageLabel, msg, REVIEWABLE, focusTop, useFetch, Async, PageHeader, TableRegion, Status } from './ui'
import type { DocDetail, Line, Field } from './api'
import { locale, t, useLang } from './i18n'
import type { Text } from './i18n'
import { tx } from './strings'

// Decision-box button labels from NEXT (api.ts), by their English text.
const ACT: Record<string, Text> = {
  'Mark supplier quote parsed': { en: '', ms: 'Tandakan sebut harga pembekal telah diurai', zh: '标记供应商报价已解析', ta: 'சப்ளையர் விலைப்புள்ளி பகுப்பாய்வு செய்யப்பட்டதாகக் குறி' },
  'Reject supplier quote': { en: '', ms: 'Tolak sebut harga pembekal', zh: '拒绝供应商报价', ta: 'சப்ளையர் விலைப்புள்ளியை நிராகரி' },
  'Mark supplier quote reviewed': { en: '', ms: 'Tandakan sebut harga pembekal telah disemak', zh: '标记供应商报价已审核', ta: 'சப்ளையர் விலைப்புள்ளி மதிப்பாய்வு செய்யப்பட்டதாகக் குறி' },
  'Approve supplier quote': { en: '', ms: 'Lulus sebut harga pembekal', zh: '批准供应商报价', ta: 'சப்ளையர் விலைப்புள்ளியை அங்கீகரி' },
  'Add prices to cost book': { en: '', ms: 'Tambah harga ke buku kos', zh: '把价格加入成本册', ta: 'விலைகளை செலவுப் புத்தகத்தில் சேர்' },
  'Approve quote': { en: '', ms: 'Lulus sebut harga', zh: '批准报价', ta: 'விலைப்புள்ளியை அங்கீகரி' },
  'Cancel quote': { en: '', ms: 'Batalkan sebut harga', zh: '取消报价', ta: 'விலைப்புள்ளியை ரத்து செய்' },
  'Send quote to customer': { en: '', ms: 'Hantar sebut harga kepada pelanggan', zh: '把报价发给客户', ta: 'விலைப்புள்ளியை வாடிக்கையாளருக்கு அனுப்பு' },
  'Record customer accepted': { en: '', ms: 'Rekod pelanggan menerima', zh: '记录客户已接受', ta: 'வாடிக்கையாளர் ஏற்றதாகப் பதிவு செய்' },
  'Record customer rejected': { en: '', ms: 'Rekod pelanggan menolak', zh: '记录客户已拒绝', ta: 'வாடிக்கையாளர் நிராகரித்ததாகப் பதிவு செய்' },
  'Create job from quote': { en: '', ms: 'Cipta kerja daripada sebut harga', zh: '根据报价创建工单', ta: 'விலைப்புள்ளியிலிருந்து வேலையை உருவாக்கு' },
}
const S = {
  notSet: { en: 'Not set', ms: 'Belum ditetapkan', zh: '未设置', ta: 'அமைக்கப்படவில்லை' },
  yes: { en: 'Yes', ms: 'Ya', zh: '是', ta: 'ஆம்' },
  no: { en: 'No', ms: 'Tidak', zh: '否', ta: 'இல்லை' },
  needsReview: { en: 'Needs review', ms: 'Perlu semakan', zh: '需审核', ta: 'மதிப்பாய்வு தேவை' },
  unmapped: { en: 'Unmapped field: ', ms: 'Medan tidak dipetakan: ', zh: '未映射字段：', ta: 'வரைபடமிடப்படாத புலம்: ' },
  hidden: { en: 'Hidden for staff', ms: 'Disembunyikan untuk kakitangan', zh: '对员工隐藏', ta: 'ஊழியர்களுக்கு மறைக்கப்பட்டது' },
  saving: { en: 'Saving...', ms: 'Menyimpan...', zh: '保存中...', ta: 'சேமிக்கிறது...' },
  document: { en: 'Document', ms: 'Dokumen', zh: '文档', ta: 'ஆவணம்' },
  noDelivery: { en: 'No chat contact on file, so nothing was sent.', ms: 'Tiada kenalan sembang direkodkan, jadi tiada apa dihantar.', zh: '未记录聊天联系方式，因此未发送任何内容。', ta: 'அரட்டைத் தொடர்பு பதிவில் இல்லை, எனவே எதுவும் அனுப்பப்படவில்லை.' },
  failed: { en: 'Marked as sent, but the message to the customer did not go through. Send the quote PDF by hand.', ms: 'Ditandakan sebagai dihantar, tetapi mesej kepada pelanggan tidak berjaya. Hantar PDF sebut harga secara manual.', zh: '已标记为已发送，但发给客户的消息未能送出。请手动发送报价 PDF。', ta: 'அனுப்பப்பட்டதாகக் குறிக்கப்பட்டது, ஆனால் வாடிக்கையாளருக்கான செய்தி செல்லவில்லை. மேற்கோள் PDF ஐக் கைமுறையாக அனுப்பவும்.' },
  noDocNo: { en: 'No document number', ms: 'Tiada nombor dokumen', zh: '无文档编号', ta: 'ஆவண எண் இல்லை' },
  stale: { en: 'Cost is stale', ms: 'Kos sudah lapuk', zh: '成本已过时', ta: 'செலவு பழையது' },
  total: { en: 'Total', ms: 'Jumlah', zh: '合计', ta: 'மொத்தம்' },
  bom: { en: 'Download BOM (xlsx)', ms: 'Muat turun BOM (xlsx)', zh: '下载物料清单 BOM (xlsx)', ta: 'BOM ஐப் பதிவிறக்கு (xlsx)' },
  po: { en: 'Download purchase list (csv)', ms: 'Muat turun senarai pembelian (csv)', zh: '下载采购清单 (csv)', ta: 'கொள்முதல் பட்டியலைப் பதிவிறக்கு (csv)' },
  lines: { en: 'Lines', ms: 'Baris', zh: '明细行', ta: 'வரிகள்' },
  editNeeds: { en: ' to edit these lines. You can read them here.', ms: ' untuk mengedit baris ini. Anda boleh membacanya di sini.', zh: ' 才能编辑这些行。您可以在此查看。', ta: ' இந்த வரிகளைத் திருத்த. இங்கே படிக்கலாம்.' },
  reviewStep: { en: 'Review step: set the item key and quantity for each line, then save the line. The item key is a short code that links the line to your cost book, for example acrylic_3mm_sheet. Lines marked Needs review are unclear on the source document.', ms: 'Langkah semakan: tetapkan kunci item dan kuantiti bagi setiap baris, kemudian simpan baris. Kunci item ialah kod pendek yang memautkan baris kepada buku kos anda, contohnya acrylic_3mm_sheet. Baris bertanda Perlu semakan tidak jelas pada dokumen sumber.', zh: '审核步骤：为每一行设置物料代码和数量，然后保存该行。物料代码是一个简短的代码，用来把该行与您的成本簿关联，例如 acrylic_3mm_sheet。标有“需审核”的行在源文档中不够清晰。', ta: 'மதிப்பாய்வு படி: ஒவ்வொரு வரிக்கும் பொருள் குறியீடு மற்றும் அளவை அமைத்து, பின் வரியைச் சேமிக்கவும். பொருள் குறியீடு என்பது வரியை உங்கள் செலவுப் புத்தகத்துடன் இணைக்கும் குறுகிய குறியீடு, எடுத்துக்காட்டாக acrylic_3mm_sheet. "மதிப்பாய்வு தேவை" எனக் குறிக்கப்பட்ட வரிகள் மூல ஆவணத்தில் தெளிவாக இல்லை.' },
  noLines: { en: 'This document has no lines.', ms: 'Dokumen ini tiada baris.', zh: '此文档没有明细行。', ta: 'இந்த ஆவணத்தில் வரிகள் இல்லை.' },
  thNo: { en: 'No.', ms: 'No.', zh: '序号', ta: 'எண்' },
  thDesc: { en: 'Description', ms: 'Perihalan', zh: '描述', ta: 'விவரம்' },
  thKey: { en: 'Item key', ms: 'Kunci item', zh: '物料代码', ta: 'பொருள் குறியீடு' },
  thQty: { en: 'Qty', ms: 'Kuantiti', zh: '数量', ta: 'அளவு' },
  thUnit: { en: 'Unit', ms: 'Unit', zh: '单位', ta: 'அலகு' },
  thTotal: { en: 'Line total', ms: 'Jumlah baris', zh: '行合计', ta: 'வரி மொத்தம்' },
  perUnit: { en: 'per', ms: 'setiap', zh: '每', ta: 'ஒவ்வொரு' },
  thCost: { en: 'Unit cost', ms: 'Kos seunit', zh: '单位成本', ta: 'அலகு செலவு' },
  thPrice: { en: 'Unit price', ms: 'Harga seunit', zh: '单价', ta: 'அலகு விலை' },
  thAction: { en: 'Action', ms: 'Tindakan', zh: '操作', ta: 'செயல்' },
  decision: { en: 'Decision', ms: 'Keputusan', zh: '决定', ta: 'முடிவு' },
  linkWaiting: { en: 'The customer answers on the link we sent, and their answer is recorded here by itself. There is nothing to record by hand.', ms: 'Pelanggan menjawab melalui pautan yang kami hantar, dan jawapan mereka direkodkan di sini secara automatik. Tiada apa perlu direkod secara manual.', zh: '客户在我们发出的链接上作答，答复会自动记录在这里，无需手动记录。', ta: 'நாங்கள் அனுப்பிய இணைப்பில் வாடிக்கையாளர் பதிலளிக்கிறார்; அவர் பதில் இங்கே தானாகப் பதிவாகும். கையால் பதிவு செய்ய எதுவும் இல்லை.' },
  linkSent: { en: 'Link sent', ms: 'Pautan dihantar', zh: '链接已发出', ta: 'இணைப்பு அனுப்பப்பட்டது' }, linkOpened: { en: 'opened by the customer', ms: 'dibuka oleh pelanggan', zh: '客户已打开', ta: 'வாடிக்கையாளர் திறந்தார்' }, linkNotOpened: { en: 'not opened yet', ms: 'belum dibuka', zh: '尚未打开', ta: 'இன்னும் திறக்கப்படவில்லை' }, linkEnds: { en: 'Works until', ms: 'Sah sehingga', zh: '有效期至', ta: 'செல்லுபடியாகும் வரை' },
  ownerDecides: { en: 'Only the owner can decide on this quote. Switch the simulated role to owner to try it.', ms: 'Hanya pemilik boleh membuat keputusan mengenai sebut harga ini. Tukar peranan simulasi kepada pemilik untuk mencubanya.', zh: '只有所有者可以对此报价作决定。将模拟角色切换为所有者即可试用。', ta: 'இந்த மேற்கோளில் உரிமையாளர் மட்டுமே முடிவு செய்ய முடியும். முயற்சிக்க, உருவகப்படுத்தப்பட்ட பங்கை உரிமையாளராக மாற்றவும்.' },
  reason: { en: 'Reason (optional, saved to the activity log)', ms: 'Sebab (pilihan, disimpan dalam log audit)', zh: '原因（可选，将保存到审计日志）', ta: 'காரணம் (விருப்பம், தணிக்கைப் பதிவில் சேமிக்கப்படும்)' },
  working: { en: 'Working...', ms: 'Memproses...', zh: '处理中...', ta: 'செயல்படுகிறது...' },
  prov: { en: 'Cost provenance', ms: 'Asal usul kos', zh: '成本来源', ta: 'செலவு மூலம்' },
  ownerOnly: { en: '(owner only)', ms: '(pemilik sahaja)', zh: '（仅限所有者）', ta: '(உரிமையாளர் மட்டும்)' },
  noProv: { en: 'No supplier cost is linked to this document.', ms: 'Tiada kos pembekal dipautkan pada dokumen ini.', zh: '此文档未关联任何供应商成本。', ta: 'இந்த ஆவணத்துடன் சப்ளையர் செலவு எதுவும் இணைக்கப்படவில்லை.' },
  costItem: { en: 'Cost item', ms: 'Item kos', zh: '成本项', ta: 'செலவு உருப்படி' },
  supplier: { en: 'Supplier', ms: 'Pembekal', zh: '供应商', ta: 'சப்ளையர்' },
  source: { en: 'Source document', ms: 'Dokumen sumber', zh: '来源文档', ta: 'மூல ஆவணம்' },
  costDate: { en: 'Cost date', ms: 'Tarikh kos', zh: '成本日期', ta: 'செலவு தேதி' },
  costUsed: { en: 'Cost used in quote', ms: 'Kos digunakan dalam sebut harga', zh: '报价所用成本', ta: 'மேற்கோளில் பயன்படுத்திய செலவு' },
  costNow: { en: 'Current cost', ms: 'Kos semasa', zh: '当前成本', ta: 'தற்போதைய செலவு' },
  lineMargin: { en: 'Line margin', ms: 'Margin baris', zh: '行利润', ta: 'வரி மார்ஜின்' },
  noCosts: { en: 'Cost and margin are not available to your role.', ms: 'Kos dan margin tidak tersedia untuk peranan anda.', zh: '您的角色无法查看成本和利润。', ta: 'உங்கள் பங்கிற்கு செலவும் மார்ஜினும் கிடைக்காது.' },
} satisfies Record<string, Text>

// ---------- Document detail ----------
function cell(f: Field, v: unknown): ReactNode {
  if (v === undefined || v === null || v === '') return <span className="text-muted">{t(S.notSet)}</span>
  if (f.type === 'boolean') return v ? t(S.yes) : t(S.no)
  return `${String(v)}${f.unit ? ' ' + f.unit : ''}`
}

function LineRow({ docId, l, cols, edit, showPrice, onSaved }: { docId: string; l: Line; cols: Field[]; edit: boolean; showPrice: boolean; onSaved: (n: number) => void }) {
  useLang()
  // `edit` = the document is still reviewable; the permission only decides whether the inputs are there (the server stays the authority).
  const editable = edit && can('upload_documents')
  const priceEdit = editable && can('view_costs') && l.unit_price !== null
  const [key, setKey] = useState(l.item_key ?? '')
  const [qty, setQty] = useState(l.qty ? String(Number(l.qty)) : '')
  const [price, setPrice] = useState(l.unit_price !== null ? String(Number(l.unit_price)) : '')
  const [uom, setUom] = useState(l.uom ?? '')
  // The total follows what is typed, so a price per 100g with a quantity in kg shows up at once (5 x RM8.00 per 100g is RM40.00, not 5 kg of it).
  const nQty = Number(qty), nPrice = Number(priceEdit ? price : l.unit_price ?? ''), disc = Number(l.discount_pct ?? 0)
  const total = qty !== '' && Number.isFinite(nQty) && l.unit_price !== null && Number.isFinite(nPrice) ? nQty * nPrice * (1 - disc / 100) : null
  const [draft, setDraft] = useState<string | null>(null)  // the line total while it is being typed
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const errId = `line-err-${l.id}`
  const bad = err ? { 'aria-invalid': true, 'aria-describedby': errId } : {}
  const save = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try {
      const changed = priceEdit && price !== '' && Number(price) !== Number(l.unit_price)
      const unitChanged = priceEdit && uom.trim() !== '' && uom.trim() !== (l.uom ?? '')
      await api('POST', `/documents/${docId}/lines/${l.id}`, { item_key: key.trim() || undefined, qty: qty === '' ? undefined : qty, ...(changed ? { unit_price: price } : {}), ...(unitChanged ? { uom: uom.trim() } : {}) })
      onSaved(l.line_no)
    } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  if (l.is_header) return <tr><th colSpan={7 + cols.length} scope="colgroup" className="bg-soft text-ink">{l.description}</th></tr>
  const unmapped = Object.entries(l.attrs_unmapped)
  return (
    <tr>
      <td>{l.line_no}</td>
      <td>
        {l.description}
        {l.needs_review && <span className="badge badge-warn ml-2">{t(S.needsReview)}{l.ocr_confidence !== null ? `, OCR ${Math.round(Number(l.ocr_confidence) * 100)}%` : ''}</span>}
        {unmapped.length > 0 && <p className="text-xs text-muted">{t(S.unmapped)}{unmapped.map(([k, v]) => `${k} = ${String(v)}`).join(', ')}</p>}
        {err && <p id={errId} role="alert" className="text-xs text-warn">{err}</p>}
      </td>
      <td>
        {editable ? <input className="input w-36" aria-label={t({ en: `Item key for line ${l.line_no}`, ms: `Kunci item untuk baris ${l.line_no}`, zh: `第 ${l.line_no} 行的物料代码`, ta: `வரி ${l.line_no} இன் பொருள் குறியீடு` })} value={key} onChange={e => setKey(e.target.value)} {...bad} /> : l.item_key ?? <span className="text-muted">{t(S.notSet)}</span>}
      </td>
      <td className="num">
        {editable ? <input className="input w-24" type="number" min="0" step="any" inputMode="decimal" aria-label={t({ en: `Quantity for line ${l.line_no}`, ms: `Kuantiti untuk baris ${l.line_no}`, zh: `第 ${l.line_no} 行的数量`, ta: `வரி ${l.line_no} இன் அளவு` })} value={qty} onChange={e => setQty(e.target.value)} {...bad} /> : l.qty ? Number(l.qty) : <span className="text-muted">{t(S.notSet)}</span>}
      </td>
      <td>{priceEdit ? <input className="input w-24" maxLength={20} value={uom} onChange={e => setUom(e.target.value)} aria-label={t({ en: `Unit for line ${l.line_no}, the unit the cost is per`, ms: `Unit untuk baris ${l.line_no}, unit yang dikenakan kos`, zh: `第 ${l.line_no} 行的单位（成本所对应的单位）`, ta: `வரி ${l.line_no} இன் அலகு (செலவு எந்த அலகுக்கானது)` })} /> : l.uom}</td>
      <td className="num">{!showPrice ? <span className="text-muted">{t(S.hidden)}</span>
        : priceEdit ? <input className="input w-28" type="number" min="0" step="any" inputMode="decimal" aria-label={t({ en: `Unit cost for line ${l.line_no}`, ms: `Kos seunit untuk baris ${l.line_no}`, zh: `第 ${l.line_no} 行的单位成本`, ta: `வரி ${l.line_no} இன் அலகு செலவு` })} value={price} onChange={e => setPrice(e.target.value)} {...bad} />
        : rm(l.unit_price)}</td>
      <td className="num">{showPrice && total !== null ? <>{priceEdit && nQty > 0
          ? <input className="input w-28 font-semibold" type="number" min="0" step="any" inputMode="decimal" aria-label={`Line total for line ${l.line_no}: sets the unit price from the quantity`} value={draft ?? total.toFixed(2)}
              onChange={e => { setDraft(e.target.value); const v = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(v)) setPrice(String(+(v / (nQty * (1 - disc / 100))).toFixed(6))) }} onBlur={() => setDraft(null)} />
          : <span className="font-semibold tabular-nums">{rm(total.toFixed(2))}</span>}<span className="block text-xs text-muted tabular-nums">{nQty} × {rm(nPrice.toFixed(2))} {t(S.perUnit)} {uom || l.uom}</span></> : <span className="text-muted">–</span>}</td>
      {cols.map(f => <td key={f.key}>{cell(f, l.attrs[f.key])}</td>)}
      {editable && <td><button className="btn" aria-disabled={busy || undefined} onClick={save}>{busy ? t(S.saving) : t({ en: `Save line ${l.line_no}`, ms: `Simpan baris ${l.line_no}`, zh: `保存第 ${l.line_no} 行`, ta: `வரி ${l.line_no} ஐச் சேமி` })}</button></td>}
    </tr>
  )
}

export function DetailView({ id, owner }: { id: string; owner: boolean }) {
  useLang()
  const costs = can('view_costs')  // cost, margin and provenance follow the permission; deciding on a quote stays owner-class
  const s = useFetch<DocDetail>(`/documents/${id}`)
  const f = useFetch<Field[]>('/fields')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')  // the status being moved to, shown on that button while it runs
  const toast = useToast()
  const d = s.data
  const cols = (f.data ?? []).filter(x => x.show_in_grid).sort((a, b) => a.sort_order - b.sort_order)
  const link = d?.doc.accept_link ?? null
  // While the customer's link is live it records their answer, so the buttons that record it by hand are not offered (they come back if the link ends unused).
  const waitingOnLink = !!d && !!link && d.doc.direction === 'out' && ['sent', 'read'].includes(d.doc.status)
  const actions = (d ? NEXT[d.doc.direction][d.doc.status] ?? [] : []).filter(a => !(waitingOnLink && ['accepted', 'rejected'].includes(a.to)))
  const edit = !!d && d.doc.direction === 'in' && REVIEWABLE.includes(d.doc.status)
  const docNo = d?.doc.id === id ? d.doc.doc_no ?? t(S.document) : undefined
  // Arrived by navigation (focus is parked on main): move it to the heading once the document is there.
  useEffect(() => { if (docNo && document.activeElement === document.getElementById('main')) focusTop() }, [docNo])
  const move = async (to: string) => {
    if (busy) return
    setBusy(to); setErr('')
    try {
      const r = await api<{ delivery?: string }>('POST', `/documents/${id}/transition`, { to, reason: reason.trim() || undefined })
      setReason(''); s.reload(); focusTop()
      const st = stageLabel(to), moved = t({ en: `${docNo} moved to ${st}.`, ms: `${docNo} dipindahkan ke ${st}.`, zh: `${docNo} 已转为${st}。`, ta: `${docNo} ${st} நிலைக்கு மாற்றப்பட்டது.` })
      if (r.delivery === 'not_sent') toast(`${moved} ${t(S.noDelivery)}`)
      else toast(moved)
      if (r.delivery === 'failed') setErr(t(S.failed))
    } catch (e) { setErr(msg(e)); if (e instanceof ApiError && e.status === 409) s.reload() } finally { setBusy('') }  // 409: the document changed under us, show its real state
  }
  const save = async (path: string, name: string) => {
    setErr('')
    try { await download(path, name); toast(t({ en: `${name} downloaded.`, ms: `${name} dimuat turun.`, zh: `已下载 ${name}。`, ta: `${name} பதிவிறக்கப்பட்டது.` })) } catch (e) { setErr(msg(e)) }
  }
  const lineOf = (lineId?: string) => d?.lines.find(l => l.id === lineId)
  return (
    <>
      {!d && <PageHeader crumbs={[{ href: '#/tracker', label: tx('nav.tracker') }]} />}
      <Async s={s} empty={false} rows={5}>
        {d && (
          <>
            <PageHeader crumbs={[{ href: '#/tracker', label: tx('nav.tracker') }, { label: d.doc.doc_no ?? t(S.noDocNo) }]} title={d.doc.doc_no ?? t(S.noDocNo)} status={<Status v={d.doc.status} />}
              meta={<>
                <span>{d.doc.direction === 'in' ? t({ en: `Supplier quote from ${d.doc.party.name}`, ms: `Sebut harga pembekal daripada ${d.doc.party.name}`, zh: `来自 ${d.doc.party.name} 的供应商报价`, ta: `${d.doc.party.name} இடமிருந்து சப்ளையர் மேற்கோள்` }) : t({ en: `Customer quote for ${d.doc.party.name}`, ms: `Sebut harga pelanggan untuk ${d.doc.party.name}`, zh: `给 ${d.doc.party.name} 的客户报价`, ta: `${d.doc.party.name} க்கான வாடிக்கையாளர் மேற்கோள்` })}</span>
                {costs && d.doc.flags.cost_is_stale && <span className="badge badge-warn">{t(S.stale)}</span>}
                <span className="text-muted">{t(S.total)} {rm(d.doc.total)}</span>
              </>}
              actions={d.doc.direction === 'out' && !MOCK && <>
                {can('export_documents') && costs && ['accepted', 'sent', 'read', 'job_created'].includes(d.doc.status) && <>
                  <button type="button" className="btn" onClick={() => save(`/export/bom.xlsx?quote_id=${id}`, `bom-${d.doc.doc_no}.xlsx`)}>{t(S.bom)}</button>
                  <button type="button" className="btn" onClick={() => save(`/export/po.csv?quote_id=${id}`, `po-${d.doc.doc_no}.csv`)}>{t(S.po)}</button>
                </>}
              </>} />

            <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
            <div className="min-w-0 lg:order-1">
            {d.doc.direction === 'out' && <QuotePanel key={id} id={id} status={d.doc.status} owner={owner} onChanged={s.reload} />}
            <h2 className="mb-2 text-md font-semibold">{t(S.lines)}</h2>
            {edit && !can('upload_documents') && <p className="mb-2 text-sm text-muted">{why('upload_documents')}{t(S.editNeeds)}</p>}
            {edit && can('upload_documents') && <p className="mb-2 text-sm text-muted">{t(S.reviewStep)}</p>}
            {f.error && <p role="alert" className="mb-2 text-sm text-warn">{t({ en: 'Could not load extra columns: ', ms: 'Tidak dapat memuatkan lajur tambahan: ', zh: '无法加载额外列：', ta: 'கூடுதல் நெடுவரிசைகளை ஏற்ற முடியவில்லை: ' })}{f.error}</p>}
            {d.lines.length === 0 ? <p className="card text-muted">{t(S.noLines)}</p> : (
              <TableRegion label={t(S.lines)}>
                <table className="w-full min-w-max">
                  <caption className="sr-only">{t({ en: `Lines of ${d.doc.doc_no ?? 'this document'}`, ms: `Baris bagi ${d.doc.doc_no ?? 'dokumen ini'}`, zh: `${d.doc.doc_no ?? '此文档'} 的明细行`, ta: `${d.doc.doc_no ?? 'இந்த ஆவணம்'} இன் வரிகள்` })}</caption>
                  <thead><tr>
                    <th scope="col">{t(S.thNo)}</th><th scope="col">{t(S.thDesc)}</th><th scope="col">{t(S.thKey)}</th><th scope="col" className="text-right">{t(S.thQty)}</th><th scope="col">{t(S.thUnit)}</th>
                    <th scope="col" className="text-right">{t(d.doc.direction === 'in' ? S.thCost : S.thPrice)}</th>
                    <th scope="col" className="text-right">{t(S.thTotal)}</th>
                    {cols.map(c => <th key={c.key} scope="col">{c.label}</th>)}
                    {edit && can('upload_documents') && <th scope="col">{t(S.thAction)}</th>}
                  </tr></thead>
                  <tbody>{d.lines.map(l => <LineRow key={l.id} docId={id} l={l} cols={cols} edit={edit} showPrice={costs || d.doc.direction === 'out' || REVIEWABLE.includes(d.doc.status)} onSaved={n => { toast(t({ en: `Line ${n} saved.`, ms: `Baris ${n} disimpan.`, zh: `第 ${n} 行已保存。`, ta: `வரி ${n} சேமிக்கப்பட்டது.` })); s.reload() }} />)}</tbody>
                </table>
              </TableRegion>
            )}
            <Messages list={d.messages} />
            </div>

            <aside className="grid gap-6 lg:order-2">
            <section className="card" aria-labelledby="actions">
              <h2 id="actions" className="text-md font-semibold">{t(S.decision)}</h2>
              {waitingOnLink && link && <div className="mt-2 grid gap-1 text-sm"><p>{t(S.linkWaiting)}</p>
                <p className="text-muted">{t(S.linkSent)} {new Date(link.created_at).toLocaleDateString(locale())}, {t(link.first_viewed_at ? S.linkOpened : S.linkNotOpened)}. {t(S.linkEnds)} {new Date(link.expires_at).toLocaleDateString(locale())}.</p></div>}
              {!actions.length && !waitingOnLink && <p className="text-sm text-muted">{t({ en: `This document is ${stageLabel(d.doc.status)}. No further actions.`, ms: `Dokumen ini ${stageLabel(d.doc.status)}. Tiada tindakan lanjut.`, zh: `此文档状态为${stageLabel(d.doc.status)}。无需进一步操作。`, ta: `இந்த ஆவணம் ${stageLabel(d.doc.status)}. மேலும் செயல்கள் இல்லை.` })}</p>}
              {actions.length > 0 && !owner && !actions.some(a => !a.owner) && <p className="text-sm text-muted">{t(S.ownerDecides)}</p>}
              {actions.some(a => !a.owner || owner) && (
                <>
                  {owner && <label className="mt-2 flex flex-col gap-1 text-sm font-semibold">{t(S.reason)}
                    <input className="input max-w-md font-normal" value={reason} onChange={e => setReason(e.target.value)} />
                  </label>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {actions.filter(a => !a.owner || owner).map(a => (
                      <button key={a.to} aria-disabled={!!busy || undefined} {...(a.owner ? { onClick: () => move(a.to) } : needs('upload_documents', () => move(a.to)))} className={`btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`}>{busy === a.to ? t(S.working) : (ACT[a.label] && t(ACT[a.label])) || a.label}</button>
                    ))}
                  </div>
                </>
              )}
              {err && <p role="alert" className="mt-2 text-sm text-warn">{err}</p>}
            </section>

            <Timeline key={id} id={id} status={d.doc.status} />

            {costs && d.provenance && (
              <section aria-labelledby="prov">
                <h2 id="prov" className="text-md font-semibold">{t(S.prov)} <span className="text-sm font-normal text-muted">{t(S.ownerOnly)}</span></h2>
                {d.provenance.length === 0 ? <p className="card mt-2 text-muted">{t(S.noProv)}</p> : (
                  <ul className="mt-2 grid gap-2">
                    {d.provenance.map(p => {
                      const ln = lineOf(p.line_id)
                      const perUnit = Number(p.cost_snapshot) - Number(p.current_unit_cost)
                      // margin impact = cost change x qty of the cost item per unit sold x units sold
                      const total = ln?.qty ? perUnit * Number(p.qty_consumed ?? 1) * Number(ln.qty) : null
                      return (
                        <li key={p.cost_item_id + p.line_id} className="card">
                          <p className="font-semibold">{ln ? t({ en: `Line ${ln.line_no}: ${ln.description}`, ms: `Baris ${ln.line_no}: ${ln.description}`, zh: `第 ${ln.line_no} 行：${ln.description}`, ta: `வரி ${ln.line_no}: ${ln.description}` }) : `${t(S.costItem)} ${p.cost_item_id}`}</p>
                          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
                            <dt className="text-muted">{t(S.supplier)}</dt><dd>{p.supplier}</dd>
                            <dt className="text-muted">{t(S.source)}</dt><dd><a className="link" href={`#/doc/${p.source_doc_id}`}>{p.source_doc_no}</a></dd>
                            <dt className="text-muted">{t(S.costDate)}</dt><dd>{p.cost_date}</dd>
                            <dt className="text-muted">{t(S.costUsed)}</dt><dd>{rm(p.cost_snapshot)}</dd>
                            <dt className="text-muted">{t(S.costNow)}</dt><dd>{rm(p.current_unit_cost)}</dd>
                            <dt className="text-muted">{t(S.lineMargin)}</dt><dd>{rm(p.line_margin)}</dd>
                          </dl>
                          {p.cost_is_stale && (
                            <p className="badge badge-warn mt-2">{(() => { const v = rm(String(Math.abs(total ?? perUnit))), u = total === null; return t({ en: `Cost is stale: margin down ${v}${u ? ' per unit' : ''}`, ms: `Kos lapuk: margin turun ${v}${u ? ' seunit' : ''}`, zh: `成本已过时：利润减少 ${v}${u ? ' /单位' : ''}`, ta: `செலவு பழையது: மார்ஜின் குறைவு ${v}${u ? ' / அலகு' : ''}` }) })()}</p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )}
            {!costs && <p className="text-sm text-muted">{t(S.noCosts)}</p>}
            </aside>
            </div>
          </>
        )}
      </Async>
    </>
  )
}

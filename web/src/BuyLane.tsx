import { useEffect, useState } from 'react'
import { api } from './api'
import { rm, msg, useFetch } from './ui'
import { useToast } from './Toast'
import { Icon } from './icons'
import { t, useLang } from './i18n'
import type { Text } from './i18n'

// Business <-> Supplier side of a deal: the supplier lane of the document ribbon, the deal profit ring, supplier quote comparison and
// "order from a supplier" (demand pass-through). The comparison and margin are rules in src/buyside.py; nothing is ordered until the owner approves.
// Saving RFQs, goods-received notes and supplier invoices is Roadmap and is labelled so below. Sample numbers in the form are examples to edit.
interface Doc { id: string; kind: string; doc_no: string; status: string; total: string; lines: { description: string; qty: string; uom: string; unit_price: string }[] }
interface Cmp { quotes: { supplier: string; total: string; lead_days: number; on_time_pct: number; rank: number; best: boolean; why: string }[]; best: string; fastest: string; note: string }
interface Mg { sell: string; cost: string; profit: string; margin_pct: string; target_pct: string; state: 'ok' | 'below_target' | 'loss' }
interface Supplier { id: string; name: string }
interface Q { supplier: string; total: string; lead_days: string; on_time_pct: string }

const B = {
  head: { en: 'Supplier side', ms: 'Sebelah pembekal', zh: '供应商一侧', ta: 'விநியோகஸ்தர் பக்கம்' },
  rfq: { en: 'Request for quotation', ms: 'Permintaan Sebut Harga', zh: '询价单', ta: 'விலைப்புள்ளி கோரிக்கை' },
  sq: { en: 'Supplier quotes compared', ms: 'Sebut harga pembekal dibandingkan', zh: '供应商报价比较', ta: 'விநியோகஸ்தர் விலைப்புள்ளிகள் ஒப்பீடு' },
  po: { en: 'Purchase order', ms: 'Pesanan Belian', zh: '采购订单', ta: 'கொள்முதல் ஆணை' },
  grn: { en: 'Goods received', ms: 'Barang Diterima', zh: '收货单', ta: 'பெறப்பட்ட பொருட்கள்' },
  sinv: { en: 'Supplier invoice', ms: 'Invois pembekal', zh: '供应商发票', ta: 'விநியோகஸ்தர் விலைப்பட்டியல்' },
  pay: { en: 'Payment to supplier', ms: 'Bayaran kepada pembekal', zh: '付款给供应商', ta: 'விநியோகஸ்தருக்குப் பணம்' },
  done: { en: 'Done', ms: 'Siap', zh: '已完成', ta: 'முடிந்தது' },
  now: { en: 'Now', ms: 'Sekarang', zh: '进行中', ta: 'இப்போது' },
  todo: { en: 'Not yet', ms: 'Belum', zh: '尚未', ta: 'இன்னும் இல்லை' },
  road: { en: 'Roadmap', ms: 'Peta hala tuju', zh: '规划中', ta: 'திட்டத்தில்' },
  roadWhy: { en: 'Roadmap: saving this document type is not built yet.', ms: 'Peta hala tuju: menyimpan jenis dokumen ini belum dibina.', zh: '规划中：尚未支持保存此类文件。', ta: 'திட்டத்தில்: இந்த வகை ஆவணத்தைச் சேமிப்பது இன்னும் உருவாக்கப்படவில்லை.' },
  profit: { en: 'Deal profit', ms: 'Untung urusan', zh: '交易利润', ta: 'ஒப்பந்த இலாபம்' },
  sell: { en: 'Customer price', ms: 'Harga pelanggan', zh: '客户价格', ta: 'வாடிக்கையாளர் விலை' },
  cost: { en: 'Supplier cost', ms: 'Kos pembekal', zh: '供应商成本', ta: 'விநியோகஸ்தர் செலவு' },
  margin: { en: 'Margin', ms: 'Margin', zh: '利润率', ta: 'இலாப விகிதம்' },
  ok: { en: 'Healthy margin', ms: 'Margin sihat', zh: '利润健康', ta: 'ஆரோக்கியமான இலாபம்' },
  below: { en: 'Below your target', ms: 'Di bawah sasaran anda', zh: '低于目标', ta: 'இலக்குக்குக் கீழே' },
  loss: { en: 'Selling at a loss', ms: 'Dijual rugi', zh: '亏本', ta: 'நஷ்டத்தில் விற்பனை' },
  noCost: { en: 'Order from a supplier to see your margin.', ms: 'Buat pesanan kepada pembekal untuk lihat margin anda.', zh: '向供应商下单后即可看到利润率。', ta: 'உங்கள் இலாபத்தைப் பார்க்க விநியோகஸ்தரிடம் ஆர்டர் செய்யுங்கள்.' },
  cmpH: { en: 'Compare supplier quotes', ms: 'Bandingkan sebut harga pembekal', zh: '比较供应商报价', ta: 'விநியோகஸ்தர் விலைப்புள்ளிகளை ஒப்பிடு' },
  cmpHint: { en: 'Type what 2 to 4 suppliers quoted. LARIS ranks by price, then speed, and says why. You choose.', ms: 'Taip sebut harga 2 hingga 4 pembekal. LARIS susun ikut harga, kemudian kelajuan, dan beritahu sebabnya. Anda yang pilih.', zh: '输入 2 至 4 家供应商的报价。LARIS 按价格再按速度排序并说明原因，由您决定。', ta: '2 முதல் 4 விநியோகஸ்தர்கள் கொடுத்த விலையை உள்ளிடுங்கள். LARIS விலை, பின்னர் வேகம் அடிப்படையில் வரிசைப்படுத்தி காரணம் சொல்லும். தேர்வு உங்களுடையது.' },
  sup: { en: 'Supplier', ms: 'Pembekal', zh: '供应商', ta: 'விநியோகஸ்தர்' },
  total: { en: 'Quoted total (RM)', ms: 'Jumlah sebut harga (RM)', zh: '报价总额（RM）', ta: 'விலைப்புள்ளி மொத்தம் (RM)' },
  lead: { en: 'Days to deliver', ms: 'Hari penghantaran', zh: '交货天数', ta: 'வழங்கும் நாட்கள்' },
  ontime: { en: 'On time %', ms: 'Tepat masa %', zh: '准时率 %', ta: 'நேரத்தில் %' },
  add: { en: 'Add supplier', ms: 'Tambah pembekal', zh: '添加供应商', ta: 'விநியோகஸ்தரைச் சேர்' },
  cmp: { en: 'Compare', ms: 'Bandingkan', zh: '比较', ta: 'ஒப்பிடு' },
  best: { en: 'Best', ms: 'Terbaik', zh: '最佳', ta: 'சிறந்தது' },
  fastest: { en: 'Fastest', ms: 'Terpantas', zh: '最快', ta: 'வேகமானது' },
  order: { en: 'Draft purchase order from the best quote', ms: 'Draf pesanan belian daripada sebut harga terbaik', zh: '按最佳报价起草采购订单', ta: 'சிறந்த விலைப்புள்ளியிலிருந்து கொள்முதல் ஆணை வரைவு' },
  orderHint: { en: 'Made as a draft. The owner approves it before it is sent to the supplier.', ms: 'Dibuat sebagai draf. Pemilik meluluskannya sebelum dihantar kepada pembekal.', zh: '以草稿形式生成，由业主批准后才会发给供应商。', ta: 'வரைவாக உருவாக்கப்படும். விநியோகஸ்தருக்கு அனுப்பும் முன் உரிமையாளர் அனுமதிக்க வேண்டும்.' },
  pickSup: { en: 'Which supplier record is this for?', ms: 'Rekod pembekal yang mana?', zh: '属于哪位供应商记录？', ta: 'எந்த விநியோகஸ்தர் பதிவு?' },
  noSup: { en: 'Add the supplier under Contacts first.', ms: 'Tambah pembekal di Kenalan dahulu.', zh: '请先在联系人中添加供应商。', ta: 'முதலில் தொடர்புகளில் விநியோகஸ்தரைச் சேர்.' },
  made: { en: 'Draft purchase order made', ms: 'Draf pesanan belian dibuat', zh: '已生成采购订单草稿', ta: 'கொள்முதல் ஆணை வரைவு உருவாக்கப்பட்டது' },
  match: { en: 'Orders, goods and bills', ms: 'Pesanan, barang dan bil', zh: '订单、收货与账单', ta: 'ஆணைகள், பொருட்கள், பில்கள்' },
  matchOk: { en: 'Everything lines up', ms: 'Semuanya sepadan', zh: '全部吻合', ta: 'எல்லாம் பொருந்துகிறது' },
  look: { en: 'Needs a look', ms: 'Perlu semakan', zh: '需要核对', ta: 'பார்வை தேவை' },
  arrH: { en: 'Goods arrived?', ms: 'Barang sudah sampai?', zh: '货到了吗？', ta: 'பொருட்கள் வந்துவிட்டனவா?' },
  arrHint: { en: 'Type what came in. A part delivery is fine: the rest stays on the list until it arrives.', ms: 'Taip apa yang sampai. Penghantaran separa tidak mengapa: baki kekal dalam senarai sehingga tiba.', zh: '填写到货数量。分批到货也可以，其余的会留在清单上直到到齐。', ta: 'வந்ததை எழுதுங்கள். பகுதி டெலிவரி சரி; மீதம் வரும் வரை பட்டியலில் இருக்கும்.' },
  arrQty: { en: 'Arrived', ms: 'Sampai', zh: '到货', ta: 'வந்தது' },
  arrNote: { en: 'Note (optional), e.g. 1 spool damaged', ms: 'Nota (pilihan), cth. 1 gelendong rosak', zh: '备注（可选），例如：1 卷损坏', ta: 'குறிப்பு (விருப்பம்), எ.கா. 1 ஸ்பூல் சேதம்' },
  arrGo: { en: 'Record goods received', ms: 'Rekod barang diterima', zh: '记录收货', ta: 'பெற்ற பொருட்களைப் பதிவு செய்' },
  arrDone: { en: 'Goods received recorded', ms: 'Penerimaan barang direkodkan', zh: '收货已记录', ta: 'பெற்ற பொருட்கள் பதிவு செய்யப்பட்டன' },
  arrAll: { en: 'Everything on this purchase order has arrived.', ms: 'Semua dalam pesanan belian ini telah sampai.', zh: '这张采购订单的货已全部到齐。', ta: 'இந்தக் கொள்முதல் ஆணையின் அனைத்தும் வந்துவிட்டன.' },
  arrLeft: { en: 'still to come', ms: 'belum sampai', zh: '未到', ta: 'வர வேண்டியது' },
  needOwner: { en: 'Only the owner can approve a purchase order.', ms: 'Hanya pemilik boleh meluluskan pesanan belian.', zh: '只有业主可以批准采购订单。', ta: 'கொள்முதல் ஆணையை உரிமையாளர் மட்டுமே அனுமதிக்கலாம்.' },
}
const SAMPLE: Q[] = [
  { supplier: 'Bukit Poultry', total: '1200', lead_days: '2', on_time_pct: '98' },
  { supplier: 'Segar Foods', total: '1160', lead_days: '3', on_time_pct: '91' },
  { supplier: 'Kota Wholesale', total: '1240', lead_days: '1', on_time_pct: '95' },
]
const sum = (d: Doc) => Number(d.total)
const ring = (pct: number) => { const r = 40, c = 2 * Math.PI * r; return { c, off: c * (1 - Math.max(0, Math.min(1, pct / 50))) } }

function Stamp({ n, label, state, road }: { n: number; label: Text; state: 'done' | 'now' | 'todo'; road?: boolean }) {
  const s = state === 'done' ? B.done : state === 'now' ? B.now : B.todo
  return (
    <li className={`flex min-w-28 flex-1 flex-col gap-0.5 rounded-ui border px-3 py-2 text-sm ${state === 'now' ? 'border-accent bg-tint' : 'border-hairline'} ${road ? 'border-dashed' : ''}`} aria-current={state === 'now' ? 'step' : undefined} title={road ? t(B.roadWhy) : undefined}>
      <span className="flex items-center gap-1.5 font-semibold">
        <span aria-hidden="true" className="inline-grid size-5 place-items-center rounded-full border border-current text-xs">{state === 'done' ? <Icon name="check" className="size-3" /> : n}</span>{t(label)}
      </span>
      <span className="text-xs text-muted">{road ? t(B.road) : t(s)}</span>
    </li>
  )
}

interface Row { no: number; description: string; uom: string; ordered: string; received: string; left: string }

// Goods arrived against a sent supplier PO: one box per line, pre-filled with what is still to come. POST /api/chain/{id}/receive (src/api/deals.py).
function Receive({ po, onChanged }: { po: Doc; onChanged: () => void }) {
  const d = useFetch<{ receiving: Row[] | null }>(`/chain/${po.id}`)
  const toast = useToast()
  const [qty, setQty] = useState<Record<number, string>>({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const rows = d.data?.receiving ?? []
  const open = rows.filter(r => Number(r.left) > 0)
  const go = async () => {
    const lines = open.map(r => ({ no: r.no, qty: qty[r.no] ?? r.left })).filter(x => Number(x.qty) > 0)
    setBusy(true)
    try { await api('POST', `/chain/${po.id}/receive`, { lines, note: note.trim() || undefined }); toast(t(B.arrDone)); setQty({}); setNote(''); d.reload(); onChanged() } catch (e) { toast(msg(e)) } finally { setBusy(false) }
  }
  if (!d.data) return null
  return (
    <form className="grid gap-3 rounded-ui border border-hairline p-3" aria-label={t(B.arrH)} onSubmit={e => { e.preventDefault(); void go() }}>
      <div><h3 className="font-semibold">{t(B.arrH)} <span className="text-sm font-normal text-muted">{po.doc_no}</span></h3>{open.length ? <p className="text-sm text-muted">{t(B.arrHint)}</p> : <p className="text-sm">{t(B.arrAll)}</p>}</div>
      {open.map(r => (
        <label key={r.no} className="grid gap-1 text-sm sm:grid-cols-[1fr_8rem] sm:items-center"><span>{r.description} <span className="text-muted">({r.received}/{r.ordered} {r.uom}; {r.left} {t(B.arrLeft)})</span></span>
          <input className="input" inputMode="decimal" aria-label={`${t(B.arrQty)}: ${r.description}`} value={qty[r.no] ?? r.left} onChange={e => setQty(q => ({ ...q, [r.no]: e.target.value }))} /></label>))}
      {open.length > 0 && <>
        <label className="grid gap-1 text-sm"><span>{t(B.arrNote)}</span><input className="input" maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></label>
        <div><button className="btn btn-primary" disabled={busy}>{t(B.arrGo)}</button></div></>}
    </form>
  )
}

export function BuyLane({ trail, owner, onChanged }: { trail: Doc[]; owner: boolean; onChanged: () => void }) {
  useLang()
  const toast = useToast()
  const [qs, setQs] = useState<Q[]>(SAMPLE)
  const [res, setRes] = useState<Cmp>()
  const [mg, setMg] = useState<Mg>()
  const [busy, setBusy] = useState(false)
  const [sup, setSup] = useState('')
  const suppliers = useFetch<Supplier[]>('/contacts?role=supplier')
  const order = trail.find(d => d.kind === 'so') ?? trail.find(d => d.kind === 'cpo')
  const spos = trail.filter(d => d.kind === 'spo' && d.status !== 'cancelled')
  const sell = order ? sum(order) : 0
  const cost = spos.reduce((a, d) => a + sum(d), 0)
  useEffect(() => {
    if (!order || !spos.length) { setMg(undefined); return }
    let live = true
    api<Mg>('POST', '/chain/buy/margin', { sell_total: sell, cost_total: cost, target_pct: 20 }).then(r => { if (live) setMg(r) }).catch(() => { if (live) setMg(undefined) })
    return () => { live = false }
  }, [order?.id, sell, cost, spos.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const po = spos[0]
  const stage = (kind: string): 'done' | 'now' | 'todo' => {
    if (kind === 'sq') return res ? 'done' : po ? 'done' : 'todo'
    if (kind === 'spo') return po ? (['sent', 'partially_received', 'received'].includes(po.status) ? 'done' : 'now') : res ? 'now' : 'todo'
    if (kind === 'grn') return po?.status === 'received' ? 'done' : po?.status === 'partially_received' ? 'now' : 'todo'
    return 'todo'
  }
  const upd = (i: number, k: keyof Q, v: string) => setQs(a => a.map((q, j) => (j === i ? { ...q, [k]: v } : q)))
  const compare = async () => {
    setBusy(true)
    try {
      setRes(await api<Cmp>('POST', '/chain/buy/compare', { quotes: qs.map(q => ({ supplier: q.supplier, total: q.total, lead_days: Number(q.lead_days) || 0, on_time_pct: Number(q.on_time_pct) || 0 })) }))
    } catch (e) { toast(msg(e)) } finally { setBusy(false) }
  }
  const best = res?.quotes[0]
  const draft = async () => {
    if (!order || !best || !sup) return
    setBusy(true)
    try {
      // Same lines as the customer order, priced so they add up to the chosen quote (share of the quote = share of the customer price).
      const total = Number(best.total), base = sum(order) || 1
      const lines = order.lines.map(l => ({ description: l.description, qty: l.qty, uom: l.uom, unit_price: ((Number(l.qty) * Number(l.unit_price) / base) * total / (Number(l.qty) || 1)).toFixed(4) }))
      await api('POST', '/chain', { kind: 'spo', customer_id: sup, lines, serves: order.id, note: `From supplier quote comparison: ${best.supplier}` })
      toast(t(B.made)); onChanged()
    } catch (e) { toast(msg(e)) } finally { setBusy(false) }
  }
  const rg = mg ? ring(Number(mg.margin_pct)) : ring(0)
  const mgLabel = mg ? t(mg.state === 'ok' ? B.ok : mg.state === 'below_target' ? B.below : B.loss) : ''
  const mgIcon = mg?.state === 'ok' ? 'check' : 'alerts'
  const steps: [string, Text, boolean][] = [['rfq', B.rfq, true], ['sq', B.sq, false], ['spo', B.po, false], ['grn', B.grn, false], ['sinv', B.sinv, true], ['pay', B.pay, true]]
  return (
    <section className="glass-lite mb-4 grid gap-4 p-4" aria-label={t(B.head)} data-guide="buy-lane">
      <h2 className="text-lg font-semibold">{t(B.head)}</h2>
      <ol className="flex flex-wrap gap-2" aria-label={t(B.head)}>{steps.map(([k, label, road], i) => <Stamp key={k} n={i + 1} label={label} road={road} state={stage(k)} />)}</ol>
      {spos.filter(d => d.status === 'sent' || d.status === 'partially_received').map(d => <Receive key={`${d.id}-${d.status}`} po={d} onChanged={onChanged} />)}
      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        <div className="grid content-start justify-items-center gap-2 sm:grid-cols-[auto_1fr] sm:justify-items-start lg:grid-cols-1" aria-live="polite">
          <svg viewBox="0 0 100 100" className="size-28" role="img" aria-label={`${t(B.profit)}: ${mg ? `${mg.margin_pct}% ${mgLabel}` : t(B.noCost)}`}>
            <circle cx="50" cy="50" r="40" fill="none" stroke="var(--hairline)" strokeWidth="9" />
            {mg && <circle cx="50" cy="50" r="40" fill="none" stroke={mg.state === 'loss' ? 'var(--warn)' : mg.state === 'below_target' ? 'var(--amber)' : 'var(--accent)'} strokeWidth="9" strokeLinecap="round"
              strokeDasharray={rg.c} strokeDashoffset={rg.off} transform="rotate(-90 50 50)" style={{ transition: 'stroke-dashoffset var(--dur-slow) var(--ease-out)' }} />}
            <text x="50" y="48" textAnchor="middle" className="fill-ink" style={{ font: '700 17px var(--font-sans, sans-serif)' }}>{mg ? `${mg.margin_pct}%` : '-'}</text>
            <text x="50" y="64" textAnchor="middle" className="fill-muted" style={{ font: '500 9px var(--font-sans, sans-serif)' }}>{t(B.margin)}</text>
          </svg>
          <div className="grid gap-0.5 text-sm">
            <b>{t(B.profit)}</b>
            {mg ? <>
              <span className="tabular-nums">{t(B.sell)} {rm(mg.sell)}</span><span className="tabular-nums">{t(B.cost)} {rm(mg.cost)}</span>
              <span className="flex items-center gap-1 font-semibold"><Icon name={mgIcon} className="size-4" />{mgLabel}: {rm(mg.profit)}</span>
            </> : <span className="text-muted">{t(B.noCost)}</span>}
            {spos.length > 0 && order && <span className="text-xs text-muted">{t(B.match)}: <b>{spos.every(d => ['sent', 'partially_received', 'received'].includes(d.status)) ? t(B.matchOk) : t(B.look)}</b></span>}
          </div>
        </div>
        <div className="grid gap-3">
          <div><h3 className="font-semibold">{t(B.cmpH)}</h3><p className="text-sm text-muted">{t(B.cmpHint)}</p></div>
          <div className="grid gap-2">
            {qs.map((q, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_1fr_0.8fr_0.8fr]">
                <label className="col-span-2 grid gap-1 text-sm sm:col-span-1"><span className="text-muted">{t(B.sup)}</span><input className="input" maxLength={80} value={q.supplier} onChange={e => upd(i, 'supplier', e.target.value)} /></label>
                <label className="grid gap-1 text-sm"><span className="text-muted">{t(B.total)}</span><input className="input" inputMode="decimal" value={q.total} onChange={e => upd(i, 'total', e.target.value)} /></label>
                <label className="grid gap-1 text-sm"><span className="text-muted">{t(B.lead)}</span><input className="input" inputMode="numeric" value={q.lead_days} onChange={e => upd(i, 'lead_days', e.target.value)} /></label>
                <label className="grid gap-1 text-sm"><span className="text-muted">{t(B.ontime)}</span><input className="input" inputMode="numeric" value={q.on_time_pct} onChange={e => upd(i, 'on_time_pct', e.target.value)} /></label>
              </div>))}
          </div>
          <div className="flex flex-wrap gap-2">
            {qs.length < 4 && <button type="button" className="btn" onClick={() => setQs(a => [...a, { supplier: '', total: '', lead_days: '', on_time_pct: '' }])}>{t(B.add)}</button>}
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void compare()}>{t(B.cmp)}</button>
          </div>
          {res && (
            <div className="grid gap-2" role="region" aria-live="polite" aria-label={t(B.cmpH)}>
              <ul className="grid gap-2">{res.quotes.map(r => (
                <li key={r.supplier} className={`flex flex-wrap items-center justify-between gap-2 rounded-ui border px-3 py-2 text-sm ${r.best ? 'border-accent bg-tint' : 'border-hairline'}`}>
                  <span className="flex flex-wrap items-center gap-2"><b>{r.rank}. {r.supplier}</b>
                    {r.best && <span className="chip chip-accepted">{t(B.best)}</span>}{r.supplier === res.fastest && <span className="chip chip-sent">{t(B.fastest)}</span>}</span>
                  <span className="tabular-nums">{rm(r.total)} &middot; {r.lead_days}d &middot; {r.on_time_pct}%</span>
                  <span className="basis-full text-muted">{r.why}</span></li>))}</ul>
              {order && <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="grid gap-1 text-sm"><span>{t(B.pickSup)}</span>
                  <select className="input" value={sup} onChange={e => setSup(e.target.value)}><option value="">-</option>{(suppliers.data ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                <button type="button" className="btn btn-primary" disabled={busy || !sup} onClick={() => void draft()}>{t(B.order)}</button>
                <p className="text-xs text-muted sm:col-span-2">{(suppliers.data ?? []).length === 0 ? t(B.noSup) : t(B.orderHint)}{!owner && ` ${t(B.needOwner)}`}</p>
              </div>}
            </div>)}
        </div>
      </div>
    </section>
  )
}

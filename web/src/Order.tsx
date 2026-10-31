import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, can, download } from './api'
import { Async, PageHeader, Status, msg, rm, useFetch } from './ui'
import { DataTable } from './kit'
import { useToast } from './Toast'
import { BuyLane } from './BuyLane'
import { t, useLang, locale } from './i18n'
import type { Text } from './i18n'

// One order's page: the timeline Quote, Order, Proforma, Delivery, Invoice, Receipt and the single next action. It talks to the order chain only
// (src/api/chain.py, src/api/delivery.py): GET /jobs/{id}/chain, POST /jobs/{id}/proforma, /payments, /delivery-orders, /invoice,
// POST /deal-docs/{id}/delivery-link, GET /deal-docs/{id}/pdf, POST /payments/propose-from-slip. Every rule is enforced by the server; the
// buttons only offer what the stage allows. LARIS records payments, it never takes money. Demo / synthetic data only in mock mode.
type Stage = 'awaiting_deposit' | 'in_production' | 'delivered' | 'awaiting_payment' | 'paid'
interface Doc { id: string; kind: 'proforma' | 'delivery_order' | 'invoice' | 'receipt' | 'credit_note'; doc_no: string; status: string; total: string; extra: Record<string, unknown>; issued_at: string; payment_id: string | null }
interface Pay { id: string; amount: string; method: string; reference: string | null; paid_on: string; purpose: string; reverses_payment_id: string | null; reversed: boolean }
interface Sig { name: string; at: string; problems: string | null; has_mark: boolean }
interface DO { id: string; doc_no: string; status: string; issued_at: string; override_reason: string | null; signature: Sig | null }
interface Chain {
  job: { id: string; title: string; quote_id: string | null; customer: string | null; quote_deposit_pct: string | null }
  total: string | null; paid: string; balance: string | null; credited?: string; deposit: { pct: string; amount: string; paid: string } | null; stage: Stage; overdue: string | null
  delivery: { lines: { no: number; ordered: string; issued: string; signed: string }[]; complete: boolean }
  delivery_orders: DO[]; problems: { doc_no: string; note: string; at: string }[]
  invoice: { id: string; doc_no: string; due_on: string | null } | null; documents: Doc[]; payments: Pay[]
}
interface Linked { id: string; kind: string; doc_no: string; status: string; total: string; job_id: string | null; lines: { description: string; qty: string; uom: string; unit_price: string }[] }
interface Slip { amount: string | null; paid_on: string | null; reference: string | null; payer: string | null; confidence: number | null; notice: string }

const O = {
  deals: { en: 'Deals', ms: 'Urusan', zh: '交易', ta: 'ஒப்பந்தங்கள்' },
  deal: { en: 'Order', ms: 'Pesanan', zh: '订单', ta: 'ஆர்டர்' },
  trail: { en: 'Document trail', ms: 'Jejak dokumen', zh: '单据轨迹', ta: 'ஆவணத் தடம்' },
  quote: { en: 'Quote', ms: 'Sebut harga', zh: '报价', ta: 'மேற்கோள்' }, order: { en: 'Order', ms: 'Pesanan', zh: '订单', ta: 'ஆர்டர்' },
  proforma: { en: 'Proforma', ms: 'Proforma', zh: '形式发票', ta: 'புரோஃபார்மா' }, delivery: { en: 'Delivery', ms: 'Penghantaran', zh: '送货', ta: 'டெலிவரி' },
  invoice: { en: 'Invoice', ms: 'Invois', zh: '发票', ta: 'இன்வாய்ஸ்' }, receipt: { en: 'Receipt', ms: 'Resit', zh: '收据', ta: 'ரசீது' },
  credit_note: { en: 'Credit note', ms: 'Nota kredit', zh: '贷项通知单', ta: 'கிரெடிட் நோட்' },
  credited: { en: 'Credited', ms: 'Dikreditkan', zh: '已抵减', ta: 'குறைக்கப்பட்டது' },
  crH: { en: 'Failed reprint? Give a credit', ms: 'Cetakan semula gagal? Beri kredit', zh: '重印失败？开具贷项通知单', ta: 'மறுஅச்சு தோல்வியா? கிரெடிட் கொடு' },
  crHint: { en: 'A credit note lowers what the customer owes. LARIS does not refund money: any refund is made outside it.', ms: 'Nota kredit mengurangkan jumlah yang pelanggan berhutang. LARIS tidak membuat bayaran balik: sebarang bayaran balik dibuat di luar.', zh: '贷项通知单会减少客户应付的金额。LARIS 不处理退款，退款需在系统外办理。', ta: 'கிரெடிட் நோட் வாடிக்கையாளர் செலுத்த வேண்டியதைக் குறைக்கும். LARIS பணத்தைத் திருப்பித் தராது; அது வெளியே செய்யப்படும்.' },
  crAmount: { en: 'Credit amount (RM)', ms: 'Jumlah kredit (RM)', zh: '抵减金额（RM）', ta: 'கிரெடிட் தொகை (RM)' },
  crWhy: { en: 'What went wrong? (printed on the note)', ms: 'Apa yang tidak kena? (dicetak pada nota)', zh: '出了什么问题？（印在单据上）', ta: 'என்ன தவறு? (நோட்டில் அச்சிடப்படும்)' },
  crMake: { en: 'Issue credit note', ms: 'Keluarkan nota kredit', zh: '开具贷项通知单', ta: 'கிரெடிட் நோட் வழங்கு' },
  crDone: { en: 'Credit note issued', ms: 'Nota kredit dikeluarkan', zh: '已开具贷项通知单', ta: 'கிரெடிட் நோட் வழங்கப்பட்டது' },
  delivery_order: { en: 'Delivery order', ms: 'Pesanan penghantaran', zh: '送货单', ta: 'டெலிவரி ஆணை' },
  done: { en: 'done', ms: 'siap', zh: '已完成', ta: 'முடிந்தது' }, now: { en: 'now', ms: 'sekarang', zh: '进行中', ta: 'இப்போது' }, todo: { en: 'not yet', ms: 'belum', zh: '尚未', ta: 'இன்னும் இல்லை' },
  none: { en: 'none (made by hand)', ms: 'tiada (dibuat sendiri)', zh: '无（手动创建）', ta: 'இல்லை (கைமுறையாக)' },
  awaiting_deposit: { en: 'Waiting for the deposit', ms: 'Menunggu deposit', zh: '等待订金', ta: 'முன்பணத்திற்காகக் காத்திருக்கிறது' },
  in_production: { en: 'In production', ms: 'Dalam pengeluaran', zh: '制作中', ta: 'தயாரிப்பில்' },
  delivered: { en: 'Delivered', ms: 'Telah dihantar', zh: '已送达', ta: 'வழங்கப்பட்டது' },
  awaiting_payment: { en: 'Waiting for payment', ms: 'Menunggu bayaran', zh: '等待付款', ta: 'பணத்திற்காகக் காத்திருக்கிறது' },
  paid: { en: 'Paid', ms: 'Dibayar', zh: '已付款', ta: 'செலுத்தப்பட்டது' },
  late: { en: 'Late', ms: 'Lewat', zh: '逾期', ta: 'தாமதம்' },
  total: { en: 'Order total', ms: 'Jumlah pesanan', zh: '订单总额', ta: 'ஆர்டர் மொத்தம்' }, paidL: { en: 'Paid', ms: 'Dibayar', zh: '已付', ta: 'செலுத்தியது' },
  balance: { en: 'Balance', ms: 'Baki', zh: '余额', ta: 'மீதி' }, deposit: { en: 'Deposit', ms: 'Deposit', zh: '订金', ta: 'முன்பணம்' },
  next: { en: 'Next step', ms: 'Langkah seterusnya', zh: '下一步', ta: 'அடுத்த படி' },
  ownerOnly: { en: 'The owner does this step.', ms: 'Pemilik melakukan langkah ini.', zh: '此步骤由老板完成。', ta: 'இந்தப் படியை உரிமையாளர் செய்வார்.' },
  noPerm: { en: 'You do not have permission for this step. Ask the owner.', ms: 'Anda tiada kebenaran untuk langkah ini. Tanya pemilik.', zh: '您没有此步骤的权限，请询问老板。', ta: 'இந்தப் படிக்கு உங்களுக்கு அனுமதி இல்லை. உரிமையாளரிடம் கேளுங்கள்.' },
  pctL: { en: 'Deposit %', ms: 'Deposit %', zh: '订金 %', ta: 'முன்பண %' },
  pctHint: { en: 'Filled in from the quote. Change it if you agreed something else.', ms: 'Diisi daripada sebut harga. Ubah jika anda bersetuju lain.', zh: '取自报价，如另有约定请修改。', ta: 'மேற்கோளிலிருந்து நிரப்பப்பட்டது. வேறு ஒப்புக்கொண்டிருந்தால் மாற்றவும்.' },
  pctNone: { en: 'The quote has no deposit percentage. Type one.', ms: 'Sebut harga tiada peratus deposit. Taip satu.', zh: '报价没有订金百分比，请输入。', ta: 'மேற்கோளில் முன்பண சதவீதம் இல்லை. ஒன்றை உள்ளிடவும்.' },
  issuePf: { en: 'Issue proforma', ms: 'Keluarkan proforma', zh: '开具形式发票', ta: 'புரோஃபார்மா வழங்கு' },
  pfDone: { en: 'Proforma issued', ms: 'Proforma dikeluarkan', zh: '已开具形式发票', ta: 'புரோஃபார்மா வழங்கப்பட்டது' },
  payDep: { en: 'Record the deposit', ms: 'Rekod deposit', zh: '记录订金', ta: 'முன்பணத்தைப் பதிவு செய்' }, payBal: { en: 'Record a payment', ms: 'Rekod bayaran', zh: '记录付款', ta: 'பணத்தைப் பதிவு செய்' },
  amount: { en: 'Amount (RM)', ms: 'Jumlah (RM)', zh: '金额（RM）', ta: 'தொகை (RM)' }, method: { en: 'Method', ms: 'Kaedah', zh: '方式', ta: 'முறை' },
  ref: { en: 'Reference (optional)', ms: 'Rujukan (pilihan)', zh: '参考号（可选）', ta: 'குறிப்பு எண் (விருப்பம்)' }, date: { en: 'Date received', ms: 'Tarikh diterima', zh: '收款日期', ta: 'பெற்ற தேதி' },
  cash: { en: 'Cash', ms: 'Tunai', zh: '现金', ta: 'ரொக்கம்' }, transfer: { en: 'Bank transfer', ms: 'Pindahan bank', zh: '银行转账', ta: 'வங்கிப் பரிமாற்றம்' }, duitnow: { en: 'DuitNow', ms: 'DuitNow', zh: 'DuitNow', ta: 'DuitNow' },
  cheque: { en: 'Cheque', ms: 'Cek', zh: '支票', ta: 'காசோலை' }, card: { en: 'Card', ms: 'Kad', zh: '银行卡', ta: 'அட்டை' }, other: { en: 'Other', ms: 'Lain-lain', zh: '其他', ta: 'மற்றவை' },
  record: { en: 'Record payment', ms: 'Rekod bayaran', zh: '记录付款', ta: 'பணத்தைப் பதிவு செய்' },
  recorded: { en: 'Payment recorded, receipt', ms: 'Bayaran direkodkan, resit', zh: '付款已记录，收据', ta: 'பணம் பதிவானது, ரசீது' },
  slip: { en: 'Read a payment slip (optional)', ms: 'Baca slip bayaran (pilihan)', zh: '读取付款单据（可选）', ta: 'பணச் சீட்டைப் படி (விருப்பம்)' },
  slipRead: { en: 'Reading the slip...', ms: 'Membaca slip...', zh: '正在读取单据...', ta: 'சீட்டைப் படிக்கிறது...' },
  slipFrom: { en: 'Filled in from the slip. Sender:', ms: 'Diisi daripada slip. Penghantar:', zh: '已根据单据填写。付款人：', ta: 'சீட்டிலிருந்து நிரப்பப்பட்டது. அனுப்பியவர்:' },
  slipNote: { en: 'A slip is not proof of money received: check your bank before confirming.', ms: 'Slip bukan bukti wang diterima: semak bank anda sebelum mengesahkan.', zh: '单据不能证明款项已到账：确认前请先查看您的银行账户。', ta: 'சீட்டு பணம் வந்ததற்கான சான்று அல்ல: உறுதிப்படுத்தும் முன் உங்கள் வங்கியைச் சரிபார்க்கவும்.' },
  mkDo: { en: 'Create delivery order', ms: 'Buat pesanan penghantaran', zh: '创建送货单', ta: 'டெலிவரி ஆணையை உருவாக்கு' },
  doHint: { en: 'Delivers everything still to go. The customer signs on their own phone from a link.', ms: 'Menghantar semua yang tinggal. Pelanggan menandatangani di telefon sendiri melalui pautan.', zh: '送出所有剩余货物。客户通过链接在自己的手机上签收。', ta: 'மீதமுள்ள அனைத்தையும் வழங்கும். வாடிக்கையாளர் இணைப்பு மூலம் தம் தொலைபேசியில் கையொப்பமிடுவார்.' },
  skipDep: { en: 'Deliver before the deposit (owner)', ms: 'Hantar sebelum deposit (pemilik)', zh: '订金到账前先送货（老板）', ta: 'முன்பணத்துக்கு முன் வழங்கு (உரிமையாளர்)' },
  why: { en: 'Reason (kept on the document)', ms: 'Sebab (disimpan pada dokumen)', zh: '原因（记录在单据上）', ta: 'காரணம் (ஆவணத்தில் சேமிக்கப்படும்)' },
  mkInv: { en: 'Issue invoice', ms: 'Keluarkan invois', zh: '开具发票', ta: 'இன்வாய்ஸ் வழங்கு' },
  due: { en: 'Due date (optional, from the payment terms if blank)', ms: 'Tarikh tamat (pilihan, ikut terma bayaran jika kosong)', zh: '到期日（可选，留空则按付款条款）', ta: 'கடைசி தேதி (விருப்பம், காலியெனில் கட்டண விதிப்படி)' },
  allDone: { en: 'Everything is paid. Nothing more to do.', ms: 'Semua telah dibayar. Tiada lagi untuk dibuat.', zh: '已全部付清，无需再操作。', ta: 'அனைத்தும் செலுத்தப்பட்டது. வேறு எதுவும் தேவையில்லை.' },
  waitSign: { en: 'Waiting for the customer to sign for the delivery.', ms: 'Menunggu pelanggan menandatangani penerimaan.', zh: '等待客户签收。', ta: 'வாடிக்கையாளர் கையொப்பமிடக் காத்திருக்கிறது.' },
  dels: { en: 'Delivery orders', ms: 'Pesanan penghantaran', zh: '送货单', ta: 'டெலிவரி ஆணைகள்' },
  waiting: { en: 'Waiting for signature', ms: 'Menunggu tandatangan', zh: '等待签收', ta: 'கையொப்பத்திற்காகக் காத்திருக்கிறது' },
  signed: { en: 'Signed by', ms: 'Ditandatangani oleh', zh: '签收人', ta: 'கையொப்பமிட்டவர்' },
  problem: { en: 'Problem reported:', ms: 'Masalah dilaporkan:', zh: '已报告问题：', ta: 'தெரிவித்த சிக்கல்:' },
  link: { en: 'Get customer link', ms: 'Dapatkan pautan pelanggan', zh: '获取客户链接', ta: 'வாடிக்கையாளர் இணைப்பைப் பெறு' },
  linkL: { en: 'Customer link (shown once; send it to the customer)', ms: 'Pautan pelanggan (dipaparkan sekali; hantar kepada pelanggan)', zh: '客户链接（只显示一次，请发给客户）', ta: 'வாடிக்கையாளர் இணைப்பு (ஒருமுறை மட்டும்; வாடிக்கையாளருக்கு அனுப்பவும்)' },
  copy: { en: 'Copy link', ms: 'Salin pautan', zh: '复制链接', ta: 'இணைப்பை நகலெடு' }, copied: { en: 'Link copied', ms: 'Pautan disalin', zh: '链接已复制', ta: 'இணைப்பு நகலெடுக்கப்பட்டது' },
  docs: { en: 'Documents', ms: 'Dokumen', zh: '单据', ta: 'ஆவணங்கள்' }, pdf: { en: 'Download PDF', ms: 'Muat turun PDF', zh: '下载 PDF', ta: 'PDF பதிவிறக்கு' },
  docNo: { en: 'Number', ms: 'Nombor', zh: '编号', ta: 'எண்' }, type: { en: 'Type', ms: 'Jenis', zh: '类型', ta: 'வகை' }, st: { en: 'Status', ms: 'Status', zh: '状态', ta: 'நிலை' },
  pays: { en: 'Payments', ms: 'Bayaran', zh: '付款', ta: 'கட்டணங்கள்' }, reversed: { en: 'reversed', ms: 'dibatalkan', zh: '已冲销', ta: 'திரும்பப்பெற்றது' },
  linked: { en: 'Customer PO and sales order', ms: 'PO pelanggan dan pesanan jualan', zh: '客户采购单与销售订单', ta: 'வாடிக்கையாளர் PO மற்றும் விற்பனை ஆணை' },
  mkSo: { en: 'Make a sales order from the quote', ms: 'Buat pesanan jualan daripada sebut harga', zh: '由报价生成销售订单', ta: 'மேற்கோளிலிருந்து விற்பனை ஆணையை உருவாக்கு' },
  soMade: { en: 'Sales order made', ms: 'Pesanan jualan dibuat', zh: '已生成销售订单', ta: 'விற்பனை ஆணை உருவாக்கப்பட்டது' },
  prep: { en: 'Preparation only: LARIS records payments, it never takes money or sends a document by itself.', ms: 'Persediaan sahaja: LARIS merekod bayaran, ia tidak mengambil wang atau menghantar dokumen sendiri.', zh: '仅作准备：LARIS 只记录付款，不收款，也不会自动发送单据。', ta: 'தயாரிப்பு மட்டுமே: LARIS பணத்தைப் பதிவு மட்டுமே செய்யும்; பணம் எடுக்காது, ஆவணத்தைத் தானாக அனுப்பாது.' },
  working: { en: 'Working...', ms: 'Sedang diproses...', zh: '处理中...', ta: 'செயலாக்குகிறது...' },
} satisfies Record<string, Text>
const TT = (k: keyof typeof O) => t(O[k])
const METHODS = ['transfer', 'duitnow', 'cash', 'cheque', 'card', 'other'] as const
const newKey = () => (crypto.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`)
const today = () => new Date().toISOString().slice(0, 10)

type Run = (fn: () => Promise<string>) => Promise<void>
const Step = ({ n, label, state, href, hint }: { n: number; label: string; state: 'done' | 'now' | 'todo'; href?: string; hint?: string }) => {
  const inner = <>{label}<span className="sr-only"> ({TT(state)})</span></>
  const cls = `chip ${state === 'done' ? 'chip-approved' : state === 'now' ? 'chip-accepted' : 'chip-draft'}`
  return <li className="flex items-center gap-1">{n > 1 && <span aria-hidden="true" className="text-muted">&rarr;</span>}
    {href ? <a href={href} className={`${cls} min-h-11`} aria-current={state === 'now' ? 'step' : undefined}>{inner}</a> : <span className={cls} title={hint} aria-current={state === 'now' ? 'step' : undefined}>{inner}</span>}</li>
}

function PayForm({ c, purpose, run }: { c: Chain; purpose: 'deposit' | 'balance'; run: Run }) {
  const left = purpose === 'deposit' && c.deposit ? Math.max(0, Number(c.deposit.amount) - Number(c.deposit.paid)) : Number(c.balance ?? 0)
  const toast = useToast()
  const [amount, setAmount] = useState(left > 0 ? left.toFixed(2) : '')
  const [method, setMethod] = useState<(typeof METHODS)[number]>('transfer')
  const [reference, setReference] = useState('')
  const [paidOn, setPaidOn] = useState(today())
  const [key, setKey] = useState(newKey)  // the same key is sent again on a retry, so a double tap records once
  const [slip, setSlip] = useState<Slip>()
  const [reading, setReading] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const read = async (f: File) => {
    setReading(true)
    try {
      const fd = new FormData(); fd.append('image', f)
      const p = await api<Slip>('POST', '/payments/propose-from-slip', fd)
      setSlip(p)
      if (p.amount) setAmount(String(Number(p.amount).toFixed(2)))
      if (p.paid_on) setPaidOn(p.paid_on)
      if (p.reference) setReference(p.reference)
    } catch (e) { toast(msg(e)) } finally { setReading(false); if (file.current) file.current.value = '' }
  }
  const submit = () => run(async () => {
    const r = await api<{ receipt: { doc_no: string } | null }>('POST', `/jobs/${c.job.id}/payments`, {
      amount: amount.trim(), method, reference: reference.trim() || undefined, paid_on: paidOn, purpose, idempotency_key: key,
      extraction: slip ? { amount: slip.amount, paid_on: slip.paid_on, reference: slip.reference, payer: slip.payer, confidence: slip.confidence } : undefined })
    setKey(newKey()); setSlip(undefined); setReference('')
    return `${TT('recorded')} ${r.receipt?.doc_no ?? ''}`
  })
  return (
    <form className="grid gap-3" onSubmit={e => { e.preventDefault(); void submit() }} aria-label={TT(purpose === 'deposit' ? 'payDep' : 'payBal')}>
      <label className="grid gap-1 text-sm"><span>{TT('slip')}</span>
        <input ref={file} className="input py-2" type="file" accept="image/*" disabled={reading} onChange={e => { const f = e.target.files?.[0]; if (f) void read(f) }} /></label>
      {reading && <p role="status" className="text-sm text-muted">{TT('slipRead')}</p>}
      {slip && <p className="text-sm">{slip.payer ? `${TT('slipFrom')} ${slip.payer}. ` : ''}<b>{TT('slipNote')}</b></p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm"><span>{TT('amount')}</span><input className="input" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label className="grid gap-1 text-sm"><span>{TT('method')}</span>
          <select className="input" value={method} onChange={e => setMethod(e.target.value as typeof method)}>{METHODS.map(m => <option key={m} value={m}>{TT(m)}</option>)}</select></label>
        <label className="grid gap-1 text-sm"><span>{TT('ref')}</span><input className="input" maxLength={100} value={reference} onChange={e => setReference(e.target.value)} /></label>
        <label className="grid gap-1 text-sm"><span>{TT('date')}</span><input className="input" type="date" max={today()} value={paidOn} onChange={e => setPaidOn(e.target.value)} /></label>
      </div>
      {!slip && <p className="text-sm text-muted">{TT('slipNote')}</p>}
      <div><button className="btn btn-primary" disabled={!Number(amount) || !paidOn}>{TT('record')}</button></div>
    </form>
  )
}

function CreditForm({ c, run, busy }: { c: Chain; run: Run; busy: boolean }) {
  const [amount, setAmount] = useState('')
  const [why, setWhy] = useState('')
  const max = Number(c.balance ?? 0)
  const n = Number(amount)
  return (
    <details className="card mb-4"><summary className="min-h-11 cursor-pointer py-2 text-lg font-semibold">{TT('crH')}</summary>
      <form className="mt-2 grid gap-3" onSubmit={e => { e.preventDefault(); void run(async () => { const r = await api<{ doc_no: string }>('POST', `/jobs/${c.job.id}/credit-notes`, { amount: amount.trim(), reason: why.trim() }); setAmount(''); setWhy(''); return `${TT('crDone')} ${r.doc_no}` }) }}>
        <p className="text-sm text-muted">{TT('crHint')}</p>
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <label className="grid gap-1 text-sm"><span>{TT('crAmount')}</span><input className="input" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <label className="grid gap-1 text-sm"><span>{TT('crWhy')}</span><input className="input" maxLength={200} value={why} onChange={e => setWhy(e.target.value)} /></label>
        </div>
        <div><button className="btn btn-primary" disabled={busy || !(n > 0 && n < Number(c.total ?? 0) && n <= max) || why.trim().length < 3}>{TT('crMake')}</button></div>
      </form>
    </details>
  )
}

function NextStep({ c, owner, run, busy, onLink }: { c: Chain; owner: boolean; run: Run; busy: boolean; onLink: (id: string, url: string) => void }) {
  const ok = (k: string) => owner || can(k)
  const [pct, setPct] = useState(c.job.quote_deposit_pct ? String(Number(c.job.quote_deposit_pct)) : '')
  const [due, setDue] = useState('')
  const [why, setWhy] = useState('')
  const hasPf = c.documents.some(d => d.kind === 'proforma' && d.status !== 'void')
  const left = c.delivery.lines.some(l => Number(l.issued) < Number(l.ordered))
  const mkDo = (override?: string) => run(async () => {
    const d = await api<{ id: string; doc_no: string }>('POST', `/jobs/${c.job.id}/delivery-orders`, override ? { override_reason: override } : {})
    try { onLink(d.id, (await api<{ url: string }>('POST', `/deal-docs/${d.id}/delivery-link`)).url) } catch { /* no public address yet: the delivery panel offers the link again */ }
    return `${TT('delivery_order')} ${d.doc_no}`
  })
  const title = c.stage === 'paid' ? '' : c.stage === 'awaiting_deposit' ? TT(hasPf ? 'payDep' : 'issuePf') : c.stage === 'awaiting_payment' ? TT('payBal') : c.stage === 'in_production' ? (left ? TT('mkDo') : '') : TT('mkInv')
  let body: ReactNode
  if (c.stage === 'paid') body = <p>{TT('allDone')}</p>
  else if (c.stage === 'awaiting_deposit' && !hasPf) body = !owner ? <p>{TT('ownerOnly')}</p> : (
    <form className="grid gap-2" onSubmit={e => { e.preventDefault(); void run(async () => { const r = await api<{ doc_no: string }>('POST', `/jobs/${c.job.id}/proforma`, { deposit_pct: pct.trim() ? Number(pct) : undefined }); return `${TT('pfDone')} ${r.doc_no}` }) }}>
      <label className="grid gap-1 text-sm"><span>{TT('pctL')}</span><input className="input w-28" inputMode="decimal" value={pct} onChange={e => setPct(e.target.value)} /></label>
      <p className="text-sm text-muted">{c.job.quote_deposit_pct ? TT('pctHint') : TT('pctNone')}</p>
      <div><button className="btn btn-primary" disabled={busy || !pct.trim()}>{TT('issuePf')}</button></div>
    </form>)
  else if (c.stage === 'awaiting_deposit' || c.stage === 'awaiting_payment') body = !ok('record_payments') ? <p>{TT('noPerm')}</p> : <>
    <PayForm c={c} purpose={c.stage === 'awaiting_deposit' ? 'deposit' : 'balance'} run={run} />
    {c.stage === 'awaiting_deposit' && owner && left && (
      <details className="mt-2"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">{TT('skipDep')}</summary>
        <form className="mt-2 grid gap-2" onSubmit={e => { e.preventDefault(); void mkDo(why.trim()) }}>
          <label className="grid gap-1 text-sm"><span>{TT('why')}</span><input className="input" maxLength={300} value={why} onChange={e => setWhy(e.target.value)} /></label>
          <div><button className="btn" disabled={busy || why.trim().length < 3}>{TT('mkDo')}</button></div></form></details>)}
  </>
  else if (c.stage === 'in_production') body = !left ? <p>{TT('waitSign')}</p> : !ok('issue_delivery') ? <p>{TT('noPerm')}</p> : <>
    <p className="text-sm text-muted">{TT('doHint')}</p><div><button className="btn btn-primary" disabled={busy} onClick={() => void mkDo()}>{TT('mkDo')}</button></div></>
  else body = !owner ? <p>{TT('ownerOnly')}</p> : (  // delivered: the owner issues the invoice
    <form className="grid gap-2" onSubmit={e => { e.preventDefault(); void run(async () => { const r = await api<{ doc_no: string }>('POST', `/jobs/${c.job.id}/invoice`, due ? { due_on: due } : {}); return `${TT('invoice')} ${r.doc_no}` }) }}>
      <label className="grid gap-1 text-sm"><span>{TT('due')}</span><input className="input w-48" type="date" min={today()} value={due} onChange={e => setDue(e.target.value)} /></label>
      <div><button className="btn btn-primary" disabled={busy}>{TT('mkInv')}</button></div>
    </form>)
  return <section aria-label={TT('next')} className="card mb-4 grid gap-3" data-guide="deals-actions"><h2 className="text-lg font-semibold">{TT('next')}</h2>{title && <p className="font-semibold">{title}</p>}{body}</section>
}

function Delivery({ c, owner, run, links, onLink }: { c: Chain; owner: boolean; run: Run; links: Record<string, string>; onLink: (id: string, url: string) => void }) {
  const toast = useToast()
  const ok = owner || can('issue_delivery')
  if (!c.delivery_orders.length) return null
  const get = (id: string) => run(async () => { const r = await api<{ url: string }>('POST', `/deal-docs/${id}/delivery-link`); onLink(id, r.url); return TT('link') })
  return (
    <section aria-label={TT('dels')} className="card mb-4 grid gap-3"><h2 className="text-lg font-semibold">{TT('dels')}</h2>
      <ul className="grid gap-3">{c.delivery_orders.filter(d => d.status !== 'void').map(d => (
        <li key={d.id} className="grid gap-2 rounded-ui border border-hairline p-3">
          <p className="flex flex-wrap items-center gap-2"><b>{d.doc_no}</b>
            <span className={`chip ${d.signature ? 'chip-accepted' : 'chip-draft'}`}>{d.signature ? `${TT('signed')} ${d.signature.name}` : TT('waiting')}</span>
            {d.signature && <span className="text-sm text-muted">{new Date(d.signature.at).toLocaleString(locale())}</span>}</p>
          {d.signature?.problems && <p className="text-sm text-warn">{TT('problem')} {d.signature.problems}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {!d.signature && ok && <button className="btn" onClick={() => void get(d.id)}>{TT('link')}</button>}
            <button className="btn" onClick={() => void download(`/deal-docs/${d.id}/pdf`, `${d.doc_no}.pdf`).catch(e => toast(msg(e)))}>{TT('pdf')}</button>
          </div>
          {links[d.id] && <div className="grid gap-1"><label className="grid gap-1 text-sm"><span>{TT('linkL')}</span>
            <input className="input" readOnly value={links[d.id]} onFocus={e => e.currentTarget.select()} /></label>
            <div><button className="btn" onClick={() => { void navigator.clipboard?.writeText(links[d.id]).then(() => toast(TT('copied')), () => toast(links[d.id])) }}>{TT('copy')}</button></div></div>}
        </li>))}</ul>
    </section>
  )
}

export function OrderPage({ id, owner }: { id: string; owner: boolean }) {
  useLang()
  const s = useFetch<Chain>(`/jobs/${id}/chain`)
  const list = useFetch<Linked[]>('/chain')
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [links, setLinks] = useState<Record<string, string>>({})  // a sign link is shown once, so it is kept here until the page is left
  const onLink = (did: string, url: string) => setLinks(l => ({ ...l, [did]: url }))
  const c = s.data
  const linked = (list.data ?? []).filter(d => d.job_id === id)
  const run: Run = async fn => {
    setBusy(true)
    try { toast(await fn()); s.reload(); list.reload() } catch (e) { toast(msg(e)) } finally { setBusy(false) }
  }
  const live = (k: Doc['kind']) => c?.documents.some(d => d.kind === k && d.status !== 'void')
  const steps: [string, string, 'done' | 'now' | 'todo', string?, string?][] = !c ? [] : [
    [TT('quote'), 'quote', c.job.quote_id ? 'done' : 'todo', c.job.quote_id ? `#/doc/${c.job.quote_id}` : undefined, TT('none')],
    [TT('order'), 'order', 'done'],
    [TT('proforma'), 'proforma', live('proforma') ? 'done' : c.stage === 'awaiting_deposit' ? 'now' : 'todo'],
    [TT('delivery'), 'delivery', c.delivery.complete ? 'done' : c.delivery_orders.length || c.stage === 'in_production' ? 'now' : 'todo'],
    [TT('invoice'), 'invoice', live('invoice') ? 'done' : c.stage === 'delivered' ? 'now' : 'todo'],
    [TT('receipt'), 'receipt', c.stage === 'paid' ? 'done' : live('receipt') ? 'now' : 'todo'],
  ]
  const so = linked.find(d => d.kind === 'so' || d.kind === 'cpo')
  return (
    <>
      <PageHeader title={c ? c.job.title : TT('deal')} back={{ href: '#/deals', label: TT('deals') }} />
      <Async s={s} empty={!c}>
        {c && <>
          <nav aria-label={TT('trail')} className="mb-4 overflow-x-auto" data-guide="deals-pipeline">
            <ol className="flex min-w-max items-center gap-1">{steps.map(([label, k, state, href, hint], i) => <Step key={k} n={i + 1} label={label} state={state} href={href} hint={hint} />)}</ol>
          </nav>
          <section className="card mb-4 grid gap-1">
            <p className="flex flex-wrap items-center gap-2"><span className={`chip ${c.stage === 'paid' ? 'chip-accepted' : 'chip-approved'}`}>{TT(c.stage)}</span>
              {c.overdue && <span className="text-sm text-warn">{TT('late')}</span>}{c.job.customer && <span className="text-sm text-muted">{c.job.customer}</span>}</p>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
              <dt className="text-muted">{TT('total')}</dt><dd className="text-right text-lg font-semibold">{rm(c.total)}</dd>
              {c.deposit && <><dt className="text-muted">{TT('deposit')} ({Number(c.deposit.pct)}%)</dt><dd className="text-right">{rm(c.deposit.paid)} / {rm(c.deposit.amount)}</dd></>}
              {Number(c.credited) > 0 && <><dt className="text-muted">{TT('credited')}</dt><dd className="text-right">-{rm(c.credited)}</dd></>}
              <dt className="text-muted">{TT('paidL')}</dt><dd className="text-right">{rm(c.paid)}</dd>
              <dt className="text-muted">{TT('balance')}</dt><dd className="text-right font-semibold">{rm(c.balance)}</dd>
            </dl>
          </section>
          <NextStep c={c} owner={owner} run={run} busy={busy} onLink={onLink} />
          <Delivery c={c} owner={owner} run={run} links={links} onLink={onLink} />
          {owner && c.invoice && Number(c.balance) > 0 && <CreditForm c={c} run={run} busy={busy} />}
          {(linked.length > 0 || c.job.quote_id) && <section aria-label={TT('linked')} className="card mb-4 grid gap-2"><h2 className="text-lg font-semibold">{TT('linked')}</h2>
            <ul className="grid gap-1">{linked.map(d => <li key={d.id} className="flex flex-wrap items-center gap-2"><a href={`#/deals/d:${d.id}`}>{d.doc_no}</a><Status v={d.status} /><span className="tabular-nums text-muted">{rm(d.total)}</span></li>)}</ul>
            {c.job.quote_id && !so && (owner || can('manage_contacts')) && <div><button className="btn" disabled={busy} onClick={() => void run(async () => { await api('POST', `/chain/from-quote/${c.job.quote_id}`, { to: 'so' }); return TT('soMade') })}>{TT('mkSo')}</button></div>}
          </section>}
          {so && <BuyLane trail={linked} owner={owner} onChanged={() => { s.reload(); list.reload() }} />}
          <section aria-label={TT('docs')} className="mb-4" data-guide="deals-docs"><h2 className="mb-2 text-lg font-semibold">{TT('docs')}</h2>
            <DataTable label={TT('docs')} caption={TT('docs')} rows={c.documents} rowKey={d => d.id} cols={[
              { key: 'no', head: TT('docNo'), mobile: 'title', cell: d => d.doc_no },
              { key: 'k', head: TT('type'), mobile: 'sub', cell: d => TT(d.kind) },
              { key: 'st', head: TT('st'), mobile: 'badge', cell: d => <Status v={d.status} /> },
              { key: 'tot', head: TT('total'), num: true, mobile: 'meta', cell: d => rm(d.total) },
              { key: 'pdf', head: TT('pdf'), mobile: 'meta', cell: d => <button className="btn btn-sm" onClick={() => void download(`/deal-docs/${d.id}/pdf`, `${d.doc_no}.pdf`).catch(e => toast(msg(e)))}>{TT('pdf')}</button> }]} />
          </section>
          {c.payments.length > 0 && <section aria-label={TT('pays')} className="card mb-4"><h2 className="mb-2 text-lg font-semibold">{TT('pays')}</h2>
            <ul className="grid gap-1 text-sm">{c.payments.map(p => <li key={p.id} className="tabular-nums">{[p.paid_on, `${p.reverses_payment_id ? '-' : ''}${rm(p.amount)}`, p.method, p.reference].filter(Boolean).join(' · ')}{p.reversed ? ` (${TT('reversed')})` : ''}</li>)}</ul></section>}
          <p className="text-sm text-muted">{TT('prep')}</p>
        </>}
      </Async>
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Icon } from './icons'
import type { IconName } from './icons'
import { t } from './i18n'
import type { Text } from './i18n'
import { Glyph, PATH } from './TradeOrbit'
import type { Lane } from './TradeOrbit'
import { PRICE } from './Pricing'
import './landing.css'

// The animated parts of the public homepage: a looping chat-to-quote demo, the order journey as a clickable process diagram, how a price is built,
// and the plans. Everything is illustration with made-up numbers. Under prefers-reduced-motion nothing moves and the finished picture shows.
const reducedNow = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function useInView(ref: RefObject<Element | null>) {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return }
    const o = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { threshold: 0.25 })
    o.observe(el)
    return () => o.disconnect()
  }, [ref])
  return seen
}

// Counts up to `to` once `on` turns true (instantly under reduced motion).
function useCount(to: number, on: boolean, ms = 1100, again = 0) {
  const [v, setV] = useState(reducedNow() ? to : 0)
  useEffect(() => {
    if (!on) return
    if (reducedNow()) { setV(to); return }
    setV(0)
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => { const p = Math.min((now - t0) / ms, 1); setV(Math.round(to * (1 - (1 - p) ** 3))); if (p < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, on, ms, again])
  return v
}
const rm = (n: number) => 'RM ' + n.toLocaleString('en-MY')

export const P = {
  nJourney: { en: 'Order journey', ms: 'Perjalanan pesanan', zh: '订单旅程' } satisfies Text,
  nPricing: { en: 'Pricing', ms: 'Harga', zh: '价格' } satisfies Text,
  walk: { en: 'See how an order flows', ms: 'Lihat bagaimana pesanan mengalir', zh: '看订单如何流转' } satisfies Text,
}

// A slow ribbon of things LARIS does all day, drifting past. Decorative: the same facts are in the sections below.
const TK = [
  { icon: 'check', t: { en: 'Quote approved · RM 1,260', ms: 'Sebut harga diluluskan · RM 1,260', zh: '报价已批准 · RM 1,260' } },
  { icon: 'revenue', t: { en: 'Deposit recorded · RM 630', ms: 'Deposit direkodkan · RM 630', zh: '已记录订金 · RM 630' } },
  { icon: 'jobs', t: { en: 'Delivery signed on a phone', ms: 'Penghantaran ditandatangani pada telefon', zh: '送货单已在手机签收' } },
  { icon: 'tracker', t: { en: 'Invoice issued · deposit already taken off', ms: 'Invois dikeluarkan · deposit sudah ditolak', zh: '发票已开出 · 订金已扣除' } },
  { icon: 'inbox', t: { en: 'Receipt made for a payment', ms: 'Resit dibuat untuk satu bayaran', zh: '已为一笔付款生成收据' } },
  { icon: 'warn', t: { en: 'Margin below your floor: held for you', ms: 'Margin di bawah lantai anda: ditahan untuk anda', zh: '利润率低于底线：留待您处理' } },
  { icon: 'alerts', t: { en: 'Supplier price changed: quote flagged', ms: 'Harga pembekal berubah: sebut harga ditandakan', zh: '供应商涨价：相关报价已标出' } },
  { icon: 'ask', t: { en: 'Goods received: filament 4 kg', ms: 'Barang diterima: filamen 4 kg', zh: '已收货：耗材 4 公斤' } },
] satisfies { icon: IconName; t: Text }[]
export function Ticker() {
  const row = (k: string) => TK.map(x => <li key={k + x.t.en} className="flex shrink-0 items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-1.5 text-sm"><Icon name={x.icon} className="size-4 text-accent" />{t(x.t)}</li>)
  return (
    <div aria-hidden="true" className="lp-ticker overflow-hidden border-y border-hairline bg-surface-2/60 py-3">
      <ul className="lp-marquee flex w-max gap-3 pl-3">{row('a')}{row('b')}</ul>
    </div>
  )
}

// ---------------------------------------------------------------- the order journey as a process diagram
interface Stop { id: string; icon: IconName; n: Text; d: Text; does: Text; you: Text; count: string }
const J = {
  h: { en: 'Follow one order, from quote to receipt', ms: 'Ikuti satu pesanan, dari sebut harga hingga resit', zh: '跟着一张订单，从报价走到收据' },
  p: { en: 'It plays on its own, or pick any step. Each document is made from the one before it, so nothing is typed twice.', ms: 'Ia bermain sendiri, atau pilih mana-mana langkah. Setiap dokumen dibuat daripada yang sebelumnya, jadi tiada apa ditaip dua kali.', zh: '它会自动播放，也可以点任一步骤。每份文件都由上一份生成，不用重复输入。' },
  what: { en: 'What it is', ms: 'Apa ia', zh: '这是什么' }, does: { en: 'LARIS does', ms: 'LARIS lakukan', zh: 'LARIS 负责' }, you: { en: 'You do', ms: 'Anda lakukan', zh: '您负责' },
  sup: { en: 'Buying filament or stock? Supplier PO and Goods received follow the same pattern, under Supplier orders.', ms: 'Membeli filamen atau stok? PO pembekal dan Barang diterima mengikut corak yang sama, di bawah Pesanan pembekal.', zh: '要向供应商进货？供应商采购单和收货记录走同样的流程，在“供应商订单”里。' },
  sample: { en: 'Sample counts shown in each step', ms: 'Contoh bilangan di setiap langkah', zh: '每个步骤上的数字为示例' },
  list: { en: 'Order steps', ms: 'Langkah pesanan', zh: '订单步骤' },
}
const STOPS: Stop[] = [
  { id: 'quote', icon: 'ask', count: '12', n: { en: 'Quote', ms: 'Sebut harga', zh: '报价' }, d: { en: 'A priced draft made from the customer’s chat.', ms: 'Draf berharga yang dibuat daripada sembang pelanggan.', zh: '根据客户聊天生成的带价格草稿。' },
    does: { en: 'Reads the request and prices it from your cost book.', ms: 'Membaca permintaan dan menghargakan daripada buku kos anda.', zh: '读懂需求，按您的成本表定价。' }, you: { en: 'Check the margin and approve.', ms: 'Semak margin dan luluskan.', zh: '查看利润率并批准。' } },
  { id: 'po', icon: 'inbox', count: '5', n: { en: 'Purchase order', ms: 'Pesanan belian', zh: '采购订单' }, d: { en: 'The customer’s own PO, kept with their reference number.', ms: 'PO pelanggan sendiri, disimpan dengan nombor rujukan mereka.', zh: '客户自己的采购单，连同对方编号一起保存。' },
    does: { en: 'Records it and lists it as needing you.', ms: 'Merekodkannya dan menyenaraikannya sebagai perlu tindakan anda.', zh: '记录下来，并列为待您处理。' }, you: { en: 'Confirm you can do the job.', ms: 'Sahkan anda boleh buat kerja itu.', zh: '确认接单。' } },
  { id: 'so', icon: 'check', count: '4', n: { en: 'Sales order', ms: 'Pesanan jualan', zh: '销售订单' }, d: { en: 'Your confirmation of the order.', ms: 'Pengesahan anda untuk pesanan itu.', zh: '您对订单的确认。' },
    does: { en: 'Makes it from the PO in one click, lines copied.', ms: 'Membuatnya daripada PO dengan satu klik, baris disalin.', zh: '一键由采购单生成，明细自动带入。' }, you: { en: 'Press Make sales order.', ms: 'Tekan Buat pesanan jualan.', zh: '点“生成销售订单”。' } },
  { id: 'pf', icon: 'revenue', count: '3', n: { en: 'Proforma', ms: 'Proforma', zh: '形式发票' }, d: { en: 'Asks for a deposit before you start. 50% by default, and you can change it.', ms: 'Meminta deposit sebelum anda mula. 50% secara lalai, dan anda boleh ubah.', zh: '开工前请客户付订金。默认 50%，可修改。' },
    does: { en: 'Works out the deposit and can hold production until it is paid.', ms: 'Mengira deposit dan boleh menahan pengeluaran sehingga dibayar.', zh: '算出订金，付清前可暂缓生产。' }, you: { en: 'Record the deposit when it arrives.', ms: 'Rekod deposit apabila diterima.', zh: '收到订金后记录。' } },
  { id: 'do', icon: 'jobs', count: '2', n: { en: 'Delivery order', ms: 'Pesanan penghantaran', zh: '送货单' }, d: { en: 'What went out, with part deliveries allowed.', ms: 'Apa yang dihantar, dengan penghantaran separa dibenarkan.', zh: '实际送出的货物，可分批送货。' },
    does: { en: 'Gives the customer a link to sign on their phone.', ms: 'Memberi pautan untuk pelanggan tandatangan pada telefon.', zh: '给客户一个手机签收链接。' }, you: { en: 'Send the goods and the link.', ms: 'Hantar barang dan pautan.', zh: '发货并发出链接。' } },
  { id: 'inv', icon: 'tracker', count: '2', n: { en: 'Invoice', ms: 'Invois', zh: '发票' }, d: { en: 'The bill for what is left. The deposit is already taken off.', ms: 'Bil untuk baki. Deposit sudah ditolak.', zh: '余款账单，订金已扣除。' },
    does: { en: 'Fills it in and tracks who still owes you. Credit notes cover a failed reprint.', ms: 'Mengisinya dan menjejak siapa yang masih berhutang. Nota kredit meliputi cetakan semula yang gagal.', zh: '自动填写并追踪欠款。重印失败可开贷项通知单。' }, you: { en: 'Issue it when delivery is signed.', ms: 'Keluarkan apabila penghantaran ditandatangani.', zh: '签收后开出。' } },
  { id: 'rc', icon: 'check', count: '9', n: { en: 'Receipt', ms: 'Resit', zh: '收据' }, d: { en: 'Proof of each payment you recorded.', ms: 'Bukti setiap bayaran yang anda rekodkan.', zh: '您所记录的每笔付款的凭证。' },
    does: { en: 'Makes a receipt per payment. It only records: it never takes or moves money.', ms: 'Membuat resit bagi setiap bayaran. Ia hanya merekod: tidak mengambil atau memindahkan wang.', zh: '每笔付款生成一张收据。只做记录，不经手资金。' }, you: { en: 'Record the payment you received.', ms: 'Rekod bayaran yang anda terima.', zh: '记录收到的付款。' } },
]

export function Journey() {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useInView(ref)
  const [i, setI] = useState(0)
  const [beat, setBeat] = useState(0)  // a click restarts the wait, so the step you picked stays a while before the loop carries on
  useEffect(() => {
    if (!seen || reducedNow()) return
    const id = setInterval(() => setI(x => (x + 1) % STOPS.length), 3200)
    return () => clearInterval(id)
  }, [seen, beat])
  const s = STOPS[i], N = STOPS.length
  return (
    <div ref={ref} className="mt-6">
      <p className="max-w-2xl text-muted">{t(J.p)}</p>
      <div className="mt-5 overflow-x-auto pb-2">
        <ol className="relative grid min-w-[46rem] grid-cols-7" aria-label={t(J.list)}>
          <span aria-hidden="true" className="absolute top-6 h-0.5 rounded bg-hairline" style={{ left: `${50 / N}%`, right: `${50 / N}%` }}>
            <span className="lp-line block h-full rounded bg-accent" style={{ width: `${(i / (N - 1)) * 100}%` }} />
          </span>
          {STOPS.map((x, n) => (
            <li key={x.id} className="grid justify-items-center">
              <button type="button" onClick={() => { setI(n); setBeat(b => b + 1) }} aria-current={i === n ? 'step' : undefined} className="group grid justify-items-center gap-1.5 px-1 text-center">
                <span className="lp-node" data-s={n < i ? 'done' : n === i ? 'now' : 'next'}><Icon name={x.icon} className="size-5" /></span>
                <span className={`text-sm font-semibold ${i === n ? 'text-ink' : 'text-muted group-hover:text-ink'}`}>{t(x.n)}</span>
                <span className="rounded-full bg-tint px-2 py-0.5 text-xs font-semibold tabular-nums text-muted">{x.count}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div key={s.id} className="lp-pop card mt-3 grid gap-4 p-5 md:grid-cols-3" aria-live="polite">
        {([[J.what, s.d], [J.does, s.does], [J.you, s.you]] as const).map(([h, body], n) => (
          <div key={n} className={n === 1 ? 'md:border-x md:border-hairline md:px-4' : ''}>
            <p className="text-xs font-semibold uppercase tracking-wide text-accent">{t(h)}</p>
            <p className="mt-1.5 text-sm">{t(body)}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">{t(J.sample)}</p>
      <p className="mt-4 flex items-start gap-2 rounded-ui bg-tint p-3 text-sm text-muted"><Icon name="inbox" className="mt-0.5 size-4 shrink-0 text-accent" />{t(J.sup)}</p>
    </div>
  )
}
export const JOURNEY_TITLE = J.h

// ---------------------------------------------------------------- how a price is built
const B = {
  h: { en: 'How a price is built', ms: 'Bagaimana harga dibina', zh: '价格是怎么算出来的' },
  p: { en: 'Your cost, plus your margin, set by rules you control. The margin floor flags anything too thin before it goes out.', ms: 'Kos anda, tambah margin anda, ditetapkan oleh peraturan yang anda kawal. Lantai margin menandakan apa-apa yang terlalu nipis sebelum dihantar.', zh: '您的成本，加上您的利润，由您控制的规则决定。利润率低于底线的报价，发出前就会被标出。' },
  cost: { en: 'Your cost', ms: 'Kos anda', zh: '您的成本' }, margin: { en: 'Your margin', ms: 'Margin anda', zh: '您的利润' }, price: { en: 'Quote price', ms: 'Harga sebut harga', zh: '报价' },
  ai: { en: 'AI reads the request. It never sets the price.', ms: 'AI membaca permintaan. Ia tidak menetapkan harga.', zh: 'AI 只读懂需求，不决定价格。' },
}
export function PriceBuild() {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useInView(ref)
  const [round, setRound] = useState(0)
  const [shown, setShown] = useState(true)
  useEffect(() => {
    if (!seen || reducedNow()) return
    const id = setInterval(() => { setShown(false); setTimeout(() => { setRound(r => r + 1); setShown(true) }, 600) }, 7000)
    return () => clearInterval(id)
  }, [seen])
  const on = seen && shown
  const cost = useCount(832, on, 1000, round), margin = useCount(428, on, 1300, round), price = useCount(1260, on, 1600, round)
  return (
    <div ref={ref} className="card mt-6 grid gap-5 p-5 md:grid-cols-[1fr_1.3fr] md:items-center">
      <div>
        <h3 className="text-lg font-semibold">{t(B.h)}</h3>
        <p className="mt-2 text-sm text-muted">{t(B.p)}</p>
        <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-accent"><Icon name="roles" className="size-4" />{t(B.ai)}</p>
      </div>
      <div>
        <div className="flex h-12 overflow-hidden rounded-card bg-tint" role="img" aria-label={`${t(B.cost)} RM 832, ${t(B.margin)} RM 428, ${t(B.price)} RM 1,260`}>
          <div className="lp-bar grid place-items-center bg-surface-2 text-xs font-semibold text-ink-2" style={{ width: on ? '66%' : '0%' }}>{on && t(B.cost)}</div>
          <div className="lp-bar grid place-items-center bg-accent text-xs font-semibold text-on-accent" style={{ width: on ? '34%' : '0%', transitionDelay: on ? '.5s' : '0s' }}>{on && '34%'}</div>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
          <div><dt className="text-xs text-muted">{t(B.cost)}</dt><dd className="font-semibold tabular-nums">{rm(cost)}</dd></div>
          <div><dt className="text-xs text-muted">+ {t(B.margin)}</dt><dd className="font-semibold tabular-nums text-accent">{rm(margin)}</dd></div>
          <div><dt className="text-xs text-muted">= {t(B.price)}</dt><dd className="text-lg font-bold tabular-nums">{rm(price)}</dd></div>
        </dl>
      </div>
    </div>
  )
}


// ---------------------------------------------------------------- customer, your business, supplier: one order told as a loop that never needs a button
// Eight beats, 2.6 s each. A document or a coin flies along a lane, the node it reaches pulses, and the three cards below keep the score.
const TS = {
  label: { en: 'One order travelling between your customer, your business and your supplier', ms: 'Satu pesanan bergerak antara pelanggan, perniagaan dan pembekal anda', zh: '一张订单在客户、您的企业与供应商之间流转' },
  customer: { en: 'Customer', ms: 'Pelanggan', zh: '客户' }, business: { en: 'Your business', ms: 'Perniagaan anda', zh: '您的企业' }, supplier: { en: 'Supplier', ms: 'Pembekal', zh: '供应商' },
  buys: { en: 'buys from you', ms: 'beli daripada anda', zh: '向您购买' }, you: { en: 'your workspace', ms: 'ruang kerja anda', zh: '您的工作区' }, sells: { en: 'you buy from', ms: 'anda beli daripada', zh: '您向其采购' },
  quote: { en: 'Quote', ms: 'Sebut harga', zh: '报价' }, order: { en: 'Order', ms: 'Pesanan', zh: '订单' }, deposit: { en: 'Deposit', ms: 'Deposit', zh: '订金' }, owed: { en: 'Still owed', ms: 'Masih terhutang', zh: '尚欠' },
  loop: { en: 'Repeats on its own', ms: 'Berulang sendiri', zh: '自动循环' },
}
type Fly = { lane: Lane; code: string; coin?: boolean; to: 'customer' | 'business' | 'supplier' }
const FLY: Fly[] = [
  { lane: 'lu', code: 'ASK', to: 'business' }, { lane: 'ld', code: 'QT', to: 'customer' }, { lane: 'lu', code: 'SO', to: 'business' }, { lane: 'lu', code: 'RM', coin: true, to: 'business' },
  { lane: 'ru', code: 'PO', to: 'supplier' }, { lane: 'rd', code: 'GRN', to: 'business' }, { lane: 'ld', code: 'INV', to: 'customer' }, { lane: 'lu', code: 'RM', coin: true, to: 'business' },
]
const CAP: Text[] = [
  { en: 'A customer asks for a price', ms: 'Pelanggan minta harga', zh: '客户询价' }, { en: 'You send a quotation, priced by your rules', ms: 'Anda hantar sebut harga, harga ikut peraturan anda', zh: '您发出报价单，由规则定价' },
  { en: 'The customer accepts and orders', ms: 'Pelanggan terima dan buat pesanan', zh: '客户接受并下单' }, { en: '50% deposit arrives and is recorded', ms: 'Deposit 50% diterima dan direkodkan', zh: '收到 50% 订金并记录' },
  { en: 'You order what you need from your supplier', ms: 'Anda pesan keperluan daripada pembekal', zh: '您向供应商下采购订单' }, { en: 'The goods arrive and are booked in', ms: 'Barang tiba dan direkodkan', zh: '货物到达并入库记录' },
  { en: 'Delivered, signed for and invoiced', ms: 'Dihantar, ditandatangani dan diinvois', zh: '送达、签收并开票' }, { en: 'The balance is paid and a receipt is made', ms: 'Baki dibayar dan resit dibuat', zh: '余款付清，生成收据' },
]
const CUST: Text[] = [
  { en: 'Wants 3 signboards', ms: 'Mahu 3 papan tanda', zh: '想要 3 块招牌' }, { en: 'Reading your quotation', ms: 'Membaca sebut harga anda', zh: '正在看您的报价' }, { en: 'Accepted RM 1,260', ms: 'Terima RM 1,260', zh: '已接受 RM 1,260' }, { en: 'Deposit sent RM 630', ms: 'Deposit dihantar RM 630', zh: '已付订金 RM 630' },
  { en: 'Waiting for the goods', ms: 'Menunggu barang', zh: '等待货物' }, { en: 'Waiting for the goods', ms: 'Menunggu barang', zh: '等待货物' }, { en: 'Goods received, invoice in hand', ms: 'Barang diterima, invois di tangan', zh: '已收货，持有发票' }, { en: 'Paid in full', ms: 'Dibayar penuh', zh: '已全额付款' },
]
const SUP: Text[] = [{ en: 'Ready to quote you', ms: 'Sedia memberi sebut harga', zh: '随时为您报价' }, { en: 'Got your purchase order', ms: 'Terima pesanan belian anda', zh: '已收到您的采购订单' }, { en: 'Goods sent to you', ms: 'Barang dihantar kepada anda', zh: '货物已发出' }, { en: 'Order complete', ms: 'Pesanan selesai', zh: '订单完成' }]
const supStage = (s: number) => (s < 4 ? 0 : s === 4 ? 1 : s === 5 ? 2 : 3)
// What the business card shows after each beat: [quote RM, order RM, deposit RM, still owed RM]
const BIZ: [number, number, number, number][] = [[0, 0, 0, 0], [1260, 0, 0, 0], [1260, 1260, 0, 1260], [1260, 1260, 630, 630], [1260, 1260, 630, 630], [1260, 1260, 630, 630], [1260, 1260, 630, 630], [1260, 1260, 630, 0]]
const STEP_MS = 2600
const rmv = (n: number) => (n ? 'RM ' + n.toLocaleString('en-MY') : '-')

export function TradeStory() {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useInView(ref)
  const calm = reducedNow()
  const [step, setStep] = useState(calm ? FLY.length - 1 : 0)
  useEffect(() => {
    if (!seen || calm) return
    const id = setInterval(() => setStep(s => (s + 1) % FLY.length), STEP_MS)
    return () => clearInterval(id)
  }, [seen, calm])
  const f = FLY[step], b = BIZ[step], sup = supStage(step)
  const nodes: { id: 'customer' | 'business' | 'supplier'; x: number; r: number; name: Text; sub: Text }[] = [
    { id: 'customer', x: 100, r: 42, name: TS.customer, sub: TS.buys }, { id: 'business', x: 380, r: 54, name: TS.business, sub: TS.you }, { id: 'supplier', x: 660, r: 42, name: TS.supplier, sub: TS.sells },
  ]
  return (
    <div ref={ref} className="grid gap-4" aria-label={t(TS.label)} role="group">
      <svg viewBox="0 0 760 260" role="img" aria-label={t(TS.label)} className="h-auto w-full" style={{ maxHeight: 300 }}>
        <title>{t(TS.label)}</title>
        {(Object.keys(PATH) as Lane[]).map(l => <path key={l} className="orb-lane" d={PATH[l]} data-on={f.lane === l ? '1' : undefined} />)}
        {nodes.map(n => {
          const hit = f.to === n.id
          return (
            <g key={n.id} className="orb-node" transform={`translate(${n.x} 130)`} style={{ cursor: 'default' }}>
              <circle className="orb-halo" r={n.r + 14} />
              <circle className="orb-ring" r={n.r} data-hit={hit ? '1' : undefined} key={hit ? `h${step}` : 'x'} />
              <circle className="orb-disc" r={n.r} style={hit ? { transform: 'scale(1.08)' } : undefined} />
              <g transform="translate(0 -6)"><Glyph node={n.id} /></g>
              <text className="orb-text" y={n.r + 22}>{t(n.name)}</text>
              <text className="orb-sub" y={n.r + 38}>{t(n.sub)}</text>
            </g>
          )
        })}
        {!calm && (
          <g key={step} className="lp-fly" style={{ offsetPath: `path('${PATH[f.lane]}')` }} aria-hidden="true">
            {f.coin
              ? <><circle r="13" fill="var(--amber)" stroke="var(--ink)" strokeWidth="1.2" /><text textAnchor="middle" y="4" fontSize="10" fontWeight="800" fill="#1b1300">RM</text></>
              : <><rect x="-22" y="-12" width="44" height="24" rx="8" fill="var(--accent)" /><text textAnchor="middle" y="4" fontSize="11" fontWeight="800" fill="var(--on-accent)">{f.code}</text></>}
          </g>
        )}
        {!calm && f.coin && [0, 1, 2, 3, 4].map(i => <circle key={`${step}-${i}`} className="lp-spark" cx={380 + (i - 2) * 16} cy={70} r="3.5" style={{ animationDelay: `${1.25 + i * 0.08}s` }} />)}
      </svg>

      <div className="grid gap-3 md:grid-cols-3" aria-live="off">
        <article className={`card p-4 transition-shadow duration-500 ${f.to === 'customer' ? 'shadow-2 border-accent' : ''}`}>
          <h3 className="text-sm font-semibold text-muted">{t(TS.customer)}</h3>
          <p key={step} className="lp-pop mt-1.5 text-md font-semibold">{t(CUST[step])}</p>
        </article>
        <article className={`card p-4 transition-shadow duration-500 ${f.to === 'business' ? 'shadow-2 border-accent' : ''}`}>
          <h3 className="text-sm font-semibold text-muted">{t(TS.business)}</h3>
          <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            {([[TS.quote, b[0]], [TS.order, b[1]], [TS.deposit, b[2]], [TS.owed, b[3]]] as const).map(([k, v], i) => (
              <div key={i}><dt className="text-xs text-muted">{t(k)}</dt><dd key={`${step}-${v}`} className="lp-pop font-semibold tabular-nums">{rmv(v)}</dd></div>
            ))}
          </dl>
        </article>
        <article className={`card p-4 transition-shadow duration-500 ${f.to === 'supplier' ? 'shadow-2 border-accent' : ''}`}>
          <h3 className="text-sm font-semibold text-muted">{t(TS.supplier)}</h3>
          <p key={sup} className="lp-pop mt-1.5 text-md font-semibold">{t(SUP[sup])}</p>
        </article>
      </div>

      <div>
        <p key={step} className="lp-pop text-center text-md font-semibold md:text-lg"><span className="text-accent">{step + 1}.</span> {t(CAP[step])}</p>
        <ol className="mt-3 grid grid-cols-8 gap-1.5" aria-hidden="true">
          {FLY.map((_, i) => (
            <li key={i} className="h-1.5 overflow-hidden rounded-full bg-hairline">
              <span className={`block h-full rounded-full bg-accent ${i === step && !calm ? 'lp-seg' : ''}`} style={{ width: i < step || calm ? '100%' : i === step ? undefined : '0%', animationDuration: `${STEP_MS}ms` }} />
            </li>
          ))}
        </ol>
        <p className="mt-2 text-center text-xs text-muted">{t(TS.loop)}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- pricing teaser: the plans flip between monthly and yearly by themselves
const PT = {
  h: { en: 'Simple pricing, monthly or yearly', ms: 'Harga mudah, bulanan atau tahunan', zh: '简单价格，按月或按年' },
  p: { en: 'One price per business, not per quote. Pay monthly, or yearly and get two months free.', ms: 'Satu harga setiap perniagaan, bukan setiap sebut harga. Bayar bulanan, atau tahunan dan dapat dua bulan percuma.', zh: '按企业收费，不按报价次数。按月付款，或按年付款送两个月。' },
  month: { en: 'Monthly', ms: 'Bulanan', zh: '按月' }, year: { en: 'Yearly', ms: 'Tahunan', zh: '按年' }, mo: { en: '/ month', ms: '/ bulan', zh: '/ 月' }, yr: { en: '/ year', ms: '/ tahun', zh: '/ 年' },
  seats: { en: 'Up to {0} people', ms: 'Sehingga {0} orang', zh: '最多 {0} 人' }, see: { en: 'See every plan', ms: 'Lihat semua pelan', zh: '查看全部套餐' }, free: { en: '2 months free', ms: '2 bulan percuma', zh: '送 2 个月' },
}
const PT_PLANS = [{ k: 'starter', name: 'Lite', seats: 3 }, { k: 'standard', name: 'Standard', seats: 10 }, { k: 'pro', name: 'Pro', seats: 25 }] as const
export function PricingTeaser() {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useInView(ref)
  const [per, setPer] = useState<'month' | 'year'>('month')
  useEffect(() => {
    if (!seen || reducedNow()) return
    const id = setInterval(() => setPer(p => (p === 'month' ? 'year' : 'month')), 3600)
    return () => clearInterval(id)
  }, [seen])
  return (
    <div ref={ref} className="mt-6">
      <p className="max-w-2xl text-muted">{t(PT.p)}</p>
      <div className="mt-5 inline-flex rounded-full border border-hairline bg-surface p-1" role="img" aria-label={t(per === 'month' ? PT.month : PT.year)}>
        {(['month', 'year'] as const).map(k => (
          <span key={k} className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors duration-500 ${per === k ? 'bg-accent text-on-accent' : 'text-muted'}`}>
            {t(k === 'month' ? PT.month : PT.year)}{k === 'year' && <span className="ml-2 text-xs opacity-90">{t(PT.free)}</span>}
          </span>
        ))}
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {PT_PLANS.map((p, n) => (
          <a key={p.k} href="#/pricing" className={`lp-plan card block p-6 no-underline ${n === 1 ? 'mid border-accent shadow-2' : ''}`}>
            <h3 className="text-lg font-semibold">{p.name}</h3>
            <p className="mt-2 flex items-baseline gap-1"><span key={per} className="lp-pop text-4xl font-bold tabular-nums">RM{PRICE[per][p.k].toLocaleString('en-MY')}</span><span className="text-sm text-muted">{t(per === 'month' ? PT.mo : PT.yr)}</span></p>
            <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-accent"><Icon name="team" className="size-4" />{t(PT.seats).replace('{0}', String(p.seats))}</p>
          </a>
        ))}
      </div>
      <p className="mt-5"><a className="btn min-h-11 px-6" href="#/pricing">{t(PT.see)}</a></p>
    </div>
  )
}
export const PRICING_TEASER_TITLE = PT.h

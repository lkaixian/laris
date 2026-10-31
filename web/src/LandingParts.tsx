import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Icon } from './icons'
import type { IconName } from './icons'
import { t } from './i18n'
import type { Text } from './i18n'
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

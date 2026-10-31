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
function useCount(to: number, on: boolean, ms = 1100) {
  const [v, setV] = useState(reducedNow() ? to : 0)
  useEffect(() => {
    if (!on) return
    if (reducedNow()) { setV(to); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => { const p = Math.min((now - t0) / ms, 1); setV(Math.round(to * (1 - (1 - p) ** 3))); if (p < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, on, ms])
  return v
}
const rm = (n: number) => 'RM ' + n.toLocaleString('en-MY')

export const P = {
  nJourney: { en: 'Order journey', ms: 'Perjalanan pesanan', zh: '订单旅程' } satisfies Text,
  nPricing: { en: 'Pricing', ms: 'Harga', zh: '价格' } satisfies Text,
  walk: { en: 'Watch the 30-second walkthrough', ms: 'Tonton panduan 30 saat', zh: '观看 30 秒导览' } satisfies Text,
}

// ---------------------------------------------------------------- hero: a chat becomes an approved quote
const H = {
  tag: { en: 'Watch it happen', ms: 'Lihat ia berlaku', zh: '看看它怎么运作' },
  msg: { en: '“Boss, 3 pcs 4×2 ft acrylic signboard, white LED, need by Friday.”', ms: '“Boss, 3 keping papan tanda akrilik 4×2 kaki, LED putih, perlu hari Jumaat.”', zh: '“老板，3 块 4×2 尺亚克力招牌，白色 LED，周五要。”' },
  read: [{ en: '3 pcs', ms: '3 keping', zh: '3 块' }, { en: 'Acrylic 4×2 ft', ms: 'Akrilik 4×2 kaki', zh: '亚克力 4×2 尺' }, { en: 'White LED', ms: 'LED putih', zh: '白色 LED' }, { en: 'Due Friday', ms: 'Jumaat', zh: '周五交' }] satisfies Text[],
  draft: { en: 'Draft quote', ms: 'Draf sebut harga', zh: '报价草稿' }, line: { en: 'Acrylic signboard, LED × 3', ms: 'Papan tanda akrilik, LED × 3', zh: '亚克力招牌，LED × 3' },
  floor: { en: 'Your floor 25%', ms: 'Lantai anda 25%', zh: '您的底线 25%' }, margin: { en: 'Margin', ms: 'Margin', zh: '利润率' },
  approve: { en: 'Approve and send', ms: 'Lulus dan hantar', zh: '批准并发送' }, sent: { en: 'Approved by you. Sent to the customer.', ms: 'Diluluskan oleh anda. Dihantar kepada pelanggan.', zh: '已由您批准，并发给客户。' },
  steps: [{ en: 'Customer asks', ms: 'Pelanggan bertanya', zh: '客户询价' }, { en: 'LARIS reads it', ms: 'LARIS membacanya', zh: 'LARIS 读懂需求' }, { en: 'Rules price it', ms: 'Peraturan menetapkan harga', zh: '规则定价' }, { en: 'You approve', ms: 'Anda luluskan', zh: '您批准' }] satisfies Text[],
  note: { en: 'Illustration with made-up numbers, not a real quote.', ms: 'Ilustrasi dengan nombor rekaan, bukan sebut harga sebenar.', zh: '示意图，数字为虚构，并非真实报价。' },
}

export function HeroDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useInView(ref)
  const [step, setStep] = useState(reducedNow() ? 3 : 0)
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!seen || held || reducedNow()) return
    const id = setTimeout(() => setStep(s => (s + 1) % 4), step === 3 ? 4200 : step === 0 ? 2300 : 2000)
    return () => clearTimeout(id)
  }, [step, seen, held])
  const m = useCount(34, step >= 2)
  return (
    <figure ref={ref} className="m-0 grid gap-3" aria-label={t(H.tag)} onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}>
      <div className="card lp-float p-4 shadow-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t(H.tag)} · Telegram</p>
        <p className="mt-2 rounded-card bg-tint p-3 text-sm">{t(H.msg)}</p>
        <div className="mt-2 flex min-h-7 flex-wrap gap-1.5" aria-hidden="true">
          {step === 0 ? <span className="lp-typing text-muted"><span /><span /><span /></span>
            : H.read.map((c, i) => <span key={c.en} data-on={step >= 1} className="lp-chip rounded-ui border border-accent/40 bg-surface px-2 py-0.5 text-xs font-semibold text-accent" style={{ transitionDelay: `${i * 90}ms` }}>{t(c)}</span>)}
        </div>
      </div>
      <div data-on={step >= 2} className="lp-step card p-4 shadow-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">{t(H.draft)}</p>
          <span className="rounded-ui bg-tint px-2 py-0.5 text-xs font-semibold tabular-nums">RM 1,260.00</span>
        </div>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-sm"><dt>{t(H.line)}</dt><dd className="text-right tabular-nums">RM 1,260.00</dd></dl>
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted"><span>{t(H.margin)} <strong className="tabular-nums text-ink">{m}%</strong></span><span>{t(H.floor)}</span></div>
          <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-tint" role="img" aria-label={`${t(H.margin)} 34%, ${t(H.floor)}`}>
            <div className="lp-bar h-full rounded-full bg-accent" style={{ width: step >= 2 ? '34%' : '0%' }} />
            <span className="absolute inset-y-0 w-0.5 bg-ink/60" style={{ left: '25%' }} />
          </div>
        </div>
        <div className="mt-3 min-h-9">
          {step >= 3
            ? <p className="lp-pop flex items-center gap-2 text-sm font-semibold text-accent"><Icon name="check" className="size-4" />{t(H.sent)}</p>
            : <span className={`btn btn-primary pointer-events-none ${step === 2 ? 'lp-pulse' : ''}`}>{t(H.approve)}</span>}
        </div>
      </div>
      <ol className="flex flex-wrap items-center gap-1.5 text-xs" aria-label={t(H.tag)}>
        {H.steps.map((s, i) => (
          <li key={s.en}><button type="button" onClick={() => { setStep(i); setHeld(true) }} aria-current={step === i ? 'step' : undefined}
            className={`rounded-full border px-2.5 py-1 transition-colors ${step === i ? 'border-accent bg-accent text-on-accent' : 'border-hairline text-muted hover:border-accent'}`}>{i + 1}. {t(s)}</button></li>
        ))}
      </ol>
      <figcaption className="text-xs text-muted">{t(H.note)}</figcaption>
    </figure>
  )
}

// ---------------------------------------------------------------- the order journey as a process diagram
interface Stop { id: string; icon: IconName; n: Text; d: Text; does: Text; you: Text; count: string }
const J = {
  h: { en: 'Follow one order, from quote to receipt', ms: 'Ikuti satu pesanan, dari sebut harga hingga resit', zh: '跟着一张订单，从报价走到收据' },
  p: { en: 'Press play or pick any step. Each document is made from the one before it, so nothing is typed twice.', ms: 'Tekan main atau pilih mana-mana langkah. Setiap dokumen dibuat daripada yang sebelumnya, jadi tiada apa ditaip dua kali.', zh: '按播放或点任一步骤。每份文件都由上一份生成，不用重复输入。' },
  play: { en: 'Play', ms: 'Main', zh: '播放' }, pause: { en: 'Pause', ms: 'Jeda', zh: '暂停' }, replay: { en: 'Start over', ms: 'Mula semula', zh: '重新开始' },
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

export function Journey({ run }: { run: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useInView(ref)
  const [i, setI] = useState(0)
  const [play, setPlay] = useState(!reducedNow())
  useEffect(() => { if (run) { setI(0); setPlay(!reducedNow()) } }, [run])
  useEffect(() => {
    if (!play || !seen) return
    const id = setInterval(() => setI(x => (x + 1) % STOPS.length), 3400)
    return () => clearInterval(id)
  }, [play, seen])
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
              <button type="button" onClick={() => { setI(n); setPlay(false) }} aria-current={i === n ? 'step' : undefined} className="group grid justify-items-center gap-1.5 px-1 text-center">
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
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-sm" onClick={() => setPlay(p => !p)}>{play ? t(J.pause) : t(J.play)}</button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => { setI(0); setPlay(true) }}>{t(J.replay)}</button>
        <span className="text-xs text-muted">{t(J.sample)}</span>
      </div>
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
  const cost = useCount(832, seen, 1000), margin = useCount(428, seen, 1300), price = useCount(1260, seen, 1600)
  return (
    <div ref={ref} className="card mt-6 grid gap-5 p-5 md:grid-cols-[1fr_1.3fr] md:items-center">
      <div>
        <h3 className="text-lg font-semibold">{t(B.h)}</h3>
        <p className="mt-2 text-sm text-muted">{t(B.p)}</p>
        <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-accent"><Icon name="roles" className="size-4" />{t(B.ai)}</p>
      </div>
      <div>
        <div className="flex h-12 overflow-hidden rounded-card bg-tint" role="img" aria-label={`${t(B.cost)} RM 832, ${t(B.margin)} RM 428, ${t(B.price)} RM 1,260`}>
          <div className="lp-bar grid place-items-center bg-surface-2 text-xs font-semibold text-ink-2" style={{ width: seen ? '66%' : '0%' }}>{seen && t(B.cost)}</div>
          <div className="lp-bar grid place-items-center bg-accent text-xs font-semibold text-on-accent" style={{ width: seen ? '34%' : '0%', transitionDelay: '.5s' }}>{seen && '34%'}</div>
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

// ---------------------------------------------------------------- pricing
// Monthly price in ringgit. Seats are the licence seats in src/license.py (starter 3, standard 10, pro 25); the Lite plan is that starter plan.
const PL = {
  h: { en: 'Simple pricing, in ringgit', ms: 'Harga mudah, dalam ringgit', zh: '简单明了的价格，以令吉计' },
  p: { en: 'Every plan has the whole system: quotes, orders, documents, Revenue and your own Word templates. Pick the size of your team.', ms: 'Setiap pelan ada keseluruhan sistem: sebut harga, pesanan, dokumen, Hasil dan templat Word anda sendiri. Pilih saiz pasukan anda.', zh: '每个套餐都包含完整系统：报价、订单、文件、收入报表和您自己的 Word 模板。按团队大小选择即可。' },
  mo: { en: '/ month', ms: '/ bulan', zh: '/ 月' }, seats: { en: 'Up to {0} people', ms: 'Sehingga {0} orang', zh: '最多 {0} 人' }, cta: { en: 'Start with {0}', ms: 'Mulakan dengan {0}', zh: '从 {0} 开始' },
  all: [{ en: 'Quote from chat, priced by your rules', ms: 'Sebut harga dari sembang, harga ikut peraturan anda', zh: '聊天报价，由您的规则定价' }, { en: 'Order to receipt, six documents', ms: 'Pesanan hingga resit, enam dokumen', zh: '从订单到收据，六种文件' }, { en: 'Your own Word templates', ms: 'Templat Word anda sendiri', zh: '您自己的 Word 模板' }, { en: 'Revenue and profit page', ms: 'Halaman hasil dan untung', zh: '收入与利润页面' }] satisfies Text[],
  note: { en: 'Prices are in Malaysian ringgit per month. LARIS records your payments; it never takes or moves your customers’ money.', ms: 'Harga dalam ringgit Malaysia sebulan. LARIS merekod bayaran anda; ia tidak mengambil atau memindahkan wang pelanggan anda.', zh: '价格以马来西亚令吉按月计。LARIS 只记录您的收款，不经手客户的资金。' },
}
const PLANS = [
  { name: 'Lite', price: 59, seats: 3, ai: { en: 'AI credits to get started', ms: 'Kredit AI untuk bermula', zh: '入门 AI 额度' } satisfies Text },
  { name: 'Standard', price: 189, seats: 10, ai: { en: 'More AI credits for a busy team', ms: 'Lebih banyak kredit AI untuk pasukan sibuk', zh: '更多 AI 额度，应对忙碌团队' } satisfies Text },
  { name: 'Pro', price: 499, seats: 25, ai: { en: 'The most AI credits', ms: 'Kredit AI paling banyak', zh: '最多 AI 额度' } satisfies Text },
]
export function Pricing({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="mt-6">
      <p className="max-w-2xl text-muted">{t(PL.p)}</p>
      <div className="mt-8 grid gap-4 md:grid-cols-3 md:items-stretch">
        {PLANS.map((p, n) => (
          <article key={p.name} className={`lp-plan card grid content-start gap-4 p-6 ${n === 1 ? 'mid border-accent shadow-2' : ''}`} aria-label={p.name}>
            <h3 className="text-lg font-semibold">{p.name}</h3>
            <p className="flex items-baseline gap-1"><span className="text-4xl font-bold tabular-nums">RM{p.price}</span><span className="text-sm text-muted">{t(PL.mo)}</span></p>
            <ul className="grid gap-2 text-sm">
              <li className="flex items-start gap-2 font-semibold"><Icon name="team" className="mt-0.5 size-4 shrink-0 text-accent" />{t(PL.seats).replace('{0}', String(p.seats))}</li>
              <li className="flex items-start gap-2"><Icon name="assistant" className="mt-0.5 size-4 shrink-0 text-accent" />{t(p.ai)}</li>
              {PL.all.map(x => <li key={x.en} className="flex items-start gap-2 text-muted"><Icon name="check" className="mt-0.5 size-4 shrink-0 text-accent" />{t(x)}</li>)}
            </ul>
            <a className={`btn min-h-11 justify-center ${n === 1 ? 'btn-primary' : ''}`} href={signedIn ? '#/licence' : '#/register'}>{t(PL.cta).replace('{0}', p.name)}</a>
          </article>
        ))}
      </div>
      <p className="mt-5 text-xs text-muted">{t(PL.note)}</p>
    </div>
  )
}
export const PRICING_TITLE = PL.h

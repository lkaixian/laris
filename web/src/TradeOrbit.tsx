import { useEffect, useRef, useState } from 'react'
import { useFetch, rm } from './ui'
import { t, useLang } from './i18n'
import type { Text } from './i18n'

// The Trade Orbit: Customer <-> Business <-> Supplier. Small paper "parcels" (documents) travel the four lanes.
// Only transform/offset-distance and opacity animate. Reduced motion, or a tab that is hidden / off screen, shows a still picture or pauses.
// The numbers in the panels come from the API (/chain); the picture never invents money. Sample data in mock mode only.
type Node = 'customer' | 'business' | 'supplier'
type Lane = 'lu' | 'ld' | 'ru' | 'rd'
const PATH: Record<Lane, string> = {
  lu: 'M150,118 C210,36 290,36 330,112', ld: 'M330,148 C290,224 210,224 150,142',
  ru: 'M430,112 C470,36 550,36 610,118', rd: 'M610,142 C550,224 470,224 430,148',
}
const LANE_DEST: Record<Lane, Node> = { lu: 'business', ld: 'customer', ru: 'supplier', rd: 'business' }
const LANE_CHAIN: Record<Lane, 'sell' | 'buy'> = { lu: 'sell', ld: 'sell', ru: 'buy', rd: 'buy' }
interface Parcel { code: string; lane: Lane; at: number; name: Text }

const S = {
  customer: { en: 'Customer', ms: 'Pelanggan', zh: '客户', ta: 'வாடிக்கையாளர்' },
  business: { en: 'Your business', ms: 'Perniagaan anda', zh: '您的企业', ta: 'உங்கள் வணிகம்' },
  supplier: { en: 'Supplier', ms: 'Pembekal', zh: '供应商', ta: 'விநியோகஸ்தர்' },
  buys: { en: 'buys from you', ms: 'beli daripada anda', zh: '向您购买', ta: 'உங்களிடம் வாங்குபவர்' },
  you: { en: 'your workspace', ms: 'ruang kerja anda', zh: '您的工作区', ta: 'உங்கள் பணியிடம்' },
  sells: { en: 'you buy from', ms: 'anda beli daripada', zh: '您向其采购', ta: 'நீங்கள் வாங்குபவர்' },
  label: { en: 'Trade Orbit: documents moving between your customer, your business and your supplier', ms: 'Orbit Dagangan: dokumen bergerak antara pelanggan, perniagaan dan pembekal anda', zh: '贸易轨道：文件在客户、企业与供应商之间流转', ta: 'வர்த்தக சுற்றுப்பாதை: வாடிக்கையாளர், வணிகம், விநியோகஸ்தர் இடையே ஆவணங்கள் நகர்கின்றன' },
  pause: { en: 'Pause story', ms: 'Jeda cerita', zh: '暂停演示', ta: 'கதையை இடைநிறுத்து' },
  play: { en: 'Play story', ms: 'Main cerita', zh: '播放演示', ta: 'கதையை இயக்கு' },
  owedIn: { en: 'Owed to you', ms: 'Terhutang kepada anda', zh: '客户欠您', ta: 'உங்களுக்குச் செலுத்த வேண்டியது' },
  owedOut: { en: 'You owe suppliers', ms: 'Anda terhutang kepada pembekal', zh: '您欠供应商', ta: 'நீங்கள் செலுத்த வேண்டியது' },
  openSell: { en: 'Open sales documents', ms: 'Dokumen jualan terbuka', zh: '未结销售文件', ta: 'திறந்த விற்பனை ஆவணங்கள்' },
  openBuy: { en: 'Open supplier orders', ms: 'Pesanan pembekal terbuka', zh: '未结采购订单', ta: 'திறந்த விநியோகஸ்தர் ஆணைகள்' },
  next: { en: 'Next action', ms: 'Tindakan seterusnya', zh: '下一步', ta: 'அடுத்த செயல்' },
  nextC: { en: 'Chase late invoices', ms: 'Tuntut invois lewat', zh: '跟进逾期发票', ta: 'தாமதமான விலைப்பட்டியல்களைத் தொடர்' },
  nextB: { en: 'Open Deals and move the next document', ms: 'Buka Urusan dan gerakkan dokumen seterusnya', zh: '打开交易并推进下一份文件', ta: 'ஒப்பந்தங்களைத் திறந்து அடுத்த ஆவணத்தை நகர்த்து' },
  nextS: { en: 'Compare supplier quotes', ms: 'Bandingkan sebut harga pembekal', zh: '比较供应商报价', ta: 'விநியோகஸ்தர் விலைப்புள்ளிகளை ஒப்பிடு' },
  openIt: { en: 'Open Deals', ms: 'Buka Urusan', zh: '打开交易', ta: 'ஒப்பந்தங்களைத் திற' },
  sell: { en: 'Sell side', ms: 'Sebelah jualan', zh: '销售链', ta: 'விற்பனைப் பக்கம்' },
  buy: { en: 'Buy side', ms: 'Sebelah belian', zh: '采购链', ta: 'கொள்முதல் பக்கம்' },
  towards: { en: 'moving towards', ms: 'bergerak ke', zh: '流向', ta: 'நோக்கி' },
}
const P = (code: string, lane: Lane, at: number, en: string, ms: string, zh: string, ta: string): Parcel => ({ code, lane, at, name: { en, ms, zh, ta } })
const PARCELS: Parcel[] = [
  P('ASK', 'lu', 22, 'Enquiry', 'Pertanyaan', '询价', 'விசாரணை'), P('SO', 'lu', 68, 'Customer order', 'Pesanan pelanggan', '客户订单', 'வாடிக்கையாளர் ஆணை'),
  P('QT', 'ld', 30, 'Quotation', 'Sebut Harga', '报价单', 'விலைப்புள்ளி'), P('INV', 'ld', 72, 'Invoice', 'Invois', '发票', 'விலைப்பட்டியல்'),
  P('RFQ', 'ru', 28, 'Request for quotation', 'Permintaan Sebut Harga', '询价单', 'விலைப்புள்ளி கோரிக்கை'), P('PO', 'ru', 70, 'Purchase order', 'Pesanan Belian', '采购订单', 'கொள்முதல் ஆணை'),
  P('GRN', 'rd', 34, 'Goods received', 'Barang Diterima', '收货单', 'பெறப்பட்ட பொருட்கள்'), P('BILL', 'rd', 76, 'Supplier invoice', 'Invois pembekal', '供应商发票', 'விநியோகஸ்தர் விலைப்பட்டியல்'),
]
// The landing-page story: 6 steps, 2 s each (12 s loop).
const STORY: { lane: Lane; code: string; to: Node; cap: Text }[] = [
  { lane: 'lu', code: 'ASK', to: 'business', cap: { en: 'A customer asks for a price', ms: 'Pelanggan minta harga', zh: '客户询价', ta: 'வாடிக்கையாளர் விலை கேட்கிறார்' } },
  { lane: 'ld', code: 'QT', to: 'customer', cap: { en: 'You send a quotation', ms: 'Anda hantar sebut harga', zh: '您发出报价单', ta: 'நீங்கள் விலைப்புள்ளி அனுப்புகிறீர்கள்' } },
  { lane: 'lu', code: 'SO', to: 'business', cap: { en: 'The customer accepts and orders', ms: 'Pelanggan terima dan buat pesanan', zh: '客户接受并下单', ta: 'வாடிக்கையாளர் ஏற்று ஆர்டர் செய்கிறார்' } },
  { lane: 'ru', code: 'PO', to: 'supplier', cap: { en: 'You order from your supplier', ms: 'Anda buat pesanan kepada pembekal', zh: '您向供应商下采购订单', ta: 'நீங்கள் விநியோகஸ்தரிடம் ஆர்டர் செய்கிறீர்கள்' } },
  { lane: 'rd', code: 'GRN', to: 'business', cap: { en: 'The goods arrive', ms: 'Barang tiba', zh: '货物到达', ta: 'பொருட்கள் வந்து சேர்கின்றன' } },
  { lane: 'ld', code: 'INV', to: 'customer', cap: { en: 'Delivered, invoiced and paid', ms: 'Dihantar, diinvois dan dibayar', zh: '送达、开票、收款', ta: 'வழங்கி, விலைப்பட்டியலிட்டு, பணம் பெறப்பட்டது' } },
]

export function useReducedMotion() {
  const [r, setR] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const m = matchMedia('(prefers-reduced-motion: reduce)'), f = () => setR(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return r
}

export interface OrbitData { owedIn: number; owedOut: number; openSell: number; openBuy: number; late: number }

function Glyph({ node }: { node: Node }) {
  // Simple line icons, drawn here so they take the theme colour: person, shop, truck.
  if (node === 'customer') return <g className="orb-glyph" aria-hidden="true"><circle cx="0" cy="-9" r="6" /><path d="M-12 14c0-8 6-12 12-12s12 4 12 12" /></g>
  if (node === 'business') return <g className="orb-glyph" aria-hidden="true"><path d="M-18 -4l4-12h28l4 12M-16 -4v20h32V-4M-5 16V6h10v10" /></g>
  return <g className="orb-glyph" aria-hidden="true"><path d="M-17 -8h22v18h-22zM5 -2h9l5 6v6H5M-10 12a3 3 0 106 0M8 12a3 3 0 106 0" /></g>
}

export function TradeOrbit({ data, story, onGo }: { data?: OrbitData; story?: boolean; onGo?: (href: string) => void }) {
  useLang()
  const reduced = useReducedMotion()
  const [open, setOpen] = useState<Node>('business')
  const [chain, setChain] = useState<'sell' | 'buy' | null>(null)
  const [step, setStep] = useState(0)
  const [paused, setPaused] = useState(false)
  const [run, setRun] = useState(true)
  const [hit, setHit] = useState<Node | null>(null)
  const box = useRef<HTMLDivElement>(null)
  // Pause when scrolled off screen or the tab is hidden.
  useEffect(() => {
    const el = box.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setRun(e.isIntersecting && !document.hidden), { threshold: 0.1 })
    const vis = () => setRun(r => r && !document.hidden)
    io.observe(el); document.addEventListener('visibilitychange', vis)
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', vis) }
  }, [])
  const playing = !!story && !paused && !reduced && run
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setStep(s => (s + 1) % STORY.length), 2000)
    return () => clearInterval(id)
  }, [playing])
  useEffect(() => {
    if (!story || reduced) return
    const n = STORY[step].to
    setHit(n); const id = setTimeout(() => setHit(null), 1700)
    return () => clearTimeout(id)
  }, [story, step, reduced])
  const cur = story ? STORY[step] : undefined
  const go = (href: string) => (onGo ? onGo(href) : (location.hash = href))
  const d = data ?? { owedIn: 0, owedOut: 0, openSell: 0, openBuy: 0, late: 0 }
  const nodes: { id: Node; x: number; r: number; name: Text; sub: Text }[] = [
    { id: 'customer', x: 100, r: 40, name: S.customer, sub: S.buys }, { id: 'business', x: 380, r: 52, name: S.business, sub: S.you }, { id: 'supplier', x: 660, r: 40, name: S.supplier, sub: S.sells },
  ]
  const panel = {
    customer: { a: [t(S.owedIn), rm(String(d.owedIn))], b: [t(S.openSell), String(d.openSell)], n: d.late ? `${t(S.nextC)} (${d.late})` : t(S.nextC), href: '#/deals' },
    business: { a: [t(S.openSell), String(d.openSell)], b: [t(S.openBuy), String(d.openBuy)], n: t(S.nextB), href: '#/deals' },
    supplier: { a: [t(S.owedOut), rm(String(d.owedOut))], b: [t(S.openBuy), String(d.openBuy)], n: t(S.nextS), href: '#/deals' },
  }[open]
  return (
    <div ref={box} className="orbit-wrap" data-run={run && !paused ? '1' : '0'} data-guide="orbit">
      <svg viewBox="0 0 760 260" role="img" aria-label={t(S.label)} className="h-auto w-full" style={{ maxHeight: 280 }}>
        <title>{t(S.label)}</title>
        {(Object.keys(PATH) as Lane[]).map(l => (
          <g key={l}>
            <path className="orb-lane" d={PATH[l]} data-on={cur?.lane === l || chain === LANE_CHAIN[l] ? '1' : undefined} />
            <path className="orb-hit" d={PATH[l]} onClick={() => { const c = LANE_CHAIN[l]; setChain(x => (x === c ? null : c)); go('#/deals') }}>
              <title>{t(LANE_CHAIN[l] === 'sell' ? S.sell : S.buy)}</title></path>
          </g>
        ))}
        {nodes.map(n => (
          <g key={n.id} className="orb-node" transform={`translate(${n.x} 130)`} tabIndex={0} role="button" aria-pressed={open === n.id} aria-label={`${t(n.name)}: ${t(n.sub)}`}
            onClick={() => setOpen(n.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(n.id) } }}>
            <circle className="orb-halo" r={n.r + 14} />
            <circle className="orb-ring" r={n.r} data-hit={hit === n.id ? '1' : undefined} key={hit === n.id ? `h${step}` : 'x'} />
            <circle className="orb-disc" r={n.r} />
            <g transform="translate(0 -6)"><Glyph node={n.id} /></g>
            <text className="orb-text" y={n.r + 22}>{t(n.name)}</text>
            <text className="orb-sub" y={n.r + 38}>{t(n.sub)}</text>
          </g>
        ))}
        {story
          ? cur && !reduced && <g key={step} className="orb-parcel orb-once" style={{ offsetPath: `path('${PATH[cur.lane]}')`, animationIterationCount: 1 }} aria-hidden="true">
            <rect x="-20" y="-11" width="40" height="22" rx="7" /><text textAnchor="middle" y="4">{cur.code}</text></g>
          : PARCELS.map((p, i) => {
            const dim = chain && LANE_CHAIN[p.lane] !== chain
            return <g key={p.code} className="orb-parcel" opacity={dim ? 0.25 : undefined} aria-hidden="true"
              style={{ offsetPath: `path('${PATH[p.lane]}')`, offsetDistance: `${p.at}%`, ['--orb-d' as string]: `${6 + (i % 4)}s`, ['--orb-delay' as string]: `${-(i * 1.3)}s` }}>
              <title>{`${t(p.name)} ${t(S.towards)} ${t(S[LANE_DEST[p.lane]])}`}</title>
              <rect x="-20" y="-11" width="40" height="22" rx="7" /><text textAnchor="middle" y="4">{p.code}</text></g>
          })}
      </svg>
      {story ? (
        <div className="grid gap-2">
          <ol className="grid gap-1 sm:grid-cols-3" aria-label={t({ en: 'The story in six steps', ms: 'Cerita dalam enam langkah', zh: '六步流程', ta: 'ஆறு படிகளில் கதை' })}>
            {STORY.map((s, i) => <li key={i} className="orb-step rounded-ui border border-hairline px-3 py-2 text-sm" aria-current={i === step ? 'step' : undefined}>{i + 1}. {t(s.cap)}</li>)}
          </ol>
          {!reduced && <button type="button" className="btn w-fit" aria-pressed={paused} onClick={() => setPaused(p => !p)}>{t(paused ? S.play : S.pause)}</button>}
        </div>
      ) : (
        <section className="card grid gap-2 sm:grid-cols-[1fr_auto]" aria-live="polite">
          <div className="grid gap-1">
            <h3 className="text-md font-semibold">{t(nodes.find(n => n.id === open)!.name)}</h3>
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div><dt className="text-muted">{panel.a[0]}</dt><dd className="text-lg font-semibold tabular-nums">{panel.a[1]}</dd></div>
              <div><dt className="text-muted">{panel.b[0]}</dt><dd className="text-lg font-semibold tabular-nums">{panel.b[1]}</dd></div>
            </dl>
            <p className="text-sm text-muted">{t(S.next)}: {panel.n}</p>
          </div>
          <a className="btn btn-primary self-end" href={panel.href} onClick={e => { e.preventDefault(); go(panel.href) }}>{t(S.openIt)}</a>
        </section>
      )}
    </div>
  )
}

interface ListRow { kind: string; status: string; total: string; days_overdue?: number; status_effective?: string }
interface Recv { total: string }
// Live version for Home: owed in (receivables), owed out and open counts (chain documents). Zeros when there is no data yet.
export function LiveOrbit({ onGo }: { onGo?: (href: string) => void }) {
  const recv = useFetch<Recv>('/chain/receivables')
  const all = useFetch<ListRow[]>('/chain')
  const rows = all.data ?? []
  const open = (k: string[]) => rows.filter(r => k.includes(r.kind) && !['paid', 'cancelled', 'void', 'fulfilled', 'received', 'delivered'].includes(r.status)).length
  const owedOut = rows.filter(r => r.kind === 'spo' && ['sent', 'partially_received'].includes(r.status)).reduce((a, r) => a + Number(r.total), 0)
  const data: OrbitData = { owedIn: Number(recv.data?.total ?? 0), owedOut, openSell: open(['cpo', 'so', 'pf', 'do', 'inv']), openBuy: open(['spo']), late: rows.filter(r => r.status_effective === 'overdue').length }
  return <TradeOrbit data={data} onGo={onGo} />
}

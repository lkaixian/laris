// AI business report. LARIS works out every number from your records with fixed rules; the AI (when on) only writes the words around them.
// Preview: the numbers here are sample data until the report service is switched on.
import { useEffect, useRef, useState } from 'react'
import { useFetch, Async } from './ui'
import { PageHeader } from './ui'
import { t, useLang, getLang } from './i18n'
import { Metric } from './dash'
import { bot } from './botBus'

type Nums = { sales: number; sales_prev: number; margin_pct: number; margin_prev: number; quotes_sent: number; quotes_accepted: number; quotes_accepted_prev: number
  waiting: number; late_count: number; late_amount: number; supplier_spend: number; supplier_spend_prev: number }
type An = { labels: string[]; sales: number[]; margin: number[]; funnel: { k: string; n: number }[]; customers: { name: string; amount: number; pct: number }[]
  products: { name: string; margin: number; amount: number }[]; aging: { k: string; count: number; amount: number }[]; suppliers: { name: string; amount: number; change: number }[] }
type Report = { analytics: An; period: string; label: string; source: 'model' | 'rules'; as_of: string; numbers: Nums; series: number[]; summary: string
  changed: string[]; watch: string[]; next: { text: string; href: string }[]; note: string }

const S = {
  title: { en: 'Business report', ms: 'Laporan perniagaan', zh: '业务报告', ta: 'வணிக அறிக்கை' },
  lead: { en: 'A plain-words summary of how the business is doing. LARIS works out the numbers; the AI only writes the words.', ms: 'Ringkasan mudah tentang prestasi perniagaan. LARIS mengira nombor; AI hanya menulis ayat.', zh: '用通俗的话总结业务情况。数字由 LARIS 计算，AI 只负责文字。', ta: 'வணிகம் எப்படி உள்ளது என்பதன் எளிய சுருக்கம். எண்களை LARIS கணக்கிடும்; AI வார்த்தைகளை மட்டும் எழுதும்.' },
  preview: { en: 'Preview: sample numbers', ms: 'Pratonton: nombor contoh', zh: '预览：示例数据', ta: 'முன்னோட்டம்: மாதிரி எண்கள்' },
  week: { en: 'This week', ms: 'Minggu ini', zh: '本周', ta: 'இந்த வாரம்' }, last_week: { en: 'Last week', ms: 'Minggu lepas', zh: '上周', ta: 'கடந்த வாரம்' }, month: { en: 'This month', ms: 'Bulan ini', zh: '本月', ta: 'இந்த மாதம்' },
  period: { en: 'Period', ms: 'Tempoh', zh: '时间段', ta: 'காலம்' },
  write: { en: 'Write my report', ms: 'Tulis laporan saya', zh: '生成我的报告', ta: 'என் அறிக்கையை எழுது' }, writing: { en: 'Writing…', ms: 'Menulis…', zh: '生成中…', ta: 'எழுதுகிறது…' },
  print: { en: 'Print or save as PDF', ms: 'Cetak atau simpan PDF', zh: '打印或存为 PDF', ta: 'அச்சிடு / PDF' },
  sales: { en: 'Sales', ms: 'Jualan', zh: '销售额', ta: 'விற்பனை' }, margin: { en: 'Margin', ms: 'Margin', zh: '利润率', ta: 'இலாப விகிதம்' },
  quotes: { en: 'Quotes accepted', ms: 'Sebut harga diterima', zh: '已接受报价', ta: 'ஏற்ற விலைப்புள்ளிகள்' }, waiting: { en: 'Waiting to be paid', ms: 'Menunggu bayaran', zh: '待收款', ta: 'பெற வேண்டியது' },
  spend: { en: 'Supplier spend', ms: 'Belanja pembekal', zh: '供应商支出', ta: 'விநியோகஸ்தர் செலவு' },
  of: { en: 'of', ms: 'daripada', zh: '/', ta: 'இல்' }, overdue: { en: 'overdue', ms: 'lewat', zh: '逾期', ta: 'காலம் கடந்தது' },
  changed: { en: 'What changed', ms: 'Apa yang berubah', zh: '有什么变化', ta: 'என்ன மாறியது' }, watch: { en: 'Keep an eye on', ms: 'Perlu diberi perhatian', zh: '需要留意', ta: 'கவனிக்க வேண்டியவை' }, next: { en: 'Do next', ms: 'Buat seterusnya', zh: '接下来做', ta: 'அடுத்து செய்ய' },
  ai: { en: 'Words written by AI', ms: 'Ayat ditulis oleh AI', zh: '文字由 AI 撰写', ta: 'வார்த்தைகளை AI எழுதியது' }, rules: { en: 'Words written by fixed rules (AI is off)', ms: 'Ayat ditulis oleh peraturan tetap (AI mati)', zh: '文字由固定规则生成（AI 已关闭）', ta: 'நிலையான விதிகளால் எழுதப்பட்டது (AI நிறுத்தம்)' },
  asof: { en: 'As of', ms: 'Setakat', zh: '截至', ta: 'நிலவரம்' }, vs: { en: 'vs before', ms: 'berbanding sebelum ini', zh: '较上期', ta: 'முந்தையதுடன்' },
  aiOff: { en: 'Turn the AI off for this report', ms: 'Matikan AI untuk laporan ini', zh: '本报告关闭 AI', ta: 'இந்த அறிக்கைக்கு AI நிறுத்து' },
}
const S2 = {
  dash: { en: 'Analytics', ms: 'Analitik', zh: '数据分析', ta: 'பகுப்பாய்வு' },
  trend: { en: 'Sales and margin over time', ms: 'Jualan dan margin mengikut masa', zh: '销售与利润率走势', ta: 'காலப்போக்கில் விற்பனை, இலாபம்' },
  funnel: { en: 'From quote to cash', ms: 'Dari sebut harga ke tunai', zh: '从报价到收款', ta: 'விலைப்புள்ளியிலிருந்து பணம் வரை' },
  fsent: { en: 'Quotes sent', ms: 'Sebut harga dihantar', zh: '已发报价', ta: 'அனுப்பியவை' }, fviewed: { en: 'Opened by customer', ms: 'Dibuka pelanggan', zh: '客户已查看', ta: 'வாடிக்கையாளர் பார்த்தது' },
  faccepted: { en: 'Accepted', ms: 'Diterima', zh: '已接受', ta: 'ஏற்கப்பட்டது' }, fpaid: { en: 'Paid', ms: 'Dibayar', zh: '已付款', ta: 'செலுத்தப்பட்டது' },
  cust: { en: 'Top customers', ms: 'Pelanggan utama', zh: '主要客户', ta: 'முக்கிய வாடிக்கையாளர்கள்' }, prod: { en: 'Products by margin', ms: 'Produk mengikut margin', zh: '产品利润率', ta: 'இலாப விகிதப்படி பொருட்கள்' },
  aging: { en: 'Who owes you, by age', ms: 'Siapa berhutang, ikut tempoh', zh: '欠款账龄', ta: 'நிலுவை, வயதுப்படி' }, sup: { en: 'Supplier spend and price change', ms: 'Belanja pembekal dan perubahan harga', zh: '供应商支出与价格变动', ta: 'விநியோகஸ்தர் செலவு, விலை மாற்றம்' },
  current: { en: 'Not due', ms: 'Belum due', zh: '未到期', ta: 'காலம் வரவில்லை' }, tbl: { en: 'View as table', ms: 'Lihat sebagai jadual', zh: '以表格查看', ta: 'அட்டவணையாக' },
  note2: { en: 'Sample figures. Charts use the same rule-computed numbers as the report above.', ms: 'Angka contoh. Carta guna nombor yang sama seperti laporan di atas.', zh: '示例数据。图表与上方报告使用同一组由规则计算的数字。', ta: 'மாதிரி எண்கள். மேலே உள்ள அறிக்கையின் அதே எண்களை வரைபடங்கள் பயன்படுத்துகின்றன.' },
}
const tk = (k: string) => t(({ ...S, ...S2 } as Record<string, { en: string; ms: string; zh: string; ta: string }>)[k])
const rm = (n: number) => 'RM ' + Math.round(n).toLocaleString('en-MY')
const pc = (a: number, b: number) => (b === 0 ? 0 : Math.round((a - b) / b * 1000) / 10)

function Delta({ v, unit = '%', goodUp = true }: { v: number; unit?: string; goodUp?: boolean }) {
  useLang()
  const good = v === 0 ? true : (v > 0) === goodUp
  return <span className={`pill ${good ? '' : 'pill-warn'}`} aria-label={`${v > 0 ? '+' : ''}${v}${unit} ${t(S.vs)}`}>{v > 0 ? '▲' : v < 0 ? '▼' : '•'} {v > 0 ? '+' : ''}{v}{unit}</span>
}
function Spark({ data }: { data: number[] }) {
  const max = Math.max(...data), w = 100 / data.length
  return <svg viewBox="0 0 100 32" className="rep-spark" role="img" aria-label={data.join(', ')} preserveAspectRatio="none">
    {data.map((v, i) => <rect key={i} x={i * w + w * 0.15} width={w * 0.7} y={32 - (v / max) * 30} height={(v / max) * 30} rx="1.5" />)}
  </svg>
}
function Trend({ a }: { a: An }) {
  const W = matchMedia("(max-width: 639px)").matches ? 330 : 640, H = W < 400 ? 150 : 170, P = W < 400 ? 20 : 26, mx = Math.max(...a.sales), n = a.sales.length
  const x = (i: number) => P + (i * (W - 2 * P)) / (n - 1), ys = (v: number) => H - P - (v / mx) * (H - 2 * P)
  const lo = Math.min(...a.margin) - 1, hi = Math.max(...a.margin) + 1, ym = (v: number) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P)
  const path = (f: (i: number) => number) => a.sales.map((_, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${f(i).toFixed(1)}`).join(' ')
  return <div>
    <svg viewBox={`0 0 ${W} ${H + 16}`} className="rep-trend" role="img" aria-label={`${tk('trend')}: ${a.sales.join(', ')}`}>
      <path d={`${path(i => ys(a.sales[i]))} L${x(n - 1)} ${H - P} L${x(0)} ${H - P} Z`} className="rep-area" />
      <path d={path(i => ys(a.sales[i]))} className="rep-line" pathLength={1} />
      <path d={path(i => ym(a.margin[i]))} className="rep-line2" />
      {a.sales.map((v, i) => <circle key={i} cx={x(i)} cy={ys(v)} r="4" className="rep-dot" style={{ animationDelay: `${300 + i * 90}ms` }}><title>{a.labels[i]}: {rm(v)} · {a.margin[i]}%</title></circle>)}
      {a.labels.map((l, i) => <text key={l} x={x(i)} y={H + 14} textAnchor="middle" className="rep-ax">{l}</text>)}
    </svg>
    <p className="rep-legend"><i className="rep-key k1" />{t(S.sales)} <i className="rep-key k2" />{t(S.margin)}</p>
  </div>
}
function Bars({ rows }: { rows: { label: string; value: number; text: string; warn?: boolean }[] }) {
  const mx = Math.max(...rows.map(r => r.value), 1)
  return <ul className="rep-bars">{rows.map(r => <li key={r.label}><span className="rep-bl">{r.label}</span><span className="rep-bt" aria-hidden><i className={r.warn ? 'w' : ''} style={{ width: `${Math.max(3, (r.value / mx) * 100)}%` }} /></span><b>{r.text}</b></li>)}</ul>
}
function Typed({ text, go }: { text: string; go: boolean }) {
  const [n, setN] = useState(go ? 0 : text.length)
  useEffect(() => {
    if (!go) { setN(text.length); return }
    setN(0); let i = 0
    const id = setInterval(() => { i += 2; setN(i); if (i >= text.length) clearInterval(id) }, 16)
    return () => clearInterval(id)
  }, [text, go])
  return <>{text.slice(0, n)}{n < text.length && <span className="ask-typed" aria-hidden />}</>
}

export function ReportsView() {
  useLang()
  const [period, setPeriod] = useState('week'), [ai, setAi] = useState(true), [run, setRun] = useState(0), [busy, setBusy] = useState(false)
  const s = useFetch<Report>(`/reports?period=${period}&lang=${getLang()}${ai ? '' : '&ai=0'}&r=${run}`)
  const first = useRef(true)
  useEffect(() => {
    if (s.data && !s.loading) { setBusy(false); bot({ kind: 'state', s: 'talk' }); const id = setTimeout(() => bot({ kind: 'state', s: 'idle' }), 2600); return () => clearTimeout(id) }
    if (s.loading && !first.current) bot({ kind: 'state', s: 'think' })
    first.current = false
  }, [s.data, s.loading])
  const d = s.data, n = d?.numbers
  return (
    <div className="rep">
      <PageHeader title={t(S.title)} description={t(S.lead)} meta={<span className="pill">{t(S.preview)}</span>}
        actions={<button type="button" className="btn rep-noprint" onClick={() => window.print()}>{t(S.print)}</button>} />
      <div className="rep-bar rep-noprint">
        <div role="group" aria-label={t(S.period)} className="seg">
          {(['week', 'last_week', 'month'] as const).map(k => <button key={k} type="button" aria-pressed={period === k} className={`seg-btn ${period === k ? 'on' : ''}`} onClick={() => setPeriod(k)}>{t(S[k])}</button>)}
        </div>
        <label className="rep-ai"><input type="checkbox" checked={!ai} onChange={e => setAi(!e.target.checked)} /> {t(S.aiOff)}</label>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { setBusy(true); setRun(r => r + 1) }}>{busy ? t(S.writing) : t(S.write)}</button>
      </div>
      <Async s={s} rows={4}>
        {d && n && <>
          <p className="rep-asof">{d.label} · {t(S.asof)} {d.as_of}</p>
          <div className="rep-kpis">
            <div className="card rep-kpi"><Metric label={t(S.sales)} value={n.sales} format={rm} size="lg" /><Delta v={pc(n.sales, n.sales_prev)} /><Spark data={d.series} /></div>
            <div className="card rep-kpi"><Metric label={t(S.margin)} value={`${n.margin_pct}%`} size="lg" /><Delta v={Math.round((n.margin_pct - n.margin_prev) * 10) / 10} unit=" pts" /></div>
            <div className="card rep-kpi"><Metric label={t(S.quotes)} value={`${n.quotes_accepted} ${t(S.of)} ${n.quotes_sent}`} size="lg" /><Delta v={n.quotes_accepted - n.quotes_accepted_prev} unit="" /></div>
            <div className="card rep-kpi"><Metric label={t(S.waiting)} value={n.waiting} format={rm} size="lg" /><span className={`pill ${n.late_count ? 'pill-warn' : ''}`}>{n.late_count} {t(S.overdue)} · {rm(n.late_amount)}</span></div>
            <div className="card rep-kpi"><Metric label={t(S.spend)} value={n.supplier_spend} format={rm} size="lg" /><Delta v={pc(n.supplier_spend, n.supplier_spend_prev)} goodUp={false} /></div>
          </div>
          <section className="card rep-story" aria-live="polite">
            <p className="rep-sum"><Typed text={d.summary} go={busy || run > 0} /></p>
            <div className="rep-cols">
              <div><h3 className="rep-h">{t(S.changed)}</h3><ul>{d.changed.map(x => <li key={x}>{x}</li>)}</ul></div>
              <div><h3 className="rep-h">{t(S.watch)}</h3><ul>{d.watch.map(x => <li key={x}>{x}</li>)}</ul></div>
              <div><h3 className="rep-h">{t(S.next)}</h3><ul className="rep-next">{d.next.map(x => <li key={x.text}><a href={x.href}>{x.text} →</a></li>)}</ul></div>
            </div>
            <p className="rep-note"><span className="pill">{d.source === 'model' ? t(S.ai) : t(S.rules)}</span> {d.note}</p>
          </section>
          <section className="rep-dash" aria-label={tk('dash')}>
            <h2 className="rep-h2">{tk('dash')}</h2>
            <div className="rep-grid">
              <div className="card rep-card rep-wide"><h3 className="rep-h">{tk('trend')}</h3><Trend a={d.analytics} /></div>
              <div className="card rep-card"><h3 className="rep-h">{tk('funnel')}</h3>
                <Bars rows={d.analytics.funnel.map(f => ({ label: tk('f' + f.k), value: f.n, text: String(f.n) }))} /></div>
              <div className="card rep-card"><h3 className="rep-h">{tk('aging')}</h3>
                <Bars rows={d.analytics.aging.map(g => ({ label: g.k === 'current' ? tk('current') : g.k.replace(/_/g, ' '), value: g.amount, text: rm(g.amount), warn: g.k !== 'current' }))} /></div>
              <div className="card rep-card"><h3 className="rep-h">{tk('cust')}</h3>
                <Bars rows={d.analytics.customers.map(c => ({ label: c.name, value: c.amount, text: `${rm(c.amount)} · ${c.pct}%` }))} /></div>
              <div className="card rep-card"><h3 className="rep-h">{tk('prod')}</h3>
                <Bars rows={d.analytics.products.map(p => ({ label: p.name, value: p.margin, text: `${p.margin}%`, warn: p.margin < 20 }))} /></div>
              <div className="card rep-card rep-wide"><h3 className="rep-h">{tk('sup')}</h3>
                <Bars rows={d.analytics.suppliers.map(p => ({ label: p.name, value: p.amount, text: `${rm(p.amount)} · ${p.change > 0 ? '▲ +' : '▼ '}${p.change}%`, warn: p.change > 5 }))} /></div>
            </div>
            <p className="rep-note">{tk('note2')}</p>
          </section>
        </>}
      </Async>
    </div>
  )
}

// Business report: a professional one-page template (title block, KPI table against targets, operations snapshot, analytics) that
// prints cleanly to A4 or saves as PDF, and downloads as CSV. LARIS works out every number from your records with fixed rules.
// Preview: the numbers here are sample data until the report service is switched on.
import { useState } from 'react'
import { useFetch, Async, PageHeader } from './ui'
import { t, useLang, getLang, locale } from './i18n'
import type { Text } from './i18n'

type KpiKey = 'revenue' | 'margin' | 'profit' | 'cac' | 'runway'
type Kpi = { key: KpiKey; target: number; actual: number; variance: number; vunit: '%' | 'mo'; status: 'on_track' | 'monitor' | 'at_risk' }
type Ops = { quotes_sent: number; quotes_accepted: number; quotes_accepted_prev: number; waiting: number; late_count: number; late_amount: number; supplier_spend: number; supplier_spend_prev: number; sales: number; sales_prev: number }
type An = { labels: string[]; sales: number[]; margin: number[]; funnel: { k: string; n: number }[]; customers: { name: string; amount: number; pct: number }[]
  products: { name: string; margin: number; amount: number }[]; aging: { k: string; count: number; amount: number }[]; suppliers: { name: string; amount: number; change: number }[] }
type Report = { period: string; label: string; from: string; to: string; as_of: string; org: { name: string; prepared_by: string }; kpis: Kpi[]; ops: Ops; analytics: An }

const S: Record<string, Text> = {
  title: { en: 'Business report', ms: 'Laporan perniagaan', zh: '业务报告', ta: 'வணிக அறிக்கை' },
  lead: { en: 'Your key figures against your targets, ready to print or save as a PDF.', ms: 'Angka utama anda berbanding sasaran, sedia untuk dicetak atau disimpan sebagai PDF.', zh: '关键数字与目标对照，可直接打印或存为 PDF。', ta: 'உங்கள் முக்கிய எண்கள் இலக்குகளுடன், அச்சிட அல்லது PDF ஆக சேமிக்க தயார்.' },
  preview: { en: 'Preview: sample numbers', ms: 'Pratonton: nombor contoh', zh: '预览：示例数据', ta: 'முன்னோட்டம்: மாதிரி எண்கள்' },
  week: { en: 'This week', ms: 'Minggu ini', zh: '本周', ta: 'இந்த வாரம்' }, last_week: { en: 'Last week', ms: 'Minggu lepas', zh: '上周', ta: 'கடந்த வாரம்' }, month: { en: 'This month', ms: 'Bulan ini', zh: '本月', ta: 'இந்த மாதம்' },
  period: { en: 'Period', ms: 'Tempoh', zh: '时间段', ta: 'காலம்' },
  print: { en: 'Print or save as PDF', ms: 'Cetak atau simpan PDF', zh: '打印或存为 PDF', ta: 'அச்சிடு / PDF' }, csv: { en: 'Download CSV', ms: 'Muat turun CSV', zh: '下载 CSV', ta: 'CSV பதிவிறக்கு' },
  doc: { en: 'Business Performance Report', ms: 'Laporan Prestasi Perniagaan', zh: '业务绩效报告', ta: 'வணிக செயல்திறன் அறிக்கை' },
  prep: { en: 'Prepared by', ms: 'Disediakan oleh', zh: '编制人', ta: 'தயாரித்தவர்' }, gen: { en: 'Generated', ms: 'Dijana', zh: '生成于', ta: 'உருவாக்கியது' }, per: { en: 'Period', ms: 'Tempoh', zh: '期间', ta: 'காலம்' },
  kpis: { en: 'Key Performance Indicators (KPIs)', ms: 'Petunjuk Prestasi Utama (KPI)', zh: '关键绩效指标（KPI）', ta: 'முக்கிய செயல்திறன் குறிகாட்டிகள் (KPI)' },
  metric: { en: 'Metric', ms: 'Metrik', zh: '指标', ta: 'அளவீடு' }, target: { en: 'Target', ms: 'Sasaran', zh: '目标', ta: 'இலக்கு' }, actual: { en: 'Actual', ms: 'Sebenar', zh: '实际', ta: 'உண்மை' },
  variance: { en: 'Variance (%)', ms: 'Varians (%)', zh: '差异（%）', ta: 'வேறுபாடு (%)' }, status: { en: 'Status', ms: 'Status', zh: '状态', ta: 'நிலை' },
  revenue: { en: 'Gross Revenue', ms: 'Hasil Kasar', zh: '总收入', ta: 'மொத்த வருவாய்' }, margin: { en: 'Gross Profit Margin', ms: 'Margin Untung Kasar', zh: '毛利率', ta: 'மொத்த இலாப விகிதம்' },
  profit: { en: 'Net Profit', ms: 'Untung Bersih', zh: '净利润', ta: 'நிகர இலாபம்' }, cac: { en: 'Customer Acquisition Cost (CAC)', ms: 'Kos Pemerolehan Pelanggan (CAC)', zh: '客户获取成本（CAC）', ta: 'வாடிக்கையாளர் பெறும் செலவு (CAC)' },
  runway: { en: 'Cash Runway', ms: 'Tempoh Tunai (Runway)', zh: '现金可支撑时间', ta: 'பண இருப்பு காலம்' },
  months: { en: 'Months', ms: 'Bulan', zh: '个月', ta: 'மாதங்கள்' }, mo: { en: 'Mo', ms: 'Bln', zh: '个月', ta: 'மா' },
  on_track: { en: 'On Track', ms: 'Mengikut Sasaran', zh: '达标', ta: 'இலக்கில்' }, monitor: { en: 'Monitor', ms: 'Pantau', zh: '需关注', ta: 'கவனிக்க' }, at_risk: { en: 'At Risk', ms: 'Berisiko', zh: '有风险', ta: 'ஆபத்து' },
  rules: { en: 'How status is set: on track means the target is met or beaten (for CAC, at or below target). Monitor means up to 5% short (CAC: up to 15% over). Anything worse is At Risk. Margin counts in percentage points and runway in months.', ms: 'Cara status ditetapkan: mengikut sasaran bermaksud sasaran dicapai atau dilepasi (CAC: pada atau di bawah sasaran). Pantau bermaksud kurang sehingga 5% (CAC: lebih sehingga 15%). Yang lebih teruk ialah Berisiko. Margin dikira dalam mata peratus dan runway dalam bulan.', zh: '状态规则：达标指达到或超过目标（CAC 为不高于目标）。需关注指差距在 5% 以内（CAC：超出 15% 以内）。更差则为有风险。利润率按百分点计，现金可支撑时间按月计。', ta: 'நிலை விதி: இலக்கை எட்டினால் அல்லது மிஞ்சினால் இலக்கில் (CAC: இலக்கு அல்லது குறைவு). 5% வரை குறைவு கவனிக்க (CAC: 15% வரை அதிகம்). அதைவிட மோசம் ஆபத்து. இலாப விகிதம் சதவீத புள்ளிகளிலும், இருப்பு காலம் மாதங்களிலும் கணக்கிடப்படும்.' },
  def: { en: 'CAC is marketing spend divided by new customers. Cash runway is the months of running costs your cash on hand covers. Targets are set by the owner (Settings, roadmap).', ms: 'CAC ialah perbelanjaan pemasaran dibahagi pelanggan baharu. Runway tunai ialah bilangan bulan kos operasi yang dilindungi tunai semasa. Sasaran ditetapkan pemilik (Tetapan, peta jalan).', zh: 'CAC 为营销支出除以新客户数。现金可支撑时间指现有现金可覆盖的运营成本月数。目标由业主设定（设置，路线图）。', ta: 'CAC என்பது சந்தைப்படுத்தல் செலவை புதிய வாடிக்கையாளர்களால் வகுத்தது. பண இருப்பு காலம் என்பது கையிருப்பு பணம் ஈடுசெய்யும் செயல்பாட்டு மாதங்கள். இலக்குகளை உரிமையாளர் அமைப்பார் (அமைப்புகள், திட்டம்).' },
  ops: { en: 'Operations at a glance', ms: 'Operasi sekilas pandang', zh: '运营概览', ta: 'செயல்பாடுகள் ஒரு பார்வையில்' },
  measure: { en: 'Measure', ms: 'Ukuran', zh: '项目', ta: 'அளவு' }, now: { en: 'This period', ms: 'Tempoh ini', zh: '本期', ta: 'இந்த காலம்' }, before: { en: 'Previous', ms: 'Sebelum ini', zh: '上期', ta: 'முந்தையது' }, chg: { en: 'Change', ms: 'Perubahan', zh: '变化', ta: 'மாற்றம்' },
  sales: { en: 'Sales', ms: 'Jualan', zh: '销售额', ta: 'விற்பனை' }, quotes: { en: 'Quotes accepted', ms: 'Sebut harga diterima', zh: '已接受报价', ta: 'ஏற்ற விலைப்புள்ளிகள்' },
  waiting: { en: 'Waiting to be paid', ms: 'Menunggu bayaran', zh: '待收款', ta: 'பெற வேண்டியது' }, overdue: { en: 'Of which overdue', ms: 'Daripadanya lewat', zh: '其中逾期', ta: 'அதில் காலம் கடந்தது' },
  spend: { en: 'Supplier spend', ms: 'Belanja pembekal', zh: '供应商支出', ta: 'விநியோகஸ்தர் செலவு' }, of: { en: 'of', ms: 'daripada', zh: '/', ta: 'இல்' },
  foot: { en: 'Prepared with LARIS. Sample data, for preview only.', ms: 'Disediakan dengan LARIS. Data contoh, untuk pratonton sahaja.', zh: '由 LARIS 编制。示例数据，仅供预览。', ta: 'LARIS மூலம் தயாரிக்கப்பட்டது. மாதிரி தரவு, முன்னோட்டத்திற்கு மட்டும்.' },
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

const tk = (k: string) => t(({ ...S, ...S2 } as Record<string, Text>)[k])
const rm = (n: number) => 'RM ' + Math.round(n).toLocaleString('en-MY')
const rm2 = (n: number) => 'RM ' + n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sg = (n: number) => (n > 0 ? '+' : '') + n
const pc = (a: number, b: number) => (b === 0 ? 0 : Math.round((a - b) / b * 1000) / 10)
const fmt = (k: KpiKey, v: number) => k === 'margin' ? `${v.toFixed(1)}%` : k === 'cac' ? rm2(v) : k === 'runway' ? `${v} ${t(S.months)}` : rm(v)
const vfmt = (k: Kpi) => k.vunit === 'mo' ? `${sg(k.variance)} ${t(S.mo)}` : `${k.variance > 0 ? '+' : ''}${k.variance.toFixed(1)}%`

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
function StatusChip({ s }: { s: Kpi['status'] }) {
  return <span className="rep-st" data-s={s}><i aria-hidden="true">{s === 'on_track' ? '✓' : s === 'monitor' ? '!' : '▲'}</i>{t(S[s])}</span>
}

export function ReportsView() {
  useLang()
  const [period, setPeriod] = useState('month')
  const s = useFetch<Report>(`/reports?period=${period}&lang=${getLang()}`)
  const d = s.data
  const csv = () => {
    if (!d) return
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const rows = [[d.org.name], [t(S.doc), d.label, `${d.from} - ${d.to}`], [], [t(S.kpis)], [t(S.metric), t(S.target), t(S.actual), t(S.variance), t(S.status)],
      ...d.kpis.map(k => [tk(k.key), fmt(k.key, k.target), fmt(k.key, k.actual), vfmt(k), t(S[k.status])]), [], [t(S.ops)], [t(S.measure), t(S.now), t(S.before)],
      [t(S.sales), rm(d.ops.sales), rm(d.ops.sales_prev)], [t(S.quotes), `${d.ops.quotes_accepted} ${t(S.of)} ${d.ops.quotes_sent}`, d.ops.quotes_accepted_prev], [t(S.waiting), rm(d.ops.waiting), ''], [t(S.overdue), rm(d.ops.late_amount), ''], [t(S.spend), rm(d.ops.supplier_spend), rm(d.ops.supplier_spend_prev)]]
    const u = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' })), a = document.createElement('a')
    a.href = u; a.download = `business-report-${d.period}-${d.as_of}.csv`; a.click(); URL.revokeObjectURL(u)
  }
  const o = d?.ops
  return (
    <div className="rep">
      <PageHeader title={t(S.title)} description={t(S.lead)} meta={<span className="pill">{t(S.preview)}</span>}
        actions={<div className="flex flex-wrap gap-2 rep-noprint"><button type="button" className="btn" onClick={csv} disabled={!d}>{t(S.csv)}</button>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>{t(S.print)}</button></div>} />
      <div className="rep-bar rep-noprint">
        <div role="group" aria-label={t(S.period)} className="seg">
          {(['week', 'last_week', 'month'] as const).map(k => <button key={k} type="button" aria-pressed={period === k} className={`seg-btn ${period === k ? 'on' : ''}`} onClick={() => setPeriod(k)}>{t(S[k])}</button>)}
        </div>
      </div>
      <Async s={s} rows={4}>
        {d && o && <article className="rep-sheet">
          <header className="rep-doc">
            <div><p className="rep-org">{d.org.name}</p><h2 className="rep-doc-h">{t(S.doc)}</h2></div>
            <dl className="rep-meta">
              <div><dt>{t(S.per)}</dt><dd>{d.label} · {d.from} – {d.to}</dd></div>
              <div><dt>{t(S.prep)}</dt><dd>{d.org.prepared_by}</dd></div>
              <div><dt>{t(S.gen)}</dt><dd>{new Date(d.as_of).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })}</dd></div>
            </dl>
          </header>

          <section className="rep-sec" aria-labelledby="rep-k">
            <h2 className="rep-h2" id="rep-k">{t(S.kpis)}</h2>
            <div className="rep-tw"><table className="rep-table">
              <thead><tr><th scope="col">{t(S.metric)}</th><th scope="col" className="num">{t(S.target)}</th><th scope="col" className="num">{t(S.actual)}</th><th scope="col" className="num">{t(S.variance)}</th><th scope="col">{t(S.status)}</th></tr></thead>
              <tbody>{d.kpis.map(k => <tr key={k.key}>
                <th scope="row">{tk(k.key)}</th><td className="num">{fmt(k.key, k.target)}</td><td className="num"><b>{fmt(k.key, k.actual)}</b></td>
                <td className="num rep-var" data-s={k.status}>{vfmt(k)}</td><td><StatusChip s={k.status} /></td></tr>)}</tbody>
            </table></div>
            <p className="rep-fn">{t(S.rules)}</p><p className="rep-fn">{t(S.def)}</p>
          </section>

          <section className="rep-sec" aria-labelledby="rep-o">
            <h2 className="rep-h2" id="rep-o">{t(S.ops)}</h2>
            <div className="rep-tw"><table className="rep-table">
              <thead><tr><th scope="col">{t(S.measure)}</th><th scope="col" className="num">{t(S.now)}</th><th scope="col" className="num">{t(S.before)}</th><th scope="col" className="num">{t(S.chg)}</th></tr></thead>
              <tbody>
                <tr><th scope="row">{t(S.sales)}</th><td className="num">{rm(o.sales)}</td><td className="num">{rm(o.sales_prev)}</td><td className="num">{sg(pc(o.sales, o.sales_prev))}%</td></tr>
                <tr><th scope="row">{t(S.quotes)}</th><td className="num">{o.quotes_accepted} {t(S.of)} {o.quotes_sent}</td><td className="num">{o.quotes_accepted_prev}</td><td className="num">{sg(o.quotes_accepted - o.quotes_accepted_prev)}</td></tr>
                <tr><th scope="row">{t(S.waiting)}</th><td className="num">{rm(o.waiting)}</td><td className="num">–</td><td className="num">–</td></tr>
                <tr><th scope="row">{t(S.overdue)}</th><td className="num">{rm(o.late_amount)} ({o.late_count})</td><td className="num">–</td><td className="num">–</td></tr>
                <tr><th scope="row">{t(S.spend)}</th><td className="num">{rm(o.supplier_spend)}</td><td className="num">{rm(o.supplier_spend_prev)}</td><td className="num">{sg(pc(o.supplier_spend, o.supplier_spend_prev))}%</td></tr>
              </tbody>
            </table></div>
          </section>

          <section className="rep-dash" aria-label={tk('dash')}>
            <h2 className="rep-h2">{tk('dash')}</h2>
            <div className="rep-grid">
              <div className="card rep-card rep-wide"><h3 className="rep-h">{tk('trend')}</h3><Trend a={d.analytics} /></div>
              <div className="card rep-card"><h3 className="rep-h">{tk('funnel')}</h3>
                <Bars rows={d.analytics.funnel.map(f => ({ label: tk('f' + f.k), value: f.n, text: String(f.n) }))} /></div>
              <div className="card rep-card"><h3 className="rep-h">{tk('cust')}</h3>
                <Bars rows={d.analytics.customers.map(c => ({ label: c.name, value: c.amount, text: `${rm(c.amount)} · ${c.pct}%` }))} /></div>
              <div className="card rep-card"><h3 className="rep-h">{tk('prod')}</h3>
                <Bars rows={d.analytics.products.map(p => ({ label: p.name, value: p.margin, text: `${p.margin}%`, warn: p.margin < 40 }))} /></div>
              <div className="card rep-card rep-wide"><h3 className="rep-h">{tk('sup')}</h3>
                <Bars rows={d.analytics.suppliers.map(p => ({ label: p.name, value: p.amount, text: `${rm(p.amount)} · ${p.change > 0 ? '▲ +' : '▼ '}${p.change}%`, warn: p.change > 5 }))} /></div>
            </div>
          </section>
          <footer className="rep-foot"><span>{d.org.name} · {t(S.doc)} · {d.label}</span><span>{t(S.foot)}</span></footer>
        </article>}
      </Async>
    </div>
  )
}

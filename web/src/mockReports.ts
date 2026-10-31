// SAMPLE data only (mock mode) for GET /reports. The real design: the SERVER computes every number from your records with fixed rules
// (the same rules as the rest of LARIS), then, if an AI key is set, asks the model only to WRITE the words around those numbers.
// The model never calculates, prices or approves. With no AI key (or if the AI is down) the words are built from rules and `source` says so.
import { ApiError } from './api'
import { mockChain } from './mockChain'

type L = 'en' | 'ms' | 'zh' | 'ta'
const PER: Record<string, { en: string; ms: string; zh: string; ta: string; prevEn: string; days: number; k: number }> = {
  week: { en: 'This week', ms: 'Minggu ini', zh: '本周', ta: 'இந்த வாரம்', prevEn: 'last week', days: 7, k: 1 },
  last_week: { en: 'Last week', ms: 'Minggu lepas', zh: '上周', ta: 'கடந்த வாரம்', prevEn: 'the week before', days: 7, k: 0.92 },
  month: { en: 'This month', ms: 'Bulan ini', zh: '本月', ta: 'இந்த மாதம்', prevEn: 'last month', days: 4, k: 4.1 },
}
const PREV: Record<L, Record<string, string>> = {
  en: { week: 'last week', last_week: 'the week before', month: 'last month' }, ms: { week: 'minggu lepas', last_week: 'minggu sebelumnya', month: 'bulan lepas' },
  zh: { week: '上周', last_week: '再上一周', month: '上月' }, ta: { week: 'கடந்த வாரத்துடன்', last_week: 'அதற்கு முந்தைய வாரத்துடன்', month: 'கடந்த மாதத்துடன்' },
}
const rm = (n: number) => 'RM ' + n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a - b) / b * 1000) / 10)

export function mockReports(method: string, p: string, q: string, owner: boolean): unknown {
  if (p !== '/reports' || method !== 'GET') return undefined
  if (!owner) throw new ApiError(403, 'forbidden', 'The business report is for the owner')
  const sp = new URLSearchParams(q), key = PER[sp.get('period') ?? 'week'] ? (sp.get('period') ?? 'week') : 'week', per = PER[key]
  const lang = (['en', 'ms', 'zh', 'ta'].includes(sp.get('lang') ?? '') ? sp.get('lang') : 'en') as L
  const ai = sp.get('ai') !== '0'
  // Money waiting comes from the sample documents on the Deals page, so the report and Deals agree.
  const rc = mockChain('GET', '/chain/receivables', '', true, {}) as { total: string; buckets: Record<string, { count: number; outstanding: string }> }
  const waiting = Number(rc.total), late = Object.entries(rc.buckets).filter(([k]) => k !== 'current').reduce((a, [, v]) => a + v.count, 0)
  const lateAmt = Object.entries(rc.buckets).filter(([k]) => k !== 'current').reduce((a, [, v]) => a + Number(v.outstanding), 0)
  const sales = Math.round(8420 * per.k), salesPrev = Math.round(7310 * (key === 'last_week' ? 0.95 : 1) * (key === 'month' ? 4.4 : 1) * (key === 'month' ? 0.98 : 1))
  const margin = key === 'last_week' ? 24.1 : 23.4, marginPrev = key === 'last_week' ? 25.0 : 25.7
  const spend = Math.round(sales * (1 - margin / 100) * 0.82), spendPrev = Math.round(salesPrev * (1 - marginPrev / 100) * 0.82)
  const sent = Math.round(14 * per.k), acc = Math.round(sent * 0.57), accPrev = Math.round(sent * 0.5)
  const series = per.days === 7 ? [820, 1240, 960, 1510, 1380, 1730, 780].map(v => Math.round(v * per.k)) : [8900, 10200, 9700, 11400]
  const dS = pct(sales, salesPrev), dM = Math.round((margin - marginPrev) * 10) / 10, dSp = pct(spend, spendPrev)
  const lab = per[lang], prev = PREV[lang][key], s = (n: number) => (n > 0 ? '+' : '') + n
  const t = {
    en: { sum: `${lab}: you sold ${rm(sales)} (${s(dS)}% against ${prev}) with a margin of ${margin}%. ${acc} of ${sent} quotes were accepted. ${rm(waiting)} is still waiting to be paid, and ${rm(lateAmt)} of it is overdue.`,
      c1: `Sales ${dS >= 0 ? 'rose' : 'fell'} ${Math.abs(dS)}% to ${rm(sales)}.`, c2: `Margin ${dM >= 0 ? 'rose' : 'slipped'} ${Math.abs(dM)} points to ${margin}%.`, c3: `Supplier spend ${dSp >= 0 ? 'rose' : 'fell'} ${Math.abs(dSp)}% to ${rm(spend)}.`,
      w1: `${late} invoice${late === 1 ? ' is' : 's are'} overdue (${rm(lateAmt)}). The oldest has waited the longest.`, w2: `Margin is ${margin < 25 ? 'below' : 'near'} the 25% you usually aim for.`, w3: 'Segar Foods raised its chicken price by about 6% on the last quote.',
      n1: 'Chase the overdue invoices', n2: 'Check quotes hit by a cost rise', n3: 'Compare supplier quotes for the next big order' },
    ms: { sum: `${lab}: anda menjual ${rm(sales)} (${s(dS)}% berbanding ${prev}) dengan margin ${margin}%. ${acc} daripada ${sent} sebut harga diterima. ${rm(waiting)} masih menunggu bayaran, dan ${rm(lateAmt)} daripadanya lewat tempoh.`,
      c1: `Jualan ${dS >= 0 ? 'naik' : 'turun'} ${Math.abs(dS)}% kepada ${rm(sales)}.`, c2: `Margin ${dM >= 0 ? 'naik' : 'turun'} ${Math.abs(dM)} mata kepada ${margin}%.`, c3: `Perbelanjaan pembekal ${dSp >= 0 ? 'naik' : 'turun'} ${Math.abs(dSp)}% kepada ${rm(spend)}.`,
      w1: `${late} invois lewat tempoh (${rm(lateAmt)}). Yang paling lama menunggu paling lama.`, w2: `Margin ${margin < 25 ? 'di bawah' : 'hampir'} sasaran 25% anda.`, w3: 'Segar Foods menaikkan harga ayam kira-kira 6% pada sebut harga terakhir.',
      n1: 'Tuntut invois yang lewat', n2: 'Semak sebut harga yang terkesan kos naik', n3: 'Bandingkan sebut harga pembekal untuk pesanan besar seterusnya' },
    zh: { sum: `${lab}：销售额 ${rm(sales)}（较${prev} ${s(dS)}%），利润率 ${margin}%。${sent} 份报价中有 ${acc} 份被接受。仍有 ${rm(waiting)} 待收，其中 ${rm(lateAmt)} 已逾期。`,
      c1: `销售额${dS >= 0 ? '上升' : '下降'} ${Math.abs(dS)}%，达 ${rm(sales)}。`, c2: `利润率${dM >= 0 ? '上升' : '下降'} ${Math.abs(dM)} 个百分点，为 ${margin}%。`, c3: `供应商支出${dSp >= 0 ? '上升' : '下降'} ${Math.abs(dSp)}%，为 ${rm(spend)}。`,
      w1: `有 ${late} 张发票逾期（${rm(lateAmt)}）。最早的一张等待最久。`, w2: `利润率${margin < 25 ? '低于' : '接近'}您通常的 25% 目标。`, w3: 'Segar Foods 在最近一次报价中把鸡肉价格上调了约 6%。',
      n1: '跟进逾期发票', n2: '查看受成本上涨影响的报价', n3: '为下一笔大订单比较供应商报价' },
    ta: { sum: `${lab}: நீங்கள் ${rm(sales)} விற்றீர்கள் (${prev} ${s(dS)}%), இலாப விகிதம் ${margin}%. ${sent} விலைப்புள்ளிகளில் ${acc} ஏற்கப்பட்டன. ${rm(waiting)} இன்னும் வர வேண்டியுள்ளது; அதில் ${rm(lateAmt)} காலம் கடந்தது.`,
      c1: `விற்பனை ${Math.abs(dS)}% ${dS >= 0 ? 'உயர்ந்து' : 'குறைந்து'} ${rm(sales)} ஆனது.`, c2: `இலாப விகிதம் ${Math.abs(dM)} புள்ளிகள் ${dM >= 0 ? 'உயர்ந்து' : 'குறைந்து'} ${margin}% ஆனது.`, c3: `விநியோகஸ்தர் செலவு ${Math.abs(dSp)}% ${dSp >= 0 ? 'உயர்ந்து' : 'குறைந்து'} ${rm(spend)} ஆனது.`,
      w1: `${late} விலைப்பட்டியல்கள் காலம் கடந்துள்ளன (${rm(lateAmt)}).`, w2: `இலாப விகிதம் உங்கள் 25% இலக்கை விட ${margin < 25 ? 'குறைவு' : 'அருகில்'}.`, w3: 'Segar Foods கடைசி விலைப்புள்ளியில் கோழி விலையை சுமார் 6% உயர்த்தியுள்ளது.',
      n1: 'காலம் கடந்த விலைப்பட்டியல்களைத் தொடருங்கள்', n2: 'செலவு உயர்வால் பாதிக்கப்பட்ட விலைப்புள்ளிகளைப் பாருங்கள்', n3: 'அடுத்த பெரிய ஆர்டருக்கு விநியோகஸ்தர் விலைப்புள்ளிகளை ஒப்பிடுங்கள்' },
  }[lang]
  const rules = lang === 'en' ? `${lab}: sales ${rm(sales)}, margin ${margin}%, ${acc} of ${sent} quotes accepted, ${rm(waiting)} waiting to be paid.` : t.sum
  const labels = per.days === 7 ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['W1', 'W2', 'W3', 'W4']
  const mg = per.days === 7 ? [26.1, 24.8, 23.9, 22.7, 23.5, 22.9, 24.4] : [25.9, 24.6, 23.8, 23.4]
  const share = [0.34, 0.27, 0.21, 0.18], cust = ['Mamak Corner Sdn Bhd', 'Taman Maju School', 'Kedai Runcit Ah Seng', 'Harapan Clinic']
  const analytics = {
    labels, sales: series, margin: mg,
    funnel: [{ k: 'sent', n: sent }, { k: 'viewed', n: Math.round(sent * 0.86) }, { k: 'accepted', n: acc }, { k: 'paid', n: Math.max(1, Math.round(acc * 0.6)) }],
    customers: cust.map((name, i) => ({ name, amount: Math.round(sales * share[i]), pct: Math.round(share[i] * 100) })),
    products: [{ name: 'Acrylic signboard 2x4 ft', margin: 31.2, amount: Math.round(sales * 0.31) }, { name: 'Banner, 8 oz vinyl', margin: 26.4, amount: Math.round(sales * 0.24) }, { name: 'LED neon strip install', margin: 19.8, amount: Math.round(sales * 0.22) }, { name: 'Vehicle decal set', margin: 14.6, amount: Math.round(sales * 0.23) }],
    aging: Object.entries(rc.buckets).map(([k, v]) => ({ k, count: v.count, amount: Number(v.outstanding) })),
    suppliers: [{ name: 'Segar Foods', amount: Math.round(spend * 0.42), change: 6.1 }, { name: 'Pasaran Jaya Trading', amount: Math.round(spend * 0.33), change: -1.4 }, { name: 'Johor Print Supplies', amount: Math.round(spend * 0.25), change: 2.2 }],
  }
  return {
    period: key, label: lab, source: ai ? 'model' : 'rules', model: ai ? 'sample model' : null, as_of: new Date().toISOString().slice(0, 10),
    numbers: { sales, sales_prev: salesPrev, margin_pct: margin, margin_prev: marginPrev, quotes_sent: sent, quotes_accepted: acc, quotes_accepted_prev: accPrev, waiting, late_count: late, late_amount: lateAmt, supplier_spend: spend, supplier_spend_prev: spendPrev },
    analytics, series,
    summary: ai ? t.sum : rules,
    changed: [t.c1, t.c2, t.c3], watch: [...(late > 0 ? [t.w1] : []), ...(margin < 25 ? [t.w2] : []), t.w3],
    next: [{ text: t.n1, href: '#/deals' }, { text: t.n2, href: '#/alerts' }, { text: t.n3, href: '#/deals' }],
    note: { en: 'Numbers are worked out by LARIS from your records. The AI only writes the words and never sets a price.', ms: 'Nombor dikira oleh LARIS daripada rekod anda. AI hanya menulis ayat dan tidak pernah menetapkan harga.', zh: '数字由 LARIS 根据您的记录计算。AI 只负责写文字，从不定价。', ta: 'எண்கள் உங்கள் பதிவுகளிலிருந்து LARIS கணக்கிடுகிறது. AI வார்த்தைகளை மட்டுமே எழுதும்; விலையை ஒருபோதும் நிர்ணயிக்காது.' }[lang],
  }
}

// SAMPLE data only (mock mode) for GET /reports. The real design: the SERVER computes every number from your records with fixed rules
// (the same fixed rules as the rest of LARIS): KPIs against the owner's targets, status by threshold, plus the operations and analytics figures.
// No AI writes any number here.
import { ApiError } from './api'
import { mockChain } from './mockChain'

type L = 'en' | 'ms' | 'zh' | 'ta'
const PER: Record<string, { en: string; ms: string; zh: string; ta: string; prevEn: string; days: number; k: number }> = {
  week: { en: 'This week', ms: 'Minggu ini', zh: '本周', ta: 'இந்த வாரம்', prevEn: 'last week', days: 7, k: 1 },
  last_week: { en: 'Last week', ms: 'Minggu lepas', zh: '上周', ta: 'கடந்த வாரம்', prevEn: 'the week before', days: 7, k: 0.92 },
  month: { en: 'This month', ms: 'Bulan ini', zh: '本月', ta: 'இந்த மாதம்', prevEn: 'last month', days: 4, k: 4.1 },
}

let tg = { revenue_month: '150000', margin_pct: '45', profit_month: '22500', cac: '35', runway_months: '6', cash_on_hand: '90000', cash_as_of: new Date().toISOString().slice(0, 10) }
export function mockReports(method: string, p: string, q: string, owner: boolean, body?: Record<string, string | null>): unknown {
  if (p === '/reports/targets') { if (!owner) throw new ApiError(403, 'forbidden', 'The business report is for the owner'); if (method === 'PUT') tg = { ...tg, ...body, cash_as_of: new Date().toISOString().slice(0, 10) } as typeof tg; return tg }
  if (p !== '/reports' || method !== 'GET') return undefined
  if (!owner) throw new ApiError(403, 'forbidden', 'The business report is for the owner')
  const sp = new URLSearchParams(q), key = PER[sp.get('period') ?? 'week'] ? (sp.get('period') ?? 'week') : 'week', per = PER[key]
  const lang = (['en', 'ms', 'zh', 'ta'].includes(sp.get('lang') ?? '') ? sp.get('lang') : 'en') as L
  const lab = per[lang]
  // Money waiting comes from the sample documents on the Deals page, so the report and Deals agree.
  const rc = mockChain('GET', '/chain/receivables', '', true, {}) as { total: string; buckets: Record<string, { count: number; outstanding: string }> }
  const waiting = Number(rc.total), late = Object.entries(rc.buckets).filter(([k]) => k !== 'current').reduce((a, [, v]) => a + v.count, 0)
  const lateAmt = Object.entries(rc.buckets).filter(([k]) => k !== 'current').reduce((a, [, v]) => a + Number(v.outstanding), 0)
  // Sample figures. Month matches the example report; week and last week are scaled.
  const SAL: Record<string, [number, number]> = { week: [37900, 33000], last_week: [35100, 33800], month: [155500, 149200] }
  const [sales, salesPrev] = SAL[key]
  const margin = key === 'last_week' ? 44.2 : key === 'week' ? 46.1 : 46.5, marginPrev = key === 'last_week' ? 45.3 : 45.8
  const spend = Math.round(sales * (1 - margin / 100) * 0.82), spendPrev = Math.round(salesPrev * (1 - marginPrev / 100) * 0.82)
  const sent = Math.round(14 * per.k), acc = Math.round(sent * 0.57), accPrev = Math.round(sent * 0.5)
  const series = per.days === 7 ? [0.1, 0.16, 0.12, 0.2, 0.18, 0.15, 0.09].map(v => Math.round(v * sales)) : [0.22, 0.26, 0.24, 0.28].map(v => Math.round(v * sales))
  // KPIs: [target, actual, higher is better, variance kind]. Status comes from fixed rules, never from the AI.
  const T: Record<string, number[][]> = {
    month: [[150000, 155500], [45, 46.5], [22500, 24100], [35, 38.5], [6, 6.5]],
    week: [[36000, 37900], [45, 46.1], [5200, 5650], [35, 36.2], [6, 6.5]],
    last_week: [[36000, 35100], [45, 44.2], [5200, 5000], [35, 33.9], [6, 6.4]],
  }
  const kinds = [['revenue', true, '%'], ['margin', true, 'pts'], ['profit', true, '%'], ['cac', false, '%'], ['runway', true, 'mo']] as const
  const kpis = kinds.map(([k, up, u], i) => {
    const [target, actual] = T[key][i]
    const v = u === '%' ? Math.round((actual - target) / target * 1000) / 10 : Math.round((actual - target) * 10) / 10
    const limit = u === '%' ? 5 : u === 'pts' ? 2 : 1
    const status = up ? (v >= 0 ? 'on_track' : v >= -limit ? 'monitor' : 'at_risk') : (v <= 0 ? 'on_track' : v <= 15 ? 'monitor' : 'at_risk')
    return { key: k, target, actual, variance: v, vunit: u === 'mo' ? 'mo' : '%', status }
  })
  const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, now = new Date(), dow = (now.getDay() + 6) % 7
  const mon = new Date(now.getTime() - dow * 864e5 - (key === 'last_week' ? 7 * 864e5 : 0))
  const [from, to] = key === 'month' ? [day(new Date(now.getFullYear(), now.getMonth(), 1)), day(new Date(now.getFullYear(), now.getMonth() + 1, 0))] : [day(mon), day(new Date(mon.getTime() + 6 * 864e5))]
  const labels = per.days === 7 ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['W1', 'W2', 'W3', 'W4']
  const mg = per.days === 7 ? [47.1, 45.8, 46.9, 45.2, 46.4, 46.8, 47.3] : [45.9, 46.4, 46.1, 46.5]
  const share = [0.34, 0.27, 0.21, 0.18], cust = ['Mamak Corner Sdn Bhd', 'Taman Maju School', 'Kedai Runcit Ah Seng', 'Harapan Clinic']
  const analytics = {
    labels, sales: series, margin: mg,
    funnel: [{ k: 'sent', n: sent }, { k: 'viewed', n: Math.round(sent * 0.86) }, { k: 'accepted', n: acc }, { k: 'paid', n: Math.max(1, Math.round(acc * 0.6)) }],
    customers: cust.map((name, i) => ({ name, amount: Math.round(sales * share[i]), pct: Math.round(share[i] * 100) })),
    products: [{ name: 'Acrylic signboard 2x4 ft', margin: 52.4, amount: Math.round(sales * 0.31) }, { name: 'Banner, 8 oz vinyl', margin: 47.8, amount: Math.round(sales * 0.24) }, { name: 'LED neon strip install', margin: 38.9, amount: Math.round(sales * 0.22) }, { name: 'Vehicle decal set', margin: 33.1, amount: Math.round(sales * 0.23) }],
    aging: Object.entries(rc.buckets).map(([k, v]) => ({ k, count: v.count, amount: Number(v.outstanding) })),
    suppliers: [{ name: 'Segar Foods', amount: Math.round(spend * 0.42), change: 6.1 }, { name: 'Pasaran Jaya Trading', amount: Math.round(spend * 0.33), change: -1.4 }, { name: 'Johor Print Supplies', amount: Math.round(spend * 0.25), change: 2.2 }],
  }
  return {
    period: key, label: lab, from, to, as_of: day(now), org: { name: 'SAMPLE Signage Workshop', prepared_by: 'SAMPLE Owner' }, kpis,
    ops: { sales, sales_prev: salesPrev, quotes_sent: sent, quotes_accepted: acc, quotes_accepted_prev: accPrev, waiting, late_count: late, late_amount: lateAmt, supplier_spend: spend, supplier_spend_prev: spendPrev },
    analytics,
  }
}

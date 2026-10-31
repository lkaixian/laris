// SAMPLE data only (mock mode): a small in-memory copy of GET /api/revenue, POST /api/expenses and POST /api/expenses/{id}/void (src/api/revenue.py).
// The rules are the server's (src/revenue.py) and are tested there against the real database (tests/test_revenue*.py); this copy only has to give the page
// believable numbers in the same shape. Money is added in whole cents, so nothing drifts. Everything is dated relative to today.
import { ApiError } from './api'
import { daysIn, granularity, iso, parse } from './revenuePeriods'
import type { Granularity } from './revenuePeriods'

interface Order { id: string; ref: string; customer: string; on: string; sales: number; cost: number | null; complete: boolean; owed: number; paid: number }
interface Exp { id: string; on: string; category: string; amount: number; note: string | null; voided?: boolean }
const CATEGORIES = ['rent', 'wages', 'utilities', 'transport', 'marketing', 'tax', 'other']
const back = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }
const cents = (x: number) => Math.round(x * 100)

// 14 orders over the last ~3 months. Two are jobs made by hand (no cost on record) and one has only part of its cost known.
const RAW: [number, string, number, number | null, boolean][] = [
  [95, 'Kedai Jaya Signage', 1800, 990, true], [80, 'Restoran Seri Mutiara', 950, 540, true], [70, 'Bengkel Hafiz', 3200, 1720, true], [58, 'Kafe Lestari', 1250, null, false],
  [47, 'Tadika Ceria', 2700, 1410, true], [40, 'Kedai Jaya Signage', 640, 330, true], [33, 'Hotel Bayu', 4100, 2480, true], [26, 'Restoran Seri Mutiara', 1550, 700, false],
  [19, 'Bengkel Hafiz', 2300, 1180, true], [14, 'Kafe Lestari', 880, null, false], [9, 'Hotel Bayu', 3600, 2050, true], [6, 'Tadika Ceria', 1950, 1010, true],
  [3, 'Kedai Jaya Signage', 720, 380, true], [1, 'Hotel Bayu', 2800, 1560, true],
]
const orders: Order[] = RAW.map(([ago, customer, sales, cost, complete], i) => ({
  id: `ord-${i + 1}`, ref: cost === null ? `Job: ${customer}` : `QT-2026-${String(i + 101).padStart(4, '0')}`, customer, on: back(ago),
  sales: cents(sales), cost: cost === null ? null : cents(cost), complete, owed: cents(sales * 1.06), paid: 0,
}))
// Customers pay 30% a day after the order is won and the rest nine days later, when those days have come.
const payments: { on: string; amount: number }[] = []
RAW.forEach(([ago, , sales], i) => {
  const owed = cents(sales * 1.06), dep = Math.round(owed * 0.3)
  if (ago >= 1) { payments.push({ on: back(ago - 1), amount: dep }); orders[i].paid += dep }
  if (ago >= 9) { payments.push({ on: back(ago - 9), amount: owed - dep }); orders[i].paid += owed - dep }
})
let seq = 0
const expenses: Exp[] = []
for (const m of [0, 1, 2, 3]) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - m)
  const at = (day: number) => { const x = new Date(d); x.setDate(day); return iso(x) }
  const today = iso(new Date())
  for (const [day, category, amount, note] of [[1, 'rent', 1800, 'Shop rent'], [26, 'wages', 2400, 'Two staff'], [15, 'utilities', 320, 'Power and water'], [8, 'transport', 140, 'Van petrol']] as const) {
    const on = at(day)
    if (on <= today) expenses.push({ id: `exp-${++seq}`, on, category, amount: cents(amount), note })
  }
}
expenses.push({ id: `exp-${++seq}`, on: back(21), category: 'marketing', amount: cents(450), note: 'Facebook ads' })

const m2 = (c: number) => (c / 100).toFixed(2)
const pct = (part: number, whole: number) => (whole ? (Math.round((part / whole) * 1000) / 10).toFixed(1) : null)
const inRange = <T extends { on: string }>(rows: T[], a: string, b: string) => rows.filter(r => r.on >= a && r.on <= b)
const add = (d: string, n: number) => { const x = parse(d)!; x.setDate(x.getDate() + n); return iso(x) }

function buckets(from: string, to: string, g: Granularity): [string, string][] {
  const out: [string, string][] = []
  let d = from
  while (d <= to) {
    const x = parse(d)!
    const stop = g === 'day' ? d : g === 'week' ? add(d, 6 - ((x.getDay() + 6) % 7)) : iso(new Date(x.getFullYear(), x.getMonth() + 1, 0))
    const end = stop < to ? stop : to
    out.push([d, end]); d = add(end, 1)
  }
  return out
}

function summarise(from: string, to: string) {
  const days = daysIn({ from, to }), g = granularity(days)
  const os = inRange(orders, from, to), ps = inRange(payments, from, to), es = inRange(expenses.filter(e => !e.voided), from, to)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const sales = sum(os.map(o => o.sales)), goods = sum(os.map(o => o.cost ?? 0)), gross = sales - goods, running = sum(es.map(e => e.amount)), net = gross - running
  const inn = sum(ps.map(p => p.amount)), out = goods + running
  const series = buckets(from, to, g).map(([a, b]) => {
    const i = sum(inRange(ps, a, b).map(p => p.amount)), gd = sum(inRange(os, a, b).map(o => o.cost ?? 0)), r = sum(inRange(es, a, b).map(e => e.amount))
    return { from: a, to: b, money_in: m2(i), goods: m2(gd), running: m2(r), money_out: m2(gd + r), left_over: m2(i - gd - r) }
  })
  const byCat = new Map<string, number>()
  es.forEach(e => byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount))
  return {
    raw: { sales, gross, net, money_in: inn, money_out: out },
    out: {
      from, to, days, granularity: g, sales: m2(sales), goods: m2(goods), gross: m2(gross), gross_pct: pct(gross, sales), running: m2(running), net: m2(net), net_pct: pct(net, sales),
      money_in: m2(inn), money_out: m2(out), left_over: m2(inn - out), to_collect: m2(sum(os.map(o => Math.max(o.owed - o.paid, 0)))),
      orders_counted: os.length, orders_without_cost: os.filter(o => o.cost === null || !o.complete).length, series,
      orders: [...os].sort((a, b) => b.sales - a.sales).map(o => ({ id: o.id, ref: o.ref, customer: o.customer, on: o.on, sales: m2(o.sales), cost: o.cost === null ? null : m2(o.cost),
        gross: m2(o.sales - (o.cost ?? 0)), cost_known: o.cost !== null && o.complete })),
      expenses_by_category: [...byCat].sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ category, amount: m2(amount) })),
      expense_rows: [...es].sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0)).map(e => ({ id: e.id, on: e.on, category: e.category, amount: m2(e.amount), note: e.note })),
    },
  }
}

export function mockRevenue(method: string, p: string, q: string, ctx: { owner: boolean; perm: (k: string) => void }, body: any): unknown {
  let m: RegExpMatchArray | null
  if (method === 'GET' && p === '/revenue') {
    ctx.perm('view_revenue'); ctx.perm('view_costs')
    const sp = new URLSearchParams(q), from = sp.get('from') ?? '', to = sp.get('to') ?? ''
    if (!parse(from) || !parse(to)) throw new ApiError(422, 'invalid_request', 'from and to must be dates (YYYY-MM-DD).')
    if (to < from) throw new ApiError(422, 'end_before_start', 'The end date is before the start date.')
    if (daysIn({ from, to }) > 731) throw new ApiError(422, 'too_long', 'The period is too long.')
    const days = daysIn({ from, to }), pf = add(from, -days), pt = add(from, -1)
    const now = summarise(from, to), before = summarise(pf, pt)
    const change = (k: keyof typeof now.raw) => (before.raw[k] ? (Math.round(((now.raw[k] - before.raw[k]) / Math.abs(before.raw[k])) * 1000) / 10).toFixed(1) : null)
    return { ...now.out, previous: { from: pf, to: pt, sales: m2(before.raw.sales), gross: m2(before.raw.gross), net: m2(before.raw.net), money_in: m2(before.raw.money_in), money_out: m2(before.raw.money_out) },
      change_pct: { sales: change('sales'), gross: change('gross'), net: change('net'), money_in: change('money_in'), money_out: change('money_out') },
      categories: CATEGORIES, can_record: (() => { try { ctx.perm('record_expenses'); return true } catch { return false } })(), can_void: ctx.owner, today: iso(new Date()) }
  }
  if (method === 'POST' && p === '/expenses') {
    ctx.perm('record_expenses')
    const amount = String(body?.amount ?? '')
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) throw new ApiError(422, 'invalid_request', 'amount must be above zero with at most two decimals.')
    if (!CATEGORIES.includes(body?.category) || !parse(String(body?.spent_on ?? ''))) throw new ApiError(422, 'invalid_request', 'category or date is not valid.')
    if (String(body.spent_on) > iso(new Date())) throw new ApiError(422, 'future_date', 'spent_on cannot be in the future')
    const e: Exp = { id: `exp-${++seq}`, on: body.spent_on, category: body.category, amount: cents(Number(amount)), note: String(body.note ?? '').trim() || null }
    expenses.push(e)
    return { id: e.id, spent_on: e.on, category: e.category, amount: m2(e.amount), note: e.note, created_at: new Date().toISOString() }
  }
  if (method === 'POST' && (m = p.match(/^\/expenses\/([^/]+)\/void$/))) {
    if (!ctx.owner) throw new ApiError(403, 'owner_only', 'owner role required')
    if (String(body?.reason ?? '').trim().length < 3) throw new ApiError(422, 'invalid_request', 'A reason of a few words is needed.')
    const e = expenses.find(x => x.id === m![1])
    if (!e) throw new ApiError(404, 'not_found', 'no such running cost')
    if (e.voided) throw new ApiError(409, 'already_void', 'this running cost is already voided')
    e.voided = true
    return { id: e.id, voided: true }
  }
  return undefined
}

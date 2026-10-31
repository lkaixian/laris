// Periods and chart scales for the Revenue page (Revenue.tsx), kept free of React so they can be tested on their own (revenuePeriods.test.ts).
// Dates travel as plain "YYYY-MM-DD" strings, the same as the API, and are built from year, month and day numbers rather than from timestamps,
// so a phone in another time zone cannot shift a day. The server (src/revenue.py) enforces the same limits and does the real arithmetic.
export type PeriodKey = 'month' | 'last-month' | 'quarter' | 'year' | 'custom'
export const PERIOD_KEYS: PeriodKey[] = ['month', 'last-month', 'quarter', 'year', 'custom']
export const MAX_DAYS = 731
export interface Range { from: string; to: string }
export type Granularity = 'day' | 'week' | 'month'

const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
// A real calendar date in strict YYYY-MM-DD form, or null ("2026-02-30" and "yesterday" are not dates).
export function parse(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3])
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null
}
const ymd = (y: number, m: number, d: number) => iso(new Date(y, m, d))     // month is 0-based; the Date constructor rolls over (month -1 is December)

// The ready-made periods. "This month", "Last 3 months" and "This year" run up to today; "Last month" is the whole of it.
export function range(key: PeriodKey, today: Date, custom?: Range): Range {
  const y = today.getFullYear(), m = today.getMonth(), t = iso(today)
  switch (key) {
    case 'month': return { from: ymd(y, m, 1), to: t }
    case 'last-month': return { from: ymd(y, m - 1, 1), to: ymd(y, m, 0) }          // day 0 of this month is the last day of the one before
    case 'quarter': return { from: ymd(y, m - 2, 1), to: t }
    case 'year': return { from: ymd(y, 0, 1), to: t }
    default: return custom ?? { from: ymd(y, m, 1), to: t }
  }
}

export const daysIn = (r: Range): number => {
  const a = parse(r.from), b = parse(r.to)
  return a && b ? Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5) + 1 : 0
}

// What is wrong with a custom period, or null when it is fine. The codes match the server's (422 end_before_start, too_long).
export function check(r: Range): 'missing' | 'end_before_start' | 'too_long' | null {
  if (!parse(r.from) || !parse(r.to)) return 'missing'
  const n = daysIn(r)
  return n < 1 ? 'end_before_start' : n > MAX_DAYS ? 'too_long' : null
}

// How the graph is cut, the same rule as the server so the page can say "by week" before the answer arrives.
export const granularity = (days: number): Granularity => (days <= 31 ? 'day' : days <= 140 ? 'week' : 'month')

// The smallest "round" top for a chart axis (1, 2, 2.5, 5 or 10 times a power of ten) that holds `v`, so labels read 0, 500, 1,000, 1,500 and not 0, 437, 874.
export function niceMax(v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) return 1
  const pow = 10 ** Math.floor(Math.log10(v))
  for (const step of [1, 2, 2.5, 5, 10]) if (step * pow >= v) return step * pow
  return 10 * pow
}
// Axis for a chart that holds values from `min` to `max` and may dip below zero: a round step (1, 2, 2.5, 5 or 10 times a power of ten), the axis
// stretched to whole steps, and a label at every step, so zero is always a gridline and the labels read 0, 1,000, 2,000 and never 625 or 3,125.
export function niceTicks(min: number, max: number, target = 4): { lo: number; hi: number; ticks: number[] } {
  const lo0 = Math.min(0, min), hi0 = Math.max(0, max)
  if (!(hi0 > lo0) || !Number.isFinite(hi0 - lo0)) return { lo: 0, hi: 1, ticks: [0, 1] }                  // nothing to draw yet: a plain 0 to 1 axis
  const step = niceMax((hi0 - lo0) / target)
  const lo = Math.floor(lo0 / step) * step, hi = Math.ceil(hi0 / step) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100)
  return { lo, hi, ticks }
}

// Width of a bar as a share of `base`, never thinner than `min` when there is something to show, never wider than the whole. 0 stays 0.
export const share = (value: number, base: number, min = 0.02): number => (!(value > 0) || !(base > 0) ? 0 : Math.min(1, Math.max(min, value / base)))

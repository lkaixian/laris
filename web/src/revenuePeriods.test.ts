// Run with: npm test (Node's built-in test runner). Excluded from the app's type check, see tsconfig.json.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_DAYS, check, daysIn, granularity, iso, niceMax, niceTicks, parse, range, share } from './revenuePeriods.ts'

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d)

test('the ready-made periods, on an ordinary day', () => {
  const today = at(2026, 10, 31)
  assert.deepEqual(range('month', today), { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(range('last-month', today), { from: '2026-09-01', to: '2026-09-30' })
  assert.deepEqual(range('quarter', today), { from: '2026-08-01', to: '2026-10-31' })        // this month and the two before
  assert.deepEqual(range('year', today), { from: '2026-01-01', to: '2026-10-31' })
})

test('the ready-made periods cross a year end and a leap day', () => {
  assert.deepEqual(range('last-month', at(2027, 1, 15)), { from: '2026-12-01', to: '2026-12-31' })
  assert.deepEqual(range('quarter', at(2027, 1, 15)), { from: '2026-11-01', to: '2027-01-15' })
  assert.deepEqual(range('quarter', at(2027, 2, 3)), { from: '2026-12-01', to: '2027-02-03' })
  assert.deepEqual(range('last-month', at(2028, 3, 10)), { from: '2028-02-01', to: '2028-02-29' })    // 2028 is a leap year
  assert.deepEqual(range('last-month', at(2027, 3, 10)), { from: '2027-02-01', to: '2027-02-28' })
  assert.deepEqual(range('month', at(2026, 3, 1)), { from: '2026-03-01', to: '2026-03-01' })           // the first day of the month: one day
})

test('a custom period is passed through, and falls back to this month when none is given', () => {
  assert.deepEqual(range('custom', at(2026, 10, 31), { from: '2026-02-01', to: '2026-02-14' }), { from: '2026-02-01', to: '2026-02-14' })
  assert.deepEqual(range('custom', at(2026, 10, 31)), { from: '2026-10-01', to: '2026-10-31' })
})

test('only real calendar dates parse', () => {
  assert.equal(iso(parse('2026-02-28')!), '2026-02-28')
  assert.equal(iso(parse('2028-02-29')!), '2028-02-29')
  for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-1-5', 'yesterday', '', '2026-10-31T00:00', ' 2026-10-31']) assert.equal(parse(bad), null, bad)
})

test('counting days is inclusive and ignores daylight saving', () => {
  assert.equal(daysIn({ from: '2026-10-01', to: '2026-10-01' }), 1)
  assert.equal(daysIn({ from: '2026-10-01', to: '2026-10-31' }), 31)
  assert.equal(daysIn({ from: '2026-01-01', to: '2026-12-31' }), 365)
  assert.equal(daysIn({ from: '2028-01-01', to: '2028-12-31' }), 366)
  assert.equal(daysIn({ from: '2026-03-01', to: '2026-03-31' }), 31)         // a month with a clock change in many countries still has 31 days
  assert.equal(daysIn({ from: 'x', to: '2026-10-01' }), 0)
})

test('a custom period is checked the way the server checks it', () => {
  assert.equal(check({ from: '2026-10-01', to: '2026-10-31' }), null)
  assert.equal(check({ from: '2026-10-05', to: '2026-10-05' }), null)
  assert.equal(check({ from: '2026-10-05', to: '2026-10-04' }), 'end_before_start')
  assert.equal(check({ from: '', to: '2026-10-04' }), 'missing')
  assert.equal(check({ from: '2026-10-05', to: 'soon' }), 'missing')
  assert.equal(check({ from: '2024-01-01', to: '2026-10-31' }), 'too_long')
  const from = '2026-01-01'
  const last = new Date(2026, 0, MAX_DAYS)                                    // day 731 counting 1 January as day 1
  assert.equal(check({ from, to: iso(last) }), null)
  assert.equal(check({ from, to: iso(new Date(2026, 0, MAX_DAYS + 1)) }), 'too_long')
})

test('how the graph is cut matches the server', () => {
  for (const [days, want] of [[1, 'day'], [31, 'day'], [32, 'week'], [140, 'week'], [141, 'month'], [731, 'month']] as const) assert.equal(granularity(days), want, String(days))
})

test('axis tops are round numbers that hold the data', () => {
  for (const [v, want] of [[0, 1], [-5, 1], [NaN, 1], [0.7, 1], [1, 1], [1.1, 2], [2.1, 2.5], [2.6, 5], [5.1, 10], [437, 500], [874, 1000], [1250, 2000],
                           [2400, 2500], [3650, 5000], [8000, 10000], [10000, 10000], [10001, 20000], [123456, 200000]] as const) assert.equal(niceMax(v), want, String(v))
  for (const v of [0.003, 7.3, 99, 1234.5, 98765.4]) assert.ok(niceMax(v) >= v && niceMax(v) < v * 2.6, String(v))      // holds the data without leaving most of the chart empty
})

test('axis labels sit on round numbers and zero is always one of them', () => {
  assert.deepEqual(niceTicks(0, 3650), { lo: 0, hi: 4000, ticks: [0, 1000, 2000, 3000, 4000] })
  assert.deepEqual(niceTicks(-2400, 4800), { lo: -4000, hi: 6000, ticks: [-4000, -2000, 0, 2000, 4000, 6000] })
  assert.deepEqual(niceTicks(-100, -50), { lo: -100, hi: 0, ticks: [-100, -75, -50, -25, 0] })      // all losses: the axis still reaches zero
  assert.deepEqual(niceTicks(0, 0), { lo: 0, hi: 1, ticks: [0, 1] })                                // nothing to draw
  assert.deepEqual(niceTicks(NaN, NaN), { lo: 0, hi: 1, ticks: [0, 1] })
  for (const [a, b] of [[0, 7], [-13, 250], [0, 98765], [-5000, 5000], [0.2, 0.9]] as const) {
    const t = niceTicks(a, b)
    assert.ok(t.lo <= Math.min(a, 0) && t.hi >= Math.max(b, 0), `${a}..${b} fits`)
    assert.ok(t.ticks.includes(0) && t.ticks[0] === t.lo && t.ticks.at(-1) === t.hi, `${a}..${b} has zero and both ends`)
    assert.ok(t.ticks.length >= 3 && t.ticks.length <= 8, `${a}..${b} has a sensible number of labels (${t.ticks.length})`)
  }
})

test('a share is never invisible, never overfull, and zero stays zero', () => {
  assert.equal(share(0, 100), 0)
  assert.equal(share(-5, 100), 0)
  assert.equal(share(50, 0), 0)
  assert.equal(share(50, 100), 0.5)
  assert.equal(share(0.1, 100), 0.02)                                         // a tiny cost still shows as a sliver
  assert.equal(share(150, 100), 1)
  assert.equal(share(0.1, 100, 0.05), 0.05)
})

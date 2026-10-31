// Run with: npm test (Node's built-in test runner; no extra packages). Excluded from the app's type check, see tsconfig.json.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromPreset, moveTo, nextSize, normalise, position, resize, sameLayout, setHidden, step, visible } from './bentoLayout.ts'
import type { Layout, TileDef } from './bentoLayout.ts'

const defs: TileDef[] = [{ id: 'a', size: 'L' }, { id: 'b', size: 'S' }, { id: 'c', size: 'M' }, { id: 'd', size: 'XL' }]
const ids = (l: Layout) => l.map(s => s.id).join('')
const shown = (l: Layout) => visible(l).map(s => s.id).join('')

test('a preset shows its tiles in order and hides the rest', () => {
  const l = fromPreset({ id: 'p', tiles: ['c', 'a'] }, defs)
  assert.equal(shown(l), 'ca')
  assert.equal(ids(l), 'cabd')
  assert.deepEqual(l.map(s => s.hidden), [false, false, true, true])
  assert.equal(l[0].size, 'M')                                   // a tile keeps its own default size
})

test('a preset ignores tiles this user does not have, repeats, and can override sizes', () => {
  const l = fromPreset({ id: 'p', tiles: ['ghost', 'b', 'b', 'a'], sizes: { a: 'XL' } }, defs)
  assert.equal(shown(l), 'ba')
  assert.equal(l.find(s => s.id === 'a')!.size, 'XL')
})

test('normalise repairs a saved layout against today\'s tiles', () => {
  const saved = [{ id: 'b', size: 'M', hidden: false }, { id: 'gone', size: 'S', hidden: false }, { id: 'b', size: 'L', hidden: true },
                 { id: 'a', size: 'huge', hidden: true }, null, 7, { size: 'S' }]
  const l = normalise(saved, defs)!
  assert.equal(ids(l), 'bacd')                                   // unknown dropped, repeat dropped, new tiles (c, d) appended
  assert.equal(l[0].size, 'M')
  assert.equal(l[1].size, 'L')                                   // bad size falls back to the tile's default
  assert.equal(l[1].hidden, true)
  assert.deepEqual([l[2].hidden, l[3].hidden], [false, false])   // tiles added by an update are shown, not silently hidden
})

test('normalise refuses anything that is not a usable list', () => {
  for (const bad of [null, undefined, 'x', 5, {}, [], [null], [{ id: 'zzz' }]]) assert.equal(normalise(bad, defs), null, String(bad))
})

test('moveTo reorders and clamps', () => {
  const l = fromPreset({ id: 'p', tiles: ['a', 'b', 'c', 'd'] }, defs)
  assert.equal(ids(moveTo(l, 'd', 0)), 'dabc')
  assert.equal(ids(moveTo(l, 'a', 99)), 'bcda')
  assert.equal(ids(moveTo(l, 'a', -5)), 'abcd')
  assert.equal(moveTo(l, 'a', 0), l)                             // nothing to do returns the same list
  assert.equal(moveTo(l, 'nope', 2), l)
})

test('step moves one place among the visible tiles and steps over hidden ones', () => {
  let l: Layout = fromPreset({ id: 'p', tiles: ['a', 'b', 'c', 'd'] }, defs)
  l = setHidden(l, 'b', true)                                    // a [b hidden] c d
  assert.equal(shown(step(l, 'c', -1)), 'cad')
  assert.equal(ids(step(l, 'c', -1)), 'cabd')                    // c takes a's place; the hidden b stays where it was in the order
  assert.equal(step(l, 'a', -1), l)                              // already first
  assert.equal(step(l, 'd', 1), l)                               // already last
})

test('resize, cycle sizes, hide and show', () => {
  const l = fromPreset({ id: 'p', tiles: ['a', 'b'] }, defs)
  assert.equal(resize(l, 'b', 'XL').find(s => s.id === 'b')!.size, 'XL')
  assert.equal(resize(l, 'b', 'giant' as never), l)
  assert.deepEqual(['S', 'M', 'L', 'XL'].map(s => nextSize(s as never)), ['M', 'L', 'XL', 'S'])
  const h = setHidden(l, 'a', true)
  assert.equal(shown(h), 'b')
  assert.equal(shown(setHidden(h, 'a', false)), 'ab')            // coming back it keeps its old place
})

test('position counts visible tiles only', () => {
  let l = fromPreset({ id: 'p', tiles: ['a', 'b', 'c'] }, defs)
  l = setHidden(l, 'a', true)
  assert.deepEqual(position(l, 'c'), { at: 2, of: 2 })
  assert.deepEqual(position(l, 'a'), { at: 0, of: 2 })
})

test('sameLayout compares order, size and hidden state', () => {
  const l = fromPreset({ id: 'p', tiles: ['a', 'b'] }, defs)
  assert.ok(sameLayout(l, l.map(s => ({ ...s }))))
  assert.ok(!sameLayout(l, resize(l, 'a', 'S')))
  assert.ok(!sameLayout(l, moveTo(l, 'a', 1)))
  assert.ok(!sameLayout(l, setHidden(l, 'a', true)))
})

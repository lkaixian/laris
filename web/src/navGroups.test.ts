// Run with: npm test (Node's built-in test runner). Excluded from the app's type check, see tsconfig.json.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupOf, isOpen, parse } from './navGroups.ts'

test('only the everyday group starts open', () => {
  assert.equal(isOpen({}, 'Work'), true)
  for (const g of ['Suppliers', 'Insight', 'Audit Log', 'Admin']) assert.equal(isOpen({}, g), false, g)
})

test('what the person chose wins over the default, both ways', () => {
  assert.equal(isOpen({ Suppliers: true }, 'Suppliers'), true)
  assert.equal(isOpen({ Work: false }, 'Work'), false)
})

test('a page finds its group', () => {
  const groups = [{ label: 'Work', items: [{ key: 'home' }, { key: 'deals' }] }, { label: 'Suppliers', items: [{ key: 'contacts' }, { key: 'ask' }] }]
  assert.equal(groupOf(groups, 'ask'), 'Suppliers')
  assert.equal(groupOf(groups, 'deals'), 'Work')
  assert.equal(groupOf(groups, 'nowhere'), undefined)
})

test('saved choices that are damaged or odd are ignored, never trusted', () => {
  assert.deepEqual(parse(null), {})
  assert.deepEqual(parse('not json'), {})
  assert.deepEqual(parse('[1,2]'), {})
  assert.deepEqual(parse('"x"'), {})
  assert.deepEqual(parse('{"Work":true,"Admin":"yes","Insight":false}'), { Work: true, Insight: false })
})

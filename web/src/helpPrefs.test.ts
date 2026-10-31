// Run with: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TUTORIAL_KEY, setShowTutorialButton, showTutorialButton } from './helpPrefs.ts'

const store = new Map<string, string>()
const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }

test('the tutorial button is on until someone turns it off', () => {
  Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true })
  store.clear()
  assert.equal(showTutorialButton(), true)
  setShowTutorialButton(false)
  assert.equal(store.get(TUTORIAL_KEY), 'off')
  assert.equal(showTutorialButton(), false)
  setShowTutorialButton(true)
  assert.equal(store.has(TUTORIAL_KEY), false)                 // on is the absence of the key, so "reset" is just clearing it
  assert.equal(showTutorialButton(), true)
})

test('an unknown stored value leaves the button on', () => {
  store.set(TUTORIAL_KEY, 'banana')
  assert.equal(showTutorialButton(), true)
})

test('blocked storage leaves the button on and does not throw', () => {
  const blocked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  Object.defineProperty(globalThis, 'localStorage', { value: blocked, configurable: true })
  assert.equal(showTutorialButton(), true)
  assert.doesNotThrow(() => setShowTutorialButton(false))
})

// Appearance preferences beyond the old light/dark toggle, all stored on this device only:
//   theme         light, dark, or system (follow the device; the default until someone picks)
//   transparency  "reduce" swaps the frosted glass for solid panels (the device setting prefers-reduced-transparency does it too)
//   lite          stops the moving background and the grain, and halves the blur (for slow phones)
// glass.css reads three attributes on <html>: data-theme, data-transparency="reduce", data-lite. The background also pauses (data-hidden) in a hidden tab.
export type ThemePref = 'light' | 'dark' | 'system'

const get = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const put = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* storage blocked: lasts for this visit */ } }
const root = () => document.documentElement
const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

export const themePref = (): ThemePref => { const v = get('theme'); return v === 'light' || v === 'dark' ? v : 'system' }

// Put the resolved theme on <html> and tell the app (it keeps a `dark` flag for the logo and charts). Returns true when dark.
export function applyTheme(): boolean {
  const p = themePref()
  const dark = p === 'dark' || (p === 'system' && systemDark())
  root().dataset.theme = dark ? 'dark' : 'light'
  dispatchEvent(new Event('laris:theme'))
  return dark
}
export function setThemePref(p: ThemePref): boolean { put('theme', p === 'system' ? null : p); return applyTheme() }

export const reduceTransparency = () => get('laris.transparency') === 'reduce'
export function setReduceTransparency(on: boolean) { put('laris.transparency', on ? 'reduce' : null); applySkin() }
export const liteVisuals = () => get('laris.lite') === '1'
export function setLiteVisuals(on: boolean) { put('laris.lite', on ? '1' : null); applySkin() }

function applySkin() {
  const r = root()
  if (reduceTransparency()) r.dataset.transparency = 'reduce'; else delete r.dataset.transparency
  if (liteVisuals()) r.dataset.lite = ''; else delete r.dataset.lite
}

let started = false
export function initSkin() {
  if (started || typeof document === 'undefined') return
  started = true
  applySkin()
  if (typeof matchMedia === 'function') matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themePref() === 'system') applyTheme() })
  const vis = () => { if (document.hidden) root().dataset.hidden = ''; else delete root().dataset.hidden }
  document.addEventListener('visibilitychange', vis); vis()
}

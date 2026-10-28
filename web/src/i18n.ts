import { useSyncExternalStore } from 'react'

// Minimal bilingual support. Only the search palette is translated for now; add { en, ms } pairs where needed.
export type Lang = 'en' | 'ms'
export interface Text { en: string; ms: string }

const KEY = 'laris.lang'
const read = (): Lang => { try { return localStorage.getItem(KEY) === 'ms' ? 'ms' : 'en' } catch { return 'en' } }
let lang: Lang = read()
const subs = new Set<() => void>()
if (typeof document !== 'undefined') document.documentElement.lang = lang

export const setLang = (l: Lang) => {
  lang = l
  try { localStorage.setItem(KEY, l) } catch { /* storage blocked: lasts for this visit */ }
  document.documentElement.lang = l
  subs.forEach(f => f())
}
export const useLang = () => [useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb) } }, () => lang), setLang] as const
export const t = (e: Text, l: Lang = lang) => e[l]

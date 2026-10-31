import { useSyncExternalStore } from 'react'

// Four languages: English, Bahasa Melayu, Chinese (simplified, as used in Malaysia) and Tamil.
// Older text pairs carry only { en, ms }: in Chinese or Tamil they show in English until someone adds zh and ta.
// The shell, menus, status labels and the Jobs, Follow-ups, Schedule, Activity and Assistant screens are fully translated (strings.ts).
export type Lang = 'en' | 'ms' | 'zh' | 'ta'
export interface Text { en: string; ms: string; zh?: string; ta?: string }
export const LANGS: [Lang, string, string][] = [['en', 'English', 'en-MY'], ['ms', 'Bahasa Melayu', 'ms-MY'], ['zh', '中文', 'zh-Hans-MY'], ['ta', 'தமிழ்', 'ta-MY']]

const KEY = 'laris.lang'
const isLang = (v: unknown): v is Lang => v === 'en' || v === 'ms' || v === 'zh' || v === 'ta'
const read = (): Lang => { try { const v = localStorage.getItem(KEY); return isLang(v) ? v : 'en' } catch { return 'en' } }
let lang: Lang = read()
const subs = new Set<() => void>()
if (typeof document !== 'undefined') document.documentElement.lang = lang

export const setLang = (l: Lang) => {
  lang = l
  try { localStorage.setItem(KEY, l) } catch { /* storage blocked: lasts for this visit */ }
  document.documentElement.lang = l
  subs.forEach(f => f())
}
export const getLang = () => lang
export const useLang = () => [useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb) } }, () => lang), setLang] as const
// Any { en, ms, zh?, ta? } value in the current (or given) language, English when that language is missing.
export const pick = <T,>(e: { en: T; ms: T; zh?: T; ta?: T }, l: Lang = lang): T => e[l] ?? e.en
export const t = (e: Text, l: Lang = lang) => pick(e, l)
// The locale for dates and numbers in the chosen language.
export const locale = (l: Lang = lang) => LANGS.find(x => x[0] === l)?.[2] ?? 'en-MY'

import { useSyncExternalStore } from 'react'

// Whether the Tutorial help shows: the "Tutorial" button beside page titles (ui.tsx GuideButton) and the "?" beside main-menu items (Shell.tsx NavList,
// both the step-by-step guides and the Help Center article links). On by default; a person who does not need them turns them off in Settings
// and back on there. Stored on this device only. The guides and articles are not removed; only the buttons that open them are hidden.
export const TUTORIAL_KEY = 'laris.tutorialButton'
const subs = new Set<() => void>()

export const showTutorialButton = (): boolean => { try { return localStorage.getItem(TUTORIAL_KEY) !== 'off' } catch { return true } }

export function setShowTutorialButton(on: boolean) {
  try { if (on) localStorage.removeItem(TUTORIAL_KEY); else localStorage.setItem(TUTORIAL_KEY, 'off') } catch { /* storage blocked: the choice lasts for this visit only */ }
  forced = on ? null : false
  subs.forEach(f => f())
}
// If storage is blocked the choice cannot be read back, so keep it in memory for this visit.
let forced: boolean | null = null
const read = () => (forced === null ? showTutorialButton() : forced)

const subscribe = (cb: () => void) => {
  subs.add(cb)
  const onStorage = (e: StorageEvent) => { if (e.key === TUTORIAL_KEY) { forced = null; cb() } }   // another tab changed it
  if (typeof addEventListener === 'function') addEventListener('storage', onStorage)
  return () => { subs.delete(cb); if (typeof removeEventListener === 'function') removeEventListener('storage', onStorage) }
}
export const useShowTutorialButton = () => useSyncExternalStore(subscribe, read, () => true)

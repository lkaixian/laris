// Which menu groups are folded. Pure, so it can be tested on its own (navGroups.test.ts); Shell.tsx keeps the state and saves it on this device.
// Only the everyday group (Work) starts open: the rest (Suppliers, Insight, Admin...) open with one tap, so a new owner sees a short menu.
export const NAV_GROUPS_KEY = 'laris.nav.groups'
export const OPEN_BY_DEFAULT = ['Work']
export type Folds = Record<string, boolean>   // group label -> true (open) or false (folded); a group not listed uses the default

export const isOpen = (folds: Folds, label: string): boolean => folds[label] ?? OPEN_BY_DEFAULT.includes(label)

// The group the current page belongs to, so it can be opened when you arrive on one of its pages (a link, the search box, the back button).
export const groupOf = (groups: { label: string; items: { key: string }[] }[], key: string): string | undefined => groups.find(g => g.items.some(i => i.key === key))?.label

export function parse(raw: string | null): Folds {
  try {
    const v = JSON.parse(raw ?? '{}')
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'boolean')) as Folds
  } catch { return {} }
}

export const read = (): Folds => { try { return parse(localStorage.getItem(NAV_GROUPS_KEY)) } catch { return {} } }
export const save = (f: Folds) => { try { localStorage.setItem(NAV_GROUPS_KEY, JSON.stringify(f)) } catch { /* storage blocked: lasts for this visit */ } }

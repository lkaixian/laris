// Layout rules for the bento grid (Bento.tsx), kept free of React so they can be tested on their own (bentoLayout.test.ts).
// A layout is an ordered list of slots: which tile, how big, hidden or not. A saved layout is never trusted: normalise() repairs it
// against the tiles that exist today, so a tile removed in an update, a tile added in an update, or a damaged value in storage cannot break Home.
export type Size = 'S' | 'M' | 'L' | 'XL'
export const SIZES: Size[] = ['S', 'M', 'L', 'XL']
export const SPAN: Record<Size, number> = { S: 3, M: 6, L: 6, XL: 12 }   // of 12 columns on a wide screen (CSS narrows them on tablets and phones)

export interface Slot { id: string; size: Size; hidden: boolean }
export type Layout = Slot[]
export interface TileDef { id: string; size: Size }
export interface Preset { id: string; tiles: string[]; sizes?: Record<string, Size> }   // `tiles` is the visible ones, in order; the rest are hidden

const isSize = (v: unknown): v is Size => typeof v === 'string' && (SIZES as string[]).includes(v)

// Start from a preset: its tiles first (only those that exist for this user), then every other tile hidden.
export function fromPreset(p: Preset, defs: TileDef[]): Layout {
  const known = new Map(defs.map(d => [d.id, d]))
  const shown = [...new Set(p.tiles)].filter(id => known.has(id))
  const out: Layout = shown.map(id => ({ id, size: p.sizes?.[id] ?? known.get(id)!.size, hidden: false }))
  for (const d of defs) if (!shown.includes(d.id)) out.push({ id: d.id, size: p.sizes?.[d.id] ?? d.size, hidden: true })
  return out
}

// Repair whatever was saved. Unknown tiles and repeats are dropped, bad sizes fall back to the default, tiles that are new since
// the layout was saved are added at the end and shown (so an update's new tile is not silently invisible).
export function normalise(saved: unknown, defs: TileDef[]): Layout | null {
  if (!Array.isArray(saved)) return null
  const known = new Map(defs.map(d => [d.id, d]))
  const seen = new Set<string>()
  const out: Layout = []
  for (const s of saved) {
    if (!s || typeof s !== 'object') continue
    const { id, size, hidden } = s as Record<string, unknown>
    if (typeof id !== 'string' || !known.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push({ id, size: isSize(size) ? size : known.get(id)!.size, hidden: hidden === true })
  }
  if (out.length === 0) return null
  for (const d of defs) if (!seen.has(d.id)) out.push({ id: d.id, size: d.size, hidden: false })
  return out
}

const idx = (l: Layout, id: string) => l.findIndex(s => s.id === id)

// Move a tile to a position among ALL slots (hidden ones keep their place in the order, so showing a tile again puts it back where it was).
export function moveTo(l: Layout, id: string, to: number): Layout {
  const from = idx(l, id)
  if (from < 0) return l
  const at = Math.max(0, Math.min(l.length - 1, to))
  if (at === from) return l
  const next = l.slice()
  const [slot] = next.splice(from, 1)
  next.splice(at, 0, slot)
  return next
}

// One step earlier or later among the VISIBLE tiles (a hidden tile in between is stepped over, not counted).
export function step(l: Layout, id: string, dir: -1 | 1): Layout {
  const visible = l.filter(s => !s.hidden).map(s => s.id)
  const i = visible.indexOf(id)
  const target = visible[i + dir]
  if (i < 0 || target === undefined) return l
  return moveTo(l, id, idx(l, target))
}

export const resize = (l: Layout, id: string, size: Size): Layout => (isSize(size) ? l.map(s => (s.id === id ? { ...s, size } : s)) : l)
export const nextSize = (size: Size): Size => SIZES[(SIZES.indexOf(size) + 1) % SIZES.length]
export const setHidden = (l: Layout, id: string, hidden: boolean): Layout => l.map(s => (s.id === id ? { ...s, hidden } : s))
export const visible = (l: Layout) => l.filter(s => !s.hidden)
export const position = (l: Layout, id: string) => ({ at: visible(l).findIndex(s => s.id === id) + 1, of: visible(l).length })
export const sameLayout = (a: Layout, b: Layout) => a.length === b.length && a.every((s, i) => s.id === b[i].id && s.size === b[i].size && s.hidden === b[i].hidden)

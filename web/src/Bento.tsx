import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { Icon } from './icons'
import { t, useLang } from './i18n'
import type { Text } from './i18n'
import { fromPreset, moveTo, nextSize, normalise, position, sameLayout, setHidden, step, visible } from './bentoLayout'
import type { Layout, Preset, Size } from './bentoLayout'

// A reorderable grid of tiles (Home). Normal mode is just the tiles. "Edit layout" turns each tile into something you can move (drag, arrow
// keys, or the earlier/later buttons: dragging fails on small phones and for keyboard users), resize, or hide; presets rebuild the whole grid
// for a kind of person. The layout is saved per person on this device. Rules live in bentoLayout.ts; every move is also announced to screen readers.
const S = {
  edit: { en: 'Edit layout', ms: 'Ubah susun atur', zh: '编辑布局', ta: 'அமைப்பைத் திருத்து' },
  done: { en: 'Done', ms: 'Selesai', zh: '完成', ta: 'முடிந்தது' },
  reset: { en: 'Reset layout', ms: 'Tetapkan semula susun atur', zh: '重置布局', ta: 'அமைப்பை மீட்டமை' },
  preset: { en: 'Layout', ms: 'Susun atur', zh: '布局方案', ta: 'அமைப்பு' },
  custom: { en: 'Custom', ms: 'Tersuai', zh: '自定义', ta: 'தனிப்பயன்' },
  drag: { en: 'Move this tile: drag it, or press the arrow keys', ms: 'Alih jubin ini: seret, atau tekan kekunci anak panah', zh: '移动此卡片：拖动，或按方向键', ta: 'இந்த ஓட்டை நகர்த்த: இழுக்கவும் அல்லது அம்புக்குறி விசைகளை அழுத்தவும்' },
  earlier: { en: 'Move earlier', ms: 'Alih ke depan', zh: '前移', ta: 'முன்னே நகர்த்து' },
  later: { en: 'Move later', ms: 'Alih ke belakang', zh: '后移', ta: 'பின்னே நகர்த்து' },
  size: { en: 'Change size', ms: 'Tukar saiz', zh: '更改大小', ta: 'அளவை மாற்று' },
  hide: { en: 'Hide this tile', ms: 'Sembunyikan jubin ini', zh: '隐藏此卡片', ta: 'இந்த ஓட்டை மறை' },
  show: { en: 'Show', ms: 'Tunjuk', zh: '显示', ta: 'காட்டு' },
  hiddenTitle: { en: 'Hidden tiles', ms: 'Jubin tersembunyi', zh: '已隐藏的卡片', ta: 'மறைக்கப்பட்ட ஓடுகள்' },
  noneHidden: { en: 'No tiles are hidden.', ms: 'Tiada jubin disembunyikan.', zh: '没有隐藏的卡片。', ta: 'மறைக்கப்பட்ட ஓடுகள் எதுவும் இல்லை.' },
  editing: { en: 'Editing the layout. Your changes are saved on this device.', ms: 'Mengubah susun atur. Perubahan anda disimpan pada peranti ini.', zh: '正在编辑布局。更改会保存在此设备上。', ta: 'அமைப்பைத் திருத்துகிறீர்கள். மாற்றங்கள் இந்தச் சாதனத்தில் சேமிக்கப்படும்.' },
} satisfies Record<string, Text>
const SIZE_NAME: Record<Size, Text> = {
  S: { en: 'Small', ms: 'Kecil', zh: '小', ta: 'சிறியது' }, M: { en: 'Medium', ms: 'Sederhana', zh: '中', ta: 'நடுத்தரம்' },
  L: { en: 'Large', ms: 'Besar', zh: '大', ta: 'பெரியது' }, XL: { en: 'Extra large', ms: 'Sangat besar', zh: '特大', ta: 'மிகப் பெரியது' },
}

export interface BentoTile { id: string; size: Size; title: string; node: ReactNode }
export interface BentoPreset extends Preset { label: Text }

const read = (key: string): unknown => { try { const v = JSON.parse(localStorage.getItem(key) ?? 'null'); return v?.v === 1 ? v.layout : null } catch { return null } }
const write = (key: string, layout: Layout) => { try { localStorage.setItem(key, JSON.stringify({ v: 1, layout })) } catch { /* storage blocked: the layout lasts for this visit */ } }

export function BentoGrid({ tiles, storageKey, presets, defaultPreset }: { tiles: BentoTile[]; storageKey: string; presets: BentoPreset[]; defaultPreset: string }) {
  useLang()
  const defs = tiles.map(({ id, size }) => ({ id, size }))
  const preset = (id: string) => presets.find(p => p.id === id) ?? presets[0]
  const [saved, setSaved] = useState<Layout>(() => normalise(read(storageKey), defs) ?? fromPreset(preset(defaultPreset), defs))
  // Tiles come and go with the data (a customer reply, an owner-only tile): repair on every render instead of trusting the saved list.
  const layout = normalise(saved, defs) ?? fromPreset(preset(defaultPreset), defs)
  const cur = useRef(layout); cur.current = layout
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState('')
  const [dragging, setDragging] = useState<string | null>(null)
  const lastOver = useRef<string | null>(null)
  const byId = new Map(tiles.map(x => [x.id, x]))

  const commit = (next: Layout, id?: string) => {
    if (next === cur.current) return
    cur.current = next; setSaved(next); write(storageKey, next)
    if (id) { const p = position(next, id); setNote(t({ en: `${byId.get(id)?.title} is now ${p.at} of ${p.of}.`, ms: `${byId.get(id)?.title} kini ke-${p.at} daripada ${p.of}.`, zh: `${byId.get(id)?.title} 现在是第 ${p.at} 个，共 ${p.of} 个。`, ta: `${byId.get(id)?.title} இப்போது ${p.of} இல் ${p.at}வது.` })) }
  }
  const apply = (p: Preset) => commit(fromPreset(p, defs))
  const current = presets.find(p => sameLayout(fromPreset(p, defs), layout))

  const onKey = (e: KeyboardEvent, id: string) => {
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0
    if (dir) { e.preventDefault(); commit(step(cur.current, id, dir), id) }
  }
  // Dragging uses pointer events (mouse, touch and pen alike), listened for on the window while a drag lasts. Not pointer capture: React moves the
  // tile's element when the order changes, and a moved element loses its capture, which would end the drag after the first swap.
  // The tile under the pointer swaps places once per tile crossed, so a tall tile cannot flip-flop.
  useEffect(() => {
    if (!dragging) return
    const move = (e: globalThis.PointerEvent) => {
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-tile-id]')?.dataset.tileId
      if (!over || over === dragging || over === lastOver.current) return
      lastOver.current = over
      commit(moveTo(cur.current, dragging, cur.current.findIndex(s => s.id === over)), dragging)
    }
    const end = () => setDragging(null)
    addEventListener('pointermove', move); addEventListener('pointerup', end); addEventListener('pointercancel', end)
    return () => { removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end) }
    // commit only reads refs and stable setters; re-binding on every render would drop events in the middle of a drag
  }, [dragging])

  return (
    <div className="mb-6" data-guide="home-tiles">
      <div className="bento-bar">
        {editing ? <>
          <label className="flex items-center gap-2 text-sm font-semibold">{t(S.preset)}
            <select className="input" value={current?.id ?? ''} onChange={e => { const p = presets.find(x => x.id === e.target.value); if (p) apply(p) }}>
              {!current && <option value="" disabled>{t(S.custom)}</option>}
              {presets.map(p => <option key={p.id} value={p.id}>{t(p.label)}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-sm" onClick={() => apply(preset(defaultPreset))}>{t(S.reset)}</button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => { setEditing(false); setNote('') }}>{t(S.done)}</button>
        </> : <button type="button" className="btn btn-sm gap-2" onClick={() => { setEditing(true); setNote(t(S.editing)) }}><Icon name="settings" className="size-4" />{t(S.edit)}</button>}
      </div>
      <p role="status" className="sr-only">{note}</p>
      <ul className="bento-shell" data-dragging={dragging ? '' : undefined}>
        {visible(layout).map((slot, i) => {
          const tile = byId.get(slot.id)!
          return (
            <li key={slot.id} className="bento-cell" data-tile-id={slot.id} data-size={slot.size} data-editing={editing || undefined} data-dragging={dragging === slot.id || undefined}
              style={{ '--d': `${Math.min(i, 7) * 50}ms` } as CSSProperties}>
              {editing && (
                <div className="bento-tools">
                  <span className="bento-name">{tile.title}</span>
                  <button type="button" className="bento-tool bento-handle" aria-label={`${t(S.drag)}: ${tile.title}`} title={t(S.drag)} onKeyDown={e => onKey(e, slot.id)}
                    onPointerDown={e => { if (e.pointerType === 'mouse' && e.button !== 0) return; lastOver.current = null; setDragging(slot.id) }}><Icon name="menu" className="size-4" /></button>
                  <button type="button" className="bento-tool" aria-label={`${t(S.earlier)}: ${tile.title}`} title={t(S.earlier)} onClick={() => commit(step(layout, slot.id, -1), slot.id)}><Icon name="left" className="size-4" /></button>
                  <button type="button" className="bento-tool" aria-label={`${t(S.later)}: ${tile.title}`} title={t(S.later)} onClick={() => commit(step(layout, slot.id, 1), slot.id)}><Icon name="right" className="size-4" /></button>
                  <button type="button" className="bento-tool min-w-12 text-sm font-semibold" aria-label={`${t(S.size)}: ${tile.title}, ${t(SIZE_NAME[slot.size])}`} title={t(S.size)}
                    onClick={() => commit(layout.map(x => (x.id === slot.id ? { ...x, size: nextSize(x.size) } : x)), slot.id)}>{slot.size}</button>
                  <button type="button" className="bento-tool" aria-label={`${t(S.hide)}: ${tile.title}`} title={t(S.hide)} onClick={() => commit(setHidden(layout, slot.id, true), slot.id)}><Icon name="close" className="size-4" /></button>
                </div>
              )}
              <div className="bento-body" inert={editing || undefined}>{tile.node}</div>
            </li>
          )
        })}
      </ul>
      {editing && (
        <section aria-label={t(S.hiddenTitle)} className="bento-tray">
          <h2 className="text-sm font-semibold">{t(S.hiddenTitle)}</h2>
          {layout.some(s => s.hidden) ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {layout.filter(s => s.hidden).map(s => (
                <li key={s.id}><button type="button" className="btn btn-sm gap-2" onClick={() => commit(setHidden(layout, s.id, false), s.id)}><Icon name="plus" className="size-4" />{t(S.show)}: {byId.get(s.id)?.title}</button></li>
              ))}
            </ul>
          ) : <p className="mt-1 text-sm text-muted">{t(S.noneHidden)}</p>}
        </section>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { api } from './api'
import { Async, msg, useFetch } from './ui'
import { Pic } from './Listings'
import { t, useLang } from './i18n'
import type { Text } from './i18n'

/* "Products": every product read from catalog photos in one list. Search, filter by the business's own categories, move products
   between categories (select, bulk, or drag onto a category), and confirm the category the reader suggested (src/api/catalog.py). */
interface Prod {
  id: string; listing_id: string; description: string; sku: string | null; sizes: string[]; price: string | number | null; currency: string | null
  status: string; crop_url: string; category: string | null; category_suggestion: string | null
}
interface Cats { categories: { name: string; count: number }[]; total: number; uncategorised: number }
type Pick = { kind: 'all' } | { kind: 'none' } | { kind: 'cat'; name: string }

const S = {
  search: { en: 'Search products', ms: 'Cari produk', zh: '搜索商品', ta: 'தயாரிப்புகளைத் தேடு' },
  searchHint: { en: 'Name, SKU, label or category', ms: 'Nama, SKU, label atau kategori', zh: '名称、SKU、标签或分类' },
  all: { en: 'All', ms: 'Semua', zh: '全部', ta: 'அனைத்தும்' },
  none: { en: 'No category', ms: 'Tiada kategori', zh: '未分类', ta: 'வகை இல்லை' },
  newCat: { en: 'New category', ms: 'Kategori baharu', zh: '新分类', ta: 'புதிய வகை' },
  add: { en: 'Add', ms: 'Tambah', zh: '添加', ta: 'சேர்' },
  rename: { en: 'Rename', ms: 'Namakan semula', zh: '重命名', ta: 'மறுபெயரிடு' },
  del: { en: 'Delete category', ms: 'Padam kategori', zh: '删除分类', ta: 'வகையை நீக்கு' },
  delNote: { en: 'Its products stay in the catalog, without a category.', ms: 'Produknya kekal dalam katalog, tanpa kategori.', zh: '其中的商品会保留在目录中，但不再有分类。' },
  save: { en: 'Save', ms: 'Simpan', zh: '保存', ta: 'சேமி' },
  cancel: { en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து செய்' },
  category: { en: 'Category', ms: 'Kategori', zh: '分类', ta: 'வகை' },
  move: { en: 'Move to', ms: 'Alih ke', zh: '移动到', ta: 'நகர்த்து' },
  moveSel: { en: 'Move selected to…', ms: 'Alih yang dipilih ke…', zh: '把所选移动到…', ta: 'தேர்ந்தவற்றை நகர்த்து…' },
  clear: { en: 'Clear selection', ms: 'Kosongkan pilihan', zh: '取消选择', ta: 'தேர்வை அழி' },
  confirm: { en: 'Confirm', ms: 'Sahkan', zh: '确认', ta: 'உறுதிப்படுத்து' },
  confirmAll: { en: 'Confirm all suggestions', ms: 'Sahkan semua cadangan', zh: '确认全部建议', ta: 'அனைத்து பரிந்துரைகளையும் உறுதிப்படுத்து' },
  dragHint: { en: 'Tip: drag a product onto a category above to move it.', ms: 'Petua: seret produk ke kategori di atas untuk mengalihkannya.', zh: '提示：把商品拖到上方的分类即可移动。' },
  open: { en: 'Open photo', ms: 'Buka foto', zh: '打开照片', ta: 'படத்தைத் திற' },
  empty: { en: 'No products match.', ms: 'Tiada produk sepadan.', zh: '没有匹配的商品。', ta: 'பொருந்தும் தயாரிப்புகள் இல்லை.' },
  emptyHint: { en: 'Read a catalog photo and its products appear here.', ms: 'Baca foto katalog dan produknya muncul di sini.', zh: '识别目录照片后，商品会显示在这里。' },
} satisfies Record<string, Text>
const sugLine = (s: string, exists: boolean): Text => exists
  ? { en: `Looks like “${s}”. Put it there?`, ms: `Nampak seperti “${s}”. Letakkan di sana?`, zh: `看起来属于“${s}”。放进去吗？` }
  : { en: `New category “${s}”? It will be created.`, ms: `Kategori baharu “${s}”? Ia akan dicipta.`, zh: `新分类“${s}”？将会创建。` }

export function CatalogProducts({ canEdit }: { canEdit: boolean }) {
  useLang()
  const [typed, setTyped] = useState('')
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<Pick>({ kind: 'all' })
  const [sel, setSel] = useState<string[]>([])
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [delAsk, setDelAsk] = useState(false)
  const [over, setOver] = useState<string>()
  useEffect(() => { const id = setTimeout(() => setQ(typed.trim()), 250); return () => clearTimeout(id) }, [typed])

  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (pick.kind === 'cat') params.set('category', pick.name)
  if (pick.kind === 'none') params.set('uncategorised', 'true')
  const cats = useFetch<Cats>('/catalog/categories')
  const list = useFetch<Prod[]>(`/catalog/items?${params}`)
  const names = cats.data?.categories.map(c => c.name) ?? []
  const lower = new Set(names.map(n => n.toLowerCase()))
  const reload = () => { cats.reload(); list.reload() }
  const run = async (f: () => Promise<unknown>, after?: () => void) => { setErr(''); try { await f(); after?.(); reload() } catch (e) { setErr(msg(e)) } }

  const move = (ids: string[], category: string | null) => run(() => api('POST', '/catalog/items/move', { item_ids: ids, category }), () => setSel(s => s.filter(x => !ids.includes(x))))
  const accept = (ids: string[]) => run(() => api('POST', '/catalog/items/accept-suggestions', { item_ids: ids }))
  const addCat = () => { const n = name.trim(); if (n) run(() => api('POST', '/catalog/categories', { name: n }), () => { setName(''); setAdding(false) }) }
  const rename = () => { if (pick.kind === 'cat' && name.trim()) run(() => api('POST', '/catalog/categories/rename', { old: pick.name, new: name.trim() }), () => { setPick({ kind: 'cat', name: name.trim() }); setName(''); setRenaming(false) }) }
  const remove = () => { if (pick.kind === 'cat') run(() => api('POST', '/catalog/categories/delete', { name: pick.name }), () => { setPick({ kind: 'all' }); setDelAsk(false) }) }
  const toggle = (id: string) => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]))
  const choose = (v: string, ids: string[]) => {
    if (v === '__new') { const n = prompt(t(S.newCat)); if (n?.trim()) move(ids, n.trim()); return }
    move(ids, v === '' || v === '__none' ? null : v)
  }
  const isPick = (p: Pick) => pick.kind === p.kind && (pick.kind !== 'cat' || (p.kind === 'cat' && p.name === pick.name))
  const rows = list.data ?? []
  const suggested = rows.filter(x => x.category_suggestion && !x.category)

  // A product dragged onto a category chip moves there (the whole selection when the dragged one is part of it).
  const drop = (e: React.DragEvent, target: string | null) => {
    e.preventDefault(); setOver(undefined)
    const id = e.dataTransfer.getData('text/plain')
    if (id && canEdit) move(sel.includes(id) ? sel : [id], target)
  }
  const chip = (key: string, p: Pick, label: string, n: number | undefined, target: string | null | undefined) => (
    <button key={key} type="button" aria-pressed={isPick(p)} onClick={() => { setPick(p); setRenaming(false); setDelAsk(false) }}
      onDragOver={target === undefined || !canEdit ? undefined : e => { e.preventDefault(); setOver(key) }} onDragLeave={() => setOver(undefined)} onDrop={target === undefined || !canEdit ? undefined : e => drop(e, target)}
      className={`btn min-h-9 gap-2 aria-pressed:border-accent aria-pressed:bg-tint ${over === key ? 'border-accent bg-tint' : ''}`}>
      {label}{n !== undefined && <span className="badge">{n}</span>}
    </button>)

  return (
    <div className="grid gap-4">
      <label className="grid gap-1 text-sm font-semibold">{t(S.search)}
        <input type="search" className="input w-full font-normal" value={typed} placeholder={t(S.searchHint)} onChange={e => setTyped(e.target.value)} />
      </label>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t(S.category)}>
        {chip('all', { kind: 'all' }, t(S.all), cats.data?.total, undefined)}
        {chip('none', { kind: 'none' }, t(S.none), cats.data?.uncategorised, null)}
        {cats.data?.categories.map(c => chip('c:' + c.name, { kind: 'cat', name: c.name }, c.name, c.count, c.name))}
        {canEdit && (adding
          ? <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); addCat() }}>
              <input autoFocus className="input min-h-9 w-44" maxLength={60} value={name} aria-label={t(S.newCat)} placeholder={t(S.newCat)} onChange={e => setName(e.target.value)} />
              <button type="submit" className="btn btn-primary min-h-9">{t(S.add)}</button>
              <button type="button" className="btn min-h-9" onClick={() => { setAdding(false); setName('') }}>{t(S.cancel)}</button>
            </form>
          : <button type="button" className="btn btn-quiet min-h-9" onClick={() => { setAdding(true); setRenaming(false) }}>+ {t(S.newCat)}</button>)}
      </div>

      {canEdit && pick.kind === 'cat' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {renaming
            ? <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); rename() }}>
                <input autoFocus className="input min-h-9 w-44" maxLength={60} value={name} aria-label={t(S.rename)} onChange={e => setName(e.target.value)} />
                <button type="submit" className="btn btn-primary min-h-9">{t(S.save)}</button>
                <button type="button" className="btn min-h-9" onClick={() => { setRenaming(false); setName('') }}>{t(S.cancel)}</button>
              </form>
            : <button type="button" className="btn min-h-9" onClick={() => { setRenaming(true); setName(pick.name); setAdding(false) }}>{t(S.rename)}</button>}
          {delAsk
            ? <><span className="text-muted">{t(S.delNote)}</span><button type="button" className="btn btn-danger min-h-9" onClick={remove}>{t(S.del)}</button><button type="button" className="btn min-h-9" onClick={() => setDelAsk(false)}>{t(S.cancel)}</button></>
            : <button type="button" className="btn min-h-9" onClick={() => setDelAsk(true)}>{t(S.del)}</button>}
        </div>)}

      {err && <p role="alert" className="text-sm text-warn">{err}</p>}

      {canEdit && suggested.length > 1 && <div><button type="button" className="btn min-h-9" onClick={() => accept(suggested.map(x => x.id))}>{t(S.confirmAll)} ({suggested.length})</button></div>}

      {canEdit && sel.length > 0 && (
        <div className="card flex flex-wrap items-center gap-2 p-3" role="region" aria-label={t(S.moveSel)}>
          <span className="text-sm font-semibold">{sel.length}</span>
          <select className="input min-h-9 w-auto" value="" aria-label={t(S.moveSel)} onChange={e => choose(e.target.value, sel)}>
            <option value="" disabled>{t(S.moveSel)}</option>
            <option value="__none">{t(S.none)}</option>
            {names.map(n => <option key={n} value={n}>{n}</option>)}
            <option value="__new">+ {t(S.newCat)}</option>
          </select>
          <button type="button" className="btn btn-quiet min-h-9" onClick={() => setSel([])}>{t(S.clear)}</button>
        </div>)}

      <Async s={list} rows={4} empty={!rows.length} emptyText={t(S.empty)} emptyHint={t(S.emptyHint)}>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(p => (
            <li key={p.id} className="card grid gap-2 p-3" draggable={canEdit} onDragStart={e => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move' }}>
              <div className="flex items-start gap-3">
                {canEdit && <input type="checkbox" className="mt-1 size-5" checked={sel.includes(p.id)} onChange={() => toggle(p.id)} aria-label={p.description} />}
                <Pic url={p.crop_url} alt={p.description} className="h-20 w-24 shrink-0 rounded-ui object-contain" />
                <div className="min-w-0">
                  <a className="font-semibold break-words" href={`#/catalog/${p.listing_id}`} title={t(S.open)}>{p.description}</a>
                  <p className="text-sm text-muted">{[p.sku, p.sizes.length ? p.sizes.join(', ') : null, p.price !== null && p.price !== undefined ? `${p.currency ?? 'MYR'} ${Number(p.price).toFixed(2)}` : null].filter(Boolean).join(' · ')}</p>
                </div>
              </div>
              {canEdit
                ? <label className="grid gap-1 text-xs font-semibold">{t(S.move)}
                    <select className="input min-h-9 w-full font-normal" value={p.category ?? ''} onChange={e => choose(e.target.value === '' ? '__none' : e.target.value, [p.id])}>
                      <option value="__none">{t(S.none)}</option>
                      {p.category && !lower.has(p.category.toLowerCase()) && <option value={p.category}>{p.category}</option>}
                      {names.map(n => <option key={n} value={n}>{n}</option>)}
                      <option value="__new">+ {t(S.newCat)}</option>
                    </select>
                  </label>
                : <p className="text-sm">{p.category ?? t(S.none)}</p>}
              {canEdit && !p.category && p.category_suggestion && (
                <div className="flex flex-wrap items-center gap-2 rounded-ui bg-tint p-2 text-sm">
                  <span className="min-w-0 flex-1">{t(sugLine(p.category_suggestion, lower.has(p.category_suggestion.toLowerCase())))}</span>
                  <button type="button" className="btn btn-primary min-h-9" onClick={() => accept([p.id])}>{t(S.confirm)}</button>
                </div>)}
            </li>))}
        </ul>
      </Async>
      {canEdit && rows.length > 0 && <p className="text-xs text-muted">{t(S.dragHint)}</p>}
    </div>
  )
}

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { api } from './api'
import type { DocSummary } from './api'
import { matchFns, visibleFns } from './functions'
import type { Ctx, Fn } from './functions'
import { t, useLang } from './i18n'
import type { Text } from './i18n'
import { Icon } from './icons'
import type { IconName } from './icons'
import { focusTop } from './ui'

/* Search palette: functions (functions.ts) and records (GET /search). Opened from Shell (header field, "/" or Ctrl/Cmd+K). */
interface Row { key: string; title: string; path: string; href: string; icon: IconName; group: 'fn' | 'rec'; fn?: string; action?: Fn['action'] }
interface Found { contacts: { id: string; name: string; role: string }[]; documents: DocSummary[] }

const S = {
  placeholder: { en: 'Search or jump to...', ms: 'Cari atau pergi ke...' },
  fns: { en: 'Functions', ms: 'Fungsi' }, recs: { en: 'Records', ms: 'Rekod' }, recent: { en: 'Recent', ms: 'Terkini' },
  try: { en: 'Try: invite, export, approve', ms: 'Cuba: jemput, eksport, lulus' },
  none: { en: 'Nothing matches', ms: 'Tiada padanan untuk' }, tryNone: { en: 'Try: invite, export, quote.', ms: 'Cuba: jemput, eksport, sebut harga.' },
  searchRecs: { en: 'Search records for', ms: 'Cari rekod untuk' }, close: { en: 'Close search', ms: 'Tutup carian' },
  hints: { en: 'Up/Down to move, Enter to open, Esc to close', ms: 'Atas/Bawah untuk bergerak, Enter untuk buka, Esc untuk tutup' },
  results: { en: 'results', ms: 'hasil' }, noRes: { en: 'No results', ms: 'Tiada hasil' }, label: { en: 'Search', ms: 'Carian' },
  noDoc: { en: 'No document number', ms: 'Tiada nombor dokumen' },
} satisfies Record<string, Text>

const RECENT = 'laris.recent'
const readRecent = (): Row[] => { try { return (JSON.parse(localStorage.getItem(RECENT) ?? '[]') as Row[]).slice(0, 5) } catch { return [] } }
const saveRecent = (r: Row) => { try { localStorage.setItem(RECENT, JSON.stringify([r, ...readRecent().filter(x => x.key !== r.key)].slice(0, 5))) } catch { /* storage blocked */ } }

export function Palette({ ctx, onClose, onAction }: { ctx: Ctx; onClose: () => void; onAction: (a: NonNullable<Fn['action']>) => void }) {
  const [lang] = useLang()
  const [q, setQ] = useState('')
  const [recs, setRecs] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const [prev] = useState(() => document.activeElement as HTMLElement | null)  // focus returns here on Esc / close
  const restore = useRef(true)
  const box = useRef<HTMLDivElement>(null)
  const id = useId()
  const listId = `${id}-list`
  const term = q.trim()

  const fnRow = (f: Fn): Row => ({ key: 'fn:' + f.id, title: t(f.label, lang), path: f.path.join(' > '), href: f.href, icon: f.icon, group: 'fn', fn: f.id, action: f.action })
  const visible = useMemo(() => visibleFns(ctx), [ctx.owner, ctx.me, ctx.signedIn])  // eslint-disable-line react-hooks/exhaustive-deps
  const fnRows = useMemo(() => matchFns(visible, term, lang).slice(0, 8).map(fnRow), [visible, term, lang])  // eslint-disable-line react-hooks/exhaustive-deps
  // Recent: function rows are re-read from the registry (current language, still permitted); record rows are kept as saved.
  const recent = useMemo(() => term ? [] : readRecent().flatMap(r => r.fn ? visible.filter(f => f.id === r.fn).map(fnRow) : [r]), [term, visible, lang])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {  // records: debounced 250 ms, 2+ characters, latest answer wins
    setRecs([])
    if (term.length < 2) { setLoading(false); return }
    setLoading(true)
    let stale = false
    const h = setTimeout(async () => {
      try {
        const r = await api<Found>('GET', `/search?q=${encodeURIComponent(term)}`, undefined, { quiet: true })
        if (stale) return
        setRecs([
          ...r.contacts.slice(0, 4).map((c): Row => ({ key: 'c:' + c.id, title: c.name, path: `Suppliers > Contacts > ${c.name}`, href: `#/contact/${c.id}`, icon: 'contacts', group: 'rec' })),
          ...r.documents.slice(0, 4).map((d): Row => {
            const no = d.doc_no ?? t(S.noDoc, lang)
            return { key: 'd:' + d.id, title: `${no}  ${d.party.name}`, path: `Work > Tracker > ${no}`, href: `#/doc/${d.id}`, icon: 'tracker', group: 'rec' }
          }),
        ])
      } catch { /* records are a bonus: functions still work */ }
      if (!stale) setLoading(false)
    }, 250)
    return () => { stale = true; clearTimeout(h) }
  }, [term, lang])

  const none = !!term && !fnRows.length && !recs.length && !loading
  const rows: Row[] = term
    ? [...fnRows, ...recs, ...(none ? [{ key: 'search', title: `${t(S.searchRecs, lang)} '${term}'`, path: '', href: `#/search/${encodeURIComponent(term)}`, icon: 'search' as const, group: 'rec' as const }] : [])]
    : recent
  const idx = Math.min(active, Math.max(rows.length - 1, 0))
  useEffect(() => setActive(0), [term])
  useEffect(() => { document.getElementById(`${id}-o${idx}`)?.scrollIntoView({ block: 'nearest' }) }, [idx, id])
  useEffect(() => () => { if (restore.current) requestAnimationFrame(() => prev?.focus()) }, [prev])  // after the page behind stops being inert

  const choose = (r: Row | undefined) => {
    if (!r) return
    if (r.key !== 'search') saveRecent(r)
    restore.current = false
    onClose()
    if (r.action) { onAction(r.action); return }
    if (r.href === location.hash) requestAnimationFrame(() => focusTop())
    else location.hash = r.href
  }
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (rows.length) setActive((idx + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length)
    } else if (e.key === 'Enter') { e.preventDefault(); choose(rows[idx]) }
    else if (e.key === 'Tab') {  // focus trap: input <-> close button
      const f = [...box.current!.querySelectorAll<HTMLElement>('input,button')]
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }

  const heading = (text: Text, n: string) => <div id={`${id}-${n}`} role="presentation" className="px-4 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-muted">{t(text, lang)}</div>
  const group = (g: Row['group'] | null, text: Text, n: string) => {
    const list = rows.map((r, i) => ({ r, i })).filter(x => !g || x.r.group === g)
    if (!list.length) return null
    return (
      <div role="group" aria-labelledby={`${id}-${n}`}>
        {heading(text, n)}
        {list.map(({ r, i }) => (
          <div key={r.key} id={`${id}-o${i}`} role="option" aria-selected={i === idx}
            className={`flex min-h-11 cursor-pointer items-center gap-3 border-l-4 px-3 py-2 ${i === idx ? 'border-accent bg-tint' : 'border-transparent'}`}
            onMouseDown={e => e.preventDefault()} onMouseMove={() => i !== idx && setActive(i)} onClick={() => choose(r)}>
            <span aria-hidden="true" className="text-accent"><Icon name={r.icon} /></span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate ${i === idx ? 'font-bold' : 'font-semibold'}`}>{r.title}</span>
              {r.path && <span className="block truncate text-sm text-muted">{r.path}</span>}
            </span>
            {i === idx && <span aria-hidden="true" className="shrink-0 text-xs font-semibold text-muted">Enter</span>}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[60]" onKeyDown={keys}>
      <div aria-hidden="true" className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div ref={box} role="dialog" aria-modal="true" aria-label={t(S.label, lang)}
        className="absolute inset-0 flex flex-col bg-surface md:inset-auto md:left-1/2 md:top-[10vh] md:max-h-[70vh] md:w-[40rem] md:max-w-[calc(100vw-2rem)] md:-translate-x-1/2 md:rounded-ui md:border md:border-soft md:shadow-xl">
        <div className="flex items-center gap-2 border-b border-soft p-3">
          <span aria-hidden="true" className="text-muted"><Icon name="search" /></span>
          <input autoFocus type="text" role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-label={t(S.label, lang)}
            aria-activedescendant={rows.length ? `${id}-o${idx}` : undefined} autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="go"
            className="input min-h-11 w-full" placeholder={t(S.placeholder, lang)} value={q} onChange={e => setQ(e.target.value)} />
          <button type="button" className="btn size-11 shrink-0 px-0" aria-label={t(S.close, lang)} onClick={onClose}><Icon name="close" /></button>
        </div>
        <div id={listId} role="listbox" aria-label={t(S.label, lang)} className="min-h-0 flex-1 overflow-y-auto pb-2">
          {term ? <>{group('fn', S.fns, 'f')}{group('rec', S.recs, 'r')}</> : group(null, S.recent, 'f')}
        </div>
        {!term && <p className="px-4 pb-3 text-sm text-muted">{t(S.try, lang)}</p>}
        {none && <p className="px-4 pb-3 text-sm">{t(S.none, lang)} '{term}'. {t(S.tryNone, lang)}</p>}
        <p className="hidden border-t border-soft px-4 py-2 text-xs text-muted md:block">{t(S.hints, lang)}</p>
        <p role="status" className="sr-only">{term && !loading ? (rows.length && !none ? `${rows.length} ${t(S.results, lang)}` : t(S.noRes, lang)) : ''}</p>
      </div>
    </div>
  )
}

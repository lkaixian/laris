import { useEffect, useRef, useState } from 'react'
import { tx } from './strings'
import type { ReactNode } from 'react'
import { TableRegion } from './ui'
import { Icon } from './icons'

// Shared building blocks for the page layouts (docs/ui-polish-spec.md section C). Flat panels, hairlines, no new colours.

// ---------- KPI tiles ----------
// One panel holding a row of tiles split by hairlines (gap-px over a hairline background). Each tile is one link; attention puts an amber dot before the label,
// the count text carries the meaning. A tile without href is plain text. `cols` overrides the grid-cols classes.
export function StatStrip({ label, cols = 'grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]', children }: { label: string; cols?: string; children: ReactNode }) {
  return (
    <section aria-label={label} className={`grid ${cols} overflow-hidden rounded-card border border-hairline bg-surface`}>{children}</section>
  )
}
export function StatTile({ title, value, href, hint, warn }: { title: string; value: number | string; href?: string; hint?: string; warn?: boolean }) {
  const Tag = href ? 'a' : 'div'
  return (
    <Tag href={href} className={`block min-h-[76px] p-3 shadow-[1px_0_0_var(--hairline),0_1px_0_var(--hairline)] ${href ? 'hover:bg-surface-2' : ''}`}>
      <span className="flex items-center gap-1.5 text-sm text-muted">{warn && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-amber" />}{title}</span>
      <span className="block text-xl font-semibold tabular-nums">{value}</span>
      {hint && <span className="block text-sm text-ink-2">{hint}</span>}
    </Tag>
  )
}

// ---------- data table ----------
// One column definition drives the desktop table and the phone cards. mobile: 'title' (line 1), 'badge' (line 1, right), 'sub' (line 2),
// 'meta' ("Label: value" pairs, keep to two), 'hide'. num = right aligned figures. The first column should be the link.
export interface Col<T> { key: string; head: string; cell: (row: T) => ReactNode; num?: boolean; mobile?: 'title' | 'badge' | 'sub' | 'meta' | 'hide'; className?: string }
export function DataTable<T>({ label, caption, rows, rowKey, cols, current, maxH = 'max-h-[70vh]' }: {
  label: string; caption: string; rows: T[]; rowKey: (r: T) => string; cols: Col<T>[]; current?: (r: T) => boolean; maxH?: string
}) {
  const m = (k: string) => cols.filter(c => (c.mobile ?? 'hide') === k)
  return (
    <>
      <div className="hidden md:block">
        <TableRegion label={label} className={`${maxH} [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10`}>
          <table className="w-full">
            <caption className="sr-only">{caption}</caption>
            <thead><tr>{cols.map(c => <th key={c.key} scope="col" className={c.num ? 'text-right' : ''}>{c.head}</th>)}</tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={rowKey(r)} aria-current={current?.(r) || undefined} className={current?.(r) ? 'shadow-[inset_3px_0_0_var(--accent)]' : ''}>
                  {cols.map((c, i) => <td key={c.key} className={`${c.num ? 'num whitespace-nowrap' : ''} ${i === 0 ? 'font-semibold text-ink [&_a]:no-underline [&_a]:hover:underline' : ''} ${c.className ?? ''}`}>{c.cell(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      </div>
      <ul className="grid gap-2 md:hidden">
        {rows.map(r => (
          <li key={rowKey(r)} className="card p-3" aria-current={current?.(r) || undefined}>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="min-w-0 break-words font-semibold">{m('title').map(c => <span key={c.key}>{c.cell(r)}</span>)}</span>
              {m('badge').map(c => <span key={c.key}>{c.cell(r)}</span>)}
            </div>
            {m('sub').map(c => <p key={c.key} className="text-sm">{c.cell(r)}</p>)}
            {m('meta').length > 0 && <dl className="mt-1 flex flex-wrap gap-x-4 text-sm text-muted">{m('meta').map(c => <div key={c.key} className="flex gap-1"><dt>{c.head}:</dt><dd className="tabular-nums">{c.cell(r)}</dd></div>)}</dl>}
          </li>
        ))}
      </ul>
    </>
  )
}

// ---------- filters ----------
export function FilterBar({ label, search, children, right, chips, onClear }: {
  label: string; search?: { value: string; onChange: (v: string) => void; label: string }; children?: ReactNode; right?: ReactNode
  chips?: { label: string; onRemove: () => void }[]; onClear?: () => void
}) {
  return (
    <div className="mb-4">
      <form role="search" aria-label={label} onSubmit={e => e.preventDefault()} className="flex flex-wrap items-center gap-2 rounded-card border border-hairline bg-surface-2 p-2">
        {search && <input type="search" className="input min-w-[220px] flex-1" maxLength={100} placeholder={search.label} aria-label={search.label} value={search.value} onChange={e => search.onChange(e.target.value)} />}
        {children}
        {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
      </form>
      {chips && chips.length > 0 && (
        <ul className="mt-2 flex flex-wrap items-center gap-2" aria-label={tx('common.activeFilters')}>
          {chips.map(c => (
            <li key={c.label}><button type="button" className="btn btn-sm gap-1 px-2 text-xs" aria-label={tx('common.removeFilter', c.label)} onClick={c.onRemove}>{c.label}<Icon name="close" className="size-3" /></button></li>
          ))}
          {onClear && <li><button type="button" className="link inline-flex min-h-(--control-h-sm) items-center text-sm" onClick={onClear}>{tx('common.clearAll')}</button></li>}
        </ul>
      )}
    </div>
  )
}
// A select with its name inside the control ("Stage: Any"); the name is also the accessible label.
export function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className="input flex max-w-full items-center gap-1 bg-surface py-0">
      <span className="shrink-0 text-muted">{label}:</span>
      <select className="min-w-0 max-w-full flex-1 bg-transparent py-1 font-medium text-ink" value={value} onChange={e => onChange(e.target.value)}>{children}</select>
    </label>
  )
}
export function ToggleChip({ pressed, onClick, children, warn }: { pressed: boolean; onClick: () => void; children: ReactNode; warn?: boolean }) {
  return <button type="button" aria-pressed={pressed} className={`btn gap-1 ${pressed ? 'bg-tint font-bold' : ''} ${warn ? 'border-warn text-warn' : ''}`} onClick={onClick}>{children}</button>
}
// Tab strip with an underline for the selected tab (and bold text: never colour alone). Counts are optional.
export function Tabs({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string; count?: number }[]; onChange: (v: string) => void }) {
  return (
    <div role="group" aria-label={label} className="mb-3 flex max-w-full gap-4 overflow-x-auto border-b border-hairline">
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          className={`-mb-px inline-flex min-h-(--control-h) shrink-0 items-center gap-1.5 border-b-2 px-1 text-sm hover:text-ink ${value === o.value ? 'border-accent font-semibold text-ink' : 'border-transparent text-muted'}`}>
          {o.label}{o.count != null && <span className="tabular-nums text-muted">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

// ---------- menu (disclosure, as in the user menu) ----------
// Children are menu rows: <a className="sidelink"> or <button className="sidelink w-full text-left">. Closes on Escape, outside click, focus leaving.
export function MoreMenu({ label = 'More', children, align = 'right' }: { label?: string; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    addEventListener('mousedown', down); addEventListener('keydown', key)
    return () => { removeEventListener('mousedown', down); removeEventListener('keydown', key) }
  }, [open])
  return (
    <div ref={box} className="relative" onBlur={e => { if (e.relatedTarget && !box.current?.contains(e.relatedTarget as Node)) setOpen(false) }} onClick={e => { if ((e.target as HTMLElement).closest('a,button[data-close]')) setOpen(false) }}>
      <button ref={btn} type="button" className="btn gap-1" aria-expanded={open} onClick={() => setOpen(!open)}>{label}<Icon name="down" className="size-4" /></button>
      {open && <div className={`card absolute top-full z-40 mt-1 grid w-56 gap-0.5 p-1 shadow-2 ${align === 'right' ? 'right-0' : 'left-0'}`}>{children}</div>}
    </div>
  )
}

// ---------- confirmation ----------
// Native <dialog>: focus trap, Escape and the inert page come from the browser, focus returns to the opener on close. Destructive: focus starts on Cancel.
export function ConfirmDialog({ open, title, body, confirmLabel, danger, onConfirm, onCancel }: {
  open: boolean; title: string; body: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) { d.showModal(); if (danger) cancel.current?.focus() }
    if (!open && d.open) d.close()
  }, [open, danger])
  return (
    <dialog ref={ref} aria-labelledby="cd-title" onCancel={e => { e.preventDefault(); onCancel() }} className="m-auto w-[calc(100%-2rem)] max-w-[440px] rounded-card bg-surface p-5 text-ink shadow-3 backdrop:bg-ink/50">
      <h2 id="cd-title" className="text-md font-semibold">{title}</h2>
      <div className="mt-2 text-base text-ink-2">{body}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button ref={cancel} type="button" className="btn" onClick={onCancel}>{tx('common.cancel')}</button>
        <button type="button" className={`btn ${danger ? 'btn-danger bg-warn-bg font-bold' : 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  )
}

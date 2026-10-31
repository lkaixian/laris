// Audit log tools: pick a date range, get a plain-words summary of it, download the FULL details (every change, before and after),
// or drop in any CSV / text / JSON file and get a summary of that. All numbers are counted from the entries or the file by fixed rules:
// nothing is guessed and nothing leaves the browser except the normal audit requests.
import { useState } from 'react'
import { api, can, why } from './api'
import { msg } from './ui'
import { t, useLang, locale } from './i18n'
import { useToast } from './Toast'

interface Entry { id: number; at: string; actor: string; entity: string; entity_id: string; event: string; action: string }
interface Full extends Entry { before: Record<string, unknown> | null; after: Record<string, unknown> | null }
const TZ = 'Asia/Kuala_Lumpur', CAP = 1000, DETAIL_CAP = CAP  // the full-details file covers every entry pulled (it used to stop at 300)
const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })

const S = {
  h: { en: 'Summary and full download', ms: 'Ringkasan dan muat turun penuh', zh: '摘要与完整下载', ta: 'சுருக்கமும் முழு பதிவிறக்கமும்' },
  lead: { en: 'Choose a date range. Get a summary, or download every detail of every change.', ms: 'Pilih julat tarikh. Dapatkan ringkasan, atau muat turun setiap butiran setiap perubahan.', zh: '选择日期范围，生成摘要，或下载每条变更的全部细节。', ta: 'தேதி வரம்பைத் தேர்ந்தெடுங்கள். சுருக்கம் பெறலாம், அல்லது ஒவ்வொரு மாற்றத்தின் முழு விவரத்தையும் பதிவிறக்கலாம்.' },
  from: { en: 'From', ms: 'Dari', zh: '从', ta: 'முதல்' }, to: { en: 'To', ms: 'Hingga', zh: '至', ta: 'வரை' },
  gen: { en: 'Generate summary', ms: 'Jana ringkasan', zh: '生成摘要', ta: 'சுருக்கம் உருவாக்கு' }, working: { en: 'Working…', ms: 'Sedang proses…', zh: '处理中…', ta: 'செயலில்…' },
  dlSum: { en: 'Download summary', ms: 'Muat turun ringkasan', zh: '下载摘要', ta: 'சுருக்கத்தைப் பதிவிறக்கு' },
  dlFull: { en: 'Download full details (CSV)', ms: 'Muat turun butiran penuh (CSV)', zh: '下载完整细节（CSV）', ta: 'முழு விவரங்கள் (CSV)' },
  file: { en: 'Summarise any file', ms: 'Ringkaskan mana-mana fail', zh: '为任意文件生成摘要', ta: 'எந்த கோப்பையும் சுருக்கு' },
  fileHint: { en: 'Choose a CSV, text or JSON file, for example one you downloaded from here.', ms: 'Pilih fail CSV, teks atau JSON, contohnya yang anda muat turun dari sini.', zh: '选择 CSV、文本或 JSON 文件，例如从这里下载的文件。', ta: 'CSV, உரை அல்லது JSON கோப்பைத் தேர்ந்தெடுங்கள்.' },
  none: { en: 'No entries in that range.', ms: 'Tiada entri dalam julat itu.', zh: '该范围内没有记录。', ta: 'அந்த வரம்பில் பதிவுகள் இல்லை.' },
  people: { en: 'Who did the most', ms: 'Siapa paling banyak', zh: '操作最多的人', ta: 'அதிகம் செய்தவர்கள்' }, mods: { en: 'Where it happened', ms: 'Di mana berlaku', zh: '发生在哪里', ta: 'எங்கே நடந்தது' },
  acts: { en: 'What kind of change', ms: 'Jenis perubahan', zh: '变更类型', ta: 'மாற்ற வகை' }, days: { en: 'Entries per day', ms: 'Entri setiap hari', zh: '每天记录数', ta: 'நாளுக்கு பதிவுகள்' },
  capped: { en: (n: number) => `Showing the first ${n}. Narrow the dates to see the rest.`, ms: (n: number) => `Menunjukkan ${n} pertama. Sempitkan tarikh untuk selebihnya.`, zh: (n: number) => `仅显示前 ${n} 条，请缩小日期范围查看其余。`, ta: (n: number) => `முதல் ${n} மட்டும். மீதியைக் காண தேதியைக் குறையுங்கள்.` },
  note: { en: 'Counted from the log by fixed rules. Nothing is guessed.', ms: 'Dikira daripada log mengikut peraturan tetap. Tiada andaian.', zh: '按固定规则从日志统计，不做猜测。', ta: 'நிலையான விதிகளின்படி பதிவிலிருந்து கணக்கிடப்பட்டது; ஊகம் இல்லை.' },
  needExport: { en: 'Downloads need export permission.', ms: 'Muat turun memerlukan kebenaran eksport.', zh: '下载需要导出权限。', ta: 'பதிவிறக்கத்திற்கு ஏற்றுமதி அனுமதி தேவை.' },
  rows: { en: 'rows', ms: 'baris', zh: '行', ta: 'வரிகள்' }, cols: { en: 'columns', ms: 'lajur', zh: '列', ta: 'நெடுவரிசைகள்' },
}
const act: Record<string, Record<string, string>> = { created: { en: 'created', ms: 'dibuat', zh: '新建', ta: 'உருவாக்கம்' }, status: { en: 'status change', ms: 'tukar status', zh: '状态变更', ta: 'நிலை மாற்றம்' }, other: { en: 'other', ms: 'lain-lain', zh: '其他', ta: 'மற்றவை' } }
const top = (m: Map<string, number>, n = 5) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
const count = (xs: string[]) => { const m = new Map<string, number>(); xs.forEach(x => m.set(x, (m.get(x) ?? 0) + 1)); return m }
const save = (name: string, body: string, type: string) => { const u = URL.createObjectURL(new Blob(['﻿' + body], { type })), a = document.createElement('a'); a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u) }
const csv = (v: unknown) => { const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

function Bars({ rows }: { rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map(r => r[1]))
  return <ul className="rep-bars">{rows.map(([k, v]) => <li key={k}><span className="rep-bl">{k}</span><span className="rep-bt"><i style={{ width: `${Math.max(3, v / max * 100)}%` }} /></span><b>{v}</b></li>)}</ul>
}

// Plain-words paragraph from the counts (rules, no AI).
function words(es: Entry[], lang: 'en' | 'ms' | 'zh' | 'ta', a: string, b: string) {
  const days = count(es.map(e => day(e.at))), who = top(count(es.map(e => e.actor)), 1)[0], mod = top(count(es.map(e => e.entity)), 1)[0], busy = top(days, 1)[0]
  const made = es.filter(e => e.action === 'created').length, moved = es.filter(e => e.action === 'status').length
  const rng = a && b ? `${a} → ${b}` : a || b || ''
  return {
    en: `${rng ? rng + ': ' : ''}${es.length} entries over ${days.size} day${days.size === 1 ? '' : 's'}. ${made} created, ${moved} status changes. Most active: ${who[0]} (${who[1]}). Most activity in ${mod[0].replace(/_/g, ' ')} (${mod[1]}). Busiest day: ${busy[0]} (${busy[1]}).`,
    ms: `${rng ? rng + ': ' : ''}${es.length} entri dalam ${days.size} hari. ${made} dibuat, ${moved} tukar status. Paling aktif: ${who[0]} (${who[1]}). Paling banyak di ${mod[0].replace(/_/g, ' ')} (${mod[1]}). Hari tersibuk: ${busy[0]} (${busy[1]}).`,
    zh: `${rng ? rng + '：' : ''}${days.size} 天内共 ${es.length} 条记录，其中新建 ${made} 条、状态变更 ${moved} 条。最活跃：${who[0]}（${who[1]}）。最多集中在 ${mod[0].replace(/_/g, ' ')}（${mod[1]}）。最忙的一天：${busy[0]}（${busy[1]}）。`,
    ta: `${rng ? rng + ': ' : ''}${days.size} நாட்களில் ${es.length} பதிவுகள். ${made} உருவாக்கம், ${moved} நிலை மாற்றங்கள். அதிகம் செயல்பட்டவர்: ${who[0]} (${who[1]}). அதிக செயல்பாடு ${mod[0].replace(/_/g, ' ')} (${mod[1]}). பரபரப்பான நாள்: ${busy[0]} (${busy[1]}).`,
  }[lang]
}

function profile(name: string, text: string, lang: 'en' | 'ms' | 'zh' | 'ta') {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim())
  const parse = (l: string) => { const o: string[] = []; let c = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { c += '"'; i++ } else if (ch === '"') q = false; else c += ch } else if (ch === '"') q = true; else if (ch === ',') { o.push(c); c = '' } else c += ch } o.push(c); return o }
  const head = lines[0] ? parse(lines[0]) : [], isCsv = head.length > 1 && lines.length > 1
  if (!isCsv) return { title: name, facts: [`${lines.length} ${t(S.rows)}`, `${text.length.toLocaleString(locale())} characters`], cols: [] as { name: string; top: [string, number][] }[] }
  const rows = lines.slice(1).map(parse), cols = head.map((h, i) => {
    const vals = rows.map(r => (r[i] ?? '').trim()).filter(Boolean), m = count(vals)
    return { name: h, top: m.size <= 12 && m.size > 0 ? top(m, 5) : [] as [string, number][], dates: vals.filter(v => /^\d{4}-\d{2}-\d{2}/.test(v)).map(v => v.slice(0, 10)).sort() }
  })
  const dc = cols.find(c => c.dates.length > 1), facts = [`${rows.length} ${t(S.rows)}`, `${head.length} ${t(S.cols)}`, ...(dc ? [`${dc.dates[0]} → ${dc.dates[dc.dates.length - 1]}`] : [])]
  void lang
  return { title: name, facts, cols: cols.filter(c => c.top.length).slice(0, 4).map(c => ({ name: c.name, top: c.top })) }
}

export function AuditTools({ people, module, action, q }: { people: string; module: string; action: string; q: string }) {
  useLang()
  const toast = useToast()
  const lang = (document.documentElement.lang || 'en').slice(0, 2) as 'en' | 'ms' | 'zh' | 'ta'
  const L = (['en', 'ms', 'zh', 'ta'].includes(lang) ? lang : 'en') as 'en' | 'ms' | 'zh' | 'ta'
  const [a, setA] = useState(''), [b, setB] = useState(''), [busy, setBusy] = useState(''), [err, setErr] = useState('')
  const [es, setEs] = useState<Entry[]>(), [more, setMore] = useState(false), [fp, setFp] = useState<ReturnType<typeof profile>>()
  const ok = can('export_data')
  const query = () => { const p = new URLSearchParams({ limit: String(CAP) }); if (a) p.set('from', a); if (b) p.set('to', b); if (people) p.set('actor', people); if (module) p.set('module', module); if (action) p.set('action', action); if (q) p.set('q', q); return p.toString() }

  const gen = async () => {
    setBusy('gen'); setErr('')
    try { const r = await api<{ items: Entry[]; has_more: boolean }>('GET', `/audit/search?${query()}`); setEs(r.items); setMore(r.has_more) } catch (e) { setErr(msg(e)) } finally { setBusy('') }
  }
  const summaryText = () => {
    if (!es?.length) return ''
    const mods = top(count(es.map(e => e.entity)), 8), ppl = top(count(es.map(e => e.actor)), 8), acts = top(count(es.map(e => act[e.action]?.[L] ?? e.action)))
    return [`# ${t(S.h)}`, '', words(es, L, a, b), '', `## ${t(S.people)}`, ...ppl.map(([k, v]) => `- ${k}: ${v}`), '', `## ${t(S.mods)}`, ...mods.map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}`), '', `## ${t(S.acts)}`, ...acts.map(([k, v]) => `- ${k}: ${v}`), '', `_${t(S.note)}_`].join('\n')
  }
  const full = async () => {
    if (!es?.length) return
    setBusy('full'); setErr('')
    try {
      const ids = es.slice(0, DETAIL_CAP).map(e => e.id), got: Full[] = []
      for (let i = 0; i < ids.length; i += 16) got.push(...await Promise.all(ids.slice(i, i + 16).map(id => api<Full>('GET', `/audit/${id}`))))
      const head = ['id', 'time (Malaysia)', 'who', 'module', 'record', 'action', 'event', 'field', 'before', 'after'], out = [head.join(',')]
      for (const e of got) {
        const keys = [...new Set([...Object.keys(e.before ?? {}), ...Object.keys(e.after ?? {})])]
        const base = [e.id, new Date(e.at).toLocaleString('en-GB', { timeZone: TZ }), e.actor, e.entity, e.entity_id, e.action, e.event]
        if (!keys.length) out.push([...base, '', '', ''].map(csv).join(','))
        else keys.forEach(k => out.push([...base, k, e.before?.[k], e.after?.[k]].map(csv).join(',')))
      }
      save(`audit-log-full-${a || 'start'}-to-${b || 'now'}.csv`, out.join('\n'), 'text/csv'); toast(`CSV · ${got.length}`)
    } catch (e) { setErr(msg(e)) } finally { setBusy('') }
  }
  const pick = async (f?: File) => { if (!f) return; setErr(''); try { setFp(profile(f.name, await f.text(), L)) } catch (e) { setErr(msg(e)) } }

  return (
    <section className="card rep-tools" aria-labelledby="audtools-h" data-guide="act-tools">
      <h2 id="audtools-h" className="text-md font-semibold">{t(S.h)}</h2>
      <p className="text-sm text-muted">{t(S.lead)}</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="input flex items-center gap-1 bg-surface py-0"><span className="text-muted">{t(S.from)}:</span><input type="date" className="min-w-0 bg-transparent py-1 font-medium text-ink" value={a} max={b || undefined} onChange={e => setA(e.target.value)} /></label>
        <label className="input flex items-center gap-1 bg-surface py-0"><span className="text-muted">{t(S.to)}:</span><input type="date" className="min-w-0 bg-transparent py-1 font-medium text-ink" value={b} min={a || undefined} onChange={e => setB(e.target.value)} /></label>
        <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void gen()}>{busy === 'gen' ? t(S.working) : t(S.gen)}</button>
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-warn">{err}</p>}
      {es && (es.length === 0 ? <p className="mt-3 text-sm text-muted">{t(S.none)}</p> : <div className="mt-3 grid gap-3">
        <p className="rep-sum" aria-live="polite">{words(es, L, a, b)}</p>
        <div className="rep-cols">
          <div><h3 className="rep-h">{t(S.people)}</h3><Bars rows={top(count(es.map(e => e.actor)))} /></div>
          <div><h3 className="rep-h">{t(S.mods)}</h3><Bars rows={top(count(es.map(e => e.entity.replace(/_/g, ' '))))} /></div>
          <div><h3 className="rep-h">{t(S.acts)}</h3><Bars rows={top(count(es.map(e => act[e.action]?.[L] ?? e.action)))} /></div>
          <div><h3 className="rep-h">{t(S.days)}</h3><Bars rows={[...count(es.map(e => day(e.at)))].sort().slice(-7)} /></div>
        </div>
        {more && <p className="text-sm text-muted">{S.capped[L](CAP)}</p>}
        <p className="text-xs text-muted">{t(S.note)}</p>
        <div className="flex flex-wrap gap-2">{ok ? <>
          <button type="button" className="btn" onClick={() => save(`audit-summary-${a || 'start'}-to-${b || 'now'}.md`, summaryText(), 'text/markdown')}>{t(S.dlSum)}</button>
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void full()}>{busy === 'full' ? t(S.working) : t(S.dlFull)}</button>
        </> : <span className="text-sm text-muted">{t(S.needExport)} {why('export_data')}</span>}</div>
      </div>)}
      <hr className="my-4 border-hairline" />
      <h3 className="rep-h">{t(S.file)}</h3>
      <p className="text-sm text-muted">{t(S.fileHint)}</p>
      <input type="file" accept=".csv,.txt,.json,.md,text/*" className="mt-2 text-sm" aria-label={t(S.file)} onChange={e => void pick(e.target.files?.[0])} />
      {fp && <div className="mt-3 grid gap-2"><p className="font-semibold break-all">{fp.title}</p><p className="rep-sum">{fp.facts.join(' · ')}</p>
        <div className="rep-cols">{fp.cols.map(c => <div key={c.name}><h3 className="rep-h">{c.name}</h3><Bars rows={c.top} /></div>)}</div></div>}
    </section>
  )
}

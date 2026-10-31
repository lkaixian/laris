import { useRef, useState } from 'react'
import { api, fileBlob } from './api'
import { t, useLang } from './i18n'
import { Async, PageHeader, msg, useFetch } from './ui'
import { useToast } from './Toast'
import { STAGES, STAGE_NAME } from './Customers'
import type { Stage } from './Customers'

// Admin > Document templates: the owner uploads a Word (.docx) file for any customer document, with {{placeholders}} where LARIS should fill in the
// figures. Customers > any document then returns that file filled in; without a template LARIS uses its standard layout.
// GET /api/settings/doc-templates, PUT/DELETE .../{stage}, GET .../{stage}/starter (src/api/customers.py). Owner only.
interface Info { stage: Stage; filename: string | null; uploaded_at: string | null; size: number | null }
interface Result { filename: string; placeholders: string[]; unknown: string[]; warnings: string[] }
const T = {
  title: { en: 'Document templates', ms: 'Templat dokumen', zh: '文件模板', ta: 'ஆவண வார்ப்புருக்கள்' },
  desc: { en: 'Already have your own purchase order, invoice or receipt in Word? Upload it here and LARIS fills it in for every customer. No template? LARIS uses its standard layout.',
    ms: 'Sudah ada pesanan belian, invois atau resit anda dalam Word? Muat naik di sini dan LARIS mengisinya untuk setiap pelanggan. Tiada templat? LARIS guna reka letak standard.',
    zh: '已经有自己的 Word 版采购订单、发票或收据？在这里上传，LARIS 会为每位客户填好。没有模板？LARIS 使用标准版式。',
    ta: 'Word-ல் உங்கள் சொந்த கொள்முதல் ஆணை, இன்வாய்ஸ் அல்லது ரசீது உள்ளதா? இங்கே பதிவேற்றுங்கள்; ஒவ்வொரு வாடிக்கையாளருக்கும் LARIS நிரப்பும். வார்ப்புரு இல்லையா? LARIS நிலையான அமைப்பைப் பயன்படுத்தும்.' },
  using: { en: 'Your template', ms: 'Templat anda', zh: '你的模板', ta: 'உங்கள் வார்ப்புரு' }, standard: { en: 'Standard layout', ms: 'Reka letak standard', zh: '标准版式', ta: 'நிலையான அமைப்பு' },
  upload: { en: 'Upload .docx', ms: 'Muat naik .docx', zh: '上传 .docx', ta: '.docx பதிவேற்று' }, replace: { en: 'Replace', ms: 'Ganti', zh: '替换', ta: 'மாற்று' },
  remove: { en: 'Remove', ms: 'Buang', zh: '删除', ta: 'நீக்கு' }, starter: { en: 'Get a starter file', ms: 'Dapatkan fail permulaan', zh: '下载示例文件', ta: 'தொடக்கக் கோப்பைப் பெறு' },
  saved: { en: 'Template saved', ms: 'Templat disimpan', zh: '模板已保存', ta: 'வார்ப்புரு சேமிக்கப்பட்டது' }, removed: { en: 'Template removed', ms: 'Templat dibuang', zh: '模板已删除', ta: 'வார்ப்புரு நீக்கப்பட்டது' },
  how: { en: 'How it works', ms: 'Cara ia berfungsi', zh: '使用方法', ta: 'இது எப்படி வேலை செய்கிறது' },
  how1: { en: 'Get the starter file, open it in Word and make it look like your own paper. Keep the {{words in double braces}}: LARIS replaces them.',
    ms: 'Dapatkan fail permulaan, buka dalam Word dan ubah supaya sama dengan kertas anda. Kekalkan {{perkataan dalam kurungan berganda}}: LARIS menggantikannya.',
    zh: '下载示例文件，用 Word 打开并改成你自己的样式。请保留 {{双大括号里的词}}，LARIS 会把它们替换成实际内容。',
    ta: 'தொடக்கக் கோப்பைப் பெற்று Word-ல் திறந்து உங்கள் தாள் போல மாற்றுங்கள். {{இரட்டை அடைப்புக்குள் உள்ள சொற்களை}} வைத்திருங்கள்: LARIS அவற்றை மாற்றும்.' },
  how2: { en: 'The table row with {{line.description}} repeats for every item. Upload the file back here. Plain .docx only: no macros.',
    ms: 'Baris jadual dengan {{line.description}} berulang untuk setiap item. Muat naik semula fail di sini. .docx biasa sahaja: tiada makro.',
    zh: '含有 {{line.description}} 的表格行会为每个项目重复一次。改好后在这里上传。只接受普通 .docx，不能含宏。',
    ta: '{{line.description}} உள்ள அட்டவணை வரி ஒவ்வொரு பொருளுக்கும் மீண்டும் வரும். கோப்பை இங்கே பதிவேற்றுங்கள். சாதாரண .docx மட்டும்: மேக்ரோ கூடாது.' },
  fields: { en: 'Words LARIS can fill in', ms: 'Perkataan yang LARIS boleh isi', zh: 'LARIS 可以填写的内容', ta: 'LARIS நிரப்பக்கூடிய சொற்கள்' },
  check: { en: 'Please check', ms: 'Sila semak', zh: '请检查', ta: 'சரிபார்க்கவும்' },
  sure: { en: 'Remove this template? Files go back to the standard layout.', ms: 'Buang templat ini? Fail kembali kepada reka letak standard.', zh: '删除这个模板？之后将使用标准版式。', ta: 'இந்த வார்ப்புருவை நீக்கவா? கோப்புகள் நிலையான அமைப்புக்குத் திரும்பும்.' },
}
const save = (b: Blob, name: string) => { const url = URL.createObjectURL(b), a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url) }

export function TemplatesView({ owner }: { owner: boolean }) {
  useLang()
  const toast = useToast()
  const s = useFetch<{ stages: Info[]; fields: { name: string; help: string }[] }>(owner ? '/settings/doc-templates' : null)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState<Partial<Record<Stage, Result>>>({})
  const pick = useRef<HTMLInputElement>(null)
  const target = useRef<Stage>('invoice')
  const send = async (file: File) => {
    const st = target.current
    setBusy(st)
    try {
      const f = new FormData(); f.append('file', file)
      const r = await api<Result>('PUT', `/settings/doc-templates/${st}`, f)
      setNote(n => ({ ...n, [st]: r })); toast(t(T.saved)); s.reload()
    } catch (e) { toast(msg(e)) } finally { setBusy(''); if (pick.current) pick.current.value = '' }
  }
  const drop = async (st: Stage) => {
    if (!window.confirm(t(T.sure))) return
    setBusy(st)
    try { await api('DELETE', `/settings/doc-templates/${st}`); setNote(n => ({ ...n, [st]: undefined })); toast(t(T.removed)); s.reload() } catch (e) { toast(msg(e)) } finally { setBusy('') }
  }
  const starter = async (st: Stage) => { try { save(await fileBlob(`/settings/doc-templates/${st}/starter`), `${st}-template.docx`) } catch (e) { toast(msg(e)) } }
  const by = Object.fromEntries((s.data?.stages ?? []).map(i => [i.stage, i])) as Partial<Record<Stage, Info>>
  return (
    <>
      <PageHeader title={t(T.title)} description={t(T.desc)} />
      <input ref={pick} type="file" hidden accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e => { const f = e.target.files?.[0]; if (f) void send(f) }} />
      <Async s={s} empty={!s.data}>
        <ul className="grid gap-3" data-guide="templates-list">
          {STAGES.map(st => {
            const i = by[st], r = note[st]
            return (
              <li key={st} className="card grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><h2 className="text-base font-semibold">{t(STAGE_NAME[st])}</h2>
                    <p className="text-sm text-muted">{i?.filename ? <>{t(T.using)}: <strong>{i.filename}</strong> ({(i.uploaded_at ?? '').slice(0, 10)})</> : t(T.standard)}</p></div>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-sm" onClick={() => void starter(st)}>{t(T.starter)}</button>
                    <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => { target.current = st; pick.current?.click() }}>{busy === st ? '…' : i?.filename ? t(T.replace) : t(T.upload)}</button>
                    {i?.filename && <button className="btn btn-sm btn-danger" disabled={!!busy} onClick={() => void drop(st)}>{t(T.remove)}</button>}
                  </div>
                </div>
                {r && r.warnings.length > 0 && <div role="status" className="rounded-ui border border-hairline p-2 text-sm"><strong>{t(T.check)}</strong><ul className="list-disc pl-5">{r.warnings.map(w => <li key={w}>{w}</li>)}</ul></div>}
              </li>
            )
          })}
        </ul>
        <section className="card mt-4 grid gap-2" aria-label={t(T.how)}>
          <h2 className="text-base font-semibold">{t(T.how)}</h2>
          <p className="text-sm">{t(T.how1)}</p><p className="text-sm">{t(T.how2)}</p>
          <details><summary className="cursor-pointer text-sm font-semibold">{t(T.fields)}</summary>
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
              {(s.data?.fields ?? []).map(f => <div key={f.name} className="contents"><dt><code>{`{{${f.name}}}`}</code></dt><dd className="text-muted">{f.help}</dd></div>)}
            </dl></details>
        </section>
      </Async>
    </>
  )
}

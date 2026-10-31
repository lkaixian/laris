import { useState } from 'react'
import { fileBlob } from './api'
import { t, useLang } from './i18n'
import type { Text } from './i18n'
import { Async, PageHeader, Status, msg, rm, useFetch } from './ui'
import { DataTable } from './kit'
import { useToast } from './Toast'
import { NewDoc } from './Deals'
import { useSector } from './sectorPacks'

// Customers: one line of six steps, from the customer's purchase order to your receipt, with how many documents sit in each and how many need you.
// Pick a step to see its documents and get any of them as a file: filled into the owner's own Word template (Admin > Document templates) when there is
// one, else LARIS's standard layout. GET /api/customers/flow, /docs and /{stage}/{id}/file (src/api/customers.py). Preparation only; nothing is sent.
export type Stage = 'purchase_order' | 'sales_order' | 'proforma' | 'delivery_order' | 'invoice' | 'receipt'
export const STAGES: Stage[] = ['purchase_order', 'sales_order', 'proforma', 'delivery_order', 'invoice', 'receipt']
interface FlowStage { stage: Stage; count: number; attention: number; template: { filename: string; uploaded_at: string } | null }
interface Row { id: string; doc_no: string; status: string; total: string; made_at: string; job_id: string | null; ref: string | null; customer: string | null; stage: Stage }

export const STAGE_NAME: Record<Stage, Text> = {
  purchase_order: { en: 'Purchase order', ms: 'Pesanan belian', zh: '采购订单', ta: 'கொள்முதல் ஆணை' },
  sales_order: { en: 'Sales order', ms: 'Pesanan jualan', zh: '销售订单', ta: 'விற்பனை ஆணை' },
  proforma: { en: 'Proforma invoice', ms: 'Invois proforma', zh: '形式发票', ta: 'புரோஃபார்மா இன்வாய்ஸ்' },
  delivery_order: { en: 'Delivery order', ms: 'Pesanan penghantaran', zh: '送货单', ta: 'டெலிவரி ஆணை' },
  invoice: { en: 'Invoice', ms: 'Invois', zh: '发票', ta: 'இன்வாய்ஸ்' },
  receipt: { en: 'Receipt', ms: 'Resit', zh: '收据', ta: 'ரசீது' },
}
const WHAT: Record<Stage, Text> = {
  purchase_order: { en: 'The order your customer sent you.', ms: 'Pesanan yang pelanggan hantar kepada anda.', zh: '客户发给你的订单。', ta: 'வாடிக்கையாளர் உங்களுக்கு அனுப்பிய ஆர்டர்.' },
  sales_order: { en: 'Your confirmation of that order.', ms: 'Pengesahan anda untuk pesanan itu.', zh: '你对该订单的确认。', ta: 'அந்த ஆர்டருக்கான உங்கள் உறுதிப்படுத்தல்.' },
  proforma: { en: 'Asks for the deposit before you start.', ms: 'Meminta deposit sebelum anda mula.', zh: '开工前请客户付订金。', ta: 'தொடங்கும் முன் முன்பணம் கேட்கிறது.' },
  delivery_order: { en: 'Goods sent. The customer signs on their phone.', ms: 'Barang dihantar. Pelanggan menandatangani pada telefon.', zh: '货物已送出，客户在手机上签收。', ta: 'பொருட்கள் அனுப்பப்பட்டன. வாடிக்கையாளர் தொலைபேசியில் கையொப்பமிடுவார்.' },
  invoice: { en: 'The bill for what is left to pay.', ms: 'Bil untuk baki yang perlu dibayar.', zh: '余款的账单。', ta: 'மீதமுள்ள தொகைக்கான பில்.' },
  receipt: { en: 'Proof of each payment you recorded.', ms: 'Bukti setiap bayaran yang anda rekodkan.', zh: '你记录的每笔付款的凭证。', ta: 'நீங்கள் பதிவு செய்த ஒவ்வொரு கட்டணத்தின் சான்று.' },
}
const FROM_ORDER = new Set<Stage>(['proforma', 'delivery_order', 'invoice', 'receipt'])
const NEW_KIND: Partial<Record<Stage, 'cpo' | 'so'>> = { purchase_order: 'cpo', sales_order: 'so' }
const C = {
  title: { en: 'Customers', ms: 'Pelanggan', zh: '客户', ta: 'வாடிக்கையாளர்கள்' },
  desc: { en: 'From their order to your receipt. Pick a step to see its documents.', ms: 'Daripada pesanan mereka hingga resit anda. Pilih satu langkah untuk melihat dokumennya.', zh: '从客户下单到你开出收据。选一个步骤查看文件。', ta: 'அவர்களின் ஆர்டர் முதல் உங்கள் ரசீது வரை. ஒரு படியைத் தேர்ந்தெடுத்து ஆவணங்களைக் காண்க.' },
  flow: { en: 'Customer document steps', ms: 'Langkah dokumen pelanggan', zh: '客户文件步骤', ta: 'வாடிக்கையாளர் ஆவணப் படிகள்' },
  needs: { en: 'need you', ms: 'perlu anda', zh: '待处理', ta: 'உங்கள் கவனம் தேவை' },
  none: { en: 'Nothing here yet', ms: 'Belum ada apa-apa', zh: '这里还没有文件', ta: 'இன்னும் எதுவும் இல்லை' },
  fromOrder: { en: 'These are made on an order, in one click. Open an order to start.', ms: 'Ini dibuat pada pesanan, dengan satu klik. Buka pesanan untuk bermula.', zh: '这些文件在订单页面一键生成。打开订单即可开始。', ta: 'இவை ஆர்டர் பக்கத்தில் ஒரே கிளிக்கில் உருவாக்கப்படும். தொடங்க ஆர்டரைத் திறக்கவும்.' },
  orders: { en: 'Open orders', ms: 'Buka pesanan', zh: '打开订单', ta: 'ஆர்டர்களைத் திற' },
  add: { en: 'New', ms: 'Baru', zh: '新建', ta: 'புதியது' }, close: { en: 'Close', ms: 'Tutup', zh: '关闭', ta: 'மூடு' },
  doc: { en: 'Document', ms: 'Dokumen', zh: '文件', ta: 'ஆவணம்' }, who: { en: 'Customer', ms: 'Pelanggan', zh: '客户', ta: 'வாடிக்கையாளர்' },
  st: { en: 'Status', ms: 'Status', zh: '状态', ta: 'நிலை' }, total: { en: 'Total', ms: 'Jumlah', zh: '总计', ta: 'மொத்தம்' }, on: { en: 'Date', ms: 'Tarikh', zh: '日期', ta: 'தேதி' },
  get: { en: 'Get file', ms: 'Dapatkan fail', zh: '获取文件', ta: 'கோப்பைப் பெறு' }, pdf: { en: 'Standard PDF', ms: 'PDF standard', zh: '标准 PDF', ta: 'நிலையான PDF' },
  order: { en: 'Open order', ms: 'Buka pesanan', zh: '打开订单', ta: 'ஆர்டரைத் திற' },
  ref: { en: 'Their PO', ms: 'PO mereka', zh: '对方采购单', ta: 'அவர்களின் PO' },
  usingOwn: { en: 'Files use your template', ms: 'Fail menggunakan templat anda', zh: '文件使用你的模板', ta: 'கோப்புகள் உங்கள் வார்ப்புருவைப் பயன்படுத்துகின்றன' },
  usingStd: { en: 'No template uploaded: LARIS makes the file in its standard layout.', ms: 'Tiada templat dimuat naik: LARIS membuat fail dengan reka letak standard.', zh: '尚未上传模板：LARIS 使用标准版式生成文件。', ta: 'வார்ப்புரு பதிவேற்றப்படவில்லை: LARIS நிலையான அமைப்பில் கோப்பை உருவாக்குகிறது.' },
  change: { en: 'Change in Admin', ms: 'Tukar di Admin', zh: '在管理页更改', ta: 'நிர்வாகத்தில் மாற்று' }, upload: { en: 'Upload your own template', ms: 'Muat naik templat anda', zh: '上传你自己的模板', ta: 'உங்கள் வார்ப்புருவைப் பதிவேற்று' },
  made: { en: '{0} file ready', ms: 'Fail {0} sedia', zh: '{0}文件已生成', ta: '{0} கோப்பு தயார்' },
  word: { en: 'Word', ms: 'Word', zh: 'Word', ta: 'Word' }, std: { en: 'PDF', ms: 'PDF', zh: 'PDF', ta: 'PDF' },
}

// Save a blob under a name; the extension follows what the server sent (a filled-in .docx, or the standard .pdf).
function save(b: Blob, base: string) {
  const ext = b.type.includes('wordprocessingml') ? 'docx' : 'pdf'
  const url = URL.createObjectURL(b), a = document.createElement('a')
  a.href = url; a.download = `${base.replace(/[^\w.-]+/g, '_')}.${ext}`; a.click()
  URL.revokeObjectURL(url)
  return ext
}

export function CustomersView({ owner, arg }: { owner: boolean; arg?: string }) {
  useLang()
  const toast = useToast()
  const [pack] = useSector()
  const flow = useFetch<{ stages: FlowStage[] }>('/customers/flow')
  const stage: Stage = (STAGES as string[]).includes(arg ?? '') ? (arg as Stage) : 'purchase_order'
  const docs = useFetch<Row[]>(`/customers/docs?stage=${stage}&limit=100`)
  const orders = useFetch<{ id: string; label: string; customer: string | null; total: string | null; status: 'todo' | 'doing' | 'done' }[]>('/jobs?limit=100')
  const open = (orders.data ?? []).filter(o => o.status !== 'done')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState('')
  const by = Object.fromEntries((flow.data?.stages ?? []).map(s => [s.stage, s])) as Partial<Record<Stage, FlowStage>>
  const here = by[stage]
  const get = async (d: Row, pdf: boolean) => {
    setBusy(d.id + (pdf ? 'p' : ''))
    try { const ext = save(await fileBlob(`/customers/${stage}/${d.id}/file${pdf ? '?format=pdf' : ''}`), d.doc_no); toast(t(C.made).replace('{0}', ext === 'docx' ? t(C.word) : t(C.std))) }
    catch (e) { toast(msg(e)) } finally { setBusy('') }
  }
  const kind = NEW_KIND[stage]
  return (
    <>
      <PageHeader title={t(C.title)} description={t(C.desc)}
        actions={kind ? <button className="btn btn-primary" onClick={() => setAdding(a => !a)}>{adding ? t(C.close) : `${t(C.add)}: ${t(STAGE_NAME[stage])}`}</button> : undefined} />
      {open.length > 0 && <section aria-label={t(C.orders)} className="card mb-4 grid gap-2" data-guide="customers-orders"><h2 className="text-lg font-semibold">{t(C.orders)}</h2>
        <ul className="grid gap-1 text-sm">{open.map(o => <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <a className="font-semibold" href={`#/deals/${o.id}`}>{o.label}</a><span className="text-muted">{o.customer ?? ''}</span><span className="tabular-nums">{rm(o.total)}</span>
          <span className="chip">{t(o.status === 'doing' ? { en: 'In progress', ms: 'Sedang berjalan', zh: '进行中', ta: 'நடந்து கொண்டிருக்கிறது' } : { en: 'To do', ms: 'Untuk dibuat', zh: '待办', ta: 'செய்ய' })}</span></li>)}</ul></section>}
      <nav aria-label={t(C.flow)} className="mb-4 overflow-x-auto" data-guide="customers-flow">
        <ol className="flex min-w-max items-stretch gap-1">
          {STAGES.map((s, i) => {
            const f = by[s], on = s === stage
            return (
              <li key={s} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden="true" className="text-muted">&rarr;</span>}
                <a href={`#/customers/${s}`} aria-current={on ? 'step' : undefined}
                  className={`grid min-w-28 gap-0.5 rounded-ui border px-3 py-2 text-sm no-underline ${on ? 'border-accent bg-tint' : 'border-hairline hover:border-accent'}`}>
                  <span>{t(STAGE_NAME[s])}</span>
                  <span className="text-2xl font-semibold tabular-nums">{f ? f.count : '-'}</span>
                  {!!f?.attention && <span className="chip chip-warn text-xs">{f.attention} {t(C.needs)}</span>}
                </a>
              </li>
            )
          })}
        </ol>
      </nav>
      <section aria-label={t(STAGE_NAME[stage])} className="grid gap-3" data-guide="customers-docs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-lg font-semibold">{t(STAGE_NAME[stage])}</h2><p className="text-sm text-muted">{t(WHAT[stage])}</p></div>
          {here && <p className="text-sm text-muted" data-guide="customers-template">
            {here.template ? <>{t(C.usingOwn)}: <strong>{here.template.filename}</strong></> : t(C.usingStd)}
            {owner && <> <a className="link" href="#/templates">{here.template ? t(C.change) : t(C.upload)}</a></>}</p>}
        </div>
        {adding && kind && <NewDoc pack={pack} only={[kind]} onDone={() => { setAdding(false); docs.reload(); flow.reload() }} />}
        <Async s={docs} empty={(docs.data ?? []).length === 0} emptyText={t(C.none)} emptyHint={FROM_ORDER.has(stage) ? t(C.fromOrder) : undefined}
          emptyAction={FROM_ORDER.has(stage) ? { label: t(C.orders), href: '#/jobs' } : undefined}>
          <DataTable label={t(STAGE_NAME[stage])} caption={t(STAGE_NAME[stage])} rows={docs.data ?? []} rowKey={d => d.id} cols={[
            { key: 'no', head: t(C.doc), mobile: 'title', cell: d => <>{d.doc_no}{d.ref && <span className="block text-xs text-muted">{t(C.ref)}: {d.ref}</span>}</> },
            { key: 'who', head: t(C.who), mobile: 'sub', cell: d => d.customer ?? '' },
            { key: 'on', head: t(C.on), mobile: 'meta', cell: d => d.made_at.slice(0, 10) },
            { key: 'st', head: t(C.st), mobile: 'badge', cell: d => <Status v={d.status} /> },
            { key: 'tot', head: t(C.total), num: true, mobile: 'meta', cell: d => rm(d.total) },
            { key: 'go', head: '', mobile: 'meta', cell: d => (
              <span className="flex flex-wrap items-center justify-end gap-2">
                <button className="btn btn-sm" disabled={!!busy} onClick={() => void get(d, false)}>{busy === d.id ? '…' : t(C.get)}</button>
                {here?.template && <button className="btn btn-sm" disabled={!!busy} onClick={() => void get(d, true)}>{t(C.pdf)}</button>}
                {d.job_id && <a className="link text-sm" href={`#/deals/${d.job_id}`}>{t(C.order)}</a>}
              </span>) }]} />
        </Async>
      </section>
    </>
  )
}

import type { DocSummary } from './api'
import { Async, PageHeader, Status, TableRegion, rm, useFetch } from './ui'
import { t, useLang } from './i18n'
import type { Text } from './i18n'

const S = {
  title: (q: string): Text => ({ en: `Search results for "${q}"`, ms: `Hasil carian untuk "${q}"`, zh: `“${q}”的搜索结果`, ta: `"${q}" க்கான தேடல் முடிவுகள்` }),
  count: (n: number): Text => ({ en: `${n} ${n === 1 ? 'result' : 'results'}`, ms: `${n} hasil`, zh: `${n} 条结果`, ta: `${n} முடிவுகள்` }),
  short: { en: 'Type at least 2 characters.', ms: 'Taip sekurang-kurangnya 2 aksara.', zh: '请至少输入 2 个字符。', ta: 'குறைந்தது 2 எழுத்துகளை உள்ளிடவும்.' },
  none: { en: 'Nothing matches. Try a document number, a name, or an item.', ms: 'Tiada yang sepadan. Cuba nombor dokumen, nama atau item.', zh: '没有符合的结果。请试试文件编号、名称或项目。', ta: 'பொருந்தும் முடிவு இல்லை. ஆவண எண், பெயர் அல்லது பொருளை முயலவும்.' },
  contacts: { en: 'Contacts', ms: 'Kenalan', zh: '联系人', ta: 'தொடர்புகள்' },
  noDetails: { en: 'No contact details', ms: 'Tiada butiran hubungan', zh: '没有联系方式', ta: 'தொடர்பு விவரங்கள் இல்லை' },
  docs: { en: 'Documents', ms: 'Dokumen', zh: '文件', ta: 'ஆவணங்கள்' },
  noNo: { en: 'No document number', ms: 'Tiada nombor dokumen', zh: '没有文件编号', ta: 'ஆவண எண் இல்லை' },
  received: { en: 'Received', ms: 'Diterima', zh: '已收到', ta: 'பெறப்பட்டது' }, sent: { en: 'Sent', ms: 'Dihantar', zh: '已发送', ta: 'அனுப்பப்பட்டது' },
  costs: { en: 'Current costs', ms: 'Kos semasa', zh: '当前成本', ta: 'தற்போதைய செலவுகள்' },
  costsTable: { en: 'Current costs table', ms: 'Jadual kos semasa', zh: '当前成本表', ta: 'தற்போதைய செலவு அட்டவணை' },
  cap: (q: string): Text => ({ en: `Cost items matching ${q}`, ms: `Item kos yang sepadan dengan ${q}`, zh: `与 ${q} 相符的成本项目`, ta: `${q} உடன் பொருந்தும் செலவுப் பொருட்கள்` }),
  item: { en: 'Item', ms: 'Item', zh: '项目', ta: 'பொருள்' }, supplier: { en: 'Supplier', ms: 'Pembekal', zh: '供应商', ta: 'சப்ளையர்' },
  unit: { en: 'Unit', ms: 'Unit', zh: '单位', ta: 'அலகு' }, unitCost: { en: 'Unit cost', ms: 'Kos seunit', zh: '单位成本', ta: 'அலகு செலவு' },
  since: { en: 'Since', ms: 'Sejak', zh: '自', ta: 'முதல்' },
}
const ROLE: Record<string, Text> = {
  customer: { en: 'Customer', ms: 'Pelanggan', zh: '客户', ta: 'வாடிக்கையாளர்' }, supplier: { en: 'Supplier', ms: 'Pembekal', zh: '供应商', ta: 'சப்ளையர்' },
  contractor: { en: 'Contractor', ms: 'Kontraktor', zh: '承包商', ta: 'ஒப்பந்ததாரர்' },
}

interface Hit { id: string; role: string; name: string; contact: string | null; email: string | null; documents: number }
interface Result {
  query: string; contacts: Hit[]; documents: DocSummary[]
  cost_items?: { id: string; item_key: string; uom: string; unit_cost: string; supplier: string; supplier_id: string; effective_date: string }[]
}

export function SearchView({ q }: { q: string }) {
  useLang()
  const s = useFetch<Result>(`/search?q=${encodeURIComponent(q)}`)
  const r = s.data
  const n = r ? r.contacts.length + r.documents.length + (r.cost_items?.length ?? 0) : 0
  return (
    <>
      <PageHeader title={t(S.title(q))} description={<span role="status">{r ? t(S.count(n)) : ''}</span>} />
      <Async s={s} empty={q.trim().length < 2 || (!!r && n === 0)} emptyText={t(q.trim().length < 2 ? S.short : S.none)}>
        {r && <div className="grid gap-6">
          {r.contacts.length > 0 && (
            <section aria-labelledby="sc"><h2 id="sc" className="mb-2 text-lg font-semibold">{t(S.contacts)}</h2>
              <ul className="grid gap-2 md:grid-cols-2">{r.contacts.map(c => (
                <li key={c.id}><a className="card block hover:bg-tint" href={`#/contact/${c.id}`}>
                  <span className="font-semibold text-accent underline underline-offset-2">{c.name}</span> <span className="badge">{c.role in ROLE ? t(ROLE[c.role]) : c.role}</span>
                  <span className="block text-sm text-muted">{[c.contact, c.email].filter(Boolean).join(' · ') || t(S.noDetails)}</span>
                </a></li>))}</ul></section>
          )}
          {r.documents.length > 0 && (
            <section aria-labelledby="sd"><h2 id="sd" className="mb-2 text-lg font-semibold">{t(S.docs)}</h2>
              <ul className="divide-y divide-soft rounded-ui border border-soft bg-surface">{r.documents.map(d => (
                <li key={d.id}><a className="row" href={`#/doc/${d.id}`}>
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-semibold text-accent underline underline-offset-2">{d.doc_no ?? t(S.noNo)}</span>
                    <span className="text-sm tabular-nums">{d.total ? rm(d.total) : ''}</span></span>
                  <span className="block text-sm">{d.party.name}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-sm"><Status v={d.status} /><span className="text-muted">{t(d.direction === 'in' ? S.received : S.sent)}</span></span>
                </a></li>))}</ul></section>
          )}
          {r.cost_items && r.cost_items.length > 0 && (
            <section aria-labelledby="si"><h2 id="si" className="mb-2 text-lg font-semibold">{t(S.costs)}</h2>
              <TableRegion label={t(S.costsTable)}>
                <table className="w-full min-w-max"><caption className="sr-only">{t(S.cap(q))}</caption>
                  <thead><tr><th scope="col">{t(S.item)}</th><th scope="col">{t(S.supplier)}</th><th scope="col">{t(S.unit)}</th><th scope="col">{t(S.unitCost)}</th><th scope="col">{t(S.since)}</th></tr></thead>
                  <tbody>{r.cost_items.map(c => (
                    <tr key={c.id}><td>{c.item_key}</td><td><a className="link" href={`#/contact/${c.supplier_id}`}>{c.supplier}</a></td>
                      <td>{c.uom}</td><td className="tabular-nums">{rm(c.unit_cost)}</td><td>{c.effective_date}</td></tr>))}</tbody>
                </table></TableRegion></section>
          )}
        </div>}
      </Async>
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, MOCK, can, needs, why } from './api'
import { FilterBar, FilterSelect } from './kit'
import { rm, stageLabel, useFetch, useAction, ActionError, Async, EmptyState, PageHeader, Status } from './ui'
import { useWriteGate } from './Licence'
import type { Tracker, DocDetail, DocSummary, Line } from './api'
import { t, useLang } from './i18n'
import type { Text } from './i18n'
import { tx } from './strings'

const S = {
  noDocNo: { en: 'No document number', ms: 'Tiada nombor dokumen', zh: '无文档编号', ta: 'ஆவண எண் இல்லை' },
  needsReview: { en: 'Needs review', ms: 'Perlu semakan', zh: '需审核', ta: 'மதிப்பாய்வு தேவை' },
  stale: { en: 'Cost is stale', ms: 'Kos sudah lapuk', zh: '成本已过时', ta: 'செலவு பழையது' },
  needFile: { en: 'Choose a file or paste the quote text.', ms: 'Pilih fail atau tampal teks sebut harga.', zh: '请选择文件或粘贴报价文本。', ta: 'கோப்பைத் தேர்ந்தெடுக்கவும் அல்லது மேற்கோள் உரையை ஒட்டவும்.' },
  notBoth: { en: 'Use either a file or pasted text, not both.', ms: 'Guna sama ada fail atau teks yang ditampal, bukan kedua-duanya.', zh: '请使用文件或粘贴文本，二者选其一。', ta: 'கோப்பு அல்லது ஒட்டிய உரை — இரண்டில் ஒன்றை மட்டும் பயன்படுத்தவும்.' },
  approvalsDesc: { en: 'What a person still has to check or approve before it goes out. Change the filter to see every quote.', ms: 'Apa yang masih perlu disemak atau diluluskan oleh seseorang sebelum dihantar. Tukar penapis untuk melihat setiap sebut harga.', zh: '发出前仍需人工检查或批准的事项。更改筛选可查看全部报价。', ta: 'அனுப்பும் முன் ஒருவர் சரிபார்க்க அல்லது அங்கீகரிக்க வேண்டியவை. எல்லா மேற்கோள்களையும் காண வடிகட்டியை மாற்றவும்.' },
  uploadSup: { en: 'Upload supplier quote', ms: 'Muat naik sebut harga pembekal', zh: '上传供应商报价', ta: 'சப்ளையர் மேற்கோளைப் பதிவேற்று' },
  quoteFile: { en: 'Quote file (PDF, Excel, Word, CSV, photo or text)', ms: 'Fail sebut harga (PDF, Excel, Word, CSV, foto atau teks)', zh: '报价文件（PDF、Excel、Word、CSV、照片或文本）', ta: 'மேற்கோள் கோப்பு (PDF, Excel, Word, CSV, படம் அல்லது உரை)' },
  oldFormat: { en: 'Old Excel and Word files (.xls, .doc) cannot be read. Save it as .xlsx or .docx, or as a PDF, and upload that.', ms: 'Fail Excel dan Word lama (.xls, .doc) tidak dapat dibaca. Simpan sebagai .xlsx atau .docx, atau sebagai PDF, dan muat naik itu.', zh: '无法读取旧版 Excel 和 Word 文件（.xls、.doc）。请另存为 .xlsx 或 .docx，或 PDF，再上传。', ta: 'பழைய Excel மற்றும் Word கோப்புகளை (.xls, .doc) படிக்க முடியாது. .xlsx அல்லது .docx ஆக, அல்லது PDF ஆகச் சேமித்து அதைப் பதிவேற்றவும்.' },
  orPaste: { en: 'Or paste the quote text', ms: 'Atau tampal teks sebut harga', zh: '或粘贴报价文本', ta: 'அல்லது மேற்கோள் உரையை ஒட்டவும்' },
  supName: { en: 'Supplier name (optional)', ms: 'Nama pembekal (pilihan)', zh: '供应商名称（可选）', ta: 'சப்ளையர் பெயர் (விருப்பம்)' },
  reading: { en: 'Reading the quote...', ms: 'Membaca sebut harga...', zh: '正在读取报价...', ta: 'மேற்கோளைப் படிக்கிறது...' },
  readAdd: { en: 'Read quote and add to tracker', ms: 'Baca sebut harga dan tambah ke penjejak', zh: '读取报价并添加到追踪', ta: 'மேற்கோளைப் படித்து கண்காணிப்பில் சேர்' },
  retryRead: { en: 'Retry reading the quote', ms: 'Cuba baca sebut harga semula', zh: '重试读取报价', ta: 'மேற்கோளை மீண்டும் படிக்க முயற்சி' },
  openSup: { en: 'Open the supplier quote', ms: 'Buka sebut harga pembekal', zh: '打开供应商报价', ta: 'சப்ளையர் மேற்கோளைத் திற' },
  supQuote: { en: 'supplier quote', ms: 'sebut harga pembekal', zh: '供应商报价', ta: 'சப்ளையர் மேற்கோள்' },
  noneReview: { en: 'No lines need review.', ms: 'Tiada baris perlu semakan.', zh: '没有需要审核的行。', ta: 'மதிப்பாய்வு தேவைப்படும் வரிகள் இல்லை.' },
  typeFirst: { en: 'Type the customer enquiry first.', ms: 'Taip pertanyaan pelanggan dahulu.', zh: '请先输入客户询价内容。', ta: 'முதலில் வாடிக்கையாளர் விசாரணையை உள்ளிடவும்.' },
  simulate: { en: 'Simulate customer enquiry', ms: 'Simulasi pertanyaan pelanggan', zh: '模拟客户询价', ta: 'வாடிக்கையாளர் விசாரணையை உருவகப்படுத்து' },
  arrived: { en: 'Channel it arrived on', ms: 'Saluran penerimaan', zh: '来源渠道', ta: 'வந்த சேனல்' },
  enquiryText: { en: 'Enquiry text', ms: 'Teks pertanyaan', zh: '询价内容', ta: 'விசாரணை உரை' },
  simNeeds: { en: ' to create a draft quote from an enquiry.', ms: ' untuk mencipta draf sebut harga daripada pertanyaan.', zh: ' 才能根据询价创建报价草稿。', ta: ' விசாரணையிலிருந்து வரைவு மேற்கோளை உருவாக்க.' },
  pricing: { en: 'Pricing the enquiry...', ms: 'Menetapkan harga pertanyaan...', zh: '正在为询价定价...', ta: 'விசாரணைக்கு விலை நிர்ணயிக்கிறது...' },
  createDraft: { en: 'Create draft quote from enquiry', ms: 'Cipta draf sebut harga daripada pertanyaan', zh: '根据询价创建报价草稿', ta: 'விசாரணையிலிருந்து வரைவு மேற்கோளை உருவாக்கு' },
  retryPricing: { en: 'Retry pricing the enquiry', ms: 'Cuba tetapkan harga semula', zh: '重试为询价定价', ta: 'விலை நிர்ணயத்தை மீண்டும் முயற்சி' },
  showAll: { en: 'Show all', ms: 'Tunjuk semua', zh: '显示全部', ta: 'அனைத்தையும் காட்டு' },
  received: { en: 'Received', ms: 'Diterima', zh: '已收到', ta: 'பெறப்பட்டவை' },
  sent: { en: 'Sent', ms: 'Dihantar', zh: '已发送', ta: 'அனுப்பப்பட்டவை' },
  supQuotes: { en: 'Supplier quotes', ms: 'Sebut harga pembekal', zh: '供应商报价', ta: 'சப்ளையர் மேற்கோள்கள்' },
  custQuotes: { en: 'Customer quotes', ms: 'Sebut harga pelanggan', zh: '客户报价', ta: 'வாடிக்கையாளர் மேற்கோள்கள்' },
  title: { en: 'Quote tracker', ms: 'Penjejak sebut harga', zh: '报价追踪', ta: 'மேற்கோள் கண்காணிப்பு' },
  desc: { en: 'Supplier quotes you received and customer quotes you sent, in one place.', ms: 'Sebut harga pembekal yang anda terima dan sebut harga pelanggan yang anda hantar, di satu tempat.', zh: '您收到的供应商报价和发给客户的报价，集中在一处。', ta: 'நீங்கள் பெற்ற சப்ளையர் மேற்கோள்களும் அனுப்பிய வாடிக்கையாளர் மேற்கோள்களும், ஒரே இடத்தில்.' },
  uploadQuote: { en: 'Upload quote', ms: 'Muat naik sebut harga', zh: '上传报价', ta: 'மேற்கோளைப் பதிவேற்று' },
  filterLabel: { en: 'Tracker filter', ms: 'Penapis penjejak', zh: '追踪筛选', ta: 'கண்காணிப்பு வடிகட்டி' },
  filter: { en: 'Filter', ms: 'Penapis', zh: '筛选', ta: 'வடிகட்டி' },
  allDocs: { en: 'All documents', ms: 'Semua dokumen', zh: '全部文档', ta: 'அனைத்து ஆவணங்களும்' },
  openCust: { en: 'Open customer quotes', ms: 'Sebut harga pelanggan terbuka', zh: '未结客户报价', ta: 'திறந்த வாடிக்கையாளர் மேற்கோள்கள்' },
  noSup: { en: 'No supplier quotes yet.', ms: 'Belum ada sebut harga pembekal.', zh: '暂无供应商报价。', ta: 'இன்னும் சப்ளையர் மேற்கோள்கள் இல்லை.' },
  noSupHint: { en: 'Upload a PDF, Excel, Word or CSV file, a photo or pasted text and LARIS reads the prices for you.', ms: 'Muat naik fail PDF, Excel, Word atau CSV, foto atau teks yang ditampal dan LARIS membaca harga untuk anda.', zh: '上传 PDF、Excel、Word 或 CSV 文件、照片或粘贴文本，LARIS 会为您读取价格。', ta: 'PDF, Excel, Word அல்லது CSV கோப்பு, படம் அல்லது ஒட்டிய உரையைப் பதிவேற்றினால் LARIS விலைகளை உங்களுக்காகப் படிக்கும்.' },
  noCust: { en: 'No customer quotes yet.', ms: 'Belum ada sebut harga pelanggan.', zh: '暂无客户报价。', ta: 'இன்னும் வாடிக்கையாளர் மேற்கோள்கள் இல்லை.' },
  noCustHint: { en: 'A quote appears here when a customer asks for a price.', ms: 'Sebut harga muncul di sini apabila pelanggan meminta harga.', zh: '客户询价后，报价会显示在这里。', ta: 'வாடிக்கையாளர் விலை கேட்கும்போது மேற்கோள் இங்கே தோன்றும்.' },
  sample: { en: 'Try a sample enquiry', ms: 'Cuba contoh pertanyaan', zh: '试试示例询价', ta: 'மாதிரி விசாரணையை முயற்சிக்கவும்' },
  needSup: { en: 'Enter the supplier name.', ms: 'Masukkan nama pembekal.', zh: '请输入供应商名称。', ta: 'சப்ளையர் பெயரை உள்ளிடவும்.' },
  needLine: { en: 'Every line needs a description, a quantity above 0, a unit and a price.', ms: 'Setiap baris memerlukan perihalan, kuantiti melebihi 0, unit dan harga.', zh: '每一行都需要描述、大于 0 的数量、单位和价格。', ta: 'ஒவ்வொரு வரிக்கும் விவரம், 0 க்கு மேல் அளவு, அலகு மற்றும் விலை தேவை.' },
  keyIn: { en: 'Key in a supplier quote by hand', ms: 'Taip sebut harga pembekal secara manual', zh: '手动录入供应商报价', ta: 'சப்ளையர் மேற்கோளைக் கைமுறையாக உள்ளிடு' },
  supNameReq: { en: 'Supplier name', ms: 'Nama pembekal', zh: '供应商名称', ta: 'சப்ளையர் பெயர்' },
  supDocNo: { en: 'Supplier document number (optional)', ms: 'Nombor dokumen pembekal (pilihan)', zh: '供应商文档编号（可选）', ta: 'சப்ளையர் ஆவண எண் (விருப்பம்)' },
  desc2: { en: 'Description', ms: 'Perihalan', zh: '描述', ta: 'விவரம்' },
  qty: { en: 'Quantity', ms: 'Kuantiti', zh: '数量', ta: 'அளவு' },
  unit: { en: 'Unit (for example sheet, kg)', ms: 'Unit (contohnya helai, kg)', zh: '单位（例如 张、kg）', ta: 'அலகு (எ.கா. தாள், கிலோ)' },
  unitPrice: { en: 'Unit price', ms: 'Harga seunit', zh: '单价', ta: 'அலகு விலை' },
  addLine: { en: 'Add a line', ms: 'Tambah baris', zh: '添加一行', ta: 'வரியைச் சேர்' },
  saving: { en: 'Saving...', ms: 'Menyimpan...', zh: '保存中...', ta: 'சேமிக்கிறது...' },
  addTracker: { en: 'Add to tracker', ms: 'Tambah ke penjejak', zh: '添加到追踪', ta: 'கண்காணிப்பில் சேர்' },
  retrySave: { en: 'Retry saving', ms: 'Cuba simpan semula', zh: '重试保存', ta: 'சேமிப்பை மீண்டும் முயற்சி' },
  openReview: { en: 'Open it to review the lines', ms: 'Buka untuk menyemak baris', zh: '打开并审核各行', ta: 'வரிகளை மதிப்பாய்வு செய்ய திறக்கவும்' },
} satisfies Record<string, Text>

// ---------- Tracker ----------
function DocCard({ d, owner }: { d: DocSummary; owner: boolean }) {
  useLang()
  return (
    <li>
      <a className="row group" href={`#/doc/${d.id}`}>
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-semibold text-ink group-hover:underline">{d.doc_no ?? t(S.noDocNo)}</span>
          <span className="num text-sm">{d.total ? rm(d.total) : ''}</span>
        </span>
        <span className="block text-sm">{d.party.name}</span>
        <span className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Status v={d.status} />
          {d.flags.needs_review && <span className="badge badge-warn">{t(S.needsReview)}</span>}
          {owner && d.flags.cost_is_stale && <span className="badge badge-warn">{t(S.stale)}</span>}
          {d.valid_until && <span className="text-muted">{t({ en: `Valid until ${d.valid_until}`, ms: `Sah sehingga ${d.valid_until}`, zh: `有效期至 ${d.valid_until}`, ta: `செல்லுபடியாகும் வரை ${d.valid_until}` })}</span>}
        </span>
      </a>
    </li>
  )
}

function UploadQuote({ onDone, open, onToggle }: { onDone: () => void; open: boolean; onToggle: (o: boolean) => void }) {
  useLang()
  const [text, setText] = useState('')
  const [supplier, setSupplier] = useState('')
  const [formErr, setFormErr] = useState('')
  const [res, setRes] = useState<{ doc: DocSummary; review: Line[] }>()
  const file = useRef<HTMLInputElement>(null)
  const out = useRef<HTMLDivElement>(null)
  const a = useAction()
  useEffect(() => { if (res) out.current?.focus() }, [res])
  const submit = () => {
    const f = file.current?.files?.[0]
    if (!f && !text.trim()) return setFormErr(t(S.needFile))
    if (f && text.trim()) return setFormErr(t(S.notBoth))
    if (f && /\.(xls|doc)$/i.test(f.name)) return setFormErr(t(S.oldFormat))  // the server refuses these with a 415; say why and what to do before sending
    setFormErr('')
    const fd = new FormData()
    if (f) fd.append('file', f); else fd.append('text', text.trim())
    if (supplier.trim()) fd.append('supplier', supplier.trim())
    a.run(async () => {
      const doc = await api<DocSummary>('POST', '/documents/ingest', fd)
      const d = await api<DocDetail>('GET', `/documents/${doc.id}`)
      setRes({ doc, review: d.lines.filter(l => l.needs_review) })
      setText(''); if (file.current) file.current.value = ''
      onDone()
    })
  }
  return (
    <details data-guide="tk-form" className="card mt-3" open={open} onToggle={e => onToggle(e.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-accent">{t(S.uploadSup)}</summary>
      <form className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-3" onSubmit={e => { e.preventDefault(); submit() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.quoteFile)}
          <input id="quote-file" ref={file} type="file" accept=".pdf,.xlsx,.docx,.csv,.txt,image/*" className="input w-full py-2 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.orPaste)}
          <textarea className="input min-h-24 w-full py-2 font-normal" value={text} onChange={e => setText(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.supName)}
          <input className="input w-full font-normal" value={supplier} onChange={e => setSupplier(e.target.value)} />
        </label>
        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        <div><button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? t(S.reading) : t(S.readAdd)}</button></div>
      </form>
      <ActionError err={a.err} onRetry={submit} label={t(S.retryRead)} />
      {res && (
        <div ref={out} data-guide="tk-result" tabIndex={-1} className="card mt-3" aria-labelledby="up-res">
          <h3 id="up-res" className="font-semibold">{t({ en: `Added ${res.doc.doc_no ?? 'supplier quote'} from ${res.doc.party.name}`, ms: `${res.doc.doc_no ?? 'Sebut harga pembekal'} ditambah daripada ${res.doc.party.name}`, zh: `已添加来自 ${res.doc.party.name} 的 ${res.doc.doc_no ?? '供应商报价'}`, ta: `${res.doc.party.name} இடமிருந்து ${res.doc.doc_no ?? 'சப்ளையர் மேற்கோள்'} சேர்க்கப்பட்டது` })}</h3>
          <p className="text-sm">{t({ en: `Status: ${stageLabel(res.doc.status)}.`, ms: `Status: ${stageLabel(res.doc.status)}.`, zh: `状态：${stageLabel(res.doc.status)}。`, ta: `நிலை: ${stageLabel(res.doc.status)}.` })} <a className="link" href={`#/doc/${res.doc.id}`}>{t(S.openSup)}</a></p>
          {res.review.length > 0
            ? <><p className="mt-2 text-sm font-semibold">{t({ en: `${res.review.length} ${res.review.length === 1 ? 'line needs' : 'lines need'} review`, ms: `${res.review.length} baris perlu semakan`, zh: `${res.review.length} 行需要审核`, ta: `${res.review.length} வரிகளுக்கு மதிப்பாய்வு தேவை` })}</p>
                <ul className="list-disc pl-5 text-sm">{res.review.map(l => <li key={l.id}>{t({ en: `Line ${l.line_no}`, ms: `Baris ${l.line_no}`, zh: `第 ${l.line_no} 行`, ta: `வரி ${l.line_no}` })}: {l.description}</li>)}</ul></>
            : <p className="mt-2 text-sm text-muted">{t(S.noneReview)}</p>}
        </div>
      )}
    </details>
  )
}

const IS = {
  title: { en: 'Add a quote you already sent', ms: 'Tambah sebut harga yang sudah anda hantar', zh: '添加您已发出的报价', ta: 'நீங்கள் ஏற்கனவே அனுப்பிய மேற்கோளைச் சேர்' },
  intro: { en: 'Made it in Excel or Word and sent it yourself? Add the file here. LARIS reads the lines, files it as sent, follows up if there is no reply, and can make an accept link.', ms: 'Buat dalam Excel atau Word dan hantar sendiri? Tambah fail di sini. LARIS membaca baris, memfailkannya sebagai dihantar, menyusul jika tiada balasan, dan boleh membuat pautan terima.', zh: '用 Excel 或 Word 做好并自己发出了报价？在此添加文件。LARIS 会读取各行、记为已发送、无回复时跟进，并可生成接受链接。', ta: 'Excel அல்லது Word இல் செய்து நீங்களே அனுப்பினீர்களா? கோப்பை இங்கே சேர்க்கவும். LARIS வரிகளைப் படித்து, அனுப்பியதாகப் பதிவு செய்து, பதில் இல்லையெனில் பின்தொடர்ந்து, ஏற்பு இணைப்பையும் உருவாக்கும்.' },
  customer: { en: 'Customer name', ms: 'Nama pelanggan', zh: '客户名称', ta: 'வாடிக்கையாளர் பெயர்' },
  sentOn: { en: 'Date you sent it (optional)', ms: 'Tarikh anda menghantarnya (pilihan)', zh: '发出日期（可选）', ta: 'நீங்கள் அனுப்பிய தேதி (விருப்பம்)' },
  needCust: { en: 'Enter the customer name.', ms: 'Masukkan nama pelanggan.', zh: '请输入客户名称。', ta: 'வாடிக்கையாளர் பெயரை உள்ளிடவும்.' },
  add: { en: 'Read quote and add as sent', ms: 'Baca sebut harga dan tambah sebagai dihantar', zh: '读取报价并添加为已发送', ta: 'மேற்கோளைப் படித்து அனுப்பியதாகச் சேர்' },
  note: { en: 'Prices are copied from your file, not worked out by LARIS. Check any line marked for review.', ms: 'Harga disalin daripada fail anda, bukan dikira oleh LARIS. Semak mana-mana baris yang ditanda untuk semakan.', zh: '价格取自您的文件，不是 LARIS 计算的。请检查标记为需审核的行。', ta: 'விலைகள் உங்கள் கோப்பிலிருந்து நகலெடுக்கப்பட்டவை, LARIS கணக்கிட்டவை அல்ல. மதிப்பாய்வுக்குக் குறிக்கப்பட்ட வரிகளைச் சரிபார்க்கவும்.' },
} satisfies Record<string, Text>

// Owner only: a quote made and sent outside LARIS -> a tracked outgoing quote in status "sent" (POST /documents/import-sent).
function ImportSent({ onDone }: { onDone: () => void }) {
  useLang()
  const [text, setText] = useState('')
  const [customer, setCustomer] = useState('')
  const [sentOn, setSentOn] = useState('')
  const [formErr, setFormErr] = useState('')
  const [res, setRes] = useState<{ doc: DocSummary; review: Line[] }>()
  const file = useRef<HTMLInputElement>(null)
  const out = useRef<HTMLDivElement>(null)
  const a = useAction()
  useEffect(() => { if (res) out.current?.focus() }, [res])
  const submit = () => {
    const f = file.current?.files?.[0]
    if (!customer.trim()) return setFormErr(t(IS.needCust))
    if (!f && !text.trim()) return setFormErr(t(S.needFile))
    if (f && text.trim()) return setFormErr(t(S.notBoth))
    if (f && /\.(xls|doc)$/i.test(f.name)) return setFormErr(t(S.oldFormat))
    setFormErr('')
    const fd = new FormData()
    if (f) fd.append('file', f); else fd.append('text', text.trim())
    fd.append('customer', customer.trim())
    if (sentOn) fd.append('sent_on', sentOn)
    a.run(async () => {
      const doc = await api<DocSummary>('POST', '/documents/import-sent', fd)
      const d = await api<DocDetail>('GET', `/documents/${doc.id}`)
      setRes({ doc, review: d.lines.filter(l => l.needs_review) })
      setText(''); setCustomer(''); setSentOn(''); if (file.current) file.current.value = ''
      onDone()
    })
  }
  return (
    <details data-guide="tk-import" className="card mt-3">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-accent">{t(IS.title)}</summary>
      <p className="mt-1 text-sm text-muted">{t(IS.intro)}</p>
      <form className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-3" onSubmit={e => { e.preventDefault(); submit() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t(IS.customer)}
          <input className="input w-full font-normal" maxLength={120} value={customer} onChange={e => setCustomer(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.quoteFile)}
          <input ref={file} type="file" accept=".pdf,.xlsx,.docx,.csv,.txt,image/*" className="input w-full py-2 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.orPaste)}
          <textarea className="input min-h-20 w-full py-2 font-normal" value={text} onChange={e => setText(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t(IS.sentOn)}
          <input type="date" className="input w-fit font-normal" max={new Date().toISOString().slice(0, 10)} value={sentOn} onChange={e => setSentOn(e.target.value)} />
        </label>
        <p className="text-sm text-muted">{t(IS.note)}</p>
        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        <div><button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? t(S.reading) : t(IS.add)}</button></div>
      </form>
      <ActionError err={a.err} onRetry={submit} label={t(S.retryRead)} />
      {res && (
        <div ref={out} tabIndex={-1} className="card mt-3" aria-labelledby="imp-res">
          <h3 id="imp-res" className="font-semibold">{t({ en: `Added ${res.doc.doc_no ?? 'quote'} for ${res.doc.party.name} as sent`, ms: `${res.doc.doc_no ?? 'Sebut harga'} untuk ${res.doc.party.name} ditambah sebagai dihantar`, zh: `已为 ${res.doc.party.name} 添加 ${res.doc.doc_no ?? '报价'}（已发送）`, ta: `${res.doc.party.name} க்கான ${res.doc.doc_no ?? 'மேற்கோள்'} அனுப்பியதாகச் சேர்க்கப்பட்டது` })}</h3>
          <p className="mt-1 text-sm">{res.review.length > 0 ? t({ en: `${res.review.length} ${res.review.length === 1 ? 'line needs' : 'lines need'} a look: a quantity or price could not be read.`, ms: `${res.review.length} baris perlu disemak: kuantiti atau harga tidak dapat dibaca.`, zh: `${res.review.length} 行需要查看：无法读取数量或价格。`, ta: `${res.review.length} வரிகளைப் பார்க்க வேண்டும்: அளவு அல்லது விலையைப் படிக்க முடியவில்லை.` }) : t(S.noneReview)}</p>
          <a className="link inline-flex min-h-11 items-center" href={`#/doc/${res.doc.id}`}>{t({ en: 'Open the quote', ms: 'Buka sebut harga', zh: '打开报价', ta: 'மேற்கோளைத் திற' })}</a>
        </div>
      )}
    </details>
  )
}

const CHANNELS: [string, Text][] = [['telegram', { en: 'Telegram', ms: 'Telegram' }], ['whatsapp', { en: 'WhatsApp', ms: 'WhatsApp' }], ['web', { en: 'Web', ms: 'Web', zh: '网页', ta: 'இணையம்' }], ['upload', { en: 'Upload', ms: 'Muat naik', zh: '上传', ta: 'பதிவேற்றம்' }]]
function SimulateEnquiry({ open, onToggle }: { open: boolean; onToggle: (o: boolean) => void }) {
  useLang()
  const [channel, setChannel] = useState('telegram')
  const [text, setText] = useState('')
  const [formErr, setFormErr] = useState('')
  const a = useAction()
  const submit = () => {
    if (!can('manage_contacts')) return
    if (!text.trim()) return setFormErr(t(S.typeFirst))
    setFormErr('')
    a.run(async () => {
      const doc = await api<DocSummary>('POST', '/enquiries/simulate', { channel, text: text.trim() })
      location.hash = `#/doc/${doc.id}`
    })
  }
  return (
    <details data-guide="tk-sim" className="card mt-3" open={open} onToggle={e => onToggle(e.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-accent">{t(S.simulate)}</summary>
      <form className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-3" onSubmit={e => { e.preventDefault(); submit() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.arrived)}
          <select className="input w-fit font-normal" value={channel} onChange={e => setChannel(e.target.value)}>
            {CHANNELS.map(([k, name]) => <option key={k} value={k}>{t(name)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.enquiryText)}
          <textarea id="enquiry-text" className="input min-h-24 w-full py-2 font-normal" maxLength={4000} value={text} onChange={e => setText(e.target.value)} />
        </label>
        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        {!can('manage_contacts') && <p id="sim-why" className="text-sm text-muted">{why('manage_contacts')}{t(S.simNeeds)}</p>}
        <div><button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined} {...(can('manage_contacts') ? {} : { ...needs('manage_contacts'), 'aria-describedby': 'sim-why' })}>{a.busy ? t(S.pricing) : t(S.createDraft)}</button></div>
      </form>
      <ActionError err={a.err} onRetry={submit} label={t(S.retryPricing)} />
    </details>
  )
}

const OPEN_QUOTE = ['draft', 'approved', 'sent', 'read']
let savedFilter = ''  // list state kept for this visit, so Back from a document returns to the same filtered list

// arg: 'review' and 'open' pre-select a filter (Home links), 'upload' opens the upload form.
export function TrackerView({ owner, arg, approvals }: { owner: boolean; arg?: string; approvals?: boolean }) {  // approvals: the same page opened from the Approvals menu item
  useLang()
  const gate = useWriteGate()
  const s = useFetch<Tracker>('/tracker')
  const [filter, setFilterRaw] = useState(arg === 'review' || arg === 'open' ? arg : savedFilter)
  const setFilter = (v: string) => { savedFilter = v; setFilterRaw(v) }
  useEffect(() => { if (arg === 'review' || arg === 'open') setFilter(arg) }, [arg])
  const [up, setUp] = useState(arg === 'upload')
  const [sim, setSim] = useState(false)
  const [tick, setTick] = useState(0)
  const focusId = useRef(arg === 'upload' ? 'quote-file' : '')
  // Open a form and put the cursor in it once it exists (the lanes only render after the tracker has loaded).
  const openForm = (id: string) => { (id === 'quote-file' ? setUp : setSim)(true); focusId.current = id; setTick(t => t + 1) }
  useEffect(() => {
    if (!focusId.current || !s.data) return
    const id = focusId.current; focusId.current = ''
    requestAnimationFrame(() => { const el = document.getElementById(id); el?.scrollIntoView({ block: 'center' }); el?.focus() })
  }, [tick, s.data])
  const all = [...(s.data?.received ?? []), ...(s.data?.sent ?? [])]
  const statuses = [...new Set(all.map(d => d.status))].sort()
  const match = (d: DocSummary) => !filter || (filter === 'review' ? d.flags.needs_review : filter === 'open' ? d.direction === 'out' && OPEN_QUOTE.includes(d.status) : d.status === filter)
  const pick = (l: DocSummary[]) => l.filter(match)
  const shown = pick(all).length
  const st = stageLabel(filter)
  const filterName: Text = filter === 'review' ? { en: 'needing review', ms: 'yang perlu semakan', zh: '需审核', ta: 'மதிப்பாய்வு தேவை' }
    : filter === 'open' ? { en: 'open customer quotes', ms: 'sebut harga pelanggan terbuka', zh: '未结客户报价', ta: 'திறந்த வாடிக்கையாளர் மேற்கோள்கள்' }
    : { en: `with status ${st}`, ms: `berstatus ${st}`, zh: `状态：${st}`, ta: `நிலை: ${st}` }
  const lane = (key: string, title: string, hint: string, l: DocSummary[], extra: ReactNode, empty: { title: string; hint: string; action?: { label: string; onClick: () => void } }) => (
    <section aria-labelledby={key} data-guide={`tk-${key.toLowerCase()}`} className="glass-lite min-w-0 p-4">
      <h2 id={key} className="border-b border-hairline pb-2 text-md font-semibold">{title} <span className="text-sm font-normal text-muted">({l.length}) {hint}</span></h2>
      {extra}
      {l.length ? <ul className="mt-3 divide-y divide-hairline glass-lite">{l.map(d => <DocCard key={d.id} d={d} owner={owner} />)}</ul>
        : <div className="mt-3">{filter ? <p className="py-3 text-muted">{t({ en: `No documents ${filterName.en}.`, ms: `Tiada dokumen ${filterName.ms}.`, zh: `没有符合条件的文档（${filterName.zh}）。`, ta: `ஆவணங்கள் இல்லை (${filterName.ta}).` })} <button type="button" className="link" onClick={() => setFilter('')}>{t(S.showAll)}</button></p> : <EmptyState {...empty} />}</div>}
    </section>
  )
  return (
    <>
      <PageHeader title={approvals ? tx('nav.approvals') : t(S.title)} description={approvals ? t(S.approvalsDesc) : t(S.desc)}
        actions={can('upload_documents') && <button type="button" data-guide="tk-upload" className="btn btn-primary" {...gate(() => openForm('quote-file'))}>{t(S.uploadQuote)}</button>} />
      <FilterBar label={t(S.filterLabel)} chips={filter ? [{ label: t({ en: `Showing: ${filterName.en}`, ms: `Dipaparkan: ${filterName.ms}`, zh: `显示：${filterName.zh}`, ta: `காட்டுவது: ${filterName.ta}` }), onRemove: () => setFilter('') }] : []} onClear={() => setFilter('')}>
        <FilterSelect label={t(S.filter)} value={filter} onChange={setFilter}>
          <option value="">{t(S.allDocs)}</option>
          <option value="review">{t(S.needsReview)}</option>
          <option value="open">{t(S.openCust)}</option>
          {statuses.map(x => <option key={x} value={x}>{t({ en: `Status: ${stageLabel(x)}`, ms: `Status: ${stageLabel(x)}`, zh: `状态：${stageLabel(x)}`, ta: `நிலை: ${stageLabel(x)}` })}</option>)}
        </FilterSelect>
      </FilterBar>
      <p role="status" className="sr-only">{s.data ? t({ en: `Showing ${shown} ${shown === 1 ? 'document' : 'documents'}`, ms: `Memaparkan ${shown} dokumen`, zh: `显示 ${shown} 份文档`, ta: `${shown} ஆவணங்கள் காட்டப்படுகின்றன` }) : ''}</p>
      <Async s={s} rows={4}>
        <div className="grid gap-6 md:grid-cols-2">
          {lane('Received', t(S.received), t(S.supQuotes), pick(s.data?.received ?? []), can('upload_documents') ? <><UploadQuote onDone={s.reload} open={up} onToggle={setUp} />{!MOCK && <ManualQuote onDone={s.reload} />}</> : null,
            { title: t(S.noSup), hint: t(S.noSupHint), action: can('upload_documents') ? { label: t(S.uploadSup), onClick: () => openForm('quote-file') } : undefined })}
          {lane('Sent', t(S.sent), t(S.custQuotes), pick(s.data?.sent ?? []), <>{owner && can('upload_documents') && <ImportSent onDone={s.reload} />}<SimulateEnquiry open={sim} onToggle={setSim} /></>,
            { title: t(S.noCust), hint: t(S.noCustHint), action: { label: t(S.sample), onClick: () => openForm('enquiry-text') } })}
        </div>
      </Async>
    </>
  )
}

type Row = { description: string; qty: string; uom: string; unit_price: string }
const blank = (): Row => ({ description: '', qty: '', uom: '', unit_price: '' })

// Fallback when the reader cannot make sense of a document: key the lines in. Same review steps afterwards.
function ManualQuote({ onDone }: { onDone: () => void }) {
  useLang()
  const [supplier, setSupplier] = useState('')
  const [docNo, setDocNo] = useState('')
  const [rows, setRows] = useState<Row[]>([blank()])
  const [formErr, setFormErr] = useState('')
  const [added, setAdded] = useState<DocSummary>()
  const a = useAction()
  const set = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const submit = () => {
    if (!supplier.trim()) return setFormErr(t(S.needSup))
    if (rows.some(r => !r.description.trim() || !(Number(r.qty) > 0) || !r.uom.trim() || r.unit_price === '' || Number(r.unit_price) < 0))
      return setFormErr(t(S.needLine))
    setFormErr('')
    a.run(async () => {
      const doc = await api<DocSummary>('POST', '/documents/manual', {
        supplier: supplier.trim(), doc_no: docNo.trim() || undefined,
        lines: rows.map(r => ({ description: r.description.trim(), qty: r.qty, uom: r.uom.trim(), unit_price: r.unit_price })) })
      setAdded(doc); setRows([blank()]); setDocNo(''); onDone()
    })
  }
  return (
    <details className="card mt-3">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-accent">{t(S.keyIn)}</summary>
      <form className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-3" onSubmit={e => { e.preventDefault(); submit() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.supNameReq)}
          <input className="input w-full font-normal" value={supplier} onChange={e => setSupplier(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.supDocNo)}
          <input className="input font-normal" value={docNo} onChange={e => setDocNo(e.target.value)} /></label>
        {rows.map((r, i) => (
          <fieldset key={i} className="grid gap-2 rounded-ui border border-soft p-2 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold">{t({ en: `Line ${i + 1}`, ms: `Baris ${i + 1}`, zh: `第 ${i + 1} 行`, ta: `வரி ${i + 1}` })}</legend>
            <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">{t(S.desc2)}
              <input className="input font-normal" value={r.description} onChange={e => set(i, 'description', e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.qty)}
              <input className="input font-normal" inputMode="decimal" value={r.qty} onChange={e => set(i, 'qty', e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.unit)}
              <input className="input font-normal" value={r.uom} onChange={e => set(i, 'uom', e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.unitPrice)}
              <input className="input font-normal" inputMode="decimal" value={r.unit_price} onChange={e => set(i, 'unit_price', e.target.value)} /></label>
            {rows.length > 1 && <div className="flex items-end"><button type="button" className="btn" onClick={() => setRows(rows.filter((_, j) => j !== i))}>{t({ en: `Remove line ${i + 1}`, ms: `Buang baris ${i + 1}`, zh: `删除第 ${i + 1} 行`, ta: `வரி ${i + 1} ஐ நீக்கு` })}</button></div>}
          </fieldset>
        ))}
        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={() => setRows([...rows, blank()])}>{t(S.addLine)}</button>
          <button type="submit" className="btn" aria-disabled={a.busy || undefined}>{a.busy ? t(S.saving) : t(S.addTracker)}</button>
        </div>
      </form>
      <ActionError err={a.err} onRetry={submit} label={t(S.retrySave)} />
      {added && <p role="status" className="mt-2 text-sm">{t({ en: `Added ${added.doc_no ?? 'supplier quote'}.`, ms: `${added.doc_no ?? 'Sebut harga pembekal'} ditambah.`, zh: `已添加 ${added.doc_no ?? '供应商报价'}。`, ta: `${added.doc_no ?? 'சப்ளையர் மேற்கோள்'} சேர்க்கப்பட்டது.` })} <a className="link" href={`#/doc/${added.id}`}>{t(S.openReview)}</a></p>}
    </details>
  )
}

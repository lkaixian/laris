import { useEffect, useRef, useState } from 'react'
import type { Ref } from 'react'
import { api, can, download, MOCK, needs, why } from './api'
import type { DocSummary } from './api'
import { useWriteGate } from './Licence'
import { Async, EmptyState, PageHeader, Status, msg, rm, useFetch } from './ui'
import { DataTable, FilterBar, Tabs } from './kit'
import type { Col } from './kit'
import { useToast } from './Toast'
import { PersonData } from './Privacy'
import { t, useLang } from './i18n'
import type { Text } from './i18n'

type Kind = 'customer' | 'supplier' | 'contractor'
interface Contact {
  id: string; role: Kind; name: string; contact: string | null; phone?: string | null; tg_username?: string | null; email: string | null; attention: string | null
  ssm_no: string | null; address: string | null; notes: string | null; documents: number; last_activity: string | null; value: string | null
}
interface ContactDetail extends Contact {
  sst_no: string | null; recent_documents: DocSummary[]
  current_costs?: { item_key: string; uom: string; unit_cost: string; effective_date: string }[]
}

const S = {
  all: { en: 'All', ms: 'Semua', zh: '全部', ta: 'அனைத்தும்' },
  customer: { en: 'Customer', ms: 'Pelanggan', zh: '客户', ta: 'வாடிக்கையாளர்' },
  supplier: { en: 'Supplier', ms: 'Pembekal', zh: '供应商', ta: 'சப்ளையர்' },
  contractor: { en: 'Contractor', ms: 'Kontraktor', zh: '承包商', ta: 'ஒப்பந்ததாரர்' },
  customers: { en: 'Customers', ms: 'Pelanggan', zh: '客户', ta: 'வாடிக்கையாளர்கள்' },
  suppliers: { en: 'Suppliers', ms: 'Pembekal', zh: '供应商', ta: 'சப்ளையர்கள்' },
  contractors: { en: 'Contractors', ms: 'Kontraktor', zh: '承包商', ta: 'ஒப்பந்ததாரர்கள்' },
  none: { en: 'None', ms: 'Tiada', zh: '无', ta: 'எதுவுமில்லை' },
  contacts: { en: 'Contacts', ms: 'Kenalan', zh: '联系人', ta: 'தொடர்புகள்' },
  documents: { en: 'Documents', ms: 'Dokumen', zh: '文件', ta: 'ஆவணங்கள்' },
  cancel: { en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து செய்' },
  saving: { en: 'Saving...', ms: 'Menyimpan...', zh: '正在保存...', ta: 'சேமிக்கிறது...' },
  noName: { en: 'Enter a name.', ms: 'Masukkan nama.', zh: '请输入姓名。', ta: 'பெயரை உள்ளிடவும்.' },
} satisfies Record<string, Text>
const KINDS: [Kind | '', Text][] = [['', S.all], ['customer', S.customers], ['supplier', S.suppliers], ['contractor', S.contractors]]
const KIND_ONE: Record<Kind, Text> = { customer: S.customer, supplier: S.supplier, contractor: S.contractor }
const COSTS = (): Col<NonNullable<ContactDetail['current_costs']>[number]>[] => [
  { key: 'item', head: t({ en: 'Item', ms: 'Item', zh: '物品', ta: 'பொருள்' }), cell: x => x.item_key, mobile: 'title' },
  { key: 'uom', head: t({ en: 'Unit', ms: 'Unit', zh: '单位', ta: 'அலகு' }), cell: x => x.uom, mobile: 'meta' },
  { key: 'cost', head: t({ en: 'Unit cost', ms: 'Kos seunit', zh: '单位成本', ta: 'அலகு செலவு' }), cell: x => rm(x.unit_cost), num: true, mobile: 'meta' },
  { key: 'upd', head: t({ en: 'Updated', ms: 'Dikemas kini', zh: '更新于', ta: 'புதுப்பிக்கப்பட்டது' }), cell: x => x.effective_date.slice(0, 10), mobile: 'meta', className: 'whitespace-nowrap tabular-nums' },
]
const day = (s: string | null) => (s ? s.slice(0, 10) : t({ en: 'No activity yet', ms: 'Belum ada aktiviti', zh: '暂无活动', ta: 'இன்னும் செயல்பாடு இல்லை' }))

// A Telegram customer is stored as tg:<chat id>, which means nothing to a person: show their @username and the number they gave us.
const chatLabel = (c: Contact): string | null => c.tg_username || c.phone || /^\s*(tg|telegram):/i.test(c.contact ?? '')
  ? [c.tg_username && '@' + c.tg_username, c.phone].filter(Boolean).join(' · ') || 'Telegram'
  : c.contact
const cols = (owner: boolean): Col<Contact>[] => [
  { key: 'name', head: t({ en: 'Name', ms: 'Nama', zh: '姓名', ta: 'பெயர்' }), cell: c => <a href={`#/contact/${c.id}`}>{c.name}</a>, mobile: 'title' },
  { key: 'role', head: t({ en: 'Role', ms: 'Peranan', zh: '角色', ta: 'பங்கு' }), cell: c => <span className="badge">{t(KIND_ONE[c.role])}</span>, mobile: 'badge' },
  { key: 'phone', head: t({ en: 'Phone', ms: 'Telefon', zh: '电话', ta: 'தொலைபேசி' }), cell: c => chatLabel(c) ?? <span className="text-muted">{t(S.none)}</span>, mobile: 'sub', className: 'whitespace-nowrap tabular-nums' },
  { key: 'docs', head: t(S.documents), cell: c => c.documents, num: true },
  ...(owner ? [{ key: 'value', head: t({ en: 'Value', ms: 'Nilai', zh: '金额', ta: 'மதிப்பு' }), cell: (c: Contact) => c.value && Number(c.value) > 0 ? rm(c.value) : '', num: true }] : []),
  { key: 'last', head: t({ en: 'Last activity', ms: 'Aktiviti terakhir', zh: '最近活动', ta: 'கடைசி செயல்பாடு' }), cell: c => day(c.last_activity), mobile: 'meta' as const, className: 'whitespace-nowrap tabular-nums' },
]

const empty = { role: 'customer' as Kind, name: '', contact: '', email: '', attention: '', ssm_no: '', sst_no: '', address: '', notes: '' }
type Form = typeof empty
const clean = (f: Partial<Form>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]))

// lock: the person may not change a supplier's name or number (needs edit_supplier_contacts). Those two fields show as read-only text with the reason.
function Fields({ f, set, kind, kindRef, lock }: { f: Form; set: (f: Form) => void; kind: boolean; kindRef?: Ref<HTMLSelectElement>; lock?: boolean }) {
  useLang()
  const fld = (k: keyof Form, name: string, extra = '', locked = false) => (
    <label className={`flex flex-col gap-1 text-sm font-semibold ${extra}`}>{name}
      <input className="input font-normal read-only:bg-soft" value={f[k]} onChange={e => set({ ...f, [k]: e.target.value })} {...(locked ? { readOnly: true, title: why('edit_supplier_contacts'), 'aria-describedby': 'sup-lock' } : {})} /></label>
  )
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {kind && (
        <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Type', ms: 'Jenis', zh: '类型', ta: 'வகை' })}
          <select ref={kindRef} className="input font-normal" value={f.role} aria-describedby={can('edit_supplier_contacts') ? undefined : 'kind-why'} onChange={e => set({ ...f, role: e.target.value as Kind })}>
            {(Object.keys(KIND_ONE) as Kind[]).map(k => k === 'supplier' && !can('edit_supplier_contacts')
              ? <option key={k} value={k} disabled>{t(KIND_ONE[k])} {t({ en: '(needs permission)', ms: '(memerlukan kebenaran)', zh: '（需要权限）', ta: '(அனுமதி தேவை)' })}</option>
              : <option key={k} value={k}>{t(KIND_ONE[k])}</option>)}</select>
          {!can('edit_supplier_contacts') && <span id="kind-why" className="text-xs font-normal text-muted">{why('edit_supplier_contacts')} {t({ en: 'to add a supplier.', ms: 'untuk menambah pembekal.', zh: '才能添加供应商。', ta: 'சப்ளையரைச் சேர்க்க.' })}</span>}</label>
      )}
      {lock && <p id="sup-lock" className="text-sm text-muted sm:col-span-2">{why('edit_supplier_contacts')} {t({ en: 'to change a supplier\'s name or number. The other details can be changed.', ms: 'untuk menukar nama atau nombor pembekal. Butiran lain boleh diubah.', zh: '才能更改供应商的名称或号码。其他详细信息可以更改。', ta: 'சப்ளையரின் பெயர் அல்லது எண்ணை மாற்ற. மற்ற விவரங்களை மாற்றலாம்.' })}</p>}
      {fld('name', t({ en: 'Name', ms: 'Nama', zh: '姓名', ta: 'பெயர்' }), '', lock)}
      {fld('contact', t({ en: 'WhatsApp or Telegram number', ms: 'Nombor WhatsApp atau Telegram', zh: 'WhatsApp 或 Telegram 号码', ta: 'WhatsApp அல்லது Telegram எண்' }), '', lock)}
      {fld('email', t({ en: 'Email', ms: 'E-mel', zh: '电子邮件', ta: 'மின்னஞ்சல்' }))}
      {fld('attention', t({ en: 'Person to contact', ms: 'Orang untuk dihubungi', zh: '联系人', ta: 'தொடர்பு கொள்ள வேண்டியவர்' }))}
      {fld('ssm_no', t({ en: 'SSM number (company registration)', ms: 'Nombor SSM (pendaftaran syarikat)', zh: 'SSM 号码（公司注册）', ta: 'SSM எண் (நிறுவனப் பதிவு)' }))}
      {fld('sst_no', t({ en: 'SST number (sales and service tax)', ms: 'Nombor SST (cukai jualan dan perkhidmatan)', zh: 'SST 号码（销售与服务税）', ta: 'SST எண் (விற்பனை மற்றும் சேவை வரி)' }))}
      {fld('address', t({ en: 'Address', ms: 'Alamat', zh: '地址', ta: 'முகவரி' }), 'sm:col-span-2')}
      <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">{t({ en: 'Notes', ms: 'Nota', zh: '备注', ta: 'குறிப்புகள்' })}
        <textarea className="input min-h-20 py-2 font-normal" value={f.notes} onChange={e => set({ ...f, notes: e.target.value })} /></label>
    </div>
  )
}

let saved = { q: '', kind: '' as Kind | '' }  // list state kept for this visit, so Back from a contact returns to the same search

// arg 'new' opens the Add contact form (Home quick action).
export function ContactsView({ owner, arg, initialQuery = '' }: { owner: boolean; arg?: string; initialQuery?: string }) {
  useLang()
  const gate = useWriteGate()
  const [q, setQRaw] = useState(initialQuery || saved.q)
  const [kind, setKindRaw] = useState<Kind | ''>(saved.kind)
  const setQ = (v: string) => { saved.q = v; setQRaw(v) }
  const setKind = (v: Kind | '') => { saved.kind = v; setKindRaw(v) }
  const [applied, setApplied] = useState(initialQuery || saved.q)
  useEffect(() => { const t = setTimeout(() => setApplied(q), 250); return () => clearTimeout(t) }, [q])
  const s = useFetch<Contact[]>(`/contacts?q=${encodeURIComponent(applied)}${kind ? `&role=${kind}` : ''}`)
  const [adding, setAdding] = useState(arg === 'new' && can('manage_contacts'))
  const [f, setF] = useState<Form>(empty)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLSelectElement>(null)
  useEffect(() => { if (adding) first.current?.focus() }, [adding])

  const add = async () => {
    if (busy) return
    if (!f.name.trim()) return setErr(t(S.noName))
    setErr(''); setBusy(true)
    try {
      const r = await api<{ id: string }>('POST', '/contacts', clean(f))
      location.hash = `#/contact/${r.id}`
    } catch (e) { setErr(msg(e)); setBusy(false) }
  }
  const n = s.data?.length ?? 0
  const filtered = !!(applied || kind)
  return (
    <>
      <PageHeader title={t(S.contacts)} description={t({ en: 'Customers, suppliers and contractors in one place. Chat numbers saved here are how LARIS recognises who is writing.', ms: 'Pelanggan, pembekal dan kontraktor di satu tempat. Nombor sembang yang disimpan di sini membolehkan LARIS mengenali siapa yang menulis.', zh: '客户、供应商和承包商集中在一处。保存在这里的聊天号码让 LARIS 认出是谁在发消息。', ta: 'வாடிக்கையாளர்கள், சப்ளையர்கள், ஒப்பந்ததாரர்கள் ஒரே இடத்தில். இங்கே சேமிக்கப்பட்ட அரட்டை எண்கள் மூலம் யார் எழுதுகிறார்கள் என்பதை LARIS அறிகிறது.' })}
        actions={<>
          {can('export_contacts') && !MOCK && <button type="button" className="btn" onClick={() => download('/export/contacts.csv', 'contacts.csv').catch(e => setErr(msg(e)))}>{t({ en: 'Export contacts (csv)', ms: 'Eksport kenalan (csv)', zh: '导出联系人 (csv)', ta: 'தொடர்புகளை ஏற்றுமதி செய் (csv)' })}</button>}
          <button type="button" data-guide="ct-add" className={`btn ${adding ? '' : 'btn-primary'}`} aria-expanded={adding} {...(can('manage_contacts') ? gate(() => setAdding(!adding)) : needs('manage_contacts'))}>{t({ en: 'Add contact', ms: 'Tambah kenalan', zh: '添加联系人', ta: 'தொடர்பைச் சேர்' })}</button>
        </>} />
      <div data-guide="ct-tabs"><Tabs label={t({ en: 'Filter by type', ms: 'Tapis mengikut jenis', zh: '按类型筛选', ta: 'வகை வாரியாக வடிகட்டு' })} value={kind} options={KINDS.map(([k, x]) => ({ value: k, label: t(x) }))} onChange={v => setKind(v as Kind | '')} /></div>
      <FilterBar label={t({ en: 'Contact search', ms: 'Carian kenalan', zh: '搜索联系人', ta: 'தொடர்பு தேடல்' })} search={{ value: q, onChange: setQ, label: t({ en: 'Search name, number, email, notes', ms: 'Cari nama, nombor, e-mel, nota', zh: '搜索姓名、号码、电子邮件、备注', ta: 'பெயர், எண், மின்னஞ்சல், குறிப்புகளைத் தேடு' }) }}
        chips={q ? [{ label: t({ en: `Search: ${q}`, ms: `Carian: ${q}`, zh: `搜索：${q}`, ta: `தேடல்: ${q}` }), onRemove: () => setQ('') }] : []} />
      {adding && (
        <form data-guide="ct-form" className="card mb-4 grid gap-3" onSubmit={e => { e.preventDefault(); add() }} aria-label={t({ en: 'Add contact', ms: 'Tambah kenalan', zh: '添加联系人', ta: 'தொடர்பைச் சேர்' })}>
          <Fields f={f} set={setF} kind kindRef={first} />
          {err && <p role="alert" className="text-sm text-warn">{err}</p>}
          <div className="flex gap-2"><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t(S.saving) : t({ en: 'Save contact', ms: 'Simpan kenalan', zh: '保存联系人', ta: 'தொடர்பைச் சேமி' })}</button>
            <button type="button" className="btn" onClick={() => { setAdding(false); setErr('') }}>{t(S.cancel)}</button></div>
        </form>
      )}
      {err && !adding && <p role="alert" className="mb-2 text-sm text-warn">{err}</p>}
      <p role="status" className="sr-only">{s.data ? t({ en: `${n} ${n === 1 ? 'contact' : 'contacts'} found`, ms: `${n} kenalan ditemui`, zh: `找到 ${n} 位联系人`, ta: `${n} தொடர்புகள் கிடைத்தன` }) : ''}</p>
      <Async s={s} rows={8} shape="table" empty={!n} emptyText={filtered ? t({ en: 'No contact matches.', ms: 'Tiada kenalan sepadan.', zh: '没有匹配的联系人。', ta: 'பொருந்தும் தொடர்பு இல்லை.' }) : t({ en: 'No contacts yet.', ms: 'Belum ada kenalan.', zh: '还没有联系人。', ta: 'இன்னும் தொடர்புகள் இல்லை.' })}
        emptyHint={filtered ? t({ en: 'Try fewer words or another type.', ms: 'Cuba kurangkan perkataan atau jenis lain.', zh: '试试更少的字词或其他类型。', ta: 'குறைவான சொற்கள் அல்லது வேறு வகையை முயற்சிக்கவும்.' }) : t({ en: 'Add your first supplier or customer. Saved chat numbers let LARIS recognise who is writing.', ms: 'Tambah pembekal atau pelanggan pertama anda. Nombor sembang yang disimpan membolehkan LARIS mengenali siapa yang menulis.', zh: '添加您的第一位供应商或客户。保存的聊天号码让 LARIS 认出是谁在发消息。', ta: 'உங்கள் முதல் சப்ளையர் அல்லது வாடிக்கையாளரைச் சேர்க்கவும். சேமித்த அரட்டை எண்கள் மூலம் யார் எழுதுகிறார்கள் என்பதை LARIS அறிகிறது.' })}
        emptyAction={filtered ? { label: t({ en: 'Clear search', ms: 'Kosongkan carian', zh: '清除搜索', ta: 'தேடலை அழி' }), onClick: () => { setQ(''); setApplied(''); setKind('') } } : can('manage_contacts') ? { label: t({ en: 'Add the first contact', ms: 'Tambah kenalan pertama', zh: '添加第一位联系人', ta: 'முதல் தொடர்பைச் சேர்' }), onClick: () => setAdding(true) } : undefined}>
        <div data-guide="ct-list"><DataTable label={t(S.contacts)} caption={t(S.contacts)} rows={s.data ?? []} rowKey={c => c.id} cols={cols(owner)} /></div>
      </Async>
    </>
  )
}

export function ContactDetail({ id, owner }: { id: string; owner: boolean }) {
  useLang()
  const s = useFetch<ContactDetail>(`/contacts/${id}`)
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState<Form>(empty)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const c = s.data
  const start = () => {
    if (!c) return
    setF({ role: c.role, name: c.name, contact: c.contact ?? '', email: c.email ?? '', attention: c.attention ?? '', ssm_no: c.ssm_no ?? '', sst_no: c.sst_no ?? '', address: c.address ?? '', notes: c.notes ?? '' })
    setEditing(true)
  }
  const save = async () => {
    if (busy) return
    if (!f.name.trim()) return setErr(t({ en: 'A contact needs a name.', ms: 'Kenalan memerlukan nama.', zh: '联系人必须有姓名。', ta: 'தொடர்புக்கு ஒரு பெயர் தேவை.' }))
    setErr(''); setBusy(true)
    const { role: _role, ...body0 } = clean(f) as Form
    const body: Partial<Form> = { ...body0 }
    if (c?.role === 'supplier' && !can('edit_supplier_contacts')) { delete body.name; delete body.contact }  // not ours to change: the server would answer 403
    try { await api('POST', `/contacts/${id}`, body); setEditing(false); toast(t({ en: 'Contact saved.', ms: 'Kenalan disimpan.', zh: '联系人已保存。', ta: 'தொடர்பு சேமிக்கப்பட்டது.' })); s.reload() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  const row = (k: string, v: string | null) => v ? <div><dt className="text-sm text-muted">{k}</dt><dd>{v}</dd></div> : null
  return (
    <>
      {!c && <PageHeader crumbs={[{ href: '#/contacts', label: t(S.contacts) }]} />}
      <Async s={s} empty={false} rows={4}>
        {c && <>
          <PageHeader crumbs={[{ href: '#/contacts', label: t(S.contacts) }, { label: c.name }]} title={c.name} status={<span className="badge">{t(KIND_ONE[c.role])}</span>}
            meta={<>{c.contact && <span>{c.contact}</span>}{c.email && <span>{c.email}</span>}
              <span className="text-muted">{t({ en: `${c.documents} ${c.documents === 1 ? 'document' : 'documents'}`, ms: `${c.documents} dokumen`, zh: `${c.documents} 份文件`, ta: `${c.documents} ஆவணங்கள்` })}{owner && c.value && Number(c.value) > 0 ? ` · ${t({ en: `${rm(c.value)} in total`, ms: `${rm(c.value)} jumlah`, zh: `共 ${rm(c.value)}`, ta: `மொத்தம் ${rm(c.value)}` })}` : ''}</span></>}
            actions={!editing && <button type="button" className="btn" {...needs('manage_contacts', start)}>{t({ en: `Edit ${c.name}`, ms: `Sunting ${c.name}`, zh: `编辑 ${c.name}`, ta: `${c.name} ஐத் திருத்து` })}</button>} />
          {editing ? (
            <form className="card mt-3 grid gap-3" onSubmit={e => { e.preventDefault(); save() }} aria-label={t({ en: 'Edit contact', ms: 'Sunting kenalan', zh: '编辑联系人', ta: 'தொடர்பைத் திருத்து' })}>
              <Fields f={f} set={setF} kind={false} lock={c.role === 'supplier' && !can('edit_supplier_contacts')} />
              {err && <p role="alert" className="text-sm text-warn">{err}</p>}
              <div className="flex gap-2"><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t(S.saving) : t({ en: 'Save changes', ms: 'Simpan perubahan', zh: '保存更改', ta: 'மாற்றங்களைச் சேமி' })}</button>
                <button type="button" className="btn" onClick={() => setEditing(false)}>{t(S.cancel)}</button></div>
            </form>
          ) : (
            <section className="card mt-3" aria-label={t({ en: 'Details', ms: 'Butiran', zh: '详细信息', ta: 'விவரங்கள்' })}>
              <dl className="grid gap-3 sm:grid-cols-2">
                {row(t({ en: 'WhatsApp or Telegram', ms: 'WhatsApp atau Telegram', zh: 'WhatsApp 或 Telegram', ta: 'WhatsApp அல்லது Telegram' }), c.contact)}{row(t({ en: 'Email', ms: 'E-mel', zh: '电子邮件', ta: 'மின்னஞ்சல்' }), c.email)}{row(t({ en: 'Person to contact', ms: 'Orang untuk dihubungi', zh: '联系人', ta: 'தொடர்பு கொள்ள வேண்டியவர்' }), c.attention)}
                {row(t({ en: 'SSM number', ms: 'Nombor SSM', zh: 'SSM 号码', ta: 'SSM எண்' }), c.ssm_no)}{row(t({ en: 'SST number', ms: 'Nombor SST', zh: 'SST 号码', ta: 'SST எண்' }), c.sst_no)}{row(t({ en: 'Address', ms: 'Alamat', zh: '地址', ta: 'முகவரி' }), c.address)}
              </dl>
              {c.notes && <p className="mt-3 whitespace-pre-wrap border-t border-soft pt-3 text-sm">{c.notes}</p>}
              {!c.contact && !c.email && !c.attention && !c.address && !c.notes && <p className="text-muted">{t({ en: 'No details saved yet.', ms: 'Belum ada butiran disimpan.', zh: '尚未保存任何详细信息。', ta: 'இன்னும் விவரங்கள் சேமிக்கப்படவில்லை.' })}</p>}
            </section>
          )}
          {c.current_costs && c.current_costs.length > 0 && (
            <section className="mt-6" aria-labelledby="costs">
              <h2 id="costs" className="mb-3 text-md font-semibold">{t({ en: 'What they charge now', ms: 'Caj semasa mereka', zh: '他们目前的报价', ta: 'அவர்கள் இப்போது வசூலிப்பது' })}</h2>
              <DataTable label={t({ en: 'Current costs table', ms: 'Jadual kos semasa', zh: '当前成本表', ta: 'தற்போதைய செலவு அட்டவணை' })} caption={t({ en: `Current supplier costs for ${c.name}`, ms: `Kos pembekal semasa untuk ${c.name}`, zh: `${c.name} 的当前供应商成本`, ta: `${c.name} க்கான தற்போதைய சப்ளையர் செலவுகள்` })} rows={c.current_costs} rowKey={x => x.item_key} cols={COSTS()} />
            </section>
          )}
          <section className="mt-6" aria-labelledby="docs">
            <h2 id="docs" className="mb-3 text-md font-semibold">{t(S.documents)}</h2>
            {c.recent_documents.length === 0 ? <EmptyState title={t({ en: `No documents with ${c.name} yet.`, ms: `Belum ada dokumen dengan ${c.name}.`, zh: `还没有与 ${c.name} 相关的文件。`, ta: `${c.name} உடன் இன்னும் ஆவணங்கள் இல்லை.` })} /> : (
              <ul className="divide-y divide-hairline glass-lite">
                {c.recent_documents.map(d => (
                  <li key={d.id}><a className="row group" href={`#/doc/${d.id}`}>
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-semibold text-ink group-hover:underline">{d.doc_no ?? t({ en: 'No document number', ms: 'Tiada nombor dokumen', zh: '无文件编号', ta: 'ஆவண எண் இல்லை' })}</span>
                      <span className="num text-sm">{d.total ? rm(d.total) : ''}</span></span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-sm"><Status v={d.status} /><span className="text-muted">{d.direction === 'in' ? t({ en: 'Received', ms: 'Diterima masuk', zh: '已收到', ta: 'பெறப்பட்டது' }) : t({ en: 'Sent', ms: 'Dihantar', zh: '已发送', ta: 'அனுப்பப்பட்டது' })}</span></span>
                  </a></li>
                ))}
              </ul>
            )}
          </section>
          <PersonData id={id} name={c.name} customer={c.role === 'customer'} onDone={s.reload} />
        </>}
      </Async>
    </>
  )
}

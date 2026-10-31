import { useState } from 'react'
import { can, canOpen } from './api'
import type { DocSummary, Me, Settings } from './api'
import { canUpload } from './Listings'
import { Async, EmptyState, PageHeader, Status, rm, useFetch } from './ui'
import { MoreMenu } from './kit'
import { CountUp, Metric, Pipeline, Ring, StatRows, Tile, TileHead, TileIcon } from './dash'
import { Icon } from './icons'
import { areaTiles } from './Areas'
import { LiveOrbit } from './TradeOrbit'
import { BentoGrid } from './Bento'
import type { BentoPreset, BentoTile } from './Bento'
import { t, useLang } from './i18n'
import type { Text } from './i18n'
import { tx } from './strings'

const N = {
  head: { en: 'Needs you', ms: 'Perlukan anda', zh: '需要您处理', ta: 'உங்கள் கவனம் தேவை' },
  review: { en: 'quotes to review', ms: 'sebut harga untuk disemak', zh: '份报价待审核', ta: 'மதிப்பாய்வுக்கான விலைப்புள்ளிகள்' },
  replies: { en: 'customer replies to record', ms: 'balasan pelanggan untuk direkod', zh: '条客户回复待记录', ta: 'பதிவு செய்ய வேண்டிய வாடிக்கையாளர் பதில்கள்' },
  chase: { en: 'quotes waiting for a reply', ms: 'sebut harga menunggu balasan', zh: '份报价等待回复', ta: 'பதிலுக்காகக் காத்திருக்கும் விலைப்புள்ளிகள்' },
  late: { en: 'jobs are overdue', ms: 'kerja lewat tempoh', zh: '项工单已逾期', ta: 'வேலைகள் காலம் கடந்துள்ளன' },
  go: { en: 'Open', ms: 'Buka', zh: '打开', ta: 'திற' },
  clear: { en: 'All clear. Nothing needs you right now.', ms: 'Semua jelas. Tiada yang perlukan anda sekarang.', zh: '一切就绪，目前没有需要您处理的事项。', ta: 'எல்லாம் சரி. இப்போது எதுவும் தேவையில்லை.' },
}
// "Needs you": at most three one-tap items, worked out from the dashboard counts the page already has.
function NeedsYou({ d }: { d: { needs_review: number; customer_replies: unknown[]; followups_pending?: number; jobs_overdue?: number | null } }) {
  useLang()
  const items = [
    { n: d.needs_review, text: N.review, href: '#/tracker/review', icon: 'tracker' as const },
    { n: d.customer_replies.length, text: N.replies, href: '#/tracker', icon: 'ask' as const },
    { n: d.followups_pending ?? 0, text: N.chase, href: '#/followups', icon: 'alerts' as const },
    { n: d.jobs_overdue ?? 0, text: N.late, href: '#/jobs?overdue', icon: 'jobs' as const },
  ].filter(i => i.n > 0).slice(0, 3)
  return (
    <section aria-label={t(N.head)} className="glass-lite grid content-start gap-2 p-3" data-guide="needs-you">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{t(N.head)}</h2>
      {items.length === 0 ? <p className="flex items-center gap-2 text-sm"><Icon name="check" className="size-4 text-accent" />{t(N.clear)}</p> : (
        <ul className="grid gap-2">
          {items.map(i => <li key={i.href} className="flex items-center justify-between gap-3 rounded-ui border border-hairline px-3 py-2">
            <span className="flex min-w-0 items-center gap-2 text-sm"><Icon name={i.icon} className="size-4 shrink-0 text-accent" /><span><b className="tabular-nums">{i.n}</b> {t(i.text)}</span></span>
            <a className="btn btn-primary shrink-0" href={i.href}>{t(N.go)}</a></li>)}
        </ul>)}
    </section>
  )
}

const S = {
  addSupplier: { en: 'Add a supplier', ms: 'Tambah pembekal', zh: '添加供应商', ta: 'சப்ளையரைச் சேர்' },
  addSupplierHint: { en: 'Suppliers are who you buy from and ask for prices.', ms: 'Pembekal ialah pihak yang anda beli daripadanya dan tanya harga.', zh: '供应商是您采购并询价的对象。', ta: 'சப்ளையர்கள் என்பவர்கள் நீங்கள் வாங்கும், விலை கேட்கும் தரப்பினர்.' },
  upOrAsk: { en: 'Upload or ask for a quote', ms: 'Muat naik atau minta sebut harga', zh: '上传或询问报价', ta: 'மேற்கோளைப் பதிவேற்று அல்லது கேள்' },
  upOrAskHint: { en: 'Upload a supplier quote, or photograph an item and ask suppliers.', ms: 'Muat naik sebut harga pembekal, atau ambil gambar item dan tanya pembekal.', zh: '上传供应商报价，或拍下商品照片向供应商询价。', ta: 'சப்ளையர் மேற்கோளைப் பதிவேற்றவும், அல்லது பொருளைப் படம் எடுத்து சப்ளையர்களிடம் கேட்கவும்.' },
  org: { en: 'Set your organisation details', ms: 'Tetapkan butiran organisasi anda', zh: '设置您的机构资料', ta: 'உங்கள் நிறுவன விவரங்களை அமை' },
  orgHint: { en: 'Address and registration numbers are printed on your quotes.', ms: 'Alamat dan nombor pendaftaran dicetak pada sebut harga anda.', zh: '地址和注册号码会印在您的报价单上。', ta: 'முகவரியும் பதிவு எண்களும் உங்கள் மேற்கோள்களில் அச்சிடப்படும்.' },
  invite: { en: 'Invite a team member', ms: 'Jemput ahli pasukan', zh: '邀请团队成员', ta: 'குழு உறுப்பினரை அழை' },
  inviteHint: { en: 'Give a colleague their own sign-in.', ms: 'Beri rakan sekerja log masuk sendiri.', zh: '为同事创建专属登录账号。', ta: 'சக ஊழியருக்கு தனி உள்நுழைவை வழங்கு.' },
  getStarted: { en: 'Get started', ms: 'Mulakan', zh: '快速入门', ta: 'தொடங்குங்கள்' },
  hideList: { en: 'Hide this checklist', ms: 'Sembunyikan senarai semak ini', zh: '隐藏此清单', ta: 'இந்தச் சரிபார்ப்புப் பட்டியலை மறை' },
  done: { en: '(done)', ms: '(selesai)', zh: '（已完成）', ta: '(முடிந்தது)' },
  catalogPhoto: { en: 'Catalog photo', ms: 'Foto katalog', zh: '目录照片', ta: 'பட்டியல் படம்' },
  newContact: { en: 'New contact', ms: 'Kenalan baharu', zh: '新建联系人', ta: 'புதிய தொடர்பு' },
  uploadQuote: { en: 'Upload quote', ms: 'Muat naik sebut harga', zh: '上传报价', ta: 'மேற்கோளைப் பதிவேற்று' },
  details: { en: 'Details', ms: 'Butiran', zh: '详情', ta: 'விவரங்கள்' },
  toReview: { en: 'To review', ms: 'Perlu semakan', zh: '待审核', ta: 'மதிப்பாய்வுக்கு' },
  costRise: { en: 'Hit by a cost rise', ms: 'Terkesan kenaikan kos', zh: '受成本上涨影响', ta: 'செலவு உயர்வால் பாதிக்கப்பட்டவை' },
  waitReply: { en: 'Waiting for a reply', ms: 'Menunggu balasan', zh: '等待回复', ta: 'பதிலுக்காகக் காத்திருப்பவை' },
  needsPerson: { en: 'Needs a person', ms: 'Perlukan tindakan', zh: '需要人工处理', ta: 'ஒருவரின் கவனம் தேவை' },
  itemWaiting: { en: 'item is waiting on you', ms: 'item menunggu tindakan anda', zh: '项事务等待您处理', ta: 'உருப்படி உங்களுக்காகக் காத்திருக்கிறது' },
  itemsWaiting: { en: 'items are waiting on you', ms: 'item menunggu tindakan anda', zh: '项事务等待您处理', ta: 'உருப்படிகள் உங்களுக்காகக் காத்திருக்கின்றன' },
  nothingWaiting: { en: 'Nothing is waiting on you.', ms: 'Tiada yang menunggu anda.', zh: '没有等待您处理的事项。', ta: 'உங்களுக்காக எதுவும் காத்திருக்கவில்லை.' },
  openQuotes: { en: 'Open quotes', ms: 'Sebut harga terbuka', zh: '未结报价', ta: 'திறந்த மேற்கோள்கள்' },
  openQuotesHint: { en: 'Sent and not yet answered', ms: 'Dihantar dan belum dijawab', zh: '已发送，尚未答复', ta: 'அனுப்பப்பட்டு, இன்னும் பதிலளிக்கப்படவில்லை' },
  marginRisk: { en: 'Margin at risk', ms: 'Margin berisiko', zh: '风险利润', ta: 'ஆபத்திலுள்ள மார்ஜின்' },
  dueToday: { en: 'Due today', ms: 'Tamat hari ini', zh: '今日到期', ta: 'இன்று முடிவு' },
  jobsDueToday: { en: 'Jobs due today', ms: 'Kerja tamat hari ini', zh: '今日到期工单', ta: 'இன்று முடிய வேண்டிய வேலைகள்' },
  speed: { en: 'Speed to quote', ms: 'Kelajuan sebut harga', zh: '报价速度', ta: 'மேற்கோள் வேகம்' },
  min: { en: 'min', ms: 'min', zh: '分钟', ta: 'நிமி' },
  replies: { en: 'Customer replies', ms: 'Balasan pelanggan', zh: '客户回复', ta: 'வாடிக்கையாளர் பதில்கள்' },
  repliedTitle: { en: 'Customers who replied to a quote', ms: 'Pelanggan yang membalas sebut harga', zh: '回复报价的客户', ta: 'மேற்கோளுக்குப் பதிலளித்த வாடிக்கையாளர்கள்' },
  repliedNote: { en: 'Only you can accept or decline. Open the quote to record it.', ms: 'Hanya anda boleh menerima atau menolak. Buka sebut harga untuk merekodkannya.', zh: '只有您可以接受或拒绝。请打开报价单进行记录。', ta: 'நீங்கள் மட்டுமே ஏற்கவோ நிராகரிக்கவோ முடியும். பதிவு செய்ய மேற்கோளைத் திறக்கவும்.' },
  yes: { en: 'Looks like a yes', ms: 'Nampaknya ya', zh: '看来是同意', ta: 'ஆம் போல் தெரிகிறது' },
  no: { en: 'Looks like a no', ms: 'Nampaknya tidak', zh: '看来是拒绝', ta: 'இல்லை போல் தெரிகிறது' },
  latest: { en: 'Latest documents', ms: 'Dokumen terkini', zh: '最新文档', ta: 'சமீபத்திய ஆவணங்கள்' },
  openTracker: { en: 'Open tracker', ms: 'Buka penjejak', zh: '打开报价追踪', ta: 'கண்காணிப்பைத் திற' },
  noDocs: { en: 'No documents yet.', ms: 'Belum ada dokumen.', zh: '暂无文档。', ta: 'இன்னும் ஆவணங்கள் இல்லை.' },
  noDocsHint: { en: 'Quotes you upload or send are listed here.', ms: 'Sebut harga yang anda muat naik atau hantar disenaraikan di sini.', zh: '您上传或发送的报价会列在这里。', ta: 'நீங்கள் பதிவேற்றிய அல்லது அனுப்பிய மேற்கோள்கள் இங்கே பட்டியலிடப்படும்.' },
  uploadAQuote: { en: 'Upload a quote', ms: 'Muat naik sebut harga', zh: '上传报价', ta: 'மேற்கோளைப் பதிவேற்று' },
  noDocNo: { en: 'No document number', ms: 'Tiada nombor dokumen', zh: '无文档编号', ta: 'ஆவண எண் இல்லை' },
  openBoard: { en: 'Open board', ms: 'Buka papan', zh: '打开看板', ta: 'பலகையைத் திற' },
  todo: { en: 'To do', ms: 'Perlu dibuat', zh: '待办', ta: 'செய்ய வேண்டியவை' },
  doing: { en: 'In progress', ms: 'Sedang berjalan', zh: '进行中', ta: 'நடந்து கொண்டிருக்கிறது' },
  done2: { en: 'Done', ms: 'Selesai', zh: '已完成', ta: 'முடிந்தது' },
  overdueJobs: { en: 'Overdue jobs', ms: 'Kerja lewat tempoh', zh: '逾期工单', ta: 'காலம் கடந்த வேலைகள்' },
  onTrack: { en: 'On schedule', ms: 'Ikut jadual', zh: '日程', ta: 'அட்டவணை' },
  openTrack: { en: 'Open Schedule', ms: 'Buka Jadual', zh: '打开日程', ta: 'அட்டவணையைத் திற' },
  overdueItems: { en: 'Overdue items', ms: 'Item lewat tempoh', zh: '逾期项目', ta: 'காலம் கடந்த உருப்படிகள்' },
  waitSupplier: { en: 'Waiting for a supplier', ms: 'Menunggu pembekal', zh: '等待供应商', ta: 'சப்ளையருக்காகக் காத்திருப்பு' },
  waitApproval: { en: 'Quotes waiting for approval', ms: 'Sebut harga menunggu kelulusan', zh: '待批准报价', ta: 'அங்கீகாரத்திற்காகக் காத்திருக்கும் மேற்கோள்கள்' },
  book: { en: 'Contact book', ms: 'Buku kenalan', zh: '通讯录', ta: 'தொடர்பு புத்தகம்' },
  openContacts: { en: 'Open all contacts', ms: 'Buka semua kenalan', zh: '打开全部联系人', ta: 'எல்லா தொடர்புகளையும் திற' },
  customers: { en: 'Customers', ms: 'Pelanggan', zh: '客户', ta: 'வாடிக்கையாளர்கள்' },
  contractors: { en: 'Contractors', ms: 'Kontraktor', zh: '承包商', ta: 'ஒப்பந்ததாரர்கள்' },
  recent: { en: 'Recently active', ms: 'Aktif baru-baru ini', zh: '最近活跃', ta: 'சமீபத்தில் செயலில்' },
  noContacts: { en: 'Contacts show up here once you exchange documents with them.', ms: 'Kenalan akan muncul di sini selepas anda bertukar dokumen dengan mereka.', zh: '与联系人交换文档后，他们会显示在这里。', ta: 'தொடர்புகளுடன் ஆவணங்களைப் பரிமாறிய பின் அவர்கள் இங்கே தோன்றுவார்கள்.' },
} satisfies Record<string, Text>
// Contact role from the server, shown in the current language when it is a known one.
const ROLE: Record<string, Text> = {
  customer: { en: 'customer', ms: 'pelanggan', zh: '客户', ta: 'வாடிக்கையாளர்' },
  supplier: { en: 'supplier', ms: 'pembekal', zh: '供应商', ta: 'சப்ளையர்' },
  contractor: { en: 'contractor', ms: 'kontraktor', zh: '承包商', ta: 'ஒப்பந்ததாரர்' },
}

interface Dash {
  contacts: { customers: number; suppliers: number; contractors: number }
  needs_review: number; open_quotes: number; jobs: { todo: number; doing: number; done: number }
  recent_contacts: { id: string; name: string; role: string; last_activity: string }[]
  recent_documents: DocSummary[]
  customer_replies: { document_id: string; doc_no: string; customer: string; text: string; at: string; kind: 'accept' | 'decline' | null }[]
  stale_quotes?: number; stale_margin_lost?: string; followups_pending?: number
  jobs_overdue?: number | null; jobs_due_today?: number | null
  quote_speed?: { median_minutes: number | null; quotes: number; days: number }
  track?: { overdue?: number | null; waiting_supplier?: number | null; waiting_approval?: number | null } | null
}
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const DISMISS_KEY = 'laris.getstarted.dismissed'
const wasDismissed = () => { try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false } }

// First-run checklist, worked out from data the page already has (dashboard counts) plus Settings and Team for the owner.
// Hidden when everything is done or when dismissed (remembered on this device).
function GetStarted({ d, owner }: { d: Dash; owner: boolean }) {
  useLang()
  const [hidden, setHidden] = useState(wasDismissed)
  const settings = useFetch<Settings>(owner && !hidden ? '/settings' : null)
  const users = useFetch<unknown[]>(owner && !hidden ? '/users' : null)
  if (hidden || (owner && (settings.loading || users.loading))) return null
  const quoteHref = can('upload_documents') ? '#/tracker/upload' : canOpen('ask', owner) ? '#/ask' : ''
  const steps: { text: string; hint: string; href: string; done: boolean }[] = [
    ...(can('edit_supplier_contacts') ? [{ text: t(S.addSupplier), hint: t(S.addSupplierHint), href: '#/contacts/new', done: d.contacts.suppliers > 0 }] : []),
    ...(quoteHref ? [{ text: t(S.upOrAsk), hint: t(S.upOrAskHint), href: quoteHref, done: d.recent_documents.length > 0 || d.open_quotes > 0 }] : []),
    ...(owner ? [
      { text: t(S.org), hint: t(S.orgHint), href: '#/settings', done: !!(settings.data?.address || settings.data?.ssm_no || settings.data?.bank_details) },
      { text: t(S.invite), hint: t(S.inviteHint), href: '#/team', done: (users.data?.length ?? 0) > 1 },
    ] : []),
  ]
  const n = steps.filter(x => x.done).length
  if (n === steps.length) return null
  return (
    <section aria-labelledby="gs" className="card mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="gs" className="text-md font-semibold">{t(S.getStarted)} <span className="text-sm font-normal text-muted">{t({ en: `${n} of ${steps.length} done`, ms: `${n} daripada ${steps.length} selesai`, zh: `已完成 ${n}/${steps.length}`, ta: `${steps.length} இல் ${n} முடிந்தது` })}</span></h2>
        <button type="button" className="btn btn-sm" onClick={() => { try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* storage blocked: hidden for this visit only */ } setHidden(true) }}>{t(S.hideList)}</button>
      </div>
      <ol className="mt-2 grid gap-1">
        {steps.map((x, k) => (
          <li key={x.text} className="flex items-start gap-3 py-1">
            <span aria-hidden="true" className="w-5 shrink-0 pt-0.5 text-sm tabular-nums text-muted">{x.done ? <Icon name="check" className="size-4 text-accent" /> : `${k + 1}.`}</span>
            <span className="min-w-0">
              {x.done ? <span className="text-muted">{x.text}<span className="sr-only"> {t(S.done)}</span></span>
                : <a className="inline-flex min-h-8 items-center font-semibold hover:underline" href={x.href}>{x.text}</a>}
              {!x.done && <span className="block text-sm text-muted">{x.hint}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

const rowLink = 'font-semibold text-ink group-hover:underline'

const money = (n: number) => rm(String(n))

// Every number links to the list it counts.
export function HomeView({ me, owner }: { me: Me; owner: boolean }) {
  useLang()
  const s = useFetch<Dash>('/dashboard')
  // One primary (rightmost), at most two secondary beside it; anything more goes in the More menu.
  const secondary = [
    ...(canOpen('ask', owner) ? [{ href: '#/ask', icon: 'ask' as const, text: tx('nav.ask') }] : []),
    ...(canUpload(me) ? [{ href: '#/catalog', icon: 'camera' as const, text: t(S.catalogPhoto) }] : []),
    ...(can('manage_contacts') ? [{ href: '#/contacts/new', icon: 'plus' as const, text: t(S.newContact) }] : []),
  ]
  const shown = secondary.length > 2 ? secondary.slice(0, 1) : secondary
  const rest = secondary.slice(shown.length)
  const actions = <>
    {shown.map(a => <a key={a.href} href={a.href} className="btn gap-2"><Icon name={a.icon} className="size-4" />{a.text}</a>)}
    {rest.length > 0 && <MoreMenu>{rest.map(a => <a key={a.href} href={a.href} className="sidelink"><Icon name={a.icon} />{a.text}</a>)}</MoreMenu>}
    {can('upload_documents') && <a href="#/tracker/upload" className="btn btn-primary gap-2"><Icon name="upload" className="size-4" />{t(S.uploadQuote)}</a>}
  </>
  return (
    <>
      <PageHeader title={tx('nav.home')} description={t({ en: `Hello, ${me.name}. Here is where things stand.`, ms: `Helo, ${me.name}. Beginilah keadaan semasa.`, zh: `您好，${me.name}。以下是目前的情况。`, ta: `வணக்கம், ${me.name}. தற்போதைய நிலை இதோ.` })} actions={actions} />
      <Async s={s} empty={false} rows={4} shape="tiles">
        {s.data && <><GetStarted d={s.data} owner={owner} /><HomeTiles d={s.data} owner={owner} userId={me.id} /></>}
      </Async>
    </>
  )
}


// Home = a bento (Bento.tsx) of tiles: the four areas (Areas.tsx) and the number tiles below. Which are shown, their order and size, come from a
// preset for the kind of person, then from whatever the person changed with "Edit layout" (saved on this device).
const PRESETS: BentoPreset[] = [
  { id: 'owner', label: { en: 'Owner', ms: 'Pemilik', zh: '老板', ta: 'உரிமையாளர்' }, tiles: ['needsyou', 'orbit', 'needs', 'quotes', 'margin', 'work', 'suppliers', 'insight', 'speed', 'latest', 'replies', 'audit'] },
  { id: 'operator', label: { en: 'Operator', ms: 'Operator', zh: '操作员', ta: 'இயக்குநர்' }, tiles: ['needsyou', 'needs', 'due', 'work', 'jobs', 'track', 'suppliers', 'contacts', 'latest'] },
  { id: 'accountant', label: { en: 'Accountant', ms: 'Akauntan', zh: '会计', ta: 'கணக்காளர்' }, tiles: ['needsyou', 'orbit', 'needs', 'margin', 'insight', 'replies', 'latest', 'track'] },
  { id: 'everything', label: { en: 'Everything', ms: 'Semua', zh: '全部', ta: 'அனைத்தும்' }, tiles: ['needsyou', 'orbit', 'needs', 'quotes', 'margin', 'due', 'speed', 'work', 'suppliers', 'insight', 'replies', 'latest', 'jobs', 'track', 'contacts', 'audit'] },
]

function HomeTiles({ d, owner, userId }: { d: Dash; owner: boolean; userId: string }) {
  useLang()
  const tiles = [...strip(d, owner), ...areaTiles(d, owner), ...homeTiles(d, owner)]
  return <BentoGrid tiles={tiles} storageKey={`laris.bento.home.${userId}`} presets={PRESETS} defaultPreset={owner ? 'owner' : 'operator'} />
}

// The two blocks from the UX slice. The Orbit shows what customers owe (receivables), so it needs record_payments (the route checks it) and view_costs (it shows what you owe suppliers).
function strip(d: Dash, owner: boolean): BentoTile[] {
  return [
    { id: 'needsyou', size: 'M', title: t(N.head), node: <NeedsYou d={d} /> },
    ...(owner || (can('record_payments') && can('view_costs')) ? [{ id: 'orbit', size: 'XL' as const, title: 'Trade Orbit', node: <section className="glass-lite p-3" aria-label="Trade Orbit"><LiveOrbit /></section> }] : []),
  ]
}

function homeTiles(d: Dash, owner: boolean): BentoTile[] {
  const attention = [
    { label: t(S.toReview), value: d.needs_review, href: '#/tracker/review' },
    ...(owner ? [{ label: t(S.costRise), value: d.stale_quotes ?? 0, href: '#/alerts' }] : []),
    ...(can('manage_followups') ? [{ label: t(S.waitReply), value: d.followups_pending ?? 0, href: '#/followups' }] : []),
  ]
  const waiting = attention.reduce((a, x) => a + x.value, 0)
  const stale = d.stale_quotes ?? 0
  const margin = stale ? Math.abs(Number(d.stale_margin_lost) || 0) : 0
  const speed = owner ? d.quote_speed : undefined
  const track = d.track && [d.track.overdue, d.track.waiting_supplier, d.track.waiting_approval].some(num) ? d.track : null
  const tiles: (BentoTile | false)[] = [
    { id: 'needs', size: 'L', title: t(S.needsPerson), node: (
      <Tile hero label={t(S.needsPerson)}>
        <div data-tour="home-stats" className="flex h-full flex-col">
          <h2 className="metric-label">{t(S.needsPerson)}</h2>
          <span className="metric metric-xl"><CountUp value={waiting} /></span>
          <span className="metric-hint">{waiting ? t(waiting === 1 ? S.itemWaiting : S.itemsWaiting) : t(S.nothingWaiting)}</span>
          <ul className="mt-auto grid grid-cols-1 gap-2 pt-6 sm:grid-cols-3">
            {attention.map(x => (
              <li key={x.label}><a className="hero-cell" href={x.href}>
                <span className="metric-label">{x.label}</span>
                <b className="text-xl tabular-nums"><CountUp value={x.value} /></b>
              </a></li>
            ))}
          </ul>
        </div>
      </Tile>
    ) },
    { id: 'quotes', size: 'S', title: t(S.openQuotes), node: (
      <Tile href="#/tracker/open">
          <TileIcon name="tracker" />
          <Metric label={t(S.openQuotes)} value={d.open_quotes} hint={t(S.openQuotesHint)} />
        </Tile>
    ) },
    owner && { id: 'margin', size: 'S', title: t(S.marginRisk), node: (
      <Tile href="#/alerts">
            <TileIcon name="alerts" warn={margin > 0} />
            <Metric label={t(S.marginRisk)} value={margin} format={money}
              pill={{ text: t({ en: `${stale} ${stale === 1 ? 'quote' : 'quotes'} hit by a cost rise`, ms: `${stale} sebut harga terkesan kenaikan kos`, zh: `${stale} 份报价受成本上涨影响`, ta: `${stale} மேற்கோள்கள் செலவு உயர்வால் பாதிக்கப்பட்டன` }), warn: stale > 0 }} />
          </Tile>
    ) },
    !owner && num(d.jobs_due_today) && { id: 'due', size: 'S', title: t(S.jobsDueToday), node: (
      <Tile href="#/jobs?view=agenda">
            <TileIcon name="clock" />
            <Metric label={t(S.jobsDueToday)} value={d.jobs_due_today} />
          </Tile>
    ) },
    !!speed && { id: 'speed', size: 'M', title: t(S.speed), node: (
      <Tile label={t(S.speed)} className="flex-row! flex-wrap items-center gap-5">
            {num(speed.median_minutes) ? <>
              <Ring fraction={1 - speed.median_minutes / 60}>
                <b className="block text-2xl leading-none tabular-nums"><CountUp value={speed.median_minutes} format={n => n.toFixed(1)} /></b>
                <span className="text-xs text-muted">{t(S.min)}</span>
              </Ring>
              <div className="min-w-0 flex-1 basis-48">
                <h2 className="text-md font-semibold tracking-tight">{t(S.speed)}</h2>
                <p className="mt-1 text-sm text-muted">{t({ en: `Median time to send a quote, across ${speed.quotes} ${speed.quotes === 1 ? 'quote' : 'quotes'} in the last ${speed.days} days. The ring is on a one-hour scale: fuller is faster.`, ms: `Masa median untuk menghantar sebut harga, merentas ${speed.quotes} sebut harga dalam ${speed.days} hari lalu. Gelung berskala satu jam: lebih penuh bermakna lebih pantas.`, zh: `发送报价的中位用时，统计过去 ${speed.days} 天的 ${speed.quotes} 份报价。圆环以一小时为刻度：越满越快。`, ta: `மேற்கோள் அனுப்ப ஆகும் இடைநிலை நேரம், கடந்த ${speed.days} நாட்களில் ${speed.quotes} மேற்கோள்களில். வளையம் ஒரு மணி நேர அளவில் உள்ளது: நிறைந்திருந்தால் வேகம் அதிகம்.` })}</p>
              </div>
            </> : <div>
              <h2 className="text-md font-semibold tracking-tight">{t(S.speed)}</h2>
              <p className="mt-1 text-sm text-muted">{t({ en: `No quotes sent in the last ${speed.days} days yet.`, ms: `Belum ada sebut harga dihantar dalam ${speed.days} hari lalu.`, zh: `过去 ${speed.days} 天尚未发送报价。`, ta: `கடந்த ${speed.days} நாட்களில் மேற்கோள் எதுவும் அனுப்பப்படவில்லை.` })}</p>
            </div>}
          </Tile>
    ) },
    d.customer_replies.length > 0 && { id: 'replies', size: 'M', title: t(S.repliedTitle), node: (
      <Tile label={t(S.replies)}>
          <TileHead title={t(S.repliedTitle)} />
          <p className="-mt-2 mb-2 text-sm text-muted">{t(S.repliedNote)}</p>
          <ul className="divide-y divide-hairline">
            {d.customer_replies.map((r, i) => (
              <li key={i}><a className="doc-row group" href={`#/doc/${r.document_id}`}>
                <span className="min-w-0">
                  <span className={rowLink}>{r.doc_no}</span> <span className="text-sm text-muted">{r.customer}</span>
                  <span className="block text-sm">"{r.text}"</span>
                </span>
                {r.kind && <span className={`pill mt-0 shrink-0 ${r.kind === 'decline' ? 'pill-warn' : ''}`}>{t(r.kind === 'accept' ? S.yes : S.no)}</span>}
              </a></li>
            ))}
          </ul>
        </Tile>
    ) },
    { id: 'latest', size: 'L', title: t(S.latest), node: (
      <Tile label={t(S.latest)}>
        <TileHead title={t(S.latest)} link={{ href: '#/tracker', label: t(S.openTracker) }} />
        {d.recent_documents.length === 0 ? <EmptyState title={t(S.noDocs)} hint={t(S.noDocsHint)} action={can('upload_documents') ? { label: t(S.uploadAQuote), href: '#/tracker/upload' } : undefined} /> : (
          <ul className="divide-y divide-hairline">
            {d.recent_documents.map(x => (
              <li key={x.id}><a className="doc-row group" href={`#/doc/${x.id}`}>
                <span className="min-w-0">
                  <span className={`block truncate ${rowLink}`}>{x.doc_no ?? t(S.noDocNo)}</span>
                  <span className="block truncate text-sm text-muted">{x.party.name}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-medium tabular-nums">{x.total ? rm(x.total) : ''}</span>
                  <Status v={x.status} />
                </span>
              </a></li>
            ))}
          </ul>
        )}
      </Tile>
    ) },
    { id: 'jobs', size: 'M', title: tx('nav.jobs'), node: (
      <Tile label={tx('nav.jobs')}>
        <TileHead title={tx('nav.jobs')} link={{ href: '#/jobs', label: t(S.openBoard) }} />
        <Pipeline label={tx('nav.jobs')} segments={[
          { label: t(S.todo), value: d.jobs.todo, tone: 1, href: '#/jobs' },
          { label: t(S.doing), value: d.jobs.doing, tone: 2, href: '#/jobs' },
          { label: t(S.done2), value: d.jobs.done, tone: 3, href: '#/jobs' },
        ]} />
        <div className="mt-3">
          <StatRows rows={[
            ...(num(d.jobs_overdue) ? [{ label: t(S.overdueJobs), value: d.jobs_overdue, href: '#/jobs?overdue', warn: d.jobs_overdue > 0 }] : []),
            ...(num(d.jobs_due_today) ? [{ label: t(S.dueToday), value: d.jobs_due_today, href: '#/jobs?view=agenda' }] : []),
          ]} />
        </div>
      </Tile>
    ) },
    !!track && { id: 'track', size: 'M', title: t(S.onTrack), node: (
      <Tile label={t(S.onTrack)}>
          <TileHead title={t(S.onTrack)} link={{ href: '#/track', label: t(S.openTrack) }} />
          <StatRows rows={[
            ...(num(track.overdue) ? [{ label: t(S.overdueItems), value: track.overdue, href: '#/track?overdue=1', warn: track.overdue > 0 }] : []),
            ...(num(track.waiting_supplier) ? [{ label: t(S.waitSupplier), value: track.waiting_supplier, href: '#/track?kind=rfq&stage=waiting' }] : []),
            ...(num(track.waiting_approval) ? [{ label: t(S.waitApproval), value: track.waiting_approval, href: '#/track?kind=quote&stage=draft' }] : []),
          ]} />
        </Tile>
    ) },
    { id: 'contacts', size: 'M', title: t(S.book), node: (
      <Tile label={t(S.book)}>
        <TileHead title={t(S.book)} link={{ href: '#/contacts', label: t(S.openContacts) }} />
        <Pipeline label={tx('nav.contacts')} segments={[
          { label: t(S.customers), value: d.contacts.customers, tone: 3 },
          { label: tx('nav.group.Suppliers'), value: d.contacts.suppliers, tone: 2 },
          { label: t(S.contractors), value: d.contacts.contractors, tone: 1 },
        ]} />
        <h3 className="mt-5 mb-1 text-sm font-semibold text-muted">{t(S.recent)}</h3>
        {d.recent_contacts.length === 0 ? <p className="text-sm text-muted">{t(S.noContacts)}</p> : (
          <ul className="divide-y divide-hairline">
            {d.recent_contacts.map(c => (
              <li key={c.id}><a className="doc-row group" href={`#/contact/${c.id}`}>
                <span className="flex min-w-0 items-center gap-3">
                  <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-tint text-sm font-semibold text-accent">{c.name.trim().charAt(0).toUpperCase()}</span>
                  <span className="min-w-0"><span className={`block truncate ${rowLink}`}>{c.name}</span><span className="block text-sm text-muted">{t({ en: `Last document ${c.last_activity.slice(0, 10)}`, ms: `Dokumen terakhir ${c.last_activity.slice(0, 10)}`, zh: `最近文档 ${c.last_activity.slice(0, 10)}`, ta: `கடைசி ஆவணம் ${c.last_activity.slice(0, 10)}` })}</span></span>
                </span>
                <span className="badge shrink-0">{ROLE[c.role] ? t(ROLE[c.role]) : c.role}</span>
              </a></li>
            ))}
          </ul>
        )}
      </Tile>
    ) },
  ]
  return tiles.filter((x): x is BentoTile => !!x)
}

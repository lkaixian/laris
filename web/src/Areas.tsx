import type { CSSProperties, ReactNode } from 'react'
import { can, canOpen } from './api'
import { useFetch } from './ui'
import { CountUp } from './dash'
import { Icon } from './icons'
import type { IconName } from './icons'
import { tx } from './strings'
import { locale, t, useLang } from './i18n'
import type { Text } from './i18n'
import type { BentoTile } from './Bento'

const S = {
  open: { en: 'Open', ms: 'Buka', zh: '打开', ta: 'திற' },
  workLead: { en: "From a customer's enquiry to a finished job. Each arrow is a stage; the number is how many are in it.", ms: 'Daripada pertanyaan pelanggan hingga kerja siap. Setiap anak panah ialah satu peringkat; nombor ialah bilangan di dalamnya.', zh: '从客户询价到完工。每个箭头是一个阶段，数字是该阶段的数量。', ta: 'வாடிக்கையாளர் விசாரணையிலிருந்து முடிந்த வேலை வரை. ஒவ்வொரு அம்புக்குறியும் ஒரு நிலை; எண் அதில் உள்ளவற்றின் எண்ணிக்கை.' },
  supLead: { en: 'The buying loop: ask, get replies, compare, and keep the best price in your cost book.', ms: 'Kitaran pembelian: tanya, terima balasan, bandingkan, dan simpan harga terbaik dalam buku kos anda.', zh: '采购循环：询价、收到回复、比价，并把最优价格存入成本簿。', ta: 'வாங்கும் சுழற்சி: கேள், பதில் பெறு, ஒப்பிடு, சிறந்த விலையை உங்கள் செலவுப் புத்தகத்தில் வைத்திரு.' },
  insLead: { en: 'What deserves a look today. Longer bars need more attention.', ms: 'Apa yang patut dilihat hari ini. Bar lebih panjang perlukan lebih perhatian.', zh: '今天值得关注的事项。条越长越需要关注。', ta: 'இன்று கவனிக்க வேண்டியவை. நீண்ட பட்டைகளுக்கு அதிக கவனம் தேவை.' },
  audLead: { en: 'Every change, who made it and when. One column per day; select it to see that day.', ms: 'Setiap perubahan, siapa yang membuatnya dan bila. Satu lajur sehari; pilih untuk melihat hari itu.', zh: '每项更改、更改人及时间。每天一列，选择即可查看当天。', ta: 'ஒவ்வொரு மாற்றமும், யார் செய்தார், எப்போது. ஒரு நாளுக்கு ஒரு நெடுவரிசை; அந்த நாளைக் காண தேர்ந்தெடுக்கவும்.' },
  workStages: { en: 'Work stages', ms: 'Peringkat kerja', zh: '工作阶段', ta: 'பணி நிலைகள்' },
  toReview: { en: 'To review', ms: 'Perlu semakan', zh: '待审核', ta: 'மதிப்பாய்வுக்கு' },
  quotesOpen: { en: 'Quotes open', ms: 'Sebut harga terbuka', zh: '未结报价', ta: 'திறந்த மேற்கோள்கள்' },
  jobsTodo: { en: 'Jobs to do', ms: 'Kerja perlu dibuat', zh: '待办工单', ta: 'செய்ய வேண்டிய வேலைகள்' },
  doing: { en: 'In progress', ms: 'Sedang berjalan', zh: '进行中', ta: 'நடந்து கொண்டிருக்கிறது' },
  done: { en: 'Done', ms: 'Selesai', zh: '已完成', ta: 'முடிந்தது' },
  supLoop: { en: 'Supplier loop', ms: 'Kitaran pembekal', zh: '供应商循环', ta: 'சப்ளையர் சுழற்சி' },
  suppliers: { en: 'suppliers', ms: 'pembekal', zh: '供应商', ta: 'சப்ளையர்கள்' },
  ask: { en: 'Ask', ms: 'Tanya', zh: '询价', ta: 'கேள்' },
  replies: { en: 'Replies', ms: 'Balasan', zh: '回复', ta: 'பதில்கள்' },
  compare: { en: 'Compare', ms: 'Bandingkan', zh: '比价', ta: 'ஒப்பிடு' },
  costBook: { en: 'Cost book', ms: 'Buku kos', zh: '成本簿', ta: 'செலவுப் புத்தகம்' },
  hit: { en: 'Quotes hit by a cost rise', ms: 'Sebut harga terkesan kenaikan kos', zh: '受成本上涨影响的报价', ta: 'செலவு உயர்வால் பாதிக்கப்பட்ட மேற்கோள்கள்' },
  marginRm: { en: 'Margin at risk (RM)', ms: 'Margin berisiko (RM)', zh: '风险利润 (RM)', ta: 'ஆபத்திலுள்ள மார்ஜின் (RM)' },
  approval: { en: 'Quotes waiting for approval', ms: 'Sebut harga menunggu kelulusan', zh: '待批准报价', ta: 'அங்கீகாரத்திற்காகக் காத்திருக்கும் மேற்கோள்கள்' },
  dueToday: { en: 'Jobs due today', ms: 'Kerja tamat hari ini', zh: '今日到期工单', ta: 'இன்று முடிய வேண்டிய வேலைகள்' },
  auditFail: { en: 'The audit log could not be loaded.', ms: 'Log audit tidak dapat dimuatkan.', zh: '无法加载审计日志。', ta: 'தணிக்கைப் பதிவை ஏற்ற முடியவில்லை.' },
  openIt: { en: 'Open it', ms: 'Bukanya', zh: '点此打开', ta: 'திறக்க' },
  noEntries: { en: 'No entries yet. Changes appear here as they happen.', ms: 'Belum ada entri. Perubahan muncul di sini apabila berlaku.', zh: '暂无记录。更改发生时会显示在这里。', ta: 'இன்னும் பதிவுகள் இல்லை. மாற்றங்கள் நடக்கும்போது இங்கே தோன்றும்.' },
} satisfies Record<string, Text>

// Home: the four areas of the sidebar (Work, Suppliers, Insight, Audit Log) as a glass bento, each with a small "smart art"
// picture of how that area works, so a new user sees the whole system at a glance. Every shape is a link to the list it counts.
// Numbers come from /dashboard (already loaded by Home) and, for the Audit Log tile, /audit/days.
// Each area is a tile for the bento shell (Bento.tsx); Home decides their order and size, so no column classes here.
export interface AreaData {
  needs_review: number; open_quotes: number; jobs: { todo: number; doing: number; done: number }
  contacts: { suppliers: number }
  stale_quotes?: number; stale_margin_lost?: string; followups_pending?: number
  jobs_overdue?: number | null; jobs_due_today?: number | null
  track?: { overdue?: number | null; waiting_supplier?: number | null; waiting_approval?: number | null } | null
}
const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function AreaHead({ icon, title, href, lead }: { icon: IconName; title: string; href: string; lead: string }) {
  useLang()
  return (
    <div className="mb-4 flex items-start gap-3">
      <span aria-hidden="true" className="glass-icon"><Icon name={icon} className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold tracking-tight"><a href={href} className="hover:underline">{title}</a></h2>
        <p className="text-sm text-muted">{lead}</p>
      </div>
      <a href={href} className="tile-more shrink-0">{t(S.open)}<Icon name="right" className="size-3.5" /><span className="sr-only"> {title}</span></a>
    </div>
  )
}

// Process (chevron) smart art: one arrow per stage, left to right; stacked top to bottom on a phone.
function Chevrons({ label, steps }: { label: string; steps: { label: string; value: number; href: string; warn?: boolean }[] }) {
  return (
    <ol className="chevrons" aria-label={label}>
      {steps.map((s, i) => (
        <li key={s.label} style={{ '--i': i } as CSSProperties}>
          <a href={s.href} className={`chev ${s.warn && s.value > 0 ? 'chev-warn' : ''}`}>
            <b className="text-xl tabular-nums leading-none"><CountUp value={s.value} /></b>
            <span className="text-xs font-semibold">{s.label}</span>
          </a>
        </li>
      ))}
    </ol>
  )
}

// Cycle smart art: four steps round a loop, the loop arrow drawn behind them.
function Cycle({ label, centre, steps }: { label: string; centre: ReactNode; steps: { label: string; value?: number; href: string }[] }) {
  return (
    <div className="cycle" role="group" aria-label={label}>
      <svg aria-hidden="true" viewBox="0 0 200 200" className="cycle-ring">
        <defs><marker id="cy-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor" /></marker></defs>
        {[0, 1, 2, 3].map(k => {
          const a0 = (-90 + k * 90 + 22) * Math.PI / 180, a1 = (-90 + k * 90 + 68) * Math.PI / 180
          return <path key={k} d={`M ${100 + 72 * Math.cos(a0)} ${100 + 72 * Math.sin(a0)} A 72 72 0 0 1 ${100 + 72 * Math.cos(a1)} ${100 + 72 * Math.sin(a1)}`} fill="none" stroke="currentColor" strokeWidth="3" markerEnd="url(#cy-arrow)" />
        })}
      </svg>
      <div className="cycle-centre">{centre}</div>
      <ol>
        {steps.map((s, i) => (
          <li key={s.label} className={`cycle-node cycle-${i}`}>
            <a href={s.href}><span className="cycle-num" aria-hidden="true">{i + 1}</span>{s.label}{s.value !== undefined && <b className="ml-1 tabular-nums">{s.value}</b>}</a>
          </li>
        ))}
      </ol>
    </div>
  )
}

// Bar smart art: one bar per measure, its length against the biggest.
function Bars({ label, rows }: { label: string; rows: { label: string; value: number; text?: string; href: string; warn?: boolean }[] }) {
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <ul className="grid gap-3" aria-label={label}>
      {rows.map(r => (
        <li key={r.label}><a href={r.href} className="block rounded-ui p-1 hover:bg-tint/60">
          <span className="flex items-baseline justify-between gap-2 text-sm"><span className="font-semibold">{r.label}</span><b className="tabular-nums">{r.text ?? r.value}</b></span>
          <span className="glass-bar mt-1" aria-hidden="true"><span className={r.warn && r.value > 0 ? 'glass-bar-warn' : ''} style={{ width: `${Math.max(4, (r.value / max) * 100)}%` }} /></span>
        </a></li>
      ))}
    </ul>
  )
}

// Timeline smart art: the last seven days with entries, one column each, height by count.
function Timeline() {
  useLang()
  const s = useFetch<{ day: string; entries: number }[]>('/audit/days?limit=7')
  if (s.error) return <p className="text-sm text-muted">{t(S.auditFail)} <a className="link" href="#/activity">{t(S.openIt)}</a>.</p>
  if (!s.data) return <div className="h-28 animate-pulse rounded-ui bg-hairline/50" aria-hidden="true" />
  if (!s.data.length) return <p className="text-sm text-muted">{t(S.noEntries)}</p>
  const days = [...s.data].reverse()
  const max = Math.max(1, ...days.map(d => d.entries))
  const total = days.reduce((a, d) => a + d.entries, 0)
  return (
    <div>
      <ol className="timeline" aria-label={t({ en: `${total} entries over the last ${days.length} active days`, ms: `${total} entri dalam ${days.length} hari aktif lalu`, zh: `最近 ${days.length} 个活跃日共 ${total} 条记录`, ta: `கடந்த ${days.length} செயலில் உள்ள நாட்களில் ${total} பதிவுகள்` })}>
        {days.map(d => {
          const label = new Date(`${d.day}T12:00:00+08:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short', timeZone: 'Asia/Kuala_Lumpur' })
          return (
            <li key={d.day}><a href={`#/activity?day=${d.day}`} title={t({ en: `${label}: ${d.entries} entries`, ms: `${label}: ${d.entries} entri`, zh: `${label}：${d.entries} 条记录`, ta: `${label}: ${d.entries} பதிவுகள்` })}>
              <span className="timeline-bar" style={{ height: `${Math.max(10, (d.entries / max) * 100)}%` }}><b className="text-xs tabular-nums">{d.entries}</b></span>
              <span className="timeline-dot" aria-hidden="true" />
              <span className="text-xs text-muted">{label}</span>
              <span className="sr-only">{t({ en: `${d.entries} entries`, ms: `${d.entries} entri`, zh: `${d.entries} 条记录`, ta: `${d.entries} பதிவுகள்` })}</span>
            </a></li>
          )
        })}
      </ol>
    </div>
  )
}

export function areaTiles(d: AreaData, owner: boolean): BentoTile[] {
  const tr = d.track ?? {}
  const margin = Math.abs(Number(d.stale_margin_lost) || 0)
  const audit = can('view_audit')
  return [
    { id: 'work', size: 'L', title: tx('nav.group.Work'), node: (
      <section aria-label={tx('nav.group.Work')} className="glass" data-guide="home-work">
          <AreaHead icon="pipeline" title={tx('nav.group.Work')} href="#/track" lead={t(S.workLead)} />
          <Chevrons label={t(S.workStages)} steps={[
            { label: t(S.toReview), value: n(d.needs_review), href: '#/tracker/review', warn: true },
            { label: t(S.quotesOpen), value: n(d.open_quotes), href: '#/tracker/open' },
            { label: tx('nav.followups'), value: n(d.followups_pending), href: '#/followups', warn: true },
            { label: t(S.jobsTodo), value: n(d.jobs.todo), href: '#/jobs' },
            { label: t(S.doing), value: n(d.jobs.doing), href: '#/jobs' },
            { label: t(S.done), value: n(d.jobs.done), href: '#/jobs' },
          ]} />
          {(n(d.jobs_overdue) > 0 || n(tr.overdue) > 0) && <p className="mt-3 flex flex-wrap gap-2 text-sm">
            {n(d.jobs_overdue) > 0 && <a className="chip heat-stale" href="#/jobs?overdue">{t({ en: `${d.jobs_overdue} overdue ${d.jobs_overdue === 1 ? 'job' : 'jobs'}`, ms: `${d.jobs_overdue} kerja lewat tempoh`, zh: `${d.jobs_overdue} 个逾期工单`, ta: `${d.jobs_overdue} காலம் கடந்த வேலைகள்` })}</a>}
            {n(tr.overdue) > 0 && <a className="chip heat-late" href="#/track?overdue=1">{t({ en: `${tr.overdue} overdue on Schedule`, ms: `${tr.overdue} lewat tempoh di Jadual`, zh: `日程中 ${tr.overdue} 项逾期`, ta: `அட்டவணையில் ${tr.overdue} காலம் கடந்தவை` })}</a>}
          </p>}
        </section>
    ) },
    { id: 'suppliers', size: 'M', title: tx('nav.group.Suppliers'), node: (
      <section aria-label={tx('nav.group.Suppliers')} className="glass">
          <AreaHead icon="contacts" title={tx('nav.group.Suppliers')} href="#/contacts" lead={t(S.supLead)} />
          <Cycle label={t(S.supLoop)} centre={<><b className="block text-2xl tabular-nums leading-none"><CountUp value={n(d.contacts.suppliers)} /></b><span className="text-xs text-muted">{t(S.suppliers)}</span></>} steps={[
            { label: t(S.ask), href: canOpen('ask', owner) ? '#/ask' : '#/contacts' },
            { label: t(S.replies), value: n(tr.waiting_supplier), href: '#/track?kind=rfq&stage=waiting' },
            { label: t(S.compare), href: '#/ask' },
            { label: t(S.costBook), href: '#/catalog' },
          ]} />
        </section>
    ) },
    { id: 'insight', size: 'M', title: tx('nav.group.Insight'), node: (
      <section aria-label={tx('nav.group.Insight')} className="glass">
          <AreaHead icon="alerts" title={tx('nav.group.Insight')} href="#/alerts" lead={t(S.insLead)} />
          <Bars label={tx('nav.group.Insight')} rows={[
            ...(owner ? [{ label: t(S.hit), value: n(d.stale_quotes), href: '#/alerts', warn: true }] : []),
            ...(owner && margin ? [{ label: t(S.marginRm), value: margin, text: margin.toLocaleString(locale(), { minimumFractionDigits: 2 }), href: '#/alerts', warn: true }] : []),
            { label: t(S.approval), value: n(tr.waiting_approval), href: '#/track?kind=quote&stage=draft' },
            { label: t(S.dueToday), value: n(d.jobs_due_today), href: '#/jobs?view=agenda' },
          ]} />
        </section>
    ) },
    ...(audit ? [{ id: 'audit', size: 'L' as const, title: tx('nav.activity'), node: (
      <section aria-label={tx('nav.activity')} className="glass">
            <AreaHead icon="activity" title={tx('nav.activity')} href="#/activity" lead={t(S.audLead)} />
            <Timeline />
          </section>
    ) }] : []),
  ]
}

import { useEffect, useRef, useState } from 'react'
import { api, can } from './api'
import { Async, EmptyState, PageHeader, msg, useFetch } from './ui'
import { Tabs } from './kit'
import { Icon } from './icons'
import { useToast } from './Toast'
import { t, useLang } from './i18n'
import type { Text } from './i18n'
import { Dialog, S, StatusChip, dayOf, fmtDate, num, rm, stateName } from './suppliersKit'
import type { ContractV, Product } from './suppliersKit'

// Contracts: timeline of every agreement with its durations, the 4-step wizard, and the contract page with the renewal pack (docs/suppliers.md).

const C = {
  title: { en: 'Contracts', ms: 'Kontrak', zh: '合同', ta: 'ஒப்பந்தங்கள்' },
  timeline: { en: 'Timeline', ms: 'Garis masa', zh: '时间线', ta: 'காலக்கோடு' },
  list: { en: 'List', ms: 'Senarai', zh: '列表', ta: 'பட்டியல்' },
  bySupplier: { en: 'By supplier', ms: 'Ikut pembekal', zh: '按供应商', ta: 'சப்ளையர் வாரி' },
  byProduct: { en: 'By product', ms: 'Ikut produk', zh: '按产品', ta: 'பொருள் வாரி' },
  z3m: { en: '3 months', ms: '3 bulan', zh: '3 个月', ta: '3 மாதங்கள்' }, z12m: { en: '12 months', ms: '12 bulan', zh: '12 个月', ta: '12 மாதங்கள்' }, z3y: { en: '3 years', ms: '3 tahun', zh: '3 年', ta: '3 ஆண்டுகள்' },
  newContract: { en: 'New contract', ms: 'Kontrak baharu', zh: '新合同', ta: 'புதிய ஒப்பந்தம்' },
  none: { en: 'No contracts yet.', ms: 'Belum ada kontrak.', zh: '还没有合同。', ta: 'இன்னும் ஒப்பந்தங்கள் இல்லை.' },
  noneHint: { en: 'Pick a product, compare prices and press Start a contract.', ms: 'Pilih produk, banding harga dan tekan Mulakan kontrak.', zh: '选择产品，比价后点击“开始合同”。', ta: 'ஒரு பொருளைத் தேர்ந்தெடுத்து விலைகளை ஒப்பிட்டு ஒப்பந்தம் தொடங்கு அழுத்தவும்.' },
  gaps: { en: 'No contract coverage', ms: 'Tiada perlindungan kontrak', zh: '无合同覆盖', ta: 'ஒப்பந்த உள்ளடக்கம் இல்லை' },
  overlap: { en: 'Two contracts overlap', ms: 'Dua kontrak bertindih', zh: '两份合同重叠', ta: 'இரண்டு ஒப்பந்தங்கள் மேலெழுகின்றன' },
  agenda: { en: 'Agenda', ms: 'Agenda', zh: '日程', ta: 'நிகழ்ச்சி நிரல்' },
  legend: { en: 'Solid = active · hatched = expiring soon · dashed = pending · faded = expired', ms: 'Penuh = aktif · berjalur = hampir tamat · putus-putus = menunggu · pudar = tamat', zh: '实心=生效 · 斜纹=即将到期 · 虚线=待批准 · 淡色=已过期', ta: 'திடம் = செயலில் · கோடு = விரைவில் காலாவதி · புள்ளி = நிலுவை · மங்கல் = காலாவதி' },
  used: { en: 'Volume used', ms: 'Volum digunakan', zh: '已用数量', ta: 'பயன்படுத்திய அளவு' },
  months: { en: 'months', ms: 'bulan', zh: '个月', ta: 'மாதங்கள்' },
  approvals: { en: 'Off-contract orders waiting', ms: 'Pesanan luar kontrak menunggu', zh: '待处理的合同外订单', ta: 'காத்திருக்கும் ஒப்பந்தத்திற்கு வெளி ஆர்டர்கள்' },
  approve: { en: 'Approve', ms: 'Lulus', zh: '批准', ta: 'அங்கீகரி' }, reject: { en: 'Reject', ms: 'Tolak', zh: '拒绝', ta: 'நிராகரி' },
  steps: [
    { en: 'Scope', ms: 'Skop', zh: '范围', ta: 'நோக்கம்' }, { en: 'Term', ms: 'Tempoh', zh: '期限', ta: 'காலம்' },
    { en: 'Commitments', ms: 'Komitmen', zh: '承诺', ta: 'உறுதிகள்' }, { en: 'Review', ms: 'Semak', zh: '审核', ta: 'மதிப்பாய்வு' },
  ] as Text[],
  supplier: { en: 'Supplier', ms: 'Pembekal', zh: '供应商', ta: 'சப்ளையர்' },
  name: { en: 'Contract name', ms: 'Nama kontrak', zh: '合同名称', ta: 'ஒப்பந்தப் பெயர்' },
  product: { en: 'Product', ms: 'Produk', zh: '产品', ta: 'பொருள்' },
  packSize: { en: 'Pack size', ms: 'Saiz pek', zh: '包装规格', ta: 'பொதி அளவு' },
  pricePack: { en: 'Agreed price per pack (RM)', ms: 'Harga dipersetujui sepek (RM)', zh: '约定单价/包 (RM)', ta: 'ஒப்புக்கொண்ட பொதி விலை (RM)' },
  model: { en: 'Price model', ms: 'Model harga', zh: '定价方式', ta: 'விலை மாதிரி' },
  fixed: { en: 'Fixed', ms: 'Tetap', zh: '固定', ta: 'நிலையான' }, tiered: { en: 'Tiered', ms: 'Berperingkat', zh: '阶梯', ta: 'அடுக்கு' }, indexed: { en: 'Indexed (reviewed)', ms: 'Berindeks (disemak)', zh: '指数（定期复核）', ta: 'குறியீட்டு (மறுஆய்வு)' },
  manual: { en: 'Manual renewal', ms: 'Pembaharuan manual', zh: '手动续约', ta: 'கைமுறை புதுப்பிப்பு' }, auto: { en: 'Auto-renew with notice', ms: 'Auto-baharui dengan notis', zh: '提前通知后自动续约', ta: 'அறிவிப்புடன் தானியங்கி' },
  notice: { en: 'Notice period (days)', ms: 'Tempoh notis (hari)', zh: '通知期（天）', ta: 'அறிவிப்பு காலம் (நாட்கள்)' },
  reviews: { en: 'Price-review date (optional)', ms: 'Tarikh semakan harga (pilihan)', zh: '价格复核日期（可选）', ta: 'விலை மறுஆய்வு தேதி (விருப்பம்)' },
  minV: { en: 'Minimum volume', ms: 'Volum minimum', zh: '最小数量', ta: 'குறைந்தபட்ச அளவு' }, maxV: { en: 'Maximum volume', ms: 'Volum maksimum', zh: '最大数量', ta: 'அதிகபட்ச அளவு' },
  value: { en: 'Contract value (RM)', ms: 'Nilai kontrak (RM)', zh: '合同金额 (RM)', ta: 'ஒப்பந்த மதிப்பு (RM)' },
  pay: { en: 'Payment terms (days)', ms: 'Terma bayaran (hari)', zh: '付款期（天）', ta: 'கட்டண விதிகள் (நாட்கள்)' },
  sla: { en: 'Delivery SLA (days)', ms: 'SLA penghantaran (hari)', zh: '交货时限（天）', ta: 'விநியோக SLA (நாட்கள்)' },
  notes: { en: 'Penalty or rebate notes', ms: 'Nota penalti atau rebat', zh: '违约金或返利备注', ta: 'அபராதம் அல்லது தள்ளுபடி குறிப்புகள்' },
  next: { en: 'Next', ms: 'Seterusnya', zh: '下一步', ta: 'அடுத்து' }, back: { en: 'Back', ms: 'Kembali', zh: '返回', ta: 'பின்' },
  saveDraft: { en: 'Save draft', ms: 'Simpan draf', zh: '保存草稿', ta: 'வரைவைச் சேமி' }, submit: { en: 'Save and submit for approval', ms: 'Simpan dan hantar untuk kelulusan', zh: '保存并提交审批', ta: 'சேமித்து ஒப்புதலுக்கு அனுப்பு' },
  est: { en: 'Estimated value', ms: 'Anggaran nilai', zh: '预估金额', ta: 'மதிப்பீட்டு மதிப்பு' },
  dateErr: { en: 'The end date must be after the start date.', ms: 'Tarikh tamat mesti selepas tarikh mula.', zh: '结束日期必须晚于开始日期。', ta: 'முடிவு தேதி தொடக்கத் தேதிக்குப் பிறகு இருக்க வேண்டும்.' },
  attach: { en: 'Signed document: attach later (Roadmap)', ms: 'Dokumen bertandatangan: lampir kemudian (Pelan hala tuju)', zh: '签署文件：稍后附上（路线图）', ta: 'கையொப்பமிட்ட ஆவணம்: பின்னர் இணை (திட்டம்)' },
  submitApproval: { en: 'Submit for approval', ms: 'Hantar untuk kelulusan', zh: '提交审批', ta: 'ஒப்புதலுக்கு அனுப்பு' },
  approveC: { en: 'Approve contract', ms: 'Lulus kontrak', zh: '批准合同', ta: 'ஒப்பந்தத்தை அங்கீகரி' },
  sendBack: { en: 'Send back to draft', ms: 'Hantar semula ke draf', zh: '退回草稿', ta: 'வரைவுக்குத் திருப்பு' },
  terminate: { en: 'Terminate', ms: 'Tamatkan', zh: '终止', ta: 'முடி' },
  startRenewal: { en: 'Start renewal', ms: 'Mulakan pembaharuan', zh: '开始续约', ta: 'புதுப்பிப்பைத் தொடங்கு' },
  markRenewed: { en: 'Mark renewed', ms: 'Tandakan diperbaharui', zh: '标记已续约', ta: 'புதுப்பிக்கப்பட்டது' },
  letExpire: { en: 'Let it expire', ms: 'Biarkan tamat', zh: '任其到期', ta: 'காலாவதியாக விடு' },
  ack: { en: 'Supplier acknowledged (simulated)', ms: 'Pembekal mengakui (simulasi)', zh: '供应商已确认（模拟）', ta: 'சப்ளையர் ஒப்புக்கொண்டார் (போலி)' },
  reasonNeeded: { en: 'Reason (required)', ms: 'Sebab (diperlukan)', zh: '原因（必填）', ta: 'காரணம் (அவசியம்)' },
  pack: { en: 'Renewal pack', ms: 'Pek pembaharuan', zh: '续约包', ta: 'புதுப்பிப்புத் தொகுப்பு' },
  packHint: { en: 'Current performance, live market prices and three options. Nothing renews or is sent for you.', ms: 'Prestasi semasa, harga pasaran terkini dan tiga pilihan. Tiada apa diperbaharui atau dihantar bagi pihak anda.', zh: '当前表现、实时市场价和三个选项。不会自动续约或发送。', ta: 'தற்போதைய செயல்திறன், சந்தை விலைகள், மூன்று தேர்வுகள். எதுவும் தானாக புதுப்பிக்கப்படாது அல்லது அனுப்பப்படாது.' },
  opts: { renew_as_is: { en: 'Renew as is', ms: 'Baharui seperti sedia ada', zh: '原样续约', ta: 'அப்படியே புதுப்பி' }, renegotiate: { en: 'Renegotiate (target price below)', ms: 'Runding semula (harga sasaran di bawah)', zh: '重新议价（目标价见下）', ta: 'மறுபேச்சு (இலக்கு விலை கீழே)' }, switch_supplier: { en: 'Switch supplier', ms: 'Tukar pembekal', zh: '更换供应商', ta: 'சப்ளையரை மாற்று' } } as Record<string, Text>,
  market: { en: 'Contract price vs open-market lowest', ms: 'Harga kontrak berbanding pasaran terbuka terendah', zh: '合同价与公开市场最低价', ta: 'ஒப்பந்த விலை vs திறந்த சந்தை குறைந்த விலை' },
  history: { en: 'History', ms: 'Sejarah', zh: '历史', ta: 'வரலாறு' },
  commit: { en: 'Commitment', ms: 'Komitmen', zh: '承诺量', ta: 'உறுதி' },
  shortfall: { en: 'Projected shortfall by end date', ms: 'Anggaran kekurangan menjelang tarikh tamat', zh: '到期时预计缺口', ta: 'முடிவுக்குள் எதிர்பார்க்கும் பற்றாக்குறை' },
  overage: { en: 'Projected overage by end date', ms: 'Anggaran lebihan menjelang tarikh tamat', zh: '到期时预计超出', ta: 'முடிவுக்குள் எதிர்பார்க்கும் மிகை' },
  target: { en: 'Suggested target per pack', ms: 'Sasaran dicadangkan sepek', zh: '建议目标价/包', ta: 'பரிந்துரைக்கப்பட்ட இலக்கு/பொதி' },
}

const DAY = 86400000
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const MK: Record<string, string> = { start: '▶', price_review: '●', notice_deadline: '◆', end: '■' }

interface Lane { id: string; name: string; contracts: ContractV[] }
interface Timeline {
  today: string; group: string; lanes: Lane[]
  coverage: Record<string, { name: string; gaps: [string, string][]; overlaps: [string, string][] }>
  reminders: { contract_id: string; name: string; kind: string; days_before: number; date: string }[]
}

// ---------- the swimlane timeline ----------
function Gantt({ tl, zoom }: { tl: Timeline; zoom: string }) {
  useLang()
  const todayD = dayOf(tl.today).getTime()
  const span = (zoom === '3m' ? 90 : zoom === '3y' ? 1095 : 365) * DAY
  const from = todayD - span * 0.25, to = from + span
  const pct = (d: string) => ((dayOf(d).getTime() - from) / span) * 100
  const clamp = (v: number) => Math.max(0, Math.min(100, v))
  const ticks: { label: string; at: number }[] = []
  const step = zoom === '3y' ? 3 : 1
  for (let d = new Date(from); d.getTime() < to; d = new Date(d.getFullYear(), d.getMonth() + step, 1)) {
    const m = new Date(d.getFullYear(), d.getMonth(), 1)
    if (m.getTime() >= from) ticks.push({ at: ((m.getTime() - from) / span) * 100, label: m.toLocaleDateString(undefined, { month: 'short', year: zoom === '12m' || zoom === '3y' ? '2-digit' : undefined }) })
    if (ticks.length > 40) break
  }
  const nav = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-ms]')]
    const i = all.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    e.preventDefault()
    all[(i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length]?.focus()
  }
  return (
    <div className="card hidden overflow-x-auto p-0 md:block" role="region" aria-label={t(C.timeline)} tabIndex={0}>
      <div className="relative min-w-[720px] p-3" onKeyDown={nav}>
        <div className="relative ml-36 h-6 border-b border-hairline text-xs text-muted" aria-hidden="true">
          {ticks.map(k => <span key={k.at} className="absolute -translate-x-1/2" style={{ left: `${k.at}%` }}>{k.label}</span>)}
        </div>
        <div className="relative">
          <div aria-hidden="true" className="today-line pointer-events-none absolute bottom-0 top-0 z-10 w-0.5 bg-warn" style={{ left: `calc(9rem + (100% - 9rem) * ${clamp(pct(tl.today)) / 100})` }}>
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 rounded-xs bg-warn px-1 text-[10px] text-on-accent">{t(S.today)}</span>
          </div>
          {tl.lanes.map(l => (
            <div key={l.id} className="flex items-stretch border-b border-hairline py-2">
              <div className="w-36 shrink-0 pr-2 text-sm font-semibold">{l.name.replace(/^SAMPLE /, '').replace(/ \(synthetic\)$/, '')}</div>
              <div className="relative flex-1" style={{ height: l.contracts.length * 46 }}>
                {l.contracts.map((c, i) => {
                  const a = clamp(pct(c.start)), b = clamp(pct(c.end))
                  if (b <= a) return null
                  const live = c.state === 'active' || c.state === 'renewal', exp = c.state === 'expiring', pend = c.state === 'pending_approval' || c.state === 'draft', dead = c.state === 'expired' || c.state === 'terminated'
                  const prog = Math.max(0, Math.min(1, c.progress))
                  return (
                    <div key={c.id} className="absolute" style={{ left: `${a}%`, width: `${b - a}%`, top: i * 46, height: 40 }}>
                      <a href={`#/contract/${c.id}`} aria-label={`${c.name}: ${stateName(c.state)}, ${c.days_left} ${t(S.days)}`}
                        className={`gantt-bar relative block h-8 overflow-hidden rounded-ui border-2 border-accent text-xs no-underline ${dead ? 'opacity-50' : ''} ${pend ? 'border-dashed bg-surface' : exp ? 'gantt-hatch bg-surface' : 'bg-tint'}`}>
                        {(live || exp) && <span aria-hidden="true" className="absolute inset-y-0 left-0 origin-left bg-accent/30" style={{ width: `${prog * 100}%` }} />}
                        <span className="relative flex h-full items-center gap-1 truncate px-2 text-ink">
                          {exp && <Icon name="warn" className="size-3 shrink-0" />}{dead && <span aria-hidden="true">⊘</span>}
                          <b className="truncate">{c.name}</b><span className="shrink-0 text-muted">· {c.state === 'expired' ? stateName('expired') : `${Math.round((dayOf(c.end).getTime() - dayOf(c.start).getTime()) / DAY / 30.4)} ${t(C.months)} · ${c.days_left} ${t(S.days)}`}</span>
                        </span>
                      </a>
                      {c.milestones.filter(m => m.kind !== 'start').map(m => {
                        const at = ((pct(m.date) - a) / (b - a)) * 100
                        if (at < 0 || at > 100) return null
                        return (
                          <button key={m.kind + m.date} type="button" data-ms className="absolute top-8 -translate-x-1/2 text-[11px] leading-none text-ink focus-visible:outline-2" style={{ left: `${at}%` }}
                            title={`${t(S.milestone[m.kind as 'start'])}: ${fmtDate(m.date)} (${m.days} ${t(S.days)})`} aria-label={`${c.name}, ${t(S.milestone[m.kind as 'start'])}, ${fmtDate(m.date)}, ${m.days} ${t(S.days)}`}>{MK[m.kind]}</button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">{t(C.legend)} · ▶ {t(S.start)} ● {t(S.priceReview)} ◆ {t(S.noticeBy)} ■ {t(S.end)}</p>
      </div>
    </div>
  )
}

function Agenda({ tl }: { tl: Timeline }) {
  useLang()
  const all = tl.lanes.flatMap(l => l.contracts).filter((c, i, a) => a.findIndex(x => x.id === c.id) === i).sort((a, b) => a.end.localeCompare(b.end))
  return (
    <ul className="grid gap-2 md:hidden" aria-label={t(C.agenda)}>
      {all.map(c => (
        <li key={c.id} className="card p-3 text-sm"><a className="font-semibold" href={`#/contract/${c.id}`}>{c.name}</a>
          <p className="mt-1 flex flex-wrap items-center gap-2"><StatusChip v={c.state === 'pending_approval' || c.state === 'draft' ? 'not_in_contract' : c.state} /><span>{stateName(c.state)}</span></p>
          <p className="text-muted">{fmtDate(c.start)} → {fmtDate(c.end)} · {c.days_left} {t(S.days)}</p>
          <ul className="mt-1 text-xs text-muted">{c.milestones.map(m => <li key={m.kind + m.date}>{MK[m.kind]} {t(S.milestone[m.kind as 'start'])}: {fmtDate(m.date)}</li>)}</ul></li>
      ))}
    </ul>
  )
}

interface Pending { id: string; product_name: string; supplier_name: string; qty: string; amount: string; reason: string | null; bought_on: string }

export function ContractsView({ owner }: { owner: boolean }) {
  useLang()
  const toast = useToast()
  const [view, setView] = useState('timeline')
  const [group, setGroup] = useState('supplier')
  const [zoom, setZoom] = useState('12m')
  const [wiz, setWiz] = useState(false)
  const tl = useFetch<Timeline>(`/contracts/timeline?group=${group}`)
  const list = useFetch<ContractV[]>('/contracts')
  const pend = useFetch<Pending[]>('/purchases/pending')
  const canApprove = owner || can('approve_contracts')
  const decide = async (id: string, ok: boolean) => { try { await api('POST', `/purchases/${id}/decide?approve=${ok}`); pend.reload() } catch (e) { toast.error(msg(e)) } }
  const none = !list.loading && !list.data?.length
  return (
    <>
      <PageHeader title={t(C.title)} description={t(S.boundary)} actions={<button type="button" className="btn btn-primary" onClick={() => setWiz(true)} aria-disabled={!(owner || can('manage_contracts')) || undefined}>＋ {t(C.newContract)}</button>} />
      {pend.data && pend.data.length > 0 && (
        <section className="card mb-3 border-l-4 border-l-amber" aria-label={t(C.approvals)}><h2 className="font-semibold">{t(C.approvals)}</h2>
          <ul className="mt-1 grid gap-2 text-sm">{pend.data.map(p => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2"><span>{p.product_name} · {p.supplier_name.replace(/^SAMPLE /, '')} · {num(p.qty, 0)} · {rm(p.amount)} · “{p.reason}”</span>
              {canApprove && <span className="flex gap-2"><button className="btn btn-sm btn-primary" onClick={() => decide(p.id, true)}>{t(C.approve)}</button><button className="btn btn-sm btn-danger" onClick={() => decide(p.id, false)}>{t(C.reject)}</button></span>}</li>
          ))}</ul></section>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Tabs label={t(C.title)} value={view} onChange={setView} options={[{ value: 'timeline', label: t(C.timeline) }, { value: 'list', label: t(C.list) }]} />
        {view === 'timeline' && <div className="flex flex-wrap gap-2">
          <Seg value={group} onChange={setGroup} opts={[['supplier', C.bySupplier], ['product', C.byProduct]]} />
          <Seg value={zoom} onChange={setZoom} opts={[['3m', C.z3m], ['12m', C.z12m], ['3y', C.z3y]]} />
        </div>}
      </div>
      {none ? <EmptyState title={t(C.none)} hint={t(C.noneHint)} action={{ label: t(S.compare), href: '#/products' }} /> : view === 'timeline' ? (
        <Async s={tl} shape="cards">{tl.data && <>
          <Gantt tl={tl.data} zoom={zoom} /><Agenda tl={tl.data} />
          {(() => { const g = Object.values(tl.data.coverage).filter(x => x.gaps.length || x.overlaps.length); return g.length > 0 && (
            <section className="card mt-3 text-sm" aria-label={t(C.gaps)}><h2 className="font-semibold">{t(C.gaps)}</h2>
              <ul className="mt-1 grid gap-1">{g.map(x => <li key={x.name}><b>{x.name}</b>: {x.gaps.map(([a, b]) => `${fmtDate(a)} → ${fmtDate(b)}`).join('; ')}{x.overlaps.length > 0 && ` · ${t(C.overlap)}`}</li>)}</ul></section>) })()}
        </>}</Async>
      ) : (
        <Async s={list} shape="cards"><ul className="grid gap-2">{list.data?.map(c => (
          <li key={c.id} className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <span className="min-w-0"><a className="font-semibold" href={`#/contract/${c.id}`}>{c.name}</a><br /><span className="text-muted">{c.supplier_name.replace(/^SAMPLE /, '').replace(/ \(synthetic\)$/, '')} · {fmtDate(c.start)} → {fmtDate(c.end)}</span></span>
            <span className="flex items-center gap-2"><StatusChip v={c.state === 'pending_approval' || c.state === 'draft' ? 'not_in_contract' : c.state} /><span>{stateName(c.state)}</span><span className="tabular-nums">{c.days_left} {t(S.days)}</span></span></li>
        ))}</ul></Async>
      )}
      {wiz && <ContractWizard onClose={() => setWiz(false)} />}
    </>
  )
}

function Seg({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts: [string, Text][] }) {
  return (
    <div role="group" className="inline-flex overflow-hidden rounded-ui border border-line">
      {opts.map(([k, l], i) => <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} className={`min-h-(--control-h-sm) px-3 text-sm ${value === k ? 'bg-tint font-bold' : 'bg-surface'} ${i ? 'border-l border-line' : ''}`}>{t(l)}</button>)}
    </div>
  )
}

// ---------- the 4-step wizard ----------
interface Preset { supplier_id: string; product_id: string; product_name: string; pack_size: string; price_per_pack: string; lead: number }
const iso = (d: Date) => ymd(d)
export function ContractWizard({ onClose, preset }: { onClose: () => void; preset?: Preset }) {
  useLang()
  const toast = useToast()
  const today = new Date()
  const suppliers = useFetch<{ id: string; name: string }[]>('/suppliers')
  const products = useFetch<Product[]>('/products')
  const [step, setStep] = useState(0)
  const [f, setF] = useState({
    supplier_id: preset?.supplier_id ?? '', name: preset ? `${preset.product_name} ${today.getFullYear()}` : '', product_id: preset?.product_id ?? '', pack_size: preset?.pack_size ?? '1', price: preset?.price_per_pack ?? '',
    model: 'fixed', start: iso(today), end: iso(new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())), renewal: 'manual', notice: '30', review: '',
    min: '', max: '', pay: '', sla: preset ? String(preset.lead) : '', notes: '',
  })
  const [err, setErr] = useState('')
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }))
  const first = useRef<HTMLSelectElement>(null)
  useEffect(() => { first.current?.focus() }, [step])
  const estimate = Number(f.price || 0) / Math.max(Number(f.pack_size || 1), 1) * Number(f.max || f.min || 0)
  const body = () => ({
    supplier_id: f.supplier_id, name: f.name.trim(), price_model: f.model, start_on: f.start, end_on: f.end, renewal: f.renewal, notice_days: Number(f.notice || 0),
    price_reviews: f.review ? [f.review] : [], min_qty: f.min || null, max_qty: f.max || null, value: String(Math.round(estimate * 100) / 100), payment_days: f.pay ? Number(f.pay) : null,
    sla_lead_days: f.sla ? Number(f.sla) : null, terms_note: f.notes || null, items: [{ product_id: f.product_id, pack_size: f.pack_size || '1', price_per_pack: f.price || '0' }],
  })
  const valid = (s: number) => s === 0 ? !!(f.supplier_id && f.name.trim() && f.product_id && Number(f.price) >= 0 && f.price !== '') : s === 1 ? f.end > f.start : true
  const save = async (submit: boolean) => {
    setErr('')
    try {
      const r = await api<{ id: string }>('POST', '/contracts', body())
      if (submit) await api('POST', `/contracts/${r.id}/transition`, { to: 'pending_approval' })
      toast(submit ? t({ en: 'Contract sent for approval.', ms: 'Kontrak dihantar untuk kelulusan.', zh: '合同已提交审批。', ta: 'ஒப்பந்தம் ஒப்புதலுக்கு அனுப்பப்பட்டது.' }) : t({ en: 'Draft saved.', ms: 'Draf disimpan.', zh: '草稿已保存。', ta: 'வரைவு சேமிக்கப்பட்டது.' }))
      onClose(); location.hash = `#/contract/${r.id}`
    } catch (e) { setErr(msg(e)) }
  }
  const lbl = (txt: Text, el: React.ReactNode) => <label className="mt-3 block text-sm">{t(txt)}{el}</label>
  const inp = (k: keyof typeof f, o: React.InputHTMLAttributes<HTMLInputElement> = {}) => <input className="input mt-1 w-full" value={f[k]} onChange={e => set(k, e.target.value)} {...o} />
  return (
    <Dialog title={`${t(C.newContract)}: ${t(C.steps[step])} (${step + 1}/4)`} onClose={onClose} wide>
      <ol className="mb-2 flex gap-3 text-xs text-muted" aria-hidden="true">{C.steps.map((s, i) => <li key={i} className={i === step ? 'font-bold text-ink' : ''}>{i + 1}. {t(s)}</li>)}</ol>
      {step === 0 && <>
        {lbl(C.supplier, <select ref={first} className="input mt-1 w-full" value={f.supplier_id} onChange={e => set('supplier_id', e.target.value)}><option value="">-</option>{suppliers.data?.map(s => <option key={s.id} value={s.id}>{s.name.replace(/^SAMPLE /, '')}</option>)}</select>)}
        {lbl(C.name, inp('name', { maxLength: 120 }))}
        {lbl(C.product, <select className="input mt-1 w-full" value={f.product_id} onChange={e => set('product_id', e.target.value)}><option value="">-</option>{products.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>)}
        <div className="grid grid-cols-2 gap-3">{lbl(C.packSize, inp('pack_size', { inputMode: 'decimal' }))}{lbl(C.pricePack, inp('price', { inputMode: 'decimal' }))}</div>
        {lbl(C.model, <select className="input mt-1 w-full" value={f.model} onChange={e => set('model', e.target.value)}><option value="fixed">{t(C.fixed)}</option><option value="tiered">{t(C.tiered)}</option><option value="indexed">{t(C.indexed)}</option></select>)}
      </>}
      {step === 1 && <>
        <div className="grid grid-cols-2 gap-3">{lbl(S.start, inp('start', { type: 'date' }))}{lbl(S.end, inp('end', { type: 'date' }))}</div>
        {f.end <= f.start && <p role="alert" className="mt-1 text-sm text-warn">{t(C.dateErr)}</p>}
        {lbl(S.renewal, <select className="input mt-1 w-full" value={f.renewal} onChange={e => set('renewal', e.target.value)}><option value="manual">{t(C.manual)}</option><option value="auto">{t(C.auto)}</option></select>)}
        <div className="grid grid-cols-2 gap-3">{lbl(C.notice, inp('notice', { inputMode: 'numeric' }))}{lbl(C.reviews, inp('review', { type: 'date' }))}</div>
      </>}
      {step === 2 && <>
        <div className="grid grid-cols-2 gap-3">{lbl(C.minV, inp('min', { inputMode: 'decimal' }))}{lbl(C.maxV, inp('max', { inputMode: 'decimal' }))}</div>
        <div className="grid grid-cols-2 gap-3">{lbl(C.pay, inp('pay', { inputMode: 'numeric' }))}{lbl(C.sla, inp('sla', { inputMode: 'numeric' }))}</div>
        {lbl(C.notes, <textarea className="input mt-1 w-full" rows={3} maxLength={2000} value={f.notes} onChange={e => set('notes', e.target.value)} />)}
        <p className="mt-2 text-xs text-muted">{t(C.attach)}</p>
      </>}
      {step === 3 && <dl className="grid grid-cols-2 gap-2 text-sm">
        <div><dt className="text-muted">{t(C.name)}</dt><dd>{f.name}</dd></div><div><dt className="text-muted">{t(C.supplier)}</dt><dd>{suppliers.data?.find(s => s.id === f.supplier_id)?.name.replace(/^SAMPLE /, '')}</dd></div>
        <div><dt className="text-muted">{t(C.product)}</dt><dd>{products.data?.find(p => p.id === f.product_id)?.name} · {rm(f.price)} / {f.pack_size}</dd></div>
        <div><dt className="text-muted">{t(C.title)}</dt><dd>{fmtDate(f.start)} → {fmtDate(f.end)}</dd></div>
        <div><dt className="text-muted">{t(S.noticeBy)}</dt><dd>{f.notice} {t(S.days)}</dd></div><div><dt className="text-muted">{t(C.est)}</dt><dd className="tabular-nums">{rm(String(Math.round(estimate * 100) / 100))}</dd></div>
        <p className="col-span-2 text-xs text-muted">{t(S.boundary)}</p></dl>}
      {err && <p role="alert" className="mt-2 text-sm text-warn">{err}</p>}
      <p className="mt-4 flex flex-wrap justify-between gap-2">
        <button type="button" className="btn" onClick={() => (step ? setStep(step - 1) : onClose())}>{step ? t(C.back) : t({ en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து' })}</button>
        {step < 3 ? <button type="button" className="btn btn-primary" disabled={!valid(step)} onClick={() => setStep(step + 1)}>{t(C.next)}</button>
          : <span className="flex gap-2"><button type="button" className="btn" onClick={() => save(false)}>{t(C.saveDraft)}</button><button type="button" className="btn btn-primary" onClick={() => save(true)}>{t(C.submit)}</button></span>}
      </p>
    </Dialog>
  )
}

// ---------- contract page ----------
interface Detail extends ContractV {
  events: { from_state: string | null; to_state: string; reason: string | null; at: string }[]
  purchases: { bought_on: string; qty: string; amount: string; status: string }[]
  market: { product_id: string; contract_per_base: string; market_lowest_per_base: string; market_supplier: string; gap_pct: string; market_cheaper: boolean; review_in_days?: number }[]
  boundary: string
}
interface Pack {
  days_left: number; notice_deadline: string; performance: { on_time_pct: string | null; price_stability_pct: string | null; volume_used: string; volume_min: string | null; volume_max: string | null }
  market: { product_id: string; contract_per_base: string; market_lowest_per_base: string | null; alternative: { supplier_name: string; per_base: string } | null; suggested_target_per_pack: string | null }[]
  options: string[]
}

export function ContractDetail({ id, owner }: { id: string; owner: boolean }) {
  useLang()
  const toast = useToast()
  const s = useFetch<Detail>(`/contracts/${id}`)
  const [pack, setPack] = useState<Pack | null>(null)
  const [ask, setAsk] = useState<{ to: string; label: Text; needReason: boolean } | null>(null)
  const [why, setWhy] = useState('')
  const [err, setErr] = useState('')
  const c = s.data
  const mgr = owner || can('manage_contracts'), appr = owner || can('approve_contracts')
  const move = async (to: string, reason?: string) => {
    setErr('')
    try {
      if (to === 'renewal' && c?.stored_state === 'active') await api('POST', `/contracts/${id}/transition`, { to: 'expiring' })
      await api('POST', `/contracts/${id}/transition`, { to, reason: reason || undefined }); setAsk(null); setWhy(''); s.reload()
    } catch (e) { setErr(msg(e)) }
  }
  const act = (to: string, label: Text, needReason = false) => <button type="button" key={to + label.en} className={`btn btn-sm ${to === 'active' || to === 'pending_approval' ? 'btn-primary' : to === 'terminated' ? 'btn-danger' : ''}`} onClick={() => (needReason ? setAsk({ to, label, needReason }) : move(to))}>{t(label)}</button>
  const st = c?.state
  const buttons: React.ReactNode[] = []
  if (c) {
    if (c.stored_state === 'draft' && mgr) buttons.push(act('pending_approval', C.submitApproval))
    if (c.stored_state === 'pending_approval') { if (appr) buttons.push(act('active', C.approveC)); if (appr || mgr) buttons.push(act('draft', C.sendBack, true)) }
    if ((st === 'expiring' || (st === 'active' && c.days_left <= 90)) && c.stored_state !== 'renewal' && owner) buttons.push(act('renewal', C.startRenewal))
    if (c.stored_state === 'renewal' && owner) { buttons.push(act('renewed', C.markRenewed)); buttons.push(act('expired', C.letExpire)) }
    if (['active', 'expiring', 'renewal'].includes(c.stored_state) && owner) buttons.push(act('terminated', C.terminate, true))
  }
  const loadPack = async () => { try { setPack(await api<Pack>('GET', `/contracts/${id}/renewal-pack`)) } catch (e) { toast.error(msg(e)) } }
  const ackNow = async () => { try { await api('POST', `/contracts/${id}/acknowledge`); s.reload() } catch (e) { toast.error(msg(e)) } }
  return (
    <>
      <PageHeader title={c?.name} back={{ href: '#/contracts', label: t(C.title) }} status={c && <><StatusChip v={st === 'pending_approval' || st === 'draft' ? 'not_in_contract' : st!} /><span className="text-sm">{stateName(st!)}</span></>}
        description={c ? `${c.supplier_name.replace(/^SAMPLE /, '').replace(/ \(synthetic\)$/, '')} · ${fmtDate(c.start)} → ${fmtDate(c.end)}` : undefined} actions={<>{buttons}</>} />
      <Async s={s} shape="detail">{c && <div className="grid gap-4">
        {err && <p role="alert" className="card border-warn bg-warn-bg text-warn">{err}</p>}
        <section className="card" aria-label={t(C.timeline)}>
          <div className="relative h-3 rounded-xs bg-soft"><div className="h-full origin-left rounded-xs bg-accent" style={{ width: `${c.progress * 100}%` }} /></div>
          <ol className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">{c.milestones.map(m => <li key={m.kind + m.date}>{MK[m.kind]} {t(S.milestone[m.kind as 'start'])}: <b>{fmtDate(m.date)}</b> <span className="text-muted">({m.days >= 0 ? `${m.days} ${t(S.days)}` : '—'})</span></li>)}</ol>
        </section>
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={t(C.title)}>
          <Tile icon="clock" title={t(S.daysLeft)} value={`${c.days_left}`} warn={c.days_left <= c.notice_days} />
          <Tile icon="warn" title={t(S.noticeBy)} value={fmtDate(c.notice_deadline)} />
          <Tile icon="check" title={t(S.renewal)} value={c.renewal === 'auto' ? t(C.auto) : t(C.manual)} />
          <Tile icon="tracker" title={t(C.value)} value={rm(c.value)} />
        </section>
        <section className="card text-sm"><h2 className="font-semibold">{t(C.commit)}</h2>
          <p className="mt-1">{t(C.used)}: <b className="tabular-nums">{num(c.used_qty, 0)}</b> / {c.max_qty ? num(c.max_qty, 0) : '—'} {c.min_qty ? `(min ${num(c.min_qty, 0)})` : ''}</p>
          {c.volume_used_pct != null && <div className="mt-1 h-2 max-w-sm rounded-xs bg-soft" aria-hidden="true"><div className="h-full rounded-xs bg-accent" style={{ width: `${Math.min(100, c.volume_used_pct * 100)}%` }} /></div>}
          {c.shortfall && <p className="mt-1 text-warn"><Icon name="warn" className="mr-1 inline size-4" />{t(C.shortfall)}: {num(c.shortfall, 0)}</p>}{c.overage && <p className="mt-1 text-warn"><Icon name="warn" className="mr-1 inline size-4" />{t(C.overage)}: {num(c.overage, 0)}</p>}
          <ul className="mt-2">{c.items.map(i => <li key={i.product_id}><a href={`#/product/${i.product_id}`}>{i.product_name}</a>: {rm(i.price_per_pack)} / {num(i.pack_size, 0)}</li>)}</ul></section>
        {c.market.length > 0 && <section className="card text-sm" aria-label={t(C.market)}><h2 className="font-semibold">{t(C.market)}</h2>
          <ul className="mt-1">{c.market.map(m => <li key={m.product_id}>{rm(m.contract_per_base)} vs {rm(m.market_lowest_per_base)} ({m.market_supplier.replace(/^SAMPLE /, '').replace(/ \(synthetic\)$/, '')}) · {m.market_cheaper
            ? <span className="text-warn"><Icon name="warn" className="mr-1 inline size-4" />{t({ en: `Market is ${m.gap_pct}% cheaper. Review at the next price review (${m.review_in_days ?? '?'} days).`, ms: `Pasaran ${m.gap_pct}% lebih murah. Semak pada semakan harga seterusnya (${m.review_in_days ?? '?'} hari).`, zh: `市场价便宜 ${m.gap_pct}%。请在下次价格复核时处理（${m.review_in_days ?? '?'} 天后）。`, ta: `சந்தை ${m.gap_pct}% மலிவு. அடுத்த விலை மறுஆய்வில் பாருங்கள் (${m.review_in_days ?? '?'} நாட்கள்).` })}</span>
            : t({ en: 'Contract price is competitive.', ms: 'Harga kontrak berdaya saing.', zh: '合同价具竞争力。', ta: 'ஒப்பந்த விலை போட்டித்தன்மை உடையது.' })}</li>)}</ul></section>}
        <section className="card text-sm"><h2 className="font-semibold">{t(C.pack)}</h2><p className="text-muted">{t(C.packHint)}</p>
          {!pack ? <button type="button" className="btn btn-sm mt-2" onClick={loadPack}>{t(C.pack)}</button> : (
            <div className="mt-2 grid gap-2">
              <p>{t({ en: 'On time', ms: 'Tepat masa', zh: '准时率', ta: 'சரியான நேரம்' })}: <b>{pack.performance.on_time_pct ? `${num(pack.performance.on_time_pct, 0)}%` : '—'}</b> · {t(C.used)}: <b>{num(pack.performance.volume_used, 0)}</b></p>
              <ul>{pack.market.map(m => <li key={m.product_id}>{rm(m.contract_per_base)} → {m.market_lowest_per_base ? rm(m.market_lowest_per_base) : '—'}{m.alternative && ` (${m.alternative.supplier_name.replace(/^SAMPLE /, '').replace(/ \(synthetic\)$/, '')} ${rm(m.alternative.per_base)})`}{m.suggested_target_per_pack && ` · ${t(C.target)}: ${rm(m.suggested_target_per_pack)}`}</li>)}</ul>
              <ol className="list-decimal pl-5">{pack.options.map(o => <li key={o}>{t(C.opts[o])}</li>)}</ol></div>)}</section>
        <section className="card text-sm"><h2 className="font-semibold">{t(C.history)}</h2>
          <ul className="mt-1">{c.events.map((e, i) => <li key={i}>{fmtDate(e.at)} · {e.from_state ? `${stateName(e.from_state)} → ` : ''}{stateName(e.to_state)}{e.reason ? ` · “${e.reason}”` : ''}</li>)}</ul>
          {c.acknowledged_at ? <p className="mt-1 text-muted">{t(C.ack)}: {fmtDate(c.acknowledged_at)}</p> : (c.stored_state === 'pending_approval' || c.stored_state === 'active') && mgr && <button type="button" className="btn btn-sm mt-2" onClick={ackNow}>{t(C.ack)}</button>}</section>
        <p className="text-xs text-muted">{t(S.boundary)}</p>
      </div>}</Async>
      {ask && <Dialog title={t(ask.label)} onClose={() => setAsk(null)}>
        <label className="block text-sm">{t(C.reasonNeeded)}<input className="input mt-1 w-full" maxLength={500} value={why} onChange={e => setWhy(e.target.value)} autoFocus /></label>
        <p className="mt-4 flex justify-end gap-2"><button className="btn" onClick={() => setAsk(null)}>{t({ en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து' })}</button><button className="btn btn-primary" disabled={!why.trim()} onClick={() => move(ask.to, why)}>{t(ask.label)}</button></p></Dialog>}
    </>
  )
}

function Tile({ icon, title, value, warn }: { icon: 'clock' | 'warn' | 'check' | 'tracker'; title: string; value: string; warn?: boolean }) {
  return <div className="card p-3"><p className="flex items-center gap-1.5 text-sm text-muted"><Icon name={icon} className="size-4" />{title}</p><p className={`text-xl font-semibold tabular-nums ${warn ? 'text-warn' : ''}`}>{value}</p></div>
}

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './icons'
import { t, locale } from './i18n'
import type { Text } from './i18n'
import { rm } from './ui'

// Shared pieces of the Suppliers section (docs/suppliers.md): types, words, small charts. Every shape comes with a text label, never colour alone.

export interface Card {
  id: string; name: string; contact: string | null; state: string | null; categories: string[]; certs: string[]; payment_days: number | null; standing: string
  on_time_pct: string | null; reliability: number | null; avg_lead_days: string | null; min_moq: string | null; last_order_on: string | null
  contract_status: CStatus; sparkline: string[]
}
export type CStatus = 'in_contract' | 'expiring' | 'not_in_contract' | 'expired'
export interface Summary {
  suppliers: number; active_contracts: number; expiring_90: number; savings_this_month: string; spend_90d: string; in_contract_spend: string; not_in_contract_spend: string
  off_contract_pct: number; by_status: Record<string, number>
  needs_you: { expiring: { id: string; name: string; days_left: number }[]; contracts_waiting_approval: number; off_contract_orders_pending: number }
}
export interface Product { id: string; name: string; base_uom: string; category: string | null; item_key: string | null; offers: number; aliases: string[]; coverage: string }
export interface Landed { packs: number; pack_price: string; goods: string; discount: string; delivery: string; sst: string; total: string; per_base_unit: string; base_qty: string; missing: string[] }
export interface Row {
  offer_id: string; supplier_id: string; supplier_name: string; state: string | null; standing: string; pack_label: string; pack_size: string; lead_days: number
  moq: string | null; stock: string | null; valid_until: string | null; certs: string[]; reliability: number | null; payment_days: number | null
  landed: Landed; why_not: string[]; delta_vs_lowest: string | null; score: string | null
}
export interface Compare {
  product: { id: string; name: string; base_uom: string }; qty: string; needed_by: string | null
  coverage: { status: string; contract_id: string | null; reasons: string[]; starts?: string }
  recommended: Row | null; qualified: Row[]; disqualified: Row[]; badges: Record<string, string>; weights: Record<string, number>
  why: Record<'en' | 'ms' | 'zh' | 'ta', string>; split: { suppliers: string[]; qty: string[]; total: string; saving: string } | null
  savings: { vs_last_paid: string | null; vs_market_avg: string; vs_highest: string } | null
  history: Record<string, { month: string; price: string }[]>; last_paid_per_base: string | null; market_avg_per_base: string | null
  contract: { contract_id: string; name: string; supplier_name: string; price_per_base: string; insight: { gap_pct: string; market_cheaper: boolean; review_in_days?: number } } | null
}
export interface Milestone { kind: string; date: string; days: number }
export interface ContractV {
  id: string; name: string; supplier_id: string; supplier_name: string; state: string; stored_state: string; start: string; end: string; days_left: number
  notice_days: number; renewal: string; notice_deadline: string; price_model: string; value: string; min_qty: string | null; max_qty: string | null; used_qty: string
  payment_days: number | null; sla_lead_days: number | null; terms_note: string | null; acknowledged_at: string | null
  items: { product_id: string; product_name: string | null; pack_size: string; price_per_pack: string }[]
  milestones: Milestone[]; progress: number; volume_used_pct: number | null; projected: string | null; shortfall: string | null; overage: string | null
}

export const S = {
  in: { en: 'In contract', ms: 'Dalam kontrak', zh: '合同内', ta: 'ஒப்பந்தத்தில்' },
  not: { en: 'Not in contract', ms: 'Bukan dalam kontrak', zh: '非合同', ta: 'ஒப்பந்தத்திற்கு வெளியே' },
  all: { en: 'All', ms: 'Semua', zh: '全部', ta: 'அனைத்தும்' },
  expiring: { en: 'Expiring soon', ms: 'Hampir tamat', zh: '即将到期', ta: 'விரைவில் காலாவதி' },
  expired: { en: 'Expired', ms: 'Tamat', zh: '已过期', ta: 'காலாவதியானது' },
  partial: { en: 'Partially covered', ms: 'Sebahagian dilindungi', zh: '部分覆盖', ta: 'பகுதி உள்ளடக்கம்' },
  contract: { en: 'Contract', ms: 'Kontrak', zh: '合同', ta: 'ஒப்பந்தம்' },
  contracts: { en: 'Contracts', ms: 'Kontrak', zh: '合同', ta: 'ஒப்பந்தங்கள்' },
  recommended: { en: 'Recommended: lowest price', ms: 'Disyorkan: harga terendah', zh: '推荐：最低价', ta: 'பரிந்துரை: குறைந்த விலை' },
  lead: { en: 'Lead time', ms: 'Masa penghantaran', zh: '交货期', ta: 'விநியோக காலம்' },
  days: { en: 'days', ms: 'hari', zh: '天', ta: 'நாட்கள்' },
  daysLeft: { en: 'Days left', ms: 'Hari berbaki', zh: '剩余天数', ta: 'மீதமுள்ள நாட்கள்' },
  landed: { en: 'Total cost delivered', ms: 'Kos akhir (termasuk penghantaran)', zh: '到岸总成本', ta: 'இறுதி செலவு (விநியோகம் உட்பட)' },
  moq: { en: 'Minimum order qty', ms: 'Kuantiti pesanan minimum', zh: '最小起订量', ta: 'குறைந்தபட்ச ஆர்டர் அளவு' },
  priceReview: { en: 'Price review', ms: 'Semakan harga', zh: '价格复核', ta: 'விலை மறுஆய்வு' },
  renewal: { en: 'Renewal', ms: 'Pembaharuan', zh: '续约', ta: 'புதுப்பித்தல்' },
  noticeBy: { en: 'Give notice by', ms: 'Beri notis sebelum', zh: '通知截止日', ta: 'அறிவிப்பு கடைசி நாள்' },
  start: { en: 'Start', ms: 'Mula', zh: '开始', ta: 'தொடக்கம்' },
  end: { en: 'End', ms: 'Tamat', zh: '结束', ta: 'முடிவு' },
  today: { en: 'Today', ms: 'Hari ini', zh: '今天', ta: 'இன்று' },
  view: { en: 'View', ms: 'Lihat', zh: '查看', ta: 'பார்' },
  compare: { en: 'Compare products', ms: 'Banding produk', zh: '比较产品', ta: 'பொருட்களை ஒப்பிடு' },
  requestQuote: { en: 'Request quote', ms: 'Minta sebut harga', zh: '索取报价', ta: 'விலைப்புள்ளி கேள்' },
  boundary: { en: 'Tracks your agreement. Not legal advice. Keep the signed copy. Demo data is synthetic; no real payments.', ms: 'Menjejak perjanjian anda. Bukan nasihat undang-undang. Simpan salinan bertandatangan. Data demo adalah rekaan; tiada bayaran sebenar.', zh: '仅用于记录您的协议，不构成法律意见。请保留已签署的副本。演示数据为虚构，不涉及真实付款。', ta: 'உங்கள் ஒப்பந்தத்தைக் கண்காணிக்கிறது. சட்ட ஆலோசனை அல்ல. கையொப்பமிட்ட நகலை வைத்திருங்கள். டெமோ தரவு போலியானது; உண்மையான கட்டணம் இல்லை.' },
  reasons: {
    blocked: { en: 'Blocked supplier', ms: 'Pembekal disekat', zh: '供应商已屏蔽', ta: 'தடுக்கப்பட்ட சப்ளையர்' },
    below_moq: { en: 'Below minimum order', ms: 'Bawah pesanan minimum', zh: '低于最小起订量', ta: 'குறைந்தபட்ச ஆர்டருக்குக் கீழ்' },
    over_stock: { en: 'Not enough stock', ms: 'Stok tidak cukup', zh: '库存不足', ta: 'போதிய இருப்பு இல்லை' },
    too_slow: { en: 'Too late for needed-by date', ms: 'Terlalu lewat untuk tarikh diperlukan', zh: '赶不上需要日期', ta: 'தேவையான தேதிக்கு தாமதம்' },
    expired: { en: 'Quote expired', ms: 'Sebut harga tamat', zh: '报价已过期', ta: 'விலைப்புள்ளி காலாவதி' },
    missing_cert: { en: 'Certification missing', ms: 'Pensijilan tiada', zh: '缺少认证', ta: 'சான்றிதழ் இல்லை' },
    low_reliability: { en: 'Reliability too low', ms: 'Kebolehpercayaan terlalu rendah', zh: '可靠度过低', ta: 'நம்பகத்தன்மை குறைவு' },
  } satisfies Record<string, Text>,
  badges: {
    fastest: { en: 'Fastest', ms: 'Terpantas', zh: '最快', ta: 'வேகமானது' },
    reliable: { en: 'Most reliable', ms: 'Paling boleh dipercayai', zh: '最可靠', ta: 'மிக நம்பகமானது' },
    value: { en: 'Best value', ms: 'Nilai terbaik', zh: '最划算', ta: 'சிறந்த மதிப்பு' },
    closest: { en: 'Closest', ms: 'Paling dekat', zh: '最近', ta: 'அருகில்' },
  } satisfies Record<string, Text>,
  states: {
    draft: { en: 'Draft', ms: 'Draf', zh: '草稿', ta: 'வரைவு' }, pending_approval: { en: 'Pending approval', ms: 'Menunggu kelulusan', zh: '待批准', ta: 'ஒப்புதலுக்குக் காத்திருக்கிறது' },
    active: { en: 'Active', ms: 'Aktif', zh: '生效中', ta: 'செயலில்' }, expiring: { en: 'Expiring soon', ms: 'Hampir tamat', zh: '即将到期', ta: 'விரைவில் காலாவதி' },
    renewal: { en: 'Renewal in progress', ms: 'Pembaharuan sedang berjalan', zh: '续约中', ta: 'புதுப்பித்தல் நடக்கிறது' }, renewed: { en: 'Renewed', ms: 'Diperbaharui', zh: '已续约', ta: 'புதுப்பிக்கப்பட்டது' },
    expired: { en: 'Expired', ms: 'Tamat', zh: '已过期', ta: 'காலாவதியானது' }, terminated: { en: 'Terminated', ms: 'Ditamatkan', zh: '已终止', ta: 'முடிக்கப்பட்டது' },
  } satisfies Record<string, Text>,
  milestone: {
    start: { en: 'Start', ms: 'Mula', zh: '开始', ta: 'தொடக்கம்' }, price_review: { en: 'Price review', ms: 'Semakan harga', zh: '价格复核', ta: 'விலை மறுஆய்வு' },
    notice_deadline: { en: 'Notice deadline', ms: 'Tarikh akhir notis', zh: '通知截止', ta: 'அறிவிப்பு கடைசி நாள்' }, end: { en: 'Expiry', ms: 'Tamat', zh: '到期', ta: 'காலாவதி' },
  } satisfies Record<string, Text>,
}

export const reason = (c: string) => (S.reasons as Record<string, Text>)[c] ? t((S.reasons as Record<string, Text>)[c]) : c
export const stateName = (s: string) => (S.states as Record<string, Text>)[s] ? t((S.states as Record<string, Text>)[s]) : s
export const dayOf = (s: string) => new Date(s.slice(0, 10) + 'T00:00:00')
export const fmtDate = (s: string | null | undefined) => (s ? dayOf(s).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '')
export const num = (s: string | number | null | undefined, d = 2) => (s == null ? '' : Number(s).toLocaleString(locale(), { maximumFractionDigits: d }))
export { rm }

// Contract status of a supplier or product: an icon, a word and a shape, so it works without colour.
export function StatusChip({ v }: { v: string }) {
  const m: Record<string, [string, Text, 'check' | 'warn' | 'clock' | 'close']> = {
    in_contract: ['chip-approved', S.in, 'check'], active: ['chip-approved', S.in, 'check'], expiring: ['chip-warn', S.expiring, 'warn'],
    not_in_contract: ['chip-draft', S.not, 'close'], expired: ['chip-expired', S.expired, 'clock'], partial: ['chip-warn', S.partial, 'warn'],
  }
  const [cls, text, icon] = m[v] ?? m.not_in_contract
  return <span className={`chip ${cls}`}><Icon name={icon} className="size-3" />{t(text)}</span>
}

// Reliability ring: the number sits inside, the arc is only a second cue.
export function Ring({ value, label, size = 44 }: { value: number | null; label: string; size?: number }) {
  const r = 18, c = 2 * Math.PI * r, v = value == null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <span role="img" aria-label={`${label}: ${value == null ? '-' : Math.round(v) + '%'}`} className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 44 44" width={size} height={size} aria-hidden="true">
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--soft)" strokeWidth="4" />
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(c * v) / 100} ${c}`} transform="rotate(-90 22 22)" className="ring-arc" />
      </svg>
      <span className="absolute text-xs font-semibold tabular-nums">{value == null ? '-' : Math.round(v)}</span>
    </span>
  )
}

export function Spark({ values, label, w = 96, h = 28 }: { values: (string | number)[]; label: string; w?: number; h?: number }) {
  const v = values.map(Number)
  if (v.length < 2) return <span className="text-xs text-muted">-</span>
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1
  const pts = v.map((y, i) => `${(i / (v.length - 1)) * (w - 4) + 2},${h - 3 - ((y - lo) / span) * (h - 6)}`).join(' ')
  const up = v[v.length - 1] > v[0]
  return (
    <span role="img" aria-label={`${label}: ${up ? '↑' : '↓'} ${num(v[0], 2)} → ${num(v[v.length - 1], 2)}`} className="inline-flex items-center gap-1">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true"><polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" /></svg>
      <span aria-hidden="true" className="text-xs">{up ? '↑' : '↓'}</span>
    </span>
  )
}

// Segmented control: In contract | Not in contract | All
export type Mode = 'all' | 'in' | 'not'
export function ModeSwitch({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const opts: [Mode, Text][] = [['in', S.in], ['not', S.not], ['all', S.all]]
  return (
    <div role="group" aria-label={t(S.contract)} className="inline-flex overflow-hidden rounded-ui border border-line">
      {opts.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
          className={`min-h-(--control-h) px-3 text-sm ${value === k ? 'bg-tint font-bold' : 'bg-surface'} ${k !== 'in' ? 'border-l border-line' : ''}`}>
          {value === k && <Icon name="check" className="mr-1 inline size-3" />}{t(l)}
        </button>
      ))}
    </div>
  )
}

export const inMode = (s: string) => s === 'in_contract' || s === 'expiring'

// Simple (one answer) / Detailed (everything) switch, remembered per browser.
export function useDetail(): [boolean, (b: boolean) => void] {
  const [d, set] = useState(() => { try { return localStorage.getItem('laris.detail') === '1' } catch { return false } })
  return [d, (b: boolean) => { set(b); try { localStorage.setItem('laris.detail', b ? '1' : '0') } catch { /* blocked */ } }]
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`card max-h-[90vh] w-full overflow-auto ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-base font-semibold">{title}</h2>
          <button type="button" className="btn btn-quiet btn-sm" aria-label={t({ en: 'Close', ms: 'Tutup', zh: '关闭', ta: 'மூடு' })} onClick={onClose} autoFocus><Icon name="close" className="size-4" /></button></div>
        {children}
      </div>
    </div>
  )
}

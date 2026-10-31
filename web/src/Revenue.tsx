import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { api } from './api'
import { ActionError, Async, PageHeader, TableRegion, rm, useAction, useFetch } from './ui'
import { CountUp } from './dash'
import { Icon } from './icons'
import { locale, t, useLang } from './i18n'
import type { Text } from './i18n'
import { useToast } from './Toast'
import { PERIOD_KEYS, check, daysIn, granularity, niceTicks, range, share } from './revenuePeriods'
import type { PeriodKey, Range } from './revenuePeriods'

// Revenue: money in and out, untung kasar (gross profit) and untung bersih (net profit) for a period the owner picks. Simple on top (a sentence, four
// numbers, two pictures); tapping a number opens exactly how it is worked out, with the real orders and costs behind it. The arithmetic is the server's
// (src/revenue.py, GET /api/revenue); this page only draws it. Amounts arrive as strings and are shown as they came, never re-added here.
const S = {
  title: { en: 'Revenue', ms: 'Hasil', zh: '收入', ta: 'வருவாய்' },
  lead: { en: 'Money in, money out, and what you keep.', ms: 'Wang masuk, wang keluar, dan apa yang anda simpan.', zh: '收入、支出，以及您最终留下的钱。', ta: 'வரும் பணம், போகும் பணம், நீங்கள் கையில் வைத்திருப்பது.' },
  period: { en: 'Period', ms: 'Tempoh', zh: '时间段', ta: 'காலம்' },
  from: { en: 'From', ms: 'Dari', zh: '从', ta: 'முதல்' },
  to: { en: 'To', ms: 'Hingga', zh: '到', ta: 'வரை' },
  moneyIn: { en: 'Money in', ms: 'Wang masuk', zh: '收到的钱', ta: 'வரும் பணம்' },
  moneyOut: { en: 'Money out', ms: 'Wang keluar', zh: '支出的钱', ta: 'போகும் பணம்' },
  gross: { en: 'Gross profit', ms: 'Untung kasar', zh: '毛利', ta: 'மொத்த லாபம்' },
  net: { en: 'Net profit', ms: 'Untung bersih', zh: '净利润', ta: 'நிகர லாபம்' },
  sales: { en: 'Sales', ms: 'Jualan', zh: '销售额', ta: 'விற்பனை' },
  goods: { en: 'Cost of goods', ms: 'Kos barang', zh: '商品成本', ta: 'பொருள் செலவு' },
  running: { en: 'Running costs', ms: 'Kos operasi', zh: '经营开支', ta: 'இயக்கச் செலவுகள்' },
  leftOver: { en: 'Left over', ms: 'Baki', zh: '结余', ta: 'மீதம்' },
  toCollect: { en: 'Customers still owe you', ms: 'Pelanggan masih berhutang', zh: '客户仍欠您', ta: 'வாடிக்கையாளர்கள் இன்னும் தர வேண்டியது' },
  glance: { en: 'At a glance', ms: 'Sekilas pandang', zh: '一览', ta: 'ஒரே பார்வையில்' },
  how: { en: 'How is this worked out?', ms: 'Bagaimana ini dikira?', zh: '这是怎么算出来的？', ta: 'இது எப்படிக் கணக்கிடப்படுகிறது?' },
  bridgeTitle: { en: 'Where your sales went', ms: 'Ke mana jualan anda pergi', zh: '销售额去了哪里', ta: 'உங்கள் விற்பனை எங்கே சென்றது' },
  bridgeLead: { en: 'Tap a bar to see how it is worked out.', ms: 'Ketik bar untuk lihat cara ia dikira.', zh: '点按柱条，查看计算方法。', ta: 'எப்படிக் கணக்கிடப்படுகிறது என்று பார்க்க பட்டையைத் தொடவும்.' },
  chartTitle: { en: 'Money in and money out', ms: 'Wang masuk dan wang keluar', zh: '收入与支出', ta: 'வரும் பணமும் போகும் பணமும்' },
  chartLead: { en: 'Green is what customers paid. Striped is what the goods and running costs took.', ms: 'Hijau ialah bayaran pelanggan. Berjalur ialah kos barang dan kos operasi.', zh: '绿色是客户付的钱，条纹是商品和经营开支花掉的钱。', ta: 'பச்சை என்பது வாடிக்கையாளர்கள் செலுத்தியது. கோடிட்டது பொருள் மற்றும் இயக்கச் செலவுகள்.' },
  asTable: { en: 'Show as a table', ms: 'Tunjuk sebagai jadual', zh: '以表格显示', ta: 'அட்டவணையாகக் காட்டு' },
  asChart: { en: 'Show as a chart', ms: 'Tunjuk sebagai carta', zh: '以图表显示', ta: 'விளக்கப்படமாகக் காட்டு' },
  empty: { en: 'No sales or payments in this period yet.', ms: 'Belum ada jualan atau bayaran dalam tempoh ini.', zh: '这个时间段还没有销售或收款。', ta: 'இந்தக் காலத்தில் இன்னும் விற்பனை அல்லது கட்டணம் இல்லை.' },
  emptyHint: { en: 'A sale shows here when a customer accepts a quote. Money in shows when you record a payment.', ms: 'Jualan muncul di sini apabila pelanggan menerima sebut harga. Wang masuk muncul apabila anda merekod bayaran.', zh: '客户接受报价后，销售会显示在这里；记录收款后，收入会显示在这里。', ta: 'வாடிக்கையாளர் மேற்கோளை ஏற்றால் விற்பனை இங்கே தெரியும். கட்டணத்தைப் பதிவு செய்தால் வரும் பணம் தெரியும்.' },
  inProfit: { en: 'In profit', ms: 'Untung', zh: '盈利', ta: 'லாபத்தில்' },
  inLoss: { en: 'Making a loss', ms: 'Rugi', zh: '亏损', ta: 'நஷ்டத்தில்' },
  keepBar: { en: 'Every RM1 you sold', ms: 'Setiap RM1 yang anda jual', zh: '您每卖出 RM1', ta: 'நீங்கள் விற்கும் ஒவ்வொரு RM1' },
  sen: { en: 'sen', ms: 'sen', zh: '仙', ta: 'சென்' },
  kept: { en: 'You keep', ms: 'Anda simpan', zh: '您留下', ta: 'நீங்கள் வைத்திருப்பது' },
  spentMore: { en: 'You spent more than you sold', ms: 'Anda berbelanja lebih daripada jualan', zh: '您的支出超过了销售额', ta: 'நீங்கள் விற்றதை விட அதிகம் செலவழித்தீர்கள்' },
  noPrev: { en: 'Nothing to compare with before', ms: 'Tiada perbandingan sebelum ini', zh: '之前没有可比较的数据', ta: 'முன்பு ஒப்பிட எதுவும் இல்லை' },
  noCostWarn: { en: 'have no supplier cost recorded, so their gross profit looks bigger than it really is.', ms: 'tiada kos pembekal direkodkan, jadi untung kasarnya nampak lebih besar daripada sebenar.', zh: '没有记录供应商成本，所以它们的毛利看起来比实际更高。', ta: 'க்கு சப்ளையர் செலவு பதிவில்லை, அதனால் மொத்த லாபம் உண்மையை விடப் பெரிதாகத் தெரிகிறது.' },
  noRunning: { en: 'No running costs are recorded for this period, so net profit is the same as gross profit. Add your rent, wages and bills to see the real figure.', ms: 'Tiada kos operasi direkodkan untuk tempoh ini, jadi untung bersih sama dengan untung kasar. Tambah sewa, gaji dan bil anda untuk melihat angka sebenar.', zh: '这个时间段没有记录经营开支，所以净利润和毛利相同。请添加租金、工资和账单，才能看到真实数字。', ta: 'இந்தக் காலத்துக்கு இயக்கச் செலவுகள் பதிவில்லை, அதனால் நிகர லாபம் மொத்த லாபத்துக்குச் சமம். உண்மையான எண்ணைப் பார்க்க வாடகை, சம்பளம், கட்டணங்களைச் சேர்க்கவும்.' },
  addCost: { en: 'Add a running cost', ms: 'Tambah kos operasi', zh: '添加经营开支', ta: 'இயக்கச் செலவைச் சேர்' },
  // the explanations, one per number
  eIn: { en: 'Money in is what customers actually paid you in this period: deposits and balances, minus any payment that was reversed. It is not the same as sales. An order that is not paid yet is in Sales but not in Money in.', ms: 'Wang masuk ialah bayaran sebenar pelanggan dalam tempoh ini: deposit dan baki, tolak bayaran yang dibatalkan. Ia tidak sama dengan jualan. Pesanan yang belum dibayar ada dalam Jualan tetapi tidak dalam Wang masuk.', zh: '收到的钱是客户在这段时间实际付给您的钱：订金和余款，减去被撤销的付款。它与销售额不同：尚未付款的订单计入销售额，但不计入收到的钱。', ta: 'வரும் பணம் என்பது இந்தக் காலத்தில் வாடிக்கையாளர்கள் உண்மையில் செலுத்தியது: முன்பணமும் மீதியும், ரத்து செய்யப்பட்ட கட்டணத்தைக் கழித்து. இது விற்பனையிலிருந்து வேறுபட்டது. இன்னும் செலுத்தப்படாத ஆர்டர் விற்பனையில் இருக்கும், வரும் பணத்தில் இருக்காது.' },
  eOut: { en: 'Money out is the cost of goods plus your running costs. The cost of goods is counted on the day the order was won, using your supplier prices, not on the day you paid the supplier.', ms: 'Wang keluar ialah kos barang tambah kos operasi anda. Kos barang dikira pada hari pesanan dimenangi, menggunakan harga pembekal anda, bukan pada hari anda membayar pembekal.', zh: '支出的钱是商品成本加上经营开支。商品成本按订单成交当天、用您的供应商价格计算，而不是按您付钱给供应商的那天。', ta: 'போகும் பணம் என்பது பொருள் செலவும் இயக்கச் செலவுகளும். பொருள் செலவு ஆர்டர் வென்ற நாளில், உங்கள் சப்ளையர் விலைகளைக் கொண்டு கணக்கிடப்படுகிறது; சப்ளையருக்குப் பணம் கொடுத்த நாளில் அல்ல.' },
  eSales: { en: 'Sales is the value of the orders you won in this period, without SST. An order counts on the day the customer accepted the quote.', ms: 'Jualan ialah nilai pesanan yang anda menangi dalam tempoh ini, tanpa SST. Pesanan dikira pada hari pelanggan menerima sebut harga.', zh: '销售额是您在这段时间成交的订单金额（不含 SST）。订单按客户接受报价的那天计算。', ta: 'விற்பனை என்பது இந்தக் காலத்தில் நீங்கள் வென்ற ஆர்டர்களின் மதிப்பு (SST இல்லாமல்). வாடிக்கையாளர் மேற்கோளை ஏற்ற நாளில் ஆர்டர் கணக்கிடப்படும்.' },
  eGoods: { en: 'Cost of goods is what those orders cost you to buy or make, worked out from your supplier prices (the cost book) when the quote was priced.', ms: 'Kos barang ialah kos untuk membeli atau membuat pesanan itu, dikira daripada harga pembekal anda (buku kos) semasa sebut harga ditetapkan.', zh: '商品成本是这些订单的采购或制作成本，按报价时您的供应商价格（成本簿）计算。', ta: 'பொருள் செலவு என்பது அந்த ஆர்டர்களை வாங்க அல்லது தயாரிக்க ஆன செலவு; மேற்கோள் விலையிடப்பட்டபோது உங்கள் சப்ளையர் விலைகளிலிருந்து (செலவுப் புத்தகம்) கணக்கிடப்படுகிறது.' },
  eGross: { en: 'Untung kasar (gross profit) is what is left of your sales after paying for the goods. It does not include rent, wages or bills.', ms: 'Untung kasar ialah baki jualan anda selepas membayar kos barang. Ia tidak termasuk sewa, gaji atau bil.', zh: '毛利（untung kasar）是销售额扣除商品成本后剩下的钱，不包括租金、工资和账单。', ta: 'மொத்த லாபம் (untung kasar) என்பது பொருள் செலவைக் கொடுத்த பிறகு விற்பனையில் மீதமிருப்பது. வாடகை, சம்பளம், கட்டணங்கள் இதில் சேராது.' },
  eRunning: { en: 'Running costs are what it costs to keep the business going whatever you sell: rent, wages, bills. Add them here so untung bersih is right.', ms: 'Kos operasi ialah kos untuk meneruskan perniagaan walau apa pun jualan anda: sewa, gaji, bil. Tambah di sini supaya untung bersih betul.', zh: '经营开支是不管卖多少都要付的成本：租金、工资、账单。请在这里添加，净利润才准确。', ta: 'இயக்கச் செலவுகள் என்பது எவ்வளவு விற்றாலும் வணிகத்தை நடத்த ஆகும் செலவு: வாடகை, சம்பளம், கட்டணங்கள். நிகர லாபம் சரியாக இருக்க இங்கே சேர்க்கவும்.' },
  eNet: { en: 'Untung bersih (net profit) is what you really keep: untung kasar minus running costs. Income tax is not taken off unless you record it as a running cost (Tax).', ms: 'Untung bersih ialah apa yang anda benar-benar simpan: untung kasar tolak kos operasi. Cukai pendapatan tidak ditolak melainkan anda merekodnya sebagai kos operasi (Cukai).', zh: '净利润（untung bersih）是您真正留下的钱：毛利减去经营开支。除非您把所得税记为经营开支（税款），否则不会扣除。', ta: 'நிகர லாபம் (untung bersih) என்பது நீங்கள் உண்மையில் வைத்திருப்பது: மொத்த லாபத்திலிருந்து இயக்கச் செலவுகளைக் கழித்தது. வருமான வரியை இயக்கச் செலவாக (வரி) பதிவு செய்யாவிட்டால் அது கழிக்கப்படாது.' },
  counted: { en: 'Orders counted', ms: 'Pesanan dikira', zh: '计入的订单', ta: 'கணக்கிடப்பட்ட ஆர்டர்கள்' },
  costsCounted: { en: 'Running costs counted', ms: 'Kos operasi dikira', zh: '计入的经营开支', ta: 'கணக்கிடப்பட்ட இயக்கச் செலவுகள்' },
  order: { en: 'Order', ms: 'Pesanan', zh: '订单', ta: 'ஆர்டர்' },
  customer: { en: 'Customer', ms: 'Pelanggan', zh: '客户', ta: 'வாடிக்கையாளர்' },
  date: { en: 'Date', ms: 'Tarikh', zh: '日期', ta: 'தேதி' },
  cost: { en: 'Cost', ms: 'Kos', zh: '成本', ta: 'செலவு' },
  noCost: { en: 'no cost recorded', ms: 'tiada kos direkodkan', zh: '未记录成本', ta: 'செலவு பதிவில்லை' },
  partCost: { en: 'cost only partly known', ms: 'kos hanya diketahui sebahagian', zh: '成本只掌握了一部分', ta: 'செலவு ஓரளவே தெரியும்' },
  biggest: { en: 'Showing the biggest 100.', ms: 'Menunjukkan 100 terbesar.', zh: '显示最大的 100 项。', ta: 'மிகப் பெரிய 100 ஐக் காட்டுகிறது.' },
  none: { en: 'Nothing here for this period.', ms: 'Tiada apa-apa untuk tempoh ini.', zh: '这段时间没有相关内容。', ta: 'இந்தக் காலத்துக்கு இங்கே எதுவும் இல்லை.' },
  category: { en: 'Kind of cost', ms: 'Jenis kos', zh: '开支类别', ta: 'செலவு வகை' },
  amount: { en: 'Amount (RM)', ms: 'Jumlah (RM)', zh: '金额 (RM)', ta: 'தொகை (RM)' },
  note: { en: 'Note (optional)', ms: 'Nota (pilihan)', zh: '备注（选填）', ta: 'குறிப்பு (விருப்பம்)' },
  save: { en: 'Save running cost', ms: 'Simpan kos operasi', zh: '保存经营开支', ta: 'இயக்கச் செலவைச் சேமி' },
  cancel: { en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து செய்' },
  added: { en: 'Running cost added', ms: 'Kos operasi ditambah', zh: '已添加经营开支', ta: 'இயக்கச் செலவு சேர்க்கப்பட்டது' },
  voidIt: { en: 'Void', ms: 'Batalkan', zh: '作废', ta: 'செல்லாததாக்கு' },
  voidWhy: { en: 'Why? (a few words)', ms: 'Kenapa? (beberapa patah perkataan)', zh: '原因？（几个字即可）', ta: 'ஏன்? (சில வார்த்தைகள்)' },
  voidConfirm: { en: 'Void this cost', ms: 'Batalkan kos ini', zh: '作废这笔开支', ta: 'இந்தச் செலவைச் செல்லாததாக்கு' },
  voided: { en: 'Running cost voided', ms: 'Kos operasi dibatalkan', zh: '经营开支已作废', ta: 'இயக்கச் செலவு செல்லாததாக்கப்பட்டது' },
  badAmount: { en: 'Enter an amount above zero, with at most two decimals.', ms: 'Masukkan jumlah melebihi sifar, dengan paling banyak dua perpuluhan.', zh: '请输入大于零的金额，最多两位小数。', ta: 'பூஜ்ஜியத்துக்கு மேல், அதிகபட்சம் இரண்டு தசமங்களுடன் தொகையை உள்ளிடவும்.' },
  badRange: { en: 'Pick a start date that is not after the end date, no more than two years apart.', ms: 'Pilih tarikh mula yang tidak selepas tarikh akhir, tidak lebih dua tahun.', zh: '请选择不晚于结束日期的开始日期，且相隔不超过两年。', ta: 'முடிவுத் தேதிக்குப் பின் இல்லாத, இரண்டு ஆண்டுக்குள் உள்ள தொடக்கத் தேதியைத் தேர்ந்தெடுக்கவும்.' },
  updating: { en: 'Updating...', ms: 'Mengemas kini...', zh: '正在更新...', ta: 'புதுப்பிக்கிறது...' },
} satisfies Record<string, Text>
const PERIOD_NAME: Record<PeriodKey, Text> = {
  month: { en: 'This month', ms: 'Bulan ini', zh: '本月', ta: 'இந்த மாதம்' }, 'last-month': { en: 'Last month', ms: 'Bulan lepas', zh: '上月', ta: 'கடந்த மாதம்' },
  quarter: { en: 'Last 3 months', ms: '3 bulan lepas', zh: '近3个月', ta: 'கடந்த 3 மாதங்கள்' }, year: { en: 'This year', ms: 'Tahun ini', zh: '今年', ta: 'இந்த ஆண்டு' },
  custom: { en: 'Choose dates', ms: 'Pilih tarikh', zh: '自选日期', ta: 'தேதிகளைத் தேர்வு' },
}
const BY: Record<string, Text> = {
  day: { en: 'by day', ms: 'mengikut hari', zh: '按天', ta: 'நாள் வாரியாக' }, week: { en: 'by week', ms: 'mengikut minggu', zh: '按周', ta: 'வாரம் வாரியாக' },
  month: { en: 'by month', ms: 'mengikut bulan', zh: '按月', ta: 'மாதம் வாரியாக' },
}
const CAT: Record<string, Text> = {
  rent: { en: 'Rent', ms: 'Sewa', zh: '租金', ta: 'வாடகை' }, wages: { en: 'Wages', ms: 'Gaji', zh: '工资', ta: 'சம்பளம்' },
  utilities: { en: 'Utilities (water, power, internet)', ms: 'Utiliti (air, elektrik, internet)', zh: '水电网费', ta: 'பயன்பாடுகள் (நீர், மின்சாரம், இணையம்)' },
  transport: { en: 'Transport', ms: 'Pengangkutan', zh: '交通运输', ta: 'போக்குவரத்து' }, marketing: { en: 'Marketing', ms: 'Pemasaran', zh: '营销', ta: 'சந்தைப்படுத்தல்' },
  tax: { en: 'Tax', ms: 'Cukai', zh: '税款', ta: 'வரி' }, other: { en: 'Other', ms: 'Lain-lain', zh: '其他', ta: 'மற்றவை' },
}

interface Bucket { from: string; to: string; money_in: string; goods: string; running: string; money_out: string; left_over: string }
interface OrderRow { id: string; ref: string | null; customer: string | null; on: string; sales: string; cost: string | null; gross: string; cost_known: boolean }
interface ExpenseRow { id: string; on: string; category: string; amount: string; note: string | null }
type Key = 'sales' | 'goods' | 'gross' | 'running' | 'net' | 'money_in' | 'money_out'
interface Report {
  from: string; to: string; days: number; granularity: 'day' | 'week' | 'month'
  sales: string; goods: string; gross: string; gross_pct: string | null; running: string; net: string; net_pct: string | null
  money_in: string; money_out: string; left_over: string; to_collect: string; orders_counted: number; orders_without_cost: number
  series: Bucket[]; orders: OrderRow[]; expenses_by_category: { category: string; amount: string }[]; expense_rows: ExpenseRow[]
  previous: Record<'sales' | 'gross' | 'net' | 'money_in' | 'money_out', string> & { from: string; to: string }
  change_pct: Record<'sales' | 'gross' | 'net' | 'money_in' | 'money_out', string | null>
  categories: string[]; can_record: boolean; can_void: boolean; today: string
}

const n = (s: string | null | undefined) => Number(s ?? 0)
// A titled glass panel (the app's `.card`), labelled by its heading.
function Panel({ id, title, className = '', children }: { id: string; title: string; className?: string; children: ReactNode }) {
  return <section aria-labelledby={id} className={`card min-w-0 ${className}`}><h2 id={id} className="mb-3 text-md font-semibold tracking-tight">{title}</h2>{children}</section>
}
const cv = (i: number) => ({ '--i': i }) as CSSProperties            // the position of a bar or card, so CSS can stagger its entrance
const money = (s: string | null | undefined) => rm(s ?? '0')
const lossOf = (s: string) => s.replace('-', '')                 // "-1150.00" as the size of the loss, "1150.00"
const countMoney = (v: number) => rm(v.toFixed(2))
const day = (isoDate: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale(), o).format(new Date(isoDate + 'T00:00:00'))
const short = (isoDate: string) => day(isoDate, { day: 'numeric', month: 'short' })
const full = (isoDate: string) => day(isoDate, { day: 'numeric', month: 'short', year: 'numeric' })
const compact = (v: number) => 'RM ' + new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(v)
const KEY = 'laris.revenue.period'
const load = (): { key: PeriodKey; custom: Range } => {
  const d = range('month', new Date())
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (v && (PERIOD_KEYS as string[]).includes(v.key)) return { key: v.key, custom: v.custom?.from && v.custom?.to ? v.custom : d }
  } catch { /* storage blocked or damaged: start on this month */ }
  return { key: 'month', custom: d }
}

export function RevenueView() {
  useLang()
  const toast = useToast()
  const [per, setPer] = useState(load)
  const today = new Date()
  const r = range(per.key, today, per.custom)
  const bad = per.key === 'custom' ? check(per.custom) : null
  const s = useFetch<Report>(bad ? null : `/revenue?from=${r.from}&to=${r.to}`)
  const [open, setOpen] = useState<Key | null>(null)
  const [adding, setAdding] = useState(false)
  const panel = useRef<HTMLElement>(null)
  const pick = (key: PeriodKey, custom = per.custom) => { setPer({ key, custom }); try { localStorage.setItem(KEY, JSON.stringify({ key, custom })) } catch { /* lasts for this visit */ } }
  const d = s.data
  const choose = (k: Key | null) => { setOpen(k); if (k !== 'running') setAdding(false) }
  useEffect(() => { if (open) panel.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }, [open])

  const actions = d?.can_record ? <button type="button" className="btn btn-primary gap-2" onClick={() => { setOpen('running'); setAdding(true) }}><Icon name="plus" className="size-4" />{t(S.addCost)}</button> : undefined
  return (
    <>
      <PageHeader title={t(S.title)} description={t(S.lead)} actions={actions} />
      <PeriodBar per={per} r={r} bad={bad} onPick={pick} />
      <Async s={s} empty={false} rows={4} shape="tiles">
        {d && <div aria-busy={s.loading || undefined} className={`grid gap-4 ${s.loading ? 'opacity-60 transition-opacity' : ''}`}>
          {s.loading && <p role="status" className="sr-only">{t(S.updating)}</p>}
          {d.orders_counted === 0 && n(d.money_in) === 0 && n(d.running) === 0 ? (
            <Panel id="rv-empty" title={t(S.empty)}><p className="text-sm text-muted">{t(S.emptyHint)}</p></Panel>
          ) : <>
            <Headline d={d} />
            <Cards d={d} open={open} onPick={choose} />
            <Notes d={d} onAdd={() => { setOpen('running'); setAdding(true) }} />
            {open && <Explain d={d} which={open} adding={adding} setAdding={setAdding} panelRef={panel} onChanged={() => { s.reload(); toast(t(S.added)) }} onVoided={() => { s.reload(); toast(t(S.voided)) }} />}
            <Bridge d={d} open={open} onPick={choose} />
            <CashChart d={d} />
          </>}
        </div>}
      </Async>
    </>
  )
}

function PeriodBar({ per, r, bad, onPick }: { per: { key: PeriodKey; custom: Range }; r: Range; bad: ReturnType<typeof check>; onPick: (k: PeriodKey, c?: Range) => void }) {
  const g = granularity(daysIn(r))
  return (
    <div className="mb-4 grid gap-2">
      <div role="group" aria-label={t(S.period)} className="rev-periods">
        {PERIOD_KEYS.map(k => <button key={k} type="button" className="btn btn-sm aria-pressed:bg-tint aria-pressed:font-bold" aria-pressed={per.key === k} onClick={() => onPick(k)}>{t(PERIOD_NAME[k])}</button>)}
      </div>
      {per.key === 'custom' && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm font-semibold">{t(S.from)}<input type="date" className="input" value={per.custom.from} max={per.custom.to || undefined} onChange={e => onPick('custom', { ...per.custom, from: e.target.value })} /></label>
          <label className="grid gap-1 text-sm font-semibold">{t(S.to)}<input type="date" className="input" value={per.custom.to} min={per.custom.from || undefined} onChange={e => onPick('custom', { ...per.custom, to: e.target.value })} /></label>
        </div>
      )}
      {bad ? <p role="alert" className="text-sm text-warn">{t(S.badRange)}</p>
        : <p className="text-sm text-muted">{short(r.from)} to {full(r.to)} · {t(BY[g])}</p>}
    </div>
  )
}

function Delta({ pct, upIsGood }: { pct: string | null; upIsGood: boolean }) {
  if (pct === null) return <span className="rev-delta">{t(S.noPrev)}</span>
  const v = Number(pct), up = v > 0, flat = v === 0
  const good = flat ? null : up === upIsGood
  const word = flat ? { en: 'Same as the period before', ms: 'Sama seperti tempoh sebelum ini', zh: '与上一时间段相同', ta: 'முந்தைய காலத்தைப் போலவே' }
    : up && v >= 1000 ? { en: 'More than 10 times the period before', ms: 'Lebih 10 kali ganda tempoh sebelum ini', zh: '是上一时间段的 10 倍以上', ta: 'முந்தைய காலத்தை விட 10 மடங்குக்கும் அதிகம்' }
    : up ? { en: `${Math.abs(v)}% more than the period before`, ms: `${Math.abs(v)}% lebih daripada tempoh sebelum ini`, zh: `比上一时间段多 ${Math.abs(v)}%`, ta: `முந்தைய காலத்தை விட ${Math.abs(v)}% அதிகம்` }
      : { en: `${Math.abs(v)}% less than the period before`, ms: `${Math.abs(v)}% kurang daripada tempoh sebelum ini`, zh: `比上一时间段少 ${Math.abs(v)}%`, ta: `முந்தைய காலத்தை விட ${Math.abs(v)}% குறைவு` }
  return <span className={`rev-delta ${good === null ? '' : good ? 'rev-delta-good' : 'rev-delta-bad'}`}><span aria-hidden="true">{flat ? '=' : up ? '▲' : '▼'}</span> {t(word)}</span>
}

// One sentence a shop owner would say, and the "every RM1 you sold" bar that shows where it went.
function Headline({ d }: { d: Report }) {
  const sales = n(d.sales), goods = n(d.goods), gross = n(d.gross), run = n(d.running), net = n(d.net), loss = net < 0
  const total = goods + run + Math.max(net, 0)
  const sen = (v: number) => (sales > 0 ? Math.round((v / sales) * 100) : 0)
  const parts = [{ k: 'goods', v: goods, label: S.goods }, { k: 'run', v: run, label: S.running }, { k: 'kept', v: Math.max(net, 0), label: S.kept }]
  return (
    <Panel id="rv-head" title={t(S.glance)} className="rev-head">
      <p className="text-lg leading-snug">
        {sales > 0
          ? gross < 0
            ? t({ en: `You sold ${money(d.sales)} but the goods cost ${money(d.goods)}, so you are already making a loss (rugi) of ${money(lossOf(d.gross))} before running costs.`,
                  ms: `Anda menjual ${money(d.sales)} tetapi kos barang ${money(d.goods)}, jadi anda sudah rugi ${money(lossOf(d.gross))} sebelum kos operasi.`,
                  zh: `您卖出了 ${money(d.sales)}，但商品成本是 ${money(d.goods)}，所以在计入经营开支之前就已经亏损了 ${money(lossOf(d.gross))}。`,
                  ta: `நீங்கள் ${money(d.sales)} விற்றீர்கள், ஆனால் பொருள் செலவு ${money(d.goods)}, அதனால் இயக்கச் செலவுகளுக்கு முன்பே ${money(lossOf(d.gross))} நஷ்டம் (rugi).` })
            : loss
              ? t({ en: `You sold ${money(d.sales)}. After the cost of goods you have ${money(d.gross)} untung kasar, but your running costs are bigger, so you are making a loss (rugi) of ${money(lossOf(d.net))}.`,
                    ms: `Anda menjual ${money(d.sales)}. Selepas kos barang, untung kasar anda ${money(d.gross)}, tetapi kos operasi lebih besar, jadi anda rugi ${money(lossOf(d.net))}.`,
                    zh: `您卖出了 ${money(d.sales)}。扣除商品成本后毛利（untung kasar）是 ${money(d.gross)}，但经营开支更大，所以亏损了 ${money(lossOf(d.net))}。`,
                    ta: `நீங்கள் ${money(d.sales)} விற்றீர்கள். பொருள் செலவுக்குப் பிறகு மொத்த லாபம் (untung kasar) ${money(d.gross)}, ஆனால் இயக்கச் செலவுகள் அதிகம், அதனால் ${money(lossOf(d.net))} நஷ்டம் (rugi).` })
              : t({ en: `You sold ${money(d.sales)}. After the cost of goods you have ${money(d.gross)} untung kasar, and after running costs ${money(d.net)} untung bersih.`,
                    ms: `Anda menjual ${money(d.sales)}. Selepas kos barang, untung kasar anda ${money(d.gross)}, dan selepas kos operasi, untung bersih anda ${money(d.net)}.`,
                    zh: `您卖出了 ${money(d.sales)}。扣除商品成本后毛利（untung kasar）是 ${money(d.gross)}，再扣除经营开支后净利润（untung bersih）是 ${money(d.net)}。`,
                    ta: `நீங்கள் ${money(d.sales)} விற்றீர்கள். பொருள் செலவுக்குப் பிறகு மொத்த லாபம் (untung kasar) ${money(d.gross)}, இயக்கச் செலவுகளுக்குப் பிறகு நிகர லாபம் (untung bersih) ${money(d.net)}.` })
          : t({ en: `No sales yet in this period. Money in is ${money(d.money_in)}.`, ms: `Belum ada jualan dalam tempoh ini. Wang masuk ialah ${money(d.money_in)}.`, zh: `这段时间还没有销售。收到的钱是 ${money(d.money_in)}。`, ta: `இந்தக் காலத்தில் இன்னும் விற்பனை இல்லை. வரும் பணம் ${money(d.money_in)}.` })}
      </p>
      {sales > 0 && (
        <figure className="rev-rm1" aria-label={t(S.keepBar)}>
          <figcaption className="text-sm font-semibold">{t(S.keepBar)}</figcaption>
          <div className="rev-rm1-bar" role="img" aria-label={parts.map(p => `${t(p.label)} ${sen(p.v)} ${t(S.sen)}`).join(', ')}>
            {parts.filter(p => p.v > 0).map((p, i) => <span key={p.k} className={`rev-seg rev-seg-${p.k}`} style={{ ...cv(i), flexGrow: p.v / total }} />)}
          </div>
          <ul className="rev-rm1-key">
            {parts.map(p => <li key={p.k}><i aria-hidden="true" className={`rev-swatch rev-seg-${p.k}`} />{t(p.label)} <b className="tabular-nums">{sen(p.v)} {t(S.sen)}</b></li>)}
          </ul>
          <p className={`mt-1 text-sm font-semibold ${loss ? 'text-warn' : ''}`}>
            <span className={`chip ${loss ? 'chip-warn' : 'chip-accepted'}`}>{t(loss ? S.inLoss : S.inProfit)}</span>{' '}
            {loss ? t(S.spentMore) : ''}
          </p>
        </figure>
      )}
    </Panel>
  )
}

function Cards({ d, open, onPick }: { d: Report; open: Key | null; onPick: (k: Key | null) => void }) {
  const cards: { key: Key; label: Text; malay?: string; value: string; delta: string | null; upIsGood: boolean; icon: 'check' | 'upload' | 'alerts' | 'pipeline' }[] = [
    { key: 'money_in', label: S.moneyIn, value: d.money_in, delta: d.change_pct.money_in, upIsGood: true, icon: 'upload' },
    { key: 'money_out', label: S.moneyOut, value: d.money_out, delta: d.change_pct.money_out, upIsGood: false, icon: 'alerts' },
    { key: 'gross', label: S.gross, malay: 'untung kasar', value: d.gross, delta: d.change_pct.gross, upIsGood: true, icon: 'pipeline' },
    { key: 'net', label: S.net, malay: 'untung bersih', value: d.net, delta: d.change_pct.net, upIsGood: true, icon: 'check' },
  ]
  return (
    <ul className="rev-cards" aria-label={t(S.title)}>
      {cards.map((c, i) => {
        const on = open === c.key
        return (
          <li key={c.key}>
            <button type="button" className="rev-card" data-tone={c.key} aria-expanded={on} aria-controls="rev-explain" onClick={() => onPick(on ? null : c.key)} style={cv(i)}>
              <span className="flex items-center gap-2 text-sm font-semibold text-muted"><Icon name={c.icon} className="size-4" />{t(c.label)}{c.malay && locale() !== 'ms-MY' && <span className="font-normal">({c.malay})</span>}</span>
              <span className={`rev-num ${n(c.value) < 0 ? 'text-warn' : ''}`}><CountUp value={n(c.value)} format={countMoney} /></span>
              <Delta pct={c.delta} upIsGood={c.upIsGood} />
              <span className="rev-how"><span>{t(S.how)}</span><Icon name="down" className={`size-4 transition-transform ${on ? 'rotate-180' : ''}`} /></span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Notes({ d, onAdd }: { d: Report; onAdd: () => void }) {
  const items: ReactNode[] = []
  if (d.orders_without_cost > 0) items.push(<p key="c" className="rev-note"><Icon name="warn" className="size-4" /><span>{t({ en: `${d.orders_without_cost} ${d.orders_without_cost === 1 ? 'order' : 'orders'} `, ms: `${d.orders_without_cost} pesanan `, zh: `${d.orders_without_cost} 个订单`, ta: `${d.orders_without_cost} ஆர்டர்` })}{t(S.noCostWarn)}</span></p>)
  if (n(d.running) === 0 && d.orders_counted > 0) items.push(<p key="r" className="rev-note"><Icon name="warn" className="size-4" /><span>{t(S.noRunning)}{d.can_record && <> <button type="button" className="link" onClick={onAdd}>{t(S.addCost)}</button></>}</span></p>)
  if (n(d.to_collect) > 0) items.push(<p key="t" className="rev-note rev-note-info"><Icon name="clock" className="size-4" /><span>{t(S.toCollect)}: <b className="tabular-nums">{money(d.to_collect)}</b></span></p>)
  return items.length ? <div className="grid gap-2">{items}</div> : null
}

// ---------- the bridge: sales, minus goods, equals untung kasar, minus running costs, equals untung bersih ----------
function Bridge({ d, open, onPick }: { d: Report; open: Key | null; onPick: (k: Key | null) => void }) {
  const sales = n(d.sales), goods = n(d.goods), gross = n(d.gross), run = n(d.running), net = n(d.net)
  const base = Math.max(sales, goods + run, 0.01)
  const pos = (from: number, width: number) => ({ left: `${Math.max(0, from / base) * 100}%`, width: `${share(width, base) * 100}%` })
  const g0 = Math.max(gross, 0)
  const rows: { key: Key; op: string; label: Text; value: string; bar: { left: string; width: string }; over?: { left: string; width: string }; cls: string; pct?: string | null }[] = [
    { key: 'sales', op: '', label: S.sales, value: d.sales, bar: pos(0, sales), cls: 'in' },
    { key: 'goods', op: '−', label: S.goods, value: d.goods, bar: pos(sales - goods, goods), cls: 'out' },
    { key: 'gross', op: '=', label: S.gross, value: d.gross, bar: pos(0, g0), cls: 'keep', pct: d.gross_pct },
    { key: 'running', op: '−', label: S.running, value: d.running, bar: pos(Math.max(g0 - run, 0), Math.min(run, g0)), over: run > g0 ? pos(g0, run - g0) : undefined, cls: 'out' },
    { key: 'net', op: '=', label: S.net, value: d.net, bar: pos(0, Math.max(net, 0)), over: net < 0 ? pos(0, -net) : undefined, cls: net < 0 ? 'loss' : 'keep', pct: d.net_pct },
  ]
  return (
    <Panel id="rv-bridge" title={t(S.bridgeTitle)}>
      <p className="-mt-2 mb-3 text-sm text-muted">{t(S.bridgeLead)}</p>
      <ul className="rev-bridge">
        {rows.map((x, i) => (
          <li key={x.key}>
            <button type="button" className="rev-row" aria-expanded={open === x.key} aria-controls="rev-explain" onClick={() => onPick(open === x.key ? null : x.key)}>
              <span className="rev-row-label"><span aria-hidden="true" className="rev-op">{x.op}</span>{t(x.label)}</span>
              <span className="rev-track" aria-hidden="true">
                <span className={`rev-bar rev-bar-${x.cls}`} style={{ ...cv(i), ...x.bar }} />
                {x.over && <span className="rev-bar rev-bar-loss" style={{ ...cv(i), ...x.over }} />}
              </span>
              <span className="rev-row-value tabular-nums">{money(x.value)}{x.pct != null && <small> · {x.pct}%</small>}</span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

// ---------- money in and money out over the period ----------
function CashChart({ d }: { d: Report }) {
  const [table, setTable] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const s = d.series
  const W = 720, Hh = 280, L = 58, Rm = 10, T = 12, B = 34, pw = W - L - Rm, ph = Hh - T - B
  const all = s.flatMap(b => [n(b.money_in), n(b.money_out), n(b.left_over)])
  const { lo, hi: top, ticks: tk } = niceTicks(Math.min(...all, 0), Math.max(...all, 0))
  const y = (v: number) => T + ph * (top - v) / (top - lo)
  const gw = pw / Math.max(s.length, 1), bw = Math.max(2, Math.min(22, gw * 0.36))
  const cx = (i: number) => L + gw * (i + 0.5)
  const every = Math.ceil(s.length / 8)
  const label = (b: Bucket) => (d.granularity === 'month' ? day(b.from, { month: 'short' }) : short(b.from))
  const line = s.map((b, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)} ${y(n(b.left_over)).toFixed(1)}`).join(' ')
  const h = hover === null ? null : s[hover]
  return (
    <Panel id="rv-chart" title={t(S.chartTitle)}>
      <div className="-mt-2 mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{t(S.chartLead)}</p>
        <button type="button" className="btn btn-sm" aria-pressed={table} onClick={() => setTable(v => !v)}>{t(table ? S.asChart : S.asTable)}</button>
      </div>
      {table ? (
        <TableRegion label={t(S.chartTitle)}>
          <table className="w-full"><thead><tr><th>{t(S.date)}</th><th className="num">{t(S.moneyIn)}</th><th className="num">{t(S.moneyOut)}</th><th className="num">{t(S.leftOver)}</th></tr></thead>
            <tbody>{s.map(b => <tr key={b.from}><td>{b.from === b.to ? short(b.from) : `${short(b.from)} to ${short(b.to)}`}</td><td className="num">{money(b.money_in)}</td><td className="num">{money(b.money_out)}</td><td className={`num ${n(b.left_over) < 0 ? 'text-warn' : ''}`}>{money(b.left_over)}</td></tr>)}</tbody></table>
        </TableRegion>
      ) : (
        <div className="rev-chart" onPointerLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label={`${t(S.chartTitle)}: ${t(S.moneyIn)} ${money(d.money_in)}, ${t(S.moneyOut)} ${money(d.money_out)}, ${t(S.leftOver)} ${money(d.left_over)}`}>
            <defs><pattern id="rev-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" className="rev-hatch-bg" /><rect width="2.6" height="6" className="rev-hatch-fg" /></pattern></defs>
            {tk.map(v => <g key={v}><line x1={L} x2={W - Rm} y1={y(v)} y2={y(v)} className={v === 0 ? 'rev-zero' : 'rev-grid'} /><text x={L - 6} y={y(v) + 4} textAnchor="end" className="rev-axis">{compact(v)}</text></g>)}
            {s.map((b, i) => (
              <g key={b.from} onPointerEnter={() => setHover(i)}>
                <rect x={L + gw * i} y={T} width={gw} height={ph} fill="transparent" />
                <rect className="rev-b rev-b-in" x={cx(i) - bw - 0.5} y={y(Math.max(n(b.money_in), 0))} width={bw} height={Math.max(0, y(0) - y(Math.max(n(b.money_in), 0)))} style={cv(Math.min(i, 24))} />
                <rect className="rev-b rev-b-out" x={cx(i) + 0.5} y={y(n(b.money_out))} width={bw} height={Math.max(0, y(0) - y(n(b.money_out)))} style={cv(Math.min(i, 24))} />
                {i % every === 0 && <text x={cx(i)} y={Hh - 12} textAnchor="middle" className="rev-axis">{label(b)}</text>}
              </g>
            ))}
            <path d={line} className="rev-left" fill="none" />
            {s.map((b, i) => <circle key={b.from} cx={cx(i)} cy={y(n(b.left_over))} r={2.8} className={n(b.left_over) < 0 ? 'rev-dot rev-dot-neg' : 'rev-dot'} />)}
          </svg>
          {h && <div className="rev-tip" style={{ left: `${(cx(hover!) / W) * 100}%` }} role="status">
            <b>{h.from === h.to ? short(h.from) : `${short(h.from)} to ${short(h.to)}`}</b>
            <span>{t(S.moneyIn)} <b>{money(h.money_in)}</b></span><span>{t(S.moneyOut)} <b>{money(h.money_out)}</b></span><span>{t(S.leftOver)} <b className={n(h.left_over) < 0 ? 'text-warn' : ''}>{money(h.left_over)}</b></span>
          </div>}
          <ul className="rev-legend" aria-hidden="true">
            <li><i className="rev-swatch rev-swatch-in" />{t(S.moneyIn)}</li><li><i className="rev-swatch rev-swatch-out" />{t(S.moneyOut)}</li><li><i className="rev-swatch rev-swatch-left" />{t(S.leftOver)}</li>
          </ul>
        </div>
      )}
    </Panel>
  )
}

// ---------- the explanation under a tapped number ----------
const TITLE: Record<Key, Text> = { sales: S.sales, goods: S.goods, gross: S.gross, running: S.running, net: S.net, money_in: S.moneyIn, money_out: S.moneyOut }
const BODY: Record<Key, Text> = { sales: S.eSales, goods: S.eGoods, gross: S.eGross, running: S.eRunning, net: S.eNet, money_in: S.eIn, money_out: S.eOut }

function Eq({ parts }: { parts: { label: string; value: string; op?: string; strong?: boolean }[] }) {
  return (
    <p className="rev-eq" aria-label={parts.map(p => `${p.op ?? ''} ${p.label} ${p.value}`).join(' ')}>
      {parts.map((p, i) => <span key={i} className="contents">{p.op && <b aria-hidden="true" className="rev-eq-op">{p.op}</b>}<span className={`rev-eq-box ${p.strong ? 'rev-eq-strong' : ''}`}><small>{p.label}</small><b className="tabular-nums">{p.value}</b></span></span>)}
    </p>
  )
}

function Explain({ d, which, adding, setAdding, panelRef, onChanged, onVoided }: {
  d: Report; which: Key; adding: boolean; setAdding: (v: boolean) => void; panelRef: RefObject<HTMLElement | null>; onChanged: () => void; onVoided: () => void
}) {
  const L = (x: Text) => t(x)
  const eq: Record<Key, { label: string; value: string; op?: string; strong?: boolean }[]> = {
    sales: [{ label: L(S.counted), value: String(d.orders_counted) }, { label: L(S.sales), value: money(d.sales), op: '=', strong: true }],
    goods: [{ label: L(S.sales), value: money(d.sales) }, { label: L(S.goods), value: money(d.goods), op: '→', strong: true }],
    gross: [{ label: L(S.sales), value: money(d.sales) }, { label: L(S.goods), value: money(d.goods), op: '−' }, { label: L(S.gross), value: money(d.gross), op: '=', strong: true }],
    running: [{ label: L(S.costsCounted), value: String(d.expense_rows.length) }, { label: L(S.running), value: money(d.running), op: '=', strong: true }],
    net: [{ label: L(S.gross), value: money(d.gross) }, { label: L(S.running), value: money(d.running), op: '−' }, { label: L(S.net), value: money(d.net), op: '=', strong: true }],
    money_in: [{ label: L(S.moneyIn), value: money(d.money_in), strong: true }, { label: L(S.toCollect), value: money(d.to_collect), op: '+' }],
    money_out: [{ label: L(S.goods), value: money(d.goods) }, { label: L(S.running), value: money(d.running), op: '+' }, { label: L(S.moneyOut), value: money(d.money_out), op: '=', strong: true }],
  }
  const showOrders = which === 'sales' || which === 'goods' || which === 'gross'
  const showCosts = which === 'running' || which === 'net' || which === 'money_out'
  return (
    <section id="rev-explain" ref={panelRef} role="region" aria-labelledby="rev-explain-h" className="card rev-explain">
      <h2 id="rev-explain-h" className="text-md font-semibold tracking-tight">{L(S.how)} {L(TITLE[which])}</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-2">{L(BODY[which])}</p>
      <Eq parts={eq[which]} />
      {which === 'gross' && d.gross_pct != null && <p className="text-sm text-muted">{d.gross_pct}% {t({ en: 'of your sales', ms: 'daripada jualan anda', zh: '占您的销售额', ta: 'உங்கள் விற்பனையில்' })}</p>}
      {which === 'net' && d.net_pct != null && <p className="text-sm text-muted">{d.net_pct}% {t({ en: 'of your sales', ms: 'daripada jualan anda', zh: '占您的销售额', ta: 'உங்கள் விற்பனையில்' })}</p>}
      {showOrders && <Orders d={d} showCost={which !== 'sales'} />}
      {(showCosts) && <Costs d={d} adding={adding && which === 'running'} setAdding={setAdding} onChanged={onChanged} onVoided={onVoided} />}
      {which === 'money_in' && <MoneyIn d={d} />}
    </section>
  )
}

function Orders({ d, showCost }: { d: Report; showCost: boolean }) {
  if (!d.orders.length) return <p className="mt-3 text-sm text-muted">{t(S.none)}</p>
  return (
    <div className="mt-3 grid gap-2">
      <TableRegion label={t(S.order)}>
        <table className="w-full">
          <thead><tr><th>{t(S.order)}</th><th>{t(S.customer)}</th><th>{t(S.date)}</th><th className="num">{t(S.sales)}</th>{showCost && <><th className="num">{t(S.cost)}</th><th className="num">{t(S.gross)}</th></>}</tr></thead>
          <tbody>{d.orders.map(o => (
            <tr key={o.id}><td className="font-semibold">{o.ref ?? '-'}</td><td>{o.customer ?? '-'}</td><td className="whitespace-nowrap">{short(o.on)}</td><td className="num">{money(o.sales)}</td>
              {showCost && <><td className="num">{o.cost === null ? <span className="text-warn">{t(S.noCost)}</span> : <>{money(o.cost)}{!o.cost_known && <span className="block text-xs text-warn">{t(S.partCost)}</span>}</>}</td><td className="num">{money(o.gross)}</td></>}</tr>))}</tbody>
        </table>
      </TableRegion>
      {d.orders_counted > d.orders.length && <p className="text-sm text-muted">{t(S.biggest)}</p>}
    </div>
  )
}

function MoneyIn({ d }: { d: Report }) {
  const rows = d.series.filter(b => n(b.money_in) !== 0)
  if (!rows.length) return <p className="mt-3 text-sm text-muted">{t(S.none)}</p>
  return (
    <TableRegion label={t(S.moneyIn)}>
      <table className="w-full"><thead><tr><th>{t(S.date)}</th><th className="num">{t(S.moneyIn)}</th></tr></thead>
        <tbody>{rows.map(b => <tr key={b.from}><td>{b.from === b.to ? short(b.from) : `${short(b.from)} to ${short(b.to)}`}</td><td className="num">{money(b.money_in)}</td></tr>)}</tbody></table>
    </TableRegion>
  )
}

const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/
function Costs({ d, adding, setAdding, onChanged, onVoided }: { d: Report; adding: boolean; setAdding: (v: boolean) => void; onChanged: () => void; onVoided: () => void }) {
  const act = useAction()
  const [f, setF] = useState({ spent_on: d.today, category: 'rent', amount: '', note: '' })
  const [voidId, setVoidId] = useState<string | null>(null)
  const [why, setWhy] = useState('')
  const okAmount = AMOUNT.test(f.amount.trim()) && Number(f.amount) > 0
  const save = () => act.run(async () => {
    await api('POST', '/expenses', { spent_on: f.spent_on, category: f.category, amount: f.amount.trim(), note: f.note.trim() || undefined })
    setF({ ...f, amount: '', note: '' }); setAdding(false); onChanged()
  })
  const doVoid = (id: string) => act.run(async () => { await api('POST', `/expenses/${id}/void`, { reason: why.trim() }); setVoidId(null); setWhy(''); onVoided() })
  return (
    <div className="mt-3 grid gap-3">
      {d.expenses_by_category.length > 0 && <ul className="flex flex-wrap gap-2">{d.expenses_by_category.map(c => <li key={c.category} className="badge">{t(CAT[c.category] ?? CAT.other)} <b className="tabular-nums">{money(c.amount)}</b></li>)}</ul>}
      {d.expense_rows.length === 0 ? <p className="text-sm text-muted">{t(S.none)}</p> : (
        <ul className="divide-y divide-hairline">
          {d.expense_rows.map(e => (
            <li key={e.id} className="grid gap-2 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 text-sm"><b>{t(CAT[e.category] ?? CAT.other)}</b> · {short(e.on)}{e.note && <span className="text-muted"> · {e.note}</span>}</span>
                <span className="flex items-center gap-2"><b className="tabular-nums">{money(e.amount)}</b>{d.can_void && voidId !== e.id && <button type="button" className="btn btn-sm" onClick={() => { setVoidId(e.id); setWhy('') }}>{t(S.voidIt)}</button>}</span>
              </div>
              {voidId === e.id && (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="grid flex-1 gap-1 text-sm font-semibold">{t(S.voidWhy)}<input className="input" value={why} maxLength={300} onChange={ev => setWhy(ev.target.value)} /></label>
                  <button type="button" className="btn btn-sm btn-danger" disabled={why.trim().length < 3 || act.busy} onClick={() => doVoid(e.id)}>{t(S.voidConfirm)}</button>
                  <button type="button" className="btn btn-sm" onClick={() => setVoidId(null)}>{t(S.cancel)}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {d.can_record && !adding && <div><button type="button" className="btn gap-2" onClick={() => setAdding(true)}><Icon name="plus" className="size-4" />{t(S.addCost)}</button></div>}
      {d.can_record && adding && (
        <form className="rev-form" onSubmit={e => { e.preventDefault(); if (okAmount && !act.busy) save() }}>
          <h3 className="text-sm font-semibold">{t(S.addCost)}</h3>
          <label className="grid gap-1 text-sm font-semibold">{t(S.date)}<input type="date" className="input" value={f.spent_on} max={d.today} required onChange={e => setF({ ...f, spent_on: e.target.value })} /></label>
          <label className="grid gap-1 text-sm font-semibold">{t(S.category)}<select className="input" value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{d.categories.map(c => <option key={c} value={c}>{t(CAT[c] ?? CAT.other)}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-semibold">{t(S.amount)}<input className="input" inputMode="decimal" value={f.amount} placeholder="0.00" aria-invalid={f.amount !== '' && !okAmount} onChange={e => setF({ ...f, amount: e.target.value })} /></label>
          <label className="grid gap-1 text-sm font-semibold sm:col-span-2">{t(S.note)}<input className="input" value={f.note} maxLength={200} onChange={e => setF({ ...f, note: e.target.value })} /></label>
          {f.amount !== '' && !okAmount && <p role="alert" className="text-sm text-warn sm:col-span-2">{t(S.badAmount)}</p>}
          <div className="flex gap-2 sm:col-span-2"><button type="submit" className="btn btn-primary" disabled={!okAmount || act.busy}>{t(S.save)}</button><button type="button" className="btn" onClick={() => setAdding(false)}>{t(S.cancel)}</button></div>
        </form>
      )}
      <ActionError err={act.err} onRetry={() => (voidId ? doVoid(voidId) : save())} label={t({ en: 'Try again', ms: 'Cuba lagi', zh: '重试', ta: 'மீண்டும் முயற்சி' })} />
    </div>
  )
}


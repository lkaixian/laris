import { useEffect, useMemo, useState } from 'react'
import { api, can, needs } from './api'
import { Async, EmptyState, PageHeader, msg, useFetch } from './ui'
import { FilterBar, FilterSelect, StatStrip, StatTile, Tabs, ToggleChip } from './kit'
import { Icon } from './icons'
import { useToast } from './Toast'
import { getLang, t, useLang } from './i18n'
import type { Text } from './i18n'
import { ContractWizard } from './Contracts'
import { Dialog, ModeSwitch, Ring, S, Spark, StatusChip, fmtDate, inMode, num, reason, rm, useDetail } from './suppliersKit'
import type { Card, Compare, Mode, Product, Row, Summary } from './suppliersKit'
export { ContractDetail, ContractsView } from './Contracts'

// Supplier directory, supplier profile, product list and the product price comparison (docs/suppliers.md).

const T = {
  title: { en: 'Supplier directory', ms: 'Direktori pembekal', zh: '供应商目录', ta: 'சப்ளையர் பட்டியல்' },
  search: { en: 'Search suppliers', ms: 'Cari pembekal', zh: '搜索供应商', ta: 'சப்ளையர்களைத் தேடு' },
  state: { en: 'State', ms: 'Negeri', zh: '州属', ta: 'மாநிலம்' },
  anyState: { en: 'Any', ms: 'Mana-mana', zh: '不限', ta: 'ஏதாவது' },
  halal: { en: 'Halal', ms: 'Halal', zh: '清真', ta: 'ஹலால்' },
  sst: { en: 'SST registered', ms: 'Berdaftar SST', zh: 'SST 注册', ta: 'SST பதிவு' },
  einv: { en: 'e-invoice ready', ms: 'Sedia e-invois', zh: '支持电子发票', ta: 'e-இன்வாய்ஸ் தயார்' },
  blockedOnly: { en: 'Blocked', ms: 'Disekat', zh: '已屏蔽', ta: 'தடுக்கப்பட்டது' },
  minRel: { en: 'Reliability 90+', ms: 'Kebolehpercayaan 90+', zh: '可靠度 90+', ta: 'நம்பகத்தன்மை 90+' },
  fastLead: { en: 'Lead time 3 days or less', ms: 'Masa penghantaran 3 hari atau kurang', zh: '交货期 3 天内', ta: 'விநியோகம் 3 நாட்களுக்குள்' },
  clear: { en: 'Clear filters', ms: 'Kosongkan penapis', zh: '清除筛选', ta: 'வடிகட்டிகளை நீக்கு' },
  total: { en: 'Suppliers', ms: 'Pembekal', zh: '供应商', ta: 'சப்ளையர்கள்' },
  active: { en: 'Active contracts', ms: 'Kontrak aktif', zh: '生效合同', ta: 'செயலில் உள்ள ஒப்பந்தங்கள்' },
  exp90: { en: 'Expiring in 90 days', ms: 'Tamat dalam 90 hari', zh: '90 天内到期', ta: '90 நாட்களில் காலாவதி' },
  saved: { en: 'Savings found this month', ms: 'Penjimatan bulan ini', zh: '本月发现的节省', ta: 'இந்த மாதம் சேமிப்பு' },
  offPct: { en: 'Off-contract spend', ms: 'Perbelanjaan luar kontrak', zh: '合同外支出', ta: 'ஒப்பந்தத்திற்கு வெளியே செலவு' },
  needsYou: { en: 'Needs you', ms: 'Perlukan anda', zh: '需要您处理', ta: 'உங்கள் கவனம் தேவை' },
  waiting: { en: 'Contracts waiting for approval', ms: 'Kontrak menunggu kelulusan', zh: '待批准的合同', ta: 'ஒப்புதலுக்குக் காத்திருக்கும் ஒப்பந்தங்கள்' },
  pendingOrders: { en: 'Off-contract orders waiting for approval', ms: 'Pesanan luar kontrak menunggu kelulusan', zh: '待批准的合同外订单', ta: 'ஒப்புதலுக்குக் காத்திருக்கும் ஒப்பந்தத்திற்கு வெளி ஆர்டர்கள்' },
  expiresIn: { en: 'ends in', ms: 'tamat dalam', zh: '距到期', ta: 'முடிய' },
  loadDemo: { en: 'Load demo suppliers', ms: 'Muat pembekal demo', zh: '加载演示供应商', ta: 'டெமோ சப்ளையர்களை ஏற்று' },
  none: { en: 'No suppliers match.', ms: 'Tiada pembekal sepadan.', zh: '没有符合的供应商。', ta: 'பொருந்தும் சப்ளையர் இல்லை.' },
  noneHint: { en: 'Clear a filter, or add suppliers under Contacts. The demo button adds invented ones.', ms: 'Kosongkan penapis, atau tambah pembekal di Kenalan. Butang demo menambah yang rekaan.', zh: '清除筛选，或在“联系人”中添加供应商。演示按钮会添加虚构的供应商。', ta: 'வடிகட்டியை நீக்கு, அல்லது தொடர்புகளில் சப்ளையர்களைச் சேர். டெமோ பொத்தான் போலி சப்ளையர்களைச் சேர்க்கும்.' },
  reliability: { en: 'Reliability', ms: 'Kebolehpercayaan', zh: '可靠度', ta: 'நம்பகத்தன்மை' },
  terms: { en: 'Payment', ms: 'Pembayaran', zh: '付款', ta: 'கட்டணம்' },
  lastOrder: { en: 'Last order', ms: 'Pesanan terakhir', zh: '最近订单', ta: 'கடைசி ஆர்டர்' },
  priceTrend: { en: 'Price trend', ms: 'Trend harga', zh: '价格走势', ta: 'விலைப் போக்கு' },
  preferred: { en: 'Preferred', ms: 'Pilihan', zh: '首选', ta: 'விருப்பமான' },
  blocked: { en: 'Blocked', ms: 'Disekat', zh: '已屏蔽', ta: 'தடுக்கப்பட்டது' },
  nudges: { en: 'A contract could save money', ms: 'Kontrak boleh menjimatkan wang', zh: '签合同可能省钱', ta: 'ஒப்பந்தம் பணத்தைச் சேமிக்கலாம்' },
  products: { en: 'Compare prices', ms: 'Banding harga', zh: '比价', ta: 'விலை ஒப்பீடு' },
  pickProduct: { en: 'Pick a product to see every supplier’s price and the cheapest option.', ms: 'Pilih produk untuk melihat harga setiap pembekal dan pilihan termurah.', zh: '选择产品，查看各供应商价格和最便宜的选择。', ta: 'ஒரு பொருளைத் தேர்ந்தெடுத்து ஒவ்வொரு சப்ளையரின் விலையையும் மலிவான தேர்வையும் காண்க.' },
  qty: { en: 'Quantity', ms: 'Kuantiti', zh: '数量', ta: 'அளவு' },
  neededBy: { en: 'Needed by', ms: 'Diperlukan pada', zh: '需要日期', ta: 'தேவையான தேதி' },
  sortLowest: { en: 'Lowest cost', ms: 'Kos terendah', zh: '成本最低', ta: 'குறைந்த செலவு' },
  sortFast: { en: 'Fastest', ms: 'Terpantas', zh: '最快', ta: 'வேகமானது' },
  sortRel: { en: 'Most reliable', ms: 'Paling dipercayai', zh: '最可靠', ta: 'மிக நம்பகமானது' },
  sortValue: { en: 'Best value', ms: 'Nilai terbaik', zh: '最划算', ta: 'சிறந்த மதிப்பு' },
  simple: { en: 'Simple', ms: 'Ringkas', zh: '简单', ta: 'எளிமை' },
  detailed: { en: 'Detailed', ms: 'Terperinci', zh: '详细', ta: 'விரிவு' },
  why: { en: 'Why this one', ms: 'Mengapa ini', zh: '为何推荐', ta: 'ஏன் இது' },
  breakdown: { en: 'Cost breakdown', ms: 'Pecahan kos', zh: '成本明细', ta: 'செலவு விவரம்' },
  goods: { en: 'Goods', ms: 'Barangan', zh: '货款', ta: 'பொருட்கள்' },
  discount: { en: 'Discount', ms: 'Diskaun', zh: '折扣', ta: 'தள்ளுபடி' },
  delivery: { en: 'Delivery', ms: 'Penghantaran', zh: '运费', ta: 'விநியோகம்' },
  tax: { en: 'SST', ms: 'SST', zh: 'SST', ta: 'SST' },
  perUnit: { en: 'per', ms: 'seunit', zh: '每', ta: 'ஒரு' },
  vsLowest: { en: 'vs lowest', ms: 'berbanding terendah', zh: '比最低价', ta: 'குறைந்ததை விட' },
  weights: { en: 'Best-value weights', ms: 'Wajaran nilai terbaik', zh: '最划算权重', ta: 'சிறந்த மதிப்பு எடைகள்' },
  wPrice: { en: 'Price', ms: 'Harga', zh: '价格', ta: 'விலை' }, wRel: { en: 'Reliability', ms: 'Kebolehpercayaan', zh: '可靠度', ta: 'நம்பகத்தன்மை' },
  wLead: { en: 'Lead time', ms: 'Masa penghantaran', zh: '交货期', ta: 'விநியோக காலம்' }, wTerms: { en: 'Payment terms', ms: 'Terma bayaran', zh: '付款条件', ta: 'கட்டண விதிகள்' },
  ruledOut: { en: 'Ruled out', ms: 'Dikecualikan', zh: '已排除', ta: 'நீக்கப்பட்டவை' },
  savings: { en: 'Savings', ms: 'Penjimatan', zh: '节省', ta: 'சேமிப்பு' },
  vsLast: { en: 'vs last paid', ms: 'berbanding bayaran terakhir', zh: '比上次付款', ta: 'கடைசி கட்டணத்தை விட' },
  vsAvg: { en: 'vs market average', ms: 'berbanding purata pasaran', zh: '比市场均价', ta: 'சந்தை சராசரியை விட' },
  vsHigh: { en: 'vs highest quote', ms: 'berbanding sebut harga tertinggi', zh: '比最高报价', ta: 'அதிகபட்சத்தை விட' },
  split: { en: 'Split order idea', ms: 'Cadangan pesanan berpecah', zh: '拆单建议', ta: 'ஆர்டரைப் பிரிக்கும் யோசனை' },
  history: { en: 'Price per unit, last 12 months', ms: 'Harga seunit, 12 bulan lepas', zh: '单价，近 12 个月', ta: 'அலகு விலை, கடந்த 12 மாதங்கள்' },
  lastPaid: { en: 'Last paid', ms: 'Bayaran terakhir', zh: '上次付款', ta: 'கடைசி கட்டணம்' },
  mktAvg: { en: 'Market average', ms: 'Purata pasaran', zh: '市场均价', ta: 'சந்தை சராசரி' },
  orderOnce: { en: 'Order once', ms: 'Pesan sekali', zh: '单次下单', ta: 'ஒருமுறை ஆர்டர்' },
  startContract: { en: 'Start a contract', ms: 'Mulakan kontrak', zh: '开始合同', ta: 'ஒப்பந்தம் தொடங்கு' },
  shortlist: { en: 'Save to shortlist', ms: 'Simpan ke senarai pendek', zh: '加入候选', ta: 'குறுக்குப்பட்டியலில் சேர்' },
  saveRec: { en: 'Save this advice', ms: 'Simpan nasihat ini', zh: '保存此建议', ta: 'இந்த ஆலோசனையைச் சேமி' },
  toCostBook: { en: 'Use price in cost book', ms: 'Guna harga dalam buku kos', zh: '用于成本册', ta: 'செலவுப் புத்தகத்தில் பயன்படுத்து' },
  askQuotes: { en: 'Request quotes', ms: 'Minta sebut harga', zh: '索取报价', ta: 'விலைப்புள்ளிகள் கேள்' },
  askHint: { en: 'Opens Request quotes with these suppliers in mind. Nothing is sent until you press send there.', ms: 'Buka Minta sebut harga. Tiada apa dihantar sehingga anda tekan hantar di sana.', zh: '打开“索取报价”。在那里点击发送前不会发出任何内容。', ta: 'மேற்கோள் கோருங்கள் திறக்கும். அங்கே அனுப்பு அழுத்தும் வரை எதுவும் அனுப்பப்படாது.' },
  guard: { en: 'This product is under contract with another supplier.', ms: 'Produk ini di bawah kontrak dengan pembekal lain.', zh: '该产品已与其他供应商签订合同。', ta: 'இந்தப் பொருள் வேறு சப்ளையருடன் ஒப்பந்தத்தில் உள்ளது.' },
  guardAsk: { en: 'Give a reason. A manager or the owner must approve this order.', ms: 'Berikan sebab. Pengurus atau pemilik mesti meluluskan pesanan ini.', zh: '请填写原因。需由经理或店主批准此订单。', ta: 'காரணம் தருக. மேலாளர் அல்லது உரிமையாளர் இந்த ஆர்டரை அங்கீகரிக்க வேண்டும்.' },
  reasonLbl: { en: 'Reason', ms: 'Sebab', zh: '原因', ta: 'காரணம்' },
  amount: { en: 'Amount (RM)', ms: 'Jumlah (RM)', zh: '金额 (RM)', ta: 'தொகை (RM)' },
  placeOrder: { en: 'Record order', ms: 'Rekod pesanan', zh: '记录订单', ta: 'ஆர்டரைப் பதிவு செய்' },
  recorded: { en: 'Order recorded.', ms: 'Pesanan direkodkan.', zh: '订单已记录。', ta: 'ஆர்டர் பதிவு செய்யப்பட்டது.' },
  pendingAppr: { en: 'Order waits for approval.', ms: 'Pesanan menunggu kelulusan.', zh: '订单等待批准。', ta: 'ஆர்டர் ஒப்புதலுக்காகக் காத்திருக்கிறது.' },
  marketCheaper: { en: 'The open market is cheaper than this contract. Review it at the next price review, in', ms: 'Pasaran terbuka lebih murah daripada kontrak ini. Semak pada semakan harga seterusnya, dalam', zh: '公开市场价低于本合同。请在下次价格复核时处理，还有', ta: 'திறந்த சந்தை இந்த ஒப்பந்தத்தை விட மலிவு. அடுத்த விலை மறுஆய்வில் பாருங்கள், இன்னும்' },
  checkMissing: { en: 'Missing data', ms: 'Data tiada', zh: '缺少数据', ta: 'தரவு இல்லை' },
  tabs: {
    overview: { en: 'Overview', ms: 'Gambaran', zh: '概览', ta: 'மேலோட்டம்' }, prices: { en: 'Products & prices', ms: 'Produk & harga', zh: '产品与价格', ta: 'பொருட்கள் & விலைகள்' },
    contracts: { en: 'Contracts', ms: 'Kontrak', zh: '合同', ta: 'ஒப்பந்தங்கள்' }, orders: { en: 'Orders & deliveries', ms: 'Pesanan & penghantaran', zh: '订单与交货', ta: 'ஆர்டர்கள் & விநியோகம்' },
    docs: { en: 'Documents', ms: 'Dokumen', zh: '文件', ta: 'ஆவணங்கள்' }, activity: { en: 'Activity', ms: 'Aktiviti', zh: '活动', ta: 'செயல்பாடு' },
  },
  roadmap: { en: 'Roadmap: not built yet. Use Contacts and the Audit log for now.', ms: 'Pelan hala tuju: belum dibina. Guna Kenalan dan Log audit buat masa ini.', zh: '路线图：尚未开发。目前请使用“联系人”和“审计日志”。', ta: 'திட்டத்தில் உள்ளது: இன்னும் உருவாக்கப்படவில்லை. இப்போது தொடர்புகள், தணிக்கைப் பதிவைப் பயன்படுத்தவும்.' },
  radar: { en: 'Supplier profile', ms: 'Profil pembekal', zh: '供应商画像', ta: 'சப்ளையர் விவரம்' },
  axes: { price: { en: 'Price', ms: 'Harga', zh: '价格', ta: 'விலை' }, speed: { en: 'Speed', ms: 'Kelajuan', zh: '速度', ta: 'வேகம்' }, reliability: { en: 'Reliability', ms: 'Kebolehpercayaan', zh: '可靠度', ta: 'நம்பகத்தன்மை' }, quality: { en: 'Quality', ms: 'Kualiti', zh: '质量', ta: 'தரம்' }, flexibility: { en: 'Flexibility', ms: 'Fleksibiliti', zh: '灵活性', ta: 'நெகிழ்வு' } },
  pack: { en: 'Pack', ms: 'Pek', zh: '包装', ta: 'பொதி' },
  from: { en: 'From', ms: 'Daripada', zh: '来自', ta: 'இருந்து' },
}
const WLBL: [string, Text][] = [['price', T.wPrice], ['reliability', T.wRel], ['lead', T.wLead], ['terms', T.wTerms]]

// ---------- filters kept in the address, so a link shares the view ----------
function useUrlFilters(defaults: Record<string, string>) {
  const read = () => { const q = new URLSearchParams(location.hash.split('?')[1] ?? ''); return Object.fromEntries(Object.keys(defaults).map(k => [k, q.get(k) ?? defaults[k]])) as Record<string, string> }
  const [f, set] = useState(read)
  const put = (patch: Record<string, string>) => {
    const next = { ...f, ...patch }
    set(next)
    const q = new URLSearchParams(Object.entries(next).filter(([k, v]) => v && v !== defaults[k]))
    const base = location.hash.split('?')[0] || '#/suppliers'
    history.replaceState(null, '', base + (q.toString() ? '?' + q : ''))
  }
  return [f, put, () => put(defaults)] as const
}

// ---------- supplier directory ----------
export function SuppliersView({ owner }: { owner: boolean }) {
  useLang()
  const toast = useToast()
  const [f, put, reset] = useUrlFilters({ q: '', state: '', cert: '', standing: '', rel: '', lead: '', mode: 'all' })
  const qs = new URLSearchParams()
  if (f.q) qs.set('q', f.q)
  if (f.state) qs.set('state', f.state)
  f.cert.split(',').filter(Boolean).forEach(c => qs.append('cert', c))
  if (f.standing) qs.set('standing', f.standing)
  if (f.rel) qs.set('min_reliability', f.rel)
  if (f.lead) qs.set('max_lead', f.lead)
  const s = useFetch<Card[]>('/suppliers' + (qs.toString() ? '?' + qs : ''))
  const sum = useFetch<Summary>('/suppliers/summary')
  const all = useFetch<Card[]>('/suppliers')
  const prods = useFetch<Product[]>('/products')
  const states = useMemo(() => [...new Set((all.data ?? []).map(c => c.state).filter(Boolean) as string[])].sort(), [all.data])
  const mode = f.mode as Mode
  const rows = (s.data ?? []).filter(c => mode === 'all' || (mode === 'in' ? inMode(c.contract_status) : !inMode(c.contract_status)))
  const certs = f.cert.split(',').filter(Boolean)
  const toggleCert = (c: string) => put({ cert: (certs.includes(c) ? certs.filter(x => x !== c) : [...certs, c]).join(',') })
  const chips = [f.state && { label: `${t(T.state)}: ${f.state}`, onRemove: () => put({ state: '' }) }, ...certs.map(c => ({ label: c, onRemove: () => toggleCert(c) })),
    f.standing && { label: f.standing, onRemove: () => put({ standing: '' }) }, f.rel && { label: t(T.minRel), onRemove: () => put({ rel: '' }) },
    f.lead && { label: t(T.fastLead), onRemove: () => put({ lead: '' }) }].filter(Boolean) as { label: string; onRemove: () => void }[]
  const demo = async () => { try { await api('POST', '/suppliers-demo'); toast(t({ en: 'Demo suppliers loaded.', ms: 'Pembekal demo dimuat.', zh: '演示供应商已加载。', ta: 'டெமோ சப்ளையர்கள் ஏற்றப்பட்டன.' })); s.reload(); sum.reload(); all.reload(); prods.reload() } catch (e) { toast.error(msg(e)) } }
  const d = sum.data
  return (
    <>
      <PageHeader title={t(T.title)} description={t(S.boundary)} actions={<>
        <ModeSwitch value={mode} onChange={m => put({ mode: m })} />
        <a className="btn" href="#/ask">{t(T.askQuotes)}</a>
        <a className="btn btn-primary" href="#/contacts">＋ {t({ en: 'Add supplier', ms: 'Tambah pembekal', zh: '添加供应商', ta: 'சப்ளையரைச் சேர்' })}</a>
      </>} />
      {d && <StatStrip label={t(T.title)}>
        <StatTile title={t(T.total)} value={d.suppliers} />
        <StatTile title={t(T.active)} value={d.active_contracts} href="#/contracts" />
        <StatTile title={t(T.exp90)} value={d.expiring_90} warn={d.expiring_90 > 0} href="#/contracts" />
        <StatTile title={t(T.saved)} value={rm(d.savings_this_month)} />
        <StatTile title={t(T.offPct)} value={`${num(d.off_contract_pct, 1)}%`} hint={`${t({ en: 'In contract', ms: 'Dalam kontrak', zh: '合同内', ta: 'ஒப்பந்தத்தில்' })} ${rm(d.in_contract_spend)}`} />
      </StatStrip>}
      {d && (d.needs_you.expiring.length > 0 || d.needs_you.contracts_waiting_approval > 0 || d.needs_you.off_contract_orders_pending > 0) && (
        <section aria-label={t(T.needsYou)} className="card mt-3 border-l-4 border-l-amber">
          <h2 className="font-semibold">{t(T.needsYou)}</h2>
          <ul className="mt-1 grid gap-1 text-sm">
            {d.needs_you.expiring.map(x => <li key={x.id}><Icon name="warn" className="mr-1 inline size-4" /><a href={`#/contract/${x.id}`}>{x.name}</a> {t(T.expiresIn)} {x.days_left} {t(S.days)}</li>)}
            {d.needs_you.contracts_waiting_approval > 0 && <li><a href="#/contracts">{d.needs_you.contracts_waiting_approval} {t(T.waiting)}</a></li>}
            {d.needs_you.off_contract_orders_pending > 0 && <li><a href="#/contracts">{d.needs_you.off_contract_orders_pending} {t(T.pendingOrders)}</a></li>}
          </ul>
        </section>
      )}
      <div className="mt-4">
        <FilterBar label={t(T.search)} search={{ value: f.q, onChange: v => put({ q: v }), label: t(T.search) }} chips={chips} onClear={reset}
          right={owner && prods.data?.length === 0 ? <button type="button" className="btn" onClick={demo}>{t(T.loadDemo)}</button> : undefined}>
          <FilterSelect label={t(T.state)} value={f.state} onChange={v => put({ state: v })}><option value="">{t(T.anyState)}</option>{states.map(x => <option key={x}>{x}</option>)}</FilterSelect>
          <ToggleChip pressed={certs.includes('halal')} onClick={() => toggleCert('halal')}>{t(T.halal)}</ToggleChip>
          <ToggleChip pressed={certs.includes('sst')} onClick={() => toggleCert('sst')}>{t(T.sst)}</ToggleChip>
          <ToggleChip pressed={certs.includes('einvoice')} onClick={() => toggleCert('einvoice')}>{t(T.einv)}</ToggleChip>
          <ToggleChip pressed={f.rel === '90'} onClick={() => put({ rel: f.rel === '90' ? '' : '90' })}>{t(T.minRel)}</ToggleChip>
          <ToggleChip pressed={f.lead === '3'} onClick={() => put({ lead: f.lead === '3' ? '' : '3' })}>{t(T.fastLead)}</ToggleChip>
          <ToggleChip pressed={f.standing === 'blocked'} onClick={() => put({ standing: f.standing === 'blocked' ? '' : 'blocked' })} warn>{t(T.blockedOnly)}</ToggleChip>
        </FilterBar>
      </div>
      <Async s={s} empty={rows.length === 0} emptyText={t(T.none)} emptyHint={t(T.noneHint)} shape="cards">
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(c => <li key={c.id}><SupplierCard c={c} /></li>)}
        </ul>
      </Async>
      <Nudges />
    </>
  )
}

function SupplierCard({ c }: { c: Card }) {
  const name = c.name.replace(/^SAMPLE /, '').replace(/ \(synthetic\)$/, '')
  return (
    <article className="card h-full">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-tint font-semibold">{name.slice(0, 2).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-semibold"><a href={`#/supplier/${c.id}`}>{name}</a></h3>
          <p className="text-sm text-muted">{c.state ?? '-'}{c.categories.length > 0 && ` · ${c.categories.join(', ')}`}</p>
        </div>
        <Ring value={c.reliability} label={t(T.reliability)} />
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusChip v={c.contract_status} />
        {c.standing === 'preferred' && <span className="badge">★ {t(T.preferred)}</span>}
        {c.standing === 'blocked' && <span className="chip chip-rejected"><Icon name="close" className="size-3" />{t(T.blocked)}</span>}
        {c.certs.map(x => <span key={x} className="badge">{x}</span>)}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 text-sm">
        <div><dt className="text-muted">{t(S.lead)}</dt><dd className="tabular-nums">{c.avg_lead_days ? `${num(c.avg_lead_days, 1)} ${t(S.days)}` : '-'}</dd></div>
        <div><dt className="text-muted">{t(T.terms)}</dt><dd className="tabular-nums">{c.payment_days ? `${c.payment_days} ${t(S.days)}` : 'COD'}</dd></div>
        <div><dt className="text-muted">{t(T.lastOrder)}</dt><dd>{fmtDate(c.last_order_on) || '-'}</dd></div>
        <div><dt className="text-muted">{t(T.priceTrend)}</dt><dd><Spark values={c.sparkline} label={t(T.priceTrend)} /></dd></div>
      </dl>
      <p className="mt-3 flex flex-wrap gap-2">
        <a className="btn btn-sm" href={`#/supplier/${c.id}`}>{t(S.view)}</a>
        <a className="btn btn-sm" href="#/products">{t(S.compare)}</a>
        {c.standing === 'blocked' ? <button className="btn btn-sm" aria-disabled="true" title={t(T.blocked)}>{t(S.requestQuote)}</button> : <a className="btn btn-sm" href="#/ask">{t(S.requestQuote)}</a>}
      </p>
    </article>
  )
}

function Nudges() {
  useLang()
  const s = useFetch<{ product_id: string; product_name: string; count: number; spend: string; est_saving: string; window_days: number }[]>('/purchases/nudges')
  if (!s.data?.length) return null
  return (
    <section aria-label={t(T.nudges)} className="card mt-4">
      <h2 className="font-semibold">{t(T.nudges)}</h2>
      <ul className="mt-1 grid gap-1 text-sm">{s.data.map(n => (
        <li key={n.product_id}>{t({ en: `You bought ${n.product_name} ${n.count} times in ${n.window_days} days (${rm(n.spend)}). A contract could save about ${rm(n.est_saving)} based on volume tiers.`,
          ms: `Anda beli ${n.product_name} ${n.count} kali dalam ${n.window_days} hari (${rm(n.spend)}). Kontrak boleh menjimatkan kira-kira ${rm(n.est_saving)} berdasarkan peringkat volum.`,
          zh: `${n.window_days} 天内您购买了 ${n.count} 次${n.product_name}（${rm(n.spend)}）。按数量阶梯，签合同约可节省 ${rm(n.est_saving)}。`,
          ta: `${n.window_days} நாட்களில் ${n.product_name} ஐ ${n.count} முறை வாங்கினீர்கள் (${rm(n.spend)}). அளவு அடுக்குகளின்படி ஒப்பந்தம் சுமார் ${rm(n.est_saving)} சேமிக்கலாம்.` })} <a href={`#/product/${n.product_id}`}>{t(S.compare)}</a></li>
      ))}</ul>
    </section>
  )
}

// ---------- supplier profile ----------
interface Detail extends Card { email: string | null; address: string | null; offers: { id: string; product_id: string; product_name: string | null; pack_label: string; tiers: [number, string][]; lead_days: number; moq: string | null; valid_until: string | null }[]
  contracts: { id: string; name: string; state: string; start: string; end: string; days_left: number }[]
  purchases: { bought_on: string; qty: string; amount: string; status: string; product_name: string }[]; radar: Record<string, number>; response_hours: string | null; price_stability_pct: string | null }

function Radar({ data }: { data: Record<string, number> }) {
  const keys = ['price', 'speed', 'reliability', 'quality', 'flexibility'] as const, R = 70, c = 90
  const pt = (i: number, v: number) => { const a = (Math.PI * 2 * i) / keys.length - Math.PI / 2; return [c + Math.cos(a) * R * v / 100, c + Math.sin(a) * R * v / 100] }
  const poly = keys.map((k, i) => pt(i, data[k] ?? 0).join(',')).join(' ')
  return (
    <svg viewBox="0 0 180 180" className="w-full max-w-60" role="img" aria-label={keys.map(k => `${t(T.axes[k])} ${Math.round(data[k] ?? 0)}`).join(', ')}>
      {[25, 50, 75, 100].map(g => <polygon key={g} points={keys.map((_, i) => pt(i, g).join(',')).join(' ')} fill="none" stroke="var(--soft)" />)}
      <polygon points={poly} fill="var(--accent)" fillOpacity=".25" stroke="var(--accent)" strokeWidth="2" />
      {keys.map((k, i) => { const [x, y] = pt(i, 118); return <text key={k} x={x} y={y} textAnchor="middle" fontSize="9" fill="var(--ink)">{t(T.axes[k])}</text> })}
    </svg>
  )
}

export function SupplierDetail({ id }: { id: string }) {
  useLang()
  const s = useFetch<Detail>(`/suppliers/${id}`)
  const [tab, setTab] = useState('overview')
  const d = s.data
  const name = d?.name.replace(/^SAMPLE /, '').replace(/ \(synthetic\)$/, '')
  return (
    <>
      <PageHeader title={name} back={{ href: '#/suppliers', label: t(T.title) }} status={d && <StatusChip v={d.contract_status} />} />
      <Async s={s} shape="detail">
        {d && <>
          <Tabs label={name ?? ''} value={tab} onChange={setTab} options={(['overview', 'prices', 'contracts', 'orders', 'docs', 'activity'] as const).map(k => ({ value: k, label: t(T.tabs[k]) }))} />
          {tab === 'overview' && (
            <div className="grid gap-3 md:grid-cols-2">
              <section className="card"><h2 className="font-semibold">{t(T.radar)}</h2><Radar data={d.radar} /></section>
              <section className="card"><dl className="grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-muted">{t(T.state)}</dt><dd>{d.state ?? '-'}</dd></div>
                <div><dt className="text-muted">{t(T.reliability)}</dt><dd><Ring value={d.reliability} label={t(T.reliability)} /></dd></div>
                <div><dt className="text-muted">{t(T.terms)}</dt><dd>{d.payment_days ? `${d.payment_days} ${t(S.days)}` : 'COD'}</dd></div>
                <div><dt className="text-muted">{t({ en: 'On time', ms: 'Tepat masa', zh: '准时率', ta: 'சரியான நேரம்' })}</dt><dd className="tabular-nums">{d.on_time_pct ? `${num(d.on_time_pct, 0)}%` : '-'}</dd></div>
                <div className="col-span-2"><dt className="text-muted">{t({ en: 'Contact', ms: 'Hubungan', zh: '联系方式', ta: 'தொடர்பு' })}</dt><dd>{d.contact ?? '-'} <a className="ml-2" href={`#/contact/${d.id}`}>{t({ en: 'Edit in Contacts', ms: 'Edit di Kenalan', zh: '在联系人中编辑', ta: 'தொடர்புகளில் திருத்து' })}</a></dd></div>
                <div className="col-span-2 flex flex-wrap gap-1">{d.certs.map(x => <span key={x} className="badge">{x}</span>)}</div>
              </dl></section>
            </div>
          )}
          {tab === 'prices' && (d.offers.length === 0 ? <EmptyState title={t(T.none)} /> : (
            <ul className="grid gap-2">{d.offers.map(o => (
              <li key={o.id} className="card p-3 text-sm"><a className="font-semibold" href={`#/product/${o.product_id}`}>{o.product_name}</a>
                <p className="text-muted">{o.tiers.map(([m, p]) => `${m}+ ${o.pack_label}: ${rm(p)}`).join(' · ')} · {t(S.lead)} {o.lead_days} {t(S.days)}{o.moq ? ` · ${t(S.moq)} ${num(o.moq, 0)}` : ''}</p></li>
            ))}</ul>
          ))}
          {tab === 'contracts' && (d.contracts.length === 0 ? <EmptyState title={t(T.none)} /> : (
            <ul className="grid gap-2">{d.contracts.map(c => (
              <li key={c.id} className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm"><a className="font-semibold" href={`#/contract/${c.id}`}>{c.name}</a><StatusChip v={c.state} />
                <span className="text-muted">{fmtDate(c.start)} → {fmtDate(c.end)} · {c.days_left} {t(S.days)}</span></li>
            ))}</ul>
          ))}
          {tab === 'orders' && (d.purchases.length === 0 ? <EmptyState title={t(T.none)} /> : (
            <ul className="grid gap-2">{d.purchases.map((p, i) => <li key={i} className="card p-3 text-sm">{fmtDate(p.bought_on)} · {p.product_name} · {num(p.qty, 0)} · {rm(p.amount)} · {p.status}</li>)}</ul>
          ))}
          {(tab === 'docs' || tab === 'activity') && <p className="card text-sm">{t(T.roadmap)} <a href={tab === 'docs' ? `#/contact/${d.id}` : '#/activity'}>{t(T.tabs[tab as 'docs'])}</a></p>}
        </>}
      </Async>
    </>
  )
}

// ---------- product list ----------
export function ProductsView({ owner }: { owner: boolean }) {
  useLang()
  const [q, setQ] = useState('')
  const s = useFetch<Product[]>('/products' + (q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''))
  void owner
  return (
    <>
      <PageHeader title={t(T.products)} description={t(T.pickProduct)} />
      <FilterBar label={t(T.search)} search={{ value: q, onChange: setQ, label: t({ en: 'Search products (any language)', ms: 'Cari produk (mana-mana bahasa)', zh: '搜索产品（任意语言）', ta: 'பொருட்களைத் தேடு (எந்த மொழியும்)' }) }} />
      <Async s={s} empty={!s.data?.length} emptyText={t(T.none)} shape="cards">
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{s.data?.map(p => (
          <li key={p.id} className="card"><h3 className="font-semibold"><a href={`#/product/${p.id}`}>{p.name}</a></h3>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm"><StatusChip v={p.coverage === 'partial' ? 'partial' : p.coverage} /><span className="text-muted">{p.offers} {t({ en: 'offers', ms: 'tawaran', zh: '报价', ta: 'சலுகைகள்' })} · /{p.base_uom}</span></p>
            {p.aliases.length > 0 && <p className="mt-1 text-xs text-muted">{p.aliases.slice(0, 4).join(' · ')}</p>}</li>
        ))}</ul>
      </Async>
    </>
  )
}

// ---------- product comparison ----------
const ROW_H = 64
const NAME = (n: string) => n.replace(/^SAMPLE /, '').replace(/ \(synthetic\)$/, '')

export function ProductView({ id, owner }: { id: string; owner: boolean }) {
  useLang()
  const toast = useToast()
  const [detail, setDetail] = useDetail()
  const [qty, setQty] = useState('85')
  const [needed, setNeeded] = useState('')
  const [sort, setSort] = useState('lowest')
  const [mode, setMode] = useState<Mode>('all')
  const [minRel, setMinRel] = useState('')
  const [certs, setCerts] = useState<string[]>([])
  const [pay, setPay] = useState('')
  const [w, setW] = useState({ price: 50, reliability: 25, lead: 15, terms: 10 })
  const [order, setOrder] = useState<Row | null>(null)
  const [wizard, setWizard] = useState(false)
  const qs = new URLSearchParams({ qty: Number(qty) > 0 ? qty : '1', sort, w_price: String(w.price), w_reliability: String(w.reliability), w_lead: String(w.lead), w_terms: String(w.terms) })
  if (needed) qs.set('needed_by', needed)
  if (minRel) qs.set('min_reliability', minRel)
  if (pay) qs.set('payment_days', pay)
  if (mode !== 'all') qs.set('contract_only', mode === 'in' ? 'true' : 'false')
  certs.forEach(c => qs.append('cert', c))
  const [dq, setDq] = useState(qs.toString())
  useEffect(() => { const h = setTimeout(() => setDq(qs.toString()), 250); return () => clearTimeout(h) }, [qs.toString()])  // eslint-disable-line react-hooks/exhaustive-deps
  const s = useFetch<Compare>(`/products/${id}/compare?${dq}`)
  const c = s.data
  const lang = getLang()
  const rec = c?.recommended
  const maxTotal = Math.max(...(c?.qualified ?? []).map(r => Number(r.landed.total)), 1)
  const act = async (fn: () => Promise<void>) => { try { await fn() } catch (e) { toast.error(msg(e)) } }
  return (
    <>
      <PageHeader title={c?.product.name} back={{ href: '#/products', label: t(T.products) }} status={c && <StatusChip v={c.coverage.status} />}
        actions={<button type="button" className="btn btn-sm" aria-pressed={detail} onClick={() => setDetail(!detail)}>{detail ? t(T.detailed) : t(T.simple)}</button>} />
      <FilterBar label={t(T.products)}>
        <label className="input flex items-center gap-1 bg-surface"><span className="text-muted">{t(T.qty)} ({c?.product.base_uom ?? ''}):</span><input className="w-24 bg-transparent" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
        <label className="input flex items-center gap-1 bg-surface"><span className="text-muted">{t(T.neededBy)}:</span><input type="date" className="bg-transparent" value={needed} onChange={e => setNeeded(e.target.value)} /></label>
        <FilterSelect label={t({ en: 'Sort', ms: 'Isih', zh: '排序', ta: 'வரிசை' })} value={sort} onChange={setSort}>
          <option value="lowest">{t(T.sortLowest)}</option><option value="fastest">{t(T.sortFast)}</option><option value="reliable">{t(T.sortRel)}</option><option value="value">{t(T.sortValue)}</option></FilterSelect>
        <ModeSwitch value={mode} onChange={setMode} />
        {detail && <>
          <ToggleChip pressed={certs.includes('halal')} onClick={() => setCerts(certs.includes('halal') ? [] : ['halal'])}>{t(T.halal)}</ToggleChip>
          <ToggleChip pressed={minRel === '90'} onClick={() => setMinRel(minRel === '90' ? '' : '90')}>{t(T.minRel)}</ToggleChip>
          <ToggleChip pressed={pay === '30'} onClick={() => setPay(pay === '30' ? '' : '30')}>{t({ en: 'Terms 30+ days', ms: 'Terma 30+ hari', zh: '账期 30 天以上', ta: 'விதிகள் 30+ நாட்கள்' })}</ToggleChip>
        </>}
      </FilterBar>
      <Async s={s} shape="detail">
        {c && <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <div className="grid content-start gap-4">
            {rec ? (
              <section className="card border-l-4 border-l-accent" aria-label={t(T.why)}>
                <p className="chip chip-approved"><Icon name="check" className="size-3" />{t(S.recommended)}</p>
                <h2 className="mt-2 text-lg font-semibold">{NAME(rec.supplier_name)} <span className="tabular-nums">{rm(rec.landed.total)}</span></h2>
                <p className="mt-1 text-sm">{c.why[lang]}</p>
                {rec.landed.missing.length > 0 && <p role="alert" className="mt-2 text-sm text-warn"><Icon name="warn" className="mr-1 inline size-4" />{t(T.checkMissing)}: {rec.landed.missing.join(', ')}</p>}
                {detail && <dl className="mt-3 grid grid-cols-2 gap-x-4 text-sm sm:grid-cols-4">
                  <div><dt className="text-muted">{t(T.goods)}</dt><dd className="tabular-nums">{rm(rec.landed.goods)}</dd></div>
                  <div><dt className="text-muted">{t(T.discount)}</dt><dd className="tabular-nums">{rm(rec.landed.discount)}</dd></div>
                  <div><dt className="text-muted">{t(T.delivery)}</dt><dd className="tabular-nums">{rm(rec.landed.delivery)}</dd></div>
                  <div><dt className="text-muted">{t(T.tax)}</dt><dd className="tabular-nums">{rm(rec.landed.sst)}</dd></div>
                </dl>}
                {c.savings && <p className="mt-3 flex flex-wrap gap-x-4 text-sm" aria-label={t(T.savings)}>
                  {c.savings.vs_last_paid && <span>{t(T.savings)} {t(T.vsLast)}: <b className="tabular-nums">{rm(c.savings.vs_last_paid)}</b></span>}
                  <span>{t(T.vsAvg)}: <b className="tabular-nums">{rm(c.savings.vs_market_avg)}</b></span>
                  {detail && <span>{t(T.vsHigh)}: <b className="tabular-nums">{rm(c.savings.vs_highest)}</b></span>}</p>}
                {c.split && <p className="mt-2 text-sm">{t(T.split)}: {c.split.suppliers.map(NAME).join(' + ')} ({c.split.qty.join(' / ')}) {rm(c.split.total)} (−{rm(c.split.saving)})</p>}
                <p className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary btn-sm" {...needs('manage_contracts', () => setOrder(rec))} aria-disabled={!(can('manage_contracts') || owner) || undefined}>{t(T.orderOnce)}</button>
                  <button type="button" className="btn btn-sm" {...needs('manage_contracts', () => setWizard(true))} aria-disabled={!(can('manage_contracts') || owner) || undefined}>{t(T.startContract)}</button>
                  <a className="btn btn-sm" href="#/ask" title={t(T.askHint)}>{t(T.askQuotes)}</a>
                  <button type="button" className="btn btn-sm" onClick={() => act(async () => { await api('PUT', `/products/${id}/shortlist/${rec.offer_id}`); toast(t({ en: 'Saved to shortlist.', ms: 'Disimpan ke senarai pendek.', zh: '已加入候选。', ta: 'குறுக்குப்பட்டியலில் சேமிக்கப்பட்டது.' })) })}>{t(T.shortlist)}</button>
                  <button type="button" className="btn btn-sm" onClick={() => act(async () => { await api('POST', `/products/${id}/recommendation?qty=${encodeURIComponent(qty)}${needed ? `&needed_by=${needed}` : ''}`); toast(t({ en: 'Advice saved.', ms: 'Nasihat disimpan.', zh: '建议已保存。', ta: 'ஆலோசனை சேமிக்கப்பட்டது.' })) })}>{t(T.saveRec)}</button>
                  {owner && <button type="button" className="btn btn-sm" onClick={() => act(async () => { await api('POST', `/offers/${rec.offer_id}/to-cost-book`); toast(t({ en: 'Price added to the cost book.', ms: 'Harga ditambah ke buku kos.', zh: '价格已加入成本册。', ta: 'விலை செலவுப் புத்தகத்தில் சேர்க்கப்பட்டது.' })) })}>{t(T.toCostBook)}</button>}
                </p>
              </section>
            ) : <EmptyState title={t({ en: 'No supplier qualifies.', ms: 'Tiada pembekal yang layak.', zh: '没有符合条件的供应商。', ta: 'தகுதியான சப்ளையர் இல்லை.' })} hint={t({ en: 'See why each one was ruled out below.', ms: 'Lihat sebab setiap pembekal dikecualikan di bawah.', zh: '请在下方查看各供应商被排除的原因。', ta: 'ஒவ்வொன்றும் ஏன் நீக்கப்பட்டது என்று கீழே பார்க்கவும்.' })} />}

            {c.contract && (
              <section className="card text-sm" aria-label={t(S.contract)}>
                <p><StatusChip v={c.coverage.status} /> <a className="font-semibold" href={`#/contract/${c.contract.contract_id}`}>{c.contract.name}</a> · {NAME(c.contract.supplier_name)} · {rm(c.contract.price_per_base)}/{c.product.base_uom}</p>
                {c.contract.insight.market_cheaper && <p className="mt-1 text-warn"><Icon name="warn" className="mr-1 inline size-4" />{t(T.marketCheaper)} {c.contract.insight.review_in_days ?? '?'} {t(S.days)} ({c.contract.insight.gap_pct}%).</p>}
              </section>
            )}

            <section aria-label={t(S.landed)}>
              <h2 className="mb-2 font-semibold">{t(S.landed)}</h2>
              <ol className="relative" style={{ height: Math.max(c.qualified.length, 1) * ROW_H }}>
                {c.qualified.map((r, i) => (
                  <li key={r.offer_id} className="absolute inset-x-0 transition-transform duration-500 motion-reduce:transition-none" style={{ transform: `translateY(${i * ROW_H}px)`, height: ROW_H - 8 }}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate font-semibold"><a href={`#/supplier/${r.supplier_id}`}>{NAME(r.supplier_name)}</a>
                        {Object.entries(c.badges).filter(([, oid]) => oid === r.offer_id).map(([k]) => <span key={k} className="badge ml-1">{t(S.badges[k as 'fastest'])}</span>)}</span>
                      <span className="shrink-0 tabular-nums">{rm(r.landed.total)} {r.delta_vs_lowest && Number(r.delta_vs_lowest) > 0 && <span className="text-muted">(+{rm(r.delta_vs_lowest)})</span>}</span>
                    </div>
                    <div className="mt-1 h-3 overflow-hidden rounded-xs bg-soft" aria-hidden="true">
                      <div className="h-full origin-left bg-accent transition-transform duration-500 motion-reduce:transition-none" style={{ transform: `scaleX(${Number(r.landed.total) / maxTotal})`, opacity: i === 0 ? 1 : 0.55 }} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{rm(r.landed.per_base_unit)}/{c.product.base_uom} · {r.pack_label} {num(r.pack_size, 0)} · {t(S.lead)} {r.lead_days} {t(S.days)}{r.reliability != null ? ` · ${t(T.reliability)} ${Math.round(r.reliability)}` : ''}</p>
                  </li>
                ))}
              </ol>
            </section>

            {c.disqualified.length > 0 && (
              <section aria-label={t(T.ruledOut)}><h2 className="mb-2 font-semibold">{t(T.ruledOut)}</h2>
                <ul className="grid gap-1 text-sm">{c.disqualified.map(r => (
                  <li key={r.offer_id} className="card flex flex-wrap items-center justify-between gap-2 p-2"><span>{NAME(r.supplier_name)} <span className="tabular-nums text-muted">{rm(r.landed.total)}</span></span>
                    <span className="flex flex-wrap gap-1">{r.why_not.map(w0 => <span key={w0} className="chip chip-warn"><Icon name="close" className="size-3" />{reason(w0)}</span>)}</span></li>
                ))}</ul></section>
            )}
            {detail && <History c={c} />}
          </div>
          {detail && (
            <aside className="card h-fit text-sm" aria-label={t(T.weights)}>
              <h2 className="font-semibold">{t(T.weights)}</h2>
              {WLBL.map(([k, l]) => (
                <label key={k} className="mt-2 block">{t(l)}: <b className="tabular-nums">{w[k as keyof typeof w]}%</b>
                  <input type="range" min={0} max={100} className="w-full" value={w[k as keyof typeof w]} onChange={e => setW({ ...w, [k]: Number(e.target.value) })} /></label>
              ))}
              <p className="mt-2 text-xs text-muted">{t({ en: 'Weights only change the Best value badge. The recommendation is always the lowest total cost.', ms: 'Wajaran hanya mengubah lencana Nilai terbaik. Cadangan sentiasa kos keseluruhan terendah.', zh: '权重只影响“最划算”标记。推荐始终是总成本最低者。', ta: 'எடைகள் சிறந்த மதிப்பு பேட்ஜை மட்டுமே மாற்றும். பரிந்துரை எப்போதும் குறைந்த மொத்த செலவு.' })}</p>
            </aside>
          )}
        </div>}
      </Async>
      {order && c && <OrderDialog row={order} c={c} qty={qty} onClose={() => setOrder(null)} onDone={() => { setOrder(null); s.reload() }} />}
      {wizard && rec && c && <ContractWizard onClose={() => setWizard(false)} preset={{ supplier_id: rec.supplier_id, product_id: id, product_name: c.product.name, pack_size: rec.pack_size, price_per_pack: rec.landed.pack_price, lead: rec.lead_days }} />}
    </>
  )
}
function History({ c }: { c: Compare }) {
  const series = Object.entries(c.history)
  if (!series.length) return null
  const all = series.flatMap(([, v]) => v.map(p => Number(p.price)))
  const extra = [c.last_paid_per_base, c.market_avg_per_base].filter(Boolean).map(Number)
  const lo = Math.min(...all, ...extra) * 0.97, hi = Math.max(...all, ...extra) * 1.03, W = 320, H = 110
  const months = [...new Set(series.flatMap(([, v]) => v.map(p => p.month)))].sort()
  const x = (m: string) => 8 + (months.indexOf(m) / Math.max(months.length - 1, 1)) * (W - 16)
  const y = (v: number) => H - 8 - ((v - lo) / (hi - lo || 1)) * (H - 16)
  const names: Record<string, string> = Object.fromEntries([...c.qualified, ...c.disqualified].map(r => [r.supplier_id, NAME(r.supplier_name)]))
  return (
    <section className="card" aria-label={t(T.history)}>
      <h2 className="font-semibold">{t(T.history)}</h2>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={series.map(([sid, v]) => `${names[sid] ?? ''}: ${num(v[0].price, 2)} → ${num(v[v.length - 1].price, 2)}`).join('; ')}>
        {series.map(([sid, v], i) => <polyline key={sid} points={v.map(p => `${x(p.month)},${y(Number(p.price))}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray={['0', '5 3', '2 2', '8 3 2 3'][i % 4]} opacity={0.9} />)}
        {c.last_paid_per_base && <line x1="0" x2={W} y1={y(Number(c.last_paid_per_base))} y2={y(Number(c.last_paid_per_base))} stroke="var(--amber)" strokeWidth="1.5" />}
        {c.market_avg_per_base && <line x1="0" x2={W} y1={y(Number(c.market_avg_per_base))} y2={y(Number(c.market_avg_per_base))} stroke="var(--muted)" strokeDasharray="1 3" strokeWidth="1.5" />}
      </svg>
      <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted">{series.map(([sid], i) => <span key={sid}>{['——', '– –', '· ·', '–·–'][i % 4]} {names[sid]}</span>)}
        {c.last_paid_per_base && <span>▬ {t(T.lastPaid)} {rm(c.last_paid_per_base)}</span>}{c.market_avg_per_base && <span>··· {t(T.mktAvg)} {rm(c.market_avg_per_base)}</span>}</p>
    </section>
  )
}

function OrderDialog({ row, c, qty, onClose, onDone }: { row: Row; c: Compare; qty: string; onClose: () => void; onDone: () => void }) {
  useLang()
  const toast = useToast()
  const [amount, setAmount] = useState(row.landed.total)
  const [why, setWhy] = useState('')
  const [err, setErr] = useState('')
  const body = { product_id: c.product.id, supplier_id: row.supplier_id, qty, amount }
  const chk = useFetchPost<{ guard: { needs_approval: boolean } | null }>('/purchases/check', body)
  const guarded = !!chk?.guard
  const go = async () => {
    setErr('')
    try { const r = await api<{ status: string }>('POST', '/purchases', { ...body, reason: why || undefined }); toast(r.status === 'pending' ? t(T.pendingAppr) : t(T.recorded)); onDone() } catch (e) { setErr(msg(e)) }
  }
  return (
    <Dialog title={`${t(T.orderOnce)}: ${NAME(row.supplier_name)}`} onClose={onClose}>
      {guarded && <p role="alert" className="mb-3 rounded-ui border border-warn bg-warn-bg p-2 text-sm text-warn"><Icon name="warn" className="mr-1 inline size-4" />{t(T.guard)} {t(T.guardAsk)}
        {c.contract && <> {t(S.contract)}: {NAME(c.contract.supplier_name)} {rm(c.contract.price_per_base)}/{c.product.base_uom}.</>}</p>}
      <label className="block text-sm">{t(T.amount)}<input className="input mt-1 w-full" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
      {guarded && <label className="mt-3 block text-sm">{t(T.reasonLbl)}<input className="input mt-1 w-full" maxLength={500} value={why} onChange={e => setWhy(e.target.value)} /></label>}
      {err && <p role="alert" className="mt-2 text-sm text-warn">{err}</p>}
      <p className="mt-4 flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>{t({ en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து' })}</button>
        <button type="button" className="btn btn-primary" disabled={guarded && !why.trim()} onClick={go}>{t(T.placeOrder)}</button></p>
    </Dialog>
  )
}

// A POST that only reads (the guard check): run once on open.
function useFetchPost<R>(path: string, body: unknown): R | null {
  const [r, set] = useState<R | null>(null)
  useEffect(() => { api<R>('POST', path, body).then(set, () => set(null)) }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  return r
}


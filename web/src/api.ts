import { getLang, t } from './i18n'
import type { Text } from './i18n'
// Typed client for docs/api-contract.md (v0). Mock mode (VITE_MOCK=1) swaps fetch for src/mock.ts.
export type Role = 'owner' | 'staff'
export type Direction = 'in' | 'out'
export type Status = string // enum doc_status in db/schema.sql

export interface DocSummary {
  id: string; direction: Direction; kind: string; doc_no: string | null
  party: { id: string; name: string }; status: Status
  issued_on: string | null; valid_until: string | null
  total: string | null; currency: string; updated_at: string
  flags: { cost_is_stale: boolean; needs_review: boolean }
}
export interface Line {
  id: string; line_no: number; description: string; qty: string | null; uom: string
  unit_price: string | null; discount_pct: string | null; tax_rate: string | null
  section: string | null; is_header: boolean; needs_review: boolean; ocr_confidence: string | number | null
  attrs: Record<string, unknown>; attrs_unmapped: Record<string, unknown>
  item_key: string | null
}
export interface Provenance {
  cost_item_id: string; supplier: string; source_doc_id: string; source_doc_no: string
  line_id: string; source_line_id: string; qty_consumed?: string; cost_date: string; unit_cost: string; cost_snapshot: string
  current_unit_cost: string; cost_is_stale: boolean; line_margin: string
}
export interface Me { id: string; role: Role; role_key?: string; role_name?: string; permissions?: string[]; telegram_linked?: boolean; ai_guide?: boolean; name: string; org: { name: string; brand_color?: string | null; logo_url: string | null } }
// A live customer link (not used, revoked or expired) records the customer's accept or decline by itself.
export interface AcceptLink { created_at: string; first_viewed_at: string | null; expires_at: string }
export interface DocDetail {
  doc: DocSummary & { accept_link?: AcceptLink | null }
  lines: Line[]
  provenance?: Provenance[]
  messages: { direction: string; channel: string; body: string; at: string }[]
}
export interface Tracker { received: DocSummary[]; sent: DocSummary[] }
export interface Alert {
  quote_id: string; quote_no: string; customer: string; item_key: string
  old_cost: string; current_cost: string; margin_delta: string; status: Status
}
export interface Field {
  key: string; label: string; type: 'text' | 'number' | 'integer' | 'date' | 'select' | 'boolean'
  unit: string | null; options: string[] | null; show_in_grid: boolean; sort_order: number
}
export interface Followup { id: string; document_id: string; doc_no: string; customer: string; status: Status; due_at: string; reason: string; suggested_text: string | null
  days_waiting?: number; heat?: 'fresh' | 'waiting' | 'late' | 'stale' | null }
export interface MarginReport {
  // cost, margin, margin_pct, stale_quotes, stale_margin_lost and lowest_margin are scrubbed without view_costs: treat them as maybe missing
  days: number; quotes: number; revenue: string; cost?: string; margin?: string; margin_pct?: string | number | null
  won: number; lost: number; stale_quotes?: number; stale_margin_lost?: string
  lowest_margin?: { quote_id: string; quote_no: string; margin: string; margin_pct: string | number | null }[]
}
export interface Assignee { id: string; name: string }
export interface Job {
  id: string; status: 'todo' | 'doing' | 'done'; created_at?: string; quote_id: string | null; quote_no: string | null; customer: string | null; total: string | null; quote_total?: string | null; summary: string | null
  title?: string | null; label?: string; manual?: boolean  // a job made by hand has no quote: label = its title
  due_on?: string | null; assignee?: Assignee | null; priority?: 'low' | 'normal' | 'high'; notes?: string | null; started_at?: string | null; done_at?: string | null
  overdue?: boolean; days_to_due?: number | null  // days_to_due: negative = late
}
export interface Settings { display_name?: string | null; brand_color?: string | null; logo_data_url?: string | null; min_margin_pct: string; ssm_no: string | null; address: string | null; bank_details: string | null; sst_registered: boolean; sst_no: string | null
  quote_validity_days?: number | null; quote_prefix?: string | null; quote_payment_terms?: string | null; quote_terms_text?: string | null; issuer_email?: string | null; issuer_phone?: string | null }
export interface Proposal { id: string; key: string; sample_values: unknown[]; status: string }
export interface AuditEvent { id: number; at: string; actor: string; entity: string; entity_id: string; event: string }

// Client copy of the state machine (knowledge/07-data-model/state-machines.md) for button labels only.
// The server stays the authority: it answers 403 or 409 and the UI shows that message.
export interface Action { to: Status; label: string; owner: boolean; danger?: boolean; primary?: boolean }
export const NEXT: Record<Direction, Record<string, Action[]>> = {
  in: {
    received: [{ to: 'parsed', label: 'Mark supplier quote parsed', owner: false }, { to: 'rejected', label: 'Reject supplier quote', owner: true, danger: true }],
    parsed: [{ to: 'reviewed', label: 'Mark supplier quote reviewed', owner: false }, { to: 'rejected', label: 'Reject supplier quote', owner: true, danger: true }],
    reviewed: [{ to: 'accepted', label: 'Approve supplier quote', owner: true, primary: true }, { to: 'rejected', label: 'Reject supplier quote', owner: true, danger: true }],
    accepted: [{ to: 'in_cost_book', label: 'Add prices to cost book', owner: true, primary: true }],
  },
  out: {
    draft: [{ to: 'approved', label: 'Approve quote', owner: true, primary: true }, { to: 'cancelled', label: 'Cancel quote', owner: true, danger: true }],
    approved: [{ to: 'sent', label: 'Send quote to customer', owner: true, primary: true }, { to: 'cancelled', label: 'Cancel quote', owner: true, danger: true }],
    sent: [{ to: 'accepted', label: 'Record customer accepted', owner: true, primary: true }, { to: 'rejected', label: 'Record customer rejected', owner: true, danger: true }],
    read: [{ to: 'accepted', label: 'Record customer accepted', owner: true, primary: true }, { to: 'rejected', label: 'Record customer rejected', owner: true, danger: true }],
    accepted: [{ to: 'job_created', label: 'Create job from quote', owner: true, primary: true }],
  },
}

export const MOCK = import.meta.env.VITE_MOCK === '1'

let role: Role = (() => { try { return localStorage.getItem('role') === 'staff' ? 'staff' : 'owner' } catch { return 'owner' } })()
export const getRole = () => role
export const setRole = (r: Role) => { role = r; userId = ''; try { localStorage.setItem('role', r) } catch { /* storage blocked */ } }

// Simulated user id: resolved from GET /api/me (sent with X-Role only), kept in memory, never persisted.
let userId = ''
export async function resolveMe(r: Role): Promise<Me> {
  userId = ''
  const me = await call<Me>('GET', '/me', r, undefined, false)
  if (r === role) { userId = me.id; perms = me.permissions ?? [] }
  return me
}

// Permissions of the signed-in person, from GET /api/me. UI only: the server answers 403 permission_required either way.
let perms: string[] = []
export const can = (k: string) => perms.includes(k)
// The ONE map of permission key -> label (same wording as the server catalog, GET /api/roles). Add a key here when you gate a control on it.
export const PERM_LABEL: Record<string, string> = {
  view_costs: 'See costs and prices', view_reports: 'See the margin report', edit_supplier_contacts: 'Edit supplier contacts', manage_contacts: 'Manage contacts',
  upload_documents: 'Upload documents', ask_suppliers: 'Request quotes', view_replies_prices: 'See supplier reply prices', manage_followups: 'Send or skip follow-ups',
  manage_contracts: 'Draft supplier contracts', approve_contracts: 'Approve contracts up to a limit',
  export_contacts: 'Export the contact book', export_audit: 'Export the activity log', export_documents: 'Export quotes with costs', manage_catalog: 'Manage the catalog',
  view_business_report: 'See the business report', set_report_targets: 'Set report targets and cash', view_audit: 'See the activity log', decide_quotes: 'Approve, accept, reject or send quotes',
  view_revenue: 'See revenue and profit', record_expenses: 'Record running costs',
}
// Permission label (and description) by key in the current language; English and unknown keys show the server's own text. Used by the Roles page and why().
type L = Omit<Text, 'en'>
export const PERMS: Record<string, { label: L; description?: L }> = {
  view_costs: { label: { ms: 'Lihat kos dan margin', zh: '查看成本和利润', ta: 'செலவுகளையும் லாபத்தையும் காண்' }, description: { ms: 'Harga pembekal, item kos, margin, amaran kos lapuk dan teks sembang pembekal. Tanpanya setiap respons dibersihkan daripada semua ini.', zh: '供应商价格、成本项目、利润、过时成本提醒和供应商聊天内容。没有此权限，所有响应都会隐去这些内容。', ta: 'சப்ளையர் விலைகள், செலவு உருப்படிகள், லாபம், பழைய செலவு எச்சரிக்கைகள், சப்ளையர் அரட்டை உரை. இல்லையெனில் ஒவ்வொரு பதிலிலிருந்தும் இவை நீக்கப்படும்.' } },
  view_reports: { label: { ms: 'Lihat laporan margin', zh: '查看利润报表', ta: 'லாப அறிக்கையைக் காண்' }, description: { ms: 'Laporan margin (angka kos dan margin di dalamnya juga memerlukan Lihat kos dan margin).', zh: '利润报表（其中的成本和利润数字还需要“查看成本和利润”权限）。', ta: 'லாப அறிக்கை (அதிலுள்ள செலவு, லாப எண்களுக்கு செலவுகளையும் லாபத்தையும் காண் அனுமதியும் தேவை).' } },
  view_revenue: { label: { ms: 'Lihat hasil dan untung', zh: '查看收入和利润', ta: 'வருவாயையும் லாபத்தையும் காண்' }, description: { ms: 'Halaman Hasil: wang masuk dan keluar, untung kasar dan untung bersih. Ia menunjukkan kos, jadi ia juga memerlukan Lihat kos dan margin.', zh: '“收入”页面：收入与支出、毛利和净利润。它会显示成本，因此还需要“查看成本和利润”。', ta: 'வருவாய்ப் பக்கம்: வரும் மற்றும் போகும் பணம், மொத்த லாபம், நிகர லாபம். இது செலவுகளைக் காட்டுவதால் செலவுகளையும் லாபத்தையும் காண் அனுமதியும் தேவை.' } },
  record_expenses: { label: { ms: 'Rekod kos operasi', zh: '记录经营开支', ta: 'இயக்கச் செலவுகளைப் பதிவு செய்' }, description: { ms: 'Tambah sewa, gaji dan bil ke halaman Hasil supaya untung bersih betul. Membatalkan satu entri ialah hak pemilik.', zh: '把租金、工资和账单添加到“收入”页面，使净利润准确。作废一笔记录由老板操作。', ta: 'நிகர லாபம் சரியாக இருக்க வாடகை, சம்பளம், கட்டணங்களை வருவாய்ப் பக்கத்தில் சேர்க்கவும். ஒரு பதிவைச் செல்லாததாக்குவது உரிமையாளருக்கு.' } },
  edit_supplier_contacts: { label: { ms: 'Tukar nama atau nombor pembekal', zh: '更改供应商的名称或号码', ta: 'சப்ளையரின் பெயர் அல்லது எண்ணை மாற்று' }, description: { ms: 'Tempat sembang pembekal dihalakan. Medan kenalan lain hanya memerlukan Urus kenalan.', zh: '供应商聊天的转接位置。其他联系人字段只需要“添加和编辑联系人”。', ta: 'சப்ளையர் அரட்டை எங்கே செல்கிறது என்பது. மற்ற தொடர்புப் புலங்களுக்கு தொடர்புகளைச் சேர் மற்றும் திருத்து மட்டும் போதும்.' } },
  manage_contacts: { label: { ms: 'Tambah dan edit kenalan', zh: '添加和编辑联系人', ta: 'தொடர்புகளைச் சேர் மற்றும் திருத்து' }, description: { ms: 'Cipta dan edit pelanggan, pembekal dan kontraktor.', zh: '创建和编辑客户、供应商和承包商。', ta: 'வாடிக்கையாளர்கள், சப்ளையர்கள், ஒப்பந்ததாரர்களை உருவாக்கித் திருத்து.' } },
  upload_documents: { label: { ms: 'Muat naik dokumen pembekal', zh: '上传供应商文档', ta: 'சப்ளையர் ஆவணங்களைப் பதிவேற்று' }, description: { ms: 'Masukkan fail pembekal atau teks yang ditampal, dan taip dokumen secara manual.', zh: '导入供应商文件或粘贴的文本，并手动录入文档。', ta: 'சப்ளையர் கோப்பு அல்லது ஒட்டிய உரையை உள்ளிடு, ஆவணத்தை கைமுறையாகப் பதிவு செய்.' } },
  ask_suppliers: { label: { ms: 'Tanya harga daripada pembekal', zh: '向供应商询价', ta: 'சப்ளையர்களிடம் விலை கேள்' }, description: { ms: 'Hantar item yang difoto kepada pembekal melalui WhatsApp atau Telegram.', zh: '通过 WhatsApp 或 Telegram 把拍下的物品发给供应商。', ta: 'படம் எடுத்த பொருளை WhatsApp அல்லது Telegram மூலம் சப்ளையர்களுக்கு அனுப்பு.' } },
  view_replies_prices: { label: { ms: 'Lihat balasan dan harga pembekal', zh: '查看供应商回复和价格', ta: 'சப்ளையர் பதில்களையும் விலைகளையும் காண்' }, description: { ms: 'Perkataan dan harga dalam balasan pembekal kepada pertanyaan.', zh: '供应商回复询价时的文字和价格。', ta: 'விசாரணைக்கு சப்ளையர்களின் பதில்களில் உள்ள சொற்களும் விலைகளும்.' } },
  manage_followups: { label: { ms: 'Hantar atau langkau susulan', zh: '发送或跳过跟进', ta: 'பின்தொடர்வுகளை அனுப்பு அல்லது தவிர்' }, description: { ms: 'Hantar mesej susulan yang dicadangkan kepada pelanggan, atau langkaunya.', zh: '向客户发送建议的催促消息，或跳过。', ta: 'பரிந்துரைக்கப்பட்ட நினைவூட்டல் செய்தியை வாடிக்கையாளருக்கு அனுப்பு, அல்லது தவிர்.' } },
  export_contacts: { label: { ms: 'Eksport buku kenalan', zh: '导出联系人', ta: 'தொடர்பு புத்தகத்தை ஏற்றுமதி செய்' }, description: { ms: 'Muat turun buku kenalan sebagai CSV (nama dan nombor ialah data peribadi).', zh: '以 CSV 下载联系人（姓名和号码属于个人数据）。', ta: 'தொடர்பு புத்தகத்தை CSV ஆகப் பதிவிறக்கவும் (பெயர்களும் எண்களும் தனிப்பட்ட தரவு).' } },
  export_audit: { label: { ms: 'Eksport log aktiviti', zh: '导出活动日志', ta: 'செயல்பாட்டுப் பதிவை ஏற்றுமதி செய்' }, description: { ms: 'Muat turun log aktiviti sebagai CSV atau PDF. Membacanya memerlukan Lihat suapan aktiviti.', zh: '以 CSV 或 PDF 下载活动日志。查看日志需要“查看活动动态”权限。', ta: 'செயல்பாட்டுப் பதிவை CSV அல்லது PDF ஆகப் பதிவிறக்கவும். படிக்க “செயல்பாட்டு ஊட்டத்தைக் காண்” தேவை.' } },
  export_documents: { label: { ms: 'Eksport sebut harga dengan kos (BOM, PO, fail dalaman)', zh: '导出含成本的报价（BOM、PO、内部文件）', ta: 'செலவுடன் மேற்கோள்களை ஏற்றுமதி செய் (BOM, PO, உள் கோப்பு)' }, description: { ms: 'Eksport fail dalaman sebut harga, bil bahan dan pesanan belian. Ia mengandungi kos pembekal, jadi memerlukan juga Lihat kos dan margin.', zh: '导出报价内部文件、物料清单和采购单。其中含供应商成本，因此还需要“查看成本和利润”权限。', ta: 'மேற்கோளின் உள் கோப்பு, பொருள் பட்டியல், கொள்முதல் ஆணை ஆகியவற்றை ஏற்றுமதி செய்யவும். இவை சப்ளையர் செலவைக் கொண்டிருப்பதால் “செலவுகளையும் லாபத்தையும் காண்” தேவை.' } },
  manage_catalog: { label: { ms: 'Urus katalog', zh: '管理目录', ta: 'பட்டியலை நிர்வகி' }, description: { ms: 'Baca foto katalog, edit dan sahkan produknya, dan urus kategori katalog (tambah, namakan semula, padam, alih produk).', zh: '读取目录照片，编辑并确认其中的商品，并管理目录分类（添加、重命名、删除、移动商品）。', ta: 'பட்டியல் படங்களைப் படித்து, அவற்றின் பொருட்களைத் திருத்தி உறுதிப்படுத்தி, பட்டியல் வகைகளை (சேர், மறுபெயரிடு, நீக்கு, பொருட்களை நகர்த்து) நிர்வகிக்கவும்.' } },
  view_business_report: { label: { ms: 'Lihat laporan perniagaan', zh: '查看业务报告', ta: 'வணிக அறிக்கையைக் காண்' }, description: { ms: 'Halaman Laporan perniagaan: KPI berbanding sasaran, operasi dan analitik. Ia menunjukkan kos, untung dan hutang pelanggan, jadi memerlukan juga Lihat kos dan margin serta Lihat hasil dan untung.', zh: '业务报告页面：KPI 与目标对比、运营和分析。其中含成本、利润和客户欠款，因此还需要“查看成本和利润”和“查看收入和利润”。', ta: 'வணிக அறிக்கைப் பக்கம்: இலக்குகளுடன் KPI, செயல்பாடுகள், பகுப்பாய்வு. இது செலவு, இலாபம், வாடிக்கையாளர் நிலுவையைக் காட்டுவதால் “செலவுகளையும் லாபத்தையும் காண்”, “வருவாயையும் லாபத்தையும் காண்” தேவை.' } },
  set_report_targets: { label: { ms: 'Tetapkan sasaran laporan dan tunai', zh: '设定报告目标和现金', ta: 'அறிக்கை இலக்குகளையும் கையிருப்பையும் அமை' }, description: { ms: 'Tukar sasaran dan tunai di tangan yang dibandingkan oleh Laporan perniagaan. Membaca laporan memerlukan Lihat laporan perniagaan.', zh: '更改业务报告用来对比的目标和现金。查看报告需要“查看业务报告”。', ta: 'வணிக அறிக்கை ஒப்பிடும் இலக்குகளையும் கையிருப்பையும் மாற்றவும். அறிக்கையைப் படிக்க “வணிக அறிக்கையைக் காண்” தேவை.' } },
  view_audit: { label: { ms: 'Lihat suapan aktiviti', zh: '查看活动动态', ta: 'செயல்பாட்டு ஊட்டத்தைக் காண்' }, description: { ms: 'Suapan audit (entri kos di dalamnya juga memerlukan Lihat kos dan margin).', zh: '审计动态（其中的成本条目还需要“查看成本和利润”）。', ta: 'தணிக்கை ஊட்டம் (அதிலுள்ள செலவு உள்ளீடுகளுக்கு செலவுகளையும் லாபத்தையும் காண் அனுமதியும் தேவை).' } },
  manage_contracts: { label: { ms: 'Draf kontrak pembekal', zh: '起草供应商合同', ta: 'சப்ளையர் ஒப்பந்தங்களை வரை' }, description: { ms: 'Mulakan kontrak daripada sebut harga dan hantar untuk kelulusan. Juga melihat harga dan kontrak pembekal.', zh: '根据报价起草合同并提交审批。也可查看供应商价格和合同。', ta: 'விலைப்புள்ளியிலிருந்து ஒப்பந்தம் தொடங்கி ஒப்புதலுக்கு அனுப்பு. சப்ளையர் விலைகளையும் ஒப்பந்தங்களையும் காணலாம்.' } },
  approve_contracts: { label: { ms: 'Lulus kontrak sehingga had', zh: '在限额内批准合同', ta: 'வரம்பு வரை ஒப்பந்தங்களை அங்கீகரி' }, description: { ms: 'Lulus kontrak yang nilainya tidak melebihi had dalam Tetapan pembekal. Yang lebih besar perlu pemilik.', zh: '批准价值不超过供应商设置中限额的合同。更大的合同需要店主批准。', ta: 'சப்ளையர் அமைப்பில் உள்ள வரம்புக்குள் மதிப்புள்ள ஒப்பந்தங்களை அங்கீகரி. பெரியவற்றுக்கு உரிமையாளர் தேவை.' } },
  manage_team: { label: { ms: 'Tambah, edit dan nyahaktifkan orang', zh: '添加、编辑和停用成员', ta: 'நபர்களைச் சேர், திருத்து, செயலிழக்கச் செய்' } },
  manage_roles: { label: { ms: 'Cipta dan edit peranan', zh: '创建和编辑角色', ta: 'பங்குகளை உருவாக்கு, திருத்து' } },
  manage_settings: { label: { ms: 'Tetapan organisasi dan penjenamaan', zh: '组织设置和品牌', ta: 'நிறுவன அமைப்புகளும் பிராண்டிங்கும்' } },
  approve_quotes: { label: { ms: 'Lulus, terima, tolak dan hantar sebut harga (perlindungan pangkalan data memerlukan pemilik)', zh: '批准、接受、拒绝和发送报价（数据库保护要求店主）', ta: 'விலைப்புள்ளிகளை அங்கீகரி, ஏற்று, நிராகரி, அனுப்பு (தரவுத்தளப் பாதுகாப்புக்கு உரிமையாளர் தேவை)' } },
  decide_quotes: { label: { ms: 'Lulus, terima, tolak atau hantar sebut harga', zh: '批准、接受、拒绝或发送报价', ta: 'விலைப்புள்ளிகளை அங்கீகரி, ஏற்று, நிராகரி அல்லது அனுப்பு' } },
  promote_to_cost_book: { label: { ms: 'Terima dokumen pembekal atau balasan tanya pembekal ke dalam buku kos', zh: '把供应商文档或询价回复收入成本册', ta: 'சப்ளையர் ஆவணம் அல்லது விசாரணைப் பதிலை செலவுப் புத்தகத்தில் ஏற்று' } },
  erase_party: { label: { ms: 'Padam data peribadi pelanggan', zh: '删除客户的个人数据', ta: 'வாடிக்கையாளரின் தனிப்பட்ட தரவை அழி' } },
  decide_field_proposals: { label: { ms: 'Lulus atau abaikan medan tambahan yang dicadangkan', zh: '批准或忽略建议的额外字段', ta: 'பரிந்துரைக்கப்பட்ட கூடுதல் புலங்களை அங்கீகரி அல்லது புறக்கணி' } },
}
export const PERM_GROUPS: Record<string, L> = {
  'Costs and prices': { ms: 'Kos dan harga', zh: '成本和价格', ta: 'செலவுகளும் விலைகளும்' },
  Contacts: { ms: 'Kenalan', zh: '联系人', ta: 'தொடர்புகள்' },
  Documents: { ms: 'Dokumen', zh: '文档', ta: 'ஆவணங்கள்' },
  Suppliers: { ms: 'Pembekal', zh: '供应商', ta: 'சப்ளையர்கள்' },
  Quotes: { ms: 'Sebut harga', zh: '报价', ta: 'விலைப்புள்ளிகள்' },
  Data: { ms: 'Data', zh: '数据', ta: 'தரவு' },
  Catalog: { ms: 'Katalog', zh: '目录', ta: 'பட்டியல்' },
  Reports: { ms: 'Laporan', zh: '报告', ta: 'அறிக்கைகள்' },
  Activity: { ms: 'Aktiviti', zh: '活动', ta: 'செயல்பாடு' },
}
// `en` is the server's text: kept for English and for any key or group not listed above.
export const permLabel = (k: string, en: string) => PERMS[k]?.label[getLang() as 'ms'] ?? en
export const permDesc = (k: string, en: string) => PERMS[k]?.description?.[getLang() as 'ms'] ?? en
export const permGroup = (g: string) => PERM_GROUPS[g]?.[getLang() as 'ms'] ?? g
export const why = (k: string) => {
  const n = getLang() === 'en' ? PERM_LABEL[k] ?? k : permLabel(k, PERM_LABEL[k] ?? k)
  return t({ en: `Needs the “${n}” permission`, ms: `Memerlukan kebenaran “${n}”`, zh: `需要“${n}”权限`, ta: `“${n}” அனுமதி தேவை` })
}
// Spread on a button: `<button {...needs('manage_contacts', onClick)}>`. Without the permission it is aria-disabled, explains why in its title and does nothing.
// Courtesy only: the server answers 403 either way.
export const needs = (k: string, onClick?: () => void) => can(k) ? { onClick } : { 'aria-disabled': true as const, title: why(k), 'data-locked': true as const }
export const DENIED = 'You do not have permission to do that. Ask the owner.'   // English text; ui.tsx translates it when shown
const isDenied = (e: unknown) => e instanceof ApiError && e.status === 403 && (e.code === 'permission_required' || e.code === 'owner_only')
// A 403 may mean the role changed since /me was read: ask the shell to re-read it, at most once every 10 s.
let lastPerms = 0
const denied403 = (e: unknown) => { if (isDenied(e) && Date.now() - lastPerms > 10_000) { lastPerms = Date.now(); window.dispatchEvent(new Event('laris:perms')) } }
// Pages that need a permission. Team, Roles, Settings, Privacy and API access are owner-class only (docs/roles.md, "Owner only, not assignable").
const NEED: Record<string, string> = { reports: 'view_business_report', alerts: 'view_costs', activity: 'view_audit', ask: 'ask_suppliers', followups: 'manage_followups' }
const SUPPLIER_PAGES = ['suppliers', 'supplier', 'products', 'product', 'contracts', 'contract']  // supplier prices: See costs, or a buyer role with Draft contracts
// Revenue shows costs, so it needs both permissions (the server asks for both too).
export const canOpen = (route: string, owner: boolean) => ['team', 'roles', 'settings', 'status', 'privacy', 'api-access', 'ai-settings', 'templates'].includes(route) ? owner : SUPPLIER_PAGES.includes(route) ? can('view_costs') || can('manage_contracts') : route === 'revenue' ? can('view_revenue') && can('view_costs') : !NEED[route] || can(NEED[route])

// ---- sign-in. The session token lives in sessionStorage (this tab only); only its hash is stored on the server.
export const getToken = (): string | null => { try { return sessionStorage.getItem('token') } catch { return null } }
const setToken = (t: string | null) => { try { if (t) sessionStorage.setItem('token', t); else { sessionStorage.removeItem('token'); sessionStorage.removeItem('acct') } } catch { /* storage blocked */ } }
// Username of the real account signed in on this tab (null for a shared access token or demo header mode).
export const getAccount = (): string | null => { try { return sessionStorage.getItem('acct') } catch { return null } }
// One-time notice for the sign-in screen, set when the server ended the session (not on a deliberate sign out).
let notice = ''
export const takeNotice = () => { const n = notice; notice = ''; return n }
export const setNotice = (t: string) => { notice = t }
// Email carried from the sign-up or reset flow to the sign-in form; read once.
let prefill = ''
export const setPrefill = (e: string) => { prefill = e }
export const takePrefill = () => { const e = prefill; prefill = ''; return e }
export const signedOut = (ended = false) => { if (ended) notice = 'Your session ended, please sign in again.'; setToken(null); userId = ''; window.dispatchEvent(new Event('laris:signedout')) }
// Single flight: only a 401 for the token still in use signs out. The first one clears it, so parallel 401s (and late ones after a new sign-in) do nothing.
// A 401 with no token at all (for example /me after the auth config failed) goes to sign-in too, without the 'session ended' notice.
const expired = (res: Response, sent: string | null) => { if (res.status === 401 && getToken() === sent) signedOut(!!sent) }

export async function authConfig(): Promise<{ login_required: boolean }> {
  if (MOCK) return { login_required: false }
  return publicApi('GET', '/auth/config')
}

export interface Business { id: string; name: string }
// businessId: set after the server answered 409 choose_business (the error then carries `businesses`).
export async function login(username: string, password: string, businessId?: string): Promise<void> {
  if (MOCK) {  // mock mode has no accounts: any entry signs in, except multi@demo.test which has two businesses
    if (username.toLowerCase() === 'multi@demo.test' && !businessId)
      throw new ApiError(409, 'choose_business', 'This email is used by more than one business. Choose one.', [{ id: 'biz-acme', name: 'Acme Printing' }, { id: 'biz-bright', name: 'Bright Catering' }])
    return
  }
  const data = await publicApi<{ token: string }>('POST', '/login', businessId ? { username, password, business_id: businessId } : { username, password })
  setToken(data.token)
  try { sessionStorage.setItem('acct', username) } catch { /* storage blocked */ }
}

// Shared access token (APP_TOKEN, demo deployments): same header, no account behind it.
export const setAccessToken = (t: string) => setToken(t.trim())

export async function logout(): Promise<void> {
  if (!MOCK && getToken()) await fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + getToken() } }).catch(() => undefined)
  try { sessionStorage.removeItem('laris.bot.intro') } catch { /* private window */ }  // the robot introduces itself again at the next sign-in
  signedOut()
}

// requestId: server reference (error.request_id or X-Request-Id), optional on older servers. retryAfter: seconds, from Retry-After on a 429.
// shown: a page put this error in front of the user (msg(), Async). toasted: the global error toast was raised for it instead.
export class ApiError extends Error {
  requestId?: string
  retryAfter?: number
  fields?: { field: string; message: string }[]
  details?: { licences?: number }
  shown = false
  toasted = false
  constructor(public status: number, public code: string, message: string, public businesses?: Business[]) { super(message) }
}

// ---- licence (docs/licensing.md). A 402 license_required on a write never signs out: it raises an event, the shell refreshes the licence and shows a toast with a link.
export interface License {
  status: 'missing' | 'active' | 'expiring' | 'expired' | 'invalid' | 'clock_unverified'; plan: string | null; seats: number | null; seats_used: number
  expires_at: string | null; days_left: number | null; enforced: boolean; read_only: boolean
  clock: { source: 'ntp' | 'system'; trusted_at: string | null; rollback: boolean } | null
  offer?: { plan: string; seats: number; expires_at: string } | null  // a licence the platform operator issued for this business, ready to activate
}
const licence402 = (e: unknown) => { if (e instanceof ApiError && e.status === 402 && e.code === 'license_required') window.dispatchEvent(new Event('laris:license402')) }


// ---- request core: one place for timeout, retry, the error envelope ({error:{code,message,request_id,fields?}} + X-Request-Id) and the 5xx toast.
export interface ReqOpts { timeoutMs?: number; signal?: AbortSignal; quiet?: boolean }
const sleep = (ms: number, s?: AbortSignal) => new Promise<void>((res, rej) => { const t = setTimeout(res, ms); s?.addEventListener('abort', () => { clearTimeout(t); rej(s.reason) }, { once: true }) })
const mockQ = (k: string) => new URLSearchParams(location.search).get(k)  // mock-only test switches (docs/ux-refactor.md)
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const LONG = /^\/(listings|rfq|documents\/ingest|assistant)/  // uploads and vision routes: 120 s

// Mock mode answers through the same pipeline as a real server (a Response), so timeout, retry and error handling run in mock too.
async function mockFetch(method: string, path: string, r: Role, body: unknown, signal: AbortSignal): Promise<Response> {
  const { mock } = await import('./mock')
  const [p] = path.split('?')
  const contacts = p === '/contacts' && method === 'GET'
  await sleep((contacts ? Number(mockQ('slow')) || 0 : 0) + 120, signal)
  const err = (status: number, error: object) => new Response(JSON.stringify({ error: { request_id: `mock-${status}-7f3a`, ...error } }), { status, headers: { 'X-Request-Id': `mock-${status}-7f3a` } })
  if (method === 'GET' && p === (mockQ('failpath') ?? '/contacts') && mockQ('fail') === '500') return err(500, { code: 'internal', message: 'Internal error' })
  try { const out = p.startsWith('/license') ? (await import('./mockLicence')).mockLicence(method, p, body, (m, q) => mock(m, q, r, body)) : mock(method, path, r, body); return new Response(out instanceof Blob ? out : JSON.stringify(out), { status: 200 }) }
  catch (e) {
    if (e instanceof ApiError) return err(e.status, { code: e.code, message: e.message, fields: e.fields, details: e.details })
    return err(500, { code: 'internal', message: String(e) })
  }
}

function toError(res: Response, data: any): ApiError {  // eslint-disable-line @typescript-eslint/no-explicit-any
  const er = data?.error
  const rid: string | undefined = er?.request_id ?? res.headers.get('X-Request-Id') ?? undefined
  let message: string = er?.message ?? `Request failed (${res.status})`
  // 5xx: never show server internals; a 503 that carries its own message (db_unavailable, vision not set up) keeps it
  if (res.status >= 500 && !(res.status === 503 && er?.message)) message = rid ? `Server error. Reference: ${rid}` : `Server error (${res.status})`
  const f = res.status === 422 && Array.isArray(er?.fields) ? er.fields[0] : undefined
  if (f?.message) message = f.field ? `${cap(String(f.field).replace(/_/g, ' '))}: ${f.message}` : f.message
  const e = new ApiError(res.status, er?.code ?? 'error', message, er?.businesses)
  e.requestId = rid; e.fields = er?.fields; e.details = er?.details
  const ra = Number(res.headers.get('Retry-After'))
  if (res.status === 429 && ra > 0) e.retryAfter = ra
  return e
}

interface Req extends ReqOpts { body?: unknown; as?: 'json' | 'blob'; auth?: boolean; user?: boolean; quiet?: boolean; role?: Role }

async function once<T>(method: string, path: string, o: Req, ms: number): Promise<T> {
  const sent = getToken()
  const form = o.body instanceof FormData
  const headers: Record<string, string> = {}
  if (o.auth) { headers['X-Role'] = o.role ?? role; if (o.user && userId) headers['X-User'] = userId; if (sent) headers['Authorization'] = 'Bearer ' + sent }
  if (o.body !== undefined && !form) headers['Content-Type'] = 'application/json'
  const signal = AbortSignal.any([AbortSignal.timeout(ms), ...(o.signal ? [o.signal] : [])])
  try {
    const res = MOCK ? await mockFetch(method, path, o.role ?? role, o.body, signal)
      : await fetch('/api' + path, { method, headers, signal, body: o.body === undefined ? undefined : form ? (o.body as FormData) : JSON.stringify(o.body) })
    if (o.auth) expired(res, sent)  // expired or revoked: back to the sign-in screen with a notice
    if (res.ok) return (o.as === 'blob' ? await res.blob() : await res.json().catch(() => null)) as T
    throw toError(res, await res.json().catch(() => null))
  } catch (e) {
    if (e instanceof ApiError) throw e
    if (o.signal?.aborted) throw e  // the caller cancelled: not our error
    if (signal.aborted) throw new ApiError(0, 'timeout', 'The server took too long to answer. Check your connection and try again.')
    throw new ApiError(0, 'network', 'Cannot reach the server.')
  }
}

// Only GET/HEAD are retried (once, after 800 ms): repeating a POST could save twice.
async function request<T>(method: string, path: string, o: Req = {}): Promise<T> {
  const ms = o.timeoutMs ?? ((MOCK && Number(mockQ('timeout'))) || (o.body instanceof FormData || LONG.test(path) ? 120_000 : 30_000))
  const safe = method === 'GET' || method === 'HEAD'
  for (let n = 0; ; n++) {
    try { return await once<T>(method, path, o, ms) } catch (e) {
      if (n === 0 && safe && !o.signal?.aborted && e instanceof ApiError && (e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504)) { await sleep(800, o.signal); continue }
      // A 5xx nobody put on screen (msg(), Async) within 300 ms gets the global error toast, once.
      if (e instanceof ApiError && !o.quiet && ((e.status >= 500 && e.status !== 503) || e.code === 'db_unavailable'))
        setTimeout(() => { if (!e.shown) { e.toasted = true; window.dispatchEvent(new CustomEvent('laris:error', { detail: e.message })) } }, 300)
      throw e
    }
  }
}

// Public endpoints (signup, verify, password reset, sign-in): no identity headers, no sign-out on 401.
export const publicApi = <T,>(method: 'GET' | 'POST', path: string, body?: unknown, opts?: ReqOpts): Promise<T> => request<T>(method, path, { ...opts, body, quiet: true })

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
const call = <T,>(method: Method, path: string, r: Role, body: unknown, withUser: boolean, opts?: ReqOpts): Promise<T> =>
  request<T>(method, path, { ...opts, body, auth: true, user: withUser, role: r }).catch(e => { licence402(e); denied403(e); throw e })

// File download (PDF, xlsx, csv): same identity headers as api(), result saved through a temporary link.
export async function download(path: string, filename: string, opts?: ReqOpts): Promise<void> {
  const url = URL.createObjectURL(await request<Blob>('GET', path, { ...opts, auth: true, user: true, as: 'blob' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// Same as download() but hands back an object URL (for "Open PDF in a new tab"). The caller revokes it.
export async function blobUrl(path: string, opts?: ReqOpts): Promise<string> {
  return URL.createObjectURL(await request<Blob>('GET', path, { ...opts, auth: true, user: true, as: 'blob' }))
}

// A file as a Blob, left to the caller to name and save (the extension depends on what the server made, e.g. .docx or .pdf).
export const fileBlob = (path: string, opts?: ReqOpts): Promise<Blob> => request<Blob>('GET', path, { ...opts, auth: true, user: true, as: 'blob' })

// Image for <img>: the API needs the identity headers, so fetch it as a blob. Mock data and data/blob URLs pass through.
export async function imageUrl(path: string, opts?: ReqOpts): Promise<string> {
  if (MOCK || !path.startsWith('/api/')) return path
  return URL.createObjectURL(await request<Blob>('GET', path.slice(4), { ...opts, auth: true, user: true, as: 'blob', quiet: true }))
}

export const api = <T,>(method: Method, path: string, body?: unknown, opts?: ReqOpts) => call<T>(method, path, role, body, true, opts)

// ---- Telegram bot settings (GET/POST /settings/telegram/bot-settings). days: ISO weekdays, 1 = Monday ... 7 = Sunday.
export interface BotSettingsView {
  welcome: string; help: string; language: 'auto' | 'en' | 'ms'; quick_replies: string[]; reactions: boolean
  after_hours: { enabled: boolean; message: string; open: string; close: string; days: number[] }
  defaults: { welcome: string; help: string; after_hours_message: string }
}

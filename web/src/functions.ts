import { can, canOpen } from './api'
import type { Me } from './api'
import type { IconName } from './icons'
import type { Lang, Text } from './i18n'
import { pick } from './i18n'
import { canUpload } from './Listings'
import { licenceOn, issuerOn } from './Licence'
import { ARTICLES } from './help/articles'

/*
  ONE registry of everything a person can do, used by the search palette (Palette.tsx). Add a page or action here when you add it
  to NAV (Shell.tsx) or build it. Filtering uses the same helpers as the sidebar (canOpen, can, owner), so staff never see owner-only entries.
  Only register what exists: href must open a real page. `path` is the click trail in the real (English) UI.
*/
export interface Ctx { me?: Me; owner: boolean; signedIn: boolean }
export interface Fn {
  id: string; icon: IconName; label: Text; keywords: { en: string[]; ms: string[] }; path: string[]
  href: string; action?: 'theme' | 'signout' | 'tour'; needs?: (c: Ctx) => boolean
}

// Chinese and Tamil labels by id (keywords stay en/ms: matchFns also searches the English words in zh and ta).
const ZT: Record<string, [string, string]> = {
  'nav-home': ['首页', 'முகப்பு'], 'nav-revenue': ['收入', 'வருவாய்'], 'nav-tracker': ['报价追踪', 'மேற்கோள் கண்காணிப்பு'], 'nav-track': ['日程', 'அட்டவணை'], 'nav-jobs': ['工单', 'வேலைகள்'], 'nav-followups': ['跟进', 'பின்தொடர்வுகள்'],
  'nav-contacts': ['联系人', 'தொடர்புகள்'], 'nav-ask': ['询问供应商', 'சப்ளையர்களிடம் கேள்'], 'nav-catalog': ['目录照片', 'பட்டியல் படங்கள்'], 'nav-alerts': ['过时成本', 'பழைய செலவுகள்'],
  'nav-activity': ['审计日志', 'தணிக்கைப் பதிவு'], 'nav-assistant': ['询问 Laris', 'Laris இடம் கேள்'], 'nav-team': ['团队', 'குழு'], 'nav-roles': ['角色与权限', 'பங்குகளும் அனுமதிகளும்'],
  'nav-settings': ['设置', 'அமைப்புகள்'], 'nav-privacy': ['隐私与数据', 'தனியுரிமை மற்றும் தரவு'], 'nav-api-access': ['API 访问', 'API அணுகல்'], 'nav-ai-settings': ['AI 设置', 'AI அமைப்புகள்'],
  'nav-status': ['系统状态', 'அமைப்பு நிலை'], 'nav-licence': ['许可证', 'உரிமம்'], 'nav-issuer': ['签发许可证', 'உரிமங்களை வழங்கு'],
  invite: ['邀请团队成员', 'குழு உறுப்பினரை அழை'], 'link-telegram-person': ['为成员绑定 Telegram', 'ஒருவருக்கு Telegram ஐ இணை'], 'link-telegram-me': ['绑定我的 Telegram', 'என் Telegram ஐ இணை'],
  'customer-bot': ['连接客户机器人', 'வாடிக்கையாளர் போட்டை இணை'], 'customise-bot': ['自定义机器人', 'போட்டைத் தனிப்பயனாக்கு'], 'upload-quote': ['上传供应商报价', 'சப்ளையர் மேற்கோளைப் பதிவேற்று'],
  'add-contact': ['添加联系人', 'தொடர்பைச் சேர்'], 'ask-suppliers': ['向供应商询价', 'சப்ளையர்களிடம் விலை கேள்'], 'catalog-photo': ['发送目录照片', 'பட்டியல் படத்தை அனுப்பு'],
  'needs-review': ['打开需要审核的文档', 'மதிப்பாய்வு தேவைப்படும் ஆவணங்களைத் திற'], 'approve-send': ['批准并发送报价', 'மேற்கோளை அங்கீகரித்து அனுப்பு'],
  'export-quote': ['导出报价 (PDF, XLSX, CSV)', 'மேற்கோளை ஏற்றுமதி செய் (PDF, XLSX, CSV)'], 'activity-log': ['查看活动记录', 'செயல்பாட்டுப் பதிவைக் காண்'],
  'margin-report': ['利润率报告', 'மார்ஜின் அறிக்கை'], branding: ['品牌与标志', 'பிராண்டிங் மற்றும் லோகோ'], 'set-language': ['更改语言', 'மொழியை மாற்று'],
  'set-theme': ['深色或浅色主题', 'இருண்ட அல்லது ஒளி தீம்'], 'business-details': ['报价用的企业资料', 'மேற்கோளுக்கான வணிக விவரங்கள்'], 'margin-floor': ['最低利润率', 'குறைந்தபட்ச மார்ஜின்'],
  theme: ['切换深色/浅色主题', 'இருண்ட / ஒளி தீமுக்கு மாறு'], password: ['更改密码', 'கடவுச்சொல்லை மாற்று'], signout: ['退出登录', 'வெளியேறு'],
  'help-center': ['帮助中心', 'உதவி மையம்'], 'take-tour': ['开始导览', 'சுற்றுப்பயணத்தைத் தொடங்கு'],
}
const kw = (en: string, ms: string) => ({ en: en.split('|'), ms: ms.split('|') })
const fn = (id: string, icon: IconName, en: string, ms: string, kEn: string, kMs: string, path: string, href: string, needs?: Fn['needs'], action?: Fn['action']): Fn =>
  ({ id, icon, label: { en, ms, zh: ZT[id]?.[0], ta: ZT[id]?.[1] }, keywords: kw(kEn, kMs), path: path.split('>'), href, needs, action })
const page = (key: string) => (c: Ctx) => canOpen(key, c.owner)
const isOwner = (c: Ctx) => c.owner

export const FUNCTIONS: Fn[] = [
  // ---- every item in NAV (Shell.tsx)
  fn('nav-home', 'home', 'Home', 'Laman utama', 'dashboard|overview|today|start|get started', 'papan pemuka|ringkasan|hari ini|mula', 'Work>Home', '#/home', page('home')),
  fn('nav-tracker', 'tracker', 'Tracker', 'Penjejak', 'quotes|documents|quotations|list|find a quote|inbox', 'sebut harga|dokumen|senarai|cari sebut harga', 'Work>Tracker', '#/tracker', page('tracker')),
  fn('nav-track', 'pipeline', 'Schedule', 'Jadual', 'schedule|calendar|due|pipeline|status|progress|stages|board', 'jadual|kalendar|tarikh|saluran|status|kemajuan|peringkat', 'Work>Schedule', '#/track', page('track')),
  fn('nav-jobs', 'jobs', 'Jobs', 'Kerja', 'orders|accepted|won|delivery|production', 'tempahan|diterima|menang|penghantaran|pengeluaran', 'Work>Jobs', '#/jobs', page('jobs')),
  fn('nav-followups', 'clock', 'Follow-ups', 'Susulan', 'follow up|followup|remind|reminder|chase|overdue|nudge', 'susulan|peringatan|ingatkan|lewat|tuntut', 'Work>Follow-ups', '#/followups', page('followups')),
  fn('nav-contacts', 'contacts', 'Contacts', 'Kenalan', 'suppliers|customers|people|address book|vendors', 'pembekal|pelanggan|orang|buku alamat|vendor', 'Suppliers>Contacts', '#/contacts', page('contacts')),
  fn('nav-ask', 'ask', 'Ask suppliers', 'Tanya pembekal', 'rfq|request price|enquire|photo|find price|source', 'minta harga|tanya harga|pertanyaan|gambar|cari harga', 'Suppliers>Ask suppliers', '#/ask', page('ask')),
  fn('nav-catalog', 'camera', 'Catalog photos', 'Foto katalog', 'product photo|pictures|images|catalogue|camera', 'foto produk|gambar|katalog|kamera', 'Suppliers>Catalog photos', '#/catalog', c => canOpen('catalog', c.owner) && canUpload(c.me)),
  fn('nav-revenue', 'revenue', 'Revenue', 'Hasil', 'revenue|income|profit|money in|money out|gross|net|sales|expenses|rent|wages|bills|untung kasar|untung bersih', 'hasil|pendapatan|untung|untung kasar|untung bersih|jualan|perbelanjaan|sewa|gaji|bil', 'Insight>Revenue', '#/revenue', () => can('view_revenue') && can('view_costs')),
  fn('nav-alerts', 'alerts', 'Stale costs', 'Kos lapuk', 'cost|costs|price rise|outdated|expired price|alerts|margin hurt', 'kos|kenaikan harga|lapuk|tamat tempoh|amaran', 'Insight>Stale costs', '#/alerts', page('alerts')),
  fn('nav-activity', 'activity', 'Audit log', 'Log audit', 'audit|activity|history|who did|changes|events|log', 'audit|aktiviti|sejarah|siapa buat|perubahan|peristiwa|log', 'Audit Log>Audit log', '#/activity', page('activity')),
  fn('nav-assistant', 'assistant', 'Ask Laris', 'Tanya Laris', 'assistant|ask a question|help|chat|chatbot|ai|questions', 'pembantu|tanya soalan|bantuan|sembang|soalan', 'Ask Laris button', '#/assistant', page('assistant')),
  fn('nav-team', 'team', 'Team', 'Pasukan', 'staff|users|members|people|employees|workers', 'pekerja|pengguna|ahli|kakitangan|pasukan', 'Admin>Team', '#/team', page('team')),
  fn('nav-roles', 'roles', 'Roles and permissions', 'Peranan dan kebenaran', 'role|permission|access|rights|who can|custom role', 'peranan|kebenaran|akses|hak|siapa boleh', 'Admin>Roles', '#/roles', page('roles')),
  fn('nav-settings', 'settings', 'Settings', 'Tetapan', 'business|company|preferences|configuration|config|margin floor', 'perniagaan|syarikat|keutamaan|konfigurasi', 'Admin>Settings', '#/settings', page('settings')),
  fn('nav-privacy', 'roles', 'Privacy and data', 'Privasi dan data', 'breach|data breach|incident|dpo|data protection officer|pdpa|privacy|export data|erase|delete customer|personal data|commissioner', 'pelanggaran data|insiden|dpo|pegawai perlindungan data|pdpa|privasi|eksport data|padam|padam pelanggan|data peribadi|pesuruhjaya', 'Admin>Privacy and data', '#/privacy', page('privacy')),
  fn('nav-api-access', 'key', 'API access', 'Akses API', 'api key|api|usage|quota|allowance|integration|developer|token|curl|price api', 'kunci api|api|penggunaan|kuota|had percuma|integrasi|pembangun|token|api harga', 'Admin>API access', '#/api-access', page('api-access')),
  fn('nav-ai-settings', 'ask', 'AI settings', 'Tetapan AI', 'ai|assistant|chatbot|guide|openai|own server|privacy|ai guide', 'ai|pembantu|chatbot|panduan|openai|pelayan sendiri|privasi|panduan ai', 'Admin>AI settings', '#/ai-settings', page('ai-settings')),
  fn('nav-status', 'warn', 'System status', 'Status sistem', 'health|problems|errors|diagnostics|backup|working', 'kesihatan|masalah|ralat|diagnostik|sandaran', 'Admin>System status', '#/status', page('status')),
  fn('nav-licence', 'key', 'Licence', 'Lesen', 'license|subscription|plan|seats|renew|expiry|buy', 'langganan|pelan|tempat duduk|perbaharui|tamat|beli', 'Admin>Licence', '#/licence', c => canOpen('licence', c.owner) && licenceOn()),
  fn('nav-issuer', 'key', 'Issue licences', 'Keluarkan lesen', 'issue license|generate key|licence key|sell', 'keluarkan lesen|jana kunci|kunci lesen|jual', 'Admin>Issue licences', '#/issuer', c => canOpen('issuer', c.owner) && issuerOn()),

  // ---- actions
  fn('invite', 'plus', 'Invite a team member', 'Jemput ahli pasukan', 'invite|add staff|new user|add user|add employee|new staff|email invite|join|onboard', 'jemput|tambah pekerja|pengguna baharu|tambah pengguna|tambah staf|pekerja baru|undang|sertai', 'Admin>Team>Invite', '#/team', isOwner),
  fn('link-telegram-person', 'team', 'Link Telegram for a person', 'Pautkan Telegram untuk seseorang', 'telegram|link telegram|connect staff phone|link account|chat id', 'telegram|pautkan telegram|sambung telefon pekerja|pautkan akaun', 'Admin>Team>Link Telegram', '#/team', isOwner),
  fn('link-telegram-me', 'user', 'Link my Telegram', 'Pautkan Telegram saya', 'telegram|link telegram|connect my phone|my account|chat', 'telegram|pautkan telegram|sambung telefon saya|akaun saya', 'Account>Telegram>Link Telegram', '#/account'),
  fn('customer-bot', 'ask', 'Connect the customer bot', 'Sambung bot pelanggan', 'botfather|bot|telegram token|bot token|channel|connect telegram|customers message', 'botfather|bot|token telegram|token bot|saluran|sambung telegram|pelanggan mesej', 'Admin>Settings>Channels>Your customer bot', '#/settings/channels', isOwner),
  fn('customise-bot', 'settings', 'Customise the bot', 'Ubah suai bot', 'bot name|bot greeting|bot reply|bot settings|helper bot|channels', 'nama bot|ucapan bot|balasan bot|tetapan bot|bot pembantu|saluran', 'Admin>Settings>Channels', '#/settings/channels', isOwner),
  fn('upload-quote', 'upload', 'Upload a supplier quote', 'Muat naik sebut harga pembekal', 'upload|supplier pdf|supplier price|add price|import|scan|attach|cost book', 'muat naik|pdf pembekal|harga pembekal|tambah harga|import|imbas|lampirkan', 'Work>Tracker>Upload quote', '#/tracker/upload', () => can('upload_documents')),
  fn('add-contact', 'contacts', 'Add a contact', 'Tambah kenalan', 'new supplier|new customer|add supplier|add customer|create contact|vendor', 'pembekal baharu|pelanggan baharu|tambah pembekal|tambah pelanggan|cipta kenalan', 'Suppliers>Contacts>Add contact', '#/contacts/new', () => can('manage_contacts')),
  fn('ask-suppliers', 'ask', 'Ask suppliers for a price', 'Minta harga daripada pembekal', 'rfq|request quote|enquire|price request|photograph item|find supplier', 'minta sebut harga|tanya harga|permintaan harga|ambil gambar barang|cari pembekal', 'Suppliers>Ask suppliers', '#/ask', page('ask')),
  fn('catalog-photo', 'camera', 'Send a catalog photo', 'Hantar foto katalog', 'product photo|upload photo|catalogue|picture|add product|catalog', 'foto produk|muat naik foto|katalog|gambar|tambah produk', 'Suppliers>Catalog photos>Upload', '#/catalog', c => canOpen('catalog', c.owner) && canUpload(c.me)),
  fn('needs-review', 'warn', 'Open documents that need review', 'Buka dokumen yang perlu semakan', 'review|flagged|check lines|fix line|needs review|unsure|errors', 'semak|ditanda|semak baris|betulkan baris|perlu semakan|tidak pasti', 'Work>Tracker>Needs review', '#/tracker/review'),
  fn('approve-send', 'check', 'Approve and send a quote', 'Lulus dan hantar sebut harga', 'approve|send quote|accept|reject|decide|sign off|release|email quote', 'lulus|hantar sebut harga|terima|tolak|putuskan|lepaskan|emel sebut harga', 'Work>Tracker>Open quote>Approve>Send', '#/tracker/open', c => c.owner && can('decide_quotes')),
  fn('export-quote', 'upload', 'Export a quote (PDF, XLSX, CSV)', 'Eksport sebut harga (PDF, XLSX, CSV)', 'export pdf|download|excel|xlsx|csv|bom|purchase list|print|save as', 'eksport pdf|muat turun|excel|xlsx|csv|senarai belian|cetak|simpan', 'Work>Tracker>Open quote>Download', '#/tracker', () => can('export_data')),
  fn('activity-log', 'activity', 'View the activity log', 'Lihat log aktiviti', 'audit trail|who changed|history|events|security log', 'jejak audit|siapa ubah|sejarah|peristiwa|log keselamatan', 'Insights>Activity', '#/activity', page('activity')),
  fn('margin-report', 'alerts', 'Margin report', 'Laporan margin', 'margin|profit|cost|costs|markup|report|earnings', 'margin|untung|kos|markup|laporan|pendapatan', 'Suppliers>Stale costs>Margin report', '#/alerts', c => c.owner && can('view_reports') && can('view_costs')),
  fn('branding', 'settings', 'Branding and logo', 'Penjenamaan dan logo', 'logo|brand colour|brand color|company name|business name|letterhead|header', 'logo|warna jenama|nama syarikat|nama perniagaan|kepala surat', 'Admin>Settings>Branding', '#/settings/business', isOwner),
  fn('set-language', 'settings', 'Change the language', 'Tukar bahasa', 'language|english|malay|bahasa|chinese|tamil|translate|switch language', 'bahasa|inggeris|melayu|cina|tamil|terjemah|tukar bahasa', 'Admin>Settings>General>Language', '#/settings/general', isOwner),
  fn('set-theme', 'settings', 'Dark or light theme', 'Tema gelap atau cerah', 'dark mode|dark theme|light mode|appearance|night|colour scheme', 'mod gelap|tema gelap|mod cerah|penampilan|malam', 'Admin>Settings>General>Appearance', '#/settings/general', isOwner),
  fn('business-details', 'settings', 'Business details for quotes', 'Butiran perniagaan untuk sebut harga', 'ssm|sst|tax|address|bank details|company registration|quote pdf', 'ssm|sst|cukai|alamat|butiran bank|pendaftaran syarikat|pdf sebut harga', 'Admin>Settings>Business', '#/settings/business', isOwner),
  fn('margin-floor', 'settings', 'Margin floor', 'Lantai margin', 'minimum margin|thin quotes|profit|flag low margin|margin guard', 'margin minimum|sebut harga nipis|untung|margin rendah', 'Admin>Settings>Quotes>Margin floor', '#/settings/quotes', isOwner),
  fn('theme', 'moon', 'Switch dark / light theme', 'Tukar tema gelap / cerah', 'dark mode|light mode|night|appearance|colours|colors|display', 'mod gelap|mod cerah|malam|rupa|warna|paparan', 'Header>Dark theme', '', undefined, 'theme'),
  fn('password', 'key', 'Change password', 'Tukar kata laluan', 'password|reset password|security|credentials|login', 'kata laluan|tetap semula kata laluan|keselamatan|log masuk', 'Account>Change password', '#/account', c => c.signedIn),
  fn('signout', 'logout', 'Sign out', 'Log keluar', 'log out|logout|exit|leave|switch user', 'log out|keluar|tukar pengguna', 'Account menu>Sign out', '', c => c.signedIn, 'signout'),

  // ---- Help Center (help/articles.ts): the index, one entry per article, and the tour
  fn('help-center', 'ask', 'Help Center', 'Pusat Bantuan', 'help|faq|wiki|how to|guide|steps|manual|support', 'bantuan|faq|wiki|cara|panduan|langkah|manual|sokongan', 'Help', '#/help'),
  ...ARTICLES.map(a => ({ id: 'help-' + a.id, icon: 'ask' as const, label: a.title, keywords: a.keywords, path: ['Help', a.title.en], href: '#/help/' + a.id })),
  fn('take-tour', 'check', 'Take the tour', 'Ikuti lawatan', 'tour|walkthrough|guide|tutorial|onboarding|show me around', 'lawatan|panduan|tutorial|tunjuk', 'Account menu>Take the tour', '', undefined, 'tour'),
]

export const visibleFns = (c: Ctx) => FUNCTIONS.filter(f => f.needs?.(c) ?? true)

// 0 exact, 1 prefix, 2 word prefix, 3 subsequence, -1 no match
const rank = (term: string, q: string) => {
  term = term.toLowerCase()
  if (term === q) return 0
  if (term.startsWith(q)) return 1
  if ((' ' + term).includes(' ' + q)) return 2
  let i = 0
  for (const ch of term) if (ch === q[i] && ++i === q.length) return 3
  return -1
}

// Pure matcher. Searches label + keywords in the current language and the other one (English words work in Malay mode). Ties keep registry order.
export function matchFns(list: Fn[], query: string, lang: Lang): Fn[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const other: Lang = lang === 'en' ? 'ms' : 'en'  // Chinese and Tamil search the English and Malay words
  const scored: { f: Fn; s: number }[] = []
  for (const f of list) {
    let s = 99
    for (const [l, pen] of [[lang, 0], [other, 1]] as const)
      for (const term of [pick(f.label, l), ...pick(f.keywords, l)]) { const r = rank(term, q); if (r >= 0) s = Math.min(s, r * 2 + pen) }
    if (s < 99) scored.push({ f, s })
  }
  return scored.sort((a, b) => a.s - b.s).map(x => x.f)  // Array.sort is stable
}

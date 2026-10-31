import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { getToken } from './api'
import { Icon } from './icons'
import type { IconName } from './icons'
import { t, useLang } from './i18n'
import { SiteFooter, SiteHeader } from './SiteChrome'
import type { NavItem } from './SiteChrome'
import { TradeOrbit } from './TradeOrbit'
import { Journey, JOURNEY_TITLE, P, PriceBuild, Ticker } from './LandingParts'
import type { Text } from './i18n'

// Public homepage for signed-out visitors (#/welcome, and the bare address). Same section order as the CLARION site: hero, flow, tour, modules, audiences, privacy, footer.
// Tamil falls back to English where a string has no `ta`. Nothing here calls the staff API; the status strip reads the public /health only.
const LOOP = {
  h: { en: 'Run the whole trade loop in one place', ms: 'Urus seluruh kitaran perdagangan di satu tempat', zh: '在一个地方管理整个贸易流程', ta: 'முழு வர்த்தகச் சுழற்சியையும் ஓரிடத்தில் நடத்துங்கள்' },
  p: { en: 'Customer, your business and your supplier. Quote, order, deliver, invoice and get paid, with every step recorded and every approval yours.', ms: 'Pelanggan, perniagaan anda dan pembekal anda. Sebut harga, pesan, hantar, invois dan terima bayaran, setiap langkah direkod dan setiap kelulusan milik anda.', zh: '客户、您的企业与供应商。报价、下单、送货、开票、收款，每一步都有记录，每次批准都由您决定。', ta: 'வாடிக்கையாளர், உங்கள் வணிகம், உங்கள் விநியோகஸ்தர். விலைப்புள்ளி, ஆர்டர், விநியோகம், விலைப்பட்டியல், பணம் பெறுதல் — ஒவ்வொரு படியும் பதிவாகும், ஒவ்வொரு அனுமதியும் உங்களுடையது.' },
}
const S = {
  nHow: { en: 'How it works', ms: 'Cara ia berfungsi', zh: '运作方式' },
  nTour: { en: 'Product tour', ms: 'Lawatan produk', zh: '产品导览' },
  nMods: { en: 'Modules', ms: 'Modul', zh: '功能模块' },
  nWho: { en: 'Who it is for', ms: 'Untuk siapa', zh: '适用对象' },
  nPriv: { en: 'Privacy', ms: 'Privasi', zh: '隐私' },
  nPrice: { en: 'Pricing', ms: 'Harga', zh: '价格' },
  signIn: { en: 'Sign in', ms: 'Log masuk', zh: '登录', ta: 'உள்நுழை' },
  create: { en: 'Create a business account', ms: 'Cipta akaun perniagaan', zh: '创建企业账户', ta: 'வணிகக் கணக்கை உருவாக்கு' },
  open: { en: 'Open LARIS', ms: 'Buka LARIS', zh: '打开 LARIS' },
  kicker: { en: 'Customer, business and supplier in one place', ms: 'Pelanggan, perniagaan dan pembekal di satu tempat', zh: '客户、企业与供应商，一站管理', ta: 'வாடிக்கையாளர், வணிகம், விநியோகஸ்தர் ஓரிடத்தில்' },
  h1: { en: 'Quote from the chat you already use. Price it by rules, not guesses.', ms: 'Beri sebut harga dari sembang yang anda sudah guna. Harga ikut peraturan, bukan agakan.', zh: '在您已经在用的聊天里报价。价格由规则决定，而不是凭猜。' },
  lead: { en: 'A customer asks on Telegram, text or voice note. LARIS reads the request, your cost book and margin floor set the price, you approve, and it chases the quotes nobody answered.', ms: 'Pelanggan bertanya di Telegram, melalui teks atau nota suara. LARIS membaca permintaan, buku kos dan lantai margin anda menetapkan harga, anda lulus, dan ia mengejar sebut harga yang tidak dijawab.', zh: '客户在 Telegram 上发文字或语音询价。LARIS 读取需求，由您的成本表和最低利润率定价，您审批，并跟进无人回复的报价。' },
  exTag: { en: 'Example enquiry', ms: 'Contoh pertanyaan', zh: '询价示例' },
  exMsg: { en: '“Boss, 3 pcs 4×2 ft acrylic signboard, white LED, need by Friday.”', ms: '“Boss, 3 keping papan tanda akrilik 4×2 kaki, LED putih, perlu hari Jumaat.”', zh: '“老板，3 块 4×2 尺亚克力招牌，白色 LED，周五要。”' },
  exVoice: { en: '“Boss, nak 2 pcs banner 3×6 kaki, full colour, boleh siap Isnin ah?”', ms: '“Boss, nak 2 pcs banner 3×6 kaki, full colour, boleh siap Isnin ah?”', zh: '“Boss, nak 2 pcs banner 3×6 kaki, full colour, boleh siap Isnin ah?”' },
  exTab: [{ en: 'Text message', ms: 'Mesej teks', zh: '文字消息' }, { en: 'Voice note', ms: 'Nota suara', zh: '语音消息' }] satisfies Text[],
  exReading: { en: 'Reading the request…', ms: 'Membaca permintaan…', zh: '正在读取需求…' },
  exTranscribing: { en: 'Transcribing the voice note…', ms: 'Menyalin nota suara…', zh: '正在转写语音…' },
  exAuto: { en: 'Auto-transcribed', ms: 'Disalin automatik', zh: '自动转写' },
  exLine2: { en: 'Vinyl banner 3×6 ft, full colour', ms: 'Banner vinil 3×6 kaki, warna penuh', zh: '乙烯基横幅 3×6 尺，全彩' },
  exMargin2: { en: 'Margin 41%, above your 25% floor', ms: 'Margin 41%, melebihi lantai 25% anda', zh: '利润率 41%，高于您设定的 25% 下限' },
  exDraft: { en: 'Draft quote', ms: 'Draf sebut harga', zh: '报价草稿' },
  exLine: { en: 'Acrylic signboard, LED', ms: 'Papan tanda akrilik, LED', zh: '亚克力招牌，LED' },
  exMargin: { en: 'Margin 34%, above your 25% floor', ms: 'Margin 34%, melebihi lantai 25% anda', zh: '利润率 34%，高于您设定的 25% 下限' },
  exNote: { en: 'Illustration with made-up numbers, not a real quote.', ms: 'Ilustrasi dengan nombor rekaan, bukan sebut harga sebenar.', zh: '示意图，数字为虚构，并非真实报价。' },
  statusUp: { en: 'Service is up', ms: 'Perkhidmatan aktif', zh: '服务正常' },
  statusDown: { en: 'Service not reachable right now', ms: 'Perkhidmatan tidak dapat dicapai sekarang', zh: '服务暂时无法连接' },
  statusPage: { en: 'Service status page', ms: 'Halaman status perkhidmatan', zh: '服务状态页' },
  statusWait: { en: 'Checking service…', ms: 'Menyemak perkhidmatan…', zh: '正在检查服务…' },
  howH: { en: 'From enquiry to accepted quote in four steps', ms: 'Dari pertanyaan ke sebut harga diterima dalam empat langkah', zh: '从询价到客户接受，四步完成' },
  how: [
    { icon: 'ask', h: { en: 'Customer asks', ms: 'Pelanggan bertanya', zh: '客户询价' }, p: { en: 'Text or a Manglish voice note on Telegram. Items are pulled out as a list.', ms: 'Teks atau nota suara Manglish di Telegram. Item diambil sebagai senarai.', zh: '在 Telegram 发文字或 Manglish 语音，系统整理成清单。' } },
    { icon: 'settings', h: { en: 'Rules price it', ms: 'Peraturan tetapkan harga', zh: '规则定价' }, p: { en: 'Your cost book, supplier tiers and margin floor. No AI output sets a price.', ms: 'Buku kos, tahap pembekal dan lantai margin anda. Tiada output AI menetapkan harga.', zh: '依据您的成本表、供应商阶梯价和最低利润率。AI 不决定价格。' } },
    { icon: 'check', h: { en: 'You approve', ms: 'Anda luluskan', zh: '您审批' }, p: { en: 'Thin margins are flagged. Nothing is sent until you say so.', ms: 'Margin nipis ditandakan. Tiada apa dihantar sehingga anda setuju.', zh: '利润偏低会被标出。您确认前不会发出任何报价。' } },
    { icon: 'tracker', h: { en: 'It tracks and chases', ms: 'Ia jejak dan kejar', zh: '追踪并催办' }, p: { en: 'The customer accepts from a link. Unanswered quotes surface as follow-ups.', ms: 'Pelanggan menerima melalui pautan. Sebut harga tanpa jawapan muncul sebagai tindakan susulan.', zh: '客户通过链接接受。没人回复的报价会列入跟进。' } },
  ] satisfies { icon: IconName; h: Text; p: Text }[],
  tourH: { en: 'See what the owner sees', ms: 'Lihat apa yang pemilik nampak', zh: '看看老板看到的画面' },
  tour: [
    { id: 'quote', tab: { en: 'Quote from chat', ms: 'Sebut harga dari sembang', zh: '聊天报价' }, h: { en: 'The chat becomes a draft you can edit', ms: 'Sembang menjadi draf yang boleh disunting', zh: '聊天变成可编辑的草稿' }, p: { en: 'Each line is matched to your cost book and priced by the rules engine. Export the quote as PDF, XLSX or CSV, or send it with a link the customer can accept.', ms: 'Setiap baris dipadankan dengan buku kos dan dihargakan oleh enjin peraturan. Eksport sebut harga sebagai PDF, XLSX atau CSV, atau hantar pautan yang boleh diterima pelanggan.', zh: '每一行都对应您的成本表，由规则引擎定价。可导出 PDF、XLSX 或 CSV，也可发送客户能直接接受的链接。' }, pts: [{ en: 'Quantity tiers and minimum order quantities', ms: 'Tahap kuantiti dan kuantiti pesanan minimum', zh: '数量阶梯价与最低订购量' }, { en: 'Customer accepts or declines from a link', ms: 'Pelanggan terima atau tolak melalui pautan', zh: '客户通过链接接受或拒绝' }] },
    { id: 'guard', tab: { en: 'Margin guard', ms: 'Pelindung margin', zh: '利润保护' }, h: { en: 'Know when a price moved before you quote', ms: 'Tahu bila harga berubah sebelum memberi sebut harga', zh: '报价前就知道成本变了' }, p: { en: 'Supplier price lists come in by PDF, photo, XLSX, DOCX or CSV. Stale costs and quotes under your margin floor are flagged for review.', ms: 'Senarai harga pembekal masuk melalui PDF, foto, XLSX, DOCX atau CSV. Kos lapuk dan sebut harga di bawah lantai margin ditandakan untuk semakan.', zh: '供应商价目表可用 PDF、照片、XLSX、DOCX 或 CSV 导入。过期成本和低于最低利润率的报价会被标出待审。' }, pts: [{ en: 'Stale-cost alerts', ms: 'Amaran kos lapuk', zh: '过期成本提醒' }, { en: 'Discount guard and margin report', ms: 'Pelindung diskaun dan laporan margin', zh: '折扣保护与利润报告' }] },
    { id: 'track', tab: { en: 'Schedule and chase', ms: 'Jadual dan kejar', zh: '日程催办' }, h: { en: 'No quote goes quiet', ms: 'Tiada sebut harga yang senyap', zh: '没有报价被遗忘' }, p: { en: 'Every quote has a timeline and an age colour. Follow-ups are sorted by longest wait, and accepted quotes become jobs on the board.', ms: 'Setiap sebut harga ada garis masa dan warna umur. Tindakan susulan disusun mengikut tempoh menunggu terlama, dan sebut harga diterima menjadi kerja di papan.', zh: '每张报价都有时间线和账龄颜色。跟进按等待最久排序，已接受的报价会成为看板上的工作。' }, pts: [{ en: 'Fresh, waiting, late and stale at a glance', ms: 'Segar, menunggu, lewat dan basi sekilas pandang', zh: '新鲜、等待、逾期、陈旧一目了然' }, { en: 'Job board from accepted quotes', ms: 'Papan kerja daripada sebut harga diterima', zh: '由已接受报价生成工作看板' }] },
  ] satisfies { id: string; tab: Text; h: Text; p: Text; pts: Text[] }[],
  modsH: { en: 'One system, not five spreadsheets', ms: 'Satu sistem, bukan lima hamparan', zh: '一套系统，取代五份表格' },
  modsHint: { en: 'Pick a module to see what it does. The sample page uses made-up data.', ms: 'Pilih modul untuk lihat fungsinya. Halaman contoh menggunakan data rekaan.', zh: '选择一个模块查看用途。示例页面使用虚构数据。' },
  mods: [
    { id: 'home', n: { en: 'Home', ms: 'Utama', zh: '首页' }, d: { en: 'Speed to quote, quotes this week, margin and what needs you today.', ms: 'Kelajuan sebut harga, sebut harga minggu ini, margin dan perkara yang perlukan anda hari ini.', zh: '报价速度、本周报价、利润率，以及今天需要您处理的事。' } },
    { id: 'tracker', n: { en: 'Tracker', ms: 'Penjejak', zh: '追踪' }, d: { en: 'Every quote by stage, with overdue rules and age colours.', ms: 'Setiap sebut harga mengikut peringkat, dengan peraturan lewat dan warna umur.', zh: '按阶段列出所有报价，含逾期规则和账龄颜色。' } },
    { id: 'jobs', n: { en: 'Jobs', ms: 'Kerja', zh: '工作' }, d: { en: 'A board for work from accepted quotes, or added by hand.', ms: 'Papan untuk kerja daripada sebut harga diterima, atau ditambah manual.', zh: '来自已接受报价或手动新增的工作看板。' } },
    { id: 'contacts', n: { en: 'Contacts', ms: 'Kenalan', zh: '联系人' }, d: { en: 'Customers and suppliers with their quote history.', ms: 'Pelanggan dan pembekal beserta sejarah sebut harga.', zh: '客户与供应商及其报价记录。' } },
    { id: 'camera', n: { en: 'Catalog photos', ms: 'Foto katalog', zh: '目录照片' }, d: { en: 'Photograph a shelf or price board; items arrive for you to check and price.', ms: 'Ambil foto rak atau papan harga; item tiba untuk anda semak dan harga.', zh: '拍下货架或价目板，商品会送来供您核对定价。' } },
    { id: 'alerts', n: { en: 'Follow-ups', ms: 'Tindakan susulan', zh: '跟进' }, d: { en: 'Unanswered quotes, longest wait first. Skip or act in one tap.', ms: 'Sebut harga tanpa jawapan, menunggu terlama dahulu. Langkau atau bertindak sekali ketik.', zh: '未回复的报价，等待最久的排最前。一键跳过或处理。' } },
    { id: 'activity', n: { en: 'Activity log', ms: 'Log aktiviti', zh: '活动记录' }, d: { en: 'Who did what and when, filterable, with CSV or PDF download.', ms: 'Siapa buat apa dan bila, boleh ditapis, dengan muat turun CSV atau PDF.', zh: '谁在何时做了什么，可筛选，可下载 CSV 或 PDF。' } },
    { id: 'team', n: { en: 'Team and roles', ms: 'Pasukan dan peranan', zh: '团队与角色' }, d: { en: 'Invite staff by email and set exactly what each role can open.', ms: 'Jemput staf melalui e-mel dan tetapkan apa yang setiap peranan boleh buka.', zh: '用电邮邀请员工，并精确设定各角色可打开的页面。' } },
    { id: 'assistant', n: { en: 'Ask LARIS', ms: 'Tanya LARIS', zh: '问 LARIS' }, d: { en: 'Looks things up and moves a job only after you confirm. It never prices, approves or sends.', ms: 'Mencari maklumat dan menggerakkan kerja hanya selepas anda sahkan. Ia tidak pernah menetapkan harga, meluluskan atau menghantar.', zh: '帮您查资料，经您确认后才移动工作。它不会定价、审批或发送。' } },
    { id: 'key', n: { en: 'Orbyte connections', ms: 'Sambungan Orbyte', zh: 'Orbyte 连接' }, d: { en: 'A read-only recipe list and price check for Orbyte modules and your own tools, priced by the same rules, without costs or margins.', ms: 'Senarai resipi baca sahaja dan semakan harga untuk modul Orbyte dan alat anda sendiri, dengan peraturan yang sama, tanpa kos atau margin.', zh: '供 Orbyte 模块和您自己的系统使用的只读配方清单与价格查询，使用同一套规则，不含成本与利润率。' } },
  ] satisfies { id: IconName; n: Text; d: Text }[],
  whoH: { en: 'Built for three kinds of people', ms: 'Dibina untuk tiga jenis orang', zh: '为三类人而设计' },
  who: [
    { h: { en: 'Owners', ms: 'Pemilik', zh: '老板' }, pts: [{ en: 'Approve every quote before it goes out', ms: 'Luluskan setiap sebut harga sebelum dihantar', zh: '每张报价发出前都由您审批' }, { en: 'See margin and speed to quote', ms: 'Lihat margin dan kelajuan sebut harga', zh: '查看利润率与报价速度' }, { en: 'Control roles and the activity log', ms: 'Kawal peranan dan log aktiviti', zh: '管理角色与活动记录' }] },
    { h: { en: 'Staff', ms: 'Staf', zh: '员工' }, pts: [{ en: 'Draft quotes from chats', ms: 'Sediakan draf sebut harga dari sembang', zh: '根据聊天起草报价' }, { en: 'Work the follow-up list', ms: 'Uruskan senarai tindakan susulan', zh: '处理跟进清单' }, { en: 'Move jobs across the board', ms: 'Gerakkan kerja merentas papan', zh: '在看板上移动工作' }] },
    { h: { en: 'Customers', ms: 'Pelanggan', zh: '客户' }, pts: [{ en: 'Ask in the chat app they already use', ms: 'Bertanya dalam aplikasi sembang yang sedia ada', zh: '在常用的聊天软件里询价' }, { en: 'Accept or decline from one link, no account', ms: 'Terima atau tolak melalui satu pautan, tanpa akaun', zh: '通过一个链接接受或拒绝，无需账户' }, { en: 'Ask for their data to be exported or erased', ms: 'Minta data mereka dieksport atau dipadam', zh: '可要求导出或删除自己的数据' }] },
  ] satisfies { h: Text; pts: Text[] }[],
  privH: { en: 'Your costs stay yours', ms: 'Kos anda kekal milik anda', zh: '您的成本只属于您' },
  priv: [
    { h: { en: 'Rules set prices, never AI', ms: 'Peraturan tetapkan harga, bukan AI', zh: '价格由规则决定，不是 AI' }, p: { en: 'AI reads the request. A rules engine does the pricing from your cost book.', ms: 'AI membaca permintaan. Enjin peraturan menghargakan daripada buku kos anda.', zh: 'AI 只负责读懂需求，定价由规则引擎依据您的成本表完成。' } },
    { h: { en: 'One business cannot see another', ms: 'Satu perniagaan tidak nampak yang lain', zh: '各企业数据互相隔离' }, p: { en: 'Row-level security in the database separates every business.', ms: 'Keselamatan peringkat baris dalam pangkalan data mengasingkan setiap perniagaan.', zh: '数据库的行级安全将每家企业的数据隔开。' } },
    { h: { en: 'PDPA tools built in', ms: 'Alat PDPA terbina dalam', zh: '内置 PDPA 工具' }, p: { en: 'Consent notice, per-person export and erase, and a breach register with deadline clocks. Not yet reviewed by a lawyer.', ms: 'Notis persetujuan, eksport dan padam setiap individu, serta daftar pelanggaran dengan jam tarikh akhir. Belum disemak peguam.', zh: '同意通知、按个人导出与删除，以及带期限倒计时的泄露登记册。尚未经律师审阅。' } },
    { h: { en: 'Every action is logged', ms: 'Setiap tindakan direkodkan', zh: '每个操作都有记录' }, p: { en: 'An activity log you can filter and download, plus sign-in with sessions and email invites.', ms: 'Log aktiviti yang boleh ditapis dan dimuat turun, serta log masuk dengan sesi dan jemputan e-mel.', zh: '可筛选、可下载的活动记录，另有会话登录与电邮邀请。' } },
  ] satisfies { h: Text; p: Text }[],
  ctaH: { en: 'Ready to quote faster?', ms: 'Sedia untuk beri sebut harga lebih pantas?', zh: '准备好更快报价了吗？' },
}

const SECTIONS = [['journey', P.nJourney], ['how', S.nHow], ['tour', S.nTour], ['modules', S.nMods], ['who', S.nWho], ['privacy', S.nPriv]] as const
const NAV: NavItem[] = [...SECTIONS.map(([id, label]) => ({ id, label, href: '#' + id })), { id: 'pricing', label: S.nPrice, href: '#/pricing' }]

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// The section that crosses the upper third of the screen is the highlighted tab.
function useSpy(): string {
  const [on, setOn] = useState<string>(SECTIONS[0][0])
  useEffect(() => {
    const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && setOn(e.target.id)), { rootMargin: '-25% 0px -65% 0px' })
    SECTIONS.forEach(([id]) => { const el = document.getElementById(id); if (el) io.observe(el) })
    return () => io.disconnect()
  }, [])
  return on
}

function useHealth() {
  const [up, setUp] = useState<boolean>()
  useEffect(() => {
    const c = new AbortController()
    fetch('/health', { signal: c.signal }).then(r => setUp(r.ok), () => { if (!c.signal.aborted) setUp(false) })
    return () => c.abort()
  }, [])
  return up
}


// Two looping examples: a typed message, and a voice note that is transcribed first. Steps advance on a timer; with reduced motion the finished state shows and the tabs switch it.
const LAST = [3, 4]
function Draft({ line, total, margin }: { line: Text; total: string; margin: Text }) {
  return (
    <div className="card shadow-2 page-in p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">{t(S.exDraft)}</p>
        <span className="rounded-ui bg-tint px-2 py-0.5 text-xs font-semibold">RM {total}</span>
      </div>
      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-sm"><dt>{t(line)}</dt><dd className="text-right tabular-nums">RM {total}</dd></dl>
      <p className="mt-3 flex items-center gap-2 text-sm text-muted"><Icon name="check" className="size-4 text-accent" />{t(margin)}</p>
    </div>
  )
}

function EnquiryDemo() {
  const [sc, setSc] = useState(0)
  const [step, setStep] = useState(0)
  const still = useRef(reduced())
  useEffect(() => {
    if (still.current) { setStep(LAST[sc]); return }
    setStep(0)
    let n = 0
    const id = setInterval(() => {
      n++
      if (n > LAST[sc] + 3) { setSc(x => 1 - x); return }  // hold the finished draft for three ticks, then the other example
      setStep(Math.min(n, LAST[sc]))
    }, 1300)
    return () => clearInterval(id)
  }, [sc])
  const voice = sc === 1
  const bubble = 'page-in rounded-card bg-tint p-3 text-sm'
  return (
    <figure className="m-0 grid gap-3" aria-label={t(S.exTag)}>
      <div role="tablist" aria-label={t(S.exTag)} className="flex gap-2">
        {S.exTab.map((x, n) => <button key={n} role="tab" type="button" aria-selected={sc === n} className="btn min-h-9 aria-selected:border-accent aria-selected:bg-tint" onClick={() => setSc(n)}>{t(x)}</button>)}
      </div>
      <div className="card shadow-2 min-h-40 p-4" aria-live="polite">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t(S.exTag)} · Telegram</p>
        {step >= 1 && (voice
          ? <div key="v" className={bubble + ' mt-2 flex items-center gap-3'}>
              <Icon name="assistant" className="size-4 text-accent" />
              <span aria-hidden className="flex h-6 items-center gap-0.5">{[40, 80, 55, 100, 65, 90, 45, 75, 50, 85, 60, 35].map((h, i) => <span key={i} className="w-1 rounded-full bg-accent" style={{ height: h + '%', animation: step < 3 && !still.current ? `pulse-soft 0.9s ease-in-out ${i * 70}ms infinite` : undefined }} />)}</span>
              <span className="text-xs tabular-nums text-muted">0:09</span>
            </div>
          : <p key="m" className={bubble + ' mt-2'}>{t(S.exMsg)}</p>)}
        {voice && step === 2 && <p key="tr" className="page-in mt-2 text-sm text-muted">{t(S.exTranscribing)}</p>}
        {voice && step >= 3 && <p key="tx" className="page-in mt-2 text-sm"><span className="badge mr-2">{t(S.exAuto)}</span>{t(S.exVoice)}</p>}
        {!voice && step === 2 && <p key="rd" className="page-in mt-2 text-sm text-muted">{t(S.exReading)}</p>}
      </div>
      {step >= LAST[sc] && (voice
        ? <Draft key="d1" line={S.exLine2} total="216.00" margin={S.exMargin2} />
        : <Draft key="d0" line={{ en: S.exLine.en + ' × 3', ms: S.exLine.ms + ' × 3', zh: S.exLine.zh + ' × 3' }} total="1,260.00" margin={S.exMargin} />)}
      <figcaption className="text-xs text-muted">{t(S.exNote)}</figcaption>
    </figure>
  )
}

function Tour() {
  const [i, setI] = useState(0)
  const v = S.tour[i]
  // Arrow keys move between tabs (tablist pattern); only the active tab is in the tab order.
  const key = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const n = (i + d + S.tour.length) % S.tour.length
    setI(n); document.getElementById('tour-tab-' + n)?.focus()
  }
  return (
    <div className="mt-6">
      <div role="tablist" aria-label={t(S.nTour)} className="flex flex-wrap gap-2" onKeyDown={key}>
        {S.tour.map((x, n) => (
          <button key={x.id} id={'tour-tab-' + n} role="tab" type="button" aria-selected={i === n} aria-controls="tour-panel" tabIndex={i === n ? 0 : -1}
            className="btn aria-selected:border-accent aria-selected:bg-tint" onClick={() => setI(n)}>{t(x.tab)}</button>
        ))}
      </div>
      <div id="tour-panel" role="tabpanel" aria-labelledby={'tour-tab-' + i} className="card mt-3 grid gap-4 p-6 md:grid-cols-2 md:items-center">
        <div>
          <h3 className="text-lg font-semibold">{t(v.h)}</h3>
          <p className="mt-2 text-muted">{t(v.p)}</p>
        </div>
        <ul className="grid gap-2">
          {v.pts.map(p => <li key={p.en} className="flex items-start gap-2 rounded-ui bg-tint p-3 text-sm"><Icon name="check" className="mt-0.5 size-4 text-accent" />{t(p)}</li>)}
        </ul>
      </div>
    </div>
  )
}


// Sample page per module: made-up rows in the style of the real screen. Plain strings are data (names, amounts); Text values are labels.
type Cell = string | Text
const W = { fresh: { en: 'Fresh', ms: 'Segar', zh: '新鲜' }, wait: { en: 'Waiting', ms: 'Menunggu', zh: '等待中' }, late: { en: 'Late', ms: 'Lewat', zh: '逾期' }, done: { en: 'Accepted', ms: 'Diterima', zh: '已接受' }, draft: { en: 'Draft', ms: 'Draf', zh: '草稿' }, stale: { en: 'Stale', ms: 'Lapuk', zh: '过期' } } satisfies Record<string, Text>
const SAMPLE: Record<string, [Cell, Cell, Text?][]> = {
  home: [[{ en: 'Speed to quote', ms: 'Kelajuan sebut harga', zh: '报价速度' }, '4 min'], [{ en: 'Quotes this week', ms: 'Sebut harga minggu ini', zh: '本周报价' }, '12'], [{ en: 'Average margin', ms: 'Margin purata', zh: '平均利润率' }, '36%'], [{ en: 'Needs you today', ms: 'Perlukan anda hari ini', zh: '今天需要您' }, '3', W.late]],
  tracker: [['Ah Seng Hardware', 'RM 1,260.00', W.fresh], ['Kopitiam Mei Ling', 'RM 480.00', W.wait], ['Taman Desa Clinic', 'RM 2,150.00', W.late], ['Selva Trading', 'RM 790.00', W.done]],
  jobs: [['Acrylic signboard × 3', 'Fri', W.draft], ['Vinyl banner × 2', 'Mon', W.wait], ['Shop-front sticker', 'Wed', W.done]],
  contacts: [['Ah Seng Hardware', '5 quotes'], ['Kopitiam Mei Ling', '2 quotes'], ['Sunrise Acrylic Supply', '8 quotes']],
  camera: [['Acrylic sheet 3 mm', 'RM 38.00'], ['LED strip, white, 5 m', 'RM 21.50'], ['Vinyl roll 1.2 m', 'RM 64.00']],
  alerts: [['Taman Desa Clinic', '9 days', W.stale], ['Kopitiam Mei Ling', '4 days', W.late], ['Selva Trading', '2 days', W.wait]],
  activity: [['Aisyah approved a quote', '10:42'], ['Wei Jie sent a quote', '10:15'], ['Owner changed margin floor', '09:03']],
  team: [['Owner', { en: 'Everything', ms: 'Semua', zh: '全部' }], ['Aisyah', { en: 'Quotes, follow-ups', ms: 'Sebut harga, susulan', zh: '报价、跟进' }], ['Wei Jie', { en: 'Jobs board', ms: 'Papan kerja', zh: '工作看板' }]],
  assistant: [[{ en: 'Which quotes are waiting longest?', ms: 'Sebut harga mana menunggu paling lama?', zh: '哪些报价等得最久？' }, ''], [{ en: 'Taman Desa Clinic, 9 days. Open it?', ms: 'Taman Desa Clinic, 9 hari. Buka?', zh: 'Taman Desa Clinic，9 天。要打开吗？' }, '']],
  key: [['GET /recipes', { en: 'Read only', ms: 'Baca sahaja', zh: '只读' }], ['GET /price-check', { en: 'Read only', ms: 'Baca sahaja', zh: '只读' }], ['Costs and margins', { en: 'Never shared', ms: 'Tidak pernah dikongsi', zh: '从不公开' }]],
}
const cell = (c: Cell) => typeof c === 'string' ? c : t(c)

function Sample({ id }: { id: string }) {
  return (
    <div className="mt-4 overflow-hidden rounded-card border border-hairline" aria-hidden>
      <div className="flex items-center gap-1.5 border-b border-hairline bg-surface-2 px-3 py-2"><span className="size-2 rounded-full bg-line" /><span className="size-2 rounded-full bg-line" /><span className="size-2 rounded-full bg-line" /></div>
      <ul>{(SAMPLE[id] ?? []).map(([a, b, badge], i) => (
        <li key={i} className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-2 text-sm last:border-b-0">
          <span className="truncate">{cell(a)}</span>
          <span className="flex shrink-0 items-center gap-2 tabular-nums text-muted">{cell(b)}{badge && <span className="badge">{t(badge)}</span>}</span>
        </li>
      ))}</ul>
    </div>
  )
}

function Modules() {
  const [sel, setSel] = useState<number>(0)
  const m = S.mods[sel]
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label={t(S.nMods)}>
        {S.mods.map((x, n) => (
          <button key={x.id} type="button" aria-pressed={sel === n} onClick={() => setSel(n)}
            className="btn justify-start gap-2 aria-pressed:border-accent aria-pressed:bg-tint"><Icon name={x.id} className="size-4" />{t(x.n)}</button>
        ))}
      </div>
      <div className="card" aria-live="polite">
        <h3 className="flex items-center gap-2 text-md font-semibold"><Icon name={m.id} className="size-5 text-accent" />{t(m.n)}</h3>
        <p className="mt-2 text-muted">{t(m.d)}</p>
        <Sample id={m.id} />
        <p className="mt-3 text-xs text-muted">{t(S.modsHint)}</p>
      </div>
    </div>
  )
}

export default function Landing({ dark, setDark }: { dark: boolean; setDark: (d: boolean) => void }) {
  const [lang] = useLang()
  const up = useHealth()
  const spy = useSpy()
  const signedIn = !!getToken()
  useEffect(() => { document.title = 'LARIS · ' + t(S.kicker) }, [lang])
  const primary = signedIn
    ? <a className="btn btn-primary min-h-11 px-6" href="#/home">{t(S.open)}</a>
    : <><a className="btn btn-primary min-h-11 px-6" href="#/register">{t(S.create)}</a><a className="btn min-h-11 px-6" href="#/login">{t(S.signIn)}</a></>
  const sec = 'land-reveal mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-12 md:py-16'
  return (
    <div className="min-h-screen">
      <a href="#main" onClick={e => { e.preventDefault(); document.getElementById('main')?.focus() }} className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-ui focus:bg-surface focus:p-3">Skip to content</a>
      <SiteHeader dark={dark} setDark={setDark} items={NAV} active={spy} onNav={id => document.getElementById(id)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' })} />

      <main id="main" tabIndex={-1} className="outline-none">
        <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 md:py-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center" aria-labelledby="hero-h">
          <div>
            <p className="text-sm font-semibold text-accent">{t(S.kicker)}</p>
            <h1 id="hero-h" className="mt-3 text-3xl font-bold leading-tight md:text-5xl md:leading-[1.1]">{t(S.h1)}</h1>
            <p className="mt-5 max-w-xl text-md text-muted">{t(S.lead)}</p>
            <div className="mt-7 flex flex-wrap gap-3">{primary}</div>
            <a href="#/service-status" title={t(S.statusPage)} role="status" className="mt-6 inline-flex items-center gap-2 rounded-ui border border-hairline bg-surface px-3 py-2 text-sm hover:bg-tint">
              <span aria-hidden className={`size-2.5 rounded-full ${up ? 'bg-accent' : up === false ? 'bg-warn' : 'bg-line'}`} />
              {up === undefined ? t(S.statusWait) : up ? t(S.statusUp) : t(S.statusDown)}
            </a>
          </div>
          <EnquiryDemo />
        </section>

        <Ticker />

        <section id="loop" className={sec} aria-labelledby="loop-h">
          <h2 id="loop-h" className="text-2xl font-bold">{t(LOOP.h)}</h2>
          <p className="mt-2 max-w-2xl text-muted">{t(LOOP.p)}</p>
          <div className="glass-lite mt-6 p-4"><TradeOrbit story /></div>
        </section>

        <section id="journey" className={sec} aria-labelledby="journey-h">
          <h2 id="journey-h" className="text-xl font-semibold md:text-2xl">{t(JOURNEY_TITLE)}</h2>
          <Journey />
        </section>

        <section id="how" className={sec} aria-labelledby="how-h">
          <h2 id="how-h" className="text-xl font-semibold md:text-2xl">{t(S.howH)}</h2>
          <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {S.how.map((s, n) => (
              <li key={s.icon} className="card">
                <span className="flex items-center gap-2 text-sm font-semibold text-accent"><Icon name={s.icon} className="size-5" />{n + 1}</span>
                <h3 className="mt-2 font-semibold">{t(s.h)}</h3>
                <p className="mt-1 text-sm text-muted">{t(s.p)}</p>
              </li>
            ))}
          </ol>
          <PriceBuild />
        </section>

        <section id="tour" className={sec} aria-labelledby="tour-h">
          <h2 id="tour-h" className="text-xl font-semibold md:text-2xl">{t(S.tourH)}</h2>
          <Tour />
        </section>

        <section id="modules" className={sec} aria-labelledby="mods-h">
          <h2 id="mods-h" className="text-xl font-semibold md:text-2xl">{t(S.modsH)}</h2>
          <Modules />
        </section>

        <section id="who" className={sec} aria-labelledby="who-h">
          <h2 id="who-h" className="text-xl font-semibold md:text-2xl">{t(S.whoH)}</h2>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {S.who.map(w => (
              <div key={w.h.en} className="card">
                <h3 className="font-semibold">{t(w.h)}</h3>
                <ul className="mt-3 grid gap-2 text-sm text-muted">{w.pts.map(p => <li key={p.en} className="flex items-start gap-2"><Icon name="check" className="mt-0.5 size-4 text-accent" />{t(p)}</li>)}</ul>
              </div>
            ))}
          </div>
        </section>

        <section id="privacy" className={sec} aria-labelledby="priv-h">
          <h2 id="priv-h" className="text-xl font-semibold md:text-2xl">{t(S.privH)}</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {S.priv.map(p => (
              <div key={p.h.en} className="card">
                <h3 className="flex items-center gap-2 font-semibold"><Icon name="roles" className="size-5 text-accent" />{t(p.h)}</h3>
                <p className="mt-2 text-sm text-muted">{t(p.p)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-16" aria-labelledby="cta-h">
          <div className="rounded-tile bg-accent p-8 text-on-accent md:p-12">
            <h2 id="cta-h" className="text-xl font-semibold md:text-2xl">{t(S.ctaH)}</h2>
            <div className="mt-5 flex flex-wrap gap-3">
              {signedIn
                ? <a className="btn min-h-11 px-6" href="#/home">{t(S.open)}</a>
                : <><a className="btn min-h-11 px-6" href="#/register">{t(S.create)}</a><a className="btn btn-quiet min-h-11 px-6 text-on-accent hover:bg-white/15" href="#/login">{t(S.signIn)}</a></>}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter dark={dark} />
    </div>
  )
}

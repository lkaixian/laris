import type { Text } from './i18n'

// One short line per menu item, shown in a small pop-up when you point at it or tab to it.
const h = (en: string, ms: string, zh: string, ta: string): Text => ({ en, ms, zh, ta })
export const NAV_HINTS: Record<string, Text> = {
  home: h('Your day at a glance: what needs you now.', 'Ringkasan hari anda: apa yang perlukan anda sekarang.', '一览今天：现在需要您处理的事。', 'இன்றைய நிலை: இப்போது உங்கள் கவனம் தேவைப்படுபவை.'),
  tracker: h('Every supplier and customer quote, from received to sent.', 'Setiap sebut harga pembekal dan pelanggan, daripada diterima hingga dihantar.', '所有供应商和客户报价，从收到到发出。', 'பெறப்பட்டதிலிருந்து அனுப்பியது வரை அனைத்து மேற்கோள்களும்.'),
  track: h('What is due and what is late, by colour.', 'Apa yang perlu siap dan apa yang lewat, ikut warna.', '按颜色查看到期和逾期事项。', 'எது முடிய வேண்டும், எது தாமதம், நிறத்தால்.'),
  jobs: h('The work board: to do, in progress, done.', 'Papan kerja: akan dibuat, sedang dibuat, siap.', '工作看板：待办、进行中、已完成。', 'வேலைப் பலகை: செய்ய வேண்டியவை, நடப்பவை, முடிந்தவை.'),
  deals: h('Order to cash: PO, order, proforma, delivery, invoice, receipt.', 'Pesanan hingga bayaran: PO, pesanan, proforma, penghantaran, invois, resit.', '从订单到收款：采购单、订单、形式发票、送货单、发票、收据。', 'ஆர்டர் முதல் பணம் வரை: PO, ஆர்டர், புரோஃபார்மா, டெலிவரி, இன்வாய்ஸ், ரசீது.'),
  followups: h('Quotes with no reply yet, and a message to chase them.', 'Sebut harga tanpa balasan, dan mesej untuk menyusul.', '尚无回复的报价，以及催办消息。', 'பதில் வராத மேற்கோள்கள், பின்தொடர ஒரு செய்தி.'),
  contacts: h('Your customers and suppliers in one book.', 'Pelanggan dan pembekal anda dalam satu buku.', '客户和供应商通讯录。', 'வாடிக்கையாளர்கள், சப்ளையர்கள் ஒரே புத்தகத்தில்.'),
  ask: h('Send a photo to suppliers and get a price back.', 'Hantar gambar kepada pembekal dan dapatkan harga.', '把照片发给供应商，获取报价。', 'சப்ளையர்களுக்குப் படம் அனுப்பி விலை பெறுங்கள்.'),
  catalog: h('Turn product photos into priced items to quote from.', 'Tukar gambar produk kepada item berharga untuk disebut harga.', '把产品照片变成可报价的商品。', 'பொருள் படங்களை விலையுள்ள பொருட்களாக மாற்றுங்கள்.'),
  reports: h('A plain-words summary of sales, margin and money owed.', 'Ringkasan mudah jualan, margin dan wang tertunggak.', '销售、利润率和欠款的通俗总结。', 'விற்பனை, இலாபம், நிலுவை பற்றிய எளிய சுருக்கம்.'),
  revenue: h('Money in and out, and the profit you keep, for any period.', 'Wang masuk dan keluar, serta untung yang anda simpan, bagi mana-mana tempoh.', '任意时间段的收入、支出和您留下的利润。', 'எந்தக் காலத்துக்கும் வரும், போகும் பணமும் உங்கள் லாபமும்.'),
  alerts: h('Quotes whose cost has changed since you priced them.', 'Sebut harga yang kosnya berubah sejak dinilai.', '定价后成本已变化的报价。', 'விலை நிர்ணயித்த பிறகு செலவு மாறிய மேற்கோள்கள்.'),
  activity: h('Who did what and when, day by day.', 'Siapa buat apa dan bila, hari demi hari.', '谁在何时做了什么，按天查看。', 'யார் எப்போது என்ன செய்தார், நாள் வாரியாக.'),
  team: h('Add people and link their Telegram.', 'Tambah orang dan pautkan Telegram mereka.', '添加成员并绑定其 Telegram。', 'நபர்களைச் சேர்த்து Telegram இணையுங்கள்.'),
  roles: h('Choose what each role can see and do.', 'Pilih apa yang boleh dilihat dan dibuat setiap peranan.', '设置每个角色可查看和可操作的内容。', 'ஒவ்வொரு பங்கும் பார்க்க, செய்யக்கூடியதைத் தேர்ந்தெடுங்கள்.'),
  settings: h('Business name, logo, quote defaults and channels.', 'Nama perniagaan, logo, lalai sebut harga dan saluran.', '公司名称、标志、报价默认值和渠道。', 'வணிகப் பெயர், லோகோ, மேற்கோள் இயல்புகள், சேனல்கள்.'),
  privacy: h('Customer data rights, consent and the breach register.', 'Hak data pelanggan, persetujuan dan daftar pelanggaran.', '客户数据权利、同意和泄露登记。', 'வாடிக்கையாளர் தரவு உரிமைகள், ஒப்புதல், மீறல் பதிவு.'),
  'api-access': h('Keys that let other software read your prices.', 'Kunci untuk perisian lain membaca harga anda.', '允许其他软件读取价格的密钥。', 'பிற மென்பொருள் உங்கள் விலைகளைப் படிக்க உதவும் விசைகள்.'),
  'ai-settings': h('Choose what the AI may read and see its activity.', 'Pilih apa yang AI boleh baca dan lihat aktivitinya.', '选择 AI 可读取的内容并查看其活动。', 'AI எதைப் படிக்கலாம் என்பதைத் தேர்ந்தெடுத்து செயல்பாட்டைப் பாருங்கள்.'),
  status: h('Is everything connected and working?', 'Adakah semuanya bersambung dan berfungsi?', '所有服务是否已连接并正常运行？', 'எல்லாம் இணைந்து வேலை செய்கிறதா?'),
  licence: h('Your plan, seats and expiry.', 'Pelan, tempat duduk dan tarikh tamat anda.', '您的套餐、席位和到期日。', 'உங்கள் திட்டம், இருக்கைகள், காலாவதி.'),
  issuer: h('Issue licence keys (platform admin only).', 'Keluarkan kunci lesen (pentadbir platform sahaja).', '签发许可证密钥（仅平台管理员）。', 'உரிமச் சாவிகளை வழங்குங்கள் (தளநிர்வாகி மட்டும்).'),
}

import { ARTICLES } from './help/articles'
import { S } from './guideKit'
import type { Guide } from './guideKit'
import { SUPPLIER_GUIDES } from './guides.suppliers'
import { ADMIN_GUIDES } from './guides.admin'

export type { Guide, GuideStep, GuideSample } from './guideKit'

// Step-by-step guides behind every "?" button: what to do on a page and how, one step at a time.
// A step with `target` can point at the part of the page it talks about: an element with data-guide="<target>".
// Pages without their own guide here use the steps of their help article (no pointing).
export const GUIDES: Record<string, Guide> = {
  ...SUPPLIER_GUIDES,
  ...ADMIN_GUIDES,
  home: { title: { en: 'Using Home', ms: 'Menggunakan Utama', zh: '使用首页', ta: 'முகப்பைப் பயன்படுத்துதல்' }, steps: [
    S('The four tiles sum up your business: Work, Suppliers, Insight and Audit Log.', 'Empat jubin meringkaskan perniagaan anda: Kerja, Pembekal, Wawasan dan Log Audit.', '四个区块概括您的业务：工作、供应商、洞察和审计日志。', 'நான்கு கட்டங்கள் உங்கள் வணிகத்தைச் சுருக்குகின்றன: பணி, சப்ளையர்கள், நுண்ணறிவு, தணிக்கைப் பதிவு.', 'home-tiles'),
    S('Work shows each stage of a quote, from enquiry to job, with how many are in each.', 'Kerja menunjukkan setiap peringkat sebut harga, dari pertanyaan hingga kerja, dengan bilangan di setiap peringkat.', '“工作”显示报价从询问到工单的每个阶段及数量。', 'பணி: விசாரணை முதல் வேலை வரை மேற்கோளின் ஒவ்வொரு கட்டமும் எண்ணிக்கையும்.', 'home-work'),
    S('Select any number in a tile to open the list behind it.', 'Pilih mana-mana nombor dalam jubin untuk membuka senarai di sebaliknya.', '点击区块中的任意数字即可打开对应列表。', 'ஒரு கட்டத்தில் உள்ள எண்ணைத் தேர்ந்தெடுத்தால் அதன் பட்டியல் திறக்கும்.', 'home-tiles'),
    S('Use Ask Laris at the bottom right to ask what needs your attention today.', 'Guna Tanya Laris di bawah kanan untuk bertanya apa yang perlu perhatian anda hari ini.', '使用右下角的“问 Laris”询问今天需要处理什么。', 'இன்று எதைக் கவனிக்க வேண்டும் என்று கீழ் வலதுபுறமுள்ள "Laris இடம் கேள்" மூலம் கேளுங்கள்.', 'ask-laris'),
  ] },
  jobs: { title: { en: 'Managing jobs', ms: 'Mengurus kerja', zh: '管理工单', ta: 'வேலைகளை நிர்வகித்தல்' }, steps: [
    S('Each card is a job. Its coloured edge shows how close the due date is: green on track, yellow due soon, orange due today, red overdue.', 'Setiap kad ialah kerja. Tepi berwarna menunjukkan betapa dekat tarikh akhir: hijau terkawal, kuning hampir, oren hari ini, merah lewat.', '每张卡片是一个工单。彩色边缘表示截止日期的远近：绿色正常，黄色将到期，橙色今天到期，红色已逾期。', 'ஒவ்வொரு அட்டையும் ஒரு வேலை. நிறக் கோடு கடைசி தேதியின் நெருக்கத்தைக் காட்டும்: பச்சை சரியான நேரம், மஞ்சள் விரைவில், ஆரஞ்சு இன்று, சிவப்பு தாமதம்.', 'jobs-legend'),
    S('To add work that did not come from a quote, select New job, type a title and select Create job.', 'Untuk menambah kerja yang bukan daripada sebut harga, pilih Kerja baharu, taip tajuk dan pilih Cipta kerja.', '要添加不是来自报价的工作，点击“新建工单”，填写标题后点击“建立工单”。', 'மேற்கோளிலிருந்து வராத வேலையைச் சேர்க்க "புதிய வேலை" தேர்ந்து, தலைப்பு எழுதி "வேலையை உருவாக்கு" அழுத்தவும்.', 'jobs-new'),
    S('When work starts, select Move to In progress on the card. When it is delivered, select Move to Done.', 'Apabila kerja bermula, pilih Alih ke Sedang dibuat pada kad. Apabila siap dihantar, pilih Alih ke Selesai.', '开工时在卡片上点击“移至进行中”；交付后点击“移至已完成”。', 'வேலை தொடங்கியதும் அட்டையில் "நடைபெறுகிறது க்கு நகர்த்து"; முடிந்ததும் "முடிந்தது க்கு நகர்த்து".', 'jobs-board'),
    S('Select Edit on a card to set the due date, who does it, the priority and notes, then save.', 'Pilih Sunting pada kad untuk tetapkan tarikh akhir, siapa yang buat, keutamaan dan nota, kemudian simpan.', '点击卡片上的“编辑”设置截止日期、负责人、优先级和备注，然后保存。', 'அட்டையில் "திருத்து" தேர்ந்து கடைசி தேதி, பொறுப்பாளர், முன்னுரிமை, குறிப்புகளை அமைத்துச் சேமிக்கவும்.', 'jobs-board'),
    S('Use Mine, Overdue and Status to narrow the board, or Agenda to see the week by day.', 'Guna Milik saya, Lewat tempoh dan Status untuk menapis papan, atau Agenda untuk melihat minggu mengikut hari.', '用“我的”“逾期”“状态”筛选看板，或用“日程”按天查看本周。', '"என்னுடையவை", "காலம் கடந்தது", "நிலை" மூலம் பலகையைச் சுருக்கலாம்; வாரத்தை நாள்வாரியாகப் பார்க்க "நிகழ்ச்சி நிரல்".', 'jobs-filters'),
  ] },
  followups: { title: { en: 'Chasing quotes', ms: 'Menyusul sebut harga', zh: '跟进报价', ta: 'மேற்கோள்களைப் பின்தொடர்தல்' }, steps: [
    S('Each card is a sent quote with no answer yet. The colour shows how long the customer has been silent.', 'Setiap kad ialah sebut harga yang dihantar tetapi belum dijawab. Warna menunjukkan berapa lama pelanggan senyap.', '每张卡片是已发送但未回复的报价。颜色表示客户沉默了多久。', 'ஒவ்வொரு அட்டையும் பதில் வராத அனுப்பிய மேற்கோள். நிறம் வாடிக்கையாளர் எவ்வளவு காலம் பதிலளிக்கவில்லை என்பதைக் காட்டும்.', 'fu-legend'),
    S('Select Stale to see the oldest first, or another colour to see one group only.', 'Pilih Terbiar untuk melihat yang paling lama, atau warna lain untuk satu kumpulan sahaja.', '点击“积压”先看最久的，或选其他颜色只看一组。', 'பழையதை முதலில் பார்க்க "நீண்ட தாமதம்" தேர்ந்தெடுக்கவும்; ஒரு குழுவை மட்டும் பார்க்க மற்ற நிறத்தை.', 'fu-bands'),
    S('Read the suggested message on the card. Select the quote number to check the quote first.', 'Baca mesej cadangan pada kad. Pilih nombor sebut harga untuk menyemak sebut harga dahulu.', '阅读卡片上的建议消息。可先点击报价编号查看报价。', 'அட்டையிலுள்ள பரிந்துரைச் செய்தியைப் படிக்கவும். மேற்கோளைச் சரிபார்க்க அதன் எண்ணைத் தேர்ந்தெடுக்கவும்.', 'fu-card'),
    S('Select Send follow-up to send it on the customer\'s chat, or Skip if you already called them.', 'Pilih Hantar susulan untuk menghantar di sembang pelanggan, atau Langkau jika sudah menelefon.', '点击“发送跟进”通过客户的聊天发送，若已致电则点击“跳过”。', 'வாடிக்கையாளர் அரட்டையில் அனுப்ப "பின்தொடர்வை அனுப்பு"; ஏற்கனவே அழைத்திருந்தால் "தவிர்".', 'fu-card'),
  ] },
  track: { title: { en: 'Seeing what is late', ms: 'Melihat apa yang lewat', zh: '查看延误事项', ta: 'தாமதமானவற்றைப் பார்த்தல்' }, steps: [
    S('Pick what to look at: all items, quotes, supplier documents, asks or catalog items.', 'Pilih apa yang hendak dilihat: semua, sebut harga, dokumen pembekal, pertanyaan atau item katalog.', '选择要查看的类型：全部、报价、供应商文件、询价或目录项目。', 'எதைப் பார்ப்பது என்று தேர்ந்தெடுக்கவும்: அனைத்தும், மேற்கோள்கள், சப்ளையர் ஆவணங்கள், கேள்விகள், பட்டியல்.', 'tr-kind'),
    S('Select Overdue to see only late items. Each one says why it is late.', 'Pilih Lewat tempoh untuk melihat item lewat sahaja. Setiap satu menyatakan sebabnya.', '点击“逾期”只看延误项，每项都会说明原因。', 'தாமதமானவற்றை மட்டும் பார்க்க "காலம் கடந்தது". ஒவ்வொன்றும் காரணத்தைச் சொல்லும்.', 'tr-filters'),
    S('Use Age to pick a colour band, for example Stale for 8 days or more.', 'Guna Umur untuk memilih jalur warna, contohnya Terbiar untuk 8 hari atau lebih.', '用“时长”选择颜色区间，例如“积压”表示 8 天或以上。', 'ஒரு நிறக் குழுவைத் தேர்ந்தெடுக்க "காலம்", உதாரணமாக 8 நாட்கள் அல்லது அதற்கு மேல்.', 'tr-filters'),
    S('Select a reference to open it and act on it.', 'Pilih rujukan untuk membukanya dan bertindak.', '点击编号打开并处理。', 'குறிப்பு எண்ணைத் தேர்ந்தெடுத்துத் திறந்து செயல்படவும்.', 'tr-list'),
  ] },
  customers: { title: { en: 'From order to receipt', ms: 'Daripada pesanan hingga resit', zh: '从订单到收据', ta: 'ஆர்டர் முதல் ரசீது வரை' }, steps: [
    S('Six steps, left to right: purchase order, sales order, proforma, delivery order, invoice, receipt. The big number is how many documents are at that step; red says how many need you.', 'Enam langkah, kiri ke kanan: pesanan belian, pesanan jualan, proforma, pesanan penghantaran, invois, resit. Nombor besar ialah bilangan dokumen pada langkah itu; merah menunjukkan berapa yang perlukan anda.', '从左到右六个步骤：采购订单、销售订单、形式发票、送货单、发票、收据。大数字是该步骤的文件数，红色表示有几份需要你处理。', 'இடமிருந்து வலமாக ஆறு படிகள்: கொள்முதல் ஆணை, விற்பனை ஆணை, புரோஃபார்மா, டெலிவரி ஆணை, இன்வாய்ஸ், ரசீது. பெரிய எண் அந்தப் படியில் உள்ள ஆவணங்கள்; சிவப்பு உங்கள் கவனம் தேவைப்படுபவை.', 'customers-flow'),
    S('Select a step to see its documents. Get file gives you the document to print or send; LARIS never sends anything by itself.', 'Pilih satu langkah untuk melihat dokumennya. Dapatkan fail memberi dokumen untuk dicetak atau dihantar; LARIS tidak menghantar apa-apa sendiri.', '选择一个步骤查看其文件。点“获取文件”得到可打印或发送的文件；LARIS 不会自动发送任何东西。', 'ஒரு படியைத் தேர்ந்தெடுத்து ஆவணங்களைக் காண்க. கோப்பைப் பெறு என்பது அச்சிட அல்லது அனுப்ப ஆவணத்தைத் தரும்; LARIS தானாக எதையும் அனுப்பாது.', 'customers-docs'),
    S('This line says whose layout the file uses. With no template LARIS uses its standard layout. Already have your own paper in Word? Upload it in Admin > Document templates.', 'Baris ini menyatakan reka letak yang digunakan. Tanpa templat, LARIS guna reka letak standard. Sudah ada kertas anda dalam Word? Muat naik di Admin > Templat dokumen.', '这一行说明文件使用谁的版式。没有模板时 LARIS 使用标准版式。已有 Word 版的自家表单？到“管理 > 文件模板”上传。', 'கோப்பு யாருடைய அமைப்பைப் பயன்படுத்துகிறது என்பதை இந்த வரி சொல்லும். வார்ப்புரு இல்லையெனில் LARIS நிலையான அமைப்பைப் பயன்படுத்தும். Word-ல் உங்கள் தாள் உள்ளதா? நிர்வாகம் > ஆவண வார்ப்புருக்களில் பதிவேற்றுங்கள்.', 'customers-template'),
    S('Proforma, delivery order, invoice and receipt are made on the order page, one click each. Open order takes you there. LARIS only records payments. It never takes money.', 'Proforma, pesanan penghantaran, invois dan resit dibuat pada halaman pesanan, satu klik setiap satu. Buka pesanan membawa anda ke sana. LARIS hanya merekod bayaran. Ia tidak mengambil wang.', '形式发票、送货单、发票和收据都在订单页面一键生成。点“打开订单”即可前往。LARIS 只记录付款，不经手资金。', 'புரோஃபார்மா, டெலிவரி ஆணை, இன்வாய்ஸ், ரசீது ஆகியவை ஆர்டர் பக்கத்தில் ஒரே கிளிக்கில் உருவாகும். ஆர்டரைத் திற என்பது அங்கே அழைத்துச் செல்லும். LARIS கட்டணங்களைப் பதிவு மட்டுமே செய்யும்; பணத்தை எடுக்காது.'),
  ] },
  catalog: { title: { en: 'Catalog photos', ms: 'Foto katalog', zh: '目录照片', ta: 'பட்டியல் படங்கள்' }, steps: [
    S('Select Upload photo and choose one photo of a shelf or price board with labels facing the camera.', 'Pilih Muat naik foto dan pilih satu foto rak atau papan harga dengan label menghadap kamera.', '点击“上传照片”，选一张标签朝向镜头的货架或价目板照片。', '"படம் பதிவேற்று" தேர்ந்து, லேபிள்கள் கேமராவை நோக்கிய அலமாரி அல்லது விலைப் பலகைப் படத்தைத் தேர்ந்தெடுக்கவும்.', 'cat-upload'),
    S('Wait while LARIS reads it. Each product becomes a card for you to check.', 'Tunggu semasa LARIS membacanya. Setiap produk menjadi kad untuk anda semak.', '等待 LARIS 读取，每个产品会变成一张待检查的卡片。', 'LARIS படிக்கும் வரை காத்திருக்கவும். ஒவ்வொரு பொருளும் சரிபார்க்க ஒரு அட்டையாகும்.', 'cat-list'),
    S('Select View beside a date to see that photo and its products at a glance.', 'Pilih Lihat di sebelah tarikh untuk melihat foto itu dan produknya sepintas lalu.', '点击日期旁的“查看”，一眼看到该照片及其产品。', 'ஒரு தேதிக்கு அருகிலுள்ள "பார்" மூலம் அந்தப் படத்தையும் பொருட்களையும் ஒரே பார்வையில் காணலாம்.', 'cat-view'),
    S('Open the photo, check each product against its crop, fix anything wrong, then select Confirm.', 'Buka foto, semak setiap produk dengan potongannya, betulkan yang salah, kemudian pilih Sahkan.', '打开照片，对照裁剪图检查每个产品，改正错误后点击“确认”。', 'படத்தைத் திறந்து, ஒவ்வொரு பொருளையும் அதன் வெட்டுப் படத்துடன் சரிபார்த்து, தவறுகளைத் திருத்தி "உறுதிசெய்" அழுத்தவும்.', 'cat-list'),
  ] },
  activity: { title: { en: 'Reading the audit log', ms: 'Membaca log audit', zh: '查看审计日志', ta: 'தணிக்கைப் பதிவைப் படித்தல்' }, steps: [
    S('The log is grouped by day. Each day shows how many things happened.', 'Log dikumpulkan mengikut hari. Setiap hari menunjukkan berapa banyak perkara berlaku.', '日志按天分组，每天显示发生了多少事。', 'பதிவு நாள்வாரியாகப் பிரிக்கப்பட்டுள்ளது. ஒவ்வொரு நாளும் எத்தனை நிகழ்வுகள் என்று காட்டும்.', 'act-days'),
    S('Select a day to see everything that happened that day.', 'Pilih satu hari untuk melihat semua yang berlaku pada hari itu.', '点击某一天，查看当天的所有记录。', 'அந்த நாளில் நடந்த அனைத்தையும் பார்க்க ஒரு நாளைத் தேர்ந்தெடுக்கவும்.', 'act-days'),
    S('Select an entry to see its details: who did it, when, and what changed.', 'Pilih satu entri untuk melihat butiran: siapa, bila dan apa yang berubah.', '点击一条记录查看详情：谁、何时、改了什么。', 'ஒரு பதிவைத் தேர்ந்தெடுத்து விவரங்களைக் காணவும்: யார், எப்போது, என்ன மாறியது.', 'act-days'),
    S('Use Filters to narrow by person, module, action or words. To keep a copy, tick entries and download them as CSV or PDF.', 'Guna Penapis untuk menapis mengikut orang, modul, tindakan atau perkataan. Untuk simpan salinan, tanda entri dan muat turun sebagai CSV atau PDF.', '用“筛选”按人员、模块、操作或文字缩小范围。要保存副本，勾选记录并下载为 CSV 或 PDF。', 'நபர், பகுதி, செயல் அல்லது சொற்களால் சுருக்க "வடிகட்டிகள்". நகல் வேண்டுமெனில் பதிவுகளைத் தேர்ந்து CSV அல்லது PDF ஆகப் பதிவிறக்கவும்.', 'act-filters'),
  ] },
}

// Pages with a "?" guide: their own guide, else the steps of the help article for that sidebar item.
export function guideFor(navKey: string): Guide | null {
  if (GUIDES[navKey]) return GUIDES[navKey]
  const a = ARTICLES.find(x => x.navKeys.includes(navKey))
  if (!a) return null
  const steps = a.body.flatMap(b => ('steps' in b ? b.steps : [])).map(text => ({ text }))
  return steps.length ? { title: a.title, steps } : null
}

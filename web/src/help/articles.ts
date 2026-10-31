import type { Text } from '../i18n'

/*
  Help Center content. One flat wiki: every article is open to everyone, `who` is only a small tag.
  Every article describes something LARIS really does; check the page or docs/ before adding one.
  `path` uses the real English labels from NAV (Shell.tsx). `navKeys` puts a "?" next to that sidebar item
  (the first article listed for a key wins). No em dash characters anywhere.
*/
export type Block = { p: Text } | { steps: Text[] } | { note: Text }
export interface Article {
  id: string; title: Text; summary: Text; who: ('owner' | 'staff')[]; path: string[]
  body: Block[]; related: string[]; keywords: { en: string[]; ms: string[]; zh: string[]; ta: string[] }; navKeys: string[]
}

const T = (en: string, ms: string, zh: string, ta: string): Text => ({ en, ms, zh, ta })
const p = (...a: [string, string, string, string]): Block => ({ p: T(...a) })
const note = (...a: [string, string, string, string]): Block => ({ note: T(...a) })
const steps = (...s: [string, string, string, string][]): Block => ({ steps: s.map(a => T(...a)) })
const kw = (en: string, ms: string, zh: string, ta: string) => ({ en: en.split('|'), ms: ms.split('|'), zh: zh.split('|'), ta: ta.split('|') })

export const ARTICLES: Article[] = [
  {
    id: 'approve-send-export-quote',
    title: T('Approve, send and export a quote', 'Lulus, hantar dan eksport sebut harga', '批准、发送和导出报价单', 'மேற்கோளை அங்கீகரி, அனுப்பு, ஏற்றுமதி செய்'),
    summary: T('Only the owner approves and sends. Anyone with access can download the files.', 'Hanya pemilik yang meluluskan dan menghantar. Fail boleh dimuat turun oleh yang ada akses.', '只有负责人可以批准和发送。有权限的人都可以下载文件。', 'உரிமையாளர் மட்டுமே அங்கீகரிக்கவும் அனுப்பவும் முடியும். அணுகல் உள்ள எவரும் கோப்புகளைப் பதிவிறக்கலாம்.'),
    who: ['owner', 'staff'], path: ['Work', 'Tracker', 'Open a quote'],
    body: [
      steps(
        ['Open the quote from Tracker. A new customer quote starts as a draft.', 'Buka sebut harga dari Penjejak. Sebut harga pelanggan baharu bermula sebagai draf.', '从 Tracker 打开报价单。新的客户报价单一开始是草稿。', 'Tracker இலிருந்து மேற்கோளைத் திறக்கவும். புதிய வாடிக்கையாளர் மேற்கோள் வரைவாகத் தொடங்கும்.'],
        ['In the Decision box, press Approve quote. You can type a reason first; it is saved to the activity log.', 'Dalam kotak Decision, tekan Approve quote. Anda boleh taip sebab dahulu; ia disimpan dalam log aktiviti.', '在 Decision 框中，点击 Approve quote。您可以先输入原因，它会保存到活动记录中。', 'Decision பெட்டியில் Approve quote ஐ அழுத்தவும். முதலில் காரணத்தை உள்ளிடலாம்; அது செயல்பாட்டுப் பதிவில் சேமிக்கப்படும்.'],
        ['Press Send quote to customer, or use Send quote in the Quote document section, then confirm.', 'Tekan Send quote to customer, atau guna Send quote dalam bahagian Quote document, kemudian sahkan.', '点击 Send quote to customer，或使用 Quote document 部分中的 Send quote，然后确认。', 'Send quote to customer ஐ அழுத்தவும், அல்லது Quote document பகுதியில் Send quote ஐப் பயன்படுத்தி, பின்னர் உறுதிப்படுத்தவும்.'],
        ['When the customer answers, press Record customer accepted or Record customer rejected.', 'Apabila pelanggan menjawab, tekan Record customer accepted atau Record customer rejected.', '客户回复后，点击 Record customer accepted 或 Record customer rejected。', 'வாடிக்கையாளர் பதிலளித்ததும் Record customer accepted அல்லது Record customer rejected ஐ அழுத்தவும்.'],
      ),
      p('To download, press Export in the Quote document section and pick PDF, Excel (.xlsx) or CSV under Customer files. Open PDF in a new tab shows the PDF without saving it.', 'Untuk memuat turun, tekan Export dalam bahagian Quote document dan pilih PDF, Excel (.xlsx) atau CSV di bawah Customer files. Open PDF in a new tab memaparkan PDF tanpa menyimpannya.', '要下载，请在 Quote document 部分点击 Export，并在 Customer files 下选择 PDF、Excel (.xlsx) 或 CSV。Open PDF in a new tab 会在新标签页中显示 PDF，而不保存它。', 'பதிவிறக்க, Quote document பகுதியில் Export ஐ அழுத்தி, Customer files இன் கீழ் PDF, Excel (.xlsx) அல்லது CSV ஐத் தேர்ந்தெடுக்கவும். Open PDF in a new tab PDF ஐச் சேமிக்காமல் காட்டும்.'),
      note('Internal files (with cost and margin) are listed only for people who may export data and see costs, normally the owner. Do not send them to customers.', 'Fail Internal (dengan kos dan margin) hanya muncul untuk mereka yang boleh eksport data dan melihat kos, biasanya pemilik. Jangan hantar kepada pelanggan.', 'Internal 文件（含成本和利润率）只会显示给可导出数据并可查看成本的人，通常是负责人。请勿发送给客户。', 'Internal கோப்புகள் (செலவு மற்றும் இலாப விகிதத்துடன்) தரவை ஏற்றுமதி செய்யவும் செலவுகளைப் பார்க்கவும் அனுமதி உள்ளவர்களுக்கு, பொதுவாக உரிமையாளருக்கு மட்டுமே பட்டியலிடப்படும். அவற்றை வாடிக்கையாளர்களுக்கு அனுப்பாதீர்கள்.'),
      note('A quote cannot be sent without the owner approving it first. Staff see the buttons greyed out.', 'Sebut harga tidak boleh dihantar tanpa kelulusan pemilik. Butang kelihatan kelabu untuk staf.', '未经负责人批准，报价单不能发送。员工看到的按钮是灰色的。', 'உரிமையாளர் முதலில் அங்கீகரிக்காமல் மேற்கோளை அனுப்ப முடியாது. ஊழியர்களுக்குப் பொத்தான்கள் சாம்பல் நிறத்தில் தெரியும்.'),
    ],
    related: ['how-a-quote-is-priced', 'follow-ups-and-tracker', 'jobs-board'],
    keywords: kw('approve|send quote|export|pdf|excel|xlsx|csv|download|accept|reject|draft', 'lulus|hantar sebut harga|eksport|pdf|excel|csv|muat turun|terima|tolak|draf', '批准|发送报价|导出|pdf|excel|csv|下载|接受|拒绝|草稿', 'அங்கீகரி|மேற்கோள் அனுப்பு|ஏற்றுமதி|pdf|excel|csv|பதிவிறக்கம்|ஏற்பு|நிராகரி|வரைவு'),
    navKeys: ['tracker'],
  },
  {
    id: 'how-a-quote-is-priced',
    title: T('How a quote is priced', 'Bagaimana harga sebut harga ditetapkan', '报价单如何定价', 'மேற்கோள் விலை எவ்வாறு நிர்ணயிக்கப்படுகிறது'),
    summary: T('Rules and your cost book set the price. The AI never does.', 'Peraturan dan buku kos anda menetapkan harga. AI tidak pernah menetapkannya.', '由规则和您的成本册决定价格，AI 从不定价。', 'விதிகளும் உங்கள் செலவுப் புத்தகமும் விலையை நிர்ணயிக்கும். AI ஒருபோதும் நிர்ணயிக்காது.'),
    who: ['owner', 'staff'], path: ['Work', 'Tracker'],
    body: [
      p('When a customer sends an enquiry (text, voice note or photo), the AI only reads which items and how many. It never sets a price. LARIS then prices the quote with fixed rules, using the supplier costs in your cost book plus your markup.', 'Apabila pelanggan menghantar pertanyaan (teks, nota suara atau gambar), AI hanya membaca item dan kuantiti. Ia tidak pernah menetapkan harga. LARIS kemudian menetapkan harga dengan peraturan tetap, menggunakan kos pembekal dalam buku kos anda serta markup anda.', '客户发送询价（文字、语音留言或照片）时，AI 只读取项目和数量，从不定价。然后 LARIS 按固定规则定价，使用您成本册中的供应商成本再加上您的加价。', 'வாடிக்கையாளர் விசாரணையை (உரை, குரல் குறிப்பு அல்லது புகைப்படம்) அனுப்பும்போது, AI எந்தப் பொருட்கள், எத்தனை என்பதை மட்டுமே படிக்கும். அது ஒருபோதும் விலை நிர்ணயிக்காது. பின்னர் LARIS உங்கள் செலவுப் புத்தகத்தில் உள்ள சப்ளையர் செலவுகளோடு உங்கள் மார்க்அப்பைச் சேர்த்து நிலையான விதிகளால் விலை நிர்ணயிக்கும்.'),
      p('The margin guard compares the result with your margin floor. A quote below it is flagged for review instead of going out quietly.', 'Margin guard membandingkan hasilnya dengan margin minimum anda. Sebut harga di bawahnya ditanda untuk semakan dan tidak keluar begitu sahaja.', 'Margin guard 会将结果与您的最低利润率比较。低于该值的报价单会被标记待审核，不会悄悄发出。', 'Margin guard முடிவை உங்கள் குறைந்தபட்ச இலாப விகிதத்துடன் ஒப்பிடும். அதற்குக் கீழே உள்ள மேற்கோள் அமைதியாக வெளியே செல்லாமல் மதிப்பாய்வுக்காகக் குறிக்கப்படும்.'),
      steps(
        ['To change the floor: Admin, Settings, Margin floor (%). Margin is profit as a share of the selling price.', 'Untuk menukar had: Admin, Settings, Margin floor (%). Margin ialah untung sebagai bahagian daripada harga jualan.', '要更改下限：Admin、Settings、Margin floor (%)。利润率是利润占售价的比例。', 'குறைந்தபட்சத்தை மாற்ற: Admin, Settings, Margin floor (%). இலாப விகிதம் என்பது விற்பனை விலையில் இலாபத்தின் பங்கு.'],
        ['To feed the cost book: upload a supplier quote under Tracker, then the owner approves it and presses Add prices to cost book.', 'Untuk mengisi buku kos: muat naik sebut harga pembekal di Penjejak, kemudian pemilik meluluskannya dan menekan Add prices to cost book.', '要充实成本册：在 Tracker 下上传供应商报价，然后由负责人批准并点击 Add prices to cost book。', 'செலவுப் புத்தகத்தை நிரப்ப: Tracker இல் சப்ளையர் மேற்கோளைப் பதிவேற்றவும், பின்னர் உரிமையாளர் அங்கீகரித்து Add prices to cost book ஐ அழுத்துவார்.'],
      ),
      note('Staff cannot edit a price that the rules produced. Only the owner can override one.', 'Staf tidak boleh mengubah harga yang dihasilkan peraturan. Hanya pemilik boleh mengatasinya.', '员工不能修改由规则产生的价格，只有负责人可以覆盖。', 'விதிகள் உருவாக்கிய விலையை ஊழியர்கள் திருத்த முடியாது. உரிமையாளர் மட்டுமே மேலெழுத முடியும்.'),
    ],
    related: ['approve-send-export-quote', 'stale-costs', 'roles-and-hidden-costs'],
    keywords: kw('price|pricing|markup|margin|cost book|margin guard|ai|rules|floor', 'harga|markup|margin|buku kos|peraturan|had margin|ai', '价格|定价|加价|利润率|成本册|margin guard|ai|规则|下限', 'விலை|விலை நிர்ணயம்|மார்க்அப்|இலாப விகிதம்|செலவுப் புத்தகம்|margin guard|ai|விதிகள்|குறைந்தபட்சம்'),
    navKeys: [],
  },
  {
    id: 'connect-customer-bot',
    title: T('Connect your customer bot on Telegram', 'Sambung bot pelanggan anda di Telegram', '在 Telegram 连接您的客户机器人', 'உங்கள் வாடிக்கையாளர் போட்டை Telegram இல் இணைக்கவும்'),
    summary: T('Create a bot with your shop name in one tap, or paste a BotFather token.', 'Cipta bot dengan nama kedai anda dengan satu ketikan, atau tampal token BotFather.', '一键以您的店名创建机器人，或粘贴 BotFather 令牌。', 'ஒரே தட்டலில் உங்கள் கடை பெயருடன் போட்டை உருவாக்கவும், அல்லது BotFather டோக்கனை ஒட்டவும்.'),
    who: ['owner'], path: ['Admin', 'Settings', 'Channels', 'Your customer bot'],
    body: [
      steps(
        ['Open Settings and find the Your customer bot card.', 'Buka Settings dan cari kad Your customer bot.', '打开 Settings，找到 Your customer bot 卡片。', 'Settings ஐத் திறந்து Your customer bot அட்டையைக் கண்டறியவும்.'],
        ['Press Create my bot in Telegram. Telegram shows a confirmation screen with a name already filled in. Tap Create, then come back. LARIS checks every few seconds for up to 2 minutes.', 'Tekan Create my bot in Telegram. Telegram memaparkan skrin pengesahan dengan nama yang telah diisi. Ketik Create, kemudian kembali. LARIS menyemak setiap beberapa saat sehingga 2 minit.', '点击 Create my bot in Telegram。Telegram 会显示已填好名称的确认画面。点击 Create，然后返回。LARIS 会每隔几秒检查一次，最多 2 分钟。', 'Create my bot in Telegram ஐ அழுத்தவும். Telegram பெயர் ஏற்கனவே நிரப்பப்பட்ட உறுதிப்படுத்தும் திரையைக் காட்டும். Create ஐத் தட்டி, திரும்பி வாருங்கள். LARIS சில விநாடிகளுக்கு ஒருமுறை, 2 நிமிடங்கள் வரை சரிபார்க்கும்.'],
        ['Prefer to do it yourself? Open Create it myself instead, message BotFather, send /newbot, copy the token it gives you, paste it into Bot token and press Connect bot.', 'Mahu buat sendiri? Buka Create it myself instead, mesej BotFather, hantar /newbot, salin token yang diberi, tampal dalam Bot token dan tekan Connect bot.', '想自己操作？打开 Create it myself instead，给 BotFather 发消息，发送 /newbot，复制它给您的令牌，粘贴到 Bot token 并点击 Connect bot。', 'நீங்களே செய்ய விரும்புகிறீர்களா? Create it myself instead ஐத் திறந்து, BotFather க்கு செய்தி அனுப்பி, /newbot ஐ அனுப்பி, அது தரும் டோக்கனை நகலெடுத்து, Bot token இல் ஒட்டி Connect bot ஐ அழுத்தவும்.'],
      ),
      p('Once connected the card shows the bot name and a badge: Working, or Needs attention with the reason. Disconnect stops customers getting replies on Telegram.', 'Setelah bersambung, kad memaparkan nama bot dan lencana: Working, atau Needs attention beserta sebabnya. Disconnect menghentikan balasan kepada pelanggan di Telegram.', '连接后，卡片会显示机器人名称和标记：Working，或 Needs attention 并附原因。Disconnect 会停止在 Telegram 上回复客户。', 'இணைந்ததும் அட்டை போட்டின் பெயரையும் ஒரு பேட்ஜையும் காட்டும்: Working, அல்லது காரணத்துடன் Needs attention. Disconnect Telegram இல் வாடிக்கையாளர்களுக்கான பதில்களை நிறுத்தும்.'),
      note('If the card asks you to link your own Telegram first, go to Account and link it, then return.', 'Jika kad meminta anda memautkan Telegram sendiri dahulu, pergi ke Account dan pautkan, kemudian kembali.', '如果卡片要求您先关联自己的 Telegram，请前往 Account 关联，然后返回。', 'முதலில் உங்கள் சொந்த Telegram ஐ இணைக்கச் சொன்னால், Account க்குச் சென்று இணைத்து, பின்னர் திரும்பவும்.'),
    ],
    related: ['customise-bot-messages', 'bot-reactions', 'link-staff-telegram'],
    keywords: kw('telegram|bot|botfather|token|channel|connect|customers message|newbot', 'telegram|bot|botfather|token|saluran|sambung|pelanggan mesej', 'telegram|机器人|botfather|令牌|渠道|连接|客户消息|newbot', 'telegram|போட்|botfather|டோக்கன்|சேனல்|இணை|வாடிக்கையாளர் செய்தி|newbot'),
    navKeys: ['settings'],
  },
  {
    id: 'link-staff-telegram',
    title: T('Link a staff member\'s Telegram', 'Pautkan Telegram seorang staf', '关联员工的 Telegram', 'ஊழியரின் Telegram ஐ இணைக்கவும்'),
    summary: T('Linked people can send catalog photos and supplier documents from their phone.', 'Mereka yang dipautkan boleh menghantar foto katalog dan dokumen pembekal dari telefon.', '已关联的人可以用手机发送目录照片和供应商文件。', 'இணைக்கப்பட்டவர்கள் தங்கள் தொலைபேசியிலிருந்து பட்டியல் புகைப்படங்களையும் சப்ளையர் ஆவணங்களையும் அனுப்பலாம்.'),
    who: ['owner', 'staff'], path: ['Admin', 'Team', 'Link Telegram'],
    body: [
      steps(
        ['Owner: open Team, find the person and press Link Telegram. A one-time link and a code appear, valid for 15 minutes.', 'Pemilik: buka Team, cari orang itu dan tekan Link Telegram. Pautan sekali guna dan kod muncul, sah selama 15 minit.', '负责人：打开 Team，找到该员工并点击 Link Telegram。会出现一次性链接和验证码，15 分钟内有效。', 'உரிமையாளர்: Team ஐத் திறந்து, நபரைக் கண்டறிந்து Link Telegram ஐ அழுத்தவும். ஒருமுறை பயன்படுத்தும் இணைப்பும் குறியீடும் தோன்றும், 15 நிமிடங்கள் செல்லுபடியாகும்.'],
        ['Send the link to them. They open it on the phone that has Telegram and press Start.', 'Hantar pautan kepada mereka. Mereka membukanya pada telefon yang ada Telegram dan menekan Start.', '把链接发给他们。他们在装有 Telegram 的手机上打开并点击 Start。', 'இணைப்பை அவர்களுக்கு அனுப்பவும். Telegram உள்ள தொலைபேசியில் அதைத் திறந்து Start ஐ அழுத்துவார்கள்.'],
        ['To link your own account: Account menu, Account, Telegram, Link Telegram.', 'Untuk memautkan akaun sendiri: menu akaun, Account, Telegram, Link Telegram.', '关联自己的账户：账户菜单、Account、Telegram、Link Telegram。', 'உங்கள் சொந்தக் கணக்கை இணைக்க: கணக்கு மெனு, Account, Telegram, Link Telegram.'],
      ),
      p('Once linked, in the LARIS helper bot they can send a product photo with the caption /catalog (the products are queued for review under Catalog photos), or forward a supplier PDF or photo so its prices are recorded.', 'Setelah dipautkan, dalam bot pembantu LARIS mereka boleh menghantar foto produk dengan kapsyen /catalog (produk disenaraikan untuk semakan di Catalog photos), atau memajukan PDF atau gambar pembekal supaya harganya direkodkan.', '关联后，他们可在 LARIS 助手机器人中发送带有 /catalog 说明文字的产品照片（产品会在 Catalog photos 下排队等待审核），或转发供应商的 PDF 或照片，以记录其价格。', 'இணைத்த பிறகு, LARIS உதவியாளர் போட்டில் /catalog தலைப்புடன் ஒரு பொருள் புகைப்படத்தை அனுப்பலாம் (பொருட்கள் Catalog photos இல் மதிப்பாய்வுக்காகக் காத்திருக்கும்), அல்லது சப்ளையர் PDF அல்லது புகைப்படத்தை முன்னனுப்பி அதன் விலைகளைப் பதிவு செய்யலாம்.'),
      p('Team shows Linked or Not linked for each person. Unlink asks you to confirm.', 'Team menunjukkan Linked atau Not linked bagi setiap orang. Unlink meminta anda mengesahkan.', 'Team 会显示每个人是 Linked 还是 Not linked。Unlink 会要求您确认。', 'Team ஒவ்வொருவருக்கும் Linked அல்லது Not linked எனக் காட்டும். Unlink உறுதிப்படுத்தக் கேட்கும்.'),
      note('If the helper bot is not set up on this server, linking shows a message saying so.', 'Jika bot pembantu belum disediakan pada pelayan ini, pemautan memaparkan mesej yang menyatakannya.', '如果此服务器尚未设置助手机器人，关联时会显示相关提示。', 'இந்தச் சேவையகத்தில் உதவியாளர் போட் அமைக்கப்படவில்லை என்றால், இணைக்கும்போது அதைச் சொல்லும் செய்தி காட்டப்படும்.'),
    ],
    related: ['ask-suppliers-and-catalog', 'connect-customer-bot', 'account-and-password'],
    keywords: kw('telegram|link|staff|phone|catalog|helper bot|supplier document', 'telegram|pautkan|staf|telefon|katalog|bot pembantu|dokumen pembekal', 'telegram|关联|员工|手机|目录|助手机器人|供应商文件', 'telegram|இணை|ஊழியர்|தொலைபேசி|பட்டியல்|உதவியாளர் போட்|சப்ளையர் ஆவணம்'),
    navKeys: ['team'],
  },
  {
    id: 'customise-bot-messages',
    title: T('Customise what the bot says', 'Ubah suai apa yang bot katakan', '自定义机器人说的话', 'போட் சொல்வதைத் தனிப்பயனாக்கு'),
    summary: T('Welcome, help, language, buttons and an after-hours reply, with a live preview.', 'Ucapan, bantuan, bahasa, butang dan balasan luar waktu, dengan pratonton.', '欢迎语、帮助、语言、按钮和下班后回复，附实时预览。', 'வரவேற்பு, உதவி, மொழி, பொத்தான்கள், வேலை நேரத்துக்குப் பிந்தைய பதில் ஆகியவை நேரடி முன்னோட்டத்துடன்.'),
    who: ['owner'], path: ['Admin', 'Settings', 'Channels', 'How your bot talks to customers'],
    body: [
      p('This card appears under Your customer bot once the bot is connected.', 'Kad ini muncul di bawah Your customer bot selepas bot bersambung.', '机器人连接后，此卡片会出现在 Your customer bot 下方。', 'போட் இணைந்ததும் இந்த அட்டை Your customer bot க்குக் கீழே தோன்றும்.'),
      steps(
        ['Edit the Welcome message and Help message. Use the default puts the original text back.', 'Edit Welcome message dan Help message. Use the default memulihkan teks asal.', '编辑 Welcome message 和 Help message。Use the default 会恢复原文。', 'Welcome message மற்றும் Help message ஐத் திருத்தவும். Use the default அசல் உரையை மீட்டெடுக்கும்.'],
        ['Choose a Language: detect from the customer\'s message, English, or Bahasa Melayu.', 'Pilih Language: kesan daripada mesej pelanggan, English, atau Bahasa Melayu.', '选择 Language：根据客户的消息自动检测、English，或 Bahasa Melayu。', 'Language ஐத் தேர்ந்தெடுக்கவும்: வாடிக்கையாளர் செய்தியிலிருந்து கண்டறி, English, அல்லது Bahasa Melayu.'],
        ['Add up to 4 Quick-reply buttons shown under the welcome message.', 'Tambah sehingga 4 butang Quick-reply yang dipaparkan di bawah ucapan.', '添加最多 4 个 Quick-reply 按钮，显示在欢迎语下方。', 'வரவேற்புச் செய்திக்குக் கீழே காட்டப்படும் 4 Quick-reply பொத்தான்கள் வரை சேர்க்கவும்.'],
        ['Turn on the After-hours message, set opening and closing times and the days you are open, and write what customers should see when you are closed.', 'Hidupkan After-hours message, tetapkan waktu buka dan tutup serta hari anda beroperasi, dan tulis apa yang pelanggan patut lihat ketika anda tutup.', '开启 After-hours message，设置营业和打烊时间以及营业日，并写下打烊时客户应看到的内容。', 'After-hours message ஐ இயக்கி, திறக்கும், மூடும் நேரங்களையும் நீங்கள் திறந்திருக்கும் நாட்களையும் அமைத்து, மூடியிருக்கும்போது வாடிக்கையாளர்கள் காண வேண்டியதை எழுதவும்.'],
        ['Check the Preview on the right, then press Save messages. Reset to defaults asks for confirmation.', 'Semak Preview di sebelah kanan, kemudian tekan Save messages. Reset to defaults meminta pengesahan.', '查看右侧的 Preview，然后点击 Save messages。Reset to defaults 会要求确认。', 'வலப்புறம் உள்ள Preview ஐப் பார்த்து, Save messages ஐ அழுத்தவும். Reset to defaults உறுதிப்படுத்தக் கேட்கும்.'],
      ),
    ],
    related: ['connect-customer-bot', 'bot-reactions'],
    keywords: kw('bot message|welcome|greeting|help message|language|quick reply|after hours|closed|preview', 'mesej bot|ucapan|bantuan|bahasa|butang|luar waktu|tutup|pratonton', '机器人消息|欢迎语|问候|帮助消息|语言|快捷回复|下班后|打烊|预览', 'போட் செய்தி|வரவேற்பு|வாழ்த்து|உதவிச் செய்தி|மொழி|விரைவு பதில்|வேலை நேரத்துக்குப் பின்|மூடியது|முன்னோட்டம்'),
    navKeys: [],
  },
  {
    id: 'bot-reactions',
    title: T('What the bot reactions mean', 'Maksud reaksi bot', '机器人表情回应的含义', 'போட் எதிர்வினைகளின் பொருள்'),
    summary: T('Eyes, thumbs up and crying face on a customer\'s message.', 'Mata, ibu jari ke atas dan muka menangis pada mesej pelanggan.', '客户消息上的眼睛、竖起大拇指和哭脸。', 'வாடிக்கையாளர் செய்தியில் கண்கள், கட்டைவிரல் உயர்த்தல், அழும் முகம்.'),
    who: ['owner', 'staff'], path: ['Admin', 'Settings', 'Channels', 'How your bot talks to customers'],
    body: [
      p('On Telegram the bot reacts to each message it receives, and shows that it is typing while it works:', 'Di Telegram bot bertindak balas pada setiap mesej yang diterima, dan menunjukkan ia sedang menaip semasa memproses:', '在 Telegram 上，机器人会对收到的每条消息做出回应，并在处理时显示正在输入：', 'Telegram இல் போட் தான் பெறும் ஒவ்வொரு செய்திக்கும் எதிர்வினை காட்டும்; செயல்படும்போது தட்டச்சு செய்வதாகவும் காட்டும்:'),
      steps(
        ['Eyes: received, LARIS is working on it.', 'Mata: diterima, LARIS sedang memprosesnya.', '眼睛：已收到，LARIS 正在处理。', 'கண்கள்: பெறப்பட்டது, LARIS செயல்படுகிறது.'],
        ['Thumbs up: done.', 'Ibu jari ke atas: selesai.', '竖起大拇指：已完成。', 'கட்டைவிரல் உயர்த்தல்: முடிந்தது.'],
        ['Crying face: LARIS could not process that message, for example a voice note it could not read. Send it again or type it.', 'Muka menangis: LARIS tidak dapat memproses mesej itu, contohnya nota suara yang tidak boleh dibaca. Hantar semula atau taip.', '哭脸：LARIS 无法处理该消息，例如无法读取的语音留言。请重新发送或改用文字输入。', 'அழும் முகம்: LARIS அந்தச் செய்தியைச் செயலாக்க முடியவில்லை, எடுத்துக்காட்டாக படிக்க முடியாத குரல் குறிப்பு. மீண்டும் அனுப்பவும் அல்லது தட்டச்சு செய்யவும்.'],
      ),
      p('The owner can turn this off with the switch Show a received and done reaction on customers\' messages, then Save messages.', 'Pemilik boleh mematikannya dengan suis Show a received and done reaction on customers\' messages, kemudian Save messages.', '负责人可以通过开关 Show a received and done reaction on customers\' messages 关闭此功能，然后点击 Save messages。', 'உரிமையாளர் Show a received and done reaction on customers\' messages சுவிட்சால் இதை அணைத்து, பின்னர் Save messages ஐ அழுத்தலாம்.'),
    ],
    related: ['customise-bot-messages', 'connect-customer-bot'],
    keywords: kw('reaction|emoji|eyes|thumbs up|crying|typing|received|done|failed', 'reaksi|emoji|mata|ibu jari|menangis|menaip|diterima|selesai|gagal', '表情回应|表情|眼睛|大拇指|哭|输入中|已收到|已完成|失败', 'எதிர்வினை|எமோஜி|கண்கள்|கட்டைவிரல்|அழுகை|தட்டச்சு|பெறப்பட்டது|முடிந்தது|தோல்வி'),
    navKeys: [],
  },
  {
    id: 'follow-ups-and-tracker',
    title: T('Follow-ups and the tracker', 'Susulan dan penjejak', '跟进与进度追踪', 'பின்தொடர்வுகளும் டிராக்கரும்'),
    summary: T('See what is stuck, and chase quotes that nobody answered.', 'Lihat apa yang tersangkut, dan susul sebut harga yang tidak dijawab.', '查看哪些事项卡住了，并跟进无人回复的报价单。', 'எது தேங்கியுள்ளது என்பதைப் பார்த்து, யாரும் பதிலளிக்காத மேற்கோள்களைத் தொடர்ந்து கேளுங்கள்.'),
    who: ['owner', 'staff'], path: ['Work', 'Follow-ups'],
    body: [
      p('Follow-ups lists sent quotes with no answer after the follow-up window (48 hours in the default made-to-order template). Each one has a suggested message.', 'Follow-ups menyenaraikan sebut harga yang dihantar tanpa jawapan selepas tempoh susulan (48 jam dalam templat made-to-order lalai). Setiap satu ada mesej cadangan.', 'Follow-ups 列出超过跟进期限（默认按单定制模板为 48 小时）仍无回复的已发送报价单。每一项都有建议消息。', 'Follow-ups பின்தொடர்வுக் காலத்துக்குப் (இயல்புநிலை made-to-order வார்ப்புருவில் 48 மணி நேரம்) பிறகும் பதில் இல்லாத அனுப்பிய மேற்கோள்களைப் பட்டியலிடும். ஒவ்வொன்றிற்கும் பரிந்துரைக்கப்பட்ட செய்தி உண்டு.'),
      steps(
        ['Open Work, Follow-ups.', 'Buka Work, Follow-ups.', '打开 Work、Follow-ups。', 'Work, Follow-ups ஐத் திறக்கவும்.'],
        ['Read the message, then press Send or Skip.', 'Baca mesej itu, kemudian tekan Send atau Skip.', '阅读消息，然后点击 Send 或 Skip。', 'செய்தியைப் படித்து, Send அல்லது Skip ஐ அழுத்தவும்.'],
      ),
      note('Nothing is sent without you pressing Send. You need the permission to manage follow-ups to open this page.', 'Tiada apa dihantar tanpa anda menekan Send. Anda memerlukan kebenaran mengurus susulan untuk membuka halaman ini.', '您不点击 Send 就不会发送任何内容。需要有管理跟进的权限才能打开此页面。', 'நீங்கள் Send ஐ அழுத்தாமல் எதுவும் அனுப்பப்படாது. இந்தப் பக்கத்தைத் திறக்கப் பின்தொடர்வுகளை நிர்வகிக்கும் அனுமதி தேவை.'),
      p('Schedule (Work, Schedule) shows everything in flight and how many days each item has sat in its stage. Items past their limit are marked overdue and listed first, for example a draft or approved quote older than 3 days, or a supplier document waiting for review for more than 2 days.', 'Track (Work, Track) menunjukkan semua yang sedang berjalan dan berapa hari setiap item berada pada peringkatnya. Item yang melepasi had ditanda lewat dan disenaraikan dahulu, contohnya sebut harga draf atau diluluskan lebih 3 hari, atau dokumen pembekal menunggu semakan lebih 2 hari.', 'Track（Work、Track）显示所有进行中的事项，以及每项在当前阶段停留了多少天。超过期限的会标记为逾期并排在最前，例如超过 3 天的草稿或已批准报价单，或等待审核超过 2 天的供应商文件。', 'Track (Work, Track) நடப்பில் உள்ள அனைத்தையும், ஒவ்வொன்றும் அதன் நிலையில் எத்தனை நாட்கள் இருந்துள்ளது என்பதையும் காட்டும். வரம்பைத் தாண்டியவை தாமதம் எனக் குறிக்கப்பட்டு முதலில் பட்டியலிடப்படும், எடுத்துக்காட்டாக 3 நாட்களுக்கு மேல் ஆன வரைவு அல்லது அங்கீகரித்த மேற்கோள், அல்லது 2 நாட்களுக்கு மேல் மதிப்பாய்வுக்காகக் காத்திருக்கும் சப்ளையர் ஆவணம்.'),
    ],
    related: ['approve-send-export-quote', 'jobs-board'],
    keywords: kw('follow up|followup|chase|remind|overdue|tracker|track|stuck|stage|pipeline', 'susulan|ingatkan|lewat|penjejak|jejak|tersangkut|peringkat', '跟进|催促|提醒|逾期|追踪|进度|卡住|阶段|流程', 'பின்தொடர்|நினைவூட்டு|தாமதம்|டிராக்கர்|கண்காணி|தேங்கியது|நிலை|பைப்லைன்'),
    navKeys: ['followups', 'track'],
  },
  {
    id: 'jobs-board',
    title: T('Jobs board', 'Papan kerja', '工单看板', 'வேலைப் பலகை'),
    summary: T('Accepted quotes become jobs you can move from To do to Done.', 'Sebut harga yang diterima menjadi kerja yang boleh dialih dari To do ke Done.', '已接受的报价单会变成工单，可从 To do 移到 Done。', 'ஏற்கப்பட்ட மேற்கோள்கள் To do இலிருந்து Done க்கு நகர்த்தக்கூடிய வேலைகளாகும்.'),
    who: ['owner', 'staff'], path: ['Work', 'Jobs'],
    body: [
      p('A job is created when a customer accepts a quote ("Sign and create job" on the quote).', 'Kerja dicipta apabila pelanggan menerima sebut harga ("Sign and create job" pada sebut harga).', '客户接受报价单（报价单上的 “Sign and create job”）时会建立工单。', 'வாடிக்கையாளர் மேற்கோளை ஏற்கும்போது (மேற்கோளில் "Sign and create job") வேலை உருவாகும்.'),
      steps(
        ['Open Work, Jobs. The board has three columns: To do, In progress and Done. Switch to the agenda view to see jobs by week.', 'Buka Work, Jobs. Papan ada tiga lajur: To do, In progress dan Done. Tukar ke paparan agenda untuk melihat kerja mengikut minggu.', '打开 Work、Jobs。看板有三列：To do、In progress 和 Done。切换到日程视图可按周查看工单。', 'Work, Jobs ஐத் திறக்கவும். பலகையில் மூன்று நெடுவரிசைகள் உள்ளன: To do, In progress, Done. வாரம் வாரியாக வேலைகளைக் காண agenda காட்சிக்கு மாறவும்.'],
        ['Open a job to set its status, due date, assignee, priority and notes, then press Save.', 'Buka kerja untuk menetapkan status, tarikh akhir, penerima tugas, keutamaan dan nota, kemudian tekan Save.', '打开工单以设置状态、截止日期、负责人、优先级和备注，然后点击 Save。', 'வேலையைத் திறந்து நிலை, நிறைவு தேதி, ஒதுக்கப்பட்டவர், முன்னுரிமை, குறிப்புகளை அமைத்து, Save ஐ அழுத்தவும்.'],
        ['Use the filters to show only your jobs or only overdue ones.', 'Guna penapis untuk menunjukkan kerja anda sahaja atau yang lewat sahaja.', '使用筛选器只显示您的工单或只显示逾期的工单。', 'உங்கள் வேலைகளை மட்டும் அல்லது தாமதமானவற்றை மட்டும் காட்ட வடிகட்டிகளைப் பயன்படுத்தவும்.'],
      ),
      note('Jobs show selling totals only. Saving a job needs the permission to manage contacts.', 'Kerja hanya menunjukkan jumlah jualan. Menyimpan kerja memerlukan kebenaran mengurus kenalan.', '工单只显示销售总额。保存工单需要有管理联系人的权限。', 'வேலைகள் விற்பனை மொத்தங்களை மட்டுமே காட்டும். வேலையைச் சேமிக்க தொடர்புகளை நிர்வகிக்கும் அனுமதி தேவை.'),
    ],
    related: ['approve-send-export-quote', 'follow-ups-and-tracker'],
    keywords: kw('job|jobs|order|todo|in progress|done|due date|agenda|assign|production', 'kerja|tempahan|siap|tarikh akhir|agenda|tugaskan|pengeluaran', '工单|订单|待办|进行中|完成|截止日期|日程|分配|生产', 'வேலை|வேலைகள்|ஆர்டர்|செய்ய வேண்டியது|நடப்பில்|முடிந்தது|நிறைவு தேதி|agenda|ஒதுக்கு|உற்பத்தி'),
    navKeys: ['jobs'],
  },
  {
    id: 'roles-and-hidden-costs',
    title: T('Roles, and what staff cannot see', 'Peranan, dan apa yang staf tidak boleh lihat', '角色，以及员工看不到什么', 'பங்குகளும், ஊழியர்கள் காண முடியாதவையும்'),
    summary: T('Owner and staff, custom roles, and why costs and margins are hidden.', 'Pemilik dan staf, peranan khas, dan sebab kos serta margin disembunyikan.', '负责人和员工、自定义角色，以及成本和利润率为何被隐藏。', 'உரிமையாளர் மற்றும் ஊழியர், தனிப்பயன் பங்குகள், செலவுகளும் இலாப விகிதங்களும் ஏன் மறைக்கப்படுகின்றன.'),
    who: ['owner', 'staff'], path: ['Admin', 'Roles'],
    body: [
      p('Everyone holds one role. Owner has every permission. Staff has a default set that the owner can edit, and the owner can add custom roles.', 'Setiap orang memegang satu peranan. Pemilik mempunyai semua kebenaran. Staf mempunyai set lalai yang boleh diedit pemilik, dan pemilik boleh menambah peranan khas.', '每个人都有一个角色。负责人拥有所有权限。员工有一套负责人可以编辑的默认权限，负责人还可以新增自定义角色。', 'ஒவ்வொருவருக்கும் ஒரு பங்கு உண்டு. உரிமையாளருக்கு எல்லா அனுமதிகளும் உண்டு. ஊழியர்களுக்கு உரிமையாளர் திருத்தக்கூடிய இயல்புநிலை அனுமதிகள் உண்டு; உரிமையாளர் தனிப்பயன் பங்குகளையும் சேர்க்கலாம்.'),
      p('Without the View costs permission, supplier prices, cost items, margins, stale-cost alerts and supplier chat text are removed from every screen and download. Price cells show "Hidden for staff".', 'Tanpa kebenaran View costs, harga pembekal, item kos, margin, amaran kos lapuk dan teks sembang pembekal dibuang daripada setiap skrin dan muat turun. Sel harga memaparkan "Hidden for staff".', '没有 View costs 权限时，供应商价格、成本项目、利润率、成本过期提醒和供应商聊天文字会从所有屏幕和下载内容中移除。价格单元格显示 “Hidden for staff”。', 'View costs அனுமதி இல்லாவிட்டால், சப்ளையர் விலைகள், செலவுப் பொருட்கள், இலாப விகிதங்கள், பழைய செலவு எச்சரிக்கைகள், சப்ளையர் அரட்டை உரை ஆகியவை ஒவ்வொரு திரையிலிருந்தும் பதிவிறக்கத்திலிருந்தும் நீக்கப்படும். விலைக் கலங்கள் "Hidden for staff" எனக் காட்டும்.'),
      p('Only the owner can approve or send quotes, accept supplier prices into the cost book, manage the team and roles, change settings, and erase a customer\'s personal data.', 'Hanya pemilik boleh meluluskan atau menghantar sebut harga, menerima harga pembekal ke dalam buku kos, mengurus pasukan dan peranan, menukar tetapan, dan memadam data peribadi pelanggan.', '只有负责人可以批准或发送报价单、将供应商价格接受到成本册、管理团队和角色、更改设置，以及删除客户的个人资料。', 'உரிமையாளர் மட்டுமே மேற்கோள்களை அங்கீகரிக்கவும் அனுப்பவும், சப்ளையர் விலைகளைச் செலவுப் புத்தகத்தில் ஏற்கவும், குழுவையும் பங்குகளையும் நிர்வகிக்கவும், அமைப்புகளை மாற்றவும், வாடிக்கையாளரின் தனிப்பட்ட தரவை அழிக்கவும் முடியும்.'),
      steps(
        ['Owner: open Admin, Roles to create a role and tick its permissions.', 'Pemilik: buka Admin, Roles untuk mencipta peranan dan menanda kebenarannya.', '负责人：打开 Admin、Roles 创建角色并勾选其权限。', 'உரிமையாளர்: Admin, Roles ஐத் திறந்து பங்கை உருவாக்கி அதன் அனுமதிகளைத் தேர்வு செய்யவும்.'],
        ['Give it to someone from Admin, Team.', 'Berikan kepada seseorang dari Admin, Team.', '在 Admin、Team 中把角色分配给某人。', 'Admin, Team இலிருந்து அதை ஒருவருக்கு வழங்கவும்.'],
      ),
      note('Changing a person\'s role signs them out. Changing what a role may do takes effect at once.', 'Menukar peranan seseorang melog keluarnya. Menukar apa yang peranan boleh buat berkuat kuasa serta-merta.', '更改某人的角色会使其退出登录。更改角色可执行的操作会立即生效。', 'ஒருவரின் பங்கை மாற்றினால் அவர் வெளியேற்றப்படுவார். ஒரு பங்கு செய்யக்கூடியதை மாற்றினால் உடனே நடைமுறைக்கு வரும்.'),
    ],
    related: ['link-staff-telegram', 'stale-costs', 'account-and-password'],
    keywords: kw('role|permission|owner|staff|hidden|cost|margin|access|custom role|view costs', 'peranan|kebenaran|pemilik|staf|tersembunyi|kos|margin|akses|peranan khas', '角色|权限|负责人|员工|隐藏|成本|利润率|访问|自定义角色|查看成本', 'பங்கு|அனுமதி|உரிமையாளர்|ஊழியர்|மறைக்கப்பட்டது|செலவு|இலாப விகிதம்|அணுகல்|தனிப்பயன் பங்கு|செலவுகளைக் காண்'),
    navKeys: ['roles'],
  },
  {
    id: 'stale-costs',
    title: T('Stale costs', 'Kos lapuk', '成本过期', 'பழைய செலவுகள்'),
    summary: T('A supplier raised a price after you quoted. LARIS tells you, and does not change the quote.', 'Pembekal menaikkan harga selepas anda memberi sebut harga. LARIS memberitahu anda, dan tidak mengubah sebut harga.', '供应商在您报价后涨价了。LARIS 会通知您，但不会更改报价单。', 'நீங்கள் மேற்கோள் அளித்த பிறகு சப்ளையர் விலையை உயர்த்தினார். LARIS உங்களுக்குத் தெரிவிக்கும், மேற்கோளை மாற்றாது.'),
    who: ['owner'], path: ['Suppliers', 'Stale costs'],
    body: [
      p('The page lists open quotes whose supplier cost has risen since the quote was priced, with the old and new cost and how much margin you lost. Nothing is re-priced automatically.', 'Halaman ini menyenaraikan sebut harga terbuka yang kos pembekalnya telah naik sejak sebut harga ditetapkan, dengan kos lama dan baharu serta margin yang hilang. Tiada harga diubah secara automatik.', '此页面列出自报价单定价以来供应商成本已上涨的未结报价单，显示新旧成本以及损失的利润率。不会自动重新定价。', 'மேற்கோள் விலை நிர்ணயிக்கப்பட்டதிலிருந்து சப்ளையர் செலவு உயர்ந்த திறந்த மேற்கோள்களை, பழைய, புதிய செலவு மற்றும் இழந்த இலாப விகிதத்துடன் இந்தப் பக்கம் பட்டியலிடும். எதுவும் தானாக மறுவிலை நிர்ணயிக்கப்படாது.'),
      steps(
        ['Open Suppliers, Stale costs.', 'Buka Suppliers, Stale costs.', '打开 Suppliers、Stale costs。', 'Suppliers, Stale costs ஐத் திறக்கவும்.'],
        ['Press Review on a quote to open it and decide what to do.', 'Tekan Review pada sebut harga untuk membukanya dan memutuskan tindakan.', '在报价单上点击 Review 打开它并决定怎么处理。', 'மேற்கோளில் Review ஐ அழுத்தித் திறந்து என்ன செய்வது என்பதை முடிவு செய்யவும்.'],
      ),
      p('Owners also see the margin report on this page, and a list of New fields seen on documents that you can add as a column or ignore.', 'Pemilik juga melihat laporan margin pada halaman ini, dan senarai New fields seen on documents yang boleh anda tambah sebagai lajur atau abaikan.', '负责人还会在此页面看到利润率报告，以及 New fields seen on documents 列表，您可以将其添加为列或忽略。', 'உரிமையாளர்கள் இந்தப் பக்கத்தில் இலாப விகித அறிக்கையையும், நெடுவரிசையாகச் சேர்க்கலாம் அல்லது புறக்கணிக்கலாம் என்ற New fields seen on documents பட்டியலையும் காண்பார்கள்.'),
      note('This page needs the permission to view costs, so staff without it do not see it.', 'Halaman ini memerlukan kebenaran melihat kos, jadi staf tanpanya tidak melihatnya.', '此页面需要有查看成本的权限，因此没有该权限的员工看不到它。', 'இந்தப் பக்கத்துக்குச் செலவுகளைக் காணும் அனுமதி தேவை, எனவே அது இல்லாத ஊழியர்கள் இதைப் பார்க்க மாட்டார்கள்.'),
    ],
    related: ['how-a-quote-is-priced', 'roles-and-hidden-costs'],
    keywords: kw('stale|cost|price rise|alert|margin lost|outdated|supplier raised', 'lapuk|kos|kenaikan harga|amaran|margin hilang|pembekal naik', '过期|成本|涨价|提醒|损失的利润率|过时|供应商涨价', 'பழையது|செலவு|விலை உயர்வு|எச்சரிக்கை|இழந்த இலாப விகிதம்|காலாவதி|சப்ளையர் உயர்த்தினார்'),
    navKeys: ['alerts'],
  },
  {
    id: 'ask-suppliers-and-catalog',
    title: T('Ask suppliers and catalog photos', 'Tanya pembekal dan foto katalog', '询问供应商与目录照片', 'சப்ளையர்களிடம் கேள், பட்டியல் புகைப்படங்கள்'),
    summary: T('Photograph an item to get prices, or photograph a catalog page to read every product.', 'Ambil gambar item untuk mendapatkan harga, atau gambar halaman katalog untuk membaca setiap produk.', '拍下物品照片即可获取价格，或拍下目录页面以读取每个产品。', 'விலைகளைப் பெற ஒரு பொருளைப் படம் எடுக்கவும், அல்லது ஒவ்வொரு பொருளையும் படிக்க பட்டியல் பக்கத்தைப் படம் எடுக்கவும்.'),
    who: ['owner', 'staff'], path: ['Suppliers', 'Ask suppliers'],
    body: [
      p('Ask suppliers: photograph an item, mark it, pick suppliers and ask on WhatsApp how much it costs. Replies are compared on the same page. The owner sees the prices; staff see who has replied. Only the owner can accept a reply into the cost book.', 'Ask suppliers: ambil gambar item, tandakannya, pilih pembekal dan tanya harga melalui WhatsApp. Balasan dibandingkan pada halaman yang sama. Pemilik melihat harga; staf melihat siapa yang sudah membalas. Hanya pemilik boleh menerima balasan ke dalam buku kos.', 'Ask suppliers：拍下物品照片，标记它，选择供应商，然后通过 WhatsApp 询问价格。回复会在同一页面中比较。负责人可看到价格；员工只能看到谁已回复。只有负责人可以把回复接受到成本册。', 'Ask suppliers: பொருளைப் படம் எடுத்து, குறியிட்டு, சப்ளையர்களைத் தேர்ந்தெடுத்து WhatsApp இல் விலை கேளுங்கள். பதில்கள் அதே பக்கத்தில் ஒப்பிடப்படும். உரிமையாளர் விலைகளைக் காண்பார்; ஊழியர்கள் யார் பதிலளித்தார் என்பதை மட்டும் காண்பர். உரிமையாளர் மட்டுமே பதிலைச் செலவுப் புத்தகத்தில் ஏற்க முடியும்.'),
      p('Add suppliers first under Suppliers, Contacts.', 'Tambah pembekal dahulu di Suppliers, Contacts.', '请先在 Suppliers、Contacts 下添加供应商。', 'முதலில் Suppliers, Contacts இல் சப்ளையர்களைச் சேர்க்கவும்.'),
      p('Catalog photos: photograph a page or shelf of labelled products. LARIS reads each product so you can check it, edit it, confirm it, discard it, or ask suppliers about it.', 'Catalog photos: ambil gambar halaman atau rak produk berlabel. LARIS membaca setiap produk supaya anda boleh menyemaknya, mengeditnya, mengesahkannya, membuangnya, atau bertanya kepada pembekal.', 'Catalog photos：拍下一页或一排带标签的产品。LARIS 会读取每个产品，您可以检查、编辑、确认、丢弃，或向供应商询问。', 'Catalog photos: லேபிளிட்ட பொருட்களின் ஒரு பக்கத்தை அல்லது அடுக்கைப் படம் எடுக்கவும். LARIS ஒவ்வொரு பொருளையும் படிக்கும்; நீங்கள் சரிபார்க்கலாம், திருத்தலாம், உறுதிப்படுத்தலாம், நிராகரிக்கலாம் அல்லது சப்ளையர்களிடம் கேட்கலாம்.'),
      steps(
        ['Open Suppliers, Catalog photos and upload the photo.', 'Buka Suppliers, Catalog photos dan muat naik gambar.', '打开 Suppliers、Catalog photos 并上传照片。', 'Suppliers, Catalog photos ஐத் திறந்து புகைப்படத்தைப் பதிவேற்றவும்.'],
        ['Or, if your Telegram is linked, send the photo to the LARIS helper bot with the caption /catalog.', 'Atau, jika Telegram anda telah dipautkan, hantar gambar kepada bot pembantu LARIS dengan kapsyen /catalog.', '或者，如果您已关联 Telegram，可将照片连同 /catalog 说明文字发送给 LARIS 助手机器人。', 'அல்லது உங்கள் Telegram இணைக்கப்பட்டிருந்தால், /catalog தலைப்புடன் புகைப்படத்தை LARIS உதவியாளர் போட்டுக்கு அனுப்பவும்.'],
        ['Check each product, then confirm it or press Ask suppliers about product.', 'Semak setiap produk, kemudian sahkan atau tekan Ask suppliers about product.', '检查每个产品，然后确认，或点击 Ask suppliers about product。', 'ஒவ்வொரு பொருளையும் சரிபார்த்து, உறுதிப்படுத்தவும் அல்லது Ask suppliers about product ஐ அழுத்தவும்.'],
      ),
      note('Catalog photos and the photos you send to suppliers are deleted from LARIS after 90 days.', 'Foto katalog dan foto yang anda hantar kepada pembekal dipadam daripada LARIS selepas 90 hari.', '目录照片和您发给供应商的照片会在 90 天后从 LARIS 删除。', 'பட்டியல் புகைப்படங்களும் நீங்கள் சப்ளையர்களுக்கு அனுப்பிய புகைப்படங்களும் 90 நாட்களுக்குப் பிறகு LARIS இலிருந்து நீக்கப்படும்.'),
    ],
    related: ['link-staff-telegram', 'stale-costs', 'privacy-basics'],
    keywords: kw('rfq|ask supplier|price request|photo|catalog|product|upload photo|whatsapp', 'minta harga|tanya pembekal|gambar|foto|katalog|produk|muat naik|whatsapp', '询价|询问供应商|价格请求|照片|目录|产品|上传照片|whatsapp', 'rfq|சப்ளையரிடம் கேள்|விலைக் கோரிக்கை|புகைப்படம்|பட்டியல்|பொருள்|புகைப்படம் பதிவேற்று|whatsapp'),
    navKeys: ['ask', 'catalog', 'contacts'],
  },
  {
    id: 'licence',
    title: T('Licence: activate an offer or paste a key', 'Lesen: aktifkan tawaran atau tampal kunci', '授权：激活优惠或粘贴密钥', 'உரிமம்: சலுகையைச் செயல்படுத்து அல்லது விசையை ஒட்டு'),
    summary: T('Where to see your plan and how to renew.', 'Di mana melihat pelan anda dan cara memperbaharui.', '在哪里查看您的方案以及如何续期。', 'உங்கள் திட்டத்தை எங்கே காண்பது, எப்படிப் புதுப்பிப்பது.'),
    who: ['owner'], path: ['Admin', 'Licence'],
    body: [
      steps(
        ['Open Admin, Licence. It shows your plan, seats and expiry.', 'Buka Admin, Licence. Ia menunjukkan pelan, tempat duduk dan tarikh tamat anda.', '打开 Admin、Licence。它会显示您的方案、席位和到期日。', 'Admin, Licence ஐத் திறக்கவும். அது உங்கள் திட்டம், இருக்கைகள், காலாவதி தேதியைக் காட்டும்.'],
        ['If an offer is waiting, press Activate licence.', 'Jika ada tawaran, tekan Activate licence.', '如果有待激活的优惠，点击 Activate licence。', 'சலுகை காத்திருந்தால், Activate licence ஐ அழுத்தவும்.'],
        ['If you were sent a key, open Have a key instead?, paste the whole key (it starts with LARIS1.) and press Activate.', 'Jika anda diberi kunci, buka Have a key instead?, tampal keseluruhan kunci (bermula dengan LARIS1.) dan tekan Activate.', '如果您收到了密钥，打开 Have a key instead?，粘贴完整密钥（以 LARIS1. 开头）并点击 Activate。', 'உங்களுக்கு விசை அனுப்பப்பட்டிருந்தால், Have a key instead? ஐத் திறந்து முழு விசையையும் (LARIS1. இல் தொடங்கும்) ஒட்டி Activate ஐ அழுத்தவும்.'],
        ['Need a key? Press Request a licence, choose a plan and the number of people. The team will email the key.', 'Perlukan kunci? Tekan Request a licence, pilih pelan dan bilangan orang. Pasukan akan mengemel kunci itu.', '需要密钥？点击 Request a licence，选择方案和人数。团队会把密钥通过电邮发给您。', 'விசை தேவையா? Request a licence ஐ அழுத்தி திட்டத்தையும் ஆட்களின் எண்ணிக்கையையும் தேர்ந்தெடுக்கவும். குழு விசையை மின்னஞ்சலில் அனுப்பும்.'],
      ),
      note('Licence appears in the menu only where licensing is switched on. If your licence is missing or expired, changes are not saved until you activate one. Only the owner can change it.', 'Licence hanya muncul dalam menu jika pelesenan dihidupkan. Jika lesen tiada atau tamat, perubahan tidak disimpan sehingga anda mengaktifkannya. Hanya pemilik boleh mengubahnya.', '只有开启授权功能时，菜单中才会出现 Licence。如果授权缺失或已过期，在您激活之前更改不会被保存。只有负责人可以更改。', 'உரிமம் வழங்கல் இயக்கப்பட்ட இடங்களில் மட்டுமே Licence மெனுவில் தோன்றும். உங்கள் உரிமம் இல்லாவிட்டால் அல்லது காலாவதியானால், ஒன்றைச் செயல்படுத்தும் வரை மாற்றங்கள் சேமிக்கப்படாது. உரிமையாளர் மட்டுமே இதை மாற்ற முடியும்.'),
    ],
    related: ['account-and-password', 'roles-and-hidden-costs'],
    keywords: kw('licence|license|key|plan|seats|renew|expiry|activate|offer', 'lesen|kunci|pelan|tempat duduk|perbaharui|tamat|aktifkan|tawaran', '授权|许可证|密钥|方案|席位|续期|到期|激活|优惠', 'உரிமம்|விசை|திட்டம்|இருக்கைகள்|புதுப்பி|காலாவதி|செயல்படுத்து|சலுகை'),
    navKeys: ['licence', 'issuer'],
  },
  {
    id: 'account-and-password',
    title: T('Account and password', 'Akaun dan kata laluan', '账户和密码', 'கணக்கும் கடவுச்சொல்லும்'),
    summary: T('Change your password, see where you are signed in, link Telegram.', 'Tukar kata laluan, lihat di mana anda log masuk, pautkan Telegram.', '更改密码，查看您在哪些设备登录，关联 Telegram。', 'கடவுச்சொல்லை மாற்றவும், எங்கே உள்நுழைந்துள்ளீர்கள் என்பதைப் பார்க்கவும், Telegram ஐ இணைக்கவும்.'),
    who: ['owner', 'staff'], path: ['Account menu', 'Account'],
    body: [
      steps(
        ['Press your avatar at the top right, then Account.', 'Tekan avatar anda di penjuru kanan atas, kemudian Account.', '点击右上角的头像，然后点击 Account。', 'மேல் வலப்புறம் உள்ள உங்கள் அவதாரை அழுத்தி, பின்னர் Account ஐ அழுத்தவும்.'],
        ['Under Change password, type your current password and a new one of at least 10 characters. Very common passwords are rejected.', 'Di bawah Change password, taip kata laluan semasa dan yang baharu sekurang-kurangnya 10 aksara. Kata laluan yang terlalu biasa ditolak.', '在 Change password 下，输入当前密码和至少 10 个字符的新密码。过于常见的密码会被拒绝。', 'Change password இன் கீழ், தற்போதைய கடவுச்சொல்லையும் குறைந்தது 10 எழுத்துகள் கொண்ட புதிய ஒன்றையும் உள்ளிடவும். மிகவும் பொதுவான கடவுச்சொற்கள் நிராகரிக்கப்படும்.'],
        ['Under Devices and sessions, press Sign out on any device you do not recognise.', 'Di bawah Devices and sessions, tekan Sign out pada mana-mana peranti yang anda tidak kenali.', '在 Devices and sessions 下，对任何您不认识的设备点击 Sign out。', 'Devices and sessions இன் கீழ், நீங்கள் அறியாத எந்தச் சாதனத்திலும் Sign out ஐ அழுத்தவும்.'],
      ),
      p('The same menu has the language switch (English or Bahasa Melayu) and Sign out.', 'Menu yang sama ada pilihan bahasa (English atau Bahasa Melayu) dan Sign out.', '同一菜单中还有语言切换（English、Bahasa Melayu、中文或 Tamil）和 Sign out。', 'அதே மெனுவில் மொழி மாற்றமும் (English, Bahasa Melayu, 中文 அல்லது தமிழ்) Sign out உம் உள்ளன.'),
      note('Forgot your password? Use the forgot-password link on the sign-in page. The owner can also set a new password for a team member under Team, which signs that person out everywhere.', 'Lupa kata laluan? Guna pautan lupa kata laluan di halaman log masuk. Pemilik juga boleh menetapkan kata laluan baharu untuk ahli pasukan di Team, yang melog keluar orang itu di semua tempat.', '忘记密码？请使用登录页面上的忘记密码链接。负责人也可以在 Team 中为团队成员设置新密码，该成员会在所有地方被退出登录。', 'கடவுச்சொல்லை மறந்துவிட்டீர்களா? உள்நுழைவுப் பக்கத்தில் உள்ள கடவுச்சொல் மறந்துவிட்டது இணைப்பைப் பயன்படுத்தவும். உரிமையாளர் Team இல் குழு உறுப்பினருக்குப் புதிய கடவுச்சொல்லை அமைக்கவும் முடியும்; அது அவரை எல்லா இடங்களிலிருந்தும் வெளியேற்றும்.'),
    ],
    related: ['link-staff-telegram', 'keyboard-shortcuts'],
    keywords: kw('account|password|reset|sessions|devices|sign out|language|login', 'akaun|kata laluan|tetap semula|sesi|peranti|log keluar|bahasa|log masuk', '账户|密码|重置|会话|设备|退出登录|语言|登录', 'கணக்கு|கடவுச்சொல்|மீட்டமை|அமர்வுகள்|சாதனங்கள்|வெளியேறு|மொழி|உள்நுழை'),
    navKeys: [],
  },
  {
    id: 'keyboard-shortcuts',
    title: T('Keyboard shortcuts', 'Pintasan papan kekunci', '键盘快捷键', 'விசைப்பலகை குறுக்குவழிகள்'),
    summary: T('Search and jump anywhere without the mouse.', 'Cari dan pergi ke mana-mana tanpa tetikus.', '不用鼠标即可搜索并跳转到任何地方。', 'சுட்டி இல்லாமல் தேடி எங்கும் செல்லுங்கள்.'),
    who: ['owner', 'staff'], path: ['Header', 'Search or jump to...'],
    body: [
      steps(
        ['Press Ctrl+K (Cmd+K on a Mac), or / when you are not typing in a field, to open search.', 'Tekan Ctrl+K (Cmd+K pada Mac), atau / apabila anda tidak sedang menaip dalam medan, untuk membuka carian.', '按 Ctrl+K（Mac 上为 Cmd+K），或在未输入文字时按 /，即可打开搜索。', 'தேடலைத் திறக்க Ctrl+K (Mac இல் Cmd+K) ஐ அழுத்தவும், அல்லது புலத்தில் தட்டச்சு செய்யாதபோது / ஐ அழுத்தவும்.'],
        ['Type what you want to do, such as invite, export or approve. It finds pages, actions and your records, in English or Malay.', 'Taip apa yang anda mahu buat, seperti jemput, eksport atau lulus. Ia mencari halaman, tindakan dan rekod anda, dalam Inggeris atau Melayu.', '输入您想做的事，例如邀请、导出或批准。它会用英文、马来文、中文或泰米尔文查找页面、操作和您的记录。', 'நீங்கள் செய்ய விரும்புவதை, எடுத்துக்காட்டாக அழை, ஏற்றுமதி அல்லது அங்கீகரி என்று தட்டச்சு செய்யவும். இது ஆங்கிலம், மலாய், சீனம் அல்லது தமிழில் பக்கங்கள், செயல்கள், உங்கள் பதிவுகளைக் கண்டறியும்.'],
        ['Use the Up and Down arrows to move, Enter to open, Esc to close.', 'Guna anak panah Atas dan Bawah untuk bergerak, Enter untuk membuka, Esc untuk menutup.', '用上、下方向键移动，按 Enter 打开，按 Esc 关闭。', 'நகர மேல், கீழ் அம்புக்குறிகளையும், திறக்க Enter ஐயும், மூட Esc ஐயும் பயன்படுத்தவும்.'],
      ),
      p('While the guided tour is open: n goes to the next step, p to the previous one, s skips and e ends it.', 'Semasa lawatan berpandu dibuka: n ke langkah seterusnya, p ke langkah sebelumnya, s melangkau dan e menamatkannya.', '导览打开时：n 到下一步，p 到上一步，s 跳过，e 结束。', 'வழிகாட்டிச் சுற்றுலா திறந்திருக்கும்போது: n அடுத்த படிக்கு, p முந்தையதற்கு, s தவிர்க்க, e முடிக்க.'),
      note('Search only shows what your role may open, so staff do not see owner-only pages.', 'Carian hanya menunjukkan apa yang boleh dibuka oleh peranan anda, jadi staf tidak melihat halaman khas pemilik.', '搜索只显示您的角色可以打开的内容，因此员工看不到仅限负责人的页面。', 'உங்கள் பங்கு திறக்கக்கூடியவற்றை மட்டுமே தேடல் காட்டும், எனவே ஊழியர்கள் உரிமையாளருக்கு மட்டும் உரிய பக்கங்களைக் காண மாட்டார்கள்.'),
    ],
    related: ['take-the-tour', 'account-and-password'],
    keywords: kw('keyboard|shortcut|ctrl k|search|slash|escape|enter|arrows', 'papan kekunci|pintasan|carian|escape|enter|anak panah', '键盘|快捷键|搜索|斜杠|escape|enter|方向键', 'விசைப்பலகை|குறுக்குவழி|தேடல்|ஸ்லாஷ்|escape|enter|அம்புக்குறிகள்'),
    navKeys: [],
  },
  {
    id: 'privacy-basics',
    title: T('Privacy basics: what is stored', 'Asas privasi: apa yang disimpan', '隐私基础：存储了什么', 'தனியுரிமை அடிப்படைகள்: என்ன சேமிக்கப்படுகிறது'),
    summary: T('What LARIS keeps, how long, and what the owner can do for a customer.', 'Apa yang LARIS simpan, berapa lama, dan apa yang pemilik boleh buat untuk pelanggan.', 'LARIS 保存什么、保存多久，以及负责人可以为客户做什么。', 'LARIS என்ன வைத்திருக்கிறது, எவ்வளவு காலம், ஒரு வாடிக்கையாளருக்காக உரிமையாளர் என்ன செய்யலாம்.'),
    who: ['owner'], path: ['Admin', 'Privacy and data'],
    body: [
      p('LARIS keeps customer names and chat numbers, chat text and voice-note transcripts, and your quotes and prices. Chat text and transcripts are blanked after 180 days by default.', 'LARIS menyimpan nama dan nombor sembang pelanggan, teks sembang dan transkrip nota suara, serta sebut harga dan harga anda. Teks sembang dan transkrip dikosongkan selepas 180 hari secara lalai.', 'LARIS 保存客户姓名和聊天号码、聊天文字和语音留言转写，以及您的报价单和价格。聊天文字和转写默认在 180 天后清空。', 'LARIS வாடிக்கையாளர் பெயர்கள், அரட்டை எண்கள், அரட்டை உரை, குரல் குறிப்பு எழுத்துப்படிகள், உங்கள் மேற்கோள்கள், விலைகளை வைத்திருக்கிறது. அரட்டை உரையும் எழுத்துப்படிகளும் இயல்பாக 180 நாட்களுக்குப் பிறகு அழிக்கப்படும்.'),
      p('Voice notes are not kept. The audio is sent for transcription, handled in memory and discarded. Photos customers send in chat are not stored either. Catalog photos and photos sent to suppliers are emptied after 90 days, and supplier reply text after 180 days.', 'Nota suara tidak disimpan. Audio dihantar untuk transkripsi, diproses dalam memori dan dibuang. Gambar yang pelanggan hantar dalam sembang juga tidak disimpan. Foto katalog dan foto yang dihantar kepada pembekal dikosongkan selepas 90 hari, dan teks balasan pembekal selepas 180 hari.', '语音留言不会被保存。音频会被送去转写，在内存中处理后丢弃。客户在聊天中发送的照片也不会被存储。目录照片和发给供应商的照片在 90 天后清空，供应商回复文字在 180 天后清空。', 'குரல் குறிப்புகள் வைக்கப்படுவதில்லை. ஒலி எழுத்துப்படிக்காக அனுப்பப்பட்டு, நினைவகத்தில் கையாளப்பட்டு நீக்கப்படும். வாடிக்கையாளர்கள் அரட்டையில் அனுப்பும் புகைப்படங்களும் சேமிக்கப்படுவதில்லை. பட்டியல் புகைப்படங்களும் சப்ளையர்களுக்கு அனுப்பிய புகைப்படங்களும் 90 நாட்களுக்குப் பிறகும், சப்ளையர் பதில் உரை 180 நாட்களுக்குப் பிறகும் அழிக்கப்படும்.'),
      p('Message text sent to the AI vendor has contact details and NRIC numbers masked first. Audio cannot be masked.', 'Teks mesej yang dihantar kepada vendor AI disembunyikan butiran hubungan dan nombor NRIC dahulu. Audio tidak boleh disembunyikan.', '发送给 AI 供应商的消息文字会先遮盖联系方式和身份证号码。音频无法遮盖。', 'AI நிறுவனத்துக்கு அனுப்பப்படும் செய்தி உரையில் தொடர்பு விவரங்களும் NRIC எண்களும் முதலில் மறைக்கப்படும். ஒலியை மறைக்க முடியாது.'),
      p('The owner can download what is held about one person and can erase a customer\'s personal data. Open the person under Suppliers, Contacts and use the buttons Download this person\'s data and Erase this person\'s personal data. Erasing replaces the name and removes contact details, address, notes and the text of their messages. The quotes, lines, dates and prices stay as financial records. Earlier activity-log rows cannot be removed. Erasing cannot be undone, so LARIS asks you to confirm first.', 'Pemilik boleh memuat turun apa yang disimpan tentang seseorang dan boleh memadam data peribadi pelanggan. Buka orang itu di Suppliers, Contacts dan guna butang Download this person\'s data dan Erase this person\'s personal data. Pemadaman menggantikan nama dan membuang butiran hubungan, alamat, nota serta teks mesej mereka. Sebut harga, baris, tarikh dan harga kekal sebagai rekod kewangan. Baris log aktiviti terdahulu tidak boleh dibuang. Pemadaman tidak boleh dibatalkan, jadi LARIS meminta anda mengesahkan dahulu.', '负责人可以下载某个人的所有已存数据，也可以删除客户的个人资料。在 Suppliers、Contacts 下打开该人，使用按钮 Download this person\'s data 和 Erase this person\'s personal data。删除会替换姓名，并移除联系方式、地址、备注和其消息文字。报价单、明细、日期和价格会作为财务记录保留。较早的活动记录行无法移除。删除无法撤销，因此 LARIS 会先要求您确认。', 'உரிமையாளர் ஒருவரைப் பற்றி வைத்திருப்பதைப் பதிவிறக்கலாம், வாடிக்கையாளரின் தனிப்பட்ட தரவையும் அழிக்கலாம். Suppliers, Contacts இல் அந்த நபரைத் திறந்து Download this person\'s data மற்றும் Erase this person\'s personal data பொத்தான்களைப் பயன்படுத்தவும். அழிப்பது பெயரை மாற்றி, தொடர்பு விவரங்கள், முகவரி, குறிப்புகள், அவர்களின் செய்திகளின் உரையை நீக்கும். மேற்கோள்கள், வரிகள், தேதிகள், விலைகள் நிதிப் பதிவுகளாக இருக்கும். முந்தைய செயல்பாட்டுப் பதிவு வரிகளை நீக்க முடியாது. அழிப்பதைத் திரும்பப் பெற முடியாது, எனவே LARIS முதலில் உறுதிப்படுத்தக் கேட்கும்.'),
      p('Admin, Privacy and data is where you save the privacy contact person that customers can reach, and keep a register of data incidents. If personal data is lost or sent to the wrong person, add it there the same day. The page shows the deadlines to tell the Commissioner and the affected people, but confirm the current rule at pdp.gov.my. Incidents are kept as a record and cannot be deleted.', 'Admin, Privacy and data ialah tempat anda menyimpan orang untuk dihubungi tentang privasi dan menyimpan daftar insiden data. Jika data peribadi hilang atau dihantar kepada orang yang salah, tambah di situ pada hari yang sama. Halaman itu menunjukkan tarikh akhir untuk memberitahu Pesuruhjaya dan orang terjejas, tetapi sahkan peraturan semasa di pdp.gov.my. Insiden disimpan sebagai rekod dan tidak boleh dipadam.', 'Admin、Privacy and data 是保存客户可联系的隐私联络人，以及记录数据事故登记册的地方。如果个人资料丢失或发错对象，请当天在此添加。页面会显示通知专员和受影响人士的期限，但请到 pdp.gov.my 确认现行规定。事故会作为记录保存，无法删除。', 'Admin, Privacy and data என்பது வாடிக்கையாளர்கள் தொடர்புகொள்ளக்கூடிய தனியுரிமைத் தொடர்பு நபரைச் சேமிக்கவும், தரவு சம்பவங்களின் பதிவேட்டை வைத்திருக்கவும் உள்ள இடம். தனிப்பட்ட தரவு தொலைந்தால் அல்லது தவறான நபருக்கு அனுப்பப்பட்டால், அதே நாளில் இங்கே சேர்க்கவும். ஆணையருக்கும் பாதிக்கப்பட்டவர்களுக்கும் தெரிவிக்கும் காலக்கெடுவை இப்பக்கம் காட்டும், ஆனால் தற்போதைய விதியை pdp.gov.my இல் உறுதிப்படுத்தவும். சம்பவங்கள் பதிவாக வைக்கப்படும், நீக்க முடியாது.'),
      note('Vendors such as Telegram, Meta and the AI providers keep their own copies under their own terms. Erasing in LARIS does not reach them.', 'Vendor seperti Telegram, Meta dan penyedia AI menyimpan salinan sendiri mengikut terma mereka. Pemadaman dalam LARIS tidak sampai kepada mereka.', 'Telegram、Meta 和 AI 供应商等厂商会按各自条款保留自己的副本。在 LARIS 中删除不会影响它们。', 'Telegram, Meta, AI வழங்குநர்கள் போன்ற நிறுவனங்கள் தங்கள் விதிமுறைகளின்படி தங்களுக்கான நகல்களை வைத்திருக்கும். LARIS இல் அழிப்பது அவற்றைச் சென்றடையாது.'),
    ],
    related: ['roles-and-hidden-costs', 'ask-suppliers-and-catalog'],
    keywords: kw('privacy|pdpa|personal data|voice note|erase|delete|export|retention|stored|dpo|breach|incident|commissioner', 'privasi|pdpa|data peribadi|nota suara|padam|eksport|simpanan|disimpan|dpo|pelanggaran|insiden|pesuruhjaya', '隐私|pdpa|个人资料|语音留言|删除|导出|保留|已存储|dpo|泄露|事故|专员', 'தனியுரிமை|pdpa|தனிப்பட்ட தரவு|குரல் குறிப்பு|அழி|ஏற்றுமதி|தக்கவைப்பு|சேமிக்கப்பட்டது|dpo|மீறல்|சம்பவம்|ஆணையர்'),
    navKeys: ['privacy'],
  },
  {
    id: 'api-access',
    title: T('API access: let another program ask for prices', 'Akses API: benarkan program lain meminta harga', 'API 访问：让其他程序查询价格', 'API அணுகல்: மற்றொரு நிரல் விலைகளைக் கேட்க அனுமதி'),
    summary: T('Create a key, see this month\'s usage, and call the price API.', 'Cipta kunci, lihat penggunaan bulan ini, dan panggil API harga.', '创建密钥，查看本月用量，并调用价格 API。', 'விசையை உருவாக்கி, இந்த மாதப் பயன்பாட்டைப் பார்த்து, விலை API ஐ அழைக்கவும்.'),
    who: ['owner'], path: ['Admin', 'API access'],
    body: [
      p('The price API lets another program send item keys and quantities and get selling prices back. It uses the same rules and cost book as the dashboard, never creates a quote and never uses the AI. Costs, margins and supplier names are not sent out.', 'API harga membenarkan program lain menghantar kunci item dan kuantiti lalu menerima harga jualan. Ia menggunakan peraturan dan buku kos yang sama seperti papan pemuka, tidak pernah mencipta sebut harga dan tidak menggunakan AI. Kos, margin dan nama pembekal tidak dihantar keluar.', '价格 API 让其他程序发送项目代码和数量，并取回售价。它使用与仪表板相同的规则和成本册，从不创建报价单，也从不使用 AI。成本、利润率和供应商名称不会发送出去。', 'விலை API மற்றொரு நிரல் பொருள் விசைகளையும் அளவுகளையும் அனுப்பி விற்பனை விலைகளைத் திரும்பப் பெற அனுமதிக்கும். இது டாஷ்போர்டின் அதே விதிகளையும் செலவுப் புத்தகத்தையும் பயன்படுத்தும்; மேற்கோளை உருவாக்காது, AI ஐப் பயன்படுத்தாது. செலவுகள், இலாப விகிதங்கள், சப்ளையர் பெயர்கள் வெளியே அனுப்பப்படாது.'),
      steps(
        ['Open Admin, API access, type a name for the key (for example the program that will use it) and press Create key.', 'Buka Admin, API access, taip nama untuk kunci (contohnya program yang akan menggunakannya) dan tekan Create key.', '打开 Admin、API access，为密钥输入名称（例如将使用它的程序），然后点击 Create key。', 'Admin, API access ஐத் திறந்து, விசைக்கு ஒரு பெயரை (எடுத்துக்காட்டாக அதைப் பயன்படுத்தும் நிரல்) உள்ளிட்டு Create key ஐ அழுத்தவும்.'],
        ['Copy the key at once with Copy key. It is shown only once. If you lose it, revoke it and create a new one.', 'Salin kunci itu segera dengan Copy key. Ia hanya dipaparkan sekali. Jika hilang, batalkan dan cipta yang baharu.', '立即用 Copy key 复制密钥。它只显示一次。如果丢失，请撤销并创建新的密钥。', 'Copy key மூலம் விசையை உடனே நகலெடுக்கவும். இது ஒருமுறை மட்டுமே காட்டப்படும். தொலைந்தால் ரத்து செய்து புதியதை உருவாக்கவும்.'],
        ['Send the key in the X-API-Key header. The How to call it box on the page has examples. A key allows 60 requests a minute.', 'Hantar kunci dalam header X-API-Key. Kotak How to call it pada halaman ada contoh. Satu kunci membenarkan 60 permintaan seminit.', '在 X-API-Key 标头中发送密钥。页面上的 How to call it 框里有示例。每个密钥每分钟允许 60 次请求。', 'விசையை X-API-Key தலைப்பில் அனுப்பவும். பக்கத்தில் உள்ள How to call it பெட்டியில் எடுத்துக்காட்டுகள் உள்ளன. ஒரு விசை நிமிடத்திற்கு 60 கோரிக்கைகளை அனுமதிக்கும்.'],
        ['To stop a key working, press Revoke and confirm. Programs using it stop at once.', 'Untuk menghentikan sesuatu kunci, tekan Revoke dan sahkan. Program yang menggunakannya berhenti serta-merta.', '要停止某个密钥，点击 Revoke 并确认。使用它的程序会立即停止。', 'ஒரு விசையை நிறுத்த, Revoke ஐ அழுத்தி உறுதிப்படுத்தவும். அதைப் பயன்படுத்தும் நிரல்கள் உடனே நின்றுவிடும்.'],
      ),
      p('Usage this month shows approved quotes against a free allowance, quotes sent and API calls. It is for planning only.', 'Usage this month menunjukkan sebut harga diluluskan berbanding had percuma, sebut harga dihantar dan panggilan API. Ia untuk perancangan sahaja.', 'Usage this month 显示已批准的报价单与免费额度的对比、已发送的报价单和 API 调用次数。仅供规划参考。', 'Usage this month அங்கீகரிக்கப்பட்ட மேற்கோள்களை இலவச அளவுடன் ஒப்பிட்டு, அனுப்பிய மேற்கோள்கள், API அழைப்புகளைக் காட்டும். இது திட்டமிடலுக்கு மட்டுமே.'),
      note('LARIS does not bill anything yet. Never share a key in a chat or put it in a web page.', 'LARIS belum mengenakan bayaran. Jangan kongsi kunci dalam sembang atau letak dalam halaman web.', 'LARIS 目前不收取任何费用。切勿在聊天中分享密钥，也不要把它放在网页中。', 'LARIS இன்னும் எதற்கும் கட்டணம் வசூலிக்கவில்லை. விசையை அரட்டையில் பகிரவோ வலைப்பக்கத்தில் வைக்கவோ வேண்டாம்.'),
    ],
    related: ['how-a-quote-is-priced', 'roles-and-hidden-costs'],
    keywords: kw('api|api key|key|usage|quota|allowance|integration|developer|curl|price api|revoke', 'api|kunci api|kunci|penggunaan|kuota|had percuma|integrasi|pembangun|batalkan', 'api|api 密钥|密钥|用量|配额|额度|集成|开发者|curl|价格 api|撤销', 'api|api விசை|விசை|பயன்பாடு|ஒதுக்கீடு|இலவச அளவு|ஒருங்கிணைப்பு|உருவாக்குநர்|curl|விலை api|ரத்து செய்'),
    navKeys: ['api-access'],
  },
  {
    id: 'ai-guide',
    title: T('The AI guide: ask where to click', 'Panduan AI: tanya di mana hendak klik', 'AI 指引：问问该点哪里', 'AI வழிகாட்டி: எங்கே கிளிக் செய்வது எனக் கேளுங்கள்'),
    summary: T('An optional helper that points to screens. Off until the owner switches it on.', 'Pembantu pilihan yang menunjuk ke skrin. Mati sehingga pemilik menghidupkannya.', '一个会指向相应页面的可选助手。负责人开启之前一直是关闭的。', 'திரைகளைச் சுட்டிக்காட்டும் விருப்ப உதவியாளர். உரிமையாளர் இயக்கும் வரை அணைந்தே இருக்கும்.'),
    who: ['owner', 'staff'], path: ['Admin', 'AI settings'],
    body: [
      p('The AI guide answers questions like "where do I upload a supplier quote?". It can only point you to screens in LARIS. It cannot change anything, send anything to a customer or read your quotes.', 'Panduan AI menjawab soalan seperti "di mana saya muat naik sebut harga pembekal?". Ia hanya boleh menunjukkan skrin dalam LARIS. Ia tidak boleh mengubah apa-apa, menghantar apa-apa kepada pelanggan atau membaca sebut harga anda.', 'AI 指引回答诸如“我在哪里上传供应商报价单？”之类的问题。它只能指向 LARIS 中的页面，不能更改任何内容、向客户发送任何东西或读取您的报价单。', 'AI வழிகாட்டி "சப்ளையர் மேற்கோளை எங்கே பதிவேற்றுவது?" போன்ற கேள்விகளுக்குப் பதிலளிக்கும். அது LARIS இல் உள்ள திரைகளை மட்டுமே சுட்டிக்காட்டும். எதையும் மாற்றவோ வாடிக்கையாளருக்கு எதையும் அனுப்பவோ உங்கள் மேற்கோள்களைப் படிக்கவோ முடியாது.'),
      p('It is off by default. Only the owner can switch it on.', 'Ia mati secara lalai. Hanya pemilik boleh menghidupkannya.', '默认是关闭的。只有负责人可以开启。', 'இது இயல்பாக அணைந்திருக்கும். உரிமையாளர் மட்டுமே இயக்க முடியும்.'),
      steps(
        ['Owner: open Admin, AI settings and choose Guide only (or Guide plus my data, which also lets the Assistant page work).', 'Pemilik: buka Admin, AI settings dan pilih Guide only (atau Guide plus my data, yang juga membolehkan halaman Assistant berfungsi).', '负责人：打开 Admin、AI settings，选择 Guide only（或 Guide plus my data，这也会让 Assistant 页面可用）。', 'உரிமையாளர்: Admin, AI settings ஐத் திறந்து Guide only ஐத் (அல்லது Assistant பக்கத்தையும் செயல்படச் செய்யும் Guide plus my data ஐ) தேர்ந்தெடுக்கவும்.'],
        ['Choose the AI service: LARIS hosted ILMU, or My own AI server (an https server on port 443 or 8443).', 'Pilih perkhidmatan AI: ILMU yang dihoskan LARIS, atau My own AI server (pelayan https pada port 443 atau 8443).', '选择 AI 服务：LARIS 托管的 ILMU，或 My own AI server（端口为 443 或 8443 的 https 服务器）。', 'AI சேவையைத் தேர்ந்தெடுக்கவும்: LARIS வழங்கும் ILMU, அல்லது My own AI server (போர்ட் 443 அல்லது 8443 இல் https சேவையகம்).'],
        ['Read the notice, tick the box to confirm, and press Save. Press Test connection to check it works.', 'Baca notis, tandakan kotak untuk mengesahkan, dan tekan Save. Tekan Test connection untuk memeriksa ia berfungsi.', '阅读声明，勾选方框确认，然后点击 Save。点击 Test connection 检查是否正常。', 'அறிவிப்பைப் படித்து, உறுதிப்படுத்தப் பெட்டியைத் தேர்வு செய்து, Save ஐ அழுத்தவும். அது செயல்படுகிறதா எனப் பார்க்க Test connection ஐ அழுத்தவும்.'],
        ['Everyone: press Ctrl+K, type your question (3 letters or more) and choose the last row, Ask the AI guide.', 'Semua orang: tekan Ctrl+K, taip soalan anda (3 huruf atau lebih) dan pilih baris terakhir, Ask the AI guide.', '所有人：按 Ctrl+K，输入您的问题（3 个字母或以上），然后选择最后一行 Ask the AI guide。', 'அனைவரும்: Ctrl+K ஐ அழுத்தி, உங்கள் கேள்வியை (3 எழுத்துகள் அல்லது அதற்கு மேல்) தட்டச்சு செய்து, கடைசி வரியான Ask the AI guide ஐத் தேர்ந்தெடுக்கவும்.'],
      ),
      p('What is sent: only the question you type, with email addresses, phone numbers and ID numbers removed, plus the names of menu items. No quote, customer, cost or margin is sent. Names and addresses you type into the question are not removed, so do not type them. The question is not stored.', 'Apa yang dihantar: hanya soalan yang anda taip, dengan alamat emel, nombor telefon dan nombor ID dibuang, serta nama item menu. Tiada sebut harga, pelanggan, kos atau margin dihantar. Nama dan alamat yang anda taip dalam soalan tidak dibuang, jadi jangan taipnya. Soalan tidak disimpan.', '发送的内容：只有您输入的问题（已去除电邮地址、电话号码和身份证号码）以及菜单项名称。不会发送报价单、客户、成本或利润率。您在问题中输入的姓名和地址不会被去除，所以请不要输入。问题不会被存储。', 'என்ன அனுப்பப்படுகிறது: நீங்கள் தட்டச்சு செய்த கேள்வி மட்டும், மின்னஞ்சல் முகவரிகள், தொலைபேசி எண்கள், அடையாள எண்கள் நீக்கப்பட்டு, மெனு உருப்படிகளின் பெயர்களுடன். மேற்கோள், வாடிக்கையாளர், செலவு, இலாப விகிதம் எதுவும் அனுப்பப்படாது. கேள்வியில் நீங்கள் தட்டச்சு செய்யும் பெயர்களும் முகவரிகளும் நீக்கப்படாது, எனவே அவற்றை உள்ளிடாதீர்கள். கேள்வி சேமிக்கப்படாது.'),
      note('AI answers can be wrong. Check the screen it points to. The owner must tell customers in the privacy notice that questions can go to an AI provider, and can switch the guide off at any time.', 'Jawapan AI boleh salah. Semak skrin yang ditunjukkan. Pemilik mesti memberitahu pelanggan dalam notis privasi bahawa soalan boleh dihantar kepada penyedia AI, dan boleh mematikan panduan pada bila-bila masa.', 'AI 的回答可能有误，请核对它指向的页面。负责人必须在隐私声明中告知客户，问题可能会发送给 AI 供应商，并且可以随时关闭指引。', 'AI பதில்கள் தவறாக இருக்கலாம். அது சுட்டிக்காட்டும் திரையைச் சரிபார்க்கவும். கேள்விகள் AI வழங்குநருக்குச் செல்லக்கூடும் என்பதை உரிமையாளர் தனியுரிமை அறிவிப்பில் வாடிக்கையாளர்களுக்குத் தெரிவிக்க வேண்டும்; எப்போது வேண்டுமானாலும் வழிகாட்டியை அணைக்கலாம்.'),
    ],
    related: ['privacy-basics', 'keyboard-shortcuts'],
    keywords: kw('ai|ai guide|assistant|chatbot|guide|openai|own server|where do i click|privacy|ilmu', 'ai|panduan ai|pembantu|chatbot|panduan|openai|pelayan sendiri|di mana klik|privasi|ilmu', 'ai|ai 指引|助手|聊天机器人|指引|openai|自有服务器|该点哪里|隐私|ilmu', 'ai|ai வழிகாட்டி|உதவியாளர்|அரட்டைப் போட்|வழிகாட்டி|openai|சொந்தச் சேவையகம்|எங்கே கிளிக்|தனியுரிமை|ilmu'),
    navKeys: ['ai-settings'],
  },
  {
    id: 'take-the-tour',
    title: T('Take the tour again', 'Ikuti lawatan sekali lagi', '再次观看导览', 'சுற்றுலாவை மீண்டும் மேற்கொள்ளுங்கள்'),
    summary: T('Replay the guided tour of the main screens.', 'Ulang lawatan berpandu skrin utama.', '重播主要页面的导览。', 'முக்கியத் திரைகளின் வழிகாட்டிச் சுற்றுலாவை மீண்டும் இயக்கவும்.'),
    who: ['owner', 'staff'], path: ['Account menu', 'Take the tour'],
    body: [
      steps(
        ['Press your avatar at the top right and choose Take the tour.', 'Tekan avatar anda di penjuru kanan atas dan pilih Take the tour.', '点击右上角的头像，选择 Take the tour。', 'மேல் வலப்புறம் உள்ள உங்கள் அவதாரை அழுத்தி Take the tour ஐத் தேர்ந்தெடுக்கவும்.'],
        ['Or press Ctrl+K and type tour.', 'Atau tekan Ctrl+K dan taip tour.', '或按 Ctrl+K 并输入 tour。', 'அல்லது Ctrl+K ஐ அழுத்தி tour எனத் தட்டச்சு செய்யவும்.'],
      ),
      p('Press the "?" next to a sidebar item at any time to read the matching Help article.', 'Tekan "?" di sebelah item bar sisi pada bila-bila masa untuk membaca artikel Help yang berkaitan.', '随时点击侧边栏项目旁的 “?” 即可阅读对应的 Help 文章。', 'பக்கப்பட்டி உருப்படிக்கு அருகில் உள்ள "?" ஐ எப்போது வேண்டுமானாலும் அழுத்தி, தொடர்புடைய Help கட்டுரையைப் படிக்கலாம்.'),
    ],
    related: ['keyboard-shortcuts', 'account-and-password'],
    keywords: kw('tour|walkthrough|guide|onboarding|tutorial|start', 'lawatan|panduan|permulaan|tutorial|mula', '导览|引导|入门|教程|开始', 'சுற்றுலா|வழிகாட்டுதல்|தொடக்கம்|பயிற்சி|தொடங்கு'),
    navKeys: ['home'],
  },
]

export const findArticle = (id?: string) => ARTICLES.find(a => a.id === id)
/** The article a sidebar "?" opens for a NAV key (first match in ARTICLES). */
export const articleForNav = (key: string) => ARTICLES.find(a => a.navKeys.includes(key))

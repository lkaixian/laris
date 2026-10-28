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
  body: Block[]; related: string[]; keywords: { en: string[]; ms: string[] }; navKeys: string[]
}

const T = (en: string, ms: string): Text => ({ en, ms })
const p = (en: string, ms: string): Block => ({ p: T(en, ms) })
const note = (en: string, ms: string): Block => ({ note: T(en, ms) })
const steps = (...s: [string, string][]): Block => ({ steps: s.map(([en, ms]) => T(en, ms)) })
const kw = (en: string, ms: string) => ({ en: en.split('|'), ms: ms.split('|') })

export const ARTICLES: Article[] = [
  {
    id: 'approve-send-export-quote',
    title: T('Approve, send and export a quote', 'Lulus, hantar dan eksport sebut harga'),
    summary: T('Only the owner approves and sends. Anyone with access can download the files.', 'Hanya pemilik yang meluluskan dan menghantar. Fail boleh dimuat turun oleh yang ada akses.'),
    who: ['owner', 'staff'], path: ['Work', 'Tracker', 'Open a quote'],
    body: [
      steps(
        ['Open the quote from Tracker. A new customer quote starts as a draft.', 'Buka sebut harga dari Penjejak. Sebut harga pelanggan baharu bermula sebagai draf.'],
        ['In the Decision box, press Approve quote. You can type a reason first; it is saved to the activity log.', 'Dalam kotak Decision, tekan Approve quote. Anda boleh taip sebab dahulu; ia disimpan dalam log aktiviti.'],
        ['Press Send quote to customer, or use Send quote in the Quote document section, then confirm.', 'Tekan Send quote to customer, atau guna Send quote dalam bahagian Quote document, kemudian sahkan.'],
        ['When the customer answers, press Record customer accepted or Record customer rejected.', 'Apabila pelanggan menjawab, tekan Record customer accepted atau Record customer rejected.'],
      ),
      p('To download, press Export in the Quote document section and pick PDF, Excel (.xlsx) or CSV under Customer files. Open PDF in a new tab shows the PDF without saving it.', 'Untuk memuat turun, tekan Export dalam bahagian Quote document dan pilih PDF, Excel (.xlsx) atau CSV di bawah Customer files. Open PDF in a new tab memaparkan PDF tanpa menyimpannya.'),
      note('Internal files (with cost and margin) are listed only for people who may export data and see costs, normally the owner. Do not send them to customers.', 'Fail Internal (dengan kos dan margin) hanya muncul untuk mereka yang boleh eksport data dan melihat kos, biasanya pemilik. Jangan hantar kepada pelanggan.'),
      note('A quote cannot be sent without the owner approving it first. Staff see the buttons greyed out.', 'Sebut harga tidak boleh dihantar tanpa kelulusan pemilik. Butang kelihatan kelabu untuk staf.'),
    ],
    related: ['how-a-quote-is-priced', 'follow-ups-and-tracker', 'jobs-board'],
    keywords: kw('approve|send quote|export|pdf|excel|xlsx|csv|download|accept|reject|draft', 'lulus|hantar sebut harga|eksport|pdf|excel|csv|muat turun|terima|tolak|draf'),
    navKeys: ['tracker'],
  },
  {
    id: 'how-a-quote-is-priced',
    title: T('How a quote is priced', 'Bagaimana harga sebut harga ditetapkan'),
    summary: T('Rules and your cost book set the price. The AI never does.', 'Peraturan dan buku kos anda menetapkan harga. AI tidak pernah menetapkannya.'),
    who: ['owner', 'staff'], path: ['Work', 'Tracker'],
    body: [
      p('When a customer sends an enquiry (text, voice note or photo), the AI only reads which items and how many. It never sets a price. LARIS then prices the quote with fixed rules, using the supplier costs in your cost book plus your markup.', 'Apabila pelanggan menghantar pertanyaan (teks, nota suara atau gambar), AI hanya membaca item dan kuantiti. Ia tidak pernah menetapkan harga. LARIS kemudian menetapkan harga dengan peraturan tetap, menggunakan kos pembekal dalam buku kos anda serta markup anda.'),
      p('The margin guard compares the result with your margin floor. A quote below it is flagged for review instead of going out quietly.', 'Margin guard membandingkan hasilnya dengan margin minimum anda. Sebut harga di bawahnya ditanda untuk semakan dan tidak keluar begitu sahaja.'),
      steps(
        ['To change the floor: Admin, Settings, Margin floor (%). Margin is profit as a share of the selling price.', 'Untuk menukar had: Admin, Settings, Margin floor (%). Margin ialah untung sebagai bahagian daripada harga jualan.'],
        ['To feed the cost book: upload a supplier quote under Tracker, then the owner approves it and presses Add prices to cost book.', 'Untuk mengisi buku kos: muat naik sebut harga pembekal di Penjejak, kemudian pemilik meluluskannya dan menekan Add prices to cost book.'],
      ),
      note('Staff cannot edit a price that the rules produced. Only the owner can override one.', 'Staf tidak boleh mengubah harga yang dihasilkan peraturan. Hanya pemilik boleh mengatasinya.'),
    ],
    related: ['approve-send-export-quote', 'stale-costs', 'roles-and-hidden-costs'],
    keywords: kw('price|pricing|markup|margin|cost book|margin guard|ai|rules|floor', 'harga|markup|margin|buku kos|peraturan|had margin|ai'),
    navKeys: [],
  },
  {
    id: 'connect-customer-bot',
    title: T('Connect your customer bot on Telegram', 'Sambung bot pelanggan anda di Telegram'),
    summary: T('Create a bot with your shop name in one tap, or paste a BotFather token.', 'Cipta bot dengan nama kedai anda dengan satu ketikan, atau tampal token BotFather.'),
    who: ['owner'], path: ['Admin', 'Settings', 'Channels', 'Your customer bot'],
    body: [
      steps(
        ['Open Settings and find the Your customer bot card.', 'Buka Settings dan cari kad Your customer bot.'],
        ['Press Create my bot in Telegram. Telegram shows a confirmation screen with a name already filled in. Tap Create, then come back. LARIS checks every few seconds for up to 2 minutes.', 'Tekan Create my bot in Telegram. Telegram memaparkan skrin pengesahan dengan nama yang telah diisi. Ketik Create, kemudian kembali. LARIS menyemak setiap beberapa saat sehingga 2 minit.'],
        ['Prefer to do it yourself? Open Create it myself instead, message BotFather, send /newbot, copy the token it gives you, paste it into Bot token and press Connect bot.', 'Mahu buat sendiri? Buka Create it myself instead, mesej BotFather, hantar /newbot, salin token yang diberi, tampal dalam Bot token dan tekan Connect bot.'],
      ),
      p('Once connected the card shows the bot name and a badge: Working, or Needs attention with the reason. Disconnect stops customers getting replies on Telegram.', 'Setelah bersambung, kad memaparkan nama bot dan lencana: Working, atau Needs attention beserta sebabnya. Disconnect menghentikan balasan kepada pelanggan di Telegram.'),
      note('If the card asks you to link your own Telegram first, go to Account and link it, then return.', 'Jika kad meminta anda memautkan Telegram sendiri dahulu, pergi ke Account dan pautkan, kemudian kembali.'),
    ],
    related: ['customise-bot-messages', 'bot-reactions', 'link-staff-telegram'],
    keywords: kw('telegram|bot|botfather|token|channel|connect|customers message|newbot', 'telegram|bot|botfather|token|saluran|sambung|pelanggan mesej'),
    navKeys: ['settings'],
  },
  {
    id: 'link-staff-telegram',
    title: T('Link a staff member\'s Telegram', 'Pautkan Telegram seorang staf'),
    summary: T('Linked people can send catalog photos and supplier documents from their phone.', 'Mereka yang dipautkan boleh menghantar foto katalog dan dokumen pembekal dari telefon.'),
    who: ['owner', 'staff'], path: ['Admin', 'Team', 'Link Telegram'],
    body: [
      steps(
        ['Owner: open Team, find the person and press Link Telegram. A one-time link and a code appear, valid for 15 minutes.', 'Pemilik: buka Team, cari orang itu dan tekan Link Telegram. Pautan sekali guna dan kod muncul, sah selama 15 minit.'],
        ['Send the link to them. They open it on the phone that has Telegram and press Start.', 'Hantar pautan kepada mereka. Mereka membukanya pada telefon yang ada Telegram dan menekan Start.'],
        ['To link your own account: Account menu, Account, Telegram, Link Telegram.', 'Untuk memautkan akaun sendiri: menu akaun, Account, Telegram, Link Telegram.'],
      ),
      p('Once linked, in the LARIS helper bot they can send a product photo with the caption /catalog (the products are queued for review under Catalog photos), or forward a supplier PDF or photo so its prices are recorded.', 'Setelah dipautkan, dalam bot pembantu LARIS mereka boleh menghantar foto produk dengan kapsyen /catalog (produk disenaraikan untuk semakan di Catalog photos), atau memajukan PDF atau gambar pembekal supaya harganya direkodkan.'),
      p('Team shows Linked or Not linked for each person. Unlink asks you to confirm.', 'Team menunjukkan Linked atau Not linked bagi setiap orang. Unlink meminta anda mengesahkan.'),
      note('If the helper bot is not set up on this server, linking shows a message saying so.', 'Jika bot pembantu belum disediakan pada pelayan ini, pemautan memaparkan mesej yang menyatakannya.'),
    ],
    related: ['ask-suppliers-and-catalog', 'connect-customer-bot', 'account-and-password'],
    keywords: kw('telegram|link|staff|phone|catalog|helper bot|supplier document', 'telegram|pautkan|staf|telefon|katalog|bot pembantu|dokumen pembekal'),
    navKeys: ['team'],
  },
  {
    id: 'customise-bot-messages',
    title: T('Customise what the bot says', 'Ubah suai apa yang bot katakan'),
    summary: T('Welcome, help, language, buttons and an after-hours reply, with a live preview.', 'Ucapan, bantuan, bahasa, butang dan balasan luar waktu, dengan pratonton.'),
    who: ['owner'], path: ['Admin', 'Settings', 'Channels', 'How your bot talks to customers'],
    body: [
      p('This card appears under Your customer bot once the bot is connected.', 'Kad ini muncul di bawah Your customer bot selepas bot bersambung.'),
      steps(
        ['Edit the Welcome message and Help message. Use the default puts the original text back.', 'Edit Welcome message dan Help message. Use the default memulihkan teks asal.'],
        ['Choose a Language: detect from the customer\'s message, English, or Bahasa Melayu.', 'Pilih Language: kesan daripada mesej pelanggan, English, atau Bahasa Melayu.'],
        ['Add up to 4 Quick-reply buttons shown under the welcome message.', 'Tambah sehingga 4 butang Quick-reply yang dipaparkan di bawah ucapan.'],
        ['Turn on the After-hours message, set opening and closing times and the days you are open, and write what customers should see when you are closed.', 'Hidupkan After-hours message, tetapkan waktu buka dan tutup serta hari anda beroperasi, dan tulis apa yang pelanggan patut lihat ketika anda tutup.'],
        ['Check the Preview on the right, then press Save messages. Reset to defaults asks for confirmation.', 'Semak Preview di sebelah kanan, kemudian tekan Save messages. Reset to defaults meminta pengesahan.'],
      ),
    ],
    related: ['connect-customer-bot', 'bot-reactions'],
    keywords: kw('bot message|welcome|greeting|help message|language|quick reply|after hours|closed|preview', 'mesej bot|ucapan|bantuan|bahasa|butang|luar waktu|tutup|pratonton'),
    navKeys: [],
  },
  {
    id: 'bot-reactions',
    title: T('What the bot reactions mean', 'Maksud reaksi bot'),
    summary: T('Eyes, thumbs up and crying face on a customer\'s message.', 'Mata, ibu jari ke atas dan muka menangis pada mesej pelanggan.'),
    who: ['owner', 'staff'], path: ['Admin', 'Settings', 'Channels', 'How your bot talks to customers'],
    body: [
      p('On Telegram the bot reacts to each message it receives, and shows that it is typing while it works:', 'Di Telegram bot bertindak balas pada setiap mesej yang diterima, dan menunjukkan ia sedang menaip semasa memproses:'),
      steps(
        ['Eyes: received, LARIS is working on it.', 'Mata: diterima, LARIS sedang memprosesnya.'],
        ['Thumbs up: done.', 'Ibu jari ke atas: selesai.'],
        ['Crying face: LARIS could not process that message, for example a voice note it could not read. Send it again or type it.', 'Muka menangis: LARIS tidak dapat memproses mesej itu, contohnya nota suara yang tidak boleh dibaca. Hantar semula atau taip.'],
      ),
      p('The owner can turn this off with the switch Show a received and done reaction on customers\' messages, then Save messages.', 'Pemilik boleh mematikannya dengan suis Show a received and done reaction on customers\' messages, kemudian Save messages.'),
    ],
    related: ['customise-bot-messages', 'connect-customer-bot'],
    keywords: kw('reaction|emoji|eyes|thumbs up|crying|typing|received|done|failed', 'reaksi|emoji|mata|ibu jari|menangis|menaip|diterima|selesai|gagal'),
    navKeys: [],
  },
  {
    id: 'follow-ups-and-tracker',
    title: T('Follow-ups and the tracker', 'Susulan dan penjejak'),
    summary: T('See what is stuck, and chase quotes that nobody answered.', 'Lihat apa yang tersangkut, dan susul sebut harga yang tidak dijawab.'),
    who: ['owner', 'staff'], path: ['Work', 'Follow-ups'],
    body: [
      p('Follow-ups lists sent quotes with no answer after the follow-up window (48 hours in the default made-to-order template). Each one has a suggested message.', 'Follow-ups menyenaraikan sebut harga yang dihantar tanpa jawapan selepas tempoh susulan (48 jam dalam templat made-to-order lalai). Setiap satu ada mesej cadangan.'),
      steps(
        ['Open Work, Follow-ups.', 'Buka Work, Follow-ups.'],
        ['Read the message, then press Send or Skip.', 'Baca mesej itu, kemudian tekan Send atau Skip.'],
      ),
      note('Nothing is sent without you pressing Send. You need the permission to manage follow-ups to open this page.', 'Tiada apa dihantar tanpa anda menekan Send. Anda memerlukan kebenaran mengurus susulan untuk membuka halaman ini.'),
      p('Track (Work, Track) shows everything in flight and how many days each item has sat in its stage. Items past their limit are marked overdue and listed first, for example a draft or approved quote older than 3 days, or a supplier document waiting for review for more than 2 days.', 'Track (Work, Track) menunjukkan semua yang sedang berjalan dan berapa hari setiap item berada pada peringkatnya. Item yang melepasi had ditanda lewat dan disenaraikan dahulu, contohnya sebut harga draf atau diluluskan lebih 3 hari, atau dokumen pembekal menunggu semakan lebih 2 hari.'),
    ],
    related: ['approve-send-export-quote', 'jobs-board'],
    keywords: kw('follow up|followup|chase|remind|overdue|tracker|track|stuck|stage|pipeline', 'susulan|ingatkan|lewat|penjejak|jejak|tersangkut|peringkat'),
    navKeys: ['followups', 'track'],
  },
  {
    id: 'jobs-board',
    title: T('Jobs board', 'Papan kerja'),
    summary: T('Accepted quotes become jobs you can move from To do to Done.', 'Sebut harga yang diterima menjadi kerja yang boleh dialih dari To do ke Done.'),
    who: ['owner', 'staff'], path: ['Work', 'Jobs'],
    body: [
      p('A job is created when a customer accepts a quote ("Sign and create job" on the quote).', 'Kerja dicipta apabila pelanggan menerima sebut harga ("Sign and create job" pada sebut harga).'),
      steps(
        ['Open Work, Jobs. The board has three columns: To do, In progress and Done. Switch to the agenda view to see jobs by week.', 'Buka Work, Jobs. Papan ada tiga lajur: To do, In progress dan Done. Tukar ke paparan agenda untuk melihat kerja mengikut minggu.'],
        ['Open a job to set its status, due date, assignee, priority and notes, then press Save.', 'Buka kerja untuk menetapkan status, tarikh akhir, penerima tugas, keutamaan dan nota, kemudian tekan Save.'],
        ['Use the filters to show only your jobs or only overdue ones.', 'Guna penapis untuk menunjukkan kerja anda sahaja atau yang lewat sahaja.'],
      ),
      note('Jobs show selling totals only. Saving a job needs the permission to manage contacts.', 'Kerja hanya menunjukkan jumlah jualan. Menyimpan kerja memerlukan kebenaran mengurus kenalan.'),
    ],
    related: ['approve-send-export-quote', 'follow-ups-and-tracker'],
    keywords: kw('job|jobs|order|todo|in progress|done|due date|agenda|assign|production', 'kerja|tempahan|siap|tarikh akhir|agenda|tugaskan|pengeluaran'),
    navKeys: ['jobs'],
  },
  {
    id: 'roles-and-hidden-costs',
    title: T('Roles, and what staff cannot see', 'Peranan, dan apa yang staf tidak boleh lihat'),
    summary: T('Owner and staff, custom roles, and why costs and margins are hidden.', 'Pemilik dan staf, peranan khas, dan sebab kos serta margin disembunyikan.'),
    who: ['owner', 'staff'], path: ['Admin', 'Roles'],
    body: [
      p('Everyone holds one role. Owner has every permission. Staff has a default set that the owner can edit, and the owner can add custom roles.', 'Setiap orang memegang satu peranan. Pemilik mempunyai semua kebenaran. Staf mempunyai set lalai yang boleh diedit pemilik, dan pemilik boleh menambah peranan khas.'),
      p('Without the View costs permission, supplier prices, cost items, margins, stale-cost alerts and supplier chat text are removed from every screen and download. Price cells show "Hidden for staff".', 'Tanpa kebenaran View costs, harga pembekal, item kos, margin, amaran kos lapuk dan teks sembang pembekal dibuang daripada setiap skrin dan muat turun. Sel harga memaparkan "Hidden for staff".'),
      p('Only the owner can approve or send quotes, accept supplier prices into the cost book, manage the team and roles, change settings, and erase a customer\'s personal data.', 'Hanya pemilik boleh meluluskan atau menghantar sebut harga, menerima harga pembekal ke dalam buku kos, mengurus pasukan dan peranan, menukar tetapan, dan memadam data peribadi pelanggan.'),
      steps(
        ['Owner: open Admin, Roles to create a role and tick its permissions.', 'Pemilik: buka Admin, Roles untuk mencipta peranan dan menanda kebenarannya.'],
        ['Give it to someone from Admin, Team.', 'Berikan kepada seseorang dari Admin, Team.'],
      ),
      note('Changing a person\'s role signs them out. Changing what a role may do takes effect at once.', 'Menukar peranan seseorang melog keluarnya. Menukar apa yang peranan boleh buat berkuat kuasa serta-merta.'),
    ],
    related: ['link-staff-telegram', 'stale-costs', 'account-and-password'],
    keywords: kw('role|permission|owner|staff|hidden|cost|margin|access|custom role|view costs', 'peranan|kebenaran|pemilik|staf|tersembunyi|kos|margin|akses|peranan khas'),
    navKeys: ['roles'],
  },
  {
    id: 'stale-costs',
    title: T('Stale costs', 'Kos lapuk'),
    summary: T('A supplier raised a price after you quoted. LARIS tells you, and does not change the quote.', 'Pembekal menaikkan harga selepas anda memberi sebut harga. LARIS memberitahu anda, dan tidak mengubah sebut harga.'),
    who: ['owner'], path: ['Suppliers', 'Stale costs'],
    body: [
      p('The page lists open quotes whose supplier cost has risen since the quote was priced, with the old and new cost and how much margin you lost. Nothing is re-priced automatically.', 'Halaman ini menyenaraikan sebut harga terbuka yang kos pembekalnya telah naik sejak sebut harga ditetapkan, dengan kos lama dan baharu serta margin yang hilang. Tiada harga diubah secara automatik.'),
      steps(
        ['Open Suppliers, Stale costs.', 'Buka Suppliers, Stale costs.'],
        ['Press Review on a quote to open it and decide what to do.', 'Tekan Review pada sebut harga untuk membukanya dan memutuskan tindakan.'],
      ),
      p('Owners also see the margin report on this page, and a list of New fields seen on documents that you can add as a column or ignore.', 'Pemilik juga melihat laporan margin pada halaman ini, dan senarai New fields seen on documents yang boleh anda tambah sebagai lajur atau abaikan.'),
      note('This page needs the permission to view costs, so staff without it do not see it.', 'Halaman ini memerlukan kebenaran melihat kos, jadi staf tanpanya tidak melihatnya.'),
    ],
    related: ['how-a-quote-is-priced', 'roles-and-hidden-costs'],
    keywords: kw('stale|cost|price rise|alert|margin lost|outdated|supplier raised', 'lapuk|kos|kenaikan harga|amaran|margin hilang|pembekal naik'),
    navKeys: ['alerts'],
  },
  {
    id: 'ask-suppliers-and-catalog',
    title: T('Ask suppliers and catalog photos', 'Tanya pembekal dan foto katalog'),
    summary: T('Photograph an item to get prices, or photograph a catalog page to read every product.', 'Ambil gambar item untuk mendapatkan harga, atau gambar halaman katalog untuk membaca setiap produk.'),
    who: ['owner', 'staff'], path: ['Suppliers', 'Ask suppliers'],
    body: [
      p('Ask suppliers: photograph an item, circle it, pick suppliers and ask on WhatsApp how much it costs. Replies are compared on the same page. The owner sees the prices; staff see who has replied. Only the owner can accept a reply into the cost book.', 'Ask suppliers: ambil gambar item, bulatkannya, pilih pembekal dan tanya harga melalui WhatsApp. Balasan dibandingkan pada halaman yang sama. Pemilik melihat harga; staf melihat siapa yang sudah membalas. Hanya pemilik boleh menerima balasan ke dalam buku kos.'),
      p('Add suppliers first under Suppliers, Contacts.', 'Tambah pembekal dahulu di Suppliers, Contacts.'),
      p('Catalog photos: photograph a page or shelf of labelled products. LARIS reads each product so you can check it, edit it, confirm it, discard it, or ask suppliers about it.', 'Catalog photos: ambil gambar halaman atau rak produk berlabel. LARIS membaca setiap produk supaya anda boleh menyemaknya, mengeditnya, mengesahkannya, membuangnya, atau bertanya kepada pembekal.'),
      steps(
        ['Open Suppliers, Catalog photos and upload the photo.', 'Buka Suppliers, Catalog photos dan muat naik gambar.'],
        ['Or, if your Telegram is linked, send the photo to the LARIS helper bot with the caption /catalog.', 'Atau, jika Telegram anda telah dipautkan, hantar gambar kepada bot pembantu LARIS dengan kapsyen /catalog.'],
        ['Check each product, then confirm it or press Ask suppliers about product.', 'Semak setiap produk, kemudian sahkan atau tekan Ask suppliers about product.'],
      ),
      note('Catalog photos and the photos you send to suppliers are deleted from LARIS after 90 days.', 'Foto katalog dan foto yang anda hantar kepada pembekal dipadam daripada LARIS selepas 90 hari.'),
    ],
    related: ['link-staff-telegram', 'stale-costs', 'privacy-basics'],
    keywords: kw('rfq|ask supplier|price request|photo|catalog|product|upload photo|whatsapp', 'minta harga|tanya pembekal|gambar|foto|katalog|produk|muat naik|whatsapp'),
    navKeys: ['ask', 'catalog', 'contacts'],
  },
  {
    id: 'licence',
    title: T('Licence: activate an offer or paste a key', 'Lesen: aktifkan tawaran atau tampal kunci'),
    summary: T('Where to see your plan and how to renew.', 'Di mana melihat pelan anda dan cara memperbaharui.'),
    who: ['owner'], path: ['Admin', 'Licence'],
    body: [
      steps(
        ['Open Admin, Licence. It shows your plan, seats and expiry.', 'Buka Admin, Licence. Ia menunjukkan pelan, tempat duduk dan tarikh tamat anda.'],
        ['If an offer is waiting, press Activate licence.', 'Jika ada tawaran, tekan Activate licence.'],
        ['If you were sent a key, open Have a key instead?, paste the whole key (it starts with LARIS1.) and press Activate.', 'Jika anda diberi kunci, buka Have a key instead?, tampal keseluruhan kunci (bermula dengan LARIS1.) dan tekan Activate.'],
        ['Need a key? Press Request a licence, choose a plan and the number of people. The team will email the key.', 'Perlukan kunci? Tekan Request a licence, pilih pelan dan bilangan orang. Pasukan akan mengemel kunci itu.'],
      ),
      note('Licence appears in the menu only where licensing is switched on. If your licence is missing or expired, changes are not saved until you activate one. Only the owner can change it.', 'Licence hanya muncul dalam menu jika pelesenan dihidupkan. Jika lesen tiada atau tamat, perubahan tidak disimpan sehingga anda mengaktifkannya. Hanya pemilik boleh mengubahnya.'),
    ],
    related: ['account-and-password', 'roles-and-hidden-costs'],
    keywords: kw('licence|license|key|plan|seats|renew|expiry|activate|offer', 'lesen|kunci|pelan|tempat duduk|perbaharui|tamat|aktifkan|tawaran'),
    navKeys: ['licence', 'issuer'],
  },
  {
    id: 'account-and-password',
    title: T('Account and password', 'Akaun dan kata laluan'),
    summary: T('Change your password, see where you are signed in, link Telegram.', 'Tukar kata laluan, lihat di mana anda log masuk, pautkan Telegram.'),
    who: ['owner', 'staff'], path: ['Account menu', 'Account'],
    body: [
      steps(
        ['Press your avatar at the top right, then Account.', 'Tekan avatar anda di penjuru kanan atas, kemudian Account.'],
        ['Under Change password, type your current password and a new one of at least 10 characters. Very common passwords are rejected.', 'Di bawah Change password, taip kata laluan semasa dan yang baharu sekurang-kurangnya 10 aksara. Kata laluan yang terlalu biasa ditolak.'],
        ['Under Devices and sessions, press Sign out on any device you do not recognise.', 'Di bawah Devices and sessions, tekan Sign out pada mana-mana peranti yang anda tidak kenali.'],
      ),
      p('The same menu has the language switch (English or Bahasa Melayu) and Sign out.', 'Menu yang sama ada pilihan bahasa (English atau Bahasa Melayu) dan Sign out.'),
      note('Forgot your password? Use the forgot-password link on the sign-in page. The owner can also set a new password for a team member under Team, which signs that person out everywhere.', 'Lupa kata laluan? Guna pautan lupa kata laluan di halaman log masuk. Pemilik juga boleh menetapkan kata laluan baharu untuk ahli pasukan di Team, yang melog keluar orang itu di semua tempat.'),
    ],
    related: ['link-staff-telegram', 'keyboard-shortcuts'],
    keywords: kw('account|password|reset|sessions|devices|sign out|language|login', 'akaun|kata laluan|tetap semula|sesi|peranti|log keluar|bahasa|log masuk'),
    navKeys: [],
  },
  {
    id: 'keyboard-shortcuts',
    title: T('Keyboard shortcuts', 'Pintasan papan kekunci'),
    summary: T('Search and jump anywhere without the mouse.', 'Cari dan pergi ke mana-mana tanpa tetikus.'),
    who: ['owner', 'staff'], path: ['Header', 'Search or jump to...'],
    body: [
      steps(
        ['Press Ctrl+K (Cmd+K on a Mac), or / when you are not typing in a field, to open search.', 'Tekan Ctrl+K (Cmd+K pada Mac), atau / apabila anda tidak sedang menaip dalam medan, untuk membuka carian.'],
        ['Type what you want to do, such as invite, export or approve. It finds pages, actions and your records, in English or Malay.', 'Taip apa yang anda mahu buat, seperti jemput, eksport atau lulus. Ia mencari halaman, tindakan dan rekod anda, dalam Inggeris atau Melayu.'],
        ['Use the Up and Down arrows to move, Enter to open, Esc to close.', 'Guna anak panah Atas dan Bawah untuk bergerak, Enter untuk membuka, Esc untuk menutup.'],
      ),
      p('While the guided tour is open: n goes to the next step, p to the previous one, s skips and e ends it.', 'Semasa lawatan berpandu dibuka: n ke langkah seterusnya, p ke langkah sebelumnya, s melangkau dan e menamatkannya.'),
      note('Search only shows what your role may open, so staff do not see owner-only pages.', 'Carian hanya menunjukkan apa yang boleh dibuka oleh peranan anda, jadi staf tidak melihat halaman khas pemilik.'),
    ],
    related: ['take-the-tour', 'account-and-password'],
    keywords: kw('keyboard|shortcut|ctrl k|search|slash|escape|enter|arrows', 'papan kekunci|pintasan|carian|escape|enter|anak panah'),
    navKeys: [],
  },
  {
    id: 'privacy-basics',
    title: T('Privacy basics: what is stored', 'Asas privasi: apa yang disimpan'),
    summary: T('What LARIS keeps, how long, and what the owner can do for a customer.', 'Apa yang LARIS simpan, berapa lama, dan apa yang pemilik boleh buat untuk pelanggan.'),
    who: ['owner'], path: ['Admin', 'Privacy and data'],
    body: [
      p('LARIS keeps customer names and chat numbers, chat text and voice-note transcripts, and your quotes and prices. Chat text and transcripts are blanked after 180 days by default.', 'LARIS menyimpan nama dan nombor sembang pelanggan, teks sembang dan transkrip nota suara, serta sebut harga dan harga anda. Teks sembang dan transkrip dikosongkan selepas 180 hari secara lalai.'),
      p('Voice notes are not kept. The audio is sent for transcription, handled in memory and discarded. Photos customers send in chat are not stored either. Catalog photos and photos sent to suppliers are emptied after 90 days, and supplier reply text after 180 days.', 'Nota suara tidak disimpan. Audio dihantar untuk transkripsi, diproses dalam memori dan dibuang. Gambar yang pelanggan hantar dalam sembang juga tidak disimpan. Foto katalog dan foto yang dihantar kepada pembekal dikosongkan selepas 90 hari, dan teks balasan pembekal selepas 180 hari.'),
      p('Message text sent to the AI vendor has contact details and NRIC numbers masked first. Audio cannot be masked.', 'Teks mesej yang dihantar kepada vendor AI disembunyikan butiran hubungan dan nombor NRIC dahulu. Audio tidak boleh disembunyikan.'),
      p('The owner can download what is held about one person and can erase a customer\'s personal data. Open the person under Suppliers, Contacts and use the buttons Download this person\'s data and Erase this person\'s personal data. Erasing replaces the name and removes contact details, address, notes and the text of their messages. The quotes, lines, dates and prices stay as financial records. Earlier activity-log rows cannot be removed. Erasing cannot be undone, so LARIS asks you to confirm first.', 'Pemilik boleh memuat turun apa yang disimpan tentang seseorang dan boleh memadam data peribadi pelanggan. Buka orang itu di Suppliers, Contacts dan guna butang Download this person\'s data dan Erase this person\'s personal data. Pemadaman menggantikan nama dan membuang butiran hubungan, alamat, nota serta teks mesej mereka. Sebut harga, baris, tarikh dan harga kekal sebagai rekod kewangan. Baris log aktiviti terdahulu tidak boleh dibuang. Pemadaman tidak boleh dibatalkan, jadi LARIS meminta anda mengesahkan dahulu.'),
      p('Admin, Privacy and data is where you save the privacy contact person that customers can reach, and keep a register of data incidents. If personal data is lost or sent to the wrong person, add it there the same day. The page shows the deadlines to tell the Commissioner and the affected people, but confirm the current rule at pdp.gov.my. Incidents are kept as a record and cannot be deleted.', 'Admin, Privacy and data ialah tempat anda menyimpan orang untuk dihubungi tentang privasi dan menyimpan daftar insiden data. Jika data peribadi hilang atau dihantar kepada orang yang salah, tambah di situ pada hari yang sama. Halaman itu menunjukkan tarikh akhir untuk memberitahu Pesuruhjaya dan orang terjejas, tetapi sahkan peraturan semasa di pdp.gov.my. Insiden disimpan sebagai rekod dan tidak boleh dipadam.'),
      note('Vendors such as Telegram, Meta and the AI providers keep their own copies under their own terms. Erasing in LARIS does not reach them.', 'Vendor seperti Telegram, Meta dan penyedia AI menyimpan salinan sendiri mengikut terma mereka. Pemadaman dalam LARIS tidak sampai kepada mereka.'),
    ],
    related: ['roles-and-hidden-costs', 'ask-suppliers-and-catalog'],
    keywords: kw('privacy|pdpa|personal data|voice note|erase|delete|export|retention|stored|dpo|breach|incident|commissioner', 'privasi|pdpa|data peribadi|nota suara|padam|eksport|simpanan|disimpan|dpo|pelanggaran|insiden|pesuruhjaya'),
    navKeys: ['privacy'],
  },
  {
    id: 'api-access',
    title: T('API access: let another program ask for prices', 'Akses API: benarkan program lain meminta harga'),
    summary: T('Create a key, see this month\'s usage, and call the price API.', 'Cipta kunci, lihat penggunaan bulan ini, dan panggil API harga.'),
    who: ['owner'], path: ['Admin', 'API access'],
    body: [
      p('The price API lets another program send item keys and quantities and get selling prices back. It uses the same rules and cost book as the dashboard, never creates a quote and never uses the AI. Costs, margins and supplier names are not sent out.', 'API harga membenarkan program lain menghantar kunci item dan kuantiti lalu menerima harga jualan. Ia menggunakan peraturan dan buku kos yang sama seperti papan pemuka, tidak pernah mencipta sebut harga dan tidak menggunakan AI. Kos, margin dan nama pembekal tidak dihantar keluar.'),
      steps(
        ['Open Admin, API access, type a name for the key (for example the program that will use it) and press Create key.', 'Buka Admin, API access, taip nama untuk kunci (contohnya program yang akan menggunakannya) dan tekan Create key.'],
        ['Copy the key at once with Copy key. It is shown only once. If you lose it, revoke it and create a new one.', 'Salin kunci itu segera dengan Copy key. Ia hanya dipaparkan sekali. Jika hilang, batalkan dan cipta yang baharu.'],
        ['Send the key in the X-API-Key header. The How to call it box on the page has examples. A key allows 60 requests a minute.', 'Hantar kunci dalam header X-API-Key. Kotak How to call it pada halaman ada contoh. Satu kunci membenarkan 60 permintaan seminit.'],
        ['To stop a key working, press Revoke and confirm. Programs using it stop at once.', 'Untuk menghentikan sesuatu kunci, tekan Revoke dan sahkan. Program yang menggunakannya berhenti serta-merta.'],
      ),
      p('Usage this month shows approved quotes against a free allowance, quotes sent and API calls. It is for planning only.', 'Usage this month menunjukkan sebut harga diluluskan berbanding had percuma, sebut harga dihantar dan panggilan API. Ia untuk perancangan sahaja.'),
      note('LARIS does not bill anything yet. Never share a key in a chat or put it in a web page.', 'LARIS belum mengenakan bayaran. Jangan kongsi kunci dalam sembang atau letak dalam halaman web.'),
    ],
    related: ['how-a-quote-is-priced', 'roles-and-hidden-costs'],
    keywords: kw('api|api key|key|usage|quota|allowance|integration|developer|curl|price api|revoke', 'api|kunci api|kunci|penggunaan|kuota|had percuma|integrasi|pembangun|batalkan'),
    navKeys: ['api-access'],
  },
  {
    id: 'ai-guide',
    title: T('The AI guide: ask where to click', 'Panduan AI: tanya di mana hendak klik'),
    summary: T('An optional helper that points to screens. Off until the owner switches it on.', 'Pembantu pilihan yang menunjuk ke skrin. Mati sehingga pemilik menghidupkannya.'),
    who: ['owner', 'staff'], path: ['Admin', 'AI settings'],
    body: [
      p('The AI guide answers questions like "where do I upload a supplier quote?". It can only point you to screens in LARIS. It cannot change anything, send anything to a customer or read your quotes.', 'Panduan AI menjawab soalan seperti "di mana saya muat naik sebut harga pembekal?". Ia hanya boleh menunjukkan skrin dalam LARIS. Ia tidak boleh mengubah apa-apa, menghantar apa-apa kepada pelanggan atau membaca sebut harga anda.'),
      p('It is off by default. Only the owner can switch it on.', 'Ia mati secara lalai. Hanya pemilik boleh menghidupkannya.'),
      steps(
        ['Owner: open Admin, AI settings and choose Guide only (or Guide plus my data, which also lets the Assistant page work).', 'Pemilik: buka Admin, AI settings dan pilih Guide only (atau Guide plus my data, yang juga membolehkan halaman Assistant berfungsi).'],
        ['Choose the AI service: LARIS hosted ILMU, or My own AI server (an https server on port 443 or 8443).', 'Pilih perkhidmatan AI: ILMU yang dihoskan LARIS, atau My own AI server (pelayan https pada port 443 atau 8443).'],
        ['Read the notice, tick the box to confirm, and press Save. Press Test connection to check it works.', 'Baca notis, tandakan kotak untuk mengesahkan, dan tekan Save. Tekan Test connection untuk memeriksa ia berfungsi.'],
        ['Everyone: press Ctrl+K, type your question (3 letters or more) and choose the last row, Ask the AI guide.', 'Semua orang: tekan Ctrl+K, taip soalan anda (3 huruf atau lebih) dan pilih baris terakhir, Ask the AI guide.'],
      ),
      p('What is sent: only the question you type, with email addresses, phone numbers and ID numbers removed, plus the names of menu items. No quote, customer, cost or margin is sent. Names and addresses you type into the question are not removed, so do not type them. The question is not stored.', 'Apa yang dihantar: hanya soalan yang anda taip, dengan alamat emel, nombor telefon dan nombor ID dibuang, serta nama item menu. Tiada sebut harga, pelanggan, kos atau margin dihantar. Nama dan alamat yang anda taip dalam soalan tidak dibuang, jadi jangan taipnya. Soalan tidak disimpan.'),
      note('AI answers can be wrong. Check the screen it points to. The owner must tell customers in the privacy notice that questions can go to an AI provider, and can switch the guide off at any time.', 'Jawapan AI boleh salah. Semak skrin yang ditunjukkan. Pemilik mesti memberitahu pelanggan dalam notis privasi bahawa soalan boleh dihantar kepada penyedia AI, dan boleh mematikan panduan pada bila-bila masa.'),
    ],
    related: ['privacy-basics', 'keyboard-shortcuts'],
    keywords: kw('ai|ai guide|assistant|chatbot|guide|openai|own server|where do i click|privacy|ilmu', 'ai|panduan ai|pembantu|chatbot|panduan|openai|pelayan sendiri|di mana klik|privasi|ilmu'),
    navKeys: ['ai-settings'],
  },
  {
    id: 'take-the-tour',
    title: T('Take the tour again', 'Ikuti lawatan sekali lagi'),
    summary: T('Replay the guided tour of the main screens.', 'Ulang lawatan berpandu skrin utama.'),
    who: ['owner', 'staff'], path: ['Account menu', 'Take the tour'],
    body: [
      steps(
        ['Press your avatar at the top right and choose Take the tour.', 'Tekan avatar anda di penjuru kanan atas dan pilih Take the tour.'],
        ['Or press Ctrl+K and type tour.', 'Atau tekan Ctrl+K dan taip tour.'],
      ),
      p('Press the "?" next to a sidebar item at any time to read the matching Help article.', 'Tekan "?" di sebelah item bar sisi pada bila-bila masa untuk membaca artikel Help yang berkaitan.'),
    ],
    related: ['keyboard-shortcuts', 'account-and-password'],
    keywords: kw('tour|walkthrough|guide|onboarding|tutorial|start', 'lawatan|panduan|permulaan|tutorial|mula'),
    navKeys: ['home'],
  },
]

export const findArticle = (id?: string) => ARTICLES.find(a => a.id === id)
/** The article a sidebar "?" opens for a NAV key (first match in ARTICLES). */
export const articleForNav = (key: string) => ARTICLES.find(a => a.navKeys.includes(key))

import type { Text } from './i18n'

// Pure data and rules for the guided tour (engine: Tour.tsx, question card: FirstRun.tsx). No React, no network.
export type TourKind = 'owner' | 'staff'
export type OnbState = 'new' | 'in_progress' | 'done' | 'skipped' | 'later'
export interface Onb { tour: TourKind; state: OnbState; step: number; later_count: number }
export interface OnbPatch { state: Exclude<OnbState, 'new'>; step?: number; tour?: TourKind }

export interface Step {
  id: string
  title: Text
  body: Text
  /** Element to highlight: CSS selectors separated by " || ", the first one that is on screen wins. No sel = centred card. */
  sel?: string
  /** Hash route to open before the step is shown. */
  route?: string
  /** "Do it" step: moves on when the person opens this route, or clicks the highlighted element. */
  doRoute?: string
  doClick?: boolean
  /** Click this once when the target is not on screen yet (a tab that is not open, say). */
  reveal?: () => HTMLElement | null | undefined
  /** Show the card centred instead of skipping the step when the target is missing. */
  soft?: boolean
  /** Permission the person must hold, else the step is dropped. */
  need?: string
  link?: { href: string; label: Text }
  /** Step shows the "Simulate an enquiry" button (only built when no bot is connected). */
  sim?: boolean
  /** Closing "Set up your customer bot now?" card (only built when no bot is connected). */
  bot?: boolean
}

export const routeOf = (h: string) => (h.split('/')[1] || 'home').split('?')[0]

const nav = (r: string) => `nav[aria-label="Main"] a[href="#/${r}"]`

const help: Step = {
  id: 'help',
  title: { en: 'Need help later?', ms: 'Perlukan bantuan nanti?' },
  body: { en: 'Need help later? Open Help in your account menu, or press the ? next to any menu item. Press Ctrl+K (Cmd+K on a Mac) any time to find anything.',
    ms: 'Perlukan bantuan nanti? Buka Bantuan di menu akaun anda, atau tekan ? di sebelah mana-mana item menu. Tekan Ctrl+K (Cmd+K pada Mac) bila-bila masa untuk mencari apa sahaja.' },
  link: { href: '#/help', label: { en: 'Open Help', ms: 'Buka Bantuan' } },
}

const OWNER: Step[] = [
  { id: 'home', route: 'home', sel: '[data-tour="home-stats"] || [aria-label="Quick actions"]',
    title: { en: 'Your day at a glance', ms: 'Ringkasan hari anda' },
    body: { en: 'Home shows what needs a person: documents to review, open quotes and replies you are waiting for. Every number is a link to its list.',
      ms: 'Laman Utama menunjukkan perkara yang perlukan perhatian anda: dokumen untuk disemak, sebut harga terbuka dan balasan yang ditunggu. Setiap nombor ialah pautan ke senarainya.' } },
  { id: 'settings', sel: nav('settings'), doRoute: 'settings',
    title: { en: 'Open Settings', ms: 'Buka Tetapan' },
    body: { en: 'Click Settings. Set your business name, logo, margin floor and the details printed on your quotes.',
      ms: 'Klik Tetapan. Tetapkan nama perniagaan, logo, margin minimum dan butiran yang dicetak pada sebut harga anda.' } },
  { id: 'channels', route: 'settings', sel: '[data-tour="bot-create"] || [data-tour="bot-card"]', doClick: true,
    reveal: () => document.querySelectorAll<HTMLElement>('[data-guide="st-tabs"] button')[3],
    title: { en: 'Connect your customer bot', ms: 'Sambungkan bot pelanggan anda' },
    body: { en: 'Customers message this Telegram bot to ask for quotes. Press Create my bot in Telegram, tap Create there, then come back.',
      ms: 'Pelanggan menghantar mesej kepada bot Telegram ini untuk meminta sebut harga. Tekan Create my bot in Telegram, tekan Create di sana, kemudian kembali ke sini.' } },
  { id: 'team', route: 'team', sel: '[data-tour="team-invite"]',
    title: { en: 'Invite your team', ms: 'Jemput pasukan anda' },
    body: { en: 'Invite staff by email. When they have joined, press Link Telegram beside their name so they can send photos and price lists from their phone.',
      ms: 'Jemput kakitangan melalui e-mel. Selepas mereka menyertai, tekan Link Telegram di sebelah nama mereka supaya mereka boleh menghantar gambar dan senarai harga dari telefon.' } },
  { id: 'tryit', route: 'tracker', sel: '#Sent', sim: true,
    title: { en: 'Try it', ms: 'Cuba sekarang' },
    body: { en: 'Send "50 kg PLA, how much?" to your bot. LARIS reads it and drafts a quote in this Sent column. No bot yet? Simulate an enquiry instead.',
      ms: 'Hantar "50 kg PLA, berapa harga?" kepada bot anda. LARIS membacanya dan menyediakan draf sebut harga dalam lajur Sent ini. Belum ada bot? Cuba simulasi pertanyaan.' } },
  { id: 'draft', sel: '#Sent ~ ul a.row || #Sent', doRoute: 'doc',
    title: { en: 'Open the draft quote', ms: 'Buka draf sebut harga' },
    body: { en: 'Open a draft to see its lines, the prices taken from your cost book and the margin check.',
      ms: 'Buka satu draf untuk melihat barisannya, harga daripada buku kos anda dan semakan margin.' } },
  { id: 'approve', sel: 'section[aria-labelledby="actions"]', soft: true, need: 'decide_quotes',
    title: { en: 'Approve, then send', ms: 'Luluskan, kemudian hantar' },
    body: { en: 'In the Decision box press Approve quote, then Send quote to customer. Only an owner can approve.',
      ms: 'Dalam kotak Decision tekan Approve quote, kemudian Send quote to customer. Hanya pemilik boleh meluluskan.' } },
  { id: 'follow', sel: `${nav('track')} || ${nav('followups')} || ${nav('jobs')}`,
    title: { en: 'Follow it through', ms: 'Ikuti sehingga selesai' },
    body: { en: 'Schedule follows each item, Follow-ups lists quotes with no reply, and Jobs takes over after a customer says yes.',
      ms: 'Jadual mengikuti setiap item, Follow-ups menyenaraikan sebut harga tanpa balasan, dan Jobs mengambil alih selepas pelanggan setuju.' } },
  help,
  { id: 'bot', bot: true,
    title: { en: 'Set up your customer bot now?', ms: 'Sediakan bot pelanggan anda sekarang?' },
    body: { en: 'You have no customer bot yet. It takes one tap in Telegram and LARIS fills in the name for you.',
      ms: 'Anda belum ada bot pelanggan. Hanya satu ketikan di Telegram dan LARIS mengisi nama untuk anda.' } },
]

const STAFF: Step[] = [
  { id: 'welcome', route: 'home', sel: '[aria-label="Quick actions"]', soft: true,
    title: { en: 'Welcome', ms: 'Selamat datang' },
    body: { en: 'You read supplier quotes, fix flagged lines and ask suppliers for prices. Approval, costs and margins stay with the owner.',
      ms: 'Anda membaca sebut harga pembekal, membetulkan baris yang ditanda dan meminta harga daripada pembekal. Kelulusan, kos dan margin kekal dengan pemilik.' } },
  { id: 'link', route: 'account', sel: '[data-tour="account-telegram"]',
    title: { en: 'Link your Telegram', ms: 'Pautkan Telegram anda' },
    body: { en: 'Press Link my Telegram, open the link on your phone and press Start. Then you can send files to LARIS from Telegram.',
      ms: 'Tekan Link my Telegram, buka pautan di telefon anda dan tekan Start. Selepas itu anda boleh menghantar fail kepada LARIS dari Telegram.' } },
  { id: 'price', route: 'home', sel: '[aria-label="Quick actions"] a[href="#/tracker/upload"]', doRoute: 'tracker', need: 'upload_documents',
    title: { en: 'Add a price', ms: 'Tambah harga' },
    body: { en: 'Send a supplier PDF or photo to the bot, or press Upload quote here. A product photo with the caption /catalog goes to Catalog photos.',
      ms: 'Hantar PDF atau gambar pembekal kepada bot, atau tekan Upload quote di sini. Gambar produk dengan kapsyen /catalog masuk ke Catalog photos.' } },
  { id: 'review', route: 'home', sel: 'a[href="#/tracker/review"]', doRoute: 'tracker', need: 'upload_documents',
    title: { en: 'Documents to review', ms: 'Dokumen untuk disemak' },
    body: { en: 'Open Documents to review, fix any flagged line, then save it. The document then waits for the owner.',
      ms: 'Buka Documents to review, betulkan baris yang ditanda, kemudian simpan. Dokumen itu kemudian menunggu pemilik.' } },
  { id: 'ask', sel: nav('ask'), need: 'ask_suppliers',
    title: { en: 'Ask suppliers', ms: 'Tanya pembekal' },
    body: { en: 'Photograph an item and ask your suppliers for a price in one go.',
      ms: 'Ambil gambar sesuatu item dan tanya harga daripada pembekal anda sekali gus.' } },
  help,
]

export interface Ctx { can: (k: string) => boolean; canOpen: (route: string) => boolean; bot: boolean }

/** Steps this person can really use: no permission, no closed page, no bot card when a bot exists. */
export function buildSteps(kind: TourKind, c: Ctx): Step[] {
  return (kind === 'owner' ? OWNER : STAFF)
    .filter(s => !(s.need && !c.can(s.need)) && ![s.route, s.doRoute].some(r => r && !c.canOpen(r)) && !(s.bot && c.bot))
    .map(s => (s.sim && c.bot ? { ...s, sim: false, sel: '#Sent' } : s.sim ? { ...s, sel: '[data-guide="tk-sim"] || #Sent' } : s))
}

export const kindFor = (owner: boolean, canCosts: boolean): TourKind => (owner || canCosts ? 'owner' : 'staff')

/** The question card: first-timers, and "ask me later" up to twice (the server turns the second later into skipped). */
export const firstRunVisible = (v: Onb) => v.state === 'new' || (v.state === 'later' && v.later_count < 2)
export const resumable = (v: Onb) => v.state === 'in_progress' && v.step > 0

/** Same transition the server applies, used for the instant UI update and the local fallback. */
export function applyOnb(cur: Onb, p: OnbPatch): Onb {
  const later = p.state === 'later'
  return { tour: p.tour ?? cur.tour, state: later && cur.later_count >= 1 ? 'skipped' : p.state, step: p.step ?? cur.step, later_count: cur.later_count + (later ? 1 : 0) }
}

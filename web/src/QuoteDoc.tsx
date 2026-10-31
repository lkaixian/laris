import { useEffect, useRef, useState } from 'react'
import { api, ApiError, blobUrl, can, download, MOCK, why } from './api'
import { msg, rm, useFetch } from './ui'
import { Icon } from './icons'
import { useToast } from './Toast'
import type { DocDetail } from './api'
import { locale, t, useLang } from './i18n'
import type { Text } from './i18n'
import { tx } from './strings'

const S = {
  email: { en: 'Email', ms: 'E-mel', zh: '电子邮件', ta: 'மின்னஞ்சல்' },
  unknownChan: { en: 'Unknown channel', ms: 'Saluran tidak diketahui', zh: '未知渠道', ta: 'அறியப்படாத சேனல்' },
  noEmail: { en: 'No email on file for this customer', ms: 'Tiada e-mel direkodkan untuk pelanggan ini', zh: '此客户没有电子邮件记录', ta: 'இந்த வாடிக்கையாளருக்கு மின்னஞ்சல் பதிவில் இல்லை' },
  noContact: { en: 'No chat contact on file', ms: 'Tiada kenalan sembang direkodkan', zh: '没有聊天联系方式记录', ta: 'அரட்டைத் தொடர்பு பதிவில் இல்லை' },
  urlMissing: { en: 'Set APP_PUBLIC_URL in the server settings first.', ms: 'Tetapkan APP_PUBLIC_URL dalam tetapan pelayan dahulu.', zh: '请先在服务器设置中配置 APP_PUBLIC_URL。', ta: 'முதலில் சர்வர் அமைப்புகளில் APP_PUBLIC_URL ஐ அமைக்கவும்.' },
  notLinkable: { en: 'This quote cannot be shared yet. Approve it first, then try again.', ms: 'Sebut harga ini belum boleh dikongsi. Luluskan dahulu, kemudian cuba lagi.', zh: '此报价暂时无法分享。请先批准，然后重试。', ta: 'இந்த மேற்கோளை இன்னும் பகிர முடியாது. முதலில் அங்கீகரித்து, பின் மீண்டும் முயற்சிக்கவும்.' },
  messages: { en: 'Messages', ms: 'Mesej', zh: '消息', ta: 'செய்திகள்' },
  popup: { en: 'Your browser blocked the new tab. Allow pop-ups for this site, or use Export, PDF.', ms: 'Pelayar anda menyekat tab baharu. Benarkan pop timbul untuk laman ini, atau guna Eksport, PDF.', zh: '您的浏览器拦截了新标签页。请允许此网站的弹出窗口，或使用“导出”中的 PDF。', ta: 'உங்கள் உலாவி புதிய தாவலைத் தடுத்தது. இந்தத் தளத்திற்கு பாப்-அப்களை அனுமதிக்கவும், அல்லது ஏற்றுமதி, PDF ஐப் பயன்படுத்தவும்.' },
  copyFail: { en: 'Could not copy automatically. The link is selected below: press Ctrl+C.', ms: 'Tidak dapat menyalin secara automatik. Pautan dipilih di bawah: tekan Ctrl+C.', zh: '无法自动复制。链接已在下方选中：请按 Ctrl+C。', ta: 'தானாக நகலெடுக்க முடியவில்லை. இணைப்பு கீழே தேர்ந்தெடுக்கப்பட்டுள்ளது: Ctrl+C அழுத்தவும்.' },
  preparing: { en: 'Preparing...', ms: 'Menyediakan...', zh: '准备中...', ta: 'தயாராகிறது...' },
  quoteDoc: { en: 'Quote document', ms: 'Dokumen sebut harga', zh: '报价文档', ta: 'மேற்கோள் ஆவணம்' },
  sendQuote: { en: 'Send quote', ms: 'Hantar sebut harga', zh: '发送报价', ta: 'மேற்கோளை அனுப்பு' },
  making: { en: 'Making link...', ms: 'Membuat pautan...', zh: '正在生成链接...', ta: 'இணைப்பை உருவாக்குகிறது...' },
  copyLink: { en: 'Copy customer link', ms: 'Salin pautan pelanggan', zh: '复制客户链接', ta: 'வாடிக்கையாளர் இணைப்பை நகலெடு' },
  export: { en: 'Export', ms: 'Eksport', zh: '导出', ta: 'ஏற்றுமதி' },
  opening: { en: 'Opening...', ms: 'Membuka...', zh: '正在打开...', ta: 'திறக்கிறது...' },
  openPdf: { en: 'Open PDF in a new tab', ms: 'Buka PDF dalam tab baharu', zh: '在新标签页中打开 PDF', ta: 'PDF ஐ புதிய தாவலில் திற' },
  ownerOnly: { en: 'Only the owner can send quotes.', ms: 'Hanya pemilik boleh menghantar sebut harga.', zh: '只有所有者可以发送报价。', ta: 'உரிமையாளர் மட்டுமே மேற்கோள்களை அனுப்ப முடியும்.' },
  customerLink: { en: 'Customer link', ms: 'Pautan pelanggan', zh: '客户链接', ta: 'வாடிக்கையாளர் இணைப்பு' },
  linkHelp: { en: 'Copy customer link gives you a page where your customer can read this quote and accept it by typing their name. The signature is simulated, not a legal e-signature.', ms: 'Salin pautan pelanggan memberi anda halaman di mana pelanggan boleh membaca sebut harga ini dan menerimanya dengan menaip nama mereka. Tandatangan ini adalah simulasi, bukan tandatangan elektronik yang sah di sisi undang-undang.', zh: '“复制客户链接”会生成一个页面，客户可在其中阅读此报价并输入姓名接受。该签名为模拟签名，不是具有法律效力的电子签名。', ta: '“வாடிக்கையாளர் இணைப்பை நகலெடு” என்பது, வாடிக்கையாளர் இந்த மேற்கோளைப் படித்து தங்கள் பெயரை உள்ளிட்டு ஏற்கக்கூடிய பக்கத்தை வழங்கும். இந்தக் கையொப்பம் உருவகப்படுத்தப்பட்டது, சட்டப்பூர்வ மின்னணு கையொப்பம் அல்ல.' },
  custFiles: { en: 'Customer files', ms: 'Fail pelanggan', zh: '客户文件', ta: 'வாடிக்கையாளர் கோப்புகள்' },
  internal: { en: 'Internal (with cost and margin)', ms: 'Dalaman (dengan kos dan margin)', zh: '内部（含成本和利润）', ta: 'உள் பயன்பாடு (செலவு மற்றும் மார்ஜினுடன்)' },
  internalWarn: { en: 'Internal files show costs and margins. Do not send them to customers.', ms: 'Fail dalaman memaparkan kos dan margin. Jangan hantar kepada pelanggan.', zh: '内部文件包含成本和利润，请勿发送给客户。', ta: 'உள் கோப்புகள் செலவுகளையும் மார்ஜினையும் காட்டும். வாடிக்கையாளர்களுக்கு அனுப்ப வேண்டாம்.' },
  hidePrev: { en: 'Hide preview', ms: 'Sembunyikan pratonton', zh: '隐藏预览', ta: 'முன்னோட்டத்தை மறை' },
  showPrev: { en: 'Show preview', ms: 'Tunjuk pratonton', zh: '显示预览', ta: 'முன்னோட்டத்தைக் காட்டு' },
  customer: { en: 'Customer', ms: 'Pelanggan', zh: '客户', ta: 'வாடிக்கையாளர்' },
  total: { en: 'Total', ms: 'Jumlah', zh: '合计', ta: 'மொத்தம்' },
  validUntil: { en: 'Valid until', ms: 'Sah sehingga', zh: '有效期至', ta: 'செல்லுபடியாகும் வரை' },
  receives: { en: 'This is what your customer receives. Costs and margins are never on it.', ms: 'Inilah yang diterima pelanggan anda. Kos dan margin tidak pernah ada padanya.', zh: '这是您的客户收到的内容，其中不会出现成本和利润。', ta: 'இதுவே உங்கள் வாடிக்கையாளருக்குக் கிடைப்பது. செலவுகளும் மார்ஜினும் இதில் ஒருபோதும் இடம்பெறாது.' },
  loadingPrev: { en: 'Loading preview...', ms: 'Memuatkan pratonton...', zh: '正在加载预览...', ta: 'முன்னோட்டம் ஏற்றப்படுகிறது...' },
  mock: { en: '{t(S.mock)}', ms: 'Mod olok-olok: eksport ialah fail sampel kecil.', zh: '模拟模式：导出的是很小的示例文件。', ta: 'மாதிரி பயன்முறை: ஏற்றுமதிகள் சிறிய மாதிரிக் கோப்புகள்.' },
  notSendable: { en: 'This quote cannot be sent right now. Reload the page to see where it stands.', ms: 'Sebut harga ini tidak boleh dihantar sekarang. Muat semula halaman untuk melihat keadaannya.', zh: '此报价目前无法发送。请刷新页面查看最新状态。', ta: 'இந்த மேற்கோளை இப்போது அனுப்ப முடியாது. நிலையைப் பார்க்க பக்கத்தை மீண்டும் ஏற்றவும்.' },
  noEmail422: { en: 'No email on file for this customer. Add one to the contact or pick another channel.', ms: 'Tiada e-mel direkodkan untuk pelanggan ini. Tambah pada kenalan atau pilih saluran lain.', zh: '此客户没有电子邮件记录。请在联系人中添加，或选择其他渠道。', ta: 'இந்த வாடிக்கையாளருக்கு மின்னஞ்சல் பதிவில் இல்லை. தொடர்பில் ஒன்றைச் சேர்க்கவும் அல்லது வேறு சேனலைத் தேர்ந்தெடுக்கவும்.' },
  noContact422: { en: 'No chat contact on file for this customer. Add one to the contact or pick another channel.', ms: 'Tiada kenalan sembang direkodkan untuk pelanggan ini. Tambah pada kenalan atau pilih saluran lain.', zh: '此客户没有聊天联系方式记录。请在联系人中添加，或选择其他渠道。', ta: 'இந்த வாடிக்கையாளருக்கு அரட்டைத் தொடர்பு பதிவில் இல்லை. தொடர்பில் ஒன்றைச் சேர்க்கவும் அல்லது வேறு சேனலைத் தேர்ந்தெடுக்கவும்.' },
  licence: { en: 'Sending needs an active licence. See the notice at the top of the page.', ms: 'Penghantaran memerlukan lesen aktif. Lihat notis di bahagian atas halaman.', zh: '发送需要有效的许可证。请查看页面顶部的提示。', ta: 'அனுப்புவதற்கு செயலில் உள்ள உரிமம் தேவை. பக்கத்தின் மேலுள்ள அறிவிப்பைப் பார்க்கவும்.' },
  gone: { en: 'This quote no longer exists.', ms: 'Sebut harga ini tidak lagi wujud.', zh: '此报价已不存在。', ta: 'இந்த மேற்கோள் இனி இல்லை.' },
  noGo: { en: 'the message did not go through', ms: 'mesej tidak berjaya dihantar', zh: '消息未能送出', ta: 'செய்தி செல்லவில்லை' },
  marks: { en: 'Sending marks the quote as sent.', ms: 'Penghantaran menandakan sebut harga sebagai dihantar.', zh: '发送后，报价将标记为已发送。', ta: 'அனுப்பியதும் மேற்கோள் அனுப்பப்பட்டதாகக் குறிக்கப்படும்.' },
  sendBy: { en: 'Send by', ms: 'Hantar melalui', zh: '发送方式', ta: 'அனுப்பும் வழி' },
  noChan: { en: 'No channel is set up for this customer.', ms: 'Tiada saluran disediakan untuk pelanggan ini.', zh: '尚未为此客户设置渠道。', ta: 'இந்த வாடிக்கையாளருக்கு எந்த சேனலும் அமைக்கப்படவில்லை.' },
  available: { en: 'Available', ms: 'Tersedia', zh: '可用', ta: 'கிடைக்கும்' },
  unavailable: { en: 'Unavailable', ms: 'Tidak tersedia', zh: '不可用', ta: 'கிடைக்காது' },
  notAvailable: { en: 'Not available', ms: 'Tidak tersedia', zh: '不可用', ta: 'கிடைக்காது' },
  msgOpt: { en: 'Message (optional)', ms: 'Mesej (pilihan)', zh: '留言（可选）', ta: 'செய்தி (விருப்பம்)' },
  sending: { en: 'Sending...', ms: 'Menghantar...', zh: '发送中...', ta: 'அனுப்புகிறது...' },
  send: { en: 'Send', ms: 'Hantar', zh: '发送', ta: 'அனுப்பு' },
} satisfies Record<string, Text>
const dl = (name: string) => t({ en: `${name} downloaded.`, ms: `${name} dimuat turun.`, zh: `已下载 ${name}。`, ta: `${name} பதிவிறக்கப்பட்டது.` })

// Quote document: preview (rendered from the JSON model, never an embedded PDF: the CSP has object-src 'none' and no frame-src for blob:),
// export menu and send dialog. Works for outgoing documents only (the preview route answers 404 for incoming ones).
interface PLine { no: number; description: string; qty: string | null; uom: string; unit_price: string | null; discount_pct: string | null; amount: string | null; is_header: boolean; section: string | null }
interface PChannel { channel: string; to_hint: string | null; available: boolean; reason?: string }
export interface Preview {
  doc_no: string | null; status: string
  customer: { name: string; attention: string | null; address: string | null; email: string | null }
  issued_on: string | null; valid_until: string | null; currency: string; lines: PLine[]
  subtotal: string | null; tax_total: string | null; total: string | null; payment_terms: string | null; terms_text: string | null
  issuer: { name: string; address: string | null; ssm_no: string | null; sst_no: string | null; email: string | null; phone: string | null; logo_url: string | null; brand_color: string | null; bank_details: string | null }
  channels: PChannel[]
}

const CHAN: Record<string, string> = { whatsapp: 'WhatsApp', telegram: 'Telegram' }
// Unknown channels are shown as written, capitalised, never a crash.
export const chanLabel = (c: unknown) => { const k = String(c ?? ''); return k === 'email' ? t(S.email) : CHAN[k] ?? (k ? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ') : t(S.unknownChan)) }
const REASON: Record<string, Text> = { no_email: S.noEmail, no_contact: S.noContact }
const linkFail = (e: unknown) => e instanceof ApiError && e.status === 409 && e.code === 'public_url_missing' ? t(S.urlMissing)
  : e instanceof ApiError && e.status === 409 && e.code === 'not_linkable' ? t(S.notLinkable) : msg(e)
const num = (s: string | null) => (s == null ? '' : Number(s).toLocaleString('en-MY', { maximumFractionDigits: 4 }))
const date = (s: string | null) => s ?? 'Not set'
// Readable text colour on the brand colour (same rule as applyBrand in ui.tsx). Only a strict #rrggbb is ever used.
function onColour(hex: string | null): { bg: string; fg: string } {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return { bg: '#0f5c47', fg: '#ffffff' }
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  const lin = (v: number) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  return { bg: hex, fg: 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.179 ? '#06140f' : '#ffffff' }
}

// The paper: always white with dark text (like the printed quote), whatever the app theme.
export function QuotePaper({ p }: { p: Preview }) {
  const { bg, fg } = onColour(p.issuer.brand_color)
  const disc = p.lines.some(l => !l.is_header && l.discount_pct != null && Number(l.discount_pct) !== 0)
  const i = p.issuer
  const sub = 'text-[#475a50]'
  const th = { backgroundColor: bg, color: fg }
  return (
    <article aria-label={`Quotation ${p.doc_no ?? ''}`} className="mx-auto min-w-0 max-w-[860px] rounded-card border border-hairline bg-white p-4 text-[#16231d] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 basis-60">
          {i.logo_url?.startsWith('data:image/') && <img src={i.logo_url} alt={i.name} className="mb-2 max-h-16 max-w-48 object-contain" />}
          <p className="break-words text-base font-semibold">{i.name}</p>
          <div className={`text-sm ${sub}`}>
            {i.address && <p className="whitespace-pre-line break-words">{i.address}</p>}
            {i.phone && <p>Tel: {i.phone}</p>}
            {i.email && <p className="break-all">{i.email}</p>}
            {i.ssm_no && <p>SSM: {i.ssm_no}</p>}
            {i.sst_no && <p>SST: {i.sst_no}</p>}
          </div>
        </div>
        <div className="min-w-0 text-left sm:text-right">
          <h3 className="text-xl font-semibold">Quotation {p.doc_no}</h3>
          <dl className="mt-1 grid grid-cols-[auto_auto] justify-start gap-x-3 text-sm sm:justify-end">
            <dt className={sub}>Issued</dt><dd>{date(p.issued_on)}</dd>
            <dt className={sub}>Valid until</dt><dd>{date(p.valid_until)}</dd>
          </dl>
        </div>
      </div>

      <div className="mt-4 text-sm">
        <p className={`text-xs font-semibold uppercase tracking-wide ${sub}`}>Prepared for</p>
        <p className="font-semibold">{p.customer.name}</p>
        {p.customer.attention && <p>Attn: {p.customer.attention}</p>}
        {p.customer.address && <p className="whitespace-pre-line break-words">{p.customer.address}</p>}
        {p.customer.email && <p className="break-all">{p.customer.email}</p>}
      </div>

      <div className="mt-4 max-w-full overflow-x-auto rounded-ui border border-[#dce7e0]" role="region" aria-label="Quote lines" tabIndex={0}>
        <table className="w-full min-w-[34rem]">
          <caption className="sr-only">Lines of quotation {p.doc_no}</caption>
          <thead><tr>
            <th scope="col" style={th}>No.</th><th scope="col" style={th}>Description</th>
            <th scope="col" className="text-right" style={th}>Qty</th><th scope="col" style={th}>Unit</th>
            <th scope="col" className="text-right" style={th}>Unit price</th>
            {disc && <th scope="col" className="text-right" style={th}>Discount</th>}
            <th scope="col" className="text-right" style={th}>Amount ({p.currency})</th>
          </tr></thead>
          <tbody>{p.lines.map(l => l.is_header
            ? <tr key={l.no} className="!border-[#dce7e0] bg-[#e1f0e8]"><th scope="colgroup" colSpan={disc ? 7 : 6} className="!text-[#16231d] text-sm">{l.section || l.description}</th></tr>
            : <tr key={l.no} className="!border-[#dce7e0]">
                <td>{l.no}</td><td className="min-w-40 break-words">{l.description}</td>
                <td className="num">{num(l.qty)}</td><td>{l.uom}</td>
                <td className="num whitespace-nowrap">{l.unit_price == null ? '' : rm(l.unit_price)}</td>
                {disc && <td className="text-right">{l.discount_pct != null && Number(l.discount_pct) !== 0 ? `${num(l.discount_pct)}%` : ''}</td>}
                <td className="num whitespace-nowrap">{l.amount == null ? '' : rm(l.amount)}</td>
              </tr>)}</tbody>
        </table>
      </div>

      <dl className="mt-3 ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-[#dce7e0] pt-2 text-sm">
        <dt className={sub}>Subtotal</dt><dd className="text-right">{rm(p.subtotal)}</dd>
        {p.tax_total != null && <><dt className={sub}>SST</dt><dd className="text-right">{rm(p.tax_total)}</dd></>}
        <dt className="font-semibold">Total</dt><dd className="text-right text-base font-semibold">{rm(p.total)}</dd>
      </dl>

      {p.payment_terms && <div className="mt-4 text-sm"><h4 className="font-semibold">Payment terms</h4><p className="whitespace-pre-line break-words">{p.payment_terms}</p></div>}
      {p.terms_text && <div className="mt-3 text-sm"><h4 className="font-semibold">Terms and conditions</h4><p className="whitespace-pre-line break-words">{p.terms_text}</p></div>}
      {i.bank_details && <div className="mt-3 text-sm"><h4 className="font-semibold">Bank details</h4><p className="whitespace-pre-line break-words">{i.bank_details}</p></div>}
    </article>
  )
}

// Messages sent to or received from the customer. Email shows as Email; an unknown channel is shown as written.
export function Messages({ list }: { list: DocDetail['messages'] }) {
  useLang()
  if (!list?.length) return null
  return (
    <section className="mt-6" aria-labelledby="msgs">
      <h2 id="msgs" className="mb-2 text-md font-semibold">{t(S.messages)}</h2>
      <ul className="grid gap-2">
        {list.map((m, n) => (
          <li key={n} className="card text-sm">
            <p className="text-muted">{(() => { const out = m.direction === 'out', c = chanLabel(m.channel), d = m.at ? new Date(m.at).toLocaleString(locale()) : ''; return t({ en: `${out ? 'Sent' : 'Received'} by ${c}${d ? ` on ${d}` : ''}`, ms: `${out ? 'Dihantar' : 'Diterima'} melalui ${c}${d ? ` pada ${d}` : ''}`, zh: `${out ? '发送' : '接收'}渠道：${c}${d ? `，时间：${d}` : ''}`, ta: `${c} மூலம் ${out ? 'அனுப்பப்பட்டது' : 'பெறப்பட்டது'}${d ? `, ${d}` : ''}` }) })()}</p>
            <p className="mt-1 whitespace-pre-line break-words">{m.body}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

const EXPORTS: { label: string; format: string; variant: 'customer' | 'internal'; ext: string }[] = [
  { label: 'PDF', format: 'pdf', variant: 'customer', ext: 'pdf' }, { label: 'Excel (.xlsx)', format: 'xlsx', variant: 'customer', ext: 'xlsx' }, { label: 'CSV', format: 'csv', variant: 'customer', ext: 'csv' },
  { label: 'Excel (.xlsx)', format: 'xlsx', variant: 'internal', ext: 'xlsx' }, { label: 'CSV', format: 'csv', variant: 'internal', ext: 'csv' },
]

export function QuotePanel({ id, status, owner, onChanged }: { id: string; status: string; owner: boolean; onChanged: () => void }) {
  useLang()
  const pv = useFetch<Preview>(`/documents/${id}/preview`)
  const toast = useToast()
  const [open, setOpen] = useState(status === 'draft' || status === 'approved')
  const [menu, setMenu] = useState(false)
  const [pending, setPending] = useState('')
  const [send, setSend] = useState(false)
  const [lk, setLk] = useState<{ url: string; until: string }>()
  const [lkBusy, setLkBusy] = useState(false)
  const [lkMsg, setLkMsg] = useState('')
  const lkField = useRef<HTMLInputElement>(null)
  const menuBtn = useRef<HTMLButtonElement>(null)
  const sendBtn = useRef<HTMLButtonElement>(null)
  const p = pv.data
  const internal = can('export_documents') && can('view_costs')
  const docNo = p?.doc_no ?? 'quote'
  const run = async (key: string, f: () => Promise<void>) => {
    if (pending) return
    setPending(key)
    try { await f() } catch (e) { toast.error(msg(e)) } finally { setPending('') }
  }
  const exp = (x: (typeof EXPORTS)[number]) => run(x.variant + x.format, async () => {
    const name = `${docNo}${x.variant === 'internal' ? '-internal' : ''}.${x.ext}`
    await download(`/documents/${id}/export?format=${x.format}&variant=${x.variant}`, name); toast(dl(name))
  })
  // The window opens first (inside the click) so pop-up blockers allow it, then points at the PDF blob. Revoked after a minute.
  const openPdf = () => run('open', async () => {
    const w = window.open('', '_blank')
    if (!w) throw new Error(t(S.popup))
    try { const u = await blobUrl(`/documents/${id}/export?format=pdf&variant=customer`); w.location.href = u; setTimeout(() => URL.revokeObjectURL(u), 60_000) }
    catch (e) { w.close(); throw e }
  })
  // Owner: make a fresh customer link (older ones stop) and copy it. If the browser refuses, the link sits in a selectable field.
  const copyLink = async () => {
    if (lkBusy) return
    setLkBusy(true); setLkMsg('')
    try {
      const r = await api<{ url: string; expires_at: string }>('POST', `/documents/${id}/accept-link`)
      const until = new Date(r.expires_at).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })
      setLk({ url: r.url, until })
      try { await navigator.clipboard.writeText(r.url); toast(t({ en: `Link copied. It works until ${until}.`, ms: `Pautan disalin. Sah sehingga ${until}.`, zh: `链接已复制，有效期至 ${until}。`, ta: `இணைப்பு நகலெடுக்கப்பட்டது. ${until} வரை செல்லும்.` })) }
      catch { setLkMsg(t(S.copyFail)); requestAnimationFrame(() => lkField.current?.select()) }
    } catch (e) { setLkMsg(linkFail(e)) } finally { setLkBusy(false) }
  }
  const keyClose = (e: React.KeyboardEvent) => { if (e.key === 'Escape' && menu) { e.stopPropagation(); setMenu(false); menuBtn.current?.focus() } }
  const sendable = ['approved', 'sent', 'read'].includes(status)
  const row = (v: 'customer' | 'internal') => EXPORTS.filter(x => x.variant === v).map(x => (
    <li key={x.variant + x.format}><button type="button" className="btn w-full justify-start" aria-disabled={!!pending || undefined} onClick={() => exp(x)}>
      {pending === x.variant + x.format ? t(S.preparing) : x.label}</button></li>))
  return (
    <section className="mb-6" aria-labelledby="qd">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="qd" className="text-md font-semibold">{t(S.quoteDoc)}</h2>
        <div className="flex flex-wrap items-center gap-2" onKeyDown={keyClose}>
          {sendable && <button ref={sendBtn} type="button" className="btn btn-primary" aria-expanded={send} aria-controls="send-box"
            {...(owner ? { onClick: () => setSend(v => !v) } : { 'aria-disabled': true as const, title: why('decide_quotes'), 'data-locked': true as const })}>{t(S.sendQuote)}</button>}
          {sendable && owner && <button type="button" className="btn" aria-disabled={lkBusy || undefined} onClick={copyLink}>{lkBusy ? t(S.making) : t(S.copyLink)}</button>}
          <button ref={menuBtn} type="button" className="btn" aria-expanded={menu} aria-controls="export-menu" onClick={() => setMenu(v => !v)}>{t(S.export)}<Icon name="down" className="ml-1 size-4" /></button>
          <button type="button" className="btn" aria-disabled={!!pending || undefined} onClick={openPdf}>{pending === 'open' ? t(S.opening) : t(S.openPdf)}</button>
        </div>
      </div>
      {sendable && !owner && <p className="mt-1 text-sm text-muted">{t(S.ownerOnly)}</p>}
      {sendable && owner && (lk || lkMsg) && (
        <div className="card mt-2 max-w-xl">
          {lk && <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.customerLink)}
            <input ref={lkField} readOnly className="input font-normal" value={lk.url} onFocus={e => e.currentTarget.select()} /></label>}
          {lk && <p className="mt-1 text-sm text-muted">{t({ en: `Works until ${lk.until}. Making a new link stops the older ones.`, ms: `Sah sehingga ${lk.until}. Membuat pautan baharu menghentikan pautan lama.`, zh: `有效期至 ${lk.until}。生成新链接后，旧链接将失效。`, ta: `${lk.until} வரை செல்லும். புதிய இணைப்பை உருவாக்கினால் பழையவை நின்றுவிடும்.` })}</p>}
          <p role="status" className="mt-1 text-sm text-warn empty:hidden">{lkMsg}</p>
        </div>
      )}
      {sendable && owner && <p className="mt-1 text-sm text-muted">{t(S.linkHelp)}</p>}
      {menu && (
        <div id="export-menu" className="card mt-2 grid max-w-xl gap-3 shadow-2 sm:grid-cols-2" onKeyDown={keyClose}>
          <div><h3 className="mb-1 text-sm font-semibold">{t(S.custFiles)}</h3><ul className="grid gap-2">{row('customer')}</ul></div>
          {internal && <div><h3 className="mb-1 text-sm font-semibold">{t(S.internal)}</h3><ul className="grid gap-2">{row('internal')}</ul>
            <p className="mt-2 text-sm text-warn">{t(S.internalWarn)}</p></div>}
        </div>
      )}
      {send && p && <SendBox id={id} status={status} p={p} onClose={() => { setSend(false); sendBtn.current?.focus() }} onSent={() => { setSend(false); pv.reload(); onChanged() }} />}
      <div className="mt-3">
        <button type="button" className="btn" aria-expanded={open} aria-controls="quote-preview" onClick={() => setOpen(v => !v)}>{open ? t(S.hidePrev) : t(S.showPrev)}</button>
      </div>
      <div id="quote-preview" className="mt-3" hidden={!open}>
        {p && (
          <dl className="mb-3 grid grid-cols-2 gap-3 glass-lite p-3 text-sm md:grid-cols-3">
            <div><dt className="text-muted">{t(S.customer)}</dt><dd className="font-semibold">{p.customer.name}</dd></div>
            <div><dt className="text-muted">{t(S.total)}</dt><dd className="font-semibold tabular-nums">{rm(p.total)}</dd></div>
            <div><dt className="text-muted">{t(S.validUntil)}</dt><dd className="tabular-nums">{date(p.valid_until)}</dd></div>
          </dl>
        )}
        <p className="mb-2 flex items-center gap-2 text-sm text-muted"><Icon name="inbox" className="size-4" />{t(S.receives)}</p>
        {pv.error ? <div role="alert" className="card border-warn bg-warn-bg text-sm text-warn"><p>{pv.error}</p><button type="button" className="btn mt-2" onClick={pv.reload}>{tx('common.retry')}</button></div>
          : !p ? <div role="status" aria-busy="true" className="skeleton h-40"><span className="sr-only">{t(S.loadingPrev)}</span></div> : <QuotePaper p={p} />}
      </div>
      {MOCK && <p className="sr-only">{t(S.mock)}</p>}
    </section>
  )
}

function SendBox({ id, status, p, onClose, onSent }: { id: string; status: string; p: Preview; onClose: () => void; onSent: () => void }) {
  useLang()
  const toast = useToast()
  const first = p.channels.find(c => c.available)?.channel ?? ''
  const [ch, setCh] = useState(first)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { (box.current?.querySelector<HTMLElement>('input[type=radio]:not(:disabled)') ?? box.current)?.focus() }, [])
  const fail = (e: unknown) => {
    if (!(e instanceof ApiError)) return msg(e)
    const m = msg(e)
    if (e.status === 409 && e.code === 'not_sendable') return t(S.notSendable)
    if (e.status === 422 && e.code === 'no_email') return t(S.noEmail422)
    if (e.status === 422 && e.code === 'no_contact') return t(S.noContact422)
    if (e.status === 422) return m
    if (e.status === 429) return t({ en: `You are sending too fast. Wait ${e.retryAfter ? `${e.retryAfter} seconds` : 'a moment'} and try again.`, ms: `Anda menghantar terlalu laju. Tunggu ${e.retryAfter ? `${e.retryAfter} saat` : 'sebentar'} dan cuba lagi.`, zh: `发送过于频繁。请等待${e.retryAfter ? ` ${e.retryAfter} 秒` : '片刻'}后重试。`, ta: `நீங்கள் மிக வேகமாக அனுப்புகிறீர்கள். ${e.retryAfter ? `${e.retryAfter} வினாடிகள்` : 'சிறிது நேரம்'} காத்திருந்து மீண்டும் முயற்சிக்கவும்.` })
    if (e.status === 403) return t(S.ownerOnly)
    if (e.status === 402) return t(S.licence)
    if (e.status === 404) return t(S.gone)
    return m
  }
  const go = async () => {
    if (busy || !ch) return
    setBusy(true); setErr('')
    try {
      const r = await api<{ delivery: { channel: string; status: string; error?: string }; status: string }>('POST', `/documents/${id}/send`, { channel: ch, ...(text.trim() ? { message: text.trim() } : {}) })
      if (r.delivery.status === 'delivered') { toast(t({ en: `Sent by ${chanLabel(r.delivery.channel)}`, ms: `Dihantar melalui ${chanLabel(r.delivery.channel)}`, zh: `已通过${chanLabel(r.delivery.channel)}发送`, ta: `${chanLabel(r.delivery.channel)} மூலம் அனுப்பப்பட்டது` })); onSent() }
      else { const failWhy = (r.delivery.error || t(S.noGo)).replace(/[. ]+$/, ''); setErr(t({ en: `Not sent: ${failWhy}. The quote stays as it is. Try another channel.`, ms: `Tidak dihantar: ${failWhy}. Sebut harga kekal seperti sedia ada. Cuba saluran lain.`, zh: `未发送：${failWhy}。报价保持不变。请尝试其他渠道。`, ta: `அனுப்பப்படவில்லை: ${failWhy}. மேற்கோள் அப்படியே இருக்கும். வேறு சேனலை முயற்சிக்கவும்.` })) }
    } catch (e) { setErr(fail(e)); if (e instanceof ApiError && e.status === 409) onSent() } finally { setBusy(false) }
  }
  return (
    <div ref={box} id="send-box" role="dialog" aria-labelledby="send-h" tabIndex={-1} className="card mt-2 max-w-xl shadow-3"
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <h3 id="send-h" className="text-md font-semibold">{t({ en: `Send quote ${p.doc_no}`, ms: `Hantar sebut harga ${p.doc_no}`, zh: `发送报价 ${p.doc_no}`, ta: `மேற்கோளை அனுப்பு ${p.doc_no}` })}</h3>
      {status === 'approved' && <p className="mt-1 text-sm text-muted">{t(S.marks)}</p>}
      <form className="mt-2 grid gap-3" onSubmit={e => { e.preventDefault(); go() }}>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold">{t(S.sendBy)}</legend>
          {p.channels.length === 0 && <p className="text-sm text-muted">{t(S.noChan)}</p>}
          {p.channels.map(c => (
            <label key={c.channel} className={`flex min-h-11 items-start gap-2 rounded-ui border border-line p-2 text-sm ${c.available ? '' : 'text-muted'}`}>
              <input type="radio" name="chan" className="mt-1" value={c.channel} disabled={!c.available} checked={ch === c.channel} onChange={() => setCh(c.channel)} aria-describedby={`chan-${c.channel}`} />
              <span><span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{chanLabel(c.channel)}</span><span className={`chip ${c.available ? 'chip-approved' : 'chip-expired'}`}>{c.available ? t(S.available) : t(S.unavailable)}</span></span>
                <span id={`chan-${c.channel}`} className="block">{c.available ? (c.to_hint ? t({ en: `To ${c.to_hint}`, ms: `Kepada ${c.to_hint}`, zh: `发送至 ${c.to_hint}`, ta: `பெறுநர்: ${c.to_hint}` }) : t(S.available)) : t(REASON[c.reason ?? ''] ?? S.notAvailable)}</span></span>
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.msgOpt)}
          <textarea className="input min-h-20 py-2 font-normal" maxLength={500} rows={3} value={text} onChange={e => setText(e.target.value)} aria-describedby="send-count" />
          <span id="send-count" className="text-xs font-normal text-muted">{t({ en: `${500 - text.length} characters left. Goes with the quote.`, ms: `${500 - text.length} aksara lagi. Dihantar bersama sebut harga.`, zh: `还可输入 ${500 - text.length} 个字符。将随报价一并发送。`, ta: `இன்னும் ${500 - text.length} எழுத்துகள். மேற்கோளுடன் செல்லும்.` })}</span></label>
        {err && <p role="alert" className="text-sm text-warn">{err}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primary" aria-disabled={busy || !ch || undefined}>{busy ? t(S.sending) : t(S.send)}</button>
          <button type="button" className="btn" onClick={onClose}>{tx('common.cancel')}</button>
        </div>
      </form>
    </div>
  )
}

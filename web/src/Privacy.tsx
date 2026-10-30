import { useEffect, useRef, useState } from 'react'
import { api, ApiError, download, getRole } from './api'
import { Async, Hint, PageHeader, useFetch, useAction, ActionError } from './ui'
import { useToast } from './Toast'
import { relTime } from './Timeline'
import { t, useLang, locale } from './i18n'
import type { Text } from './i18n'

interface Dpo { dpo_name: string | null; dpo_email: string | null; dpo_phone: string | null; require_optin: boolean; configured: boolean }
interface Incident {
  id: string; detected_at: string; occurred_at: string | null; harm_factors: string[]; summary: string; data_types: string[]; people_affected: number | null; significant_harm: boolean
  commissioner_notified_at: string | null; subjects_notified_at: string | null; status: 'open' | 'closed'; notes: string | null
  notifiable: boolean; commissioner_due: string; subjects_due: string | null; commissioner_overdue: boolean; subjects_overdue: boolean; hours_left: number | null
}
interface Breaches { incidents: Incident[]; rule_note: string }

const when = (s: string) => new Date(s).toLocaleString(locale())
const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16)  // value for datetime-local
const left = (h: number | null) => (h === null ? '' : h <= 0 ? ' ' + t({ en: '(overdue)', ms: '(lewat)', zh: '（已逾期）', ta: '(தாமதம்)' }) : ' ' + t({ en: `(${Math.round(h)} ${Math.round(h) === 1 ? 'hour' : 'hours'} left)`, ms: `(${Math.round(h)} jam lagi)`, zh: `（还剩 ${Math.round(h)} 小时）`, ta: `(${Math.round(h)} மணி நேரம் மீதம்)` }))

const CONFIRM_KEY = 'laris.confirm.incidents'  // per-viewer convenience: "0" means do not ask
const readConfirm = () => { try { return localStorage.getItem(CONFIRM_KEY) !== '0' } catch { return true } }
const writeConfirm = (on: boolean) => { try { localStorage.setItem(CONFIRM_KEY, on ? '1' : '0') } catch { /* private window: the choice lasts until reload */ } }

// The Commissioner's Breach Guideline lists these as signs of significant harm; any one means the affected people must be told too.
const HARM: [string, Text][] = [
  ['financial_loss', { en: 'Money could be lost, or a credit record damaged', ms: 'Wang boleh hilang, atau rekod kredit rosak', zh: '可能造成金钱损失或信用记录受损', ta: 'பணம் இழக்கப்படலாம் அல்லது கடன் பதிவு பாதிக்கப்படலாம்' }],
  ['misuse', { en: 'The data could be used for something illegal', ms: 'Data boleh disalahgunakan untuk perkara yang menyalahi undang-undang', zh: '数据可能被用于非法用途', ta: 'தரவு சட்டவிரோதமான ஒன்றுக்குப் பயன்படுத்தப்படலாம்' }],
  ['sensitive_data', { en: 'It includes sensitive data (health, religion, biometrics, financial)', ms: 'Ia termasuk data sensitif (kesihatan, agama, biometrik, kewangan)', zh: '涉及敏感数据（健康、宗教、生物特征、财务）', ta: 'இதில் உணர்திறன் தரவு உள்ளது (உடல்நலம், மதம், உயிரியல் அளவீடு, நிதி)' }],
  ['identity_fraud', { en: 'Combined with other details it could be used to pretend to be someone', ms: 'Digabungkan dengan butiran lain, ia boleh digunakan untuk menyamar sebagai seseorang', zh: '与其他信息结合后可能被用来冒充他人', ta: 'மற்ற விவரங்களுடன் சேர்த்து ஒருவரைப் போல நடிக்கப் பயன்படுத்தப்படலாம்' }],
  ['physical_harm', { en: 'Someone could be physically harmed or their property lost', ms: 'Seseorang boleh cedera, atau hartanya hilang', zh: '可能导致人身伤害或财产损失', ta: 'ஒருவர் உடல்ரீதியாகப் பாதிக்கப்படலாம் அல்லது சொத்து இழக்கப்படலாம்' }],
]

function DpoCard() {
  useLang()
  const s = useFetch<Dpo>('/settings/privacy')
  const [f, setF] = useState({ dpo_name: '', dpo_email: '', dpo_phone: '', require_optin: false })
  const a = useAction()
  const toast = useToast()
  useEffect(() => { if (s.data) setF({ dpo_name: s.data.dpo_name ?? '', dpo_email: s.data.dpo_email ?? '', dpo_phone: s.data.dpo_phone ?? '', require_optin: s.data.require_optin }) }, [s.data])
  const save = () => a.run(async () => { await api('POST', '/settings/privacy', f); toast(t({ en: 'Contact saved.', ms: 'Hubungan disimpan.', zh: '联系人已保存。', ta: 'தொடர்பு சேமிக்கப்பட்டது.' })); s.reload() })
  const field = (k: 'dpo_name' | 'dpo_email' | 'dpo_phone', name: string, type = 'text') => (
    <label className="flex flex-col gap-1 text-sm font-semibold">{name}
      <input className="input font-normal" type={type} maxLength={k === 'dpo_email' ? 254 : 120} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>
  )
  return (
    <section className="card mb-6" aria-labelledby="dpo" data-guide="pv-dpo">
      <h2 id="dpo" className="text-lg font-semibold">{t({ en: 'Who customers contact about their data', ms: 'Siapa yang dihubungi pelanggan tentang data mereka', zh: '客户就其数据应联系谁', ta: 'வாடிக்கையாளர்கள் தங்கள் தரவு பற்றி யாரைத் தொடர்பு கொள்வார்கள்' })}</h2>
      <p className="mt-1 text-sm text-muted">{t({ en: 'Customers need someone to ask about their data. Malaysia\'s PDPA requires a Data Protection Officer once a business handles personal data of more than 20,000 people (10,000 if it includes sensitive or financial data) or monitors people regularly; below that, a named contact is still good practice. If you do appoint a DPO, register them at daftar.pdp.gov.my within 21 days. This is not legal advice.', ms: 'Pelanggan memerlukan seseorang untuk ditanya tentang data mereka. PDPA Malaysia mewajibkan Pegawai Perlindungan Data apabila perniagaan mengendalikan data peribadi lebih daripada 20,000 orang (10,000 jika termasuk data sensitif atau kewangan) atau memantau orang secara tetap; di bawah itu, seorang yang dinamakan masih amalan baik. Jika anda melantik DPO, daftarkan di daftar.pdp.gov.my dalam masa 21 hari. Ini bukan nasihat undang-undang.', zh: '客户需要有人可以询问其数据。马来西亚 PDPA 规定，企业处理超过 20,000 人的个人数据（若含敏感或财务数据则为 10,000 人）或定期监控他人时，必须设立数据保护官；低于此标准，指定一位联系人仍是良好做法。如果您任命了数据保护官，请在 21 天内到 daftar.pdp.gov.my 登记。这不是法律意见。', ta: 'வாடிக்கையாளர்கள் தங்கள் தரவு பற்றி கேட்க ஒருவர் தேவை. 20,000 பேருக்கு மேற்பட்டவர்களின் (உணர்திறன் அல்லது நிதித் தரவு இருந்தால் 10,000) தனிப்பட்ட தரவைக் கையாளும்போது அல்லது மக்களைத் தொடர்ந்து கண்காணிக்கும்போது மலேசிய PDPA தரவுப் பாதுகாப்பு அதிகாரியைக் கோருகிறது; அதற்குக் கீழும் பெயரிடப்பட்ட தொடர்பு நல்ல நடைமுறை. DPO ஐ நியமித்தால் 21 நாட்களுக்குள் daftar.pdp.gov.my இல் பதிவு செய்யுங்கள். இது சட்ட ஆலோசனை அல்ல.' })}</p>
      <Async s={s} empty={false} rows={2}>
        {s.data && !s.data.configured && <p className="mt-2 font-semibold">{t({ en: 'Not set yet. Add a name and an email or phone number.', ms: 'Belum ditetapkan. Tambah nama dan e-mel atau nombor telefon.', zh: '尚未设置。请添加姓名以及邮箱或电话号码。', ta: 'இன்னும் அமைக்கப்படவில்லை. ஒரு பெயரையும் மின்னஞ்சல் அல்லது தொலைபேசி எண்ணையும் சேர்க்கவும்.' })}</p>}
        <form className="mt-3 grid max-w-xl gap-3" onSubmit={e => { e.preventDefault(); save() }}>
          {field('dpo_name', t({ en: 'Name', ms: 'Nama', zh: '姓名', ta: 'பெயர்' }))}{field('dpo_email', t({ en: 'Email', ms: 'E-mel', zh: '邮箱', ta: 'மின்னஞ்சல்' }), 'email')}{field('dpo_phone', t({ en: 'Phone', ms: 'Telefon', zh: '电话', ta: 'தொலைபேசி' }))}
          <label className="flex min-h-11 items-start gap-2 text-sm font-semibold"><input type="checkbox" className="mt-1" checked={f.require_optin} onChange={e => setF({ ...f, require_optin: e.target.checked })} /><span>{t({ en: 'Ask new customers to reply YES before their first enquiry is read', ms: 'Minta pelanggan baharu membalas YA sebelum pertanyaan pertama mereka dibaca', zh: '要求新客户先回复 YES，才读取其第一条咨询', ta: 'புதிய வாடிக்கையாளர்கள் முதல் விசாரணை படிக்கப்படும் முன் YES என்று பதிலளிக்கக் கேள்' })}<span className="block font-normal text-muted">{t({ en: 'Off: the privacy notice is shown once and the enquiry goes ahead. On: the enquiry waits until they agree, and the agreement is recorded.', ms: 'Mati: notis privasi ditunjukkan sekali dan pertanyaan diteruskan. Hidup: pertanyaan menunggu sehingga mereka bersetuju, dan persetujuan direkodkan.', zh: '关闭：隐私声明只显示一次，咨询照常处理。开启：咨询要等客户同意后才处理，并记录其同意。', ta: 'அணை: தனியுரிமை அறிவிப்பு ஒருமுறை காட்டப்பட்டு விசாரணை தொடரும். இயக்கு: அவர்கள் ஒப்புக்கொள்ளும் வரை விசாரணை காத்திருக்கும், ஒப்புதல் பதிவு செய்யப்படும்.' })}</span></span></label>
          <div><button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? t({ en: 'Saving...', ms: 'Menyimpan...', zh: '正在保存...', ta: 'சேமிக்கிறது...' }) : t({ en: 'Save contact', ms: 'Simpan hubungan', zh: '保存联系人', ta: 'தொடர்பைச் சேமி' })}</button></div>
        </form>
        <ActionError err={a.err} onRetry={save} label={t({ en: 'Retry saving', ms: 'Cuba simpan semula', zh: '重试保存', ta: 'சேமிப்பை மீண்டும் முயற்சி' })} />
      </Async>
    </section>
  )
}

function AddIncident({ onDone }: { onDone: () => void }) {
  useLang()
  const [f, setF] = useState({ detected_at: localNow(), occurred_at: '', summary: '', types: '', people: '', harm: false, factors: [] as string[] })
  const [err, setErr] = useState('')
  const a = useAction()
  const toast = useToast()
  const submit = () => {
    if (!f.summary.trim()) return setErr(t({ en: 'Write a short summary of what happened. Do not include names or phone numbers.', ms: 'Tulis ringkasan pendek tentang apa yang berlaku. Jangan sertakan nama atau nombor telefon.', zh: '请简要写下发生了什么。不要包含姓名或电话号码。', ta: 'என்ன நடந்தது என்பதன் சுருக்கத்தை எழுதுங்கள். பெயர்கள் அல்லது தொலைபேசி எண்களைச் சேர்க்க வேண்டாம்.' }))
    if (!f.detected_at) return setErr(t({ en: 'Enter when you found out.', ms: 'Masukkan bila anda mengetahuinya.', zh: '请输入您发现的时间。', ta: 'நீங்கள் எப்போது அறிந்தீர்கள் என்பதை உள்ளிடவும்.' }))
    setErr('')
    a.run(async () => {
      await api('POST', '/privacy/breaches', { detected_at: new Date(f.detected_at).toISOString(), occurred_at: f.occurred_at ? new Date(f.occurred_at).toISOString() : null, harm_factors: f.factors, summary: f.summary.trim(), significant_harm: f.harm || f.factors.length > 0,
        data_types: f.types.split(',').map(x => x.trim()).filter(Boolean), people_affected: f.people === '' ? null : Math.max(0, Math.floor(Number(f.people))) })
      toast(t({ en: 'Incident recorded.', ms: 'Insiden direkodkan.', zh: '事件已记录。', ta: 'சம்பவம் பதிவு செய்யப்பட்டது.' })); setF({ detected_at: localNow(), occurred_at: '', summary: '', types: '', people: '', harm: false, factors: [] }); onDone()
    })
  }
  return (
    <details className="card mb-4" data-guide="pv-add">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-accent">{t({ en: 'Add incident', ms: 'Tambah insiden', zh: '添加事件', ta: 'சம்பவத்தைச் சேர்' })}</summary>
      <form className="mt-2 grid max-w-xl gap-3" onSubmit={e => { e.preventDefault(); submit() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'When did you find out?', ms: 'Bila anda mengetahuinya?', zh: '您是何时发现的？', ta: 'நீங்கள் எப்போது அறிந்தீர்கள்?' })}
          <input type="datetime-local" className="input font-normal" value={f.detected_at} onChange={e => setF({ ...f, detected_at: e.target.value })} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'When did it happen? (if you know)', ms: 'Bila ia berlaku? (jika anda tahu)', zh: '事件发生于何时？（如果知道）', ta: 'இது எப்போது நடந்தது? (தெரிந்தால்)' })}
          <input type="datetime-local" className="input font-normal" aria-describedby="b-occ" value={f.occurred_at} onChange={e => setF({ ...f, occurred_at: e.target.value })} />
          <Hint id="b-occ">{t({ en: 'The 72 hours to tell the Commissioner count from the earlier of this and when you found out.', ms: '72 jam untuk memaklumkan Pesuruhjaya dikira dari yang lebih awal antara ini dan bila anda mengetahuinya.', zh: '通知专员的 72 小时，从此时间与您发现的时间中较早者起算。', ta: 'ஆணையருக்குத் தெரிவிக்கும் 72 மணி நேரம், இதிலும் நீங்கள் அறிந்த நேரத்திலும் முந்தியதிலிருந்து கணக்கிடப்படும்.' })}</Hint></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'What happened (short summary)', ms: 'Apa yang berlaku (ringkasan pendek)', zh: '发生了什么（简要说明）', ta: 'என்ன நடந்தது (சுருக்கம்)' })}
          <textarea className="input min-h-20 py-2 font-normal" maxLength={1000} aria-describedby="b-sum" value={f.summary} onChange={e => setF({ ...f, summary: e.target.value })} />
          <Hint id="b-sum">{t({ en: 'Do not write names, phone numbers or message text here.', ms: 'Jangan tulis nama, nombor telefon atau teks mesej di sini.', zh: '请勿在此填写姓名、电话号码或消息内容。', ta: 'பெயர்கள், தொலைபேசி எண்கள் அல்லது செய்தி உரையை இங்கே எழுத வேண்டாம்.' })}</Hint></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'What kinds of data (separate with commas)', ms: 'Jenis data apa (asingkan dengan koma)', zh: '涉及哪些类型的数据（用逗号分隔）', ta: 'என்ன வகையான தரவு (காற்புள்ளியால் பிரிக்கவும்)' })}
          <input className="input font-normal" placeholder={t({ en: 'name, phone number, address', ms: 'nama, nombor telefon, alamat', zh: '姓名、电话号码、地址', ta: 'பெயர், தொலைபேசி எண், முகவரி' })} value={f.types} onChange={e => setF({ ...f, types: e.target.value })} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'How many people are affected', ms: 'Berapa orang terjejas', zh: '受影响的人数', ta: 'எத்தனை பேர் பாதிக்கப்பட்டனர்' })}
          <input className="input w-40 font-normal" type="number" min="0" inputMode="numeric" value={f.people} onChange={e => setF({ ...f, people: e.target.value })} /></label>
        <fieldset className="grid gap-1">
          <legend className="text-sm font-semibold">{t({ en: 'Could this cause serious harm? Tick all that apply.', ms: 'Adakah ini boleh menyebabkan kemudaratan serius? Tandakan semua yang berkenaan.', zh: '这是否可能造成严重伤害？请勾选所有适用项。', ta: 'இது கடுமையான தீங்கை ஏற்படுத்துமா? பொருந்துவன அனைத்தையும் குறிக்கவும்.' })}</legend>
          {HARM.map(([k, label]) => (
            <label key={k} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={f.factors.includes(k)} onChange={e => setF({ ...f, factors: e.target.checked ? [...f.factors, k] : f.factors.filter(x => x !== k) })} /> {t(label)}</label>
          ))}
        </fieldset>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={f.harm} onChange={e => setF({ ...f, harm: e.target.checked })} /> {t({ en: 'Another kind of serious harm to the people affected', ms: 'Jenis kemudaratan serius lain kepada orang yang terjejas', zh: '对受影响的人造成的其他严重伤害', ta: 'பாதிக்கப்பட்டவர்களுக்கு மற்றொரு வகையான கடுமையான தீங்கு' })}</label>
        {err && <p role="alert" className="text-sm text-warn">{err}</p>}
        <div><button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? t({ en: 'Saving...', ms: 'Menyimpan...', zh: '正在保存...', ta: 'சேமிக்கிறது...' }) : t({ en: 'Add incident', ms: 'Tambah insiden', zh: '添加事件', ta: 'சம்பவத்தைச் சேர்' })}</button></div>
      </form>
      <ActionError err={a.err} onRetry={submit} label={t({ en: 'Retry saving', ms: 'Cuba simpan semula', zh: '重试保存', ta: 'சேமிப்பை மீண்டும் முயற்சி' })} />
    </details>
  )
}

function IncidentCard({ i, onDone, confirmOn }: { i: Incident; onDone: () => void; confirmOn: boolean }) {
  useLang()
  const [notes, setNotes] = useState(i.notes ?? '')
  const [pending, setPending] = useState<{ label: string; body: Record<string, unknown>; done: string } | null>(null)
  const confirmRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (pending) confirmRef.current?.focus() }, [pending])
  const a = useAction()
  const toast = useToast()
  const last = useRef(() => {})
  const open = i.status === 'open'
  const patch = (body: object, done: string) => { last.current = () => patch(body, done); a.run(async () => { await api('POST', `/privacy/breaches/${i.id}`, body); toast(done); onDone() }) }
  const cWait = i.notifiable && !i.commissioner_notified_at && open
  const sWait = !!i.subjects_due && !i.subjects_notified_at && open
  const overdue = i.commissioner_overdue || i.subjects_overdue
  const now = () => new Date().toISOString()
  const act = (label: string, body: Record<string, unknown>, done: string) => (confirmOn ? setPending({ label, body, done }) : patch(body, done))
  return (
    <li className={`card ${overdue ? 'border-warn bg-warn-bg' : ''}`}>
      <p className="flex flex-wrap items-center gap-2">
        <span className="badge">{open ? t({ en: 'Open', ms: 'Terbuka', zh: '未结', ta: 'திறந்தது' }) : t({ en: 'Closed', ms: 'Ditutup', zh: '已结', ta: 'மூடப்பட்டது' })}</span>
        {overdue && <span className="badge badge-warn">{t({ en: 'Overdue', ms: 'Lewat', zh: '已逾期', ta: 'தாமதம்' })}</span>}
        <span className="text-sm text-muted">{t({ en: `Found out ${when(i.detected_at)}`, ms: `Diketahui pada ${when(i.detected_at)}`, zh: `发现于 ${when(i.detected_at)}`, ta: `${when(i.detected_at)} அன்று அறியப்பட்டது` })}</span>
      </p>
      <p className="mt-2 font-semibold">{i.summary}</p>
      <p className="mt-1 text-sm">{i.notifiable ? t({ en: 'You must report this one (serious harm or many people).', ms: 'Anda mesti melaporkan yang ini (kemudaratan serius atau ramai orang).', zh: '此事件必须上报（严重伤害或涉及很多人）。', ta: 'இதை நீங்கள் புகாரளிக்க வேண்டும் (கடுமையான தீங்கு அல்லது பலர் பாதிப்பு).' }) : t({ en: 'Reporting is not required by the rule we check, but ask a professional if unsure.', ms: 'Pelaporan tidak diwajibkan oleh peraturan yang kami semak, tetapi tanya profesional jika tidak pasti.', zh: '我们核对的规则并不要求上报，但如不确定，请咨询专业人士。', ta: 'நாங்கள் சரிபார்க்கும் விதிப்படி புகாரளிப்பது கட்டாயமில்லை, ஆனால் உறுதியில்லையெனில் நிபுணரிடம் கேளுங்கள்.' })}</p>
      <p className="text-sm text-muted">{[i.people_affected !== null && t({ en: `${i.people_affected} ${i.people_affected === 1 ? 'person' : 'people'} affected`, ms: `${i.people_affected} orang terjejas`, zh: `${i.people_affected} 人受影响`, ta: `${i.people_affected} பேர் பாதிக்கப்பட்டனர்` }), i.data_types.length > 0 && i.data_types.join(', ')].filter(Boolean).join('. ')}</p>
      {i.notifiable && (
        <ul className="mt-2 grid gap-1 text-sm">
          <li className={i.commissioner_overdue ? 'font-semibold text-warn' : ''}>
            {i.commissioner_notified_at ? t({ en: `Commissioner told on ${when(i.commissioner_notified_at)}.`, ms: `Pesuruhjaya dimaklumkan pada ${when(i.commissioner_notified_at)}.`, zh: `已于 ${when(i.commissioner_notified_at)} 通知专员。`, ta: `${when(i.commissioner_notified_at)} அன்று ஆணையரிடம் தெரிவிக்கப்பட்டது.` })
              : i.commissioner_overdue ? t({ en: `Overdue: tell the Commissioner. The deadline was ${when(i.commissioner_due)}.`, ms: `Lewat: maklumkan Pesuruhjaya. Tarikh akhir ialah ${when(i.commissioner_due)}.`, zh: `已逾期：请通知专员。截止时间为 ${when(i.commissioner_due)}。`, ta: `தாமதம்: ஆணையரிடம் தெரிவிக்கவும். கடைசி நேரம் ${when(i.commissioner_due)}.` })
              : t({ en: `Tell the Commissioner by ${when(i.commissioner_due)}${cWait ? left(i.hours_left) : ''}.`, ms: `Maklumkan Pesuruhjaya sebelum ${when(i.commissioner_due)}${cWait ? left(i.hours_left) : ''}.`, zh: `请在 ${when(i.commissioner_due)} 前通知专员${cWait ? left(i.hours_left) : ''}。`, ta: `${when(i.commissioner_due)} க்குள் ஆணையரிடம் தெரிவிக்கவும்${cWait ? left(i.hours_left) : ''}.` })}
          </li>
          {i.subjects_due && <li className={i.subjects_overdue ? 'font-semibold text-warn' : ''}>
            {i.subjects_notified_at ? t({ en: `Affected people told on ${when(i.subjects_notified_at)}.`, ms: `Orang yang terjejas dimaklumkan pada ${when(i.subjects_notified_at)}.`, zh: `已于 ${when(i.subjects_notified_at)} 通知受影响的人。`, ta: `${when(i.subjects_notified_at)} அன்று பாதிக்கப்பட்டவர்களுக்குத் தெரிவிக்கப்பட்டது.` })
              : i.subjects_overdue ? t({ en: `Overdue: tell the affected people. The deadline was ${when(i.subjects_due)}.`, ms: `Lewat: maklumkan orang yang terjejas. Tarikh akhir ialah ${when(i.subjects_due)}.`, zh: `已逾期：请通知受影响的人。截止时间为 ${when(i.subjects_due)}。`, ta: `தாமதம்: பாதிக்கப்பட்டவர்களுக்குத் தெரிவிக்கவும். கடைசி நேரம் ${when(i.subjects_due)}.` })
              : t({ en: `Tell affected people by ${when(i.subjects_due)}${sWait && !cWait ? left(i.hours_left) : ''}.`, ms: `Maklumkan orang yang terjejas sebelum ${when(i.subjects_due)}${sWait && !cWait ? left(i.hours_left) : ''}.`, zh: `请在 ${when(i.subjects_due)} 前通知受影响的人${sWait && !cWait ? left(i.hours_left) : ''}。`, ta: `${when(i.subjects_due)} க்குள் பாதிக்கப்பட்டவர்களுக்குத் தெரிவிக்கவும்${sWait && !cWait ? left(i.hours_left) : ''}.` })}
          </li>}
          {!i.subjects_due && (i.significant_harm || i.harm_factors.length > 0) && <li>{t({ en: 'The date to tell affected people appears once the Commissioner is told.', ms: 'Tarikh untuk memaklumkan orang yang terjejas akan muncul selepas Pesuruhjaya dimaklumkan.', zh: '通知专员后，将显示通知受影响人员的日期。', ta: 'ஆணையரிடம் தெரிவித்த பிறகு, பாதிக்கப்பட்டவர்களுக்குத் தெரிவிக்க வேண்டிய தேதி தோன்றும்.' })}</li>}
        </ul>
      )}
      <details className="mt-3">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-accent">{t({ en: 'Update this incident', ms: 'Kemas kini insiden ini', zh: '更新此事件', ta: 'இந்தச் சம்பவத்தைப் புதுப்பி' })}<span className="sr-only">: {i.summary}</span></summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {!i.commissioner_notified_at && <button type="button" className="btn" aria-disabled={a.busy || undefined} onClick={() => act(t({ en: 'Commissioner told now', ms: 'Pesuruhjaya dimaklumkan sekarang', zh: '现已通知专员', ta: 'ஆணையரிடம் இப்போது தெரிவிக்கப்பட்டது' }), { commissioner_notified_at: now() }, t({ en: 'Marked: Commissioner told.', ms: 'Ditandakan: Pesuruhjaya dimaklumkan.', zh: '已标记：已通知专员。', ta: 'குறிக்கப்பட்டது: ஆணையரிடம் தெரிவிக்கப்பட்டது.' }))}>{t({ en: 'Commissioner told now', ms: 'Pesuruhjaya dimaklumkan sekarang', zh: '现已通知专员', ta: 'ஆணையரிடம் இப்போது தெரிவிக்கப்பட்டது' })}</button>}
          {!i.subjects_notified_at && <button type="button" className="btn" aria-disabled={a.busy || undefined} onClick={() => act(t({ en: 'Affected people told now', ms: 'Orang terjejas dimaklumkan sekarang', zh: '现已通知受影响的人', ta: 'பாதிக்கப்பட்டவர்களுக்கு இப்போது தெரிவிக்கப்பட்டது' }), { subjects_notified_at: now() }, t({ en: 'Marked: affected people told.', ms: 'Ditandakan: orang terjejas dimaklumkan.', zh: '已标记：已通知受影响的人。', ta: 'குறிக்கப்பட்டது: பாதிக்கப்பட்டவர்களுக்குத் தெரிவிக்கப்பட்டது.' }))}>{t({ en: 'Affected people told now', ms: 'Orang terjejas dimaklumkan sekarang', zh: '现已通知受影响的人', ta: 'பாதிக்கப்பட்டவர்களுக்கு இப்போது தெரிவிக்கப்பட்டது' })}</button>}
          {open && <button type="button" className="btn" aria-disabled={a.busy || undefined} onClick={() => act(t({ en: 'Close incident', ms: 'Tutup insiden', zh: '关闭事件', ta: 'சம்பவத்தை மூடு' }), { status: 'closed' }, t({ en: 'Incident closed.', ms: 'Insiden ditutup.', zh: '事件已关闭。', ta: 'சம்பவம் மூடப்பட்டது.' }))}>{t({ en: 'Close incident', ms: 'Tutup insiden', zh: '关闭事件', ta: 'சம்பவத்தை மூடு' })}</button>}
        </div>
        {pending && (
          <div ref={confirmRef} tabIndex={-1} role="group" aria-label={t({ en: 'Confirm this change', ms: 'Sahkan perubahan ini', zh: '确认此更改', ta: 'இந்த மாற்றத்தை உறுதிப்படுத்து' })} className="mt-3 grid gap-2 rounded-ui border border-warn p-3 text-sm">
            <p>{t({ en: 'Record on the register:', ms: 'Rekod dalam daftar:', zh: '记入登记册：', ta: 'பதிவேட்டில் பதிவு செய்:' })} <strong>{pending.label}</strong>. {t({ en: 'The time is saved now and shown in the audit log.', ms: 'Masa disimpan sekarang dan ditunjukkan dalam log audit.', zh: '时间会立即保存，并显示在审计日志中。', ta: 'நேரம் இப்போது சேமிக்கப்பட்டு தணிக்கைப் பதிவில் காட்டப்படும்.' })}{pending.body.status === 'closed' && ' ' + t({ en: 'A closed incident cannot be reopened from this page.', ms: 'Insiden yang ditutup tidak boleh dibuka semula dari halaman ini.', zh: '已关闭的事件无法在此页面重新打开。', ta: 'மூடப்பட்ட சம்பவத்தை இந்தப் பக்கத்திலிருந்து மீண்டும் திறக்க முடியாது.' })}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary" aria-disabled={a.busy || undefined} onClick={() => { const p = pending; setPending(null); patch(p.body, p.done) }}>{t({ en: 'Yes, record it', ms: 'Ya, rekodkan', zh: '是，记录', ta: 'ஆம், பதிவு செய்' })}</button>
              <button type="button" className="btn" onClick={() => setPending(null)}>{t({ en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து செய்' })}</button>
            </div>
          </div>
        )}
        <form className="mt-3 grid max-w-xl gap-2" onSubmit={e => { e.preventDefault(); patch({ notes: notes.trim() || null }, t({ en: 'Notes saved.', ms: 'Nota disimpan.', zh: '备注已保存。', ta: 'குறிப்புகள் சேமிக்கப்பட்டன.' })) }}>
          <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Notes', ms: 'Nota', zh: '备注', ta: 'குறிப்புகள்' })}
            <textarea className="input min-h-20 py-2 font-normal" maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
          <div><button type="submit" className="btn" aria-disabled={a.busy || undefined}>{t({ en: 'Save notes', ms: 'Simpan nota', zh: '保存备注', ta: 'குறிப்புகளைச் சேமி' })}</button></div>
        </form>
        <ActionError err={a.err} onRetry={() => last.current()} label={t({ en: 'Try again', ms: 'Cuba lagi', zh: '重试', ta: 'மீண்டும் முயற்சி' })} />
      </details>
    </li>
  )
}

function BreachRegister() {
  useLang()
  const s = useFetch<Breaches>('/privacy/breaches')
  const list = s.data?.incidents ?? []
  const [confirmOn, setConfirmOn] = useState(readConfirm)
  return (
    <section className="mb-6" aria-labelledby="breach" data-guide="pv-breach">
      <h2 id="breach" className="text-lg font-semibold">{t({ en: 'Breach register', ms: 'Daftar pelanggaran', zh: '数据泄露登记册', ta: 'மீறல் பதிவேடு' })}</h2>
      <p className="mb-3 mt-1 text-sm text-muted">{t({ en: 'Write down any time personal data was lost, sent to the wrong person or seen by someone who should not. Incidents are kept as a record and cannot be deleted.', ms: 'Catatkan setiap kali data peribadi hilang, dihantar kepada orang yang salah atau dilihat oleh orang yang tidak sepatutnya. Insiden disimpan sebagai rekod dan tidak boleh dipadam.', zh: '每当个人数据丢失、发送给错误的人或被不该看到的人看到时，请记录下来。事件会作为记录保留，无法删除。', ta: 'தனிப்பட்ட தரவு தொலைந்தாலோ, தவறான நபருக்கு அனுப்பப்பட்டாலோ, பார்க்கக்கூடாதவர் பார்த்தாலோ ஒவ்வொரு முறையும் எழுதி வையுங்கள். சம்பவங்கள் பதிவாகச் சேமிக்கப்படும், நீக்க முடியாது.' })}</p>
      <label className="mb-3 flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={confirmOn} onChange={e => { setConfirmOn(e.target.checked); writeConfirm(e.target.checked) }} />
        {t({ en: 'Ask me to confirm before changing an incident or a request', ms: 'Minta saya sahkan sebelum mengubah insiden atau permintaan', zh: '更改事件或请求前请先让我确认', ta: 'சம்பவம் அல்லது கோரிக்கையை மாற்றும் முன் என்னிடம் உறுதிப்படுத்தக் கேள்' })}
      </label>
      <AddIncident onDone={s.reload} />
      <Async s={s} rows={2} empty={!list.length} emptyText={t({ en: 'No incidents recorded.', ms: 'Tiada insiden direkodkan.', zh: '没有已记录的事件。', ta: 'பதிவு செய்யப்பட்ட சம்பவங்கள் இல்லை.' })} emptyHint={t({ en: 'That is good news. If something goes wrong, add it here the same day.', ms: 'Itu berita baik. Jika sesuatu berlaku, tambah di sini pada hari yang sama.', zh: '这是好消息。如果出了问题，请当天在此添加。', ta: 'இது நல்ல செய்தி. ஏதாவது தவறு நடந்தால், அதே நாளில் இங்கே சேர்க்கவும்.' })}>
        <p className="mb-3 border-l-4 border-l-amber pl-3 text-sm">{s.data?.rule_note} {t({ en: 'Confirm the deadlines at pdp.gov.my before you rely on them.', ms: 'Sahkan tarikh akhir di pdp.gov.my sebelum anda bergantung padanya.', zh: '在依赖这些截止时间之前，请到 pdp.gov.my 确认。', ta: 'இவற்றை நம்பும் முன் pdp.gov.my இல் கடைசி நேரங்களை உறுதிப்படுத்துங்கள்.' })}</p>
        <ul className="grid gap-3">{list.map(i => <IncidentCard key={i.id + i.status + (i.commissioner_notified_at ?? '') + (i.subjects_notified_at ?? '')} i={i} onDone={s.reload} confirmOn={confirmOn} />)}</ul>
      </Async>
    </section>
  )
}

interface Req { id: string; party_id: string; party_name: string; kind: 'erase' | 'export'; status: 'pending' | 'done' | 'dismissed'; channel: 'telegram' | 'whatsapp'; requested_at: string; decided_at: string | null }
const STATUS = {
  pending: { en: 'Pending', ms: 'Menunggu', zh: '待处理', ta: 'நிலுவையில்' },
  done: { en: 'Done', ms: 'Selesai', zh: '已完成', ta: 'முடிந்தது' },
  dismissed: { en: 'Dismissed', ms: 'Ditolak', zh: '已驳回', ta: 'நிராகரிக்கப்பட்டது' },
} satisfies Record<Req['status'], Text>
const FRIENDLY: Record<string, Text> = {
  already_decided: { en: 'This request was already dealt with. The list has been refreshed.', ms: 'Permintaan ini sudah diuruskan. Senarai telah dimuat semula.', zh: '此请求已处理。列表已刷新。', ta: 'இந்தக் கோரிக்கை ஏற்கெனவே கையாளப்பட்டது. பட்டியல் புதுப்பிக்கப்பட்டது.' },
  not_customer: { en: 'This person is not a customer, so their data cannot be erased here.', ms: 'Orang ini bukan pelanggan, jadi datanya tidak boleh dipadam di sini.', zh: '此人不是客户，因此无法在此删除其数据。', ta: 'இவர் வாடிக்கையாளர் அல்ல, எனவே இவரது தரவை இங்கே அழிக்க முடியாது.' },
  bad_action: { en: 'Only a request to erase can be erased. You can dismiss this one.', ms: 'Hanya permintaan untuk memadam boleh dipadam. Anda boleh menolak yang ini.', zh: '只有删除请求才能执行删除。您可以驳回这一条。', ta: 'அழிக்கக் கோரிய கோரிக்கையை மட்டுமே அழிக்க முடியும். இதை நீங்கள் நிராகரிக்கலாம்.' },
}

function DataRequests() {
  useLang()
  const s = useFetch<Req[]>('/privacy/requests')
  const [ask, setAsk] = useState<{ r: Req; action: 'erase' | 'dismiss' } | null>(null)
  const [note, setNote] = useState('')
  const confirmRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (ask) confirmRef.current?.focus() }, [ask])
  const a = useAction()
  const toast = useToast()
  const list = s.data ?? []
  const decide = (r: Req, action: 'erase' | 'dismiss') => {
    setAsk(null); setNote('')
    a.run(async () => {
      try { await api('POST', `/privacy/requests/${r.id}`, { action }) } catch (e) {
        const code = e instanceof ApiError ? e.code : ''
        if (FRIENDLY[code]) { if (e instanceof ApiError) e.shown = true; setNote(t(FRIENDLY[code])); s.reload(); return }
        throw e
      }
      const m = action === 'erase' ? t({ en: `Erased the personal data of ${r.party_name}. We tried to tell them in the chat; if it did not arrive, tell them yourself.`, ms: `Data peribadi ${r.party_name} telah dipadam. Kami cuba memaklumkan mereka dalam sembang; jika tidak sampai, maklumkan sendiri.`, zh: `已删除 ${r.party_name} 的个人数据。我们已尝试在聊天中通知对方；如果没有送达，请自行告知。`, ta: `${r.party_name} இன் தனிப்பட்ட தரவு அழிக்கப்பட்டது. அரட்டையில் தெரிவிக்க முயன்றோம்; அது சேரவில்லையெனில், நீங்களே தெரிவியுங்கள்.` }) : t({ en: `Dismissed. We tried to tell ${r.party_name} in the chat; if it did not arrive, tell them yourself.`, ms: `Ditolak. Kami cuba memaklumkan ${r.party_name} dalam sembang; jika tidak sampai, maklumkan sendiri.`, zh: `已驳回。我们已尝试在聊天中通知 ${r.party_name}；如果没有送达，请自行告知。`, ta: `நிராகரிக்கப்பட்டது. ${r.party_name} க்கு அரட்டையில் தெரிவிக்க முயன்றோம்; அது சேரவில்லையெனில், நீங்களே தெரிவியுங்கள்.` })
      setNote(m); toast(m); s.reload()
    })
  }
  const pick = (r: Req, action: 'erase' | 'dismiss') => { setNote(''); if (readConfirm()) setAsk({ r, action }); else decide(r, action) }
  const ch = (r: Req) => (r.channel === 'telegram' ? 'Telegram' : 'WhatsApp')
  return (
    <section className="card" aria-labelledby="dsr" data-guide="pv-requests">
      <h2 id="dsr" className="text-lg font-semibold">{t({ en: 'Customer data requests', ms: 'Permintaan data pelanggan', zh: '客户数据请求', ta: 'வாடிக்கையாளர் தரவு கோரிக்கைகள்' })}</h2>
      <p className="mt-1 text-sm">{t({ en: 'Customers can send /forget to your bot to ask you to erase their data. Nothing is erased until you decide here. To download a person\'s data, open their page in', ms: 'Pelanggan boleh menghantar /forget kepada bot anda untuk meminta anda memadam data mereka. Tiada apa dipadam sehingga anda memutuskan di sini. Untuk memuat turun data seseorang, buka halaman mereka dalam', zh: '客户可以向您的机器人发送 /forget，请求您删除其数据。在您于此处决定之前不会删除任何内容。要下载某人的数据，请在以下位置打开其页面：', ta: 'வாடிக்கையாளர்கள் தங்கள் தரவை அழிக்கக் கோர உங்கள் போட்டுக்கு /forget அனுப்பலாம். நீங்கள் இங்கே முடிவு செய்யும் வரை எதுவும் அழிக்கப்படாது. ஒருவரின் தரவைப் பதிவிறக்க, அவர்களின் பக்கத்தைத் திறக்கவும்:' })} <a className="link" href="#/contacts">{t({ en: 'Contacts', ms: 'Kenalan', zh: '联系人', ta: 'தொடர்புகள்' })}</a>.</p>
      {note && <p role="status" className="mt-2 text-sm font-semibold">{note}</p>}
      <Async s={s} rows={2} empty={!list.length} emptyText={t({ en: 'No requests from customers.', ms: 'Tiada permintaan daripada pelanggan.', zh: '没有来自客户的请求。', ta: 'வாடிக்கையாளர்களிடமிருந்து கோரிக்கைகள் இல்லை.' })} emptyHint={t({ en: 'Customers can send /forget to your bot.', ms: 'Pelanggan boleh menghantar /forget kepada bot anda.', zh: '客户可以向您的机器人发送 /forget。', ta: 'வாடிக்கையாளர்கள் உங்கள் போட்டுக்கு /forget அனுப்பலாம்.' })}>
        <ul className="mt-3 grid gap-3">
          {list.map(r => (
            <li key={r.id} className="rounded-ui border border-line p-3">
              <p className="flex flex-wrap items-center gap-2">
                <span className="badge">{t(STATUS[r.status])}</span>
                <a className="link break-words font-semibold" href={`#/contact/${r.party_id}`}>{r.party_name}</a>
              </p>
              <p className="mt-1 text-sm text-muted">{r.kind === 'erase' ? t({ en: `Asked to erase their data on ${ch(r)}.`, ms: `Meminta data mereka dipadam di ${ch(r)}.`, zh: `通过 ${ch(r)} 请求删除其数据。`, ta: `${ch(r)} இல் தங்கள் தரவை அழிக்கக் கோரினார்.` }) : t({ en: `Asked for a copy of their data on ${ch(r)}.`, ms: `Meminta salinan data mereka di ${ch(r)}.`, zh: `通过 ${ch(r)} 请求获取其数据副本。`, ta: `${ch(r)} இல் தங்கள் தரவின் நகலைக் கேட்டார்.` })}{' '}
                <time dateTime={r.requested_at} title={when(r.requested_at)}>{t({ en: `Asked ${relTime(r.requested_at)}`, ms: `Diminta ${relTime(r.requested_at)}`, zh: `请求于 ${relTime(r.requested_at)}`, ta: `கோரப்பட்டது ${relTime(r.requested_at)}` })}</time>.
                {r.decided_at && <> <time dateTime={r.decided_at} title={when(r.decided_at)}>{t({ en: `Decided ${relTime(r.decided_at)}`, ms: `Diputuskan ${relTime(r.decided_at)}`, zh: `决定于 ${relTime(r.decided_at)}`, ta: `முடிவு ${relTime(r.decided_at)}` })}</time>.</>}</p>
              {r.status === 'pending' && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.kind === 'erase' && <button type="button" className="btn btn-danger" aria-disabled={a.busy || undefined} onClick={() => pick(r, 'erase')}>{t({ en: 'Erase their data', ms: 'Padam data mereka', zh: '删除其数据', ta: 'அவர்களின் தரவை அழி' })}<span className="sr-only">: {r.party_name}</span></button>}
                  <button type="button" className="btn" aria-disabled={a.busy || undefined} onClick={() => pick(r, 'dismiss')}>{t({ en: 'Dismiss', ms: 'Tolak', zh: '驳回', ta: 'நிராகரி' })}<span className="sr-only">: {r.party_name}</span></button>
                </div>
              )}
              {ask?.r.id === r.id && (
                <div ref={confirmRef} tabIndex={-1} role="group" aria-label={t({ en: 'Confirm this request', ms: 'Sahkan permintaan ini', zh: '确认此请求', ta: 'இந்தக் கோரிக்கையை உறுதிப்படுத்து' })} className="mt-3 grid gap-2 rounded-ui border border-warn p-3 text-sm">
                  {ask.action === 'erase' ? <>
                    <p className="font-semibold">{t({ en: `Erase the personal data of ${r.party_name}? This cannot be undone.`, ms: `Padam data peribadi ${r.party_name}? Ini tidak boleh dibatalkan.`, zh: `删除 ${r.party_name} 的个人数据？此操作无法撤销。`, ta: `${r.party_name} இன் தனிப்பட்ட தரவை அழிக்கவா? இதைத் திரும்பப் பெற முடியாது.` })}</p>
                    <p><strong>{t({ en: 'Erased:', ms: 'Dipadam:', zh: '将删除：', ta: 'அழிக்கப்படுபவை:' })}</strong> {t({ en: 'name, contact, email, address, notes and the text of every message with this person.', ms: 'nama, hubungan, e-mel, alamat, nota dan teks setiap mesej dengan orang ini.', zh: '姓名、联系方式、邮箱、地址、备注以及与此人的所有消息内容。', ta: 'பெயர், தொடர்பு, மின்னஞ்சல், முகவரி, குறிப்புகள் மற்றும் இவருடனான ஒவ்வொரு செய்தியின் உரை.' })}</p>
                    <p><strong>{t({ en: 'Kept:', ms: 'Disimpan:', zh: '将保留：', ta: 'வைக்கப்படுபவை:' })}</strong> {t({ en: 'quotes and prices, kept as business records. Earlier entries in the audit log stay.', ms: 'sebut harga dan harga, disimpan sebagai rekod perniagaan. Entri terdahulu dalam log audit kekal.', zh: '报价和价格（作为业务记录保留）。审计日志中的早期记录会保留。', ta: 'வணிகப் பதிவுகளாக மேற்கோள்களும் விலைகளும். தணிக்கைப் பதிவில் உள்ள முந்தைய உள்ளீடுகள் அப்படியே இருக்கும்.' })}</p>
                    <p>{t({ en: `The customer is told on the same channel (${ch(r)}).`, ms: `Pelanggan dimaklumkan melalui saluran yang sama (${ch(r)}).`, zh: `客户会在同一渠道（${ch(r)}）收到通知。`, ta: `வாடிக்கையாளருக்கு அதே சேனலில் (${ch(r)}) தெரிவிக்கப்படும்.` })}</p>
                  </> : <>
                    <p className="font-semibold">{t({ en: `Dismiss this request from ${r.party_name}?`, ms: `Tolak permintaan ini daripada ${r.party_name}?`, zh: `驳回 ${r.party_name} 的这个请求？`, ta: `${r.party_name} இன் இந்தக் கோரிக்கையை நிராகரிக்கவா?` })}</p>
                    <p>{t({ en: 'Nothing is erased. The customer is told on the same channel that the business could not erase their data, and to contact your privacy contact (DPO).', ms: 'Tiada apa dipadam. Pelanggan dimaklumkan melalui saluran yang sama bahawa perniagaan tidak dapat memadam data mereka, dan diminta menghubungi pegawai privasi anda (DPO).', zh: '不会删除任何内容。客户会在同一渠道收到通知：企业无法删除其数据，请联系贵公司的隐私联系人（DPO）。', ta: 'எதுவும் அழிக்கப்படாது. வணிகத்தால் அவர்களின் தரவை அழிக்க முடியவில்லை என்றும், உங்கள் தனியுரிமைத் தொடர்பு நபரை (DPO) தொடர்பு கொள்ளுமாறும் வாடிக்கையாளருக்கு அதே சேனலில் தெரிவிக்கப்படும்.' })}</p>
                  </>}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={`btn ${ask.action === 'erase' ? 'btn-danger' : 'btn-primary'}`} onClick={() => decide(r, ask.action)}>{ask.action === 'erase' ? t({ en: 'Yes, erase it', ms: 'Ya, padamkan', zh: '是，删除', ta: 'ஆம், அழி' }) : t({ en: 'Yes, dismiss it', ms: 'Ya, tolak', zh: '是，驳回', ta: 'ஆம், நிராகரி' })}</button>
                    <button type="button" className="btn" onClick={() => setAsk(null)}>{t({ en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து செய்' })}</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Async>
      <ActionError err={a.err} onRetry={() => s.reload()} label={t({ en: 'Reload the list', ms: 'Muat semula senarai', zh: '重新加载列表', ta: 'பட்டியலை மீண்டும் ஏற்று' })} />
    </section>
  )
}

export function PrivacyView() {
  useLang()
  return (
    <>
      <PageHeader title={t({ en: 'Privacy and data', ms: 'Privasi dan data', zh: '隐私与数据', ta: 'தனியுரிமை மற்றும் தரவு' })} description={t({ en: 'Keep your privacy contact up to date, record data incidents and handle customer data requests.', ms: 'Kemas kini hubungan privasi anda, rekod insiden data dan uruskan permintaan data pelanggan.', zh: '保持隐私联系人信息最新，记录数据事件并处理客户数据请求。', ta: 'உங்கள் தனியுரிமைத் தொடர்பைப் புதுப்பித்து வையுங்கள், தரவுச் சம்பவங்களைப் பதிவு செய்யுங்கள், வாடிக்கையாளர் தரவு கோரிக்கைகளைக் கையாளுங்கள்.' })} />
      <DpoCard />
      <BreachRegister />
      <DataRequests />
    </>
  )
}

// Owner-only buttons on a contact page: download everything held about this person, and (customers only) erase their personal data.
export function PersonData({ id, name, customer, onDone }: { id: string; name: string; customer: boolean; onDone: () => void }) {
  useLang()
  const [ask, setAsk] = useState(false)
  const [res, setRes] = useState<{ messages_erased: number; replies_erased: number }>()
  const a = useAction()
  const toast = useToast()
  if (getRole() !== 'owner') return null
  const file = `data-${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'contact'}.json`
  const get = () => a.run(async () => { await download(`/parties/${id}/export`, file); toast(t({ en: `${file} downloaded.`, ms: `${file} dimuat turun.`, zh: `${file} 已下载。`, ta: `${file} பதிவிறக்கப்பட்டது.` })) })
  const erase = () => a.run(async () => { setRes(await api('POST', `/parties/${id}/erase`)); setAsk(false); toast(t({ en: 'Personal data erased.', ms: 'Data peribadi dipadam.', zh: '个人数据已删除。', ta: 'தனிப்பட்ட தரவு அழிக்கப்பட்டது.' })); onDone() })
  return (
    <section className="card mt-6" aria-labelledby="pd">
      <h2 id="pd" className="text-lg font-semibold">{t({ en: 'Personal data (owner only)', ms: 'Data peribadi (pemilik sahaja)', zh: '个人数据（仅限所有者）', ta: 'தனிப்பட்ட தரவு (உரிமையாளர் மட்டும்)' })}</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn" aria-disabled={a.busy || undefined} onClick={get}>{t({ en: "Download this person's data", ms: 'Muat turun data orang ini', zh: '下载此人的数据', ta: 'இவரது தரவைப் பதிவிறக்கு' })}</button>
        {customer && !ask && <button type="button" className="btn btn-danger" onClick={() => setAsk(true)}>{t({ en: "Erase this person's personal data", ms: 'Padam data peribadi orang ini', zh: '删除此人的个人数据', ta: 'இவரது தனிப்பட்ட தரவை அழி' })}</button>}
      </div>
      {ask && (
        <div role="group" aria-label={t({ en: 'Confirm erasing personal data', ms: 'Sahkan pemadaman data peribadi', zh: '确认删除个人数据', ta: 'தனிப்பட்ட தரவை அழிப்பதை உறுதிப்படுத்து' })} className="mt-3 grid gap-2 rounded-ui border border-warn p-3 text-sm">
          <p className="font-semibold">{t({ en: `Erase the personal data of ${name}? This cannot be undone.`, ms: `Padam data peribadi ${name}? Ini tidak boleh dibatalkan.`, zh: `删除 ${name} 的个人数据？此操作无法撤销。`, ta: `${name} இன் தனிப்பட்ட தரவை அழிக்கவா? இதைத் திரும்பப் பெற முடியாது.` })}</p>
          <p><strong>{t({ en: 'Erased:', ms: 'Dipadam:', zh: '将删除：', ta: 'அழிக்கப்படுபவை:' })}</strong> {t({ en: 'name, phone or chat number, email, address, notes, and the text of every message with this person.', ms: 'nama, nombor telefon atau sembang, e-mel, alamat, nota, dan teks setiap mesej dengan orang ini.', zh: '姓名、电话或聊天号码、邮箱、地址、备注以及与此人的所有消息内容。', ta: 'பெயர், தொலைபேசி அல்லது அரட்டை எண், மின்னஞ்சல், முகவரி, குறிப்புகள் மற்றும் இவருடனான ஒவ்வொரு செய்தியின் உரை.' })}</p>
          <p><strong>{t({ en: 'Kept:', ms: 'Disimpan:', zh: '将保留：', ta: 'வைக்கப்படுபவை:' })}</strong> {t({ en: 'the quotes, their lines, dates and prices, kept as business records. Earlier entries in the activity log cannot be removed. Telegram, Meta and the AI providers keep their own copies.', ms: 'sebut harga, baris, tarikh dan harganya, disimpan sebagai rekod perniagaan. Entri terdahulu dalam log aktiviti tidak boleh dibuang. Telegram, Meta dan penyedia AI menyimpan salinan mereka sendiri.', zh: '报价及其明细行、日期和价格（作为业务记录保留）。活动日志中的早期记录无法移除。Telegram、Meta 和 AI 服务提供商会保留各自的副本。', ta: 'வணிகப் பதிவுகளாக மேற்கோள்கள், அவற்றின் வரிகள், தேதிகள் மற்றும் விலைகள். செயல்பாட்டுப் பதிவில் உள்ள முந்தைய உள்ளீடுகளை நீக்க முடியாது. Telegram, Meta மற்றும் AI வழங்குநர்கள் தங்கள் சொந்த நகல்களை வைத்திருப்பர்.' })}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-danger" autoFocus aria-disabled={a.busy || undefined} onClick={erase}>{a.busy ? t({ en: 'Erasing...', ms: 'Memadam...', zh: '正在删除...', ta: 'அழிக்கிறது...' }) : t({ en: 'Yes, erase it', ms: 'Ya, padamkan', zh: '是，删除', ta: 'ஆம், அழி' })}</button>
            <button type="button" className="btn" onClick={() => setAsk(false)}>{t({ en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து செய்' })}</button>
          </div>
        </div>
      )}
      {res && <p role="status" className="mt-3 text-sm">{t({ en: `Done. ${res.messages_erased} ${res.messages_erased === 1 ? 'message' : 'messages'} and ${res.replies_erased} supplier ${res.replies_erased === 1 ? 'reply' : 'replies'} erased.`, ms: `Selesai. ${res.messages_erased} mesej dan ${res.replies_erased} balasan pembekal dipadam.`, zh: `完成。已删除 ${res.messages_erased} 条消息和 ${res.replies_erased} 条供应商回复。`, ta: `முடிந்தது. ${res.messages_erased} செய்திகளும் ${res.replies_erased} சப்ளையர் பதில்களும் அழிக்கப்பட்டன.` })}</p>}
      <ActionError err={a.err} onRetry={get} label={t({ en: 'Retry', ms: 'Cuba lagi', zh: '重试', ta: 'மீண்டும் முயற்சி' })} />
    </section>
  )
}

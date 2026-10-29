import { useEffect, useState } from 'react'
import { api, ApiError } from './api'
import { AiActivity } from './AiActivity'
import { Async, PageHeader, useFetch } from './ui'
import { useToast } from './Toast'
import { locale, t, useLang } from './i18n'
import type { Text } from './i18n'

/* Owner page: the optional AI guide (src/api/ai_guide.py). Off until the owner switches it on and confirms the disclosure. */
type Mode = 'off' | 'guide' | 'guide_data' | 'rag'
interface View {
  mode: Mode; provider: 'ilmu' | 'custom'; custom: { base_url: string; model: string; has_key: boolean }
  consent: { at: string | null; by: string | null; version: number | null }; disclosure: { version: number; text: string }; rag_disclosure: { version: number; text: string }
  available: { ilmu: boolean }; legacy_assistant: boolean
}

const S = {
  title: { en: 'AI settings', ms: 'Tetapan AI', zh: 'AI 设置', ta: 'AI அமைப்புகள்' },
  intro: { en: 'An optional helper that answers "where do I click?". It is OFF until you switch it on.', ms: 'Pembantu pilihan yang menjawab "di mana saya perlu klik?". Ia MATI sehingga anda menghidupkannya.', zh: '一个可选的小助手，回答“我该点哪里？”。您开启之前它一直是关闭的。', ta: '"எங்கே கிளிக் செய்வது?" என்பதற்குப் பதிலளிக்கும் விருப்ப உதவியாளர். நீங்கள் இயக்கும் வரை இது அணைந்தே இருக்கும்.' },
  legacy: { en: 'Your Assistant page still works as before until you save a choice here.', ms: 'Halaman Pembantu anda masih berfungsi seperti biasa sehingga anda menyimpan pilihan di sini.', zh: '在您于此保存选择之前，助手页面仍照常使用。', ta: 'இங்கே தேர்வைச் சேமிக்கும் வரை உங்கள் உதவியாளர் பக்கம் முன்பு போலவே செயல்படும்.' },
  mode: { en: 'What the helper may do', ms: 'Apa yang boleh dilakukan pembantu', zh: '助手可以做什么', ta: 'உதவியாளர் என்ன செய்யலாம்' },
  off: { en: 'Off', ms: 'Mati', zh: '关闭', ta: 'அணை' }, offH: { en: 'Nothing is sent to any AI service.', ms: 'Tiada apa dihantar kepada perkhidmatan AI.', zh: '不会向任何 AI 服务发送任何内容。', ta: 'எந்த AI சேவைக்கும் எதுவும் அனுப்பப்படாது.' },
  guide: { en: 'Guide only', ms: 'Panduan sahaja', zh: '仅指引', ta: 'வழிகாட்டி மட்டும்' },
  guideH: { en: 'Answers where to click. Sends only the question you type, with emails, phone numbers and ID numbers removed. Never your quotes, customers or costs.', ms: 'Menjawab di mana hendak klik. Hanya menghantar soalan yang anda taip, dengan emel, nombor telefon dan nombor ID dibuang. Tidak pernah sebut harga, pelanggan atau kos anda.', zh: '回答该点哪里。只发送您输入的问题，并已去除电邮、电话号码和身份证号码。绝不发送您的报价、客户或成本。', ta: 'எங்கே கிளிக் செய்வது என்பதற்குப் பதிலளிக்கும். நீங்கள் தட்டச்சு செய்த கேள்வியை மட்டும் அனுப்பும்; மின்னஞ்சல், தொலைபேசி எண், அடையாள எண் நீக்கப்படும். உங்கள் மேற்கோள்கள், வாடிக்கையாளர்கள், செலவுகள் ஒருபோதும் அனுப்பப்படாது.' },
  data: { en: 'Guide plus my data', ms: 'Panduan serta data saya', zh: '指引加我的数据', ta: 'வழிகாட்டி மற்றும் என் தரவு' },
  dataH: { en: 'The Assistant page also answers questions about your own quotes and contacts. It still sends only the question, never the records.', ms: 'Halaman Pembantu juga menjawab soalan tentang sebut harga dan kenalan anda sendiri. Ia tetap hanya menghantar soalan, bukan rekod.', zh: '助手页面也会回答关于您自己的报价和联系人的问题。它仍然只发送问题，不发送记录。', ta: 'உதவியாளர் பக்கம் உங்கள் சொந்த மேற்கோள்கள், தொடர்புகள் பற்றிய கேள்விகளுக்கும் பதிலளிக்கும். அது கேள்வியை மட்டுமே அனுப்பும், பதிவுகளை அல்ல.' },
  rag: { en: 'Guide plus my data, read by the AI', ms: 'Panduan serta data saya, dibaca oleh AI', zh: '指引加我的数据，由 AI 读取', ta: 'வழிகாட்டி மற்றும் என் தரவு, AI படிக்கும்' },
  ragH: { en: 'The Assistant can answer from short extracts of your quotes, contacts and catalog. Emails, phone numbers, ID and card numbers and the names in your contact book are hidden first; addresses are not. Each person only gets what their role may see. Needs its own agreement below.', ms: 'Pembantu boleh menjawab daripada petikan ringkas sebut harga, kenalan dan katalog anda. Emel, nombor telefon, nombor ID dan kad serta nama dalam buku kenalan disembunyikan dahulu; alamat tidak. Setiap orang hanya mendapat apa yang dibenarkan oleh peranan mereka. Memerlukan persetujuan tersendiri di bawah.', zh: '助手可根据您的报价、联系人和目录的简短摘录来回答。电邮、电话号码、身份证和卡号以及联系簿中的姓名会先被隐藏；地址不会。每个人只能获得其角色可查看的内容。需要在下方另行同意。', ta: 'உதவியாளர் உங்கள் மேற்கோள்கள், தொடர்புகள், பட்டியலின் சிறு பகுதிகளிலிருந்து பதிலளிக்கலாம். மின்னஞ்சல்கள், தொலைபேசி எண்கள், அடையாள மற்றும் அட்டை எண்கள், தொடர்புப் புத்தகப் பெயர்கள் முதலில் மறைக்கப்படும்; முகவரிகள் மறைக்கப்படாது. ஒவ்வொருவரும் தங்கள் பங்கு காணக்கூடியதை மட்டுமே பெறுவர். கீழே தனி ஒப்புதல் தேவை.' },
  prov: { en: 'Which AI service', ms: 'Perkhidmatan AI yang mana', zh: '使用哪个 AI 服务', ta: 'எந்த AI சேவை' },
  ilmu: { en: 'LARIS hosted ILMU', ms: 'ILMU yang dihoskan LARIS', zh: 'LARIS 托管的 ILMU', ta: 'LARIS வழங்கும் ILMU' },
  noIlmu: { en: 'Not available on this server. Choose your own AI server.', ms: 'Tidak tersedia pada pelayan ini. Pilih pelayan AI anda sendiri.', zh: '此服务器不提供。请选择您自己的 AI 服务器。', ta: 'இந்தச் சேவையகத்தில் கிடைக்காது. உங்கள் சொந்த AI சேவையகத்தைத் தேர்ந்தெடுக்கவும்.' },
  own: { en: 'My own AI server', ms: 'Pelayan AI saya sendiri', zh: '我自己的 AI 服务器', ta: 'என் சொந்த AI சேவையகம்' },
  ownNote: { en: 'It must be an https server that speaks the OpenAI format, on port 443 or 8443. Private network addresses are refused.', ms: 'Ia mesti pelayan https yang menggunakan format OpenAI, pada port 443 atau 8443. Alamat rangkaian peribadi ditolak.', zh: '必须是使用 OpenAI 格式的 https 服务器，端口为 443 或 8443。私有网络地址会被拒绝。', ta: 'OpenAI வடிவத்தைப் பயன்படுத்தும் https சேவையகமாக, போர்ட் 443 அல்லது 8443 இல் இருக்க வேண்டும். தனியார் வலைப்பின்னல் முகவரிகள் நிராகரிக்கப்படும்.' },
  url: { en: 'Server address', ms: 'Alamat pelayan', zh: '服务器地址', ta: 'சேவையக முகவரி' }, model: { en: 'Model name', ms: 'Nama model', zh: '模型名称', ta: 'மாதிரி பெயர்' }, key: { en: 'API key', ms: 'Kunci API', zh: 'API 密钥', ta: 'API விசை' },
  keySaved: { en: 'A key is saved. Leave blank to keep it.', ms: 'Satu kunci telah disimpan. Biarkan kosong untuk mengekalkannya.', zh: '已保存一个密钥。留空则保留。', ta: 'ஒரு விசை சேமிக்கப்பட்டுள்ளது. வைத்திருக்க காலியாக விடவும்.' },
  show: { en: 'Show', ms: 'Tunjuk', zh: '显示', ta: 'காட்டு' }, hide: { en: 'Hide', ms: 'Sembunyi', zh: '隐藏', ta: 'மறை' },
  notice: { en: 'What is sent', ms: 'Apa yang dihantar', zh: '会发送什么', ta: 'என்ன அனுப்பப்படும்' },
  agree: { en: 'I have read this and I will tell my customers in our privacy notice', ms: 'Saya telah membaca ini dan akan memberitahu pelanggan kami dalam notis privasi kami', zh: '我已阅读此内容，并会在我们的隐私声明中告知客户', ta: 'நான் இதைப் படித்தேன்; எங்கள் தனியுரிமை அறிவிப்பில் வாடிக்கையாளர்களுக்குத் தெரிவிப்பேன்' },
  save: { en: 'Save', ms: 'Simpan', zh: '保存', ta: 'சேமி' }, saving: { en: 'Saving...', ms: 'Menyimpan...', zh: '正在保存...', ta: 'சேமிக்கிறது...' }, saved: { en: 'AI settings saved.', ms: 'Tetapan AI disimpan.', zh: 'AI 设置已保存。', ta: 'AI அமைப்புகள் சேமிக்கப்பட்டன.' },
  test: { en: 'Test connection', ms: 'Uji sambungan', zh: '测试连接', ta: 'இணைப்பைச் சோதி' },
  by: { en: 'Switched on by', ms: 'Dihidupkan oleh', zh: '开启者', ta: 'இயக்கியவர்' }, on: { en: 'on', ms: 'pada', zh: '于', ta: 'அன்று' },
  needAgree: { en: 'Tick the box to confirm you have read the notice.', ms: 'Tandakan kotak untuk mengesahkan anda telah membaca notis.', zh: '请勾选方框，确认您已阅读声明。', ta: 'அறிவிப்பைப் படித்ததை உறுதிப்படுத்த பெட்டியைத் தேர்வு செய்யவும்.' },
  disclosure_required: { en: 'Tick the box to confirm you have read the notice, then save again.', ms: 'Tandakan kotak untuk mengesahkan anda telah membaca notis, kemudian simpan semula.', zh: '请勾选方框，确认您已阅读声明，然后再次保存。', ta: 'அறிவிப்பைப் படித்ததை உறுதிப்படுத்த பெட்டியைத் தேர்வு செய்து, மீண்டும் சேமிக்கவும்.' },
  secret_key_unset: { en: 'This server cannot store a key safely yet, so your own AI server cannot be saved. Ask whoever runs LARIS to set it up.', ms: 'Pelayan ini belum boleh menyimpan kunci dengan selamat, jadi pelayan AI anda sendiri tidak boleh disimpan. Minta orang yang menjalankan LARIS menyediakannya.', zh: '此服务器目前还无法安全地存储密钥，因此无法保存您自己的 AI 服务器。请联系负责运行 LARIS 的人员进行设置。', ta: 'இந்தச் சேவையகத்தால் இன்னும் விசையைப் பாதுகாப்பாகச் சேமிக்க முடியாது, எனவே உங்கள் சொந்த AI சேவையகத்தைச் சேமிக்க இயலாது. LARIS ஐ இயக்குபவரிடம் இதை அமைக்கச் சொல்லுங்கள்.' },
  custom_incomplete: { en: 'Please fill in the server address, the model name and the key.', ms: 'Sila isi alamat pelayan, nama model dan kunci.', zh: '请填写服务器地址、模型名称和密钥。', ta: 'சேவையக முகவரி, மாதிரி பெயர், விசை ஆகியவற்றை நிரப்பவும்.' },
  bad_url: { en: 'That address is not allowed. Use the public https address of your AI server, on port 443 or 8443.', ms: 'Alamat itu tidak dibenarkan. Guna alamat https awam pelayan AI anda, pada port 443 atau 8443.', zh: '不允许该地址。请使用您 AI 服务器的公开 https 地址，端口为 443 或 8443。', ta: 'அந்த முகவரி அனுமதிக்கப்படாது. உங்கள் AI சேவையகத்தின் பொது https முகவரியை போர்ட் 443 அல்லது 8443 இல் பயன்படுத்தவும்.' },
  unavailable: { en: 'The AI helper is not available right now. Nothing was changed.', ms: 'Pembantu AI tidak tersedia sekarang. Tiada apa yang diubah.', zh: 'AI 助手目前不可用。没有任何更改。', ta: 'AI உதவியாளர் இப்போது கிடைக்கவில்லை. எதுவும் மாற்றப்படவில்லை.' },
} satisfies Record<string, Text>
const CODES = ['disclosure_required', 'secret_key_unset', 'custom_incomplete', 'bad_url'] as const

export function AiSettingsView() {
  const [lang] = useLang()
  const s = useFetch<View>('/settings/ai')
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('off')
  const [prov, setProv] = useState<'ilmu' | 'custom'>('ilmu')
  const [url, setUrl] = useState(''); const [model, setModel] = useState(''); const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false); const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [status, setStatus] = useState('')
  const [v, setV] = useState<View>()
  const d = v ?? s.data
  const pick = (m: Mode) => { setMode(m); setAgree(false) }  // a tick given for one notice never carries over to another
  const load = (x: View) => { setV(x); setMode(x.mode); setProv(x.provider); setUrl(x.custom.base_url); setModel(x.custom.model); setKey(''); setAgree(false) }
  useEffect(() => { if (s.data) load(s.data) }, [s.data])

  const fail = (e: unknown) => {
    if (e instanceof ApiError) e.shown = true
    const c = e instanceof ApiError ? CODES.find(x => x === e.code) : undefined
    setErr(c ? t(S[c], lang) : e instanceof ApiError && (e.code === 'ai_unavailable' || e.status === 503) ? t(S.unavailable, lang) : e instanceof Error ? e.message : t({ en: 'Something went wrong.', ms: 'Sesuatu tidak kena.', zh: '出了点问题。', ta: 'ஏதோ தவறு நடந்துவிட்டது.' }, lang))
  }
  const save = async () => {
    setErr(''); setStatus('')
    if (mode !== 'off' && !agree) return setErr(t(S.needAgree, lang))
    setBusy(true)
    try {
      const x = await api<View>('POST', '/settings/ai', { mode, provider: prov, ...(prov === 'custom' ? { custom: { base_url: url.trim(), model: model.trim(), ...(key ? { api_key: key } : {}) } } : {}), accept_disclosure: agree })
      load(x); toast(t(S.saved, lang))
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const test = async () => {
    setErr(''); setStatus(''); setBusy(true)
    try { const r = await api<{ ok: boolean; message: string }>('POST', '/settings/ai/test'); setStatus(r.message) } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const radio = (name: string, on: boolean, set: () => void, title: string, hint?: string, off?: boolean) => (
    <label className={`flex min-h-11 items-start gap-2 py-1 text-sm ${off ? 'opacity-60' : ''}`}>
      <input type="radio" name={name} className="mt-0.5 size-5 shrink-0" checked={on} disabled={off} onChange={set} />
      <span className="min-w-0"><span className="block font-semibold">{title}</span>{hint && <span className="block text-muted">{hint}</span>}</span>
    </label>)

  return (
    <>
      <PageHeader title={t(S.title, lang)} description={t(S.intro, lang)} />
      <Async s={s} empty={false} rows={4}>
        {d && (
          <form className="grid max-w-3xl gap-5" onSubmit={e => { e.preventDefault(); if (!busy) save() }}>
            {d.legacy_assistant && <p className="card border-l-4 border-l-amber text-sm">{t(S.legacy, lang)}</p>}
            <fieldset className="grid gap-1" data-guide="ai-mode">
              <legend className="mb-1 text-sm font-semibold">{t(S.mode, lang)}</legend>
              {radio('ai-mode', mode === 'off', () => pick('off'), t(S.off, lang), t(S.offH, lang))}
              {radio('ai-mode', mode === 'guide', () => pick('guide'), t(S.guide, lang), t(S.guideH, lang))}
              {radio('ai-mode', mode === 'guide_data', () => pick('guide_data'), t(S.data, lang), t(S.dataH, lang))}
              {radio('ai-mode', mode === 'rag', () => pick('rag'), t(S.rag, lang), t(S.ragH, lang))}
            </fieldset>
            {mode !== 'off' && <>
              <fieldset className="grid gap-1" data-guide="ai-provider">
                <legend className="mb-1 text-sm font-semibold">{t(S.prov, lang)}</legend>
                {radio('ai-prov', prov === 'ilmu', () => setProv('ilmu'), t(S.ilmu, lang), d.available.ilmu ? undefined : t(S.noIlmu, lang), !d.available.ilmu)}
                {radio('ai-prov', prov === 'custom', () => setProv('custom'), t(S.own, lang))}
                {prov === 'custom' && (
                  <div className="grid gap-3 border-l-4 border-soft pl-3">
                    <p className="text-sm text-muted">{t(S.ownNote, lang)}</p>
                    <label className="grid gap-1 text-sm font-semibold">{t(S.url, lang)}
                      <input className="input font-normal" type="url" inputMode="url" autoComplete="off" placeholder="https://" value={url} onChange={e => setUrl(e.target.value)} /></label>
                    <label className="grid gap-1 text-sm font-semibold">{t(S.model, lang)}
                      <input className="input font-normal" autoComplete="off" value={model} onChange={e => setModel(e.target.value)} /></label>
                    <div className="grid gap-1">
                      <label htmlFor="ai-key" className="text-sm font-semibold">{t(S.key, lang)}</label>
                      <div className="flex gap-2">
                        <input id="ai-key" className="input min-w-0 flex-1 font-normal" type={showKey ? 'text' : 'password'} autoComplete="new-password" aria-describedby={d.custom.has_key ? 'ai-key-h' : undefined} value={key} onChange={e => setKey(e.target.value)} />
                        <button type="button" className="btn" aria-pressed={showKey} onClick={() => setShowKey(!showKey)}>{t(showKey ? S.hide : S.show, lang)}<span className="sr-only"> {t(S.key, lang)}</span></button>
                      </div>
                      {d.custom.has_key && <p id="ai-key-h" className="text-sm text-muted">{t(S.keySaved, lang)}</p>}
                    </div>
                  </div>)}
              </fieldset>
              <section className="rounded-ui border border-soft p-3" aria-labelledby="ai-notice" data-guide="ai-notice">
                <h2 id="ai-notice" className="mb-1 text-sm font-semibold">{t(S.notice, lang)}</h2>
                <p className="text-sm">{(mode === 'rag' ? d.rag_disclosure : d.disclosure).text}</p>
              </section>
              <label className="flex min-h-11 items-start gap-2 text-sm font-semibold">
                <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={agree} aria-required="true" onChange={e => setAgree(e.target.checked)} />{t(S.agree, lang)}</label>
            </>}
            {err && <p role="alert" className="card border-warn bg-warn-bg text-warn">{err}</p>}
            <div className="flex flex-wrap items-center gap-2" data-guide="ai-save">
              <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t(S.saving, lang) : t(S.save, lang)}</button>
              {d.mode !== 'off' && <button type="button" className="btn" aria-disabled={busy || undefined} onClick={() => !busy && test()}>{t(S.test, lang)}</button>}
              <span role="status" className="text-sm">{status}</span>
            </div>
            {d.consent.at && d.mode !== 'off' && <p className="text-sm text-muted">{t(S.by, lang)} {d.consent.by} {t(S.on, lang)} {new Date(d.consent.at).toLocaleDateString(locale(lang))}</p>}
          </form>)}
      </Async>
      <div className="mt-8" data-guide="ai-activity"><AiActivity /></div>
    </>
  )
}

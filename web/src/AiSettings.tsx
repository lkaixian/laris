import { useEffect, useState } from 'react'
import { api, ApiError } from './api'
import { AiActivity } from './AiActivity'
import { Async, PageHeader, useFetch } from './ui'
import { useToast } from './Toast'
import { t, useLang } from './i18n'
import type { Text } from './i18n'

/* Owner page: the optional AI guide (src/api/ai_guide.py). Off until the owner switches it on and confirms the disclosure. */
type Mode = 'off' | 'guide' | 'guide_data' | 'rag'
interface View {
  mode: Mode; provider: 'ilmu' | 'custom'; custom: { base_url: string; model: string; has_key: boolean }
  consent: { at: string | null; by: string | null; version: number | null }; disclosure: { version: number; text: string }; rag_disclosure: { version: number; text: string }
  available: { ilmu: boolean }; legacy_assistant: boolean
}

const S = {
  title: { en: 'AI settings', ms: 'Tetapan AI' },
  intro: { en: 'An optional helper that answers "where do I click?". It is OFF until you switch it on.', ms: 'Pembantu pilihan yang menjawab "di mana saya perlu klik?". Ia MATI sehingga anda menghidupkannya.' },
  legacy: { en: 'Your Assistant page still works as before until you save a choice here.', ms: 'Halaman Pembantu anda masih berfungsi seperti biasa sehingga anda menyimpan pilihan di sini.' },
  mode: { en: 'What the helper may do', ms: 'Apa yang boleh dilakukan pembantu' },
  off: { en: 'Off', ms: 'Mati' }, offH: { en: 'Nothing is sent to any AI service.', ms: 'Tiada apa dihantar kepada perkhidmatan AI.' },
  guide: { en: 'Guide only', ms: 'Panduan sahaja' },
  guideH: { en: 'Answers where to click. Sends only the question you type, with emails, phone numbers and ID numbers removed. Never your quotes, customers or costs.', ms: 'Menjawab di mana hendak klik. Hanya menghantar soalan yang anda taip, dengan emel, nombor telefon dan nombor ID dibuang. Tidak pernah sebut harga, pelanggan atau kos anda.' },
  data: { en: 'Guide plus my data', ms: 'Panduan serta data saya' },
  dataH: { en: 'The Assistant page also answers questions about your own quotes and contacts. It still sends only the question, never the records.', ms: 'Halaman Pembantu juga menjawab soalan tentang sebut harga dan kenalan anda sendiri. Ia tetap hanya menghantar soalan, bukan rekod.' },
  rag: { en: 'Guide plus my data, read by the AI', ms: 'Panduan serta data saya, dibaca oleh AI' },
  ragH: { en: 'The Assistant can answer from short extracts of your quotes, contacts and catalog. Emails, phone numbers, ID and card numbers and the names in your contact book are hidden first; addresses are not. Each person only gets what their role may see. Needs its own agreement below.', ms: 'Pembantu boleh menjawab daripada petikan ringkas sebut harga, kenalan dan katalog anda. Emel, nombor telefon, nombor ID dan kad serta nama dalam buku kenalan disembunyikan dahulu; alamat tidak. Setiap orang hanya mendapat apa yang dibenarkan oleh peranan mereka. Memerlukan persetujuan tersendiri di bawah.' },
  prov: { en: 'Which AI service', ms: 'Perkhidmatan AI yang mana' },
  ilmu: { en: 'LARIS hosted ILMU', ms: 'ILMU yang dihoskan LARIS' },
  noIlmu: { en: 'Not available on this server. Choose your own AI server.', ms: 'Tidak tersedia pada pelayan ini. Pilih pelayan AI anda sendiri.' },
  own: { en: 'My own AI server', ms: 'Pelayan AI saya sendiri' },
  ownNote: { en: 'It must be an https server that speaks the OpenAI format, on port 443 or 8443. Private network addresses are refused.', ms: 'Ia mesti pelayan https yang menggunakan format OpenAI, pada port 443 atau 8443. Alamat rangkaian peribadi ditolak.' },
  url: { en: 'Server address', ms: 'Alamat pelayan' }, model: { en: 'Model name', ms: 'Nama model' }, key: { en: 'API key', ms: 'Kunci API' },
  keySaved: { en: 'A key is saved. Leave blank to keep it.', ms: 'Satu kunci telah disimpan. Biarkan kosong untuk mengekalkannya.' },
  show: { en: 'Show', ms: 'Tunjuk' }, hide: { en: 'Hide', ms: 'Sembunyi' },
  notice: { en: 'What is sent', ms: 'Apa yang dihantar' },
  agree: { en: 'I have read this and I will tell my customers in our privacy notice', ms: 'Saya telah membaca ini dan akan memberitahu pelanggan kami dalam notis privasi kami' },
  save: { en: 'Save', ms: 'Simpan' }, saving: { en: 'Saving...', ms: 'Menyimpan...' }, saved: { en: 'AI settings saved.', ms: 'Tetapan AI disimpan.' },
  test: { en: 'Test connection', ms: 'Uji sambungan' },
  by: { en: 'Switched on by', ms: 'Dihidupkan oleh' }, on: { en: 'on', ms: 'pada' },
  needAgree: { en: 'Tick the box to confirm you have read the notice.', ms: 'Tandakan kotak untuk mengesahkan anda telah membaca notis.' },
  disclosure_required: { en: 'Tick the box to confirm you have read the notice, then save again.', ms: 'Tandakan kotak untuk mengesahkan anda telah membaca notis, kemudian simpan semula.' },
  secret_key_unset: { en: 'This server cannot store a key safely yet, so your own AI server cannot be saved. Ask whoever runs LARIS to set it up.', ms: 'Pelayan ini belum boleh menyimpan kunci dengan selamat, jadi pelayan AI anda sendiri tidak boleh disimpan. Minta orang yang menjalankan LARIS menyediakannya.' },
  custom_incomplete: { en: 'Please fill in the server address, the model name and the key.', ms: 'Sila isi alamat pelayan, nama model dan kunci.' },
  bad_url: { en: 'That address is not allowed. Use the public https address of your AI server, on port 443 or 8443.', ms: 'Alamat itu tidak dibenarkan. Guna alamat https awam pelayan AI anda, pada port 443 atau 8443.' },
  unavailable: { en: 'The AI helper is not available right now. Nothing was changed.', ms: 'Pembantu AI tidak tersedia sekarang. Tiada apa yang diubah.' },
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
    setErr(c ? t(S[c], lang) : e instanceof ApiError && (e.code === 'ai_unavailable' || e.status === 503) ? t(S.unavailable, lang) : e instanceof Error ? e.message : 'Something went wrong.')
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
            <fieldset className="grid gap-1">
              <legend className="mb-1 text-sm font-semibold">{t(S.mode, lang)}</legend>
              {radio('ai-mode', mode === 'off', () => pick('off'), t(S.off, lang), t(S.offH, lang))}
              {radio('ai-mode', mode === 'guide', () => pick('guide'), t(S.guide, lang), t(S.guideH, lang))}
              {radio('ai-mode', mode === 'guide_data', () => pick('guide_data'), t(S.data, lang), t(S.dataH, lang))}
              {radio('ai-mode', mode === 'rag', () => pick('rag'), t(S.rag, lang), t(S.ragH, lang))}
            </fieldset>
            {mode !== 'off' && <>
              <fieldset className="grid gap-1">
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
              <section className="rounded-ui border border-soft p-3" aria-labelledby="ai-notice">
                <h2 id="ai-notice" className="mb-1 text-sm font-semibold">{t(S.notice, lang)}</h2>
                <p className="text-sm">{(mode === 'rag' ? d.rag_disclosure : d.disclosure).text}</p>
              </section>
              <label className="flex min-h-11 items-start gap-2 text-sm font-semibold">
                <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={agree} aria-required="true" onChange={e => setAgree(e.target.checked)} />{t(S.agree, lang)}</label>
            </>}
            {err && <p role="alert" className="card border-warn bg-warn-bg text-warn">{err}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t(S.saving, lang) : t(S.save, lang)}</button>
              {d.mode !== 'off' && <button type="button" className="btn" aria-disabled={busy || undefined} onClick={() => !busy && test()}>{t(S.test, lang)}</button>}
              <span role="status" className="text-sm">{status}</span>
            </div>
            {d.consent.at && d.mode !== 'off' && <p className="text-sm text-muted">{t(S.by, lang)} {d.consent.by} {t(S.on, lang)} {new Date(d.consent.at).toLocaleDateString()}</p>}
          </form>)}
      </Async>
      <div className="mt-8"><AiActivity /></div>
    </>
  )
}

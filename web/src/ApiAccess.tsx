import { useRef, useState } from 'react'
import { api } from './api'
import { Async, PageHeader, msg, useAction, ActionError, useFetch } from './ui'
import { UsageBars } from './AiActivity'
import { useToast } from './Toast'
import { locale, t, useLang } from './i18n'
import type { Text } from './i18n'

interface Usage { period: string; approved_quotes: number; quotes_sent: number; api_calls: number; free_allowance: number; over_allowance: boolean; note: string }
interface Key { id: string; name: string; key_prefix: string; created_at: string; last_used_at: string | null; revoked: boolean; mcp_role: string | null }

const day = (s: string) => new Date(s).toLocaleDateString(locale())

function UsageCard() {
  useLang()
  const s = useFetch<Usage>('/usage')
  const u = s.data
  return (
    <section className="mb-6" aria-labelledby="usage" data-guide="api-usage">
      <h2 id="usage" className="mb-2 text-lg font-semibold">{t({ en: 'Usage this month', ms: 'Penggunaan bulan ini', zh: '本月用量', ta: 'இந்த மாதப் பயன்பாடு' })}</h2>
      <Async s={s} empty={false} rows={2}>
        {u && <>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {([[t({ en: 'Approved quotes', ms: 'Sebut harga diluluskan', zh: '已批准的报价', ta: 'அங்கீகரிக்கப்பட்ட மேற்கோள்கள்' }), t({ en: `${u.approved_quotes} of ${u.free_allowance} free`, ms: `${u.approved_quotes} daripada ${u.free_allowance} percuma`, zh: `${u.approved_quotes} / ${u.free_allowance} 免费`, ta: `${u.free_allowance} இலவசத்தில் ${u.approved_quotes}` })], [t({ en: 'Quotes sent', ms: 'Sebut harga dihantar', zh: '已发送的报价', ta: 'அனுப்பிய மேற்கோள்கள்' }), String(u.quotes_sent)], [t({ en: 'API calls', ms: 'Panggilan API', zh: 'API 调用', ta: 'API அழைப்புகள்' }), String(u.api_calls)]] as const).map(([k, v]) => (
              <div key={k} className="card"><dt className="text-sm text-muted">{k}</dt><dd className="text-lg font-semibold">{v}</dd></div>
            ))}
          </dl>
          <p className={`mt-2 ${u.over_allowance ? 'font-semibold text-warn' : 'text-sm'}`}>
            {u.over_allowance ? t({ en: `You are over the free allowance by ${u.approved_quotes - u.free_allowance} ${u.approved_quotes - u.free_allowance === 1 ? 'quote' : 'quotes'} this month.`, ms: `Anda melebihi had percuma sebanyak ${u.approved_quotes - u.free_allowance} sebut harga bulan ini.`, zh: `本月您已超出免费额度 ${u.approved_quotes - u.free_allowance} 份报价。`, ta: `இந்த மாதம் இலவச அளவை ${u.approved_quotes - u.free_allowance} மேற்கோள்கள் மீறியுள்ளீர்கள்.` })
              : t({ en: `You have ${u.free_allowance - u.approved_quotes} free ${u.free_allowance - u.approved_quotes === 1 ? 'quote' : 'quotes'} left this month.`, ms: `Anda ada ${u.free_allowance - u.approved_quotes} sebut harga percuma lagi bulan ini.`, zh: `本月您还剩 ${u.free_allowance - u.approved_quotes} 份免费报价。`, ta: `இந்த மாதம் உங்களுக்கு ${u.free_allowance - u.approved_quotes} இலவச மேற்கோள்கள் மீதமுள்ளன.` })}
          </p>
          <p className="text-sm text-muted">{u.note}</p>
        </>}
      </Async>
    </section>
  )
}

function Keys() {
  useLang()
  const s = useFetch<Key[]>('/settings/api-keys')
  const [name, setName] = useState('')
  const [ai, setAi] = useState(false)
  const [roleId, setRoleId] = useState('')
  const roles = useFetch<{ roles: { id: string; name: string; class: string }[] }>('/roles')
  const staffRoles = (roles.data?.roles ?? []).filter(x => x.class === 'staff')
  const [made, setMade] = useState<{ name: string; key: string }>()
  const [copied, setCopied] = useState('')
  const [ask, setAsk] = useState('')
  const [err, setErr] = useState('')
  const add = useAction()
  const toast = useToast()
  const box = useRef<HTMLInputElement>(null)
  const create = () => {
    if (!name.trim()) return setErr(t({ en: 'Give the key a name, for example the program that will use it.', ms: 'Beri nama kepada kunci, contohnya program yang akan menggunakannya.', zh: '请为密钥命名，例如将使用它的程序名称。', ta: 'விசைக்கு ஒரு பெயர் கொடுங்கள், எடுத்துக்காட்டாக அதைப் பயன்படுத்தும் நிரல்.' }))
    if (ai && !roleId) return setErr(t({ en: 'Choose which role the AI tool acts as.', ms: 'Pilih peranan yang dilakonkan oleh alat AI.', zh: '请选择 AI 工具以哪个角色运行。', ta: 'AI கருவி எந்தப் பங்காகச் செயல்படும் என்பதைத் தேர்ந்தெடுக்கவும்.' }))
    setErr(''); setCopied('')
    add.run(async () => { const r = await api<{ name: string; key: string }>('POST', '/settings/api-keys', { name: name.trim(), ...(ai ? { mcp_role_id: roleId } : {}) }); setMade(r); setName(''); s.reload(); requestAnimationFrame(() => box.current?.select()) })
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(made!.key); setCopied(t({ en: 'Copied.', ms: 'Disalin.', zh: '已复制。', ta: 'நகலெடுக்கப்பட்டது.' })) } catch { box.current?.select(); setCopied(t({ en: 'Could not copy automatically. The key is selected, press Ctrl+C.', ms: 'Tidak dapat menyalin secara automatik. Kunci telah dipilih, tekan Ctrl+C.', zh: '无法自动复制。密钥已选中，请按 Ctrl+C。', ta: 'தானாக நகலெடுக்க முடியவில்லை. விசை தேர்ந்தெடுக்கப்பட்டுள்ளது, Ctrl+C அழுத்தவும்.' })) }
  }
  const revoke = async (k: Key) => {
    try { await api('DELETE', `/settings/api-keys/${k.id}`); toast(t({ en: `Key ${k.name} revoked.`, ms: `Kunci ${k.name} dibatalkan.`, zh: `密钥 ${k.name} 已撤销。`, ta: `விசை ${k.name} ரத்து செய்யப்பட்டது.` })); setAsk(''); s.reload() } catch (e) { setErr(msg(e)) }
  }
  const list = s.data ?? []
  return (
    <section className="mb-6" aria-labelledby="keys">
      <h2 id="keys" className="text-lg font-semibold">{t({ en: 'API keys', ms: 'Kunci API', zh: 'API 密钥', ta: 'API விசைகள்' })}</h2>
      <p className="mb-3 mt-1 text-sm text-muted">{t({ en: 'A key lets another program ask LARIS for prices. Each key works for your business only and can only read prices. It cannot see costs or margins.', ms: 'Kunci membolehkan program lain meminta harga daripada LARIS. Setiap kunci hanya berfungsi untuk perniagaan anda dan hanya boleh membaca harga. Ia tidak boleh melihat kos atau margin.', zh: '密钥可让其他程序向 LARIS 询问价格。每个密钥只适用于您的业务，且只能读取价格，看不到成本或利润率。', ta: 'ஒரு விசை மற்றொரு நிரலை LARIS இடம் விலைகளைக் கேட்க அனுமதிக்கும். ஒவ்வொரு விசையும் உங்கள் வணிகத்திற்கு மட்டுமே செயல்படும்; விலைகளை மட்டுமே படிக்கலாம். செலவுகள் அல்லது இலாப விகிதங்களைப் பார்க்க முடியாது.' })}</p>
      <form className="mb-4 flex flex-wrap items-end gap-2" data-guide="api-create" onSubmit={e => { e.preventDefault(); create() }}>
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm font-semibold">{t({ en: 'New key name', ms: 'Nama kunci baharu', zh: '新密钥名称', ta: 'புதிய விசைப் பெயர்' })}
          <input className="input font-normal" maxLength={60} value={name} onChange={e => setName(e.target.value)} /></label>
        <button type="submit" className="btn btn-primary" aria-disabled={add.busy || undefined}>{add.busy ? t({ en: 'Creating...', ms: 'Mencipta...', zh: '正在创建...', ta: 'உருவாக்குகிறது...' }) : t({ en: 'Create key', ms: 'Cipta kunci', zh: '创建密钥', ta: 'விசையை உருவாக்கு' })}</button>
        <div className="w-full">
          <label className="flex min-h-11 items-start gap-2 text-sm font-semibold" data-guide="api-mcp">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={ai} onChange={e => setAi(e.target.checked)} />
            <span>{t({ en: 'This key is for an AI tool (MCP)', ms: 'Kunci ini untuk alat AI (MCP)', zh: '此密钥用于 AI 工具 (MCP)', ta: 'இந்த விசை AI கருவிக்கானது (MCP)' })}<span className="block font-normal text-muted">{t({ en: 'The tool can search your quotes, contacts and catalog, limited to what the role below may see. It needs your agreement under AI settings first. Names and contact details are replaced by placeholders, but addresses are not.', ms: 'Alat ini boleh mencari sebut harga, kenalan dan katalog anda, terhad kepada apa yang boleh dilihat oleh peranan di bawah. Ia memerlukan persetujuan anda dahulu di Tetapan AI. Nama dan butiran hubungan digantikan dengan pengganti, tetapi alamat tidak.', zh: '该工具可搜索您的报价、联系人和目录，范围限于下方角色可查看的内容。需先在“AI 设置”中获得您的同意。姓名和联系方式会被占位符取代，但地址不会。', ta: 'இந்தக் கருவி உங்கள் மேற்கோள்கள், தொடர்புகள், பட்டியலைத் தேடலாம்; கீழே உள்ள பங்கு காணக்கூடியவற்றுக்கு மட்டும். முதலில் AI அமைப்புகளில் உங்கள் ஒப்புதல் தேவை. பெயர்களும் தொடர்பு விவரங்களும் இடஒதுக்கீடுகளால் மாற்றப்படும்; முகவரிகள் மாற்றப்படாது.' })}</span></span></label>
          {ai && (
            <label className="mt-1 flex max-w-sm flex-col gap-1 text-sm font-semibold">{t({ en: 'Acts as this role', ms: 'Bertindak sebagai peranan ini', zh: '以此角色运行', ta: 'இந்தப் பங்காகச் செயல்படும்' })}
              <select className="input font-normal" value={roleId} onChange={e => setRoleId(e.target.value)}>
                <option value="">{t({ en: 'Choose a role', ms: 'Pilih peranan', zh: '选择角色', ta: 'பங்கைத் தேர்ந்தெடுக்கவும்' })}</option>
                {staffRoles.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select></label>)}
        </div>
      </form>
      {err && <p role="alert" className="mb-2 text-sm text-warn">{err}</p>}
      <ActionError err={add.err} onRetry={create} label={t({ en: 'Retry creating the key', ms: 'Cuba cipta kunci semula', zh: '重试创建密钥', ta: 'விசையை உருவாக்க மீண்டும் முயல்' })} />
      {made && (
        <div className="card mb-4 border-l-4 border-l-amber" role="group" aria-label={t({ en: 'New API key', ms: 'Kunci API baharu', zh: '新的 API 密钥', ta: 'புதிய API விசை' })}>
          <p className="font-semibold">{t({ en: 'Copy it now, it is shown once.', ms: 'Salin sekarang, ia hanya dipaparkan sekali.', zh: '请立即复制，它只显示一次。', ta: 'இப்போதே நகலெடுக்கவும், இது ஒருமுறை மட்டுமே காட்டப்படும்.' })}</p>
          <p className="text-sm text-muted">{t({ en: `This is the key for ${made.name}. LARIS cannot show it again. If you lose it, revoke it and create a new one.`, ms: `Ini ialah kunci untuk ${made.name}. LARIS tidak boleh menunjukkannya lagi. Jika hilang, batalkannya dan cipta yang baharu.`, zh: `这是 ${made.name} 的密钥。LARIS 无法再次显示。如果丢失，请撤销并创建新的密钥。`, ta: `இது ${made.name} க்கான விசை. LARIS இதை மீண்டும் காட்ட முடியாது. தொலைந்தால் ரத்து செய்து புதியதை உருவாக்கவும்.` })}</p>
          <input ref={box} readOnly aria-label={t({ en: `API key for ${made.name}`, ms: `Kunci API untuk ${made.name}`, zh: `${made.name} 的 API 密钥`, ta: `${made.name} க்கான API விசை` })} className="input mt-2 w-full font-mono text-sm" value={made.key} onFocus={e => e.currentTarget.select()} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary" onClick={copy}>{t({ en: 'Copy key', ms: 'Salin kunci', zh: '复制密钥', ta: 'விசையை நகலெடு' })}</button>
            <button type="button" className="btn" onClick={() => { setMade(undefined); setCopied('') }}>{t({ en: 'I have copied it', ms: 'Saya telah menyalinnya', zh: '我已复制', ta: 'நகலெடுத்துவிட்டேன்' })}</button>
            <span role="status" className="text-sm">{copied}</span>
          </div>
        </div>
      )}
      <Async s={s} rows={2} empty={!list.length} emptyText={t({ en: 'No API keys yet.', ms: 'Belum ada kunci API.', zh: '还没有 API 密钥。', ta: 'இன்னும் API விசைகள் இல்லை.' })} emptyHint={t({ en: 'Create a key above when another program needs to ask LARIS for prices.', ms: 'Cipta kunci di atas apabila program lain perlu meminta harga daripada LARIS.', zh: '当其他程序需要向 LARIS 询问价格时，请在上方创建密钥。', ta: 'மற்றொரு நிரல் LARIS இடம் விலை கேட்க வேண்டியபோது மேலே ஒரு விசையை உருவாக்கவும்.' })}>
        <ul className="grid gap-2" data-guide="api-list">
          {list.map(k => (
            <li key={k.id} className="card">
              <p className="flex flex-wrap items-center gap-2"><span className="font-semibold">{k.name}</span>{k.mcp_role && <span className="badge">{t({ en: `AI tool, acts as ${k.mcp_role}`, ms: `Alat AI, bertindak sebagai ${k.mcp_role}`, zh: `AI 工具，角色：${k.mcp_role}`, ta: `AI கருவி, ${k.mcp_role} ஆகச் செயல்படும்` })}</span>}{k.revoked && <span className="badge badge-warn">{t({ en: 'Revoked', ms: 'Dibatalkan', zh: '已撤销', ta: 'ரத்து செய்யப்பட்டது' })}</span>}</p>
              <p className="break-all font-mono text-sm">{k.key_prefix}...</p>
              <p className="text-sm text-muted">{t({ en: `Created ${day(k.created_at)}.`, ms: `Dicipta ${day(k.created_at)}.`, zh: `创建于 ${day(k.created_at)}。`, ta: `உருவாக்கியது ${day(k.created_at)}.` })} {k.last_used_at ? t({ en: `Last used ${day(k.last_used_at)}.`, ms: `Terakhir digunakan ${day(k.last_used_at)}.`, zh: `上次使用 ${day(k.last_used_at)}。`, ta: `கடைசியாகப் பயன்படுத்தியது ${day(k.last_used_at)}.` }) : t({ en: 'Never used.', ms: 'Belum pernah digunakan.', zh: '从未使用。', ta: 'பயன்படுத்தப்படவில்லை.' })}</p>
              {!k.revoked && (ask === k.id ? (
                <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t({ en: `Confirm revoking ${k.name}`, ms: `Sahkan pembatalan ${k.name}`, zh: `确认撤销 ${k.name}`, ta: `${k.name} ரத்து செய்வதை உறுதிப்படுத்தவும்` })}>
                  <span className="text-sm font-semibold">{t({ en: `Revoke ${k.name}? Programs using it stop working at once.`, ms: `Batalkan ${k.name}? Program yang menggunakannya berhenti berfungsi serta-merta.`, zh: `撤销 ${k.name}？使用它的程序会立即停止工作。`, ta: `${k.name} ஐ ரத்து செய்யவா? அதைப் பயன்படுத்தும் நிரல்கள் உடனே செயல்படாது.` })}</span>
                  <button type="button" className="btn btn-danger" autoFocus onClick={() => revoke(k)}>{t({ en: 'Yes, revoke', ms: 'Ya, batalkan', zh: '是，撤销', ta: 'ஆம், ரத்து செய்' })}<span className="sr-only"> {k.name}</span></button>
                  <button type="button" className="btn" onClick={() => setAsk('')}>{t({ en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து செய்' })}</button>
                </div>
              ) : <div className="mt-3"><button type="button" className="btn" onClick={() => setAsk(k.id)}>{t({ en: 'Revoke', ms: 'Batalkan', zh: '撤销', ta: 'ரத்து செய்' })}<span className="sr-only"> {k.name}</span></button></div>)}
            </li>
          ))}
        </ul>
      </Async>
    </section>
  )
}

type Step = { h: Text; state: 'live' | 'sim' | 'plan'; p: Text }
const STATE: Record<Step['state'], Text> = { live: { en: 'Live', ms: 'Aktif', zh: '已上线' }, sim: { en: 'Simulated in the demo', ms: 'Disimulasi dalam demo', zh: '演示中模拟' }, plan: { en: 'Planned', ms: 'Dirancang', zh: '计划中' } }
const STEPS: Step[] = [
  { h: { en: '1. Win the work in LARIS', ms: '1. Menangi kerja dalam LARIS', zh: '1. 在 LARIS 赢得订单' }, state: 'live',
    p: { en: 'A customer asks on Telegram or WhatsApp, rules price the quote from your cost book, and you approve it. No AI sets a price.', ms: 'Pelanggan bertanya di Telegram atau WhatsApp, peraturan menetapkan harga daripada buku kos anda, dan anda meluluskannya. Tiada AI menetapkan harga.', zh: '客户在 Telegram 或 WhatsApp 询价，规则根据您的成本表定价，由您审批。AI 不决定价格。' } },
  { h: { en: '2. Orbyte modules ask LARIS for prices', ms: '2. Modul Orbyte meminta harga daripada LARIS', zh: '2. Orbyte 模块向 LARIS 查询价格' }, state: 'live',
    p: { en: 'Orbyte modules, or your own tools, call LARIS with an API key (below) to read the recipe list and get selling prices. Same rules, never costs or margins. LARIS does not call Orbyte on its own.', ms: 'Modul Orbyte, atau alat anda sendiri, memanggil LARIS dengan kunci API (di bawah) untuk membaca senarai resipi dan mendapatkan harga jualan. Peraturan yang sama, tidak pernah kos atau margin. LARIS tidak memanggil Orbyte sendiri.', zh: 'Orbyte 模块或您自己的系统用 API 密钥（见下方）调用 LARIS，读取配方清单并获取销售价格。规则相同，绝不含成本或利润率。LARIS 不会主动调用 Orbyte。' } },
  { h: { en: '3. Hand over the signed quote', ms: '3. Serahkan sebut harga yang ditandatangani', zh: '3. 移交已签署的报价' }, state: 'sim',
    p: { en: 'The signed quote and its job card go to Orbyte’s eSign and Work modules instead of being copied into LARIS. LARIS is the step before Orbyte’s Clients and projects.', ms: 'Sebut harga yang ditandatangani dan kad kerjanya dihantar ke modul eSign dan Work Orbyte dan tidak disalin ke dalam LARIS. LARIS ialah langkah sebelum Clients dan projects Orbyte.', zh: '已签署的报价及其工作单交给 Orbyte 的 eSign 和 Work 模块，而不是复制到 LARIS 中。LARIS 是 Orbyte“客户与项目”之前的一步。' } },
  { h: { en: '4. Supplier price feeds', ms: '4. Suapan harga pembekal', zh: '4. 供应商价格数据源' }, state: 'plan',
    p: { en: 'Prices arrive through Orbyte Connect so cost items need no photos. No partner has been contacted yet.', ms: 'Harga tiba melalui Orbyte Connect supaya item kos tidak perlukan foto. Belum ada rakan kongsi dihubungi.', zh: '价格通过 Orbyte Connect 送达，成本项无需拍照。尚未联系任何合作方。' } },
]
function OrbyteFlow() {
  useLang()
  return (
    <section className="card mb-6" aria-labelledby="orbyte" data-guide="orbyte-how">
      <h2 id="orbyte" className="text-lg font-semibold">{t({ en: 'How LARIS works with Orbyte', ms: 'Cara LARIS bekerja dengan Orbyte', zh: 'LARIS 如何与 Orbyte 配合' })}</h2>
      <p className="mt-1 text-sm text-muted">{t({ en: 'LARIS is the step before Orbyte’s Clients and projects: it wins the work, then hands it over. This page is where Orbyte, or any program, connects to LARIS.', ms: 'LARIS ialah langkah sebelum Clients dan projects Orbyte: ia memenangi kerja, kemudian menyerahkannya. Halaman ini ialah tempat Orbyte, atau mana-mana program, bersambung dengan LARIS.', zh: 'LARIS 是 Orbyte“客户与项目”之前的一步：先赢得订单，再移交。Orbyte 或任何程序都在此页与 LARIS 连接。' })}</p>
      <ol className="mt-3 grid gap-2 md:grid-cols-2">
        {STEPS.map(x => (
          <li key={x.h.en} className="rounded-ui bg-tint p-3">
            <p className="flex flex-wrap items-center gap-2 font-semibold">{t(x.h)} <span className="badge">{t(STATE[x.state])}</span></p>
            <p className="mt-1 text-sm text-muted">{t(x.p)}</p>
          </li>))}
      </ol>
      <p className="mt-3 text-sm text-muted">{t({ en: 'Honest status: today the connection works one way. What is live is the read-only price API and the AI tool search below. A real Orbyte login and Orbyte API calls are not built yet.', ms: 'Status sebenar: hari ini sambungan berfungsi sehala. Yang aktif ialah API harga baca sahaja dan carian alat AI di bawah. Log masuk Orbyte sebenar dan panggilan API Orbyte belum dibina.', zh: '实际状态：目前连接是单向的。已上线的是下方的只读价格 API 和 AI 工具检索。真实的 Orbyte 登录与 Orbyte API 调用尚未构建。' })}</p>
    </section>
  )
}

export function ApiAccessView() {
  useLang()
  const base = location.origin + '/api/v1'
  return (
    <>
      <PageHeader title={t({ en: 'Orbyte connections', ms: 'Sambungan Orbyte', zh: 'Orbyte 连接', ta: 'Orbyte இணைப்புகள்' })} description={t({ en: 'How LARIS works with Orbyte, and the keys that let Orbyte modules or another program, such as your own system, ask LARIS for selling prices.', ms: 'Cara LARIS bekerja dengan Orbyte, dan kunci yang membenarkan modul Orbyte atau program lain, seperti sistem anda sendiri, meminta harga jualan daripada LARIS.', zh: 'LARIS 如何与 Orbyte 配合，以及让 Orbyte 模块或其他程序（例如您自己的系统）向 LARIS 查询售价的密钥。', ta: 'LARIS Orbyte உடன் எப்படிச் செயல்படுகிறது, மற்றும் Orbyte தொகுதிகள் அல்லது உங்கள் சொந்த அமைப்பு போன்ற பிற நிரல் LARIS இடம் விற்பனை விலைகளைக் கேட்க உதவும் விசைகள்.' })} />
      <OrbyteFlow />
      <UsageCard />
      <div className="mb-6" data-guide="api-ai-usage"><UsageBars /></div>
      <Keys />
      <section className="card" aria-labelledby="how" data-guide="api-how">
        <h2 id="how" className="text-lg font-semibold">{t({ en: 'How to call it', ms: 'Cara memanggilnya', zh: '如何调用', ta: 'எப்படி அழைப்பது' })}</h2>
        <p className="mt-1 text-sm text-muted">{t({ en: 'Send your key in the X-API-Key header. Replace YOUR_API_KEY with your own key. Up to 60 requests a minute per key.', ms: 'Hantar kunci anda dalam header X-API-Key. Gantikan YOUR_API_KEY dengan kunci anda sendiri. Sehingga 60 permintaan seminit bagi setiap kunci.', zh: '请在 X-API-Key 标头中发送您的密钥，并将 YOUR_API_KEY 替换为您自己的密钥。每个密钥每分钟最多 60 次请求。', ta: 'உங்கள் விசையை X-API-Key தலைப்பில் அனுப்பவும். YOUR_API_KEY ஐ உங்கள் சொந்த விசையால் மாற்றவும். ஒரு விசைக்கு நிமிடத்திற்கு 60 கோரிக்கைகள் வரை.' })}</p>
        <pre className="mt-2 whitespace-pre-wrap break-all rounded-ui bg-soft p-3 font-mono text-xs">{`curl -H "X-API-Key: YOUR_API_KEY" ${base}/recipes

curl -X POST -H "X-API-Key: YOUR_API_KEY" -H "Content-Type: application/json" ${base}/quote-price -d '{"items":[{"recipe_key":"signboard_60x30","qty":2}]}'`}</pre>
        <p className="mt-2 text-sm text-muted">{t({ en: 'The first call lists the items you can price. The second returns selling prices only, never costs or margins.', ms: 'Panggilan pertama menyenaraikan item yang boleh dinilai harganya. Panggilan kedua hanya mengembalikan harga jualan, tidak pernah kos atau margin.', zh: '第一个调用列出可报价的项目。第二个只返回售价，绝不返回成本或利润率。', ta: 'முதல் அழைப்பு விலை நிர்ணயிக்கக்கூடிய பொருட்களைப் பட்டியலிடும். இரண்டாவது விற்பனை விலைகளை மட்டும் தரும், செலவுகள் அல்லது இலாப விகிதங்களை ஒருபோதும் தராது.' })}</p>
        <h3 className="mt-4 font-semibold">{t({ en: 'For an AI tool (MCP)', ms: 'Untuk alat AI (MCP)', zh: '用于 AI 工具 (MCP)', ta: 'AI கருவிக்கு (MCP)' })}</h3>
        <p className="mt-1 text-sm text-muted">{t({ en: 'Add this address as a remote MCP server in your AI tool and send the key as a Bearer token. It has one read-only tool, search.', ms: 'Tambah alamat ini sebagai pelayan MCP jauh dalam alat AI anda dan hantar kunci sebagai token Bearer. Ia ada satu alat baca sahaja, search.', zh: '在您的 AI 工具中将此地址添加为远程 MCP 服务器，并以 Bearer 令牌发送密钥。它只有一个只读工具：search。', ta: 'இந்த முகவரியை உங்கள் AI கருவியில் தொலை MCP சேவையகமாகச் சேர்த்து, விசையை Bearer டோக்கனாக அனுப்பவும். இதில் படிக்க மட்டும் உள்ள ஒரு கருவி உள்ளது: search.' })}</p>
        <pre className="mt-2 whitespace-pre-wrap break-all rounded-ui bg-soft p-3 font-mono text-xs">{`${location.origin}/api/mcp
Authorization: Bearer YOUR_API_KEY`}</pre>
      </section>
    </>
  )
}

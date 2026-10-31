import { useState } from 'react'
import { api } from './api'
import { ActionError, useAction, useFetch } from './ui'
import { useToast } from './Toast'
import { t, useLang } from './i18n'
import type { Text } from './i18n'

// Settings > Channels: the business's OWN Stripe account for customer deposits (src/api/deposits.py). LARIS keeps the keys encrypted and never the money.
interface Stripe { configured: boolean; mode?: 'test' | 'live'; webhook_path?: string; webhook_secret_set?: boolean }
const S = {
  h: { en: 'Customer deposits (Stripe)', ms: 'Deposit pelanggan (Stripe)', zh: '客户订金（Stripe）', ta: 'வாடிக்கையாளர் முன்பணம் (Stripe)' },
  lead: { en: 'When a customer accepts your quote, LARIS sends the proforma and a Stripe pay link for the deposit on Telegram, and records the payment when Stripe confirms it. The money goes straight to your own Stripe account; LARIS never holds it.', ms: 'Apabila pelanggan menerima sebut harga anda, LARIS menghantar proforma dan pautan bayaran Stripe untuk deposit melalui Telegram, dan merekod bayaran apabila Stripe mengesahkannya. Wang terus masuk ke akaun Stripe anda sendiri; LARIS tidak memegangnya.', zh: '客户接受报价后，LARIS 会通过 Telegram 发送形式发票和订金的 Stripe 付款链接，并在 Stripe 确认后记录付款。款项直接进入您自己的 Stripe 账户，LARIS 不经手资金。' },
  key: { en: 'Stripe secret key', ms: 'Kunci rahsia Stripe', zh: 'Stripe 密钥', ta: 'Stripe ரகசிய விசை' },
  keyHint: { en: 'Starts with sk_test_ or sk_live_ (or rk_ for a restricted key). It is tested with Stripe, then kept encrypted. Use a test key first.', ms: 'Bermula dengan sk_test_ atau sk_live_ (atau rk_ untuk kunci terhad). Ia diuji dengan Stripe, kemudian disimpan secara disulitkan. Guna kunci ujian dahulu.', zh: '以 sk_test_ 或 sk_live_ 开头（受限密钥为 rk_）。会先向 Stripe 验证，再加密保存。请先使用测试密钥。' },
  wh: { en: 'Webhook signing secret (optional)', ms: 'Rahsia tandatangan webhook (pilihan)', zh: 'Webhook 签名密钥（可选）', ta: 'Webhook கையொப்ப ரகசியம் (விருப்பம்)' },
  save: { en: 'Save and test', ms: 'Simpan dan uji', zh: '保存并测试', ta: 'சேமித்துச் சோதி' },
  off: { en: 'Disconnect Stripe', ms: 'Putuskan Stripe', zh: '断开 Stripe', ta: 'Stripe ஐ துண்டி' },
  on: { en: 'Connected', ms: 'Disambung', zh: '已连接', ta: 'இணைக்கப்பட்டது' },
  test: { en: 'test mode: no real money moves', ms: 'mod ujian: tiada wang sebenar bergerak', zh: '测试模式：不会有真实资金流动', ta: 'சோதனை முறை: உண்மைப் பணம் நகராது' },
  live: { en: 'live mode: real money', ms: 'mod sebenar: wang sebenar', zh: '正式模式：真实资金', ta: 'நேரடி முறை: உண்மைப் பணம்' },
  hookH: { en: 'So payments are recorded by themselves, add this address in Stripe (Developers, Webhooks) for the events checkout.session.completed and checkout.session.expired, then paste its signing secret above:', ms: 'Supaya bayaran direkod sendiri, tambah alamat ini dalam Stripe (Developers, Webhooks) untuk peristiwa checkout.session.completed dan checkout.session.expired, kemudian tampal rahsia tandatangannya di atas:', zh: '为了让付款自动入账，请在 Stripe（Developers，Webhooks）中为 checkout.session.completed 和 checkout.session.expired 事件添加此地址，然后把它的签名密钥粘贴到上面：' },
  hookNone: { en: 'No webhook secret yet: press Check now on an order to record a payment Stripe has confirmed.', ms: 'Belum ada rahsia webhook: tekan Semak sekarang pada pesanan untuk merekod bayaran yang Stripe telah sahkan.', zh: '尚未设置 webhook 密钥：请在订单上点“立即检查”来记录 Stripe 已确认的付款。' },
  saved: { en: 'Stripe connected.', ms: 'Stripe disambung.', zh: 'Stripe 已连接。', ta: 'Stripe இணைக்கப்பட்டது.' },
  gone: { en: 'Stripe disconnected.', ms: 'Stripe diputuskan.', zh: 'Stripe 已断开。', ta: 'Stripe துண்டிக்கப்பட்டது.' },
} satisfies Record<string, Text>

export function StripeCard() {
  useLang()
  const s = useFetch<Stripe>('/settings/stripe')
  const toast = useToast()
  const a = useAction()
  const [key, setKey] = useState('')
  const [wh, setWh] = useState('')
  const [confirmOff, setConfirmOff] = useState(false)
  const d = s.data
  const save = () => a.run(async () => { await api('PUT', '/settings/stripe', { secret_key: key.trim(), ...(wh.trim() ? { webhook_secret: wh.trim() } : {}) }); setKey(''); setWh(''); s.reload(); toast(t(S.saved)) })
  const disconnect = () => a.run(async () => { await api('DELETE', '/settings/stripe'); setConfirmOff(false); s.reload(); toast(t(S.gone)) })
  return (
    <section className="card mt-8 max-w-xl" aria-labelledby="stripe-h" data-guide="stripe-card">
      <h2 id="stripe-h" className="text-md font-semibold">{t(S.h)}</h2>
      <p className="mb-3 text-sm text-muted">{t(S.lead)}</p>
      {s.error ? <p role="alert" className="text-sm text-warn">{s.error}</p> : d && (<>
        {d.configured && <p className="mb-3 flex flex-wrap items-center gap-2 text-sm"><span className="badge">{t(S.on)}</span><span className="text-muted">{t(d.mode === 'live' ? S.live : S.test)}</span></p>}
        <form className="grid gap-3" onSubmit={e => { e.preventDefault(); if (key.trim()) save() }}>
          <label className="grid gap-1 text-sm font-semibold">{t(S.key)}
            <input className="input w-full font-normal" type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} placeholder={d.configured ? '••••••••••••' : 'sk_test_…'} />
            <span className="text-xs font-normal text-muted">{t(S.keyHint)}</span></label>
          <label className="grid gap-1 text-sm font-semibold">{t(S.wh)}
            <input className="input w-full font-normal" type="password" autoComplete="off" spellCheck={false} value={wh} onChange={e => setWh(e.target.value)} placeholder="whsec_…" /></label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn btn-primary" aria-disabled={a.busy || !key.trim() || undefined}>{t(S.save)}</button>
            {d.configured && (confirmOff
              ? <><button type="button" className="btn btn-danger" onClick={disconnect}>{t(S.off)}</button><button type="button" className="btn" onClick={() => setConfirmOff(false)}>{t({ en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து செய்' })}</button></>
              : <button type="button" className="btn" onClick={() => setConfirmOff(true)}>{t(S.off)}</button>)}
          </div>
          <ActionError err={a.err} onRetry={save} label={t({ en: 'Try again', ms: 'Cuba lagi', zh: '重试', ta: 'மீண்டும் முயற்சி' })} />
        </form>
        {d.configured && (d.webhook_secret_set
          ? <p className="mt-3 break-all text-xs text-muted">{t(S.hookH)} <code className="select-all">{location.origin}{d.webhook_path}</code></p>
          : <p className="mt-3 text-xs text-muted">{t(S.hookH)} <code className="select-all">{location.origin}{d.webhook_path}</code><br />{t(S.hookNone)}</p>)}
      </>)}
    </section>
  )
}

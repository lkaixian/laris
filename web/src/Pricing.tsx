import { useCallback, useEffect, useState } from 'react'
import { MOCK, api, getToken } from './api'
import type { License } from './api'
import { Icon } from './icons'
import { t, useLang } from './i18n'
import type { Text } from './i18n'
import { SiteFooter, SiteHeader } from './SiteChrome'
import type { NavItem } from './SiteChrome'

// Public pricing page (#/pricing) and service status page (#/service-status). Both work signed out.
// Prices in RM per year, per business, for the plan keys the server knows (starter is sold as LARIS Lite; seats in src/license.py).
// The server's /license/plans still answers "Contact us"; change PRICE here and nowhere else.
const PRICE = { starter: 299, standard: 599, pro: 999 } as const
type Key = keyof typeof PRICE

const S = {
  navHome: { en: 'Home', ms: 'Utama', zh: '首页' },
  navPricing: { en: 'Pricing', ms: 'Harga', zh: '价格' },
  navStatus: { en: 'Service status', ms: 'Status perkhidmatan', zh: '服务状态' },
  h1: { en: 'One price per business, not per quote', ms: 'Satu harga setiap perniagaan, bukan setiap sebut harga', zh: '按企业收费，不按报价次数' },
  lead: { en: 'Pick the number of seats your team needs. Every plan includes quoting from chat, rules-based pricing, the margin guard and the tracker.', ms: 'Pilih bilangan tempat untuk pasukan anda. Setiap pelan termasuk sebut harga dari sembang, harga berasaskan peraturan, pelindung margin dan penjejak.', zh: '按团队需要的席位数选择。每个套餐都包含聊天报价、规则定价、利润保护和追踪。' },
  indicative: { en: 'Prices in MYR per year, per business, before SST.', ms: 'Harga dalam MYR setahun, setiap perniagaan, sebelum SST.', zh: '价格为每家企业每年的马币价格，未含 SST。' },
  month: { en: '/ year', ms: '/ tahun', zh: '/ 年' },
  seats: (n: number): Text => ({ en: `${n} seats`, ms: `${n} tempat`, zh: `${n} 个席位` }),
  current: { en: 'Your current plan', ms: 'Pelan semasa anda', zh: '您当前的套餐' },
  upgrade: { en: 'Upgrade to this plan', ms: 'Naik taraf ke pelan ini', zh: '升级到此套餐' },
  downgrade: { en: 'Switch to this plan', ms: 'Tukar ke pelan ini', zh: '改用此套餐' },
  choose: { en: 'Choose this plan', ms: 'Pilih pelan ini', zh: '选择此套餐' },
  start: { en: 'Create an account', ms: 'Cipta akaun', zh: '创建账户' },
  popular: { en: 'Most teams', ms: 'Kebanyakan pasukan', zh: '多数团队之选' },
  none: { en: 'Your business is not on a paid plan yet.', ms: 'Perniagaan anda belum mempunyai pelan berbayar.', zh: '您的企业尚未订阅付费套餐。' },
  more: { en: 'Need more than 25 seats, or several branches? Contact us for a custom plan.', ms: 'Perlukan lebih 25 tempat, atau beberapa cawangan? Hubungi kami untuk pelan khas.', zh: '需要超过 25 个席位或多家分店？联系我们定制套餐。' },
  upsHint: { en: 'Everything in the plan before it, plus:', ms: 'Semua dalam pelan sebelumnya, ditambah:', zh: '包含上一档的全部功能，另加：' },
  statusH: { en: 'Service status', ms: 'Status perkhidmatan', zh: '服务状态' },
  up: { en: 'Service is up', ms: 'Perkhidmatan aktif', zh: '服务正常' },
  down: { en: 'Service not reachable right now', ms: 'Perkhidmatan tidak dapat dicapai sekarang', zh: '服务暂时无法连接' },
  wait: { en: 'Checking service…', ms: 'Menyemak perkhidmatan…', zh: '正在检查服务…' },
  again: { en: 'Check again', ms: 'Semak semula', zh: '再检查一次' },
  checked: { en: 'Last checked', ms: 'Disemak pada', zh: '上次检查' },
  reply: { en: 'Response time', ms: 'Masa respons', zh: '响应时间' },
  statusNote: { en: 'This page asks the server whether it is running. It does not show details about any business.', ms: 'Halaman ini bertanya kepada pelayan sama ada ia berjalan. Ia tidak menunjukkan butiran mana-mana perniagaan.', zh: '本页只询问服务器是否在运行，不显示任何企业的信息。' },
}

const PLANS: { key: Key; name: string; seats: number; pop?: boolean; pts: Text[] }[] = [
  { key: 'starter', name: 'LARIS Lite', seats: 3, pts: [
    { en: 'Quote from Telegram text and voice notes', ms: 'Sebut harga dari teks dan nota suara Telegram', zh: '用 Telegram 文字和语音报价' },
    { en: 'Rules pricing with your margin floor', ms: 'Harga ikut peraturan dengan lantai margin anda', zh: '规则定价，守住您的最低利润率' },
    { en: 'Quote tracker and follow-ups', ms: 'Penjejak sebut harga dan tindakan susulan', zh: '报价追踪与跟进' },
    { en: 'PDF, XLSX and CSV export', ms: 'Eksport PDF, XLSX dan CSV', zh: '导出 PDF、XLSX、CSV' }] },
  { key: 'standard', name: 'LARIS Standard', seats: 10, pop: true, pts: [
    { en: 'Roles and permissions per staff member', ms: 'Peranan dan kebenaran bagi setiap staf', zh: '按员工设定角色与权限' },
    { en: 'Activity log with CSV and PDF download', ms: 'Log aktiviti dengan muat turun CSV dan PDF', zh: '活动记录，可下载 CSV 与 PDF' },
    { en: 'Job board from accepted quotes', ms: 'Papan kerja daripada sebut harga diterima', zh: '由已接受报价生成工作看板' },
    { en: 'Catalog photos and price list import', ms: 'Foto katalog dan import senarai harga', zh: '目录照片与价目表导入' }] },
  { key: 'pro', name: 'LARIS Pro', seats: 25, pts: [
    { en: 'Suppliers: directory, price comparison, contracts', ms: 'Pembekal: direktori, perbandingan harga, kontrak', zh: '供应商：名录、比价、合同' },
    { en: 'API access for your own tools', ms: 'Akses API untuk alat anda sendiri', zh: '为自有系统开放 API' },
    { en: 'Ask LARIS assistant', ms: 'Pembantu Tanya LARIS', zh: '问 LARIS 助手' },
    { en: 'Priority support', ms: 'Sokongan keutamaan', zh: '优先支持' }] },
]

const NAV: NavItem[] = [
  { id: 'home', label: S.navHome, href: '#/welcome' },
  { id: 'pricing', label: S.navPricing, href: '#/pricing' },
  { id: 'status', label: S.navStatus, href: '#/service-status' },
]

type Props = { dark: boolean; setDark: (d: boolean) => void }

export function Pricing({ dark, setDark }: Props) {
  useLang()
  const [lic, setLic] = useState<License | null>()  // undefined: not asked yet or signed out, null: asked and failed
  const signedIn = !!getToken() || MOCK
  useEffect(() => {
    document.title = 'LARIS · ' + t(S.navPricing)
    if (signedIn) api<License>('GET', '/license').then(setLic, () => setLic(null))
  }, [signedIn])
  const cur = lic?.plan ?? null
  const curIdx = PLANS.findIndex(p => p.key === cur)
  return (
    <div className="min-h-screen">
      <SiteHeader dark={dark} setDark={setDark} items={NAV} active="pricing" />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 py-12 outline-none md:py-16">
        <h1 className="text-3xl font-bold md:text-4xl">{t(S.h1)}</h1>
        <p className="mt-4 max-w-2xl text-md text-muted">{t(S.lead)}</p>
        {signedIn && lic && curIdx < 0 && <p role="status" className="card mt-6 text-sm">{t(S.none)}</p>}
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {PLANS.map((p, i) => {
            const mine = i === curIdx
            const label = mine ? S.current : !signedIn ? S.start : curIdx < 0 ? S.choose : i > curIdx ? S.upgrade : S.downgrade
            return (
              <li key={p.key} className={`card relative flex flex-col ${mine ? 'border-2 border-accent' : p.pop && curIdx < 0 ? 'border-accent' : ''}`}>
                {(mine || (p.pop && curIdx < 0)) && <span className="badge absolute right-4 top-4">{t(mine ? S.current : S.popular)}</span>}
                <h2 className="text-lg font-semibold">{p.name}</h2>
                <p className="mt-2"><span className="text-3xl font-bold tabular-nums">RM {PRICE[p.key]}</span> <span className="text-muted">{t(S.month)}</span></p>
                <p className="mt-1 text-sm font-semibold text-accent">{t(S.seats(p.seats))}</p>
                {i > 0 && <p className="mt-4 text-sm text-muted">{t(S.upsHint)}</p>}
                <ul className={`grid gap-2 text-sm ${i > 0 ? 'mt-2' : 'mt-4'}`}>
                  {p.pts.map(x => <li key={x.en} className="flex items-start gap-2"><Icon name="check" className="mt-0.5 size-4 text-accent" />{t(x)}</li>)}
                </ul>
                <div className="mt-auto pt-6">
                  {mine
                    ? <a className="btn w-full" aria-disabled="true" href="#/licence">{t(S.current)}</a>
                    : <a className={`btn w-full min-h-11 ${i > curIdx ? 'btn-primary' : ''}`} href={signedIn ? '#/purchase' : '#/register'}>{t(label)}</a>}
                </div>
              </li>
            )
          })}
        </ul>
        <p className="mt-6 text-sm text-muted">{t(S.indicative)}</p>
        <p className="mt-2 text-sm text-muted">{t(S.more)}</p>
      </main>
      <SiteFooter dark={dark} />
    </div>
  )
}

export function ServiceStatus({ dark, setDark }: Props) {
  useLang()
  const [r, setR] = useState<{ up: boolean; ms: number; at: Date }>()
  const [busy, setBusy] = useState(true)
  const check = useCallback(() => {
    setBusy(true)
    const t0 = performance.now()
    return fetch('/health', { cache: 'no-store' }).then(x => x.ok, () => false)
      .then(up => { setR({ up, ms: Math.round(performance.now() - t0), at: new Date() }); setBusy(false) })
  }, [])
  useEffect(() => { document.title = 'LARIS · ' + t(S.navStatus); void check() }, [check])
  return (
    <div className="min-h-screen">
      <SiteHeader dark={dark} setDark={setDark} items={NAV} active="status" />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl px-4 py-12 outline-none md:py-16">
        <h1 className="text-3xl font-bold">{t(S.statusH)}</h1>
        <div role="status" className="card mt-6 flex items-center gap-3 p-6">
          <span aria-hidden className={`size-4 rounded-full ${r ? (r.up ? 'bg-accent' : 'bg-warn') : 'bg-line'}`} />
          <p className="text-lg font-semibold">{!r ? t(S.wait) : r.up ? t(S.up) : t(S.down)}</p>
        </div>
        {r && <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted">{t(S.checked)}</dt><dd>{r.at.toLocaleTimeString()}</dd>
          <dt className="text-muted">{t(S.reply)}</dt><dd className="tabular-nums">{r.ms} ms</dd>
        </dl>}
        <button type="button" className="btn mt-6 min-h-11" disabled={busy} onClick={() => { void check() }}>{t(S.again)}</button>
        <p className="mt-6 text-sm text-muted">{t(S.statusNote)}</p>
      </main>
      <SiteFooter dark={dark} />
    </div>
  )
}

import { getAccount, getToken, logout } from './api'
import { Brand, ThemeToggle } from './ui'
import { Icon } from './icons'
import { LANGS, setLang, t, useLang } from './i18n'
import type { Text } from './i18n'

// Header and footer shared by the public pages (homepage, pricing, service status).
const C = {
  sections: { en: 'Sections', ms: 'Bahagian', zh: '页面导航', ta: 'பிரிவுகள்' },
  signIn: { en: 'Sign in', ms: 'Log masuk', zh: '登录', ta: 'உள்நுழை' },
  signOut: { en: 'Sign out', ms: 'Log keluar', zh: '退出登录', ta: 'வெளியேறு' },
  open: { en: 'Open LARIS', ms: 'Buka LARIS', zh: '打开 LARIS' },
  account: { en: 'Account menu', ms: 'Menu akaun', zh: '账户菜单' },
  pricing: { en: 'Pricing', ms: 'Harga', zh: '价格' },
  langL: { en: 'Language', ms: 'Bahasa', zh: '语言', ta: 'மொழி' },
  foot: { en: 'LARIS by SPARK SURGE · Built for the SDC 2026 hackathon, SDG 8', ms: 'LARIS oleh SPARK SURGE · Dibina untuk hackathon SDC 2026, SDG 8', zh: 'LARIS · SPARK SURGE 团队 · SDC 2026 黑客松作品，SDG 8' },
  status: { en: 'Service status', ms: 'Status perkhidmatan', zh: '服务状态' },
}

export interface NavItem { id: string; label: Text; href: string }

// Signed in: the username with Open LARIS and Sign out. Signed out: the Sign in button.
function Account() {
  useLang()
  if (!getToken()) return <a className="btn btn-primary min-h-11" href="#/login">{t(C.signIn)}</a>
  const name = getAccount() ?? 'Account'
  return (
    <details className="relative">
      <summary aria-label={t(C.account)} className="btn min-h-11 cursor-pointer list-none gap-2 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="grid size-7 place-items-center rounded-full bg-tint text-xs font-bold text-accent">{name[0]?.toUpperCase()}</span>
        <span className="max-w-32 truncate">{name}</span><Icon name="down" className="size-4 text-muted" />
      </summary>
      <div className="card absolute right-0 top-full z-50 mt-1 w-56 p-2 shadow-2">
        <a className="sidelink" href="#/home"><Icon name="home" />{t(C.open)}</a>
        <a className="sidelink" href="#/pricing"><Icon name="revenue" />{t(C.pricing)}</a>
        <button type="button" className="sidelink w-full text-left" onClick={() => { void logout() }}><Icon name="logout" />{t(C.signOut)}</button>
      </div>
    </details>
  )
}

// `active` is the nav id to highlight (aria-current). `onNav` lets the homepage scroll to a section instead of following the link.
export function SiteHeader({ dark, setDark, items, active, onNav }: { dark: boolean; setDark: (d: boolean) => void; items: NavItem[]; active?: string; onNav?: (id: string) => void }) {
  const [lang] = useLang()
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-bg">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2">
        <a href="#/welcome" aria-label="LARIS" className="inline-flex min-h-11 items-center"><Brand dark={dark} /></a>
        <nav aria-label={t(C.sections)} className="order-last flex w-full gap-1 overflow-x-auto md:order-none md:w-auto md:flex-1">
          {items.map(x => (
            <a key={x.id} href={x.href} aria-current={active === x.id ? 'true' : undefined}
              onClick={onNav && x.href.startsWith('#') && !x.href.startsWith('#/') ? e => { e.preventDefault(); onNav(x.id) } : undefined}
              className="btn btn-quiet min-h-11 shrink-0 whitespace-nowrap aria-[current=true]:bg-tint aria-[current=true]:text-accent aria-[current=true]:shadow-[inset_0_-2px_0_var(--accent)]">{t(x.label)}</a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 text-sm"><span className="sr-only">{t(C.langL)}</span>
            <select className="input w-auto" value={lang} onChange={e => setLang(e.target.value as typeof lang)}>
              {LANGS.map(([l, n]) => <option key={l} value={l} lang={l}>{n}</option>)}
            </select>
          </label>
          <ThemeToggle dark={dark} setDark={setDark} compact />
          <Account />
        </div>
      </div>
    </header>
  )
}

export function SiteFooter({ dark }: { dark: boolean }) {
  useLang()
  return (
    <footer className="border-t border-hairline">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm text-muted">
        <a href="#/welcome" aria-label="LARIS" className="inline-flex min-h-11 items-center"><Brand dark={dark} /></a>
        <p>{t(C.foot)}</p>
        <p className="flex gap-4">
          <a className="link inline-flex min-h-11 items-center" href="#/pricing">{t(C.pricing)}</a>
          <a className="link inline-flex min-h-11 items-center" href="#/service-status">{t(C.status)}</a>
          {!getToken() && <a className="link inline-flex min-h-11 items-center" href="#/login">{t(C.signIn)}</a>}
        </p>
      </div>
    </footer>
  )
}

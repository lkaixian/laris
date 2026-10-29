import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { MOCK, canOpen, getToken, logout } from './api'
import { Palette } from './Palette'
import { setLang, t, useLang } from './i18n'
import type { Me, Role } from './api'
import { canUpload } from './Listings'
import { Brand, OrgMark, Skeleton, ThemeToggle, focusTop } from './ui'
import { Icon } from './icons'
import type { IconName } from './icons'
import { useToast } from './Toast'
import { licenceOn, issuerOn, useIssuerProbe } from './Licence'
import { articleForNav } from './help/articles'
import { startTour } from './Tour'

/*
  App shell: grouped sidebar (>= md, collapsible to icons), top bar + slide-over drawer (< md), header with org mark,
  global search, theme toggle, role picker (demo only) and user menu. Pages render as `children` inside <main id="main">.

  ADD A NAV ITEM: add { key, label, icon, when? } to a group in NAV below. `key` is the hash route (#/key); it must also
  exist in PAGES in App.tsx. Access follows canOpen(key, owner) from api.ts, so a user never sees what they cannot open.
  `when` is for extra rules that depend on /api/me (see 'catalog').
*/
export interface NavItem { key: string; label: string; icon: IconName; when?: (me?: Me) => boolean }
export const NAV: { label: string; items: NavItem[] }[] = [
  { label: 'Work', items: [
    { key: 'home', label: 'Home', icon: 'home' },
    { key: 'tracker', label: 'Tracker', icon: 'tracker' },
    { key: 'track', label: 'Track', icon: 'pipeline' },
    { key: 'jobs', label: 'Jobs', icon: 'jobs' },
    { key: 'followups', label: 'Follow-ups', icon: 'clock' },
  ] },
  { label: 'Suppliers', items: [
    { key: 'contacts', label: 'Contacts', icon: 'contacts' },
    { key: 'ask', label: 'Ask suppliers', icon: 'ask' },
    { key: 'catalog', label: 'Catalog photos', icon: 'camera', when: canUpload },
    { key: 'alerts', label: 'Stale costs', icon: 'alerts' },
  ] },
  { label: 'Insights', items: [
    { key: 'activity', label: 'Activity', icon: 'activity' },
    { key: 'assistant', label: 'Assistant', icon: 'assistant' },
  ] },
  { label: 'Admin', items: [
    { key: 'team', label: 'Team', icon: 'team' },
    { key: 'roles', label: 'Roles', icon: 'roles' },
    { key: 'settings', label: 'Settings', icon: 'settings' },
    { key: 'privacy', label: 'Privacy and data', icon: 'roles' },
    { key: 'api-access', label: 'API access', icon: 'key' },
    { key: 'ai-settings', label: 'AI settings', icon: 'ask' },
    { key: 'status', label: 'System status', icon: 'warn' },
    { key: 'licence', label: 'Licence', icon: 'key', when: () => licenceOn() },
    { key: 'issuer', label: 'Issue licences', icon: 'key', when: () => issuerOn() },
  ] },
]

// Routes that are children of a nav item: the parent stays marked while you are on them.
const PARENT: Record<string, string> = { doc: 'tracker', contact: 'contacts', purchase: 'licence' }

export const visibleNav = (me: Me | undefined, owner: boolean) =>
  NAV.map(g => ({ ...g, items: g.items.filter(i => canOpen(i.key, owner) && (i.when?.(me) ?? true)) })).filter(g => g.items.length)

const COLLAPSE_KEY = 'laris.nav.collapsed'
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false } }

function NavList({ groups, route, collapsed, idp, onNavigate }: { groups: ReturnType<typeof visibleNav>; route: string; collapsed?: boolean; idp: string; onNavigate?: (href: string) => void }) {
  const here = PARENT[route] ?? route
  return (
    <nav aria-label="Main" className="px-2 pb-2">
      <ul>
        {groups.map(g => (
          <li key={g.label} className={collapsed ? 'mt-2 border-t border-hairline pt-2 first:mt-0 first:border-0 first:pt-0' : ''}>
            <p id={`${idp}-${g.label}`} className={collapsed ? 'sr-only' : 'sidegroup'}>{g.label}</p>
            <ul aria-labelledby={`${idp}-${g.label}`} className="grid gap-0.5">
              {g.items.map(i => (
                <li key={i.key} className="group relative">
                  <a className={`sidelink ${!collapsed && articleForNav(i.key) ? 'pr-10' : ''}`} href={`#/${i.key}`} aria-current={here === i.key ? 'page' : undefined} title={collapsed ? i.label : undefined} onClick={() => onNavigate?.(`#/${i.key}`)}>
                    <Icon name={i.icon} />
                    <span className={collapsed ? 'sr-only' : ''}>{i.label}</span>
                  </a>
                  {!collapsed && (a => a && (
                    <a href={`#/help/${a.id}`} aria-label={`Help: ${i.label}`} onClick={() => onNavigate?.(`#/help/${a.id}`)}
                      className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-sm font-bold text-muted opacity-0 hover:bg-tint hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 [@media(pointer:coarse)]:size-11">
                      <span aria-hidden="true">?</span>
                    </a>))(articleForNav(i.key))}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function RolePicker({ role, onRole }: { role: Role; onRole: (r: Role) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm font-semibold">
      <span className="hidden whitespace-nowrap xl:inline">Role (simulated)</span>
      <select className="input" aria-label="Role (simulated)" value={role} onChange={e => onRole(e.target.value as Role)}>
        <option value="owner">Owner</option><option value="staff">Staff</option>
      </select>
    </label>
  )
}

// Avatar button + small panel (disclosure pattern): account link and sign out. Closes on Escape, outside click, focus leaving, route change.
function LangSwitch() {
  const [lang] = useLang()
  return (
    <div role="group" aria-label="Language / Bahasa" className="flex gap-1 px-2 py-1">
      {([['en', 'English'], ['ms', 'Bahasa Melayu']] as const).map(([l, n]) => <button key={l} type="button" lang={l} className="btn min-h-11 flex-1 px-2 text-sm aria-pressed:bg-tint aria-pressed:font-bold" aria-pressed={lang === l} onClick={() => setLang(l)}>{n}</button>)}
    </div>
  )
}

function UserMenu({ me, signedIn, loc }: { me?: Me; signedIn: boolean; loc: string }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const toast = useToast()
  useEffect(() => setOpen(false), [loc])
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    addEventListener('mousedown', down); addEventListener('keydown', key)
    return () => { removeEventListener('mousedown', down); removeEventListener('keydown', key) }
  }, [open])
  if (!me || !(MOCK || signedIn)) return null
  const initials = me.name.replace(/^SAMPLE\s+/i, '').split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
  return (
    <div ref={box} className="relative" onBlur={e => { if (e.relatedTarget && !box.current?.contains(e.relatedTarget as Node)) setOpen(false) }}>
      <button ref={btn} type="button" className="inline-flex min-h-(--control-h) items-center gap-2 rounded-ui px-1.5 hover:bg-surface-2" aria-expanded={open} aria-controls="user-panel" aria-label={`Account menu for ${me.name}`} onClick={() => setOpen(!open)}>
        <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-tint text-xs font-bold text-accent">{initials || <Icon name="user" className="size-4" />}</span>
        <span aria-hidden="true" className="hidden max-w-32 truncate text-sm font-semibold xl:inline">{me.name}</span>
        <Icon name="down" className="size-4 text-muted" />
      </button>
      {open && (
        <div id="user-panel" className="card absolute right-0 top-full z-50 mt-1 w-64 p-2 shadow-2">
          <p className="px-2 py-1"><span className="block truncate font-semibold">{me.name}</span><span className="block text-sm text-muted">{me.role_name ?? me.role}</span></p>
          <a className="sidelink" href="#/account"><Icon name="user" />Account</a>
          <a className="sidelink" href="#/help"><Icon name="ask" />Help</a>
          <button type="button" className="sidelink w-full text-left" onClick={() => { setOpen(false); startTour() }}><Icon name="check" />Take the tour</button>
          <LangSwitch />
          {signedIn && <button type="button" className="sidelink w-full text-left" onClick={async () => { setOpen(false); await logout(); toast('You have been signed out.') }}><Icon name="logout" />Sign out</button>}
        </div>
      )}
    </div>
  )
}

// Slide-over for narrow screens. Focus goes in (close button), Tab stays inside, Escape and the scrim close it, the page behind is locked.
function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('button')?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); return onClose() }
    if (e.key !== 'Tab') return
    const f = [...box.current!.querySelectorAll<HTMLElement>('a[href],button,select,input')].filter(x => !x.hasAttribute('disabled'))
    const first = f[0], last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
  return (
    <div className="fixed inset-0 z-50 md:hidden" onKeyDown={keys}>
      <div aria-hidden="true" className="absolute inset-0 bg-ink/50" style={{ animation: 'fade-in 150ms ease-out' }} onClick={onClose} />
      <div ref={box} role="dialog" aria-modal="true" aria-label="Menu" className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-surface shadow-3" style={{ animation: 'drawer-in 160ms ease-out' }}>
        {children}
      </div>
    </div>
  )
}

export interface ShellProps {
  me?: Me; hash: string; route: string; dark: boolean; setDark: (d: boolean) => void
  owner: boolean; role: Role; onRole: (r: Role) => void; banner?: ReactNode; children: ReactNode
}

export function Shell({ me, hash, route, dark, setDark, owner, role, onRole, banner, children }: ShellProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [drawer, setDrawer] = useState(false)
  const [pal, setPal] = useState(false)
  const [lang] = useLang()
  const toast = useToast()
  const menuBtn = useRef<HTMLButtonElement>(null)
  const signedIn = !!getToken()
  useIssuerProbe()
  const groups = visibleNav(me, owner)

  const toggleCollapsed = () => { const c = !collapsed; setCollapsed(c); try { localStorage.setItem(COLLAPSE_KEY, c ? '1' : '0') } catch { /* storage blocked: lasts for this visit */ } }
  const closeDrawer = () => { setDrawer(false); requestAnimationFrame(() => menuBtn.current?.focus()) }  // after the page behind stops being inert  // Escape, scrim, close button: focus goes back to the menu button
  useEffect(() => setDrawer(false), [hash])                                // route change: just close, the page heading takes focus
  useEffect(() => {                                                        // widening the window past md closes it too
    const m = matchMedia('(min-width: 768px)'), h = () => m.matches && setDrawer(false)
    m.addEventListener('change', h); return () => m.removeEventListener('change', h)
  }, [])
  useEffect(() => {  // "/" (not while typing) or Ctrl/Cmd+K opens the palette
    const k = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setPal(true) }
      else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !el.isContentEditable && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) { e.preventDefault(); setPal(true) }
    }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [])
  const act = async (a: 'theme' | 'signout' | 'tour') => {
    if (a === 'tour') return startTour()
    if (a === 'signout') { await logout(); toast('You have been signed out.'); return }
    const next = dark ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('theme', next) } catch { /* storage blocked: choice lasts for this visit only */ }
    setDark(!dark)
  }
  const mac = /Mac|iPhone|iPad/.test(navigator.platform)
  const picker = !signedIn && <RolePicker role={role} onRole={onRole} />

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-[70] focus:bg-surface focus:p-3" onClick={e => { e.preventDefault(); document.getElementById('main')?.focus() }}>Skip to content</a>
      <div className="md:flex">
        <div role="region" aria-label="Sidebar" inert={pal || undefined} className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-hairline bg-surface transition-[width] duration-150 md:flex ${collapsed ? 'w-14' : 'w-58'}`}>
          <div className={`flex shrink-0 items-center border-b border-hairline ${collapsed ? 'flex-col gap-1 px-1 py-2' : 'h-14 justify-between pl-4 pr-2'}`}>
            <a href="#/home" className="inline-flex min-h-(--control-h) items-center" aria-label="LARIS home">
              {collapsed ? <img src="/brand/laris-mark.png" alt="" className="size-8 object-contain" /> : <Brand dark={dark} />}
            </a>
            <button type="button" className="btn btn-quiet size-(--control-h) px-0" aria-expanded={!collapsed} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} title={collapsed ? 'Expand menu' : 'Collapse menu'} onClick={toggleCollapsed}>
              <Icon name={collapsed ? 'right' : 'left'} />
            </button>
          </div>
          {me && !collapsed && <div className="border-b border-hairline px-4 py-2"><OrgMark org={me.org} /></div>}
          <div className="min-h-0 flex-1 overflow-y-auto pt-1">{me ? <NavList groups={groups} route={route} collapsed={collapsed} idp="sb" /> : <div className="p-3"><Skeleton rows={6} shape="text" /></div>}</div>
        </div>

        <div className="min-w-0 flex-1" inert={drawer || pal || undefined}>
          <header className="z-30 border-b border-hairline bg-surface md:sticky md:top-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2 md:h-14 md:flex-nowrap md:px-6 md:py-0">
              <button ref={menuBtn} type="button" className="btn size-11 px-0 md:hidden" aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}><Icon name="menu" /></button>
              <span className="shrink-0 md:hidden"><Brand dark={dark} /></span>
              {me && <><span aria-hidden="true" className="h-8 w-px shrink-0 bg-line md:hidden" /><div className="min-w-0 flex-1 md:hidden"><OrgMark org={me.org} /></div></>}
              {!me && <span className="flex-1 md:hidden" />}
              <div className="order-last hidden md:order-none md:block md:max-w-[560px] md:flex-1">
                <button type="button" className="input flex w-full items-center gap-2 text-left text-muted" aria-keyshortcuts="/ Control+K Meta+K" onClick={() => setPal(true)}>
                  <Icon name="search" className="size-4" /><span className="flex-1 truncate">{t({ en: 'Search or jump to...', ms: 'Cari atau pergi ke...' }, lang)}</span>
                  <kbd aria-hidden="true" className="rounded-xs border border-hairline px-1.5 text-xs">{mac ? '⌘ K' : 'Ctrl K'}</kbd>
                </button>
              </div>
              <button type="button" className="btn ml-auto size-11 px-0 md:hidden" aria-label={t({ en: 'Search', ms: 'Carian' }, lang)} aria-keyshortcuts="/" onClick={() => setPal(true)}><Icon name="search" /></button>
              <div className="hidden md:ml-auto md:block">{picker}</div>
              <ThemeToggle dark={dark} setDark={setDark} compact />
              <UserMenu me={me} signedIn={signedIn} loc={hash} />
            </div>
          </header>
          {MOCK && <div role="region" aria-label="Sample data notice" className="sticky top-0 z-20 flex min-h-7 items-center justify-center bg-surface-2 px-4 text-center text-xs text-warn md:top-14">SAMPLE data. Mock mode is on: nothing here is real and nothing is saved to a server.</div>}
          {banner}
          <main id="main" tabIndex={-1} key={role} className="mx-auto w-full max-w-[1280px] px-4 py-6 md:px-6 xl:px-8">{children}</main>
        </div>
      </div>

      {pal && <Palette ctx={{ me, owner, signedIn }} onClose={() => setPal(false)} onAction={act} />}
      {drawer && (
        <Drawer onClose={closeDrawer}>
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-hairline px-3">
            <button type="button" className="btn size-11 px-0" aria-label="Close menu" onClick={closeDrawer}><Icon name="close" /></button>
            <Brand dark={dark} />
          </div>
          {me && <div className="border-b border-soft px-3 py-2"><OrgMark org={me.org} /></div>}
          <div className="flex-1 pt-1">{me ? <NavList groups={groups} route={route} idp="dr" onNavigate={href => { setDrawer(false); if (href === location.hash) focusTop() }} /> : <div className="p-3"><Skeleton rows={6} shape="text" /></div>}</div>
          {picker && <div className="border-t border-soft p-3">{picker}</div>}
        </Drawer>
      )}
    </>
  )
}

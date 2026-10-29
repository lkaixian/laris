import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, resolveMe, getRole, setRole, MOCK, authConfig, getToken, getAccount, can, canOpen, ApiError } from './api'
import type { License } from './api'
import Login from './Login'
import { Register, Forgot } from './Signup'
import AcceptInvite from './Invite'
import Accept from './Accept'
import { LicenseProvider, LicenceGate, LicenceBanner, LicenceView, PurchaseView, Frame, blocked, setLicenceOn } from './Licence'
import { Shell } from './Shell'
import { ErrorBoundary } from './ErrorBoundary'
import { ToastProvider, useToast } from './Toast'
import IdleGuard from './Idle'
import { AccountView, TeamView } from './Team'
import { RolesView } from './Roles'
import { IssuerView } from './Issuer'
import { ChannelsCard } from './Channels'
import { QuoteSettingsCard } from './QuoteSettings'
import { ContactDetail, ContactsView } from './Contacts'
import { SearchView } from './Search'
import { AssistantView, AssistantWidget } from './Assistant'
import { HomeView } from './Home'
import { TrackView } from './Track'
import { JobsView } from './JobsBoard'
import { AskView } from './Ask'
import { StatusView, HealthBanner } from './Status'
import { CatalogView } from './Listings'
import { useLang } from './i18n'
import { tx, txOr } from './strings'
const txOrReason = (r: string) => txOr(`why.${r}`, r)
import { ActivityView } from './Activity'
import { HelpView } from './Help'
import { PrivacyView } from './Privacy'
import { ApiAccessView } from './ApiAccess'
import { AiSettingsView } from './AiSettings'
import { TourHost } from './Tour'
import { TrackerView } from './TrackerPage'
import { DetailView } from './DocDetail'
import { FilterBar, ToggleChip } from './kit'
import { rm, msg, focusTop, useFetch, Async, Skeleton, EmptyState, PageHeader, Hint, OrgCtx, Status, applyBrand, OfflineBanner, HEAT_BANDS, HeatChip, HeatLegend, heatName } from './ui'
import type { Heat } from './ui'
import type { Role, Me, Alert, Followup, MarginReport, Settings, Proposal } from './api'




// ---------- Stale-cost alerts + field proposals ----------
function Report() {
  const s = useFetch<MarginReport>('/reports/margin?days=7')
  const r = s.data
  return (
    <section className="mb-8" aria-labelledby="wk">
      <h2 id="wk" className="mb-2 text-base font-semibold">Last 7 days</h2>
      <Async s={s} empty={!r || !r.quotes} emptyText="No quotes were created in the last 7 days.">
        {r && <>
          <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {([['Quotes', String(r.quotes ?? 0)], ['Quoted', rm(r.revenue)], ['Margin', `${rm(r.margin)}${r.margin_pct != null ? ` (${r.margin_pct}%)` : ''}`],
               ['Won / lost', `${r.won ?? 0} / ${r.lost ?? 0}`]] as const).map(([k, v]) => (
              <div key={k} className="card"><dt className="text-sm text-muted">{k}</dt><dd className="text-lg font-semibold">{v}</dd></div>
            ))}
          </dl>
          {(r.lowest_margin?.length ?? 0) > 0 && <p className="mt-2 text-sm">Thinnest margin: {r.lowest_margin!.map((q, i) => (
            <span key={q.quote_id}>{i > 0 && ', '}<a className="link" href={`#/doc/${q.quote_id}`}>{q.quote_no}</a> ({q.margin_pct ?? 'n/a'}%)</span>))}</p>}
        </>}
      </Async>
    </section>
  )
}



function SettingsView({ owner }: { owner: boolean }) {
  const s = useFetch<Settings>('/settings')
  const [f, setF] = useState<Settings>()
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [logoErr, setLogoErr] = useState('')
  const toast = useToast()
  useEffect(() => { if (s.data) setF(s.data) }, [s.data])
  if (!owner) return <><PageHeader title="Settings" /><p className="card text-muted">You do not have access. Only the owner changes settings.</p></>
  const text = (k: 'ssm_no' | 'address' | 'bank_details' | 'sst_no', name: string) => (
    <label className="flex flex-col gap-1 text-sm font-semibold">{name}
      <input className="input font-normal" value={f?.[k] ?? ''} onChange={e => f && setF({ ...f, [k]: e.target.value })} /></label>
  )
  const colour = (f?.brand_color ?? '').trim()
  const colourOk = colour === '' || /^#[0-9a-f]{6}$/i.test(colour)
  // Logo: png, jpeg or webp up to 200 KB, read in the browser into a data URL. The server checks the real bytes again.
  const pickLogo = (file?: File) => {
    setLogoErr('')
    if (!file || !f) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setLogoErr('Use a PNG, JPEG or WebP image. SVG is not accepted.')
    if (file.size > 200 * 1024) return setLogoErr('That image is over 200 KB. Use a smaller one.')
    const r = new FileReader()
    r.onload = () => setF(p => p && { ...p, logo_data_url: String(r.result) })
    r.onerror = () => setLogoErr('Could not read that file. Try another image.')
    r.readAsDataURL(file)
  }
  const save = async () => {
    if (!f || busy) return
    setErr('')
    if (!colourOk) return setErr('The brand colour must be a hex colour like #0f5c47.')
    setBusy(true)
    try {
      const out = await api<Settings>('POST', '/settings', {
        display_name: f.display_name?.trim() || null, brand_color: colour ? colour.toLowerCase() : null, logo_data_url: f.logo_data_url || null,
        min_margin_pct: f.min_margin_pct, ssm_no: f.ssm_no ?? '', address: f.address ?? '', bank_details: f.bank_details ?? '',
        sst_registered: f.sst_registered, sst_no: f.sst_no ?? '' })
      setF(out); toast('Settings saved.')
      window.dispatchEvent(new Event('laris:branding'))
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 413 ? 'The logo is too large. Use an image under 200 KB.'
        : e instanceof ApiError && e.status === 415 ? 'The logo must be a PNG, JPEG or WebP image.'
        : e instanceof ApiError && e.status === 422 && /colou?r/i.test(e.code + e.message) ? 'The brand colour is not valid. Use a hex colour like #0f5c47.' : msg(e))
    } finally { setBusy(false) }
  }
  return (
    <>
      <PageHeader title="Settings" description="The margin floor flags thin quotes for review. The business details are printed on the quote PDF. Branding shows in the header for everyone after you save." />
      <Async s={s} empty={false} rows={4}>
        {f && (
          <form className="grid max-w-xl gap-3" onSubmit={e => { e.preventDefault(); save() }}>
            <fieldset className="grid gap-3 rounded-ui border border-soft p-3">
              <legend className="px-1 text-sm font-semibold">Branding (everyone sees this)</legend>
              <label className="flex flex-col gap-1 text-sm font-semibold">Organisation display name
                <input className="input font-normal" maxLength={120} value={f.display_name ?? ''} onChange={e => setF({ ...f, display_name: e.target.value })} /></label>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm font-semibold">Brand colour (hex)
                  <input className="input w-32 font-normal" placeholder="#0f5c47" maxLength={7} autoCapitalize="none" spellCheck={false} aria-invalid={!colourOk || undefined} aria-describedby="bc-help"
                    value={f.brand_color ?? ''} onChange={e => setF({ ...f, brand_color: e.target.value })} /></label>
                <label className="flex flex-col gap-1 text-sm font-semibold">Pick a colour
                  <input type="color" className="input w-16 p-1" value={colourOk && colour ? colour.toLowerCase() : '#0f5c47'} onChange={e => setF({ ...f, brand_color: e.target.value })} /></label>
                <span aria-hidden="true" className="size-11 rounded-ui border border-line" style={{ backgroundColor: colourOk && colour ? colour : 'var(--accent)' }} />
                <button type="button" className="btn" onClick={() => setF({ ...f, brand_color: null })}>Reset colour</button>
              </div>
              <p id="bc-help" className="text-sm text-muted">{colour ? (colourOk ? `Colour ${colour.toLowerCase()} is used for main buttons and the active tab.` : 'Not a valid colour yet. Use # and six hex digits.') : 'No colour set: the standard LARIS green is used.'}</p>
              <div className="grid gap-2">
                <label className="flex flex-col gap-1 text-sm font-semibold">Logo (PNG, JPEG or WebP, up to 200 KB)
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="input py-2 font-normal" aria-describedby={logoErr ? 'logo-err' : undefined}
                    onChange={e => { pickLogo(e.target.files?.[0]); e.target.value = '' }} /></label>
                {logoErr && <p id="logo-err" role="alert" className="text-sm text-warn">{logoErr}</p>}
                {f.logo_data_url
                  ? <div className="flex flex-wrap items-center gap-3"><img src={f.logo_data_url} alt="Logo preview" className="h-12 max-w-40 rounded-ui border border-soft bg-surface object-contain p-1" />
                      <button type="button" className="btn" onClick={() => setF({ ...f, logo_data_url: null })}>Remove logo</button></div>
                  : <p className="text-sm text-muted">No logo: initials are shown instead.</p>}
              </div>
            </fieldset>
            <label className="flex flex-col gap-1 text-sm font-semibold">Margin floor (%)
              <input className="input font-normal" inputMode="decimal" aria-describedby="mf-help" value={f.min_margin_pct} onChange={e => setF({ ...f, min_margin_pct: e.target.value })} />
              <Hint id="mf-help">Margin is profit as a share of the selling price. A quote below this is flagged for review.</Hint></label>
            {text('ssm_no', 'SSM registration number')}
            {text('address', 'Business address')}
            {text('bank_details', 'Bank details for payment')}
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={f.sst_registered} onChange={e => setF({ ...f, sst_registered: e.target.checked })} /> Registered for SST</label>
            {f.sst_registered && text('sst_no', 'SST registration number')}
            {err && <p role="alert" className="text-sm text-warn">{err}</p>}
            <div><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? 'Saving...' : 'Save settings'}</button></div>
          </form>
        )}
      </Async>
      <ChannelsCard />
      <QuoteSettingsCard />
    </>
  )
}

function Followups() {
  const s = useFetch<Followup[]>(can('manage_followups') ? '/followups' : null)  // no permission: no request (the page is not reachable then anyway)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')  // "<id>:<action>" while that call runs
  const [band, setBand] = useState<Heat | ''>('')
  const toast = useToast()
  const act = async (f: Followup, action: 'send' | 'skip') => {
    if (busy) return
    setErr(''); setBusy(`${f.id}:${action}`)
    try { await api('POST', `/followups/${f.id}`, { action }); toast(action === 'send' ? tx('fu.sentToast', f.doc_no) : tx('fu.skippedToast', f.doc_no)); s.reload() }
    catch (e) { setErr(msg(e)) } finally { setBusy('') }
  }
  const counts = Object.fromEntries(HEAT_BANDS.map(h => [h, (s.data ?? []).filter(f => f.heat === h).length])) as Record<Heat, number>
  const shown = (s.data ?? []).filter(f => !band || f.heat === band)
  return (
    <section id="followups" aria-label={tx('fu.aria')}>
      <PageHeader title={tx('fu.title')} description={tx('fu.lead')} />
      {err && <p role="alert" className="mb-2 text-sm text-warn">{err}</p>}
      {!!s.data?.length && <>
        <FilterBar label={tx('fu.filters')} chips={band ? [{ label: tx('fu.ageChip', heatName(band)), onRemove: () => setBand('') }] : []} onClear={band ? () => setBand('') : undefined}>
          {HEAT_BANDS.map(h => <ToggleChip key={h} pressed={band === h} onClick={() => setBand(band === h ? '' : h)}><span aria-hidden="true" className={`heat-${h} size-2.5 rounded-full`} style={{ background: 'var(--heat-fg)' }} />{heatName(h)} <span className="tabular-nums">{counts[h]}</span></ToggleChip>)}
        </FilterBar>
        <div className="mb-3"><HeatLegend /></div>
      </>}
      <Async s={s} rows={2} empty={!s.data?.length} emptyText={tx('fu.none')} emptyHint={tx('fu.noneHint')}>
        {shown.length === 0 ? <p className="card text-sm text-muted">{tx('fu.noneInBand')} <button type="button" className="link" onClick={() => setBand('')}>{tx('fu.showAll')}</button></p> : (
        <ul className="grid gap-2 md:grid-cols-2">
          {shown.map(f => (
            <li key={f.id} className={`card ${f.heat ? `heat-edge heat-${f.heat}` : ''}`}>
              <p className="flex flex-wrap items-center gap-2 font-semibold"><a className="link" href={`#/doc/${f.document_id}`}>{f.doc_no}</a> <span className="font-normal">{tx('fu.for', f.customer)}</span>
                {f.days_waiting != null && <HeatChip heat={f.heat} days={f.days_waiting} />}</p>
              <p className="mt-1 text-sm text-muted">{txOrReason(f.reason)}{f.days_waiting != null ? `, ${tx('fu.sentAgo', f.days_waiting)}` : ''}</p>
              <p className="mt-2 text-sm">{f.suggested_text ?? tx('fu.noContact')}</p>
              {can('manage_followups') && <div className="mt-3 flex flex-wrap gap-2">
                {f.suggested_text && <button type="button" className="btn btn-primary" aria-disabled={!!busy || undefined} onClick={() => act(f, 'send')}>{busy === `${f.id}:send` ? tx('fu.sending') : tx('fu.send', f.doc_no)}</button>}
                <button type="button" className="btn" aria-disabled={!!busy || undefined} onClick={() => act(f, 'skip')}>{busy === `${f.id}:skip` ? tx('fu.skipping') : tx('fu.skip', f.doc_no)}</button>
              </div>}
            </li>
          ))}
        </ul>)}
      </Async>
    </section>
  )
}

function Proposals() {
  const s = useFetch<Proposal[]>('/field-proposals')
  const [err, setErr] = useState('')
  const [type, setType] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const toast = useToast()
  const decide = async (p: Proposal, decision: 'approve' | 'ignore') => {
    if (busy) return
    setErr(''); setBusy(`${p.id}:${decision}`)
    try { await api('POST', `/field-proposals/${p.id}/decide`, { decision, type: type[p.id] ?? 'text', label: p.key.replace(/_/g, ' ') }); toast(decision === 'approve' ? `${p.key} added as a column.` : `${p.key} ignored.`); s.reload(); focusTop() }
    catch (e) { setErr(msg(e)) } finally { setBusy('') }
  }
  return (
    <section className="mt-10 border-t border-soft pt-6" aria-labelledby="newf">
      <h2 id="newf" className="text-base font-semibold">New fields seen on documents</h2>
      <p className="mb-2 text-sm text-muted">A field the extractor found that is not a column yet. Nothing becomes a column until you approve it.</p>
      {err && <p role="alert" className="mb-2 text-sm text-warn">{err}</p>}
      <Async s={s} rows={2} empty={!s.data?.length} emptyText="No unknown fields waiting for a decision.">
        <ul className="grid gap-2 md:grid-cols-2">
          {s.data?.map(p => (
            <li key={p.id} className="card">
              <p className="font-semibold">{p.key}</p>
              <p className="text-sm text-muted">Sample values: {p.sample_values.map(String).join(', ')}</p>
              <label className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold">Column type
                <select className="input" value={type[p.id] ?? 'text'} onChange={e => setType({ ...type, [p.id]: e.target.value })}>
                  {['text', 'number', 'integer', 'date', 'select', 'boolean'].map(t => <option key={t}>{t}</option>)}
                </select>
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn btn-primary" aria-disabled={!!busy || undefined} onClick={() => decide(p, 'approve')}>{busy === `${p.id}:approve` ? 'Adding...' : `Add ${p.key} as column`}</button>
                <button className="btn" aria-disabled={!!busy || undefined} onClick={() => decide(p, 'ignore')}>{busy === `${p.id}:ignore` ? 'Ignoring...' : `Ignore ${p.key}`}</button>
              </div>
            </li>
          ))}
        </ul>
      </Async>
    </section>
  )
}

function AlertsView() {
  const s = useFetch<Alert[]>('/alerts/stale-costs')
  const n = s.data?.length ?? 0
  const lost = (s.data ?? []).reduce((a, x) => a + (Number(x.margin_delta) || 0), 0)
  return (
    <>
      <PageHeader title="Stale-cost alerts" description="Quotes still open whose supplier cost has risen since pricing. Nothing is re-priced automatically." />
      {can('view_reports') && can('view_costs') && <Report />}
      <p role="status" className={s.data && n ? 'mb-4 border-l-4 border-amber pl-3 text-xl font-semibold' : 'sr-only'}>{s.data && n ? `${n} open ${n === 1 ? 'quote' : 'quotes'} affected, margin down ${rm(String(Math.abs(lost)))} in total` : ''}</p>
      <Async s={s} empty={!n} emptyText="No open quote is affected by a newer supplier cost." emptyHint="You will see a quote here if a supplier raises a price after you quoted.">
        <ul className="grid gap-2">
          {s.data?.map(a => (
            <li key={a.quote_id + a.item_key} className="card flex flex-wrap items-center gap-x-6 gap-y-2 border-l-4 border-l-amber">
              <div className="min-w-0 flex-1 basis-64">
              <p className="font-semibold"><a className="link" href={`#/doc/${a.quote_id}`}>{a.quote_no}</a> <span className="font-normal">for {a.customer}</span></p>
              <p className="mt-1 text-sm">{a.item_key}: cost {rm(a.old_cost)} to {rm(a.current_cost)}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2"><span className="badge badge-warn">Margin down {rm(String(Math.abs(Number(a.margin_delta) || 0)))}</span><Status v={a.status} /></p>
              </div>
              <a className="btn" href={`#/doc/${a.quote_id}`}>Review {a.quote_no}</a>
            </li>
          ))}
        </ul>
      </Async>
      <Proposals />
    </>
  )
}

// ---------- Activity ----------
// ---------- Pages and shell ----------
/*
  ADD A PAGE: write the view component, add one entry to PAGES (hash route -> title + render), add a nav item in Shell.tsx NAV,
  and, if it needs a permission, one line in NEED in api.ts. Start the view with <PageHeader title=... /> (it sets <title> and is the focus target).
  Detail pages use PageHeader's `back` prop and a route like #/thing/<id> (arg).
*/
interface PageCtx { me: Me; owner: boolean; arg?: string }
// Mock-only test switch: /?crash=1#/contacts throws while rendering, to see the page fallback. MOCK is a build constant, so real builds drop it.
function MockCrash(): never { throw new Error('Mock crash (?crash=1)') }
const NotFound = () => <><PageHeader title="Page not found" /><EmptyState title="That page does not exist." action={{ label: 'Open the tracker', href: '#/tracker' }} /></>
const PAGES: Record<string, { title: string; render: (c: PageCtx) => ReactNode }> = {
  home: { title: 'Home', render: c => <HomeView me={c.me} owner={can('view_costs')} /> },
  alerts: { title: 'Stale-cost alerts', render: () => <AlertsView /> },
  followups: { title: 'Follow-ups', render: () => <Followups /> },
  tracker: { title: 'Quote tracker', render: c => <TrackerView owner={can('view_costs')} arg={c.arg} /> },
  contacts: { title: 'Contacts', render: c => <ContactsView owner={can('view_costs')} arg={c.arg} /> },
  contact: { title: 'Contact', render: c => c.arg ? <ContactDetail id={c.arg} owner={can('view_costs')} /> : <NotFound /> },
  ask: { title: 'Ask suppliers', render: () => <AskView owner={can('view_replies_prices')} /> },
  catalog: { title: 'Catalog photos', render: c => <CatalogView me={c.me} owner={c.owner} id={c.arg} /> },
  assistant: { title: 'Assistant', render: () => <AssistantView /> },
  search: { title: 'Search', render: c => <SearchView q={safeDecode(c.arg)} /> },
  track: { title: 'Track', render: () => <TrackView /> },
  jobs: { title: 'Jobs', render: c => <JobsView me={c.me} /> },
  settings: { title: 'Settings', render: c => <SettingsView owner={c.owner} /> },
  team: { title: 'Team', render: c => <TeamView owner={c.owner} meId={c.me.id} /> },
  privacy: { title: 'Privacy and data', render: () => <PrivacyView /> },
  'api-access': { title: 'API access', render: () => <ApiAccessView /> },
  'ai-settings': { title: 'AI settings', render: () => <AiSettingsView /> },
  roles: { title: 'Roles', render: c => <RolesView owner={c.owner} /> },
  account: { title: 'Account', render: c => <AccountView name={c.me.name} role={c.me.role_name ?? c.me.role} linked={c.me.telegram_linked} onChange={() => window.dispatchEvent(new Event('laris:branding'))} /> },
  activity: { title: 'Activity log', render: () => <ActivityView /> },
  status: { title: 'System status', render: () => <StatusView /> },
  licence: { title: 'Licence', render: c => <LicenceView owner={c.owner} /> },
  issuer: { title: 'Issue licences', render: () => <IssuerView /> },
  purchase: { title: 'Get a licence', render: c => <PurchaseView owner={c.owner} backHref="#/licence" /> },
  help: { title: 'Help', render: c => <HelpView arg={c.arg} /> },
  doc: { title: 'Document', render: c => c.arg ? <DetailView id={c.arg} owner={c.owner} /> : <NotFound /> },
}

// A malformed escape in the hash (#/search/%E0%A4%A) must not throw: treat it as empty.
const safeDecode = (s = '') => { try { return decodeURIComponent(s) } catch { return '' } }
const NOT_ENFORCED: License = { status: 'active', plan: null, seats: null, seats_used: 0, expires_at: null, days_left: null, enforced: false, read_only: false, clock: null }

const routeOf = (h: string) => (h.split('/')[1] || 'home').split('?')[0]

// Put a list page back where the reader left it (after Back from a document). Waits for the content to be tall enough; stops if the reader scrolls.
function restoreScroll(y: number) {
  let n = 0, stop = false
  const off = () => { stop = true }
  const evs = ['wheel', 'touchstart', 'keydown'] as const
  evs.forEach(e => addEventListener(e, off, { once: true, passive: true }))
  const tick = () => { if (stop) return; scrollTo(0, y); if (Math.abs(scrollY - y) < 2 || ++n > 180) return; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  return () => { stop = true; evs.forEach(e => removeEventListener(e, off)) }
}

export default function App() {
  return <ToastProvider><AppShell /></ToastProvider>
}

/*
  Sign-in states live here: `gate` is 'checking' | 'login' | 'ready'. A new pre-login screen (register, verify, licence) is another gate
  value rendered before the <Shell>; pages only ever render inside the shell once the gate is 'ready' and /api/me has answered.
*/
function AppShell() {
  const toast = useToast()
  const [hash, setHash] = useState(location.hash)
  const [lang] = useLang()  // a language change redraws the page in the new language
  const [role, setRoleState] = useState<Role>(getRole())
  const prev = useRef({ from: location.hash, now: location.hash })
  const seen = useRef(new Map<string, number>())  // route -> scrollY when it was left
  useEffect(() => {
    history.scrollRestoration = 'manual'
    const h = () => {
      seen.current.set(routeOf(prev.current.now), scrollY)  // read before React swaps the page
      prev.current = { from: prev.current.now, now: location.hash }
      setHash(location.hash)
    }
    addEventListener('hashchange', h); return () => removeEventListener('hashchange', h)
  }, [])
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark')
  // The user id comes from GET /api/me (X-Role only). Re-resolved whenever the simulated role changes; nothing renders before it.
  const [me, setMe] = useState<Me>()
  const [meErr, setMeErr] = useState('')
  const [tries, setTries] = useState(0)
  // 'login' shows the sign-in screen: when the server needs accounts and this tab has no session, or the session ended.
  const [gate, setGate] = useState<'checking' | 'login' | 'ready'>(MOCK ? 'ready' : 'checking')
  const [demo, setDemo] = useState(false)  // the server still accepts the shared access token (login not required)
  // Licence: undefined until read. Not enforced (the usual case) means nothing in the UI changes. `roOk`: the person chose to continue read-only.
  const [lic, setLic] = useState<License>()
  const [licTries, setLicTries] = useState(0)
  const [roOk, setRoOk] = useState(false)
  const licRetried = useRef(false)
  useEffect(() => {
    if (!MOCK) authConfig().then(c => { setDemo(!c.login_required); setGate(c.login_required && !getToken() ? 'login' : 'ready') }, () => setGate('ready'))
    const out = () => { setMe(undefined); setLic(undefined); setRoOk(false); setGate('login') }
    addEventListener('laris:signedout', out)
    const l402 = () => { toast('Your licence is missing or expired, so that change was not saved.', { href: '#/licence', label: 'Open licence' }); setLicTries(t => t + 1) }
    addEventListener('laris:license402', l402)
    return () => { removeEventListener('laris:signedout', out); removeEventListener('laris:license402', l402) }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (gate !== 'ready' || !me) return
    let live = true
    // Failed read (the wrapper already retried once): keep what was known, log, try once more later. Never turns enforcement off by itself.
    api<License>('GET', '/license').then(l => { if (live) { licRetried.current = false; setLicenceOn(l.enforced); setLic(l) } }, e => {
      if (!live) return
      console.warn('Licence check failed', e)
      setLic(p => p ?? NOT_ENFORCED)  // first read: let the app open, the later retry corrects it
      if (!licRetried.current) { licRetried.current = true; setTimeout(() => setLicTries(t => t + 1), 5000) }
    })
    return () => { live = false }
  }, [gate, me?.id, licTries])  // eslint-disable-line react-hooks/exhaustive-deps
  const pub = routeOf(hash) === 'q'  // the public customer page: no staff request of any kind is made for it
  useEffect(() => {
    if (gate !== 'ready' || pub) return
    let live = true
    setMe(undefined); setMeErr('')
    // With a per-user token the server decides the role; follow it instead of the picker.
    resolveMe(role).then(m => { if (!live) return; if (m.role !== role) { setRole(m.role); setRoleState(m.role) } else setMe(m) }, e => live && setMeErr(msg(e)))
    return () => { live = false }
  }, [role, tries, gate, pub])
  const owner = role === 'owner'
  const [, page, arg] = hash.split('/')
  const route0 = (page || 'home').split('?')[0]  // '#/invite?token=...' is route 'invite'
  const route = route0 === 'alerts' && arg === 'followups' ? 'followups' : route0  // the old #/alerts/followups link opens the Follow-ups page
  useEffect(() => applyBrand(me?.org), [me?.org])
  // Branding saved on the Settings page: re-read /me without blanking the page.
  useEffect(() => {
    const h = () => resolveMe(role).then(setMe, () => undefined)
    addEventListener('laris:branding', h); addEventListener('laris:perms', h)  // a 403 may mean the role changed: re-read /me (permissions)
    return () => { removeEventListener('laris:branding', h); removeEventListener('laris:perms', h) }
  }, [role])
  // On navigation: back to a list from a document restores its scroll position, any other route change starts at the top; focus goes to the page heading.
  const firstNav = useRef(true)
  useEffect(() => {
    if (firstNav.current) { firstNav.current = false; return }
    const to = routeOf(hash), from = routeOf(prev.current.from)
    const y = (from === 'doc' || from === 'contact') && to !== from ? seen.current.get(to) : undefined
    if (!y && to !== from) scrollTo(0, 0)
    focusTop(!!y || to !== from)
    return y ? restoreScroll(y) : undefined
  }, [hash])
  const onRole = (r: Role) => { setRole(r); setRoleState(r); toast(`Viewing as ${r === 'owner' ? 'Owner' : 'Staff'}`) }
  if (pub) return <Accept token={hash.split('/')[2]?.split('?')[0] ?? ''} />  // customer link: outside the shell, no sign-in
  if (gate === 'checking') return <div className="p-6"><Skeleton rows={3} /></div>
  // Signed-out screens (full width, no sidebar): sign in is the default, register and forgot are public routes.
  if (route === 'invite') return <AcceptInvite dark={dark} setDark={setDark} />
  if (gate === 'login' || (['login', 'register', 'forgot'].includes(route) && (MOCK || !getToken()))) {
    if (route === 'register') return <Register dark={dark} setDark={setDark} />
    if (route === 'forgot') return <Forgot dark={dark} setDark={setDark} />
    return <Login dark={dark} setDark={setDark} demo={demo} onDone={() => { if (route === 'login') location.hash = '#/home'; setGate('ready'); setTries(t => t + 1) }} />
  }
  const orgName = me?.org.name ?? 'LARIS'
  if (me && lic && blocked(lic) && !roOk) {
    // Enforced and unusable: activation instead of the app (the purchase page is the one other screen).
    if (route === 'purchase') return <OrgCtx value={orgName}><Frame org={orgName} dark={dark} setDark={setDark} wide><PurchaseView owner={owner} backHref="#/licence" /></Frame></OrgCtx>
    return <LicenceGate lic={lic} owner={owner} org={orgName} dark={dark} setDark={setDark} reload={() => setLicTries(t => t + 1)} onReadOnly={() => setRoOk(true)} />
  }
  const entry = PAGES[route]
  return (
    <LicenseProvider value={{ lic, readOnly: !!lic?.enforced && lic.read_only, reload: () => setLicTries(t => t + 1) }}>
    <OrgCtx value={orgName}>
      <Shell me={me} hash={hash} route={route} dark={dark} setDark={setDark} owner={owner} role={role} onRole={onRole} banner={<><OfflineBanner /><LicenceBanner lic={lic} owner={owner} /><HealthBanner owner={owner && !!me} hash={hash} /></>}>
        {meErr ? (
          <div role="alert" className="card border-warn bg-warn-bg text-warn">
            <p>Could not identify the signed-in user: {meErr}</p>
            <button className="btn mt-3" onClick={() => setTries(t => t + 1)}>Retry identifying user</button>
          </div>
        ) : !me || !lic ? <Skeleton rows={4} /> : (
          <div key={route + (route === 'doc' || route === 'contact' ? arg : '') + lang} className="page-in">
            {!canOpen(route, owner) ? <>
              <PageHeader title={entry?.title ?? 'Page'} />
              <p role="alert" className="card text-muted">You do not have access to this page. Ask the owner to change your role if you need it.</p>
            </> : (
              <ErrorBoundary level="page">
                {MOCK && route === 'contacts' && new URLSearchParams(location.search).get('crash') === '1' && <MockCrash />}
                {entry ? entry.render({ me, owner, arg }) : <NotFound />}
              </ErrorBoundary>
            )}
          </div>
        )}
        {me && lic && <AssistantWidget hidden={route === 'assistant' || !canOpen('assistant', owner)} />}
      </Shell>
      {me && <TourHost me={me} owner={owner} />}
      {!MOCK && getAccount() && <IdleGuard />}
    </OrgCtx>
    </LicenseProvider>
  )
}

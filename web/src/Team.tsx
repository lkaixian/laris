import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError, getAccount, MOCK } from './api'
import { ActionError, Async, EmptyState, PageHeader, msg, useAction, useFetch } from './ui'
import { ConfirmDialog, DataTable, FilterBar, FilterSelect, MoreMenu, Tabs, ToggleChip } from './kit'
import type { Col } from './kit'
import { useToast } from './Toast'
import { TelegramLinkControls } from './TelegramLink'
import { locale, t, useLang } from './i18n'
import type { Text } from './i18n'

const S = {
  again: { en: 'Try again', ms: 'Cuba lagi', zh: '重试', ta: 'மீண்டும் முயற்சிக்கவும்' },
  cancel: { en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து செய்' },
  role: { en: 'Role', ms: 'Peranan', zh: '角色', ta: 'பங்கு' },
  sending: { en: 'Sending...', ms: 'Menghantar...', zh: '发送中...', ta: 'அனுப்புகிறது...' },
  working: { en: 'Working...', ms: 'Sedang diproses...', zh: '处理中...', ta: 'செயல்படுகிறது...' },
  linked: { en: 'Linked', ms: 'Dipautkan', zh: '已链接', ta: 'இணைக்கப்பட்டது' },
  notLinked: { en: 'Not linked', ms: 'Tidak dipautkan', zh: '未链接', ta: 'இணைக்கப்படவில்லை' },
  addPw: { en: 'Add with a password', ms: 'Tambah dengan kata laluan', zh: '用密码添加', ta: 'கடவுச்சொல்லுடன் சேர்' },
  pw10: { en: 'The password needs at least 10 characters.', ms: 'Kata laluan mesti sekurang-kurangnya 10 aksara.', zh: '密码至少需要 10 个字符。', ta: 'கடவுச்சொல் குறைந்தது 10 எழுத்துகள் கொண்டிருக்க வேண்டும்.' },
  team: { en: 'Team', ms: 'Pasukan', zh: '团队', ta: 'குழு' },
  invite: { en: 'Invite person', ms: 'Jemput orang', zh: '邀请成员', ta: 'நபரை அழைக்கவும்' },
  byEmail: { en: 'By email', ms: 'Melalui e-mel', zh: '通过邮件', ta: 'மின்னஞ்சல் மூலம்' },
  withPw: { en: 'With a password', ms: 'Dengan kata laluan', zh: '用密码', ta: 'கடவுச்சொல்லுடன்' },
  all: { en: 'All', ms: 'Semua', zh: '全部', ta: 'அனைத்தும்' },
  status: { en: 'Status', ms: 'Status', zh: '状态', ta: 'நிலை' },
  active: { en: 'Active', ms: 'Aktif', zh: '正常', ta: 'செயலில்' },
  invited: { en: 'Invited', ms: 'Dijemput', zh: '已邀请', ta: 'அழைக்கப்பட்டது' },
  expired: { en: 'Invite expired', ms: 'Jemputan tamat tempoh', zh: '邀请已过期', ta: 'அழைப்பு காலாவதியானது' },
  deactivated: { en: 'Deactivated', ms: 'Dinyahaktifkan', zh: '已停用', ta: 'செயலிழக்கப்பட்டது' },
  save: { en: 'Save', ms: 'Simpan', zh: '保存', ta: 'சேமி' },
  name: { en: 'Name', ms: 'Nama', zh: '姓名', ta: 'பெயர்' },
  sessions: { en: 'Sessions', ms: 'Sesi', zh: '会话', ta: 'அமர்வுகள்' },
  you: { en: 'You', ms: 'Anda', zh: '你', ta: 'நீங்கள்' },
}  satisfies Record<string, Text>

interface Member { id: string; name: string; username: string | null; role: 'owner' | 'staff'; role_key?: string; role_name?: string; active: boolean; has_password: boolean; sessions: number; telegram_linked?: boolean }

interface Invite { id: string; email: string; role_key: string; role_name: string; status: 'pending' | 'accepted' | 'revoked' | 'expired'; invited_by_name?: string; created_at: string; expires_at: string }

type Opt = { key: string; name: string }
interface Row { id: string; invite: boolean; name: string; sub: string; roleKey: string; roleName: string; status: 'active' | 'inactive' | 'invited' | 'expired'; linked: boolean; sessions: number; m?: Member; i?: Invite }
type Dlg = { k: 'invite' } | { k: 'role' | 'pw' | 'deact' | 'revoke'; r: Row }
type Chip = '' | 'owner' | 'staff' | 'invite' | 'nolink'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const field = 'flex flex-col gap-1 text-sm font-semibold'

// Native <dialog> shell for the small forms (the kit ConfirmDialog is for yes/no). Escape closes; the browser traps focus and keeps the page inert.
function FormDialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} aria-labelledby="fd-title" onCancel={e => { e.preventDefault(); onClose() }} className="m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-[480px] overflow-y-auto rounded-card bg-surface p-5 text-ink shadow-3 backdrop:bg-ink/50">
      <h2 id="fd-title" className="text-md font-semibold">{title}</h2>
      {open && children}
    </dialog>
  )
}

const Buttons = ({ onCancel, busy, label }: { onCancel: () => void; busy: boolean; label: string }) => (
  <div className="mt-2 flex justify-end gap-2">
    <button type="button" className="btn" onClick={onCancel}>{t(S.cancel)}</button>
    <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t(S.working) : label}</button>
  </div>
)

function RoleBody({ m, opts, busy, onSave, onCancel }: { m: Member; opts: Opt[]; busy: boolean; onSave: (role: string) => void; onCancel: () => void }) {
  useLang()
  const cur = m.role_key ?? m.role
  const [sel, setSel] = useState(cur)
  const changed = sel !== cur
  return (
    <form className="mt-3 grid gap-3" onSubmit={e => { e.preventDefault(); if (changed && !busy) onSave(sel) }}>
      <label className={field}>{t({ en: `Role for ${m.name}`, ms: `Peranan untuk ${m.name}`, zh: `${m.name} 的角色`, ta: `${m.name} க்கான பங்கு` })}
        <select className="input font-normal" value={sel} aria-describedby={changed ? 'rw-warn' : undefined} onChange={e => setSel(e.target.value)}>{opts.map(o => <option key={o.key} value={o.key}>{o.name}</option>)}</select></label>
      {changed && <p id="rw-warn" className="text-sm font-semibold text-warn">{t({ en: 'They will be signed out on every device when you save a new role.', ms: 'Mereka akan dilog keluar pada setiap peranti apabila anda menyimpan peranan baharu.', zh: '保存新角色后，对方会在所有设备上被退出登录。', ta: 'புதிய பங்கைச் சேமிக்கும்போது அவர்கள் எல்லா சாதனங்களிலும் வெளியேற்றப்படுவார்கள்.' })}</p>}
      <Buttons onCancel={onCancel} busy={busy} label={t(S.save)} />
    </form>
  )
}

function PwBody({ m, busy, onSave, onCancel }: { m: Member; busy: boolean; onSave: (pw: string) => void; onCancel: () => void }) {
  useLang()
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  return (
    <form className="mt-3 grid gap-3" noValidate onSubmit={e => { e.preventDefault(); if (pw.length < 10) return setErr(t(S.pw10)); onSave(pw) }}>
      <label className={field} data-guide="tm-password">{t({ en: `New password for ${m.name}`, ms: `Kata laluan baharu untuk ${m.name}`, zh: `${m.name} 的新密码`, ta: `${m.name} க்கான புதிய கடவுச்சொல்` })}
        <input className="input font-normal" type="password" autoComplete="new-password" value={pw} aria-invalid={err ? true : undefined} aria-describedby="pw-hint" onChange={e => { setPw(e.target.value); setErr('') }} /></label>
      <p id="pw-hint" className={`text-sm ${err ? 'text-warn' : 'text-muted'}`} role={err ? 'alert' : undefined}>{err || t({ en: 'At least 10 characters. They are signed out on every device.', ms: 'Sekurang-kurangnya 10 aksara. Mereka dilog keluar pada setiap peranti.', zh: '至少 10 个字符。对方会在所有设备上被退出登录。', ta: 'குறைந்தது 10 எழுத்துகள். அவர்கள் எல்லா சாதனங்களிலும் வெளியேற்றப்படுவார்கள்.' })}</p>
      <Buttons onCancel={onCancel} busy={busy} label={t(S.save)} />
    </form>
  )
}

// Two ways in: an email link (the person picks their own password) or a first password you set and tell them in person.
function InviteBody({ opts, busy, onEmail, onPw, onCancel }: { opts: Opt[]; busy: boolean; onEmail: (email: string, role: string) => void; onPw: (f: { name: string; username: string; role: string; password: string }) => void; onCancel: () => void }) {
  useLang()
  const [tab, setTab] = useState('email')
  const [email, setEmail] = useState('')
  const [f, setF] = useState({ name: '', username: '', role: 'staff', password: '' })
  const [err, setErr] = useState('')
  const roleSel = (v: string, set: (v: string) => void) => <select className="input font-normal" value={v} onChange={e => set(e.target.value)}>{opts.map(o => <option key={o.key} value={o.key}>{o.name}</option>)}</select>
  return (
    <div className="mt-3">
      <Tabs label={t(S.invite)} value={tab} onChange={v => { setTab(v); setErr('') }} options={[{ value: 'email', label: t(S.byEmail) }, { value: 'pw', label: t(S.withPw) }]} />
      {tab === 'email' ? (
        <form className="grid gap-3" noValidate onSubmit={e => {
          e.preventDefault()
          const em = email.trim()
          if (!EMAIL_RE.test(em) || em.length > 254) return setErr(t({ en: 'Enter a valid email address.', ms: 'Masukkan alamat e-mel yang sah.', zh: '请输入有效的电子邮件地址。', ta: 'சரியான மின்னஞ்சல் முகவரியை உள்ளிடவும்.' }))
          onEmail(em, f.role)
        }}>
          <p className="text-sm text-muted">{t({ en: 'We email a link. The person chooses their own username and password, so you never see it.', ms: 'Kami e-melkan pautan. Orang itu memilih sendiri nama pengguna dan kata laluan, jadi anda tidak pernah melihatnya.', zh: '我们会发送一个链接到对方邮箱。对方自行设置用户名和密码，你不会看到。', ta: 'நாங்கள் இணைப்பை மின்னஞ்சல் செய்கிறோம். அவர் தனது பயனர்பெயரையும் கடவுச்சொல்லையும் தானே தேர்வு செய்வார், எனவே நீங்கள் அதைப் பார்க்க மாட்டீர்கள்.' })}</p>
          <label className={field} data-guide="tm-email">{t({ en: 'Email address', ms: 'Alamat e-mel', zh: '电子邮件地址', ta: 'மின்னஞ்சல் முகவரி' })}
            <input className="input font-normal" type="email" name="invite_email" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={254} value={email}
              aria-invalid={err ? true : undefined} aria-describedby={err ? 'inv-err' : undefined} onChange={e => { setEmail(e.target.value); setErr('') }} /></label>
          <label className={field}>{t(S.role)}{roleSel(f.role, role => setF({ ...f, role }))}</label>
          {err && <p id="inv-err" role="alert" className="text-sm text-warn">{err}</p>}
          <Buttons onCancel={onCancel} busy={busy} label={busy ? t(S.sending) : t({ en: 'Send invitation', ms: 'Hantar jemputan', zh: '发送邀请', ta: 'அழைப்பை அனுப்பு' })} />
        </form>
      ) : (
        <form className="grid gap-3" noValidate onSubmit={e => {
          e.preventDefault()
          if (!f.name.trim() || !f.username.trim()) return setErr(t({ en: 'Enter a name and a username.', ms: 'Masukkan nama dan nama pengguna.', zh: '请输入姓名和用户名。', ta: 'பெயரையும் பயனர்பெயரையும் உள்ளிடவும்.' }))
          if (f.password.length < 10) return setErr(t(S.pw10))
          onPw({ ...f, name: f.name.trim(), username: f.username.trim() })
        }}>
          <p className="text-sm text-muted">{t({ en: 'For people without an email address. You set the first password and tell them in person.', ms: 'Untuk orang tanpa alamat e-mel. Anda menetapkan kata laluan pertama dan memberitahu mereka secara peribadi.', zh: '适用于没有电子邮件地址的人。由你设置初始密码并当面告知对方。', ta: 'மின்னஞ்சல் முகவரி இல்லாதவர்களுக்கு. நீங்கள் முதல் கடவுச்சொல்லை அமைத்து நேரில் தெரிவிக்கவும்.' })}</p>
          <label className={field}>{t(S.name)}<input className="input font-normal" value={f.name} onChange={e => { setF({ ...f, name: e.target.value }); setErr('') }} /></label>
          <label className={field}>{t({ en: 'Username (letters, numbers, . _ -)', ms: 'Nama pengguna (huruf, nombor, . _ -)', zh: '用户名（字母、数字、. _ -）', ta: 'பயனர்பெயர் (எழுத்துகள், எண்கள், . _ -)' })}
            <input className="input font-normal" autoCapitalize="none" value={f.username} onChange={e => { setF({ ...f, username: e.target.value }); setErr('') }} /></label>
          <label className={field}>{t(S.role)}{roleSel(f.role, role => setF({ ...f, role }))}</label>
          <label className={field}>{t({ en: 'First password (10+ characters)', ms: 'Kata laluan pertama (10+ aksara)', zh: '初始密码（至少 10 个字符）', ta: 'முதல் கடவுச்சொல் (10+ எழுத்துகள்)' })}
            <input className="input font-normal" type="password" autoComplete="new-password" value={f.password} onChange={e => { setF({ ...f, password: e.target.value }); setErr('') }} /></label>
          {err && <p role="alert" className="text-sm text-warn">{err}</p>}
          <Buttons onCancel={onCancel} busy={busy} label={t(S.addPw)} />
        </form>
      )}
    </div>
  )
}

const statusText = (s: Row['status']) => t(s === 'active' ? S.active : s === 'invited' ? S.invited : s === 'expired' ? S.expired : S.deactivated)

// Owner: who can sign in, and who is invited. People and invitations share one table; actions live in a row menu. Passwords are never shown; a reset signs that person out everywhere.
export function TeamView({ owner, meId }: { owner: boolean; meId: string }) {
  useLang()
  const s = useFetch<Member[]>('/users')
  const inv = useFetch<Invite[]>(owner ? '/invites' : null)
  const roles = useFetch<{ roles: Opt[] }>('/roles')
  const opts = roles.data?.roles ?? [{ key: 'owner', name: t({ en: 'Owner', ms: 'Pemilik', zh: '店主', ta: 'உரிமையாளர்' }) }, { key: 'staff', name: t({ en: 'Staff (no cost or margin)', ms: 'Kakitangan (tanpa kos atau margin)', zh: '员工（看不到成本和利润率）', ta: 'ஊழியர் (செலவு, margin தெரியாது)' }) }]  // class options until /roles answers
  const a = useAction()
  const last = useRef<() => void>(undefined)
  const inviteBtn = useRef<HTMLButtonElement>(null)
  const [dlg, setDlg] = useState<Dlg | null>(null)
  const [q, setQ] = useState('')
  const [roleF, setRoleF] = useState('')
  const [statusF, setStatusF] = useState('')
  const [chip, setChip] = useState<Chip>('')
  const [busyId, setBusyId] = useState('')
  const [rowErr, setRowErr] = useState('')
  const toast = useToast()
  if (!owner) return <><PageHeader title={t(S.team)} /><p className="card text-muted">{t({ en: 'Owner only.', ms: 'Pemilik sahaja.', zh: '仅限店主。', ta: 'உரிமையாளருக்கு மட்டும்.' })}</p></>

  const reload = () => { s.reload(); inv.reload() }
  // Close a dialog and put focus back where the person was: that row's menu button, or the Invite button.
  const close = (id?: string) => {
    setDlg(null)
    requestAnimationFrame(() => (id ? [...document.querySelectorAll<HTMLElement>(`[data-row="${id}"] > div > button`)].find(b => b.offsetParent !== null) : undefined)?.focus() ?? inviteBtn.current?.focus())
  }
  const run = (fn: () => Promise<unknown>, done: string) => {
    last.current = () => run(fn, done)
    a.run(async () => { await fn(); toast(done); reload() })
  }
  const edit = (m: Member, body: object, done: string) => run(async () => { await api('POST', `/users/${m.id}`, body); close(m.id) }, done)
  const row = async (i: Invite, fn: () => Promise<unknown>, done: string) => {
    if (busyId) return
    setBusyId(i.id); setRowErr('')
    try { await fn(); toast(done); reload() } catch (e) { setRowErr(msg(e)); if (e instanceof ApiError && e.status === 409) reload() } finally { setBusyId(''); close() }  // 409: it changed meanwhile, show the current list
  }

  const members = s.data ?? []
  const activeOwners = members.filter(m => m.active && (m.role_key ?? m.role) === 'owner').length
  const rows: Row[] = [
    ...members.map((m): Row => ({ id: m.id, invite: false, name: m.name, sub: m.username ?? t({ en: 'No sign-in account yet', ms: 'Belum ada akaun log masuk', zh: '还没有登录账户', ta: 'உள்நுழைவு கணக்கு இன்னும் இல்லை' }), roleKey: m.role_key ?? m.role, roleName: m.role_name ?? m.role, status: m.active ? 'active' : 'inactive', linked: !!m.telegram_linked, sessions: m.sessions, m })),
    ...(inv.data ?? []).filter(i => i.status === 'pending' || i.status === 'expired').map((i): Row => ({ id: i.id, invite: true, name: i.email, sub: t({ en: `Sent ${relTime(i.created_at)}.`, ms: `Dihantar ${relTime(i.created_at)}.`, zh: `发送于${relTime(i.created_at)}。`, ta: `அனுப்பியது: ${relTime(i.created_at)}.` }) + ' ' + (i.status === 'expired' ? t({ en: `Expired ${relTime(i.expires_at)}.`, ms: `Tamat tempoh ${relTime(i.expires_at)}.`, zh: `过期于${relTime(i.expires_at)}。`, ta: `காலாவதியானது: ${relTime(i.expires_at)}.` }) : t({ en: `Expires ${relTime(i.expires_at)}.`, ms: `Tamat tempoh ${relTime(i.expires_at)}.`, zh: `将于${relTime(i.expires_at)}过期。`, ta: `காலாவதியாகும்: ${relTime(i.expires_at)}.` })), roleKey: i.role_key, roleName: i.role_name, status: i.status === 'expired' ? 'expired' : 'invited', linked: false, sessions: 0, i })),
  ]
  const rank = (r: Row) => r.status === 'invited' ? 3 : r.status === 'expired' ? 4 : r.status === 'inactive' ? 2 : r.roleKey === 'owner' ? 0 : 1  // owners, active people, deactivated, invitations
  rows.sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name, locale()))
  const needle = q.trim().toLowerCase()
  const inChip = (r: Row) => chip === '' || (chip === 'owner' ? !r.invite && r.roleKey === 'owner' : chip === 'staff' ? !r.invite && r.roleKey !== 'owner' : chip === 'invite' ? r.invite : !r.invite && r.status === 'active' && !r.linked)
  const shown = rows.filter(r => (!needle || `${r.name} ${r.sub}`.toLowerCase().includes(needle)) && (!roleF || r.roleKey === roleF) && (!statusF || r.status === statusF) && inChip(r))
  const count = (f: (r: Row) => boolean) => rows.filter(f).length
  const firstInvite = shown.find(r => r.invite)?.id
  const clear = () => { setQ(''); setRoleF(''); setStatusF(''); setChip('') }
  const chips: [Chip, string, number, boolean?][] = [
    ['', t({ en: count(r => !r.invite) === 1 ? 'person' : 'people', ms: 'orang', zh: '位成员', ta: 'பேர்' }), count(r => !r.invite)],
    ['owner', t({ en: count(r => !r.invite && r.roleKey === 'owner') === 1 ? 'owner' : 'owners', ms: 'pemilik', zh: '位店主', ta: 'உரிமையாளர்கள்' }), count(r => !r.invite && r.roleKey === 'owner')],
    ['staff', t({ en: 'staff and other roles', ms: 'kakitangan dan peranan lain', zh: '位员工及其他角色', ta: 'ஊழியர்கள், பிற பங்குகள்' }), count(r => !r.invite && r.roleKey !== 'owner')],
    ['invite', t({ en: count(r => r.invite) === 1 ? 'invitation waiting' : 'invitations waiting', ms: 'jemputan menunggu', zh: '个待处理邀请', ta: 'நிலுவை அழைப்புகள்' }), count(r => r.invite), true],
    ['nolink', t({ en: 'not linked to Telegram', ms: 'belum dipautkan ke Telegram', zh: '位未链接 Telegram', ta: 'Telegram இணைக்கப்படவில்லை' }), count(r => !r.invite && r.status === 'active' && !r.linked), true],
  ]

  const cols: Col<Row>[] = [
    { key: 'name', head: t(S.name), mobile: 'title', cell: r => (
      <div className="min-w-0" data-guide={r.id === firstInvite ? 'tm-pending' : undefined}>
        <span className="break-all">{r.name}</span>{r.id === meId && <> <span className="badge">{t(S.you)}</span></>}
        <span className="block break-all text-sm font-normal text-muted">{r.sub}</span>
      </div>) },
    { key: 'role', head: t(S.role), mobile: 'sub', cell: r => <span className="badge">{r.roleName}</span> },
    { key: 'status', head: t(S.status), mobile: 'badge', cell: r => <span className={r.status === 'active' || r.status === 'invited' ? 'badge' : 'badge badge-warn'}>{statusText(r.status)}</span> },
    { key: 'tg', head: 'Telegram', mobile: 'meta', cell: r => r.invite ? '-' : r.linked ? t(S.linked) : t(S.notLinked) },
    { key: 'ses', head: t(S.sessions), mobile: 'meta', cell: r => r.invite ? '-' : r.sessions },
    { key: 'act', head: t({ en: 'Actions', ms: 'Tindakan', zh: '操作', ta: 'செயல்கள்' }), mobile: 'badge', cell: r => {
      const m = r.m, locked = r.id === meId || (r.roleKey === 'owner' && r.status === 'active' && activeOwners === 1)  // you and the last owner cannot be demoted or deactivated
      const item = 'sidelink w-full text-left'
      const who = r.name
      return (
        <div data-row={r.id} className="ml-auto flex justify-end" data-guide={r.id === shown.find(x => !x.invite)?.id ? 'tm-password' : undefined}>
          <MoreMenu label={<>{t({ en: 'More', ms: 'Lagi', zh: '更多', ta: 'மேலும்' })}<span className="sr-only"> {t({ en: `actions for ${who}`, ms: `tindakan untuk ${who}`, zh: `${who} 的操作`, ta: `${who} க்கான செயல்கள்` })}</span></>  as unknown as string}>
            {m ? <>
              {!locked && <button type="button" data-close className={item} onClick={() => setDlg({ k: 'role', r })}>{t({ en: 'Change role', ms: 'Tukar peranan', zh: '更改角色', ta: 'பங்கை மாற்று' })}</button>}
              <button type="button" data-close className={item} onClick={() => setDlg({ k: 'pw', r })}>{t({ en: 'Set a new password', ms: 'Tetapkan kata laluan baharu', zh: '设置新密码', ta: 'புதிய கடவுச்சொல்லை அமை' })}</button>
              <div className="grid gap-0.5 [&_.btn]:w-full [&_.btn]:px-3 [&_.btn]:justify-start [&_.btn]:border-transparent [&_.btn]:bg-transparent [&_.btn]:text-sm [&_.btn]:font-medium"><TelegramLinkControls base={`/users/${m.id}`} who={m.name} linked={!!m.telegram_linked} onChange={s.reload} /></div>
              {m.active ? !locked && <button type="button" data-close className={`${item} text-warn`} onClick={() => setDlg({ k: 'deact', r })}>{t({ en: 'Deactivate', ms: 'Nyahaktifkan', zh: '停用', ta: 'செயலிழக்கச் செய்' })}</button>
                : <button type="button" data-close className={item} onClick={() => edit(m, { active: true }, t({ en: `${m.name} reactivated.`, ms: `${m.name} diaktifkan semula.`, zh: `${m.name} 已重新启用。`, ta: `${m.name} மீண்டும் செயல்படுத்தப்பட்டார்.` }))}>{t({ en: 'Reactivate', ms: 'Aktifkan semula', zh: '重新启用', ta: 'மீண்டும் செயல்படுத்து' })}</button>}
            </> : r.i && <>
              <button type="button" data-close className={item} aria-disabled={!!busyId || undefined} onClick={() => row(r.i!, () => api('POST', `/invites/${r.id}/resend`), t({ en: `Invitation sent again to ${r.name}.`, ms: `Jemputan dihantar semula kepada ${r.name}.`, zh: `已再次向 ${r.name} 发送邀请。`, ta: `${r.name} க்கு அழைப்பு மீண்டும் அனுப்பப்பட்டது.` }))}>{t({ en: 'Resend invitation', ms: 'Hantar semula jemputan', zh: '重新发送邀请', ta: 'அழைப்பை மீண்டும் அனுப்பு' })}</button>
              {r.status === 'invited' && <button type="button" data-close className={`${item} text-warn`} onClick={() => setDlg({ k: 'revoke', r })}>{t({ en: 'Revoke invitation', ms: 'Batalkan jemputan', zh: '撤销邀请', ta: 'அழைப்பை ரத்து செய்' })}</button>}
            </>}
          </MoreMenu>
        </div>
      )
    } },
  ]

  const dm = dlg && dlg.k !== 'invite' ? dlg.r : undefined
  const err = <ActionError err={a.err} onRetry={() => last.current?.()} label={t(S.again)} />
  const soloHint = !inv.loading && members.filter(m => m.active).length === 1 && !rows.some(r => r.invite)

  return (
    <>
      <PageHeader title={t(S.team)} description={t({ en: 'People who can sign in. Staff cannot see cost or margin. Deactivating someone ends their session at once.', ms: 'Orang yang boleh log masuk. Kakitangan tidak dapat melihat kos atau margin. Menyahaktifkan seseorang menamatkan sesinya serta-merta.', zh: '可以登录的人员。员工看不到成本或利润率。停用某人会立即结束其登录状态。', ta: 'உள்நுழையக்கூடியவர்கள். ஊழியர்கள் செலவு அல்லது margin ஐப் பார்க்க முடியாது. ஒருவரை செயலிழக்கச் செய்தால் அவர் அமர்வு உடனே முடிவடையும்.' })}
        actions={<button ref={inviteBtn} type="button" className="btn btn-primary" data-guide="tm-invite" onClick={() => setDlg({ k: 'invite' })}>{t(S.invite)}</button>} />
      {roles.error && <p role="alert" className="mb-2 text-sm text-warn">{t({ en: 'Could not load the role list, so only the standard roles are shown.', ms: 'Senarai peranan tidak dapat dimuatkan, jadi hanya peranan standard dipaparkan.', zh: '无法加载角色列表，因此只显示标准角色。', ta: 'பங்குகளின் பட்டியலை ஏற்ற முடியவில்லை, எனவே நிலையான பங்குகள் மட்டும் காட்டப்படுகின்றன.' })}</p>}
      {inv.error && <p role="alert" className="mb-2 text-sm text-warn">{inv.error}</p>}
      {rowErr && <p role="alert" className="mb-2 text-sm text-warn">{rowErr}</p>}
      {!dlg && err}
      <Async s={s} shape="table" rows={4}>
        <div role="group" aria-label={t({ en: 'Summary. Select one to filter the list.', ms: 'Ringkasan. Pilih satu untuk menapis senarai.', zh: '概览。选择一项即可筛选列表。', ta: 'சுருக்கம். பட்டியலை வடிகட்ட ஒன்றைத் தேர்ந்தெடுக்கவும்.' })} className="mb-3 flex flex-wrap gap-2">
          {chips.map(([k, label, n, warn]) => <ToggleChip key={k || 'all'} pressed={chip === k} warn={warn && n > 0} onClick={() => setChip(chip === k ? '' : k)}><span className="tabular-nums">{n}</span> {label}</ToggleChip>)}
        </div>
        <FilterBar label={t({ en: 'Filter the team', ms: 'Tapis pasukan', zh: '筛选团队', ta: 'குழுவை வடிகட்டு' })} search={{ value: q, onChange: setQ, label: t({ en: 'Search by name, username or email', ms: 'Cari mengikut nama, nama pengguna atau e-mel', zh: '按姓名、用户名或邮箱搜索', ta: 'பெயர், பயனர்பெயர் அல்லது மின்னஞ்சலால் தேடு' }) }}>
          <FilterSelect label={t(S.role)} value={roleF} onChange={setRoleF}><option value="">{t(S.all)}</option>{opts.map(o => <option key={o.key} value={o.key}>{o.name}</option>)}</FilterSelect>
          <FilterSelect label={t(S.status)} value={statusF} onChange={setStatusF}><option value="">{t(S.all)}</option>{(['active', 'inactive', 'invited', 'expired'] as const).map(v => <option key={v} value={v}>{statusText(v)}</option>)}</FilterSelect>
        </FilterBar>
        <p role="status" className="sr-only">{t({ en: `${shown.length} of ${rows.length} shown`, ms: `${shown.length} daripada ${rows.length} dipaparkan`, zh: `显示 ${shown.length} / ${rows.length}`, ta: `${rows.length} இல் ${shown.length} காட்டப்படுகிறது` })}</p>
        {shown.length ? (
          <div data-guide="tm-list">
            <DataTable label={t({ en: 'Team members and invitations', ms: 'Ahli pasukan dan jemputan', zh: '团队成员和邀请', ta: 'குழு உறுப்பினர்களும் அழைப்புகளும்' })} caption={t({ en: 'Who can sign in and who is invited, with role, status and Telegram link.', ms: 'Siapa yang boleh log masuk dan siapa yang dijemput, dengan peranan, status dan pautan Telegram.', zh: '可登录和受邀的人员，含角色、状态和 Telegram 链接情况。', ta: 'உள்நுழையக்கூடியவர்களும் அழைக்கப்பட்டவர்களும்: பங்கு, நிலை, Telegram இணைப்புடன்.' })} maxH="max-h-[70vh] min-h-80" rows={shown} rowKey={r => (r.invite ? 'i' : 'u') + r.id} cols={cols} current={r => r.id === meId} />
          </div>
        ) : <EmptyState title={t({ en: 'No one matches these filters.', ms: 'Tiada yang sepadan dengan tapisan ini.', zh: '没有符合筛选条件的人员。', ta: 'இந்த வடிகட்டிகளுக்குப் பொருந்தியவர் யாரும் இல்லை.' })} action={{ label: t({ en: 'Clear all', ms: 'Kosongkan semua', zh: '全部清除', ta: 'அனைத்தையும் அழி' }), onClick: clear }} />}
        {soloHint && <div className="mt-4"><EmptyState title={t({ en: 'It is just you so far. Invite your first teammate.', ms: 'Setakat ini hanya anda. Jemput rakan sepasukan pertama anda.', zh: '目前只有你一个人。邀请你的第一位队友吧。', ta: 'இதுவரை நீங்கள் மட்டுமே. உங்கள் முதல் குழு உறுப்பினரை அழைக்கவும்.' })} hint={t({ en: 'They get their own sign-in, and staff never see cost or margin.', ms: 'Mereka mendapat log masuk sendiri, dan kakitangan tidak pernah melihat kos atau margin.', zh: '对方会有自己的登录账户，员工看不到成本或利润率。', ta: 'அவர்களுக்குத் தனி உள்நுழைவு கிடைக்கும்; ஊழியர்கள் செலவு அல்லது margin ஐப் பார்க்க மாட்டார்கள்.' })} action={{ label: t(S.invite), onClick: () => setDlg({ k: 'invite' }) }} /></div>}
      </Async>

      <FormDialog open={dlg?.k === 'invite'} title={t(S.invite)} onClose={() => close()}>
        {err}
        <InviteBody opts={opts} busy={a.busy} onCancel={() => close()}
          onEmail={(em, role) => run(async () => { await api('POST', '/invites', { email: em, role }); close() }, t({ en: `Invitation sent to ${em}`, ms: `Jemputan dihantar kepada ${em}`, zh: `邀请已发送给 ${em}`, ta: `${em} க்கு அழைப்பு அனுப்பப்பட்டது` }))}
          onPw={f => run(async () => { await api('POST', '/users', f); close() }, t({ en: `${f.name} can now sign in.`, ms: `${f.name} kini boleh log masuk.`, zh: `${f.name} 现在可以登录了。`, ta: `${f.name} இப்போது உள்நுழையலாம்.` }))} />
      </FormDialog>
      <FormDialog open={dlg?.k === 'role'} title={t({ en: 'Change role', ms: 'Tukar peranan', zh: '更改角色', ta: 'பங்கை மாற்று' })} onClose={() => close(dm?.id)}>
        {err}
        {dm?.m && <RoleBody m={dm.m} opts={opts} busy={a.busy} onCancel={() => close(dm.id)}
          onSave={role => edit(dm.m!, { role }, (r => t({ en: `${dm.name} now holds the ${r} role.`, ms: `${dm.name} kini memegang peranan ${r}.`, zh: `${dm.name} 现在的角色是${r}。`, ta: `${dm.name} இப்போது ${r} பங்கை வகிக்கிறார்.` }))(opts.find(o => o.key === role)?.name ?? role))} />}
      </FormDialog>
      <FormDialog open={dlg?.k === 'pw'} title={t({ en: 'Set a new password', ms: 'Tetapkan kata laluan baharu', zh: '设置新密码', ta: 'புதிய கடவுச்சொல்லை அமை' })} onClose={() => close(dm?.id)}>
        {err}
        {dm?.m && <PwBody m={dm.m} busy={a.busy} onCancel={() => close(dm.id)}
          onSave={password => edit(dm.m!, { password }, t({ en: `Password for ${dm.name} changed.`, ms: `Kata laluan ${dm.name} telah ditukar.`, zh: `${dm.name} 的密码已更改。`, ta: `${dm.name} இன் கடவுச்சொல் மாற்றப்பட்டது.` }))} />}
      </FormDialog>
      <ConfirmDialog open={dlg?.k === 'deact' || dlg?.k === 'revoke'} danger onCancel={() => close(dlg?.k === 'deact' ? dm?.id : undefined)}
        title={dlg?.k === 'revoke' ? t({ en: `Revoke the invitation for ${dm?.name ?? ''}?`, ms: `Batalkan jemputan untuk ${dm?.name ?? ''}?`, zh: `撤销发给 ${dm?.name ?? ''} 的邀请？`, ta: `${dm?.name ?? ''} க்கான அழைப்பை ரத்து செய்யவா?` }) : t({ en: `Deactivate ${dm?.name ?? ''}?`, ms: `Nyahaktifkan ${dm?.name ?? ''}?`, zh: `停用 ${dm?.name ?? ''}？`, ta: `${dm?.name ?? ''} ஐ செயலிழக்கச் செய்யவா?` })}
        body={dlg?.k === 'revoke' ? t({ en: 'The link in the email stops working.', ms: 'Pautan dalam e-mel tidak lagi berfungsi.', zh: '邮件中的链接将失效。', ta: 'மின்னஞ்சலில் உள்ள இணைப்பு செயல்படாது.' })
          : <>{t({ en: 'They cannot sign in, and their session ends at once. You can reactivate them later.', ms: 'Mereka tidak boleh log masuk dan sesi mereka tamat serta-merta. Anda boleh mengaktifkannya semula kemudian.', zh: '对方将无法登录，其登录状态会立即结束。你以后可以重新启用。', ta: 'அவர்களால் உள்நுழைய முடியாது; அவர்கள் அமர்வு உடனே முடிவடையும். பின்னர் மீண்டும் செயல்படுத்தலாம்.' })}{a.err && <span role="alert" className="mt-2 block text-warn">{a.err.text}</span>}</>}
        confirmLabel={dlg?.k === 'revoke' ? t({ en: 'Yes, revoke', ms: 'Ya, batalkan', zh: '是，撤销', ta: 'ஆம், ரத்து செய்' }) : t({ en: 'Deactivate', ms: 'Nyahaktifkan', zh: '停用', ta: 'செயலிழக்கச் செய்' })}
        onConfirm={() => dlg?.k === 'revoke' ? dm?.i && row(dm.i, () => api('DELETE', `/invites/${dm.id}`), t({ en: `Invitation for ${dm.name} revoked.`, ms: `Jemputan untuk ${dm.name} dibatalkan.`, zh: `发给 ${dm.name} 的邀请已撤销。`, ta: `${dm.name} க்கான அழைப்பு ரத்து செய்யப்பட்டது.` }))
          : dm?.m && edit(dm.m, { active: false }, t({ en: `${dm.name} deactivated.`, ms: `${dm.name} dinyahaktifkan.`, zh: `${dm.name} 已停用。`, ta: `${dm.name} செயலிழக்கப்பட்டார்.` }))} />
    </>
  )
}


const MIN_PASSWORD = 10 // server rule (docs/api-contract.md, POST /api/me/password); the common-password check is server-side only

// "Chrome on Windows" from a User-Agent string. No library: order matters (Edge and Opera also say Chrome).
export function deviceLabel(ua: string | null): string {
  const u = ua ?? ''
  const browser = /Edg(e|A|iOS)?\//.test(u) ? 'Edge' : /OPR\/|Opera/.test(u) ? 'Opera' : /Firefox\/|FxiOS/.test(u) ? 'Firefox'
    : /Chrome\/|CriOS/.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : ''
  const os = /Windows/.test(u) ? 'Windows' : /Android/.test(u) ? 'Android' : /iPhone|iPad|iPod/.test(u) ? 'iOS' : /Mac OS X|Macintosh/.test(u) ? 'macOS'
    : /CrOS/.test(u) ? 'ChromeOS' : /Linux/.test(u) ? 'Linux' : ''
  return browser && os ? t({ en: `${browser} on ${os}`, ms: `${browser} pada ${os}`, zh: `${os} 上的 ${browser}`, ta: `${os} இல் ${browser}` }) : browser || os || t({ en: 'Unknown device', ms: 'Peranti tidak dikenali', zh: '未知设备', ta: 'அறியப்படாத சாதனம்' })
}

export function relTime(iso: string | null): string {
  if (!iso) return t({ en: 'unknown', ms: 'tidak diketahui', zh: '未知', ta: 'தெரியவில்லை' })
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  for (const [unit, secs] of [['day', 86400], ['hour', 3600], ['minute', 60]] as const)
    if (Math.abs(s) >= secs) return rtf.format(Math.trunc(s / secs), unit)
  return t({ en: 'just now', ms: 'sebentar tadi', zh: '刚刚', ta: 'இப்போது' })
}

interface Session { id: string; created_at: string; last_seen_at: string | null; user_agent: string | null; current: boolean }

// Own devices. The current one is signed out with the header Sign out button, never by DELETE of its own row.
function Sessions() {
  useLang()
  const s = useFetch<Session[]>('/me/sessions')
  const [confirm, setConfirm] = useState('')
  const toast = useToast()
  const a = useAction()
  const last = useRef<() => Promise<void>>(undefined)
  const head = useRef<HTMLHeadingElement>(null)
  const go = (fn: () => Promise<void>) => { last.current = fn; a.run(fn) }
  const done = (text: string) => { setConfirm(''); toast(text); s.reload(); head.current?.focus() }
  const others = (s.data ?? []).filter(x => !x.current).length
  return (
    <section className="mt-8 max-w-xl border-t border-soft pt-6" aria-labelledby="dev">
      <h2 id="dev" ref={head} tabIndex={-1} className="text-base font-semibold">{t({ en: 'Devices and sessions', ms: 'Peranti dan sesi', zh: '设备和会话', ta: 'சாதனங்களும் அமர்வுகளும்' })}</h2>
      <p className="mb-3 text-sm text-muted">{t({ en: 'Places you are signed in. Sign out any you do not recognise.', ms: 'Tempat anda log masuk. Log keluar mana-mana yang anda tidak kenali.', zh: '你登录过的设备。请退出任何你不认识的设备。', ta: 'நீங்கள் உள்நுழைந்துள்ள இடங்கள். உங்களுக்குத் தெரியாதவற்றிலிருந்து வெளியேறவும்.' })}</p>
      <Async s={s} rows={2} empty={!s.data?.length} emptyText={t({ en: 'No active sessions.', ms: 'Tiada sesi aktif.', zh: '没有活动会话。', ta: 'செயலில் உள்ள அமர்வுகள் இல்லை.' })}>
        <ul className="grid gap-2">
          {s.data?.map(x => {
            const name = deviceLabel(x.user_agent)
            return (
              <li key={x.id} className="card">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 break-words font-semibold">{name}</span>
                  {x.current && <span className="badge">{t({ en: 'This device', ms: 'Peranti ini', zh: '此设备', ta: 'இந்த சாதனம்' })}</span>}
                </p>
                <p className="mt-1 text-sm text-muted">{t({ en: `Signed in ${relTime(x.created_at)}. Last active ${relTime(x.last_seen_at)}.`, ms: `Log masuk ${relTime(x.created_at)}. Aktif kali terakhir ${relTime(x.last_seen_at)}.`, zh: `登录于${relTime(x.created_at)}。最后活动：${relTime(x.last_seen_at)}。`, ta: `உள்நுழைந்தது: ${relTime(x.created_at)}. கடைசியாகச் செயல்பட்டது: ${relTime(x.last_seen_at)}.` })}</p>
                {!x.current && (confirm === x.id ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t({ en: `Confirm signing out ${name}`, ms: `Sahkan log keluar ${name}`, zh: `确认退出 ${name}`, ta: `${name} இலிருந்து வெளியேறுவதை உறுதிப்படுத்தவும்` })}>
                    <span className="text-sm font-semibold">{t({ en: `Sign out ${name}?`, ms: `Log keluar ${name}?`, zh: `退出 ${name}？`, ta: `${name} இலிருந்து வெளியேறவா?` })}</span>
                    <button type="button" className="btn btn-danger" autoFocus aria-disabled={a.busy || undefined}
                      onClick={() => go(async () => { await api('DELETE', `/me/sessions/${x.id}`); done(t({ en: `Signed out ${name}.`, ms: `${name} telah dilog keluar.`, zh: `已退出 ${name}。`, ta: `${name} இலிருந்து வெளியேறப்பட்டது.` })) })}>{t({ en: 'Yes, sign out', ms: 'Ya, log keluar', zh: '是，退出', ta: 'ஆம், வெளியேறு' })}<span className="sr-only"> {name}</span></button>
                    <button type="button" className="btn" onClick={() => { setConfirm(''); requestAnimationFrame(() => document.getElementById('so-' + x.id)?.focus()) }}>{t(S.cancel)}</button>
                  </div>
                ) : <div className="mt-3"><button id={'so-' + x.id} type="button" className="btn" onClick={() => setConfirm(x.id)}>{t({ en: 'Sign out', ms: 'Log keluar', zh: '退出登录', ta: 'வெளியேறு' })}<span className="sr-only"> {name}</span></button></div>)}
              </li>
            )
          })}
        </ul>
        {others > 0 && <div className="mt-3"><button type="button" className="btn" aria-disabled={a.busy || undefined}
          onClick={() => go(async () => { const r = await api<{ revoked: number }>('POST', '/me/sessions/revoke-others'); done(t({ en: `Signed out ${r.revoked} other ${r.revoked === 1 ? 'device' : 'devices'}.`, ms: `${r.revoked} peranti lain telah dilog keluar.`, zh: `已退出其他 ${r.revoked} 台设备。`, ta: `மற்ற ${r.revoked} சாதனங்களிலிருந்து வெளியேறப்பட்டது.` })) })}>{t({ en: 'Sign out all other devices', ms: 'Log keluar semua peranti lain', zh: '退出所有其他设备', ta: 'மற்ற எல்லா சாதனங்களிலிருந்தும் வெளியேறு' })}</button></div>}
      </Async>
      <ActionError err={a.err} onRetry={() => last.current && go(last.current)} label={t(S.again)} />
    </section>
  )
}

// Everyone: change own password, then see and end own sessions.
export function AccountView({ name, role, linked, onChange }: { name: string; role: string; linked?: boolean; onChange?: () => void }) {
  useLang()
  const [cur, setCur] = useState('')
  const [nw, setNw] = useState('')
  const [err, setErr] = useState('')
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const username = (getAccount() ?? '').toLowerCase()
  const longEnough = nw.length >= MIN_PASSWORD
  const notUsername = !!nw && nw.toLowerCase() !== username
  const save = async () => {
    if (busy) return
    setErr('')
    if (!longEnough) return setErr(t({ en: `The new password needs at least ${MIN_PASSWORD} characters.`, ms: `Kata laluan baharu mesti sekurang-kurangnya ${MIN_PASSWORD} aksara.`, zh: `新密码至少需要 ${MIN_PASSWORD} 个字符。`, ta: `புதிய கடவுச்சொல் குறைந்தது ${MIN_PASSWORD} எழுத்துகள் கொண்டிருக்க வேண்டும்.` }))
    if (!notUsername) return setErr(t({ en: 'The new password cannot be your username.', ms: 'Kata laluan baharu tidak boleh sama dengan nama pengguna anda.', zh: '新密码不能与你的用户名相同。', ta: 'புதிய கடவுச்சொல் உங்கள் பயனர்பெயராக இருக்கக்கூடாது.' }))
    setBusy(true)
    try { await api('POST', '/me/password', { current: cur, new: nw }); setCur(''); setNw(''); toast(t({ en: 'Password changed. Your other devices are signed out.', ms: 'Kata laluan ditukar. Peranti anda yang lain telah dilog keluar.', zh: '密码已更改。你的其他设备已退出登录。', ta: 'கடவுச்சொல் மாற்றப்பட்டது. உங்கள் மற்ற சாதனங்கள் வெளியேற்றப்பட்டன.' })) }
    catch (e) {
      setErr(e instanceof ApiError && e.status === 429 ? t({ en: 'Too many attempts, wait a few minutes and try again.', ms: 'Terlalu banyak percubaan, tunggu beberapa minit dan cuba lagi.', zh: '尝试次数过多，请等几分钟后再试。', ta: 'பல முறை முயற்சிக்கப்பட்டது, சில நிமிடங்கள் காத்திருந்து மீண்டும் முயற்சிக்கவும்.' })
        : e instanceof ApiError && e.code === 'weak_password' ? t({ en: `That password was not accepted: ${e.message}`, ms: `Kata laluan itu tidak diterima: ${e.message}`, zh: `该密码不被接受：${e.message}`, ta: `அந்தக் கடவுச்சொல் ஏற்கப்படவில்லை: ${e.message}` }) : msg(e))
    } finally { setBusy(false) }
  }
  const rule = (good: boolean, text: string) => <li className={good ? '' : 'text-muted'}>{good ? t({ en: 'Met: ', ms: 'Dipenuhi: ', zh: '已满足：', ta: 'பூர்த்தி: ' }) : t({ en: 'Not yet: ', ms: 'Belum: ', zh: '尚未满足：', ta: 'இன்னும் இல்லை: ' })}{text}</li>
  return (
    <>
      <PageHeader title={t({ en: 'Account', ms: 'Akaun', zh: '账户', ta: 'கணக்கு' })} description={t({ en: `Signed in as ${name} (${role}).`, ms: `Log masuk sebagai ${name} (${role}).`, zh: `已登录为 ${name}（${role}）。`, ta: `${name} (${role}) ஆக உள்நுழைந்துள்ளீர்கள்.` })} />
      <form className="grid max-w-sm gap-3" onSubmit={e => { e.preventDefault(); save() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Current password', ms: 'Kata laluan semasa', zh: '当前密码', ta: 'தற்போதைய கடவுச்சொல்' })}
          <input className="input font-normal" type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'New password', ms: 'Kata laluan baharu', zh: '新密码', ta: 'புதிய கடவுச்சொல்' })}
          <input className="input font-normal" type="password" autoComplete="new-password" aria-describedby="pw-rules" value={nw} onChange={e => setNw(e.target.value)} /></label>
        <ul id="pw-rules" className="text-sm">
          {rule(longEnough, t({ en: `at least ${MIN_PASSWORD} characters`, ms: `sekurang-kurangnya ${MIN_PASSWORD} aksara`, zh: `至少 ${MIN_PASSWORD} 个字符`, ta: `குறைந்தது ${MIN_PASSWORD} எழுத்துகள்` }))}
          {rule(notUsername, t({ en: 'different from your username', ms: 'berbeza daripada nama pengguna anda', zh: '与你的用户名不同', ta: 'உங்கள் பயனர்பெயரிலிருந்து வேறுபட்டது' }))}
          <li className="text-muted">{t({ en: 'The server also rejects very common passwords.', ms: 'Pelayan juga menolak kata laluan yang terlalu biasa.', zh: '服务器也会拒绝过于常见的密码。', ta: 'மிகவும் பொதுவான கடவுச்சொற்களை சேவையகம் நிராகரிக்கும்.' })}</li>
        </ul>
        {err && <p role="alert" className="text-sm text-warn">{err}</p>}
        <div><button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>{busy ? t({ en: 'Changing...', ms: 'Menukar...', zh: '更改中...', ta: 'மாற்றுகிறது...' }) : t({ en: 'Change password', ms: 'Tukar kata laluan', zh: '更改密码', ta: 'கடவுச்சொல்லை மாற்று' })}</button></div>
      </form>
      <section className="mt-8 max-w-xl border-t border-soft pt-6" aria-labelledby="tgme" data-tour="account-telegram">
        <h2 id="tgme" className="text-base font-semibold">Telegram</h2>
        <p className="mb-3 text-sm text-muted">{t({ en: 'Link your Telegram to send product photos and supplier price lists to LARIS from your phone.', ms: 'Pautkan Telegram anda untuk menghantar gambar produk dan senarai harga pembekal ke LARIS dari telefon anda.', zh: '链接你的 Telegram，即可用手机把产品照片和供应商价格表发送给 LARIS。', ta: 'உங்கள் தொலைபேசியிலிருந்து பொருள் புகைப்படங்களையும் சப்ளையர் விலைப் பட்டியல்களையும் LARIS க்கு அனுப்ப உங்கள் Telegram ஐ இணைக்கவும்.' })}</p>
        <div className="flex flex-wrap items-center gap-2">
          {linked !== undefined && <span>{t({ en: 'Status', ms: 'Status', zh: '状态', ta: 'நிலை' })}: <span className="font-semibold text-ink">{linked ? t(S.linked) : t(S.notLinked)}</span></span>}
          <TelegramLinkControls base="/me" who={t({ en: 'yourself', ms: 'diri anda', zh: '你自己', ta: 'நீங்களே' })} linked={linked} onChange={onChange} />
        </div>
      </section>
      {(MOCK || getAccount()) && <Sessions />}
    </>
  )
}

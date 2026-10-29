import { useRef, useState } from 'react'
import { api, ApiError, getAccount, MOCK } from './api'
import { ActionError, Async, PageHeader, msg, useAction, useFetch } from './ui'
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
} satisfies Record<string, Text>

interface Member { id: string; name: string; username: string | null; role: 'owner' | 'staff'; role_key?: string; role_name?: string; active: boolean; has_password: boolean; sessions: number; telegram_linked?: boolean }

interface Invite { id: string; email: string; role_key: string; role_name: string; status: 'pending' | 'accepted' | 'revoked' | 'expired'; invited_by_name?: string; created_at: string; expires_at: string }

// Owner: invite by email. The person sets their own name, username and password on #/invite. Accepted and revoked ones are not listed (the person shows above).
function Invites({ opts, onChange }: { opts: { key: string; name: string }[]; onChange: () => void }) {
  useLang()
  const s = useFetch<Invite[]>('/invites')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('staff')
  const [formErr, setFormErr] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busyId, setBusyId] = useState('')
  const [rowErr, setRowErr] = useState('')
  const a = useAction()
  const toast = useToast()
  const list = (s.data ?? []).filter(i => i.status === 'pending' || i.status === 'expired')
  const send = () => {
    const em = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) || em.length > 254) return setFormErr(t({ en: 'Enter a valid email address.', ms: 'Masukkan alamat e-mel yang sah.', zh: '请输入有效的电子邮件地址。', ta: 'சரியான மின்னஞ்சல் முகவரியை உள்ளிடவும்.' }))
    setFormErr('')
    a.run(async () => { await api('POST', '/invites', { email: em, role }); setEmail(''); toast(t({ en: `Invitation sent to ${em}`, ms: `Jemputan dihantar kepada ${em}`, zh: `邀请已发送给 ${em}`, ta: `${em} க்கு அழைப்பு அனுப்பப்பட்டது` })); s.reload(); onChange() })
  }
  const row = async (i: Invite, fn: () => Promise<unknown>, done: string) => {
    if (busyId) return
    setBusyId(i.id); setRowErr('')
    try { await fn(); toast(done); s.reload() } catch (e) { setRowErr(msg(e)); if (e instanceof ApiError && e.status === 409) s.reload() } finally { setBusyId(''); setConfirm('') }  // 409: it changed meanwhile, show the current list
  }
  return (
    <section className="mt-8 border-t border-soft pt-6" aria-labelledby="inv" data-tour="team-invite">
      <h2 id="inv" className="text-base font-semibold">{t({ en: 'Invite by email', ms: 'Jemput melalui e-mel', zh: '通过电子邮件邀请', ta: 'மின்னஞ்சல் மூலம் அழைக்கவும்' })}</h2>
      <p className="mb-2 text-sm text-muted">{t({ en: 'We email a link. The person chooses their own username and password, so you never see it.', ms: 'Kami e-melkan pautan. Orang itu memilih sendiri nama pengguna dan kata laluan, jadi anda tidak pernah melihatnya.', zh: '我们会发送一个链接到对方邮箱。对方自行设置用户名和密码，你不会看到。', ta: 'நாங்கள் இணைப்பை மின்னஞ்சல் செய்கிறோம். அவர் தனது பயனர்பெயரையும் கடவுச்சொல்லையும் தானே தேர்வு செய்வார், எனவே நீங்கள் அதைப் பார்க்க மாட்டீர்கள்.' })}</p>
      <form className="card grid max-w-xl gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" data-guide="tm-invite" noValidate onSubmit={e => { e.preventDefault(); send() }}>
        <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2" data-guide="tm-email">{t({ en: 'Email address', ms: 'Alamat e-mel', zh: '电子邮件地址', ta: 'மின்னஞ்சல் முகவரி' })}
          <input className="input font-normal" type="email" name="invite_email" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={254} value={email}
            aria-invalid={formErr ? true : undefined} aria-describedby={formErr ? 'inv-err' : undefined} onChange={e => { setEmail(e.target.value); setFormErr('') }} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.role)}
          <select className="input font-normal" value={role} onChange={e => setRole(e.target.value)}>{opts.map(o => <option key={o.key} value={o.key}>{o.name}</option>)}</select></label>
        <div><button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? t(S.sending) : t({ en: 'Send invitation', ms: 'Hantar jemputan', zh: '发送邀请', ta: 'அழைப்பை அனுப்பு' })}</button></div>
        {formErr && <p id="inv-err" role="alert" className="text-sm text-warn sm:col-span-2">{formErr}</p>}
      </form>
      <ActionError err={a.err} onRetry={send} label={t(S.again)} />
      <h3 className="mt-6 text-base font-semibold">{t({ en: 'Pending invitations', ms: 'Jemputan belum diterima', zh: '待处理的邀请', ta: 'நிலுவையில் உள்ள அழைப்புகள்' })}</h3>
      {rowErr && <p role="alert" className="mt-2 text-sm text-warn">{rowErr}</p>}
      <div className="mt-2" data-guide="tm-pending">
        <Async s={s} rows={2} empty={!list.length} emptyText={t({ en: 'No pending invitations.', ms: 'Tiada jemputan belum diterima.', zh: '没有待处理的邀请。', ta: 'நிலுவையில் உள்ள அழைப்புகள் இல்லை.' })} emptyHint={t({ en: 'Invite a colleague by email and they show up here until they accept.', ms: 'Jemput rakan sekerja melalui e-mel dan mereka akan dipaparkan di sini sehingga menerima.', zh: '通过电子邮件邀请同事，对方接受之前会显示在这里。', ta: 'சக ஊழியரை மின்னஞ்சல் மூலம் அழைக்கவும்; அவர் ஏற்கும் வரை இங்கே தோன்றுவார்.' })}>
          <ul className="grid gap-2">
            {list.map(i => (
              <li key={i.id} className="card">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 break-all font-semibold">{i.email}</span>
                  <span className="badge">{i.role_name}</span>
                  <span className={i.status === 'expired' ? 'badge badge-warn' : 'badge'}>{i.status === 'expired' ? t({ en: 'Expired', ms: 'Tamat tempoh', zh: '已过期', ta: 'காலாவதியானது' }) : t({ en: 'Pending', ms: 'Belum diterima', zh: '待处理', ta: 'நிலுவையில்' })}</span>
                </p>
                <p className="mt-1 text-sm text-muted">{t({ en: `Sent ${relTime(i.created_at)}.`, ms: `Dihantar ${relTime(i.created_at)}.`, zh: `发送于${relTime(i.created_at)}。`, ta: `அனுப்பியது: ${relTime(i.created_at)}.` })} {i.status === 'expired' ? t({ en: `Expired ${relTime(i.expires_at)}.`, ms: `Tamat tempoh ${relTime(i.expires_at)}.`, zh: `过期于${relTime(i.expires_at)}。`, ta: `காலாவதியானது: ${relTime(i.expires_at)}.` }) : t({ en: `Expires ${relTime(i.expires_at)}.`, ms: `Tamat tempoh ${relTime(i.expires_at)}.`, zh: `将于${relTime(i.expires_at)}过期。`, ta: `காலாவதியாகும்: ${relTime(i.expires_at)}.` })}</p>
                {confirm === i.id ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t({ en: `Confirm revoking the invitation for ${i.email}`, ms: `Sahkan pembatalan jemputan untuk ${i.email}`, zh: `确认撤销发给 ${i.email} 的邀请`, ta: `${i.email} க்கான அழைப்பை ரத்து செய்வதை உறுதிப்படுத்தவும்` })}>
                    <span className="text-sm font-semibold">{t({ en: `Revoke the invitation for ${i.email}?`, ms: `Batalkan jemputan untuk ${i.email}?`, zh: `撤销发给 ${i.email} 的邀请？`, ta: `${i.email} க்கான அழைப்பை ரத்து செய்யவா?` })}</span>
                    <button type="button" className="btn btn-danger" autoFocus aria-disabled={!!busyId || undefined} onClick={() => row(i, () => api('DELETE', `/invites/${i.id}`), t({ en: `Invitation for ${i.email} revoked.`, ms: `Jemputan untuk ${i.email} dibatalkan.`, zh: `发给 ${i.email} 的邀请已撤销。`, ta: `${i.email} க்கான அழைப்பு ரத்து செய்யப்பட்டது.` }))}>{t({ en: 'Yes, revoke', ms: 'Ya, batalkan', zh: '是，撤销', ta: 'ஆம், ரத்து செய்' })}<span className="sr-only"> {i.email}</span></button>
                    <button type="button" className="btn" onClick={() => { setConfirm(''); requestAnimationFrame(() => document.getElementById('rv-' + i.id)?.focus()) }}>{t(S.cancel)}</button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn" aria-disabled={!!busyId || undefined} onClick={() => row(i, () => api('POST', `/invites/${i.id}/resend`), t({ en: `Invitation sent again to ${i.email}.`, ms: `Jemputan dihantar semula kepada ${i.email}.`, zh: `已再次向 ${i.email} 发送邀请。`, ta: `${i.email} க்கு அழைப்பு மீண்டும் அனுப்பப்பட்டது.` }))}>{busyId === i.id ? t(S.sending) : t({ en: 'Resend', ms: 'Hantar semula', zh: '重新发送', ta: 'மீண்டும் அனுப்பு' })}<span className="sr-only"> {t({ en: `invitation to ${i.email}`, ms: `jemputan kepada ${i.email}`, zh: `发给 ${i.email} 的邀请`, ta: `${i.email} க்கான அழைப்பு` })}</span></button>
                    {i.status === 'pending' && <button id={'rv-' + i.id} type="button" className="btn" onClick={() => setConfirm(i.id)}>{t({ en: 'Revoke', ms: 'Batalkan', zh: '撤销', ta: 'ரத்து செய்' })}<span className="sr-only"> {t({ en: `invitation to ${i.email}`, ms: `jemputan kepada ${i.email}`, zh: `发给 ${i.email} 的邀请`, ta: `${i.email} க்கான அழைப்பு` })}</span></button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Async>
      </div>
    </section>
  )
}

// Owner: who can sign in. Passwords are never shown; a reset signs that person out everywhere.
export function TeamView({ owner, meId }: { owner: boolean; meId: string }) {
  useLang()
  const s = useFetch<Member[]>('/users')
  const roles = useFetch<{ roles: { key: string; name: string }[] }>('/roles')
  const opts = roles.data?.roles ?? [{ key: 'owner', name: t({ en: 'Owner', ms: 'Pemilik', zh: '店主', ta: 'உரிமையாளர்' }) }, { key: 'staff', name: t({ en: 'Staff (no cost or margin)', ms: 'Kakitangan (tanpa kos atau margin)', zh: '员工（看不到成本和利润率）', ta: 'ஊழியர் (செலவு, margin தெரியாது)' }) }]  // class options until /roles answers
  const [pick, setPick] = useState<Record<string, string>>({})
  const a = useAction()
  const last = useRef<() => void>(undefined)
  const [f, setF] = useState({ name: '', username: '', role: 'staff', password: '' })
  const [reset, setReset] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const toast = useToast()
  if (!owner) return <><PageHeader title={t({ en: 'Team', ms: 'Pasukan', zh: '团队', ta: 'குழு' })} /><p className="card text-muted">{t({ en: 'Owner only.', ms: 'Pemilik sahaja.', zh: '仅限店主。', ta: 'உரிமையாளருக்கு மட்டும்.' })}</p></>

  const run = (fn: () => Promise<unknown>, done: string) => {
    last.current = () => run(fn, done); setErr('')
    a.run(async () => { await fn(); toast(done); s.reload() })
  }
  const add = () => {
    if (!f.name.trim() || !f.username.trim()) return setErr(t({ en: 'Enter a name and a username.', ms: 'Masukkan nama dan nama pengguna.', zh: '请输入姓名和用户名。', ta: 'பெயரையும் பயனர்பெயரையும் உள்ளிடவும்.' }))
    if (f.password.length < 10) return setErr(t(S.pw10))
    run(async () => { await api('POST', '/users', { ...f, name: f.name.trim(), username: f.username.trim() }); setF({ name: '', username: '', role: 'staff', password: '' }) }, t({ en: `${f.name.trim()} can now sign in.`, ms: `${f.name.trim()} kini boleh log masuk.`, zh: `${f.name.trim()} 现在可以登录了。`, ta: `${f.name.trim()} இப்போது உள்நுழையலாம்.` }))
  }
  const edit = (m: Member, body: object, done: string) => run(() => api('POST', `/users/${m.id}`, body), done)

  return (
    <>
      <PageHeader title={t({ en: 'Team', ms: 'Pasukan', zh: '团队', ta: 'குழு' })} description={t({ en: 'People who can sign in. Staff cannot see cost or margin. Deactivating someone ends their session at once.', ms: 'Orang yang boleh log masuk. Kakitangan tidak dapat melihat kos atau margin. Menyahaktifkan seseorang menamatkan sesinya serta-merta.', zh: '可以登录的人员。员工看不到成本或利润率。停用某人会立即结束其登录状态。', ta: 'உள்நுழையக்கூடியவர்கள். ஊழியர்கள் செலவு அல்லது margin ஐப் பார்க்க முடியாது. ஒருவரை செயலிழக்கச் செய்தால் அவர் அமர்வு உடனே முடிவடையும்.' })} />
      {roles.error && <p role="alert" className="mb-2 text-sm text-warn">{t({ en: 'Could not load the role list, so only the standard roles are shown.', ms: 'Senarai peranan tidak dapat dimuatkan, jadi hanya peranan standard dipaparkan.', zh: '无法加载角色列表，因此只显示标准角色。', ta: 'பங்குகளின் பட்டியலை ஏற்ற முடியவில்லை, எனவே நிலையான பங்குகள் மட்டும் காட்டப்படுகின்றன.' })}</p>}
      {err && <p role="alert" className="mb-2 text-sm text-warn">{err}</p>}
      <ActionError err={a.err} onRetry={() => last.current?.()} label={t(S.again)} />
      <Async s={s} rows={3} empty={!s.data?.length} emptyText={t({ en: 'No users yet.', ms: 'Belum ada pengguna.', zh: '还没有用户。', ta: 'பயனர்கள் இன்னும் இல்லை.' })} emptyHint={t({ en: 'Add the first person below.', ms: 'Tambah orang pertama di bawah.', zh: '请在下方添加第一位成员。', ta: 'முதல் நபரை கீழே சேர்க்கவும்.' })} >
        <ul className="grid gap-2" data-guide="tm-list">
          {s.data?.map(m => (
            <li key={m.id} className="card">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{m.name}</span>
                <span className="badge">{m.role_name ?? m.role}</span>
                {!m.active && <span className="badge badge-warn">{t({ en: 'Deactivated', ms: 'Dinyahaktifkan', zh: '已停用', ta: 'செயலிழக்கப்பட்டது' })}</span>}
                {m.id === meId && <span className="badge">{t({ en: 'You', ms: 'Anda', zh: '你', ta: 'நீங்கள்' })}</span>}
              </p>
              <p className="mt-1 text-sm text-muted">
                {m.username ? <>{t({ en: 'Signs in as', ms: 'Log masuk sebagai', zh: '登录名：', ta: 'உள்நுழைவு பெயர்:' })} <span className="font-semibold text-ink">{m.username}</span></> : t({ en: 'No sign-in account yet', ms: 'Belum ada akaun log masuk', zh: '还没有登录账户', ta: 'உள்நுழைவு கணக்கு இன்னும் இல்லை' })}
                {m.sessions > 0 && ` · ${t({ en: `${m.sessions} active ${m.sessions === 1 ? 'session' : 'sessions'}`, ms: `${m.sessions} sesi aktif`, zh: `${m.sessions} 个活动会话`, ta: `${m.sessions} செயலில் உள்ள அமர்வுகள்` })}`}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                <span>Telegram: <span className="font-semibold text-ink">{m.telegram_linked ? t(S.linked) : t(S.notLinked)}</span></span>
                <TelegramLinkControls base={`/users/${m.id}`} who={m.name} linked={!!m.telegram_linked} onChange={s.reload} />
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: `New password for ${m.name}`, ms: `Kata laluan baharu untuk ${m.name}`, zh: `${m.name} 的新密码`, ta: `${m.name} க்கான புதிய கடவுச்சொல்` })}
                  <input className="input font-normal" type="password" autoComplete="new-password" value={reset[m.id] ?? ''}
                    onChange={e => setReset({ ...reset, [m.id]: e.target.value })} />
                </label>
                <button type="button" className="btn" onClick={() => {
                  const p = reset[m.id] ?? ''
                  if (p.length < 10) return setErr(t(S.pw10))
                  edit(m, { password: p }, t({ en: `Password for ${m.name} changed.`, ms: `Kata laluan ${m.name} telah ditukar.`, zh: `${m.name} 的密码已更改。`, ta: `${m.name} இன் கடவுச்சொல் மாற்றப்பட்டது.` })); setReset({ ...reset, [m.id]: '' })
                }}>{t({ en: `Set password for ${m.name}`, ms: `Tetapkan kata laluan untuk ${m.name}`, zh: `设置 ${m.name} 的密码`, ta: `${m.name} க்கு கடவுச்சொல் அமை` })}</button>
                {(() => {
                  const cur = m.role_key ?? m.role, sel = pick[m.id] ?? cur, changed = sel !== cur
                  return <>
                    <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: `Role for ${m.name}`, ms: `Peranan untuk ${m.name}`, zh: `${m.name} 的角色`, ta: `${m.name} க்கான பங்கு` })}
                      <select className="input font-normal" value={sel} aria-describedby={changed ? `rw-${m.id}` : undefined} onChange={e => setPick({ ...pick, [m.id]: e.target.value })}>
                        {opts.map(o => <option key={o.key} value={o.key}>{o.name}</option>)}</select></label>
                    <button type="button" className="btn" aria-disabled={!changed || undefined} onClick={() => {
                      if (changed) edit(m, { role: sel }, (r => t({ en: `${m.name} now holds the ${r} role.`, ms: `${m.name} kini memegang peranan ${r}.`, zh: `${m.name} 现在的角色是${r}。`, ta: `${m.name} இப்போது ${r} பங்கை வகிக்கிறார்.` }))(opts.find(o => o.key === sel)?.name ?? sel))
                    }}>{t({ en: `Change role for ${m.name}`, ms: `Tukar peranan untuk ${m.name}`, zh: `更改 ${m.name} 的角色`, ta: `${m.name} இன் பங்கை மாற்று` })}</button>
                    {changed && <p id={`rw-${m.id}`} className="basis-full text-sm font-semibold text-warn">{t({ en: 'They will be signed out on every device when you save a new role.', ms: 'Mereka akan dilog keluar pada setiap peranti apabila anda menyimpan peranan baharu.', zh: '保存新角色后，对方会在所有设备上被退出登录。', ta: 'புதிய பங்கைச் சேமிக்கும்போது அவர்கள் எல்லா சாதனங்களிலும் வெளியேற்றப்படுவார்கள்.' })}</p>}
                  </>
                })()}
                <button type="button" className={m.active ? 'btn btn-danger' : 'btn'} onClick={() => edit(m, { active: !m.active }, m.active ? t({ en: `${m.name} deactivated.`, ms: `${m.name} dinyahaktifkan.`, zh: `${m.name} 已停用。`, ta: `${m.name} செயலிழக்கப்பட்டார்.` }) : t({ en: `${m.name} reactivated.`, ms: `${m.name} diaktifkan semula.`, zh: `${m.name} 已重新启用。`, ta: `${m.name} மீண்டும் செயல்படுத்தப்பட்டார்.` }))}>
                  {m.active ? t({ en: `Deactivate ${m.name}`, ms: `Nyahaktifkan ${m.name}`, zh: `停用 ${m.name}`, ta: `${m.name} ஐ செயலிழக்கச் செய்` }) : t({ en: `Reactivate ${m.name}`, ms: `Aktifkan semula ${m.name}`, zh: `重新启用 ${m.name}`, ta: `${m.name} ஐ மீண்டும் செயல்படுத்து` })}</button>
              </div>
            </li>
          ))}
        </ul>
      </Async>
      <Invites opts={opts} onChange={s.reload} />
      <section className="mt-8 border-t border-soft pt-6" aria-labelledby="newu" data-guide="tm-password">
        <h2 id="newu" className="text-base font-semibold">{t(S.addPw)}</h2>
        <p className="text-sm text-muted">{t({ en: 'For people without an email address. You set the first password and tell them in person.', ms: 'Untuk orang tanpa alamat e-mel. Anda menetapkan kata laluan pertama dan memberitahu mereka secara peribadi.', zh: '适用于没有电子邮件地址的人。由你设置初始密码并当面告知对方。', ta: 'மின்னஞ்சல் முகவரி இல்லாதவர்களுக்கு. நீங்கள் முதல் கடவுச்சொல்லை அமைத்து நேரில் தெரிவிக்கவும்.' })}</p>
        <form className="mt-2 grid max-w-xl gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); add() }}>
          <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Name', ms: 'Nama', zh: '姓名', ta: 'பெயர்' })}
            <input className="input font-normal" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'Username (letters, numbers, . _ -)', ms: 'Nama pengguna (huruf, nombor, . _ -)', zh: '用户名（字母、数字、. _ -）', ta: 'பயனர்பெயர் (எழுத்துகள், எண்கள், . _ -)' })}
            <input className="input font-normal" autoCapitalize="none" value={f.username} onChange={e => setF({ ...f, username: e.target.value })} /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.role)}
            <select className="input font-normal" value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>
              {opts.map(o => <option key={o.key} value={o.key}>{o.name}</option>)}</select></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">{t({ en: 'First password (10+ characters)', ms: 'Kata laluan pertama (10+ aksara)', zh: '初始密码（至少 10 个字符）', ta: 'முதல் கடவுச்சொல் (10+ எழுத்துகள்)' })}
            <input className="input font-normal" type="password" autoComplete="new-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></label>
          <div className="sm:col-span-2"><button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? t(S.working) : t(S.addPw)}</button></div>
        </form>
      </section>
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

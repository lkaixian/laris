import { useRef, useState } from 'react'
import { api, ApiError, permDesc, permGroup, permLabel } from './api'
import { useWriteGate } from './Licence'
import { ActionError, Async, PageHeader, focusTop, useAction, useFetch } from './ui'
import { useToast } from './Toast'
import { t, useLang } from './i18n'
import type { Text } from './i18n'

interface RoleRow { id: string; key: string; name: string; class: 'owner' | 'staff'; is_system: boolean; permissions: string[]; users: number }
interface Perm { key: string; label: string; description: string; group: string; default: boolean }
interface Roles { roles: RoleRow[]; catalog: Perm[]; non_assignable: { key: string; label: string }[] }

const CODES: Record<string, Text> = {
  name_taken: { en: 'Another role already has that name. Choose a different name.', ms: 'Peranan lain sudah menggunakan nama itu. Pilih nama lain.', zh: '已有其他角色使用该名称，请换一个名称。', ta: 'வேறொரு பங்கு ஏற்கெனவே அந்தப் பெயரைக் கொண்டுள்ளது. வேறு பெயரைத் தேர்வு செய்யவும்.' },
  not_assignable: { en: 'One of those permissions is always owner-only and cannot be given to a role.', ms: 'Salah satu kebenaran itu sentiasa untuk pemilik sahaja dan tidak boleh diberikan kepada peranan.', zh: '其中一项权限始终仅限店主，不能授予角色。', ta: 'அந்த அனுமதிகளில் ஒன்று எப்போதும் உரிமையாளருக்கு மட்டுமே; அதை ஒரு பங்குக்கு வழங்க முடியாது.' },
  unknown_permission: { en: 'One of those permissions is not recognised. Reload the page and try again.', ms: 'Salah satu kebenaran itu tidak dikenali. Muat semula halaman dan cuba lagi.', zh: '其中一项权限无法识别。请刷新页面后重试。', ta: 'அந்த அனுமதிகளில் ஒன்று அடையாளம் காணப்படவில்லை. பக்கத்தை மீண்டும் ஏற்றி முயற்சிக்கவும்.' },
  role_in_use: { en: 'People still hold this role. Move them to another role on the Team page first.', ms: 'Masih ada orang yang memegang peranan ini. Pindahkan mereka ke peranan lain di halaman Pasukan dahulu.', zh: '仍有成员拥有此角色。请先在“团队”页面把他们改为其他角色。', ta: 'இந்தப் பங்கை இன்னும் சிலர் வகிக்கிறார்கள். முதலில் குழு பக்கத்தில் அவர்களை வேறு பங்குக்கு மாற்றவும்.' },
  system_role: { en: 'The Owner and Staff roles cannot be renamed or deleted.', ms: 'Peranan Pemilik dan Kakitangan tidak boleh dinamakan semula atau dipadam.', zh: '“店主”和“员工”角色不能重命名或删除。', ta: 'உரிமையாளர், ஊழியர் பங்குகளின் பெயரை மாற்றவோ நீக்கவோ முடியாது.' },
}
// Friendly text for the codes the roles endpoints answer; the status code and code stay on the error.
const friendly = (e: unknown) => (e instanceof ApiError && CODES[e.code] ? new ApiError(e.status, e.code, t(CODES[e.code])) : e)

function Editor({ role, data, onDone }: { role: RoleRow | null; data: Roles; onDone: (note: string) => void }) {
  useLang()
  const [name, setName] = useState(role?.name ?? '')
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? [])
  const [formErr, setFormErr] = useState('')
  const a = useAction()
  const readOnly = role?.class === 'owner'   // the Owner role always holds everything
  const groups = [...new Set(data.catalog.map(p => p.group))]
  const staff = data.roles.find(r => r.key === 'staff')
  const toggle = (k: string) => setPerms(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k]))
  const save = () => {
    if (!role?.is_system && !name.trim()) return setFormErr(t({ en: 'Enter a name for the role.', ms: 'Masukkan nama untuk peranan.', zh: '请输入角色名称。', ta: 'பங்குக்கு ஒரு பெயரை உள்ளிடவும்.' }))
    setFormErr('')
    a.run(async () => {
      try {
        if (role) await api('PATCH', `/roles/${role.id}`, role.is_system ? { permissions: perms } : { name: name.trim(), permissions: perms })
        else await api('POST', '/roles', { name: name.trim(), permissions: perms })
      } catch (e) { throw friendly(e) }
      onDone(role ? t({ en: `Role ${role.name} saved. Changes apply to everyone with this role straight away.`, ms: `Peranan ${role.name} disimpan. Perubahan terpakai serta-merta kepada semua yang memegang peranan ini.`, zh: `角色 ${role.name} 已保存。更改会立即对拥有此角色的所有人生效。`, ta: `${role.name} பங்கு சேமிக்கப்பட்டது. இந்தப் பங்கை வகிக்கும் அனைவருக்கும் மாற்றங்கள் உடனே பொருந்தும்.` }) : t({ en: `Role ${name.trim()} created.`, ms: `Peranan ${name.trim()} dicipta.`, zh: `角色 ${name.trim()} 已创建。`, ta: `${name.trim()} பங்கு உருவாக்கப்பட்டது.` }))
    })
  }
  return (
    <form className="card mt-2 grid gap-3 border-l-4 border-l-accent" data-guide="rl-editor" aria-label={role ? t({ en: `Edit role ${role.name}`, ms: `Edit peranan ${role.name}`, zh: `编辑角色 ${role.name}`, ta: `${role.name} பங்கைத் திருத்து` }) : t({ en: 'New role', ms: 'Peranan baharu', zh: '新角色', ta: 'புதிய பங்கு' })} onSubmit={e => { e.preventDefault(); save() }}>
      <label className="flex max-w-sm flex-col gap-1 text-sm font-semibold">{t({ en: 'Role name', ms: 'Nama peranan', zh: '角色名称', ta: 'பங்கின் பெயர்' })}
        <input className="input font-normal" value={name} disabled={!!role?.is_system} maxLength={60} autoFocus={!role} onChange={e => setName(e.target.value)} /></label>
      {role?.is_system && <p className="text-sm text-muted">{readOnly ? t({ en: 'The Owner role is read only: it always holds every permission.', ms: 'Peranan Pemilik adalah baca sahaja: ia sentiasa memegang semua kebenaran.', zh: '“店主”角色为只读：它始终拥有所有权限。', ta: 'உரிமையாளர் பங்கு படிக்க மட்டும்: அது எப்போதும் எல்லா அனுமதிகளையும் கொண்டிருக்கும்.' }) : t({ en: 'The Staff role cannot be renamed, but its permissions can change.', ms: 'Peranan Kakitangan tidak boleh dinamakan semula, tetapi kebenarannya boleh diubah.', zh: '“员工”角色不能重命名，但可以更改其权限。', ta: 'ஊழியர் பங்கின் பெயரை மாற்ற முடியாது, ஆனால் அதன் அனுமதிகளை மாற்றலாம்.' })}</p>}
      {!role && staff && <div><button type="button" className="btn" onClick={() => setPerms(staff.permissions)}>{t({ en: 'Copy from Staff', ms: 'Salin daripada Kakitangan', zh: '从“员工”复制', ta: 'ஊழியர் பங்கிலிருந்து நகலெடு' })}</button></div>}
      {groups.map(g => (
        <fieldset key={g} className="rounded-ui border border-soft p-3">
          <legend className="px-1 text-sm font-semibold">{permGroup(g)}</legend>
          <ul className="grid gap-1">
            {data.catalog.filter(p => p.group === g).map(p => (
              <li key={p.key}>
                <label className="flex min-h-11 items-start gap-2 py-1 text-sm">
                  <input type="checkbox" className="mt-1" disabled={readOnly} checked={readOnly || perms.includes(p.key)} aria-describedby={`pd-${p.key}`} onChange={() => toggle(p.key)} />
                  <span><span className="font-semibold">{permLabel(p.key, p.label)}</span><span id={`pd-${p.key}`} className="block text-muted">{permDesc(p.key, p.description)}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}
      {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
      <ActionError err={a.err} onRetry={save} label={t({ en: 'Try saving again', ms: 'Cuba simpan lagi', zh: '重新保存', ta: 'மீண்டும் சேமிக்க முயற்சிக்கவும்' })} />
      <div className="flex flex-wrap gap-2">
        {!readOnly && <button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? t({ en: 'Saving...', ms: 'Menyimpan...', zh: '保存中...', ta: 'சேமிக்கிறது...' }) : role ? t({ en: 'Save role', ms: 'Simpan peranan', zh: '保存角色', ta: 'பங்கைச் சேமி' }) : t({ en: 'Create role', ms: 'Cipta peranan', zh: '创建角色', ta: 'பங்கை உருவாக்கு' })}</button>}
        <button type="button" className="btn" onClick={() => onDone('')}>{readOnly ? t({ en: 'Close', ms: 'Tutup', zh: '关闭', ta: 'மூடு' }) : t(CANCEL)}</button>
      </div>
    </form>
  )
}

const ROLES: Text = { en: 'Roles', ms: 'Peranan', zh: '角色', ta: 'பங்குகள்' }
const CANCEL: Text = { en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து செய்' }

// Owner: who can do what. The role a person holds is chosen on the Team page.
export function RolesView({ owner }: { owner: boolean }) {
  useLang()
  const gate = useWriteGate()
  const s = useFetch<Roles>('/roles')
  const [editing, setEditing] = useState<string>()   // role id, or 'new'
  const [confirm, setConfirm] = useState('')
  const toast = useToast()
  const del = useAction()
  const last = useRef<() => void>(undefined)
  if (!owner) return <><PageHeader title={t(ROLES)} /><p className="card text-muted">{t({ en: 'You do not have access. Only the owner manages roles.', ms: 'Anda tiada akses. Hanya pemilik mengurus peranan.', zh: '你没有访问权限。只有店主可以管理角色。', ta: 'உங்களுக்கு அணுகல் இல்லை. உரிமையாளர் மட்டுமே பங்குகளை நிர்வகிக்கிறார்.' })}</p></>
  const done = (text: string) => { setEditing(undefined); setConfirm(''); if (text) toast(text); s.reload(); focusTop() }
  const remove = (r: RoleRow) => {
    last.current = () => remove(r)
    del.run(async () => { try { await api('DELETE', `/roles/${r.id}`) } catch (e) { throw friendly(e) }; done(t({ en: `Role ${r.name} deleted.`, ms: `Peranan ${r.name} dipadam.`, zh: `角色 ${r.name} 已删除。`, ta: `${r.name} பங்கு நீக்கப்பட்டது.` })) })
  }
  const d = s.data
  return (
    <>
      <PageHeader title={t(ROLES)} description={t({ en: 'A role is a set of permissions. Everyone holds one role, chosen on the Team page. Changing what a role can do applies at once.', ms: 'Peranan ialah satu set kebenaran. Setiap orang memegang satu peranan, dipilih di halaman Pasukan. Perubahan pada apa yang boleh dilakukan oleh sesuatu peranan terpakai serta-merta.', zh: '角色是一组权限。每个人拥有一个角色，在“团队”页面选择。更改角色的权限会立即生效。', ta: 'பங்கு என்பது அனுமதிகளின் தொகுப்பு. ஒவ்வொருவரும் ஒரு பங்கை வகிக்கிறார்கள்; அது குழு பக்கத்தில் தேர்வு செய்யப்படும். ஒரு பங்கின் அனுமதிகளை மாற்றினால் உடனே பொருந்தும்.' })}
        actions={editing !== 'new' && <button type="button" className="btn btn-primary" data-guide="rl-new" {...gate(() => { setEditing('new'); setConfirm('') })}>{t({ en: 'New role', ms: 'Peranan baharu', zh: '新角色', ta: 'புதிய பங்கு' })}</button>} />
      <ActionError err={del.err} onRetry={() => last.current?.()} label={t({ en: 'Try again', ms: 'Cuba lagi', zh: '重试', ta: 'மீண்டும் முயற்சிக்கவும்' })} />
      <Async s={s} rows={3} empty={!d} emptyText={t({ en: 'No roles.', ms: 'Tiada peranan.', zh: '没有角色。', ta: 'பங்குகள் இல்லை.' })}>
        {d && <>
          <ul className="grid gap-2" data-guide="rl-list">
            {d.roles.map(r => (
              <li key={r.id} className="card">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.name}</span>
                  {r.is_system && <span className="badge">{r.class === 'owner' ? t({ en: 'Built in, read only', ms: 'Terbina dalam, baca sahaja', zh: '内置，只读', ta: 'உள்ளமைந்தது, படிக்க மட்டும்' }) : t({ en: 'Built in', ms: 'Terbina dalam', zh: '内置', ta: 'உள்ளமைந்தது' })}</span>}
                  <span className="text-sm text-muted">{t({ en: `${r.users} ${r.users === 1 ? 'person' : 'people'} · ${r.permissions.length} of ${d.catalog.length} permissions`, ms: `${r.users} orang · ${r.permissions.length} daripada ${d.catalog.length} kebenaran`, zh: `${r.users} 人 · ${r.permissions.length}/${d.catalog.length} 项权限`, ta: `${r.users} பேர் · ${d.catalog.length} அனுமதிகளில் ${r.permissions.length}` })}</span>
                </p>
                {editing === r.id ? <Editor role={r} data={d} onDone={done} /> : (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" className="btn" onClick={() => { setEditing(r.id); setConfirm('') }}>{r.class === 'owner' ? t({ en: `View ${r.name}`, ms: `Lihat ${r.name}`, zh: `查看 ${r.name}`, ta: `${r.name} ஐப் பார்` }) : t({ en: `Edit ${r.name}`, ms: `Edit ${r.name}`, zh: `编辑 ${r.name}`, ta: `${r.name} ஐத் திருத்து` })}</button>
                    {!r.is_system && (confirm === r.id ? (
                      <span className="flex flex-wrap items-center gap-2" role="group" aria-label={t({ en: `Confirm deleting ${r.name}`, ms: `Sahkan pemadaman ${r.name}`, zh: `确认删除 ${r.name}`, ta: `${r.name} ஐ நீக்குவதை உறுதிப்படுத்தவும்` })}>
                        <span className="text-sm font-semibold">{r.users > 0 ? t({ en: `${r.users} still hold it, so the server will refuse. Delete ${r.name}?`, ms: `${r.users} masih memegangnya, jadi pelayan akan menolak. Padam ${r.name}?`, zh: `仍有 ${r.users} 人拥有此角色，服务器会拒绝。删除 ${r.name}？`, ta: `${r.users} பேர் இன்னும் வகிக்கிறார்கள், எனவே சேவையகம் மறுக்கும். ${r.name} ஐ நீக்கவா?` }) : t({ en: `Delete ${r.name}?`, ms: `Padam ${r.name}?`, zh: `删除 ${r.name}？`, ta: `${r.name} ஐ நீக்கவா?` })}</span>
                        <button type="button" className="btn btn-danger" autoFocus aria-disabled={del.busy || undefined} onClick={() => remove(r)}>{t({ en: 'Yes, delete', ms: 'Ya, padam', zh: '是，删除', ta: 'ஆம், நீக்கு' })}<span className="sr-only"> {r.name}</span></button>
                        <button type="button" className="btn" onClick={() => setConfirm('')}>{t(CANCEL)}</button>
                      </span>
                    ) : <button type="button" className="btn btn-danger" onClick={() => { setConfirm(r.id); setEditing(undefined) }}>{t({ en: `Delete ${r.name}`, ms: `Padam ${r.name}`, zh: `删除 ${r.name}`, ta: `${r.name} ஐ நீக்கு` })}</button>)}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {editing === 'new' && <div className="mt-4"><Editor role={null} data={d} onDone={done} /></div>}
          <section className="mt-8 border-t border-soft pt-6" aria-labelledby="oo" data-guide="rl-owner">
            <h2 id="oo" className="text-base font-semibold">{t({ en: 'Always owner-only', ms: 'Sentiasa untuk pemilik sahaja', zh: '始终仅限店主', ta: 'எப்போதும் உரிமையாளருக்கு மட்டும்' })}</h2>
            <p className="mb-2 text-sm text-muted">{t({ en: 'These cannot be given to any role. Only people who hold the Owner role can do them.', ms: 'Ini tidak boleh diberikan kepada mana-mana peranan. Hanya orang yang memegang peranan Pemilik boleh melakukannya.', zh: '这些权限不能授予任何角色。只有拥有“店主”角色的人才能执行。', ta: 'இவற்றை எந்தப் பங்குக்கும் வழங்க முடியாது. உரிமையாளர் பங்கை வகிப்பவர்கள் மட்டுமே இவற்றைச் செய்ய முடியும்.' })}</p>
            <ul className="list-disc pl-5 text-sm">{d.non_assignable.map(p => <li key={p.key}>{permLabel(p.key, p.label)}</li>)}</ul>
          </section>
        </>}
      </Async>
    </>
  )
}

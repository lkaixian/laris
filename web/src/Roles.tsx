import { useEffect, useRef, useState } from 'react'
import { api, ApiError, permDesc, permGroup, permLabel } from './api'
import { useWriteGate } from './Licence'
import { ActionError, Async, PageHeader, focusTop, useAction, useFetch } from './ui'
import { useToast } from './Toast'
import { Icon } from './icons'
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

const ROLES: Text = { en: 'Roles', ms: 'Peranan', zh: '角色', ta: 'பங்குகள்' }
const CANCEL: Text = { en: 'Cancel', ms: 'Batal', zh: '取消', ta: 'ரத்து செய்' }
const S = {
  allow: { en: 'Allow all', ms: 'Benarkan semua', zh: '全部允许', ta: 'அனைத்தையும் அனுமதி' },
  clear: { en: 'Clear all', ms: 'Kosongkan semua', zh: '全部清除', ta: 'அனைத்தையும் அழி' },
  ownerOnly: { en: 'Only owners can do these', ms: 'Hanya pemilik boleh melakukan ini', zh: '只有店主可以执行这些操作', ta: 'உரிமையாளர்கள் மட்டுமே இவற்றைச் செய்யலாம்' },
  ownerOnlyHint: { en: 'These cannot be given to any role. Only people who hold the Owner role can do them.', ms: 'Ini tidak boleh diberikan kepada mana-mana peranan. Hanya orang yang memegang peranan Pemilik boleh melakukannya.', zh: '这些权限不能授予任何角色。只有拥有“店主”角色的人才能执行。', ta: 'இவற்றை எந்தப் பங்குக்கும் வழங்க முடியாது. உரிமையாளர் பங்கை வகிப்பவர்கள் மட்டுமே இவற்றைச் செய்ய முடியும்.' },
  changed: { en: 'Changed', ms: 'Diubah', zh: '已更改', ta: 'மாற்றப்பட்டது' },
  roleList: { en: 'Roles', ms: 'Peranan', zh: '角色', ta: 'பங்குகள்' },
  danger: { en: 'Delete this role', ms: 'Padam peranan ini', zh: '删除此角色', ta: 'இந்தப் பங்கை நீக்கு' },
  dangerHint: { en: 'This cannot be undone. A role people still hold cannot be deleted.', ms: 'Ini tidak boleh dibatalkan. Peranan yang masih dipegang tidak boleh dipadam.', zh: '此操作无法撤销。仍有人持有的角色不能删除。', ta: 'இதைத் திரும்பப் பெற முடியாது. இன்னும் பயன்படும் பங்கை நீக்க முடியாது.' },
  newRole: { en: 'New role', ms: 'Peranan baharu', zh: '新角色', ta: 'புதிய பங்கு' },
} satisfies Record<string, Text>
const ofN = (a: number, b: number) => t({ en: `${a} of ${b} allowed`, ms: `${a} daripada ${b} dibenarkan`, zh: `允许 ${a}/${b} 项`, ta: `${b} இல் ${a} அனுமதிக்கப்பட்டது` })
const people = (n: number) => t({ en: `${n} ${n === 1 ? 'person' : 'people'}`, ms: `${n} orang`, zh: `${n} 人`, ta: `${n} பேர்` })

function Switch({ label, desc, id, on, changed, disabled, onChange }: { label: string; desc: string; id: string; on: boolean; changed?: boolean; disabled?: boolean; onChange?: () => void }) {
  useLang()
  return (
    <label className={`relative flex min-h-11 items-center justify-between gap-4 border-l-2 py-2 pl-3 text-sm ${changed ? 'border-l-accent' : 'border-l-transparent'} ${disabled ? 'opacity-70' : 'cursor-pointer hover:bg-tint'}`}>
      <input type="checkbox" role="switch" className="peer sr-only" disabled={disabled} checked={on} aria-describedby={id} onChange={onChange} />
      <span className="min-w-0"><span className="font-semibold">{label}</span>{changed && <span className="sr-only"> ({t(S.changed)})</span>}<span id={id} className="block text-muted">{desc}</span></span>
      <span aria-hidden="true" className="relative mr-3 h-6 w-11 shrink-0 rounded-full border border-line bg-surface-2 transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-muted after:transition-transform peer-checked:border-accent peer-checked:bg-accent peer-checked:after:translate-x-5 peer-checked:after:bg-on-accent peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
    </label>
  )
}

interface DelProps { confirm: string; setConfirm: (id: string) => void; remove: (r: RoleRow) => void; busy: boolean }

function Editor({ role, data, onDone, focus, del }: { role: RoleRow | null; data: Roles; onDone: (note: string, stay?: boolean) => void; focus: boolean; del: DelProps }) {
  useLang()
  const [base, setBase] = useState({ name: role?.name ?? '', perms: role?.permissions ?? [] })
  const [name, setName] = useState(base.name)
  const [perms, setPerms] = useState<string[]>(base.perms)
  const [formErr, setFormErr] = useState('')
  const a = useAction()
  const nameRef = useRef<HTMLInputElement>(null)
  const headRef = useRef<HTMLHeadingElement>(null)
  const readOnly = role?.class === 'owner'   // the Owner role always holds everything
  const groups = [...new Set(data.catalog.map(p => p.group))]
  const staff = data.roles.find(r => r.key === 'staff')
  const toggle = (k: string) => setPerms(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k]))
  const setGroup = (g: string, on: boolean) => setPerms(p => { const ks = data.catalog.filter(x => x.group === g).map(x => x.key); return on ? [...new Set([...p, ...ks])] : p.filter(k => !ks.includes(k)) })
  const same = (k: string) => base.perms.includes(k) === perms.includes(k)
  const changes = data.catalog.filter(p => !same(p.key)).length + (!role?.is_system && name.trim() !== base.name ? 1 : 0)
  const dirty = changes > 0
  const count = readOnly ? data.catalog.length : data.catalog.filter(p => perms.includes(p.key)).length
  useEffect(() => { if (focus) (nameRef.current && !nameRef.current.disabled ? nameRef.current : headRef.current)?.focus() }, [focus])
  const cancel = () => { if (role && dirty) { setName(base.name); setPerms(base.perms); setFormErr('') } else onDone('', false) }
  const save = () => {
    if (!role?.is_system && !name.trim()) return setFormErr(t({ en: 'Enter a name for the role.', ms: 'Masukkan nama untuk peranan.', zh: '请输入角色名称。', ta: 'பங்குக்கு ஒரு பெயரை உள்ளிடவும்.' }))
    setFormErr('')
    a.run(async () => {
      try {
        if (role) await api('PATCH', `/roles/${role.id}`, role.is_system ? { permissions: perms } : { name: name.trim(), permissions: perms })
        else await api('POST', '/roles', { name: name.trim(), permissions: perms })
      } catch (e) { throw friendly(e) }
      if (role) setBase({ name: role.is_system ? role.name : name.trim(), perms })
      onDone(role ? t({ en: `Role ${role.name} saved. Changes apply to everyone with this role straight away.`, ms: `Peranan ${role.name} disimpan. Perubahan terpakai serta-merta kepada semua yang memegang peranan ini.`, zh: `角色 ${role.name} 已保存。更改会立即对拥有此角色的所有人生效。`, ta: `${role.name} பங்கு சேமிக்கப்பட்டது. இந்தப் பங்கை வகிக்கும் அனைவருக்கும் மாற்றங்கள் உடனே பொருந்தும்.` }) : t({ en: `Role ${name.trim()} created.`, ms: `Peranan ${name.trim()} dicipta.`, zh: `角色 ${name.trim()} 已创建。`, ta: `${name.trim()} பங்கு உருவாக்கப்பட்டது.` }), !!role)
    })
  }
  return (
    <form className="card page-in p-0" data-guide="rl-editor" aria-label={role ? t({ en: `Edit role ${role.name}`, ms: `Edit peranan ${role.name}`, zh: `编辑角色 ${role.name}`, ta: `${role.name} பங்கைத் திருத்து` }) : t(S.newRole)}
      onSubmit={e => { e.preventDefault(); if (dirty || !role) save() }} onKeyDown={e => { if (e.key === 'Escape' && !readOnly) cancel() }}>
      <div className="grid gap-3 p-4">
        <h2 ref={headRef} tabIndex={-1} className="text-base font-semibold outline-none">{role ? role.name : t(S.newRole)}</h2>
        <label className="flex max-w-sm flex-col gap-1 text-sm font-semibold">{t({ en: 'Role name', ms: 'Nama peranan', zh: '角色名称', ta: 'பங்கின் பெயர்' })}
          <input ref={nameRef} className="input font-normal" value={name} disabled={!!role?.is_system} maxLength={60} onChange={e => setName(e.target.value)} /></label>
        {role?.is_system && <p className="text-sm text-muted">{readOnly ? t({ en: 'The Owner role is read only: it always holds every permission.', ms: 'Peranan Pemilik adalah baca sahaja: ia sentiasa memegang semua kebenaran.', zh: '“店主”角色为只读：它始终拥有所有权限。', ta: 'உரிமையாளர் பங்கு படிக்க மட்டும்: அது எப்போதும் எல்லா அனுமதிகளையும் கொண்டிருக்கும்.' }) : t({ en: 'The Staff role cannot be renamed, but its permissions can change.', ms: 'Peranan Kakitangan tidak boleh dinamakan semula, tetapi kebenarannya boleh diubah.', zh: '“员工”角色不能重命名，但可以更改其权限。', ta: 'ஊழியர் பங்கின் பெயரை மாற்ற முடியாது, ஆனால் அதன் அனுமதிகளை மாற்றலாம்.' })}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-semibold text-muted" role="status">{t({ en: `${count} of ${data.catalog.length} permissions allowed`, ms: `${count} daripada ${data.catalog.length} kebenaran dibenarkan`, zh: `已允许 ${count}/${data.catalog.length} 项权限`, ta: `${data.catalog.length} அனுமதிகளில் ${count} அனுமதிக்கப்பட்டன` })}</p>
          {!role && staff && <button type="button" className="btn btn-sm" onClick={() => setPerms(staff.permissions)}>{t({ en: 'Copy from Staff', ms: 'Salin daripada Kakitangan', zh: '从“员工”复制', ta: 'ஊழியர் பங்கிலிருந்து நகலெடு' })}</button>}
        </div>
      </div>
      {groups.map(g => (
        <section key={g} className="border-t border-hairline" aria-label={permGroup(g)}>
          <div className="flex items-center justify-between gap-2 bg-surface-2 px-3 py-1">
            <h3 className="text-sm font-semibold">{permGroup(g)}</h3>
            {!readOnly && <span className="flex gap-1">
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setGroup(g, true)}>{t(S.allow)}<span className="sr-only"> {permGroup(g)}</span></button>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setGroup(g, false)}>{t(S.clear)}<span className="sr-only"> {permGroup(g)}</span></button>
            </span>}
          </div>
          <div className="divide-y divide-hairline">
            {data.catalog.filter(p => p.group === g).map(p => (
              <Switch key={p.key} id={`pd-${p.key}`} label={permLabel(p.key, p.label)} desc={permDesc(p.key, p.description)} disabled={readOnly} on={readOnly || perms.includes(p.key)} changed={!readOnly && !same(p.key)} onChange={() => toggle(p.key)} />
            ))}
          </div>
        </section>
      ))}
      <section className="border-t border-hairline" aria-labelledby="oo" data-guide="rl-owner">
        <div className="bg-surface-2 px-3 py-1.5">
          <h3 id="oo" className="flex items-center gap-1.5 text-sm font-semibold"><Icon name="key" className="size-4" />{t(S.ownerOnly)}</h3>
          <p className="text-xs text-muted">{t(S.ownerOnlyHint)}</p>
        </div>
        <div className="divide-y divide-hairline">
          {data.non_assignable.map(p => <Switch key={p.key} id={`pd-${p.key}`} label={permLabel(p.key, p.label)} desc={permDesc(p.key, '')} disabled on={false} />)}
        </div>
      </section>
      <div className="sticky bottom-0 z-10 grid gap-2 rounded-b-card border-t border-line bg-surface p-3 max-sm:pr-28">
        {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
        <ActionError err={a.err} onRetry={save} label={t({ en: 'Try saving again', ms: 'Cuba simpan lagi', zh: '重新保存', ta: 'மீண்டும் சேமிக்க முயற்சிக்கவும்' })} />
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && <button type="submit" className="btn btn-primary" disabled={!!role && !dirty} aria-disabled={a.busy || undefined}>{a.busy ? t({ en: 'Saving...', ms: 'Menyimpan...', zh: '保存中...', ta: 'சேமிக்கிறது...' }) : role ? t({ en: 'Save role', ms: 'Simpan peranan', zh: '保存角色', ta: 'பங்கைச் சேமி' }) : t({ en: 'Create role', ms: 'Cipta peranan', zh: '创建角色', ta: 'பங்கை உருவாக்கு' })}</button>}
          {!readOnly && <button type="button" className="btn" onClick={cancel}>{t(CANCEL)}</button>}
          <p role="status" className="text-sm font-semibold text-muted">{dirty && role ? t({ en: `${changes} unsaved ${changes === 1 ? 'change' : 'changes'}`, ms: `${changes} perubahan belum disimpan`, zh: `${changes} 项未保存的更改`, ta: `${changes} சேமிக்கப்படாத மாற்றங்கள்` }) : ''}</p>
        </div>
      </div>
      {role && !role.is_system && (
        <div className="border-t border-hairline p-4">
          <h3 className="text-sm font-semibold text-warn">{t(S.danger)}</h3>
          <p className="mb-2 text-sm text-muted">{t(S.dangerHint)}</p>
          {del.confirm === role.id ? (
            <span className="flex flex-wrap items-center gap-2" role="group" aria-label={t({ en: `Confirm deleting ${role.name}`, ms: `Sahkan pemadaman ${role.name}`, zh: `确认删除 ${role.name}`, ta: `${role.name} ஐ நீக்குவதை உறுதிப்படுத்தவும்` })}>
              <span className="text-sm font-semibold">{role.users > 0 ? t({ en: `${role.users} still hold it, so the server will refuse. Delete ${role.name}?`, ms: `${role.users} masih memegangnya, jadi pelayan akan menolak. Padam ${role.name}?`, zh: `仍有 ${role.users} 人拥有此角色，服务器会拒绝。删除 ${role.name}？`, ta: `${role.users} பேர் இன்னும் வகிக்கிறார்கள், எனவே சேவையகம் மறுக்கும். ${role.name} ஐ நீக்கவா?` }) : t({ en: `Delete ${role.name}?`, ms: `Padam ${role.name}?`, zh: `删除 ${role.name}？`, ta: `${role.name} ஐ நீக்கவா?` })}</span>
              <button type="button" className="btn btn-danger" autoFocus aria-disabled={del.busy || undefined} onClick={() => del.remove(role)}>{t({ en: 'Yes, delete', ms: 'Ya, padam', zh: '是，删除', ta: 'ஆம், நீக்கு' })}<span className="sr-only"> {role.name}</span></button>
              <button type="button" className="btn" onClick={() => del.setConfirm('')}>{t(CANCEL)}</button>
            </span>
          ) : <button type="button" className="btn btn-danger" onClick={() => del.setConfirm(role.id)}>{t({ en: `Delete ${role.name}`, ms: `Padam ${role.name}`, zh: `删除 ${role.name}`, ta: `${role.name} ஐ நீக்கு` })}</button>}
        </div>
      )}
    </form>
  )
}

// Owner: who can do what. The role a person holds is chosen on the Team page.
export function RolesView({ owner }: { owner: boolean }) {
  useLang()
  const gate = useWriteGate()
  const s = useFetch<Roles>('/roles')
  const [editing, setEditing] = useState<string>()   // role id, or 'new'; unset = first editable role
  const [opened, setOpened] = useState(false)       // true once the owner picked something, so focus may move
  const [confirm, setConfirm] = useState('')
  const toast = useToast()
  const del = useAction()
  const last = useRef<() => void>(undefined)
  if (!owner) return <><PageHeader title={t(ROLES)} /><p className="card text-muted">{t({ en: 'You do not have access. Only the owner manages roles.', ms: 'Anda tiada akses. Hanya pemilik mengurus peranan.', zh: '你没有访问权限。只有店主可以管理角色。', ta: 'உங்களுக்கு அணுகல் இல்லை. உரிமையாளர் மட்டுமே பங்குகளை நிர்வகிக்கிறார்.' })}</p></>
  const done = (text: string, stay?: boolean) => { if (!stay) setEditing(undefined); setConfirm(''); if (text) toast(text); s.reload(); if (!stay) focusTop() }
  const remove = (r: RoleRow) => {
    last.current = () => remove(r)
    del.run(async () => { try { await api('DELETE', `/roles/${r.id}`) } catch (e) { throw friendly(e) }; done(t({ en: `Role ${r.name} deleted.`, ms: `Peranan ${r.name} dipadam.`, zh: `角色 ${r.name} 已删除。`, ta: `${r.name} பங்கு நீக்கப்பட்டது.` })) })
  }
  const pick = (id: string) => { setEditing(id); setOpened(true); setConfirm('') }
  const d = s.data
  const cur = d && (editing === 'new' ? null : d.roles.find(r => r.id === editing) ?? d.roles.find(r => !r.is_system) ?? d.roles.find(r => r.key === 'staff') ?? d.roles[0])
  return (
    <>
      <PageHeader title={t(ROLES)} description={t({ en: 'A role is a set of permissions. Everyone holds one role, chosen on the Team page. Changing what a role can do applies at once.', ms: 'Peranan ialah satu set kebenaran. Setiap orang memegang satu peranan, dipilih di halaman Pasukan. Perubahan pada apa yang boleh dilakukan oleh sesuatu peranan terpakai serta-merta.', zh: '角色是一组权限。每个人拥有一个角色，在“团队”页面选择。更改角色的权限会立即生效。', ta: 'பங்கு என்பது அனுமதிகளின் தொகுப்பு. ஒவ்வொருவரும் ஒரு பங்கை வகிக்கிறார்கள்; அது குழு பக்கத்தில் தேர்வு செய்யப்படும். ஒரு பங்கின் அனுமதிகளை மாற்றினால் உடனே பொருந்தும்.' })}
        actions={editing !== 'new' && <button type="button" className="btn btn-primary" data-guide="rl-new" {...gate(() => pick('new'))}>{t(S.newRole)}</button>} />
      <ActionError err={del.err} onRetry={() => last.current?.()} label={t({ en: 'Try again', ms: 'Cuba lagi', zh: '重试', ta: 'மீண்டும் முயற்சிக்கவும்' })} />
      <Async s={s} rows={3} empty={!d} emptyText={t({ en: 'No roles.', ms: 'Tiada peranan.', zh: '没有角色。', ta: 'பங்குகள் இல்லை.' })}>
        {d && <div className="grid items-start gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
          <nav aria-label={t(S.roleList)} data-guide="rl-list">
            <ul className="grid gap-2">
              {d.roles.map(r => {
                const n = r.class === 'owner' ? d.catalog.length : r.permissions.length
                const on = cur?.id === r.id
                return (
                  <li key={r.id} className={`rounded-card border p-3 ${on ? 'border-accent bg-tint' : 'border-hairline bg-surface hover:bg-tint'}`}>
                    <button type="button" className="block w-full text-left" aria-current={on ? 'true' : undefined} onClick={() => pick(r.id)}>
                      <span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{r.name}</span>
                        {r.is_system && <span className="badge">{r.class === 'owner' ? t({ en: 'Built in, read only', ms: 'Terbina dalam, baca sahaja', zh: '内置，只读', ta: 'உள்ளமைந்தது, படிக்க மட்டும்' }) : t({ en: 'Built in', ms: 'Terbina dalam', zh: '内置', ta: 'உள்ளமைந்தது' })}</span>}</span>
                      <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true"><span className="block h-full bg-accent" style={{ width: `${d.catalog.length ? (n / d.catalog.length) * 100 : 0}%` }} /></span>
                      <span className="mt-1 block text-xs text-muted">{ofN(n, d.catalog.length)}</span>
                    </button>
                    <a href="#/team" className="mt-1 inline-flex min-h-6 items-center text-xs text-muted underline">{people(r.users)}</a>
                  </li>
                )
              })}
              {editing === 'new' && <li className="rounded-card border border-accent bg-tint p-3"><span className="font-semibold" aria-current="true">{t(S.newRole)}</span></li>}
            </ul>
          </nav>
          <Editor key={cur?.id ?? 'new'} role={cur ?? null} data={d} onDone={done} focus={opened} del={{ confirm, setConfirm, remove, busy: del.busy }} />
        </div>}
      </Async>
    </>
  )
}

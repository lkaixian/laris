import { useRef, useState } from 'react'
import { api, ApiError } from './api'
import { ActionError, Async, PageHeader, focusTop, useAction, useFetch } from './ui'
import { useToast } from './Toast'

interface RoleRow { id: string; key: string; name: string; class: 'owner' | 'staff'; is_system: boolean; permissions: string[]; users: number }
interface Perm { key: string; label: string; description: string; group: string; default: boolean }
interface Roles { roles: RoleRow[]; catalog: Perm[]; non_assignable: { key: string; label: string }[] }

const CODES: Record<string, string> = {
  name_taken: 'Another role already has that name. Choose a different name.',
  not_assignable: 'One of those permissions is always owner-only and cannot be given to a role.',
  unknown_permission: 'One of those permissions is not recognised. Reload the page and try again.',
  role_in_use: 'People still hold this role. Move them to another role on the Team page first.',
  system_role: 'The Owner and Staff roles cannot be renamed or deleted.',
}
// Friendly text for the codes the roles endpoints answer; the status code and code stay on the error.
const friendly = (e: unknown) => (e instanceof ApiError && CODES[e.code] ? new ApiError(e.status, e.code, CODES[e.code]) : e)

function Editor({ role, data, onDone }: { role: RoleRow | null; data: Roles; onDone: (note: string) => void }) {
  const [name, setName] = useState(role?.name ?? '')
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? [])
  const [formErr, setFormErr] = useState('')
  const a = useAction()
  const readOnly = role?.class === 'owner'   // the Owner role always holds everything
  const groups = [...new Set(data.catalog.map(p => p.group))]
  const staff = data.roles.find(r => r.key === 'staff')
  const toggle = (k: string) => setPerms(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k]))
  const save = () => {
    if (!role?.is_system && !name.trim()) return setFormErr('Enter a name for the role.')
    setFormErr('')
    a.run(async () => {
      try {
        if (role) await api('PATCH', `/roles/${role.id}`, role.is_system ? { permissions: perms } : { name: name.trim(), permissions: perms })
        else await api('POST', '/roles', { name: name.trim(), permissions: perms })
      } catch (e) { throw friendly(e) }
      onDone(role ? `Role ${role.name} saved. Changes apply to everyone with this role straight away.` : `Role ${name.trim()} created.`)
    })
  }
  return (
    <form className="card mt-2 grid gap-3 border-l-4 border-l-accent" aria-label={role ? `Edit role ${role.name}` : 'New role'} onSubmit={e => { e.preventDefault(); save() }}>
      <label className="flex max-w-sm flex-col gap-1 text-sm font-semibold">Role name
        <input className="input font-normal" value={name} disabled={!!role?.is_system} maxLength={60} autoFocus={!role} onChange={e => setName(e.target.value)} /></label>
      {role?.is_system && <p className="text-sm text-muted">{readOnly ? 'The Owner role is read only: it always holds every permission.' : 'The Staff role cannot be renamed, but its permissions can change.'}</p>}
      {!role && staff && <div><button type="button" className="btn" onClick={() => setPerms(staff.permissions)}>Copy from Staff</button></div>}
      {groups.map(g => (
        <fieldset key={g} className="rounded-ui border border-soft p-3">
          <legend className="px-1 text-sm font-semibold">{g}</legend>
          <ul className="grid gap-1">
            {data.catalog.filter(p => p.group === g).map(p => (
              <li key={p.key}>
                <label className="flex min-h-11 items-start gap-2 py-1 text-sm">
                  <input type="checkbox" className="mt-1" disabled={readOnly} checked={readOnly || perms.includes(p.key)} aria-describedby={`pd-${p.key}`} onChange={() => toggle(p.key)} />
                  <span><span className="font-semibold">{p.label}</span><span id={`pd-${p.key}`} className="block text-muted">{p.description}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}
      {formErr && <p role="alert" className="text-sm text-warn">{formErr}</p>}
      <ActionError err={a.err} onRetry={save} label="Try saving again" />
      <div className="flex flex-wrap gap-2">
        {!readOnly && <button type="submit" className="btn btn-primary" aria-disabled={a.busy || undefined}>{a.busy ? 'Saving...' : role ? 'Save role' : 'Create role'}</button>}
        <button type="button" className="btn" onClick={() => onDone('')}>{readOnly ? 'Close' : 'Cancel'}</button>
      </div>
    </form>
  )
}

// Owner: who can do what. The role a person holds is chosen on the Team page.
export function RolesView({ owner }: { owner: boolean }) {
  const s = useFetch<Roles>('/roles')
  const [editing, setEditing] = useState<string>()   // role id, or 'new'
  const [confirm, setConfirm] = useState('')
  const toast = useToast()
  const del = useAction()
  const last = useRef<() => void>(undefined)
  if (!owner) return <><PageHeader title="Roles" /><p className="card text-muted">You do not have access. Only the owner manages roles.</p></>
  const done = (text: string) => { setEditing(undefined); setConfirm(''); if (text) toast(text); s.reload(); focusTop() }
  const remove = (r: RoleRow) => {
    last.current = () => remove(r)
    del.run(async () => { try { await api('DELETE', `/roles/${r.id}`) } catch (e) { throw friendly(e) }; done(`Role ${r.name} deleted.`) })
  }
  const d = s.data
  return (
    <>
      <PageHeader title="Roles" description="A role is a set of permissions. Everyone holds one role, chosen on the Team page. Changing what a role can do applies at once."
        actions={editing !== 'new' && <button type="button" className="btn btn-primary" onClick={() => { setEditing('new'); setConfirm('') }}>New role</button>} />
      <ActionError err={del.err} onRetry={() => last.current?.()} label="Try again" />
      <Async s={s} rows={3} empty={!d} emptyText="No roles.">
        {d && <>
          <ul className="grid gap-2">
            {d.roles.map(r => (
              <li key={r.id} className="card">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.name}</span>
                  {r.is_system && <span className="badge">{r.class === 'owner' ? 'Built in, read only' : 'Built in'}</span>}
                  <span className="text-sm text-muted">{r.users} {r.users === 1 ? 'person' : 'people'} · {r.permissions.length} of {d.catalog.length} permissions</span>
                </p>
                {editing === r.id ? <Editor role={r} data={d} onDone={done} /> : (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" className="btn" onClick={() => { setEditing(r.id); setConfirm('') }}>{r.class === 'owner' ? 'View' : 'Edit'} {r.name}</button>
                    {!r.is_system && (confirm === r.id ? (
                      <span className="flex flex-wrap items-center gap-2" role="group" aria-label={`Confirm deleting ${r.name}`}>
                        <span className="text-sm font-semibold">{r.users > 0 ? `${r.users} still hold it, so the server will refuse. Delete ${r.name}?` : `Delete ${r.name}?`}</span>
                        <button type="button" className="btn btn-danger" autoFocus aria-disabled={del.busy || undefined} onClick={() => remove(r)}>Yes, delete<span className="sr-only"> {r.name}</span></button>
                        <button type="button" className="btn" onClick={() => setConfirm('')}>Cancel</button>
                      </span>
                    ) : <button type="button" className="btn btn-danger" onClick={() => { setConfirm(r.id); setEditing(undefined) }}>Delete {r.name}</button>)}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {editing === 'new' && <div className="mt-4"><Editor role={null} data={d} onDone={done} /></div>}
          <section className="mt-8 border-t border-soft pt-6" aria-labelledby="oo">
            <h2 id="oo" className="text-base font-semibold">Always owner-only</h2>
            <p className="mb-2 text-sm text-muted">These cannot be given to any role. Only people who hold the Owner role can do them.</p>
            <ul className="list-disc pl-5 text-sm">{d.non_assignable.map(p => <li key={p.key}>{p.label}</li>)}</ul>
          </section>
        </>}
      </Async>
    </>
  )
}

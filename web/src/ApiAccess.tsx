import { useRef, useState } from 'react'
import { api } from './api'
import { Async, PageHeader, msg, useAction, ActionError, useFetch } from './ui'
import { useToast } from './Toast'

interface Usage { period: string; approved_quotes: number; quotes_sent: number; api_calls: number; free_allowance: number; over_allowance: boolean; note: string }
interface Key { id: string; name: string; key_prefix: string; created_at: string; last_used_at: string | null; revoked: boolean; mcp_role: string | null }

const day = (s: string) => new Date(s).toLocaleDateString()

function UsageCard() {
  const s = useFetch<Usage>('/usage')
  const u = s.data
  return (
    <section className="mb-6" aria-labelledby="usage" data-guide="api-usage">
      <h2 id="usage" className="mb-2 text-lg font-semibold">Usage this month</h2>
      <Async s={s} empty={false} rows={2}>
        {u && <>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {([['Approved quotes', `${u.approved_quotes} of ${u.free_allowance} free`], ['Quotes sent', String(u.quotes_sent)], ['API calls', String(u.api_calls)]] as const).map(([k, v]) => (
              <div key={k} className="card"><dt className="text-sm text-muted">{k}</dt><dd className="text-lg font-semibold">{v}</dd></div>
            ))}
          </dl>
          <p className={`mt-2 ${u.over_allowance ? 'font-semibold text-warn' : 'text-sm'}`}>
            {u.over_allowance ? `You are over the free allowance by ${u.approved_quotes - u.free_allowance} ${u.approved_quotes - u.free_allowance === 1 ? 'quote' : 'quotes'} this month.`
              : `You have ${u.free_allowance - u.approved_quotes} free ${u.free_allowance - u.approved_quotes === 1 ? 'quote' : 'quotes'} left this month.`}
          </p>
          <p className="text-sm text-muted">{u.note}</p>
        </>}
      </Async>
    </section>
  )
}

function Keys() {
  const s = useFetch<Key[]>('/settings/api-keys')
  const [name, setName] = useState('')
  const [ai, setAi] = useState(false)
  const [roleId, setRoleId] = useState('')
  const roles = useFetch<{ roles: { id: string; name: string; class: string }[] }>('/roles')
  const staffRoles = (roles.data?.roles ?? []).filter(x => x.class === 'staff')
  const [made, setMade] = useState<{ name: string; key: string }>()
  const [copied, setCopied] = useState('')
  const [ask, setAsk] = useState('')
  const [err, setErr] = useState('')
  const add = useAction()
  const toast = useToast()
  const box = useRef<HTMLInputElement>(null)
  const create = () => {
    if (!name.trim()) return setErr('Give the key a name, for example the program that will use it.')
    if (ai && !roleId) return setErr('Choose which role the AI tool acts as.')
    setErr(''); setCopied('')
    add.run(async () => { const r = await api<{ name: string; key: string }>('POST', '/settings/api-keys', { name: name.trim(), ...(ai ? { mcp_role_id: roleId } : {}) }); setMade(r); setName(''); s.reload(); requestAnimationFrame(() => box.current?.select()) })
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(made!.key); setCopied('Copied.') } catch { box.current?.select(); setCopied('Could not copy automatically. The key is selected, press Ctrl+C.') }
  }
  const revoke = async (k: Key) => {
    try { await api('DELETE', `/settings/api-keys/${k.id}`); toast(`Key ${k.name} revoked.`); setAsk(''); s.reload() } catch (e) { setErr(msg(e)) }
  }
  const list = s.data ?? []
  return (
    <section className="mb-6" aria-labelledby="keys">
      <h2 id="keys" className="text-lg font-semibold">API keys</h2>
      <p className="mb-3 mt-1 text-sm text-muted">A key lets another program ask LARIS for prices. Each key works for your business only and can only read prices. It cannot see costs or margins.</p>
      <form className="mb-4 flex flex-wrap items-end gap-2" data-guide="api-create" onSubmit={e => { e.preventDefault(); create() }}>
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm font-semibold">New key name
          <input className="input font-normal" maxLength={60} value={name} onChange={e => setName(e.target.value)} /></label>
        <button type="submit" className="btn btn-primary" aria-disabled={add.busy || undefined}>{add.busy ? 'Creating...' : 'Create key'}</button>
        <div className="w-full">
          <label className="flex min-h-11 items-start gap-2 text-sm font-semibold" data-guide="api-mcp">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={ai} onChange={e => setAi(e.target.checked)} />
            <span>This key is for an AI tool (MCP)<span className="block font-normal text-muted">The tool can search your quotes, contacts and catalog, limited to what the role below may see. It needs your agreement under AI settings first. Names and contact details are replaced by placeholders, but addresses are not.</span></span></label>
          {ai && (
            <label className="mt-1 flex max-w-sm flex-col gap-1 text-sm font-semibold">Acts as this role
              <select className="input font-normal" value={roleId} onChange={e => setRoleId(e.target.value)}>
                <option value="">Choose a role</option>
                {staffRoles.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select></label>)}
        </div>
      </form>
      {err && <p role="alert" className="mb-2 text-sm text-warn">{err}</p>}
      <ActionError err={add.err} onRetry={create} label="Retry creating the key" />
      {made && (
        <div className="card mb-4 border-l-4 border-l-amber" role="group" aria-label="New API key">
          <p className="font-semibold">Copy it now, it is shown once.</p>
          <p className="text-sm text-muted">This is the key for {made.name}. LARIS cannot show it again. If you lose it, revoke it and create a new one.</p>
          <input ref={box} readOnly aria-label={`API key for ${made.name}`} className="input mt-2 w-full font-mono text-sm" value={made.key} onFocus={e => e.currentTarget.select()} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary" onClick={copy}>Copy key</button>
            <button type="button" className="btn" onClick={() => { setMade(undefined); setCopied('') }}>I have copied it</button>
            <span role="status" className="text-sm">{copied}</span>
          </div>
        </div>
      )}
      <Async s={s} rows={2} empty={!list.length} emptyText="No API keys yet." emptyHint="Create a key above when another program needs to ask LARIS for prices.">
        <ul className="grid gap-2" data-guide="api-list">
          {list.map(k => (
            <li key={k.id} className="card">
              <p className="flex flex-wrap items-center gap-2"><span className="font-semibold">{k.name}</span>{k.mcp_role && <span className="badge">AI tool, acts as {k.mcp_role}</span>}{k.revoked && <span className="badge badge-warn">Revoked</span>}</p>
              <p className="break-all font-mono text-sm">{k.key_prefix}...</p>
              <p className="text-sm text-muted">Created {day(k.created_at)}. {k.last_used_at ? `Last used ${day(k.last_used_at)}.` : 'Never used.'}</p>
              {!k.revoked && (ask === k.id ? (
                <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={`Confirm revoking ${k.name}`}>
                  <span className="text-sm font-semibold">Revoke {k.name}? Programs using it stop working at once.</span>
                  <button type="button" className="btn btn-danger" autoFocus onClick={() => revoke(k)}>Yes, revoke<span className="sr-only"> {k.name}</span></button>
                  <button type="button" className="btn" onClick={() => setAsk('')}>Cancel</button>
                </div>
              ) : <div className="mt-3"><button type="button" className="btn" onClick={() => setAsk(k.id)}>Revoke<span className="sr-only"> {k.name}</span></button></div>)}
            </li>
          ))}
        </ul>
      </Async>
    </section>
  )
}

export function ApiAccessView() {
  const base = location.origin + '/api/v1'
  return (
    <>
      <PageHeader title="API access" description="Let another program, such as your own system, ask LARIS for selling prices." />
      <UsageCard />
      <Keys />
      <section className="card" aria-labelledby="how" data-guide="api-how">
        <h2 id="how" className="text-lg font-semibold">How to call it</h2>
        <p className="mt-1 text-sm text-muted">Send your key in the X-API-Key header. Replace YOUR_API_KEY with your own key. Up to 60 requests a minute per key.</p>
        <pre className="mt-2 whitespace-pre-wrap break-all rounded-ui bg-soft p-3 font-mono text-xs">{`curl -H "X-API-Key: YOUR_API_KEY" ${base}/recipes

curl -X POST -H "X-API-Key: YOUR_API_KEY" -H "Content-Type: application/json" ${base}/quote-price -d '{"items":[{"recipe_key":"signboard_60x30","qty":2}]}'`}</pre>
        <p className="mt-2 text-sm text-muted">The first call lists the items you can price. The second returns selling prices only, never costs or margins.</p>
        <h3 className="mt-4 font-semibold">For an AI tool (MCP)</h3>
        <p className="mt-1 text-sm text-muted">Add this address as a remote MCP server in your AI tool and send the key as a Bearer token. It has one read-only tool, search.</p>
        <pre className="mt-2 whitespace-pre-wrap break-all rounded-ui bg-soft p-3 font-mono text-xs">{`${location.origin}/api/mcp
Authorization: Bearer YOUR_API_KEY`}</pre>
      </section>
    </>
  )
}

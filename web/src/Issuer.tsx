import { useEffect, useId, useRef, useState } from 'react'
import { api, ApiError } from './api'
import { Async, EmptyState, PageHeader, Skeleton, msg, useFetch } from './ui'
import { useToast } from './Toast'
import { buildPayload, ed25519Supported, fingerprint, fromPem, generateKeys, publicKeyOf, signToken, toPem } from './licenseSign'

/*
  Operator page (#/issuer): create or load the signing key, then issue licences for requests. Signing happens in this browser tab with WebCrypto;
  the private key is held in component state only (never storage, never sent). The server gets the public key and finished tokens.
*/
interface Config { public_key: string | null; source: 'environment' | 'dashboard' | null; enforced: boolean }
interface Request { id: string; org: string; email: string; plan: string; seats: number; note?: string; requested_at: string; status: 'pending' | 'issued'; offer_expires_at: string | null }
interface Plan { key: string; name: string; seats: number }
interface Key { pkcs8: ArrayBuffer; pub: string }

const date = (s: string) => new Date(s).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

function useFingerprint(pub?: string | null) {
  const [fp, setFp] = useState('')
  useEffect(() => { setFp(''); if (pub) fingerprint(pub).then(setFp, () => setFp('')) }, [pub])
  return fp
}

// Confirmation before replacing a key that existing licences depend on.
function Confirm({ n, busy, onYes, onNo }: { n: number; busy: boolean; onYes: () => void; onNo: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const no = useRef<HTMLButtonElement>(null)
  useEffect(() => { no.current?.focus() }, [])
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return onNo()
    if (e.key !== 'Tab') return
    const b = box.current!.querySelectorAll<HTMLElement>('button')
    if (e.shiftKey && document.activeElement === b[0]) { e.preventDefault(); b[b.length - 1].focus() }
    else if (!e.shiftKey && document.activeElement === b[b.length - 1]) { e.preventDefault(); b[0].focus() }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4" onKeyDown={keys}>
      <div ref={box} role="alertdialog" aria-modal="true" aria-labelledby="ck-t" aria-describedby="ck-d" className="card w-full max-w-sm shadow-lg">
        <h2 id="ck-t" className="text-lg font-semibold">Replace the server key?</h2>
        <p id="ck-d" className="mt-1 text-sm">{n} {n === 1 ? 'licence' : 'licences'} signed with the current key will stop working.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button ref={no} type="button" className="btn btn-primary" onClick={onNo}>Keep the current key</button>
          <button type="button" className="btn" aria-disabled={busy || undefined} onClick={() => !busy && onYes()}>{busy ? 'Saving...' : 'Replace anyway'}</button>
        </div>
      </div>
    </div>
  )
}

function KeyStep({ cfg, key_, setKey, reload }: { cfg: Config; key_: Key | null; setKey: (k: Key | null) => void; reload: () => void }) {
  const [fresh, setFresh] = useState<{ pem: string; url: string } | null>(null)
  const [paste, setPaste] = useState('')
  const [err, setErr] = useState('')
  const [saveErr, setSaveErr] = useState('')
  const [ask, setAsk] = useState<number | null>(null)  // licences that would stop working, while the dialog is open
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const id = useId()
  const fpServer = useFingerprint(cfg.public_key)
  const fpLoaded = useFingerprint(key_?.pub)
  useEffect(() => () => { if (fresh) URL.revokeObjectURL(fresh.url) }, [fresh])

  const create = async () => {
    setErr('')
    try {
      const k = await generateKeys()
      const pem = toPem(k.pkcs8)
      setFresh({ pem, url: URL.createObjectURL(new Blob([pem], { type: 'application/x-pem-file' })) })
      setKey({ pkcs8: k.pkcs8, pub: k.publicKey })
    } catch { setErr('Could not create keys in this browser.') }
  }
  const load = async (text: string) => {
    setErr('')
    try { const pkcs8 = fromPem(text); setKey({ pkcs8, pub: await publicKeyOf(pkcs8) }); setFresh(null); setPaste('') }
    catch { setErr('That is not a private key. Use the private.pem file (it starts with BEGIN PRIVATE KEY) made for an Ed25519 key.') }
  }
  const save = async (confirm?: boolean) => {
    if (!key_ || busy) return
    setBusy(true); setSaveErr('')
    try { await api('POST', '/license/admin/public-key', confirm ? { public_key: key_.pub, confirm: true } : { public_key: key_.pub }); setAsk(null); toast('Public key saved to this server.'); reload() }
    catch (e) {
      if (e instanceof ApiError && e.code === 'would_invalidate') setAsk(e.details?.licences ?? 0)
      else setSaveErr(e instanceof ApiError && e.code === 'key_from_environment' ? 'The key is set in the server settings, so it cannot be changed here.'
        : e instanceof ApiError && e.code === 'bad_key' ? 'The server did not accept this public key.' : msg(e))
    } finally { setBusy(false) }
  }
  const match = !key_ ? null : !cfg.public_key ? 'none' : key_.pub === cfg.public_key ? 'yes' : 'no'
  return (
    <section aria-labelledby={`${id}-h`} className="card mb-6" data-guide="iss-key">
      <h2 id={`${id}-h`} className="text-lg font-semibold">Step 1. Signing key</h2>
      <p className="mt-1 text-sm text-muted">The private key stays in this browser tab. It is never uploaded and never stored, so you load it again each time you open this page.</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted">Server key</dt>
        <dd className="font-semibold">{cfg.public_key ? <>{fpServer}<span className="ml-2 font-normal text-muted">({cfg.source === 'environment' ? 'set in server settings' : 'saved from this page'})</span></> : 'None saved yet'}</dd>
        <dt className="text-muted">Key in this tab</dt>
        <dd className="font-semibold">{key_ ? fpLoaded : 'None loaded'}</dd>
      </dl>
      {match && <p role="status" className={`mt-2 text-sm font-semibold ${match === 'no' ? 'text-warn' : ''}`}>
        {match === 'yes' ? 'This key matches the server. You can issue licences.' : match === 'no' ? 'This key does NOT match the server key. Licences signed with it will be refused.' : 'The server has no key yet. Save the public key below first.'}</p>}

      {fresh && <div className="mt-3 rounded-ui border border-warn bg-warn-bg p-3 text-sm text-warn">
        <p className="font-semibold">Download your private key now and keep it safe.</p>
        <p className="mt-1">Anyone with this file can issue licences. We cannot recover it. Do not email it or put it in a shared folder.</p>
        <a className="btn mt-2" href={fresh.url} download="private.pem">Download private.pem</a>
      </div>}
      {key_ && <div className="mt-3 text-sm">
        <p className="font-semibold">Public key</p>
        <code className="mt-1 block break-all rounded-ui bg-tint p-2">{key_.pub}</code>
        {match !== 'yes' && <button type="button" className="btn btn-primary mt-2" aria-disabled={busy || cfg.source === 'environment' || undefined}
          title={cfg.source === 'environment' ? 'The key is set in the server settings' : undefined} onClick={() => cfg.source !== 'environment' && save()}>{busy ? 'Saving...' : 'Save public key to this server'}</button>}
        {saveErr && <p role="alert" className="mt-2 text-warn">{saveErr}</p>}
      </div>}

      <div className="mt-4 flex flex-wrap gap-2" data-guide="iss-create">
        <button type="button" className="btn" onClick={create}>Create new keys</button>
        {key_ && <button type="button" className="btn" onClick={() => { setKey(null); setFresh(null) }}>Remove key from this tab</button>}
      </div>
      <div className="mt-4 grid gap-2" data-guide="iss-load">
        <p className="text-sm font-semibold">Or load my private key</p>
        <label className="flex flex-col gap-1 text-sm">Choose private.pem
          <input type="file" accept=".pem,text/plain" className="input py-2" onChange={async e => { const f = e.target.files?.[0]; if (f) await load(await f.text()); e.target.value = '' }} />
        </label>
        <label className="flex flex-col gap-1 text-sm">Or paste its text
          <textarea className="input min-h-20 break-all py-2 font-mono" rows={3} autoComplete="off" spellCheck={false} placeholder="-----BEGIN PRIVATE KEY-----" value={paste} onChange={e => setPaste(e.target.value)} />
        </label>
        <div><button type="button" className="btn" aria-disabled={!paste.trim() || undefined} onClick={() => paste.trim() && load(paste)}>Use this key</button></div>
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-warn">{err}</p>}
      {ask !== null && <Confirm n={ask} busy={busy} onYes={() => save(true)} onNo={() => setAsk(null)} />}
    </section>
  )
}

function RequestCard({ r, plans, key_, ready, onIssued }: { r: Request; plans: Plan[]; key_: Key | null; ready: boolean; onIssued: () => void }) {
  const asked = plans.find(p => p.key === r.plan)
  const options = [...new Set([r.plan, ...plans.filter(p => asked && p.seats <= asked.seats).map(p => p.key)])]  // never above what was asked
  const [plan, setPlan] = useState(r.plan)
  const [seats, setSeats] = useState(String(r.seats))
  const [days, setDays] = useState('365')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const id = useId()
  const issue = async () => {
    const n = Number(seats), d = Number(days)
    if (!key_ || !ready) return setErr('Load the signing key that matches the server key in step 1 first.')
    if (!Number.isInteger(n) || n < 1 || n > r.seats) return setErr(`Seats must be a whole number from 1 to ${r.seats}, the number asked for.`)
    if (!Number.isInteger(d) || d < 1 || d > 1100) return setErr('Days valid must be a whole number from 1 to 1100.')
    setBusy(true); setErr('')
    try {
      const token = await signToken(key_.pkcs8, buildPayload({ email: r.email, org: r.org, plan, seats: n, days: d }))
      const out = await api<{ ok: boolean; emailed: boolean }>('POST', '/license/admin/issue', { request_id: r.id, token })
      toast(out.emailed ? `Licence emailed to ${r.email}.` : 'Saved. The email could not be sent, the owner can still activate it from the Licence page.')
      onIssued()
    } catch (e) {
      setErr(e instanceof ApiError && e.code === 'token_mismatch' ? 'The server rejected the licence. Check that the key in this tab matches the server key.' : msg(e))
    } finally { setBusy(false) }
  }
  return (
    <li className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="min-w-0 break-words font-semibold">{r.org}</h3>
        <span className={`badge ${r.status === 'pending' ? 'badge-warn' : ''}`}>{r.status === 'pending' ? 'Waiting' : 'Issued'}</span>
      </div>
      <p className="break-all text-sm text-muted">{r.email}</p>
      <p className="mt-1 text-sm">Asked for {cap(r.plan)}, {r.seats} seats, on {date(r.requested_at)}.</p>
      {r.note && <p className="mt-1 text-sm text-muted">Note: {r.note}</p>}
      {r.status === 'issued' && <p className="mt-1 text-sm">{r.offer_expires_at ? `Licence valid until ${date(r.offer_expires_at)}.` : 'Licence issued.'}</p>}
      {r.status === 'pending' && (
        <form className="mt-3 grid gap-3 sm:grid-cols-3" data-guide="iss-issue" onSubmit={e => { e.preventDefault(); if (!busy) issue() }} aria-label={`Issue licence for ${r.org}`}>
          <label className="flex flex-col gap-1 text-sm font-semibold">Plan
            <select className="input font-normal" value={plan} onChange={e => setPlan(e.target.value)}>
              {options.map(k => <option key={k} value={k}>{plans.find(p => p.key === k)?.name ?? cap(k)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">Seats (up to {r.seats})
            <input className="input font-normal" type="number" min={1} max={r.seats} inputMode="numeric" value={seats} onChange={e => setSeats(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">Days valid
            <input className="input font-normal" type="number" min={1} max={1100} inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} />
          </label>
          {err && <p id={`${id}-e`} role="alert" className="text-sm text-warn sm:col-span-3">{err}</p>}
          <div className="sm:col-span-3">
            <button type="submit" className="btn btn-primary" aria-disabled={busy || !ready || undefined} title={ready ? undefined : 'Load the matching signing key in step 1 first'}>{busy ? 'Issuing...' : 'Issue and email'}</button>
          </div>
        </form>
      )}
    </li>
  )
}

function RequestsStep({ key_, ready }: { key_: Key | null; ready: boolean }) {
  const s = useFetch<Request[]>('/license/admin/requests')
  const plans = useFetch<{ plans: Plan[] }>('/license/plans')
  return (
    <section aria-labelledby="iss-r" data-guide="iss-requests">
      <h2 id="iss-r" className="mb-1 text-lg font-semibold">Step 2. Requests</h2>
      <p className="mb-3 text-sm text-muted">Seats and plan can be lowered but never raised above what was asked for.</p>
      <Async s={s} empty={s.data?.length === 0} emptyText="No licence requests yet." emptyHint="When a business asks for a licence it appears here." rows={3}>
        <ul aria-label="Licence requests" className="grid gap-3">
          {s.data?.map(r => <RequestCard key={r.id} r={r} plans={plans.data?.plans ?? []} key_={key_} ready={ready} onIssued={s.reload} />)}
        </ul>
      </Async>
    </section>
  )
}

export function IssuerView() {
  const cfg = useFetch<Config>('/license/admin/config')
  const [key_, setKey] = useState<Key | null>(null)
  const [ok, setOk] = useState<boolean>()
  useEffect(() => { ed25519Supported().then(setOk) }, [])
  const header = <PageHeader title="Issue licences" description="For the LARIS team: sign licences for customers who asked for one." />
  if (cfg.err instanceof ApiError && cfg.err.status === 404) return <><PageHeader title="Issue licences" /><EmptyState title="This page is only for the LARIS team." /></>
  if (ok === undefined || (cfg.loading && !cfg.data)) return <>{header}<Skeleton rows={3} shape="text" /></>
  if (!ok) return <>{header}<p role="alert" className="card border-warn bg-warn-bg text-warn">This browser cannot sign licences. Use a current Chrome, Edge, Firefox or Safari.</p></>
  if (!cfg.data) return <>{header}<Async s={cfg}><span /></Async></>
  return (
    <>
      {header}
      <KeyStep cfg={cfg.data} key_={key_} setKey={setKey} reload={cfg.reload} />
      <RequestsStep key_={key_} ready={!!key_ && (!cfg.data.public_key || key_.pub === cfg.data.public_key)} />
    </>
  )
}

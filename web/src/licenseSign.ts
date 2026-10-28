// Licence signing in the browser (WebCrypto Ed25519). Same token format as scripts/issue_license.py and src/license.py:
//   LARIS1.<b64url payload JSON>.<b64url Ed25519 signature over the payload bytes>
// The private key is only ever held in memory by the caller. Nothing here touches the network or storage.
export interface Payload { v: 1; lid: string; email: string; org: string; plan: string; seats: number; issued_at: number; expires_at: number }

const b64 = (b: ArrayBuffer | Uint8Array) => { let s = ''; new Uint8Array(b).forEach(c => { s += String.fromCharCode(c) }); return btoa(s) }
const b64url = (b: ArrayBuffer | Uint8Array) => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer

// ONE place for the payload field formats (src/license.py sign()): email lower case, lid a random UUID v4, times in whole seconds.
export function buildPayload(a: { email: string; org: string; plan: string; seats: number; days: number }, now = Math.floor(Date.now() / 1000)): Payload {
  return { v: 1, lid: crypto.randomUUID(), email: a.email.trim().toLowerCase(), org: a.org, plan: a.plan, seats: a.seats, issued_at: now, expires_at: now + a.days * 86400 }
}

// Feature detection: older browsers reject the Ed25519 algorithm name.
export async function ed25519Supported(): Promise<boolean> {
  try { await crypto.subtle.generateKey('Ed25519', false, ['sign']); return true } catch { return false }
}

export async function signToken(privateKeyPkcs8: ArrayBuffer, payload: Payload): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', privateKeyPkcs8, 'Ed25519', false, ['sign'])
  // Keys sorted and compact, like the CLI (json.dumps sort_keys, separators). The verifier checks the exact bytes signed, so any order is valid.
  const body = new TextEncoder().encode(JSON.stringify(Object.fromEntries(Object.entries(payload).sort(([a], [b]) => (a < b ? -1 : 1)))))
  const sig = await crypto.subtle.sign('Ed25519', key, body)
  return `LARIS1.${b64url(body)}.${b64url(sig)}`
}

export const toPem = (pkcs8: ArrayBuffer) => `-----BEGIN PRIVATE KEY-----\n${b64(pkcs8).replace(/.{1,64}/g, '$&\n')}-----END PRIVATE KEY-----\n`

// Accepts the text of private.pem (PKCS8 "BEGIN PRIVATE KEY"). Throws if it is not valid base64.
export const fromPem = (pem: string): ArrayBuffer => {
  const m = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/.exec(pem)
  if (!m) throw new Error('not pem')
  return unb64(m[1].replace(/\s+/g, ''))
}

// New pair. `publicKey` is the base64 raw 32 bytes the server expects (LICENSE_PUBLIC_KEY).
export async function generateKeys(): Promise<{ pkcs8: ArrayBuffer; publicKey: string }> {
  const k = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
  return { pkcs8: await crypto.subtle.exportKey('pkcs8', k.privateKey), publicKey: b64(await crypto.subtle.exportKey('raw', k.publicKey)) }
}

// Public key of an imported private key: the JWK export of an Ed25519 private key carries it as `x`. Throws if the bytes are not an Ed25519 key.
export async function publicKeyOf(pkcs8: ArrayBuffer): Promise<string> {
  const k = await crypto.subtle.importKey('pkcs8', pkcs8, 'Ed25519', true, ['sign'])
  const x = (await crypto.subtle.exportKey('jwk', k)).x
  if (!x) throw new Error('no public part')
  return b64(unb64(x.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (x.length % 4)) % 4)))
}

// Short, readable fingerprint of a base64 public key: first 16 hex characters of SHA-256, in groups of four.
export async function fingerprint(publicKey: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', unb64(publicKey)))
  return Array.from(h.slice(0, 8), x => x.toString(16).padStart(2, '0')).join('').replace(/(.{4})(?=.)/g, '$1 ')
}

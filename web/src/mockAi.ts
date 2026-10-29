// SAMPLE data for AI settings and the AI guide (mock mode only). Switches: ?ai=off (default), on, custom, legacy, down.
// Shapes follow src/api/ai_guide.py. The mock answer picks links from the candidates it is sent.
import { ApiError } from './api'

const mode = new URLSearchParams(location.search).get('ai') ?? 'off'
export const mockAiOn = mode === 'on' || mode === 'custom' || mode === 'down'
const TEXT = 'What is sent: only the question you type, with email addresses, phone numbers and ID numbers removed, plus the names of menu items on the screen. It goes to the AI provider you choose here: hosted ILMU, or your own AI server. Nothing from your quotes, customers or costs is sent in Guide only mode. Guide plus my data also lets the Assistant answer from your records; it uses the existing Assistant, which also sends only the question, never the records. You must tell your customers about this in your privacy notice. The provider\'s own data retention applies; for your own server, that is your responsibility. You can turn this off at any time.'
let s = {
  mode: mockAiOn ? 'guide' : 'off', provider: mode === 'custom' ? 'custom' : 'ilmu',
  custom: mode === 'custom' ? { base_url: 'https://ai.sample.example/v1', model: 'sample-model', has_key: true } : { base_url: '', model: '', has_key: false },
  consent: mockAiOn ? { at: new Date(Date.now() - 864e5 * 3).toISOString(), by: 'SAMPLE Owner', version: 1 } : { at: null as string | null, by: null as string | null, version: null as number | null },
  legacy: mode === 'legacy',
}
const RAG_TEXT = 'What is sent in this mode: your question AND short extracts of your own records that match it. Emails, phone numbers, ID numbers, card numbers and the names in your contact book are replaced first. Addresses are NOT hidden. Each person only gets answers from records their role may see. LARIS keeps only a count of each AI call. You must tell your customers and suppliers in your privacy notice (SAMPLE text).'
const view = () => ({ mode: s.mode, provider: s.provider, custom: s.custom, consent: s.consent, disclosure: { version: 1, text: TEXT }, rag_disclosure: { version: 2, text: RAG_TEXT }, available: { ilmu: mode !== 'noilmu' }, legacy_assistant: s.legacy })

// Returns undefined when the path is not one of ours. `guide` is open to every signed-in user.
export function mockAi(method: string, p: string, owner: boolean, body: any): unknown {
  if (p === '/assistant/guide' && method === 'POST') {
    if (s.mode === 'off') throw new ApiError(403, 'ai_off', 'The AI guide is switched off.')
    if (mode === 'down') throw new ApiError(503, 'ai_unavailable', 'The AI helper is not available.')
    const c: { label: string; href: string }[] = (body.candidates ?? []).slice(0, 2)
    return { answer: `This is a SAMPLE answer to "${String(body.question).slice(0, 60)}". Try ${c.length > 1 ? 'these screens' : 'this screen'}.`, links: c.map(x => ({ label: x.label, href: x.href })) }
  }
  if (p === '/ai/activity' && method === 'GET') {
    const at = (m: number) => new Date(Date.now() - m * 6e4).toISOString()
    const all = [
      { at: at(5), kind: 'assistant', provider: 'ilmu', ok: true, ms: 640, masked: { EMAIL: 1 }, person: 'SAMPLE Owner' },
      { at: at(40), kind: 'enquiry', provider: 'ilmu', ok: true, ms: 910, masked: { PHONE: 1, NAME: 1 }, person: null },
      { at: at(95), kind: 'supplier_doc', provider: 'ilmu', ok: false, ms: 3200, masked: {}, person: 'SAMPLE Staff' },
      { at: at(300), kind: 'guide', provider: 'ilmu', ok: true, ms: 480, masked: {}, person: 'SAMPLE Staff' },
    ]
    const recent = owner ? all : all.filter(x => x.person === 'SAMPLE Staff')
    const masked: Record<string, number> = {}
    recent.forEach(x => Object.entries(x.masked).forEach(([k, n]) => { masked[k] = (masked[k] ?? 0) + n }))
    const by_kind: Record<string, number> = {}
    recent.forEach(x => { by_kind[x.kind] = (by_kind[x.kind] ?? 0) + 1 })
    return { scope: owner ? 'all' : 'own', days: 30, totals: { calls: recent.length, failed: recent.filter(x => !x.ok).length, median_ms: 640, masked }, by_kind, recent }
  }
  if (!p.startsWith('/settings/ai')) return undefined
  if (!owner) throw new ApiError(403, 'owner_only', 'owner role required')
  if (p === '/settings/ai/test') return mode === 'down' ? { ok: false, message: 'The AI server did not answer. Check the address and key.' } : { ok: true, message: 'Connected. The AI server answered.' }
  if (method === 'POST') {
    if (body.mode !== 'off' && !body.accept_disclosure) throw new ApiError(422, 'disclosure_required', 'Please confirm you have read the notice.')
    if (body.provider === 'custom' && body.mode !== 'off') {
      const c = body.custom ?? {}
      if (!c.base_url || !c.model || (!c.api_key && !s.custom.has_key)) throw new ApiError(422, 'custom_incomplete', 'Address, model and key are all needed.')
      if (!/^https:\/\/[^/@]+(:(443|8443))?(\/|$)/.test(c.base_url) || /localhost|127\.|192\.168\./.test(c.base_url)) throw new ApiError(422, 'bad_url', 'That address is not allowed.')
      s.custom = { base_url: c.base_url, model: c.model, has_key: true }
    } else if (body.provider === 'ilmu') s.custom = { base_url: '', model: '', has_key: false }
    s = { ...s, mode: body.mode, provider: body.provider ?? s.provider, legacy: false, consent: body.mode === 'off' ? s.consent : { at: new Date().toISOString(), by: 'SAMPLE Owner', version: 1 } }
  }
  return view()
}

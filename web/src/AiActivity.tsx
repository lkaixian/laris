import { Async, useFetch } from './ui'
import { t, useLang } from './i18n'
import type { Text } from './i18n'

/* What the AI did (src/api/ai_activity.py). The owner sees every call in the business, anyone else only their own.
   Counts and timings only: the question, the answer and the hidden values are never stored. */
interface Call { at: string; kind: string; provider: 'ilmu' | 'custom'; ok: boolean; ms: number; masked: Record<string, number>; person: string | null }
interface Activity {
  scope: 'all' | 'own'; days: number
  totals: { calls: number; failed: number; median_ms: number; masked: Record<string, number> }
  by_kind: Record<string, number>; recent: Call[]
}

const S = {
  title: { en: 'AI activity', ms: 'Aktiviti AI' },
  all: { en: 'Every AI call in your business, last 30 days.', ms: 'Setiap panggilan AI dalam perniagaan anda, 30 hari lepas.' },
  own: { en: 'Your own AI calls, last 30 days.', ms: 'Panggilan AI anda sendiri, 30 hari lepas.' },
  note: { en: 'Only counts and times are kept. Your questions and the answers are not stored.', ms: 'Hanya kiraan dan masa disimpan. Soalan dan jawapan anda tidak disimpan.' },
  calls: { en: 'Calls', ms: 'Panggilan' }, failed: { en: 'Failed', ms: 'Gagal' }, median: { en: 'Typical time', ms: 'Masa biasa' },
  hidden: { en: 'Values hidden from the AI', ms: 'Nilai disembunyikan daripada AI' },
  when: { en: 'When', ms: 'Bila' }, what: { en: 'What', ms: 'Apa' }, who: { en: 'Who', ms: 'Siapa' }, result: { en: 'Result', ms: 'Hasil' },
  ok: { en: 'Answered', ms: 'Dijawab' }, bad: { en: 'Failed', ms: 'Gagal' }, none: { en: 'none', ms: 'tiada' },
  auto: { en: 'Customer chat', ms: 'Sembang pelanggan' }, tool: { en: 'AI tool key', ms: 'Kunci alat AI' },
  emptyT: { en: 'No AI calls yet', ms: 'Belum ada panggilan AI' },
  emptyH: { en: 'A row appears here each time the AI reads a message, a document or a question.', ms: 'Satu baris muncul di sini setiap kali AI membaca mesej, dokumen atau soalan.' },
} satisfies Record<string, Text>
const KIND: Record<string, Text> = {
  enquiry: { en: 'Customer enquiry', ms: 'Pertanyaan pelanggan' }, supplier_doc: { en: 'Supplier document', ms: 'Dokumen pembekal' },
  rfq_reply: { en: 'Supplier reply to an ask', ms: 'Balasan pembekal' }, availability: { en: 'Stock question', ms: 'Soalan stok' },
  assistant: { en: 'Assistant', ms: 'Pembantu' }, guide: { en: 'Guide', ms: 'Panduan' },
  ask: { en: 'Assistant, reading records', ms: 'Pembantu, membaca rekod' }, mcp: { en: 'AI tool search (MCP)', ms: 'Carian alat AI (MCP)' },
}
const MASK: Record<string, Text> = {
  EMAIL: { en: 'email', ms: 'emel' }, PHONE: { en: 'phone', ms: 'telefon' }, ID: { en: 'ID number', ms: 'nombor ID' },
  CARD: { en: 'card', ms: 'kad' }, NAME: { en: 'name', ms: 'nama' },
}

export function AiActivity() {
  const [lang] = useLang()
  const s = useFetch<Activity>('/ai/activity')
  const hide = (m: Record<string, number>) => Object.entries(m).map(([k, n]) => `${n} ${k in MASK ? t(MASK[k], lang) : k.toLowerCase()}`).join(', ') || t(S.none, lang)
  const d = s.data
  return (
    <section className="grid gap-3" aria-labelledby="ai-act-h">
      <div>
        <h2 id="ai-act-h" className="text-md font-semibold">{t(S.title, lang)}</h2>
        <p className="text-sm text-muted">{d ? t(d.scope === 'all' ? S.all : S.own, lang) : ''} {t(S.note, lang)}</p>
      </div>
      <Async s={s} empty={d?.totals.calls === 0} emptyText={t(S.emptyT, lang)} emptyHint={t(S.emptyH, lang)} rows={3}>
        {d && (<>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([[S.calls, String(d.totals.calls)], [S.failed, String(d.totals.failed)], [S.median, `${d.totals.median_ms} ms`], [S.hidden, hide(d.totals.masked)]] as const).map(([k, v]) => (
              <div key={k.en} className="card"><dt className="text-sm text-muted">{t(k, lang)}</dt><dd className="text-md font-semibold">{v}</dd></div>
            ))}
          </dl>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead><tr className="text-muted">
                <th scope="col" className="py-1 pr-3 font-semibold">{t(S.when, lang)}</th><th scope="col" className="py-1 pr-3 font-semibold">{t(S.what, lang)}</th>
                {d.scope === 'all' && <th scope="col" className="py-1 pr-3 font-semibold">{t(S.who, lang)}</th>}
                <th scope="col" className="py-1 pr-3 font-semibold">{t(S.result, lang)}</th><th scope="col" className="py-1 font-semibold">{t(S.hidden, lang)}</th>
              </tr></thead>
              <tbody>
                {d.recent.map((c, i) => (
                  <tr key={i} className="border-t border-soft align-top">
                    <td className="py-1.5 pr-3 tabular-nums">{new Date(c.at).toLocaleString()}</td>
                    <td className="py-1.5 pr-3">{c.kind in KIND ? t(KIND[c.kind], lang) : c.kind}</td>
                    {d.scope === 'all' && <td className="py-1.5 pr-3">{c.person ?? t(c.kind === 'mcp' ? S.tool : S.auto, lang)}</td>}
                    <td className="py-1.5 pr-3">{t(c.ok ? S.ok : S.bad, lang)} <span className="text-muted tabular-nums">{c.ms} ms</span></td>
                    <td className="py-1.5">{hide(c.masked)}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </>)}
      </Async>
    </section>
  )
}

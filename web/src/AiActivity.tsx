import { Async, useFetch } from './ui'
import { locale, t, useLang } from './i18n'
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
  title: { en: 'AI activity', ms: 'Aktiviti AI', zh: 'AI 活动', ta: 'AI செயல்பாடு' },
  all: { en: 'Every AI call in your business, last 30 days.', ms: 'Setiap panggilan AI dalam perniagaan anda, 30 hari lepas.', zh: '贵公司所有的 AI 调用，最近 30 天。', ta: 'உங்கள் வணிகத்தின் அனைத்து AI அழைப்புகள், கடந்த 30 நாட்கள்.' },
  own: { en: 'Your own AI calls, last 30 days.', ms: 'Panggilan AI anda sendiri, 30 hari lepas.', zh: '您自己的 AI 调用，最近 30 天。', ta: 'உங்கள் சொந்த AI அழைப்புகள், கடந்த 30 நாட்கள்.' },
  note: { en: 'Only counts and times are kept. Your questions and the answers are not stored.', ms: 'Hanya kiraan dan masa disimpan. Soalan dan jawapan anda tidak disimpan.', zh: '只保留次数和时间。您的问题和答案不会被存储。', ta: 'எண்ணிக்கையும் நேரமும் மட்டுமே வைக்கப்படும். உங்கள் கேள்விகளும் பதில்களும் சேமிக்கப்படாது.' },
  calls: { en: 'Calls', ms: 'Panggilan', zh: '调用次数', ta: 'அழைப்புகள்' }, failed: { en: 'Failed', ms: 'Gagal', zh: '失败', ta: 'தோல்வி' }, median: { en: 'Typical time', ms: 'Masa biasa', zh: '一般耗时', ta: 'வழக்கமான நேரம்' },
  hidden: { en: 'Values hidden from the AI', ms: 'Nilai disembunyikan daripada AI', zh: '对 AI 隐藏的内容', ta: 'AI இடமிருந்து மறைக்கப்பட்ட மதிப்புகள்' },
  when: { en: 'When', ms: 'Bila', zh: '时间', ta: 'எப்போது' }, what: { en: 'What', ms: 'Apa', zh: '内容', ta: 'என்ன' }, who: { en: 'Who', ms: 'Siapa', zh: '人员', ta: 'யார்' }, result: { en: 'Result', ms: 'Hasil', zh: '结果', ta: 'முடிவு' },
  ok: { en: 'Answered', ms: 'Dijawab', zh: '已回答', ta: 'பதிலளிக்கப்பட்டது' }, bad: { en: 'Failed', ms: 'Gagal', zh: '失败', ta: 'தோல்வி' }, none: { en: 'none', ms: 'tiada', zh: '无', ta: 'எதுவுமில்லை' },
  auto: { en: 'Customer chat', ms: 'Sembang pelanggan', zh: '客户聊天', ta: 'வாடிக்கையாளர் அரட்டை' }, tool: { en: 'AI tool key', ms: 'Kunci alat AI', zh: 'AI 工具密钥', ta: 'AI கருவி விசை' },
  emptyT: { en: 'No AI calls yet', ms: 'Belum ada panggilan AI', zh: '还没有 AI 调用', ta: 'இன்னும் AI அழைப்புகள் இல்லை' },
  emptyH: { en: 'A row appears here each time the AI reads a message, a document or a question.', ms: 'Satu baris muncul di sini setiap kali AI membaca mesej, dokumen atau soalan.', zh: '每当 AI 读取一条消息、一份文件或一个问题时，这里就会出现一行。', ta: 'AI ஒரு செய்தி, ஆவணம் அல்லது கேள்வியைப் படிக்கும் ஒவ்வொரு முறையும் இங்கே ஒரு வரி தோன்றும்.' },
} satisfies Record<string, Text>
const KIND: Record<string, Text> = {
  enquiry: { en: 'Customer enquiry', ms: 'Pertanyaan pelanggan', zh: '客户询价', ta: 'வாடிக்கையாளர் விசாரணை' }, supplier_doc: { en: 'Supplier document', ms: 'Dokumen pembekal', zh: '供应商文件', ta: 'சப்ளையர் ஆவணம்' },
  rfq_reply: { en: 'Supplier reply to an ask', ms: 'Balasan pembekal', zh: '供应商对询价的回复', ta: 'விசாரணைக்கு சப்ளையர் பதில்' }, availability: { en: 'Stock question', ms: 'Soalan stok', zh: '库存问题', ta: 'இருப்பு கேள்வி' },
  assistant: { en: 'Assistant', ms: 'Pembantu', zh: '助手', ta: 'உதவியாளர்' }, guide: { en: 'Guide', ms: 'Panduan', zh: '指引', ta: 'வழிகாட்டி' },
  ask: { en: 'Assistant, reading records', ms: 'Pembantu, membaca rekod', zh: '助手，读取记录', ta: 'உதவியாளர், பதிவுகளைப் படித்தல்' }, mcp: { en: 'AI tool search (MCP)', ms: 'Carian alat AI (MCP)', zh: 'AI 工具搜索 (MCP)', ta: 'AI கருவித் தேடல் (MCP)' },
}
const MASK: Record<string, Text> = {
  EMAIL: { en: 'email', ms: 'emel', zh: '电邮', ta: 'மின்னஞ்சல்' }, PHONE: { en: 'phone', ms: 'telefon', zh: '电话', ta: 'தொலைபேசி' }, ID: { en: 'ID number', ms: 'nombor ID', zh: '身份证号码', ta: 'அடையாள எண்' },
  CARD: { en: 'card', ms: 'kad', zh: '银行卡', ta: 'அட்டை' }, ACCT: { en: 'bank account', ms: 'akaun bank', zh: '银行账户', ta: 'வங்கிக் கணக்கு' }, NAME: { en: 'name', ms: 'nama', zh: '姓名', ta: 'பெயர்' },
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
                    <td className="py-1.5 pr-3 tabular-nums">{new Date(c.at).toLocaleString(locale(lang))}</td>
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

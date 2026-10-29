import { useState } from 'react'
import { EmptyState, PageHeader } from './ui'
import { LANGS, pick, t, useLang } from './i18n'
import type { Lang, Text } from './i18n'
import { ALL, txOr } from './strings'
import { ARTICLES, findArticle } from './help/articles'
import type { Article } from './help/articles'

const S = {
  title: { en: 'Help Center', ms: 'Pusat Bantuan', zh: '帮助中心', ta: 'உதவி மையம்' },
  desc: { en: 'Steps for every feature, in one place. Everyone sees the same articles.', ms: 'Langkah untuk setiap ciri, di satu tempat. Semua orang melihat artikel yang sama.', zh: '每项功能的步骤，集中在一处。每个人看到的文章都一样。', ta: 'ஒவ்வொரு அம்சத்துக்கும் படிகள், ஒரே இடத்தில். அனைவரும் ஒரே கட்டுரைகளைக் காண்பர்.' },
  search: { en: 'Search help', ms: 'Cari bantuan', zh: '搜索帮助', ta: 'உதவியைத் தேடு' },
  none: { en: 'No article matches that.', ms: 'Tiada artikel sepadan.', zh: '没有符合的文章。', ta: 'பொருந்தும் கட்டுரை இல்லை.' },
  noneHint: { en: 'Try a shorter word, or press Ctrl+K to search the whole app.', ms: 'Cuba perkataan lebih pendek, atau tekan Ctrl+K untuk mencari dalam seluruh aplikasi.', zh: '试试更短的词，或按 Ctrl+K 搜索整个应用。', ta: 'குறுகிய சொல்லை முயலவும், அல்லது முழுப் பயன்பாட்டிலும் தேட Ctrl+K ஐ அழுத்தவும்.' },
  missing: { en: 'No article with that name.', ms: 'Tiada artikel dengan nama itu.', zh: '没有该名称的文章。', ta: 'அந்தப் பெயரில் கட்டுரை இல்லை.' },
  all: { en: 'All help articles', ms: 'Semua artikel bantuan', zh: '所有帮助文章', ta: 'அனைத்து உதவிக் கட்டுரைகள்' },
  where: { en: 'Where to click', ms: 'Di mana untuk klik', zh: '在哪里点击', ta: 'எங்கே கிளிக் செய்வது' },
  related: { en: 'Related articles', ms: 'Artikel berkaitan', zh: '相关文章', ta: 'தொடர்புடைய கட்டுரைகள்' },
  ask: { en: 'Was something missing? Ask the owner or press Ctrl+K.', ms: 'Ada yang tertinggal? Tanya pemilik atau tekan Ctrl+K.', zh: '有遗漏吗？请询问负责人或按 Ctrl+K。', ta: 'ஏதேனும் விடுபட்டதா? உரிமையாளரிடம் கேளுங்கள் அல்லது Ctrl+K ஐ அழுத்தவும்.' },
  note: { en: 'Note', ms: 'Nota', zh: '备注', ta: 'குறிப்பு' },
  owner: { en: 'Owner', ms: 'Pemilik', zh: '负责人', ta: 'உரிமையாளர்' }, staff: { en: 'Staff', ms: 'Staf', zh: '员工', ta: 'ஊழியர்' },
} satisfies Record<string, Text>

// Segments of an article's "Where to click" path that are not sidebar or account-menu labels.
const SEG: Record<string, Text> = {
  Channels: { en: '', ms: 'Saluran', zh: '渠道', ta: 'சேனல்கள்' },
  'Account menu': { en: '', ms: 'Menu akaun', zh: '账户菜单', ta: 'கணக்கு மெனு' },
  Header: { en: '', ms: 'Pengepala', zh: '页眉', ta: 'தலைப்பு' },
  'Search or jump to...': { en: '', ms: 'Cari atau lompat ke...', zh: '搜索或跳转到...', ta: 'தேடு அல்லது செல்...' },
  'Open a quote': { en: '', ms: 'Buka sebut harga', zh: '打开报价', ta: 'விலைப்புள்ளியைத் திற' },
  'Link Telegram': { en: '', ms: 'Pautkan Telegram', zh: '绑定 Telegram', ta: 'Telegram ஐ இணை' },
  'Your customer bot': { en: '', ms: 'Bot pelanggan anda', zh: '您的客户机器人', ta: 'உங்கள் வாடிக்கையாளர் பாட்' },
  'How your bot talks to customers': { en: '', ms: 'Cara bot anda bercakap dengan pelanggan', zh: '机器人如何与客户交谈', ta: 'உங்கள் பாட் வாடிக்கையாளர்களிடம் எப்படிப் பேசுகிறது' },
}
// One path segment as the user sees it: the sidebar group or item name, the account-menu entry, or the table above; the English text otherwise.
const seg = (x: string, l: Lang) => {
  const k = Object.keys(ALL).find(k => /^(nav|user)\.[a-z]+$/.test(k) && ALL[k].en === x)
  return (k && txOr(k, x)) || txOr(`nav.group.${x}`, '') || (SEG[x] && t(SEG[x], l)) || x
}

const hay = (a: Article, l: Lang) => [pick(a.title, l), pick(a.summary, l), ...pick(a.keywords, l)].join(' ').toLowerCase()
// Every word typed must appear in the title, summary or keywords, in any of the four languages.
const matches = (a: Article, q: string) => q.toLowerCase().split(/\s+/).filter(Boolean).every(w => LANGS.some(l => hay(a, l[0]).includes(w)))

const Who = ({ a, lang }: { a: Article; lang: Lang }) => <>{a.who.map(w => <span key={w} className="badge">{t(S[w], lang)}</span>)}</>

function Index({ lang }: { lang: Lang }) {
  const [q, setQ] = useState('')
  const list = q.trim() ? ARTICLES.filter(a => matches(a, q)) : ARTICLES
  return (
    <>
      <PageHeader title={t(S.title, lang)} description={t(S.desc, lang)} />
      <label className="mb-4 flex max-w-xl flex-col gap-1 text-sm font-semibold">{t(S.search, lang)}
        <input type="search" className="input font-normal" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      <p role="status" className="sr-only">{q.trim() ? `${list.length}` : ''}</p>
      {list.length === 0 ? <EmptyState title={t(S.none, lang)} hint={t(S.noneHint, lang)} /> : (
        <ul className="grid max-w-3xl gap-2">
          {list.map(a => (
            <li key={a.id} className="card">
              <h2 className="text-base font-semibold"><a className="link" href={`#/help/${a.id}`}>{t(a.title, lang)}</a></h2>
              <p className="mt-1 text-sm text-muted">{t(a.summary, lang)}</p>
              <p className="mt-2 flex flex-wrap gap-2"><Who a={a} lang={lang} /></p>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function ArticleView({ a, lang }: { a: Article; lang: Lang }) {
  const rel = a.related.map(findArticle).filter((x): x is Article => !!x)
  return (
    <>
      <PageHeader back={{ href: '#/help', label: t(S.all, lang) }} title={t(a.title, lang)} description={t(a.summary, lang)} meta={<Who a={a} lang={lang} />} />
      <article className="grid max-w-2xl gap-4">
        <p className="text-sm"><span className="font-semibold">{t(S.where, lang)}: </span>{a.path.map(x => seg(x, lang)).join(' > ')}</p>
        {a.body.map((b, i) => 'steps' in b
          ? <ol key={i} className="list-decimal space-y-2 pl-5">{b.steps.map((s, j) => <li key={j}>{t(s, lang)}</li>)}</ol>
          : 'note' in b
            ? <p key={i} className="rounded-ui border border-line bg-tint p-3 text-sm"><strong>{t(S.note, lang)}: </strong>{t(b.note, lang)}</p>
            : <p key={i}>{t(b.p, lang)}</p>)}
        {rel.length > 0 && (
          <section aria-labelledby="rel">
            <h2 id="rel" className="mb-1 text-base font-semibold">{t(S.related, lang)}</h2>
            <ul className="grid gap-1">{rel.map(r => <li key={r.id}><a className="link inline-flex min-h-11 items-center" href={`#/help/${r.id}`}>{t(r.title, lang)}</a></li>)}</ul>
          </section>
        )}
        <p className="text-sm text-muted">{t(S.ask, lang)}</p>
      </article>
    </>
  )
}

export function HelpView({ arg }: { arg?: string }) {
  const [lang] = useLang()
  if (!arg) return <Index lang={lang} />
  const a = findArticle(arg)
  if (a) return <ArticleView a={a} lang={lang} />
  return (
    <>
      <PageHeader title={t(S.title, lang)} />
      <EmptyState title={t(S.missing, lang)} action={{ label: t(S.all, lang), href: '#/help' }} />
    </>
  )
}

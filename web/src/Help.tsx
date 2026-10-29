import { useState } from 'react'
import { EmptyState, PageHeader } from './ui'
import { pick, t, useLang } from './i18n'
import type { Lang, Text } from './i18n'
import { ARTICLES, findArticle } from './help/articles'
import type { Article } from './help/articles'

const S = {
  title: { en: 'Help Center', ms: 'Pusat Bantuan' },
  desc: { en: 'Steps for every feature, in one place. Everyone sees the same articles.', ms: 'Langkah untuk setiap ciri, di satu tempat. Semua orang melihat artikel yang sama.' },
  search: { en: 'Search help', ms: 'Cari bantuan' },
  none: { en: 'No article matches that.', ms: 'Tiada artikel sepadan.' },
  noneHint: { en: 'Try a shorter word, or press Ctrl+K to search the whole app.', ms: 'Cuba perkataan lebih pendek, atau tekan Ctrl+K untuk mencari dalam seluruh aplikasi.' },
  missing: { en: 'No article with that name.', ms: 'Tiada artikel dengan nama itu.' },
  all: { en: 'All help articles', ms: 'Semua artikel bantuan' },
  where: { en: 'Where to click', ms: 'Di mana untuk klik' },
  related: { en: 'Related articles', ms: 'Artikel berkaitan' },
  ask: { en: 'Was something missing? Ask the owner or press Ctrl+K.', ms: 'Ada yang tertinggal? Tanya pemilik atau tekan Ctrl+K.' },
  note: { en: 'Note', ms: 'Nota' },
  owner: { en: 'Owner', ms: 'Pemilik' }, staff: { en: 'Staff', ms: 'Staf' },
} satisfies Record<string, Text>

const hay = (a: Article, l: Lang) => [pick(a.title, l), pick(a.summary, l), ...pick(a.keywords, l)].join(' ').toLowerCase()
// Every word typed must appear in the title, summary or keywords, in the current language or the other one.
const matches = (a: Article, q: string) => q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay(a, 'en').includes(w) || hay(a, 'ms').includes(w))

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
        <p className="text-sm"><span className="font-semibold">{t(S.where, lang)}: </span>{a.path.join(' > ')}</p>
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

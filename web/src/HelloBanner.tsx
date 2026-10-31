// The robot's sign-in greeting. It sits in the page flow (in the banner slot, like the other notices) and pushes the page down,
// so it never covers anything. The round robot in the corner still hops and waves.
import { useEffect, useState } from 'react'
import { t } from './i18n'
import type { Text } from './i18n'
import { hasGuide, startGuide } from './Guide'

export const HELLO_EVENT = 'laris:hello', OPEN_ASK_EVENT = 'laris:open-ask'
const page = () => (location.hash.split('/')[1] || 'home').split('?')[0]
const S: Record<string, Text> = {
  hi: { en: 'Hi {name}! I am Laris. I am here to help you.', ms: 'Hai {name}! Saya Laris. Saya di sini untuk membantu anda.', zh: '您好，{name}！我是 Laris，我来帮您。', ta: 'வணக்கம் {name}! நான் Laris. உங்களுக்கு உதவ இங்கே இருக்கிறேன்.' },
  sub: { en: 'Ask me anything, or let me show you around.', ms: 'Tanya saya apa-apa, atau biar saya tunjukkan.', zh: '有问题尽管问我，或让我带您逛逛。', ta: 'எதையும் கேளுங்கள், அல்லது சுற்றிக் காட்டுகிறேன்.' },
  tour: { en: 'Show me around', ms: 'Tunjukkan saya', zh: '带我逛逛', ta: 'சுற்றிக் காட்டு' }, ask: { en: 'Ask a question', ms: 'Tanya soalan', zh: '提问', ta: 'கேள்வி கேள்' },
  no: { en: 'Not now', ms: 'Bukan sekarang', zh: '以后再说', ta: 'இப்போது வேண்டாம்' }, close: { en: 'Close', ms: 'Tutup', zh: '关闭', ta: 'மூடு' },
}
export function HelloBanner() {
  const [name, setName] = useState('')
  useEffect(() => {
    const on = (e: Event) => setName(String((e as CustomEvent).detail ?? ''))
    addEventListener(HELLO_EVENT, on); return () => removeEventListener(HELLO_EVENT, on)
  }, [])
  useEffect(() => { if (!name) return; const id = setTimeout(() => setName(''), 20000); return () => clearTimeout(id) }, [name])
  if (!name) return null
  const done = () => setName('')
  return (
    <div role="status" className="hello-bar">
      <img src="./brand/laris-bot.png" alt="" width="32" height="40" className="hello-img" />
      <p className="hello-text"><b>{t(S.hi).replace('{name}', name)}</b> <span className="text-muted">{t(S.sub)}</span></p>
      <div className="hello-acts">
        <button type="button" className="btn btn-primary" onClick={() => { done(); if (hasGuide(page())) startGuide(page()); else dispatchEvent(new Event(OPEN_ASK_EVENT)) }}>{t(S.tour)}</button>
        <button type="button" className="btn" onClick={() => { done(); dispatchEvent(new Event(OPEN_ASK_EVENT)) }}>{t(S.ask)}</button>
        <button type="button" className="btn" onClick={done}>{t(S.no)}</button>
      </div>
      <button type="button" className="hello-x" aria-label={t(S.close)} onClick={done}><span aria-hidden="true">×</span></button>
    </div>
  )
}

// Tiny Chrome DevTools driver for click-through checks (Edge or Chrome, headless). Node 22+ (global WebSocket).
// import { launch } from './cdp.mjs'; const b = await launch(); await b.goto(url); await b.eval('...'); await b.shot('x.png'); await b.close()
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function launch({ width = 1100, height = 800, port = 9333, scheme = 'light' } = {}) {
  const proc = spawn(EXE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-'))}`,
    `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' })
  let list
  for (let i = 0; i < 50 && !list; i++) { await sleep(200); try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json() } catch { /* not up yet */ } }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl)
  await new Promise(r => (ws.onopen = r))
  let id = 0; const pending = new Map(); const errors = []
  ws.onmessage = m => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) { const { res, rej } = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result) }
    else if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text)
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map(a => a.value ?? a.description).join(' '))
  }
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) })
  await send('Page.enable'); await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
  const b = {
    errors,
    async goto(url) { await send('Page.navigate', { url }); await sleep(700) },
    async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed'); return r.result.value },
    async waitFor(expr, ms = 5000) { const t = Date.now(); while (Date.now() - t < ms) { if (await b.eval(expr)) return true; await sleep(100) } throw new Error('timeout waiting for: ' + expr) },
    // click the first element whose visible text or aria-label contains `text` (tag defaults to button/a)
    async click(text, sel = 'button,a,summary') { await b.eval(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => (x.innerText || x.getAttribute('aria-label') || '').includes(${JSON.stringify(text)})); if (!e) throw new Error('no element: ${text.replace(/'/g, '')}'); e.click() })()`); await sleep(400) },
    async type(label, value) { await b.eval(`(() => { const l = [...document.querySelectorAll('label')].find(x => x.innerText.trim().startsWith(${JSON.stringify(label)})); const i = l.querySelector('input,textarea,select'); const set = Object.getOwnPropertyDescriptor(i.constructor.prototype, 'value').set; set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event(i.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })()`); await sleep(150) },
    text: () => b.eval('document.body.innerText'),
    overflowX: () => b.eval('document.documentElement.scrollWidth > document.documentElement.clientWidth'),
    async shot(path) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path, Buffer.from(r.data, 'base64')) },
    async close() { try { ws.close() } catch { /* already closed */ } proc.kill() },
  }
  return b
}

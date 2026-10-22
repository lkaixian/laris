// Accessibility sweep with axe-core in headless Edge/Chrome, against a running app with sign-in accounts.
//   BASE=http://localhost:5055 A11Y_USER=boss A11Y_PASS='...' node scripts/a11y.mjs [page ...]
// Exit code 1 when any page has a violation. Not part of CI (needs a seeded server and a browser).
import { readFileSync } from 'node:fs'
import { launch } from './cdp.mjs'

const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8')
const base = (process.env.BASE || 'http://localhost:5055').replace(/\/$/, '') + '/'
const pages = process.argv.slice(2).length ? process.argv.slice(2)
  : ['home', 'alerts', 'tracker', 'contacts', 'jobs', 'assistant', 'activity', 'team', 'settings', 'account', 'search/acrylic']
let bad = 0
for (const scheme of ['light', 'dark']) {
  const b = await launch({ width: 1100, scheme, port: scheme === 'dark' ? 9341 : 9340 })
  const check = async name => {
    await b.eval('new Promise(r => setTimeout(r, 800))'); await b.eval(AXE)
    const v = await b.eval("axe.run().then(r => r.violations.map(v => v.id + ' (' + v.impact + '): ' + v.nodes.length + ' ' + v.nodes[0].target.join(' ')))")
    if (v.length) bad++
    console.log(scheme.padEnd(5), name.padEnd(18), v.length ? v : 'no violations')
  }
  await b.goto(base)
  await b.waitFor("document.body.innerText.includes('Sign in')")
  await check('sign-in')
  await b.type('Username', process.env.A11Y_USER); await b.type('Password', process.env.A11Y_PASS)
  await b.click('Sign in', 'button[type=submit]')
  await b.waitFor("document.body.innerText.includes('Sign out')")
  for (const p of pages) { await b.goto(base + '#/' + p); await check(p) }
  await b.close()
}
process.exit(bad ? 1 : 0)

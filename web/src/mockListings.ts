// SAMPLE listings (catalog photos) for mock mode. Photo and crops are generated SVG data URLs, so no assets are needed.
import { ApiError } from './api'

const svg = (w: number, h: number, body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)}`
const COLORS = ['#e8dcc8', '#d6d9e0', '#e3c9c0', '#cfe0cf', '#ead9a8', '#c9d8e6']
const NAMES = ['ballet flat, cream', 'brass buckle 25mm', 'canvas tote, navy', 'leather belt, tan', 'hair clip set', 'rubber sole sheet']
const bbox = (i: number): [number, number, number, number] => { const c = i % 3, r = Math.floor(i / 3); return [0.03 + c * 0.32, 0.04 + r * 0.48, 0.03 + c * 0.32 + 0.29, 0.04 + r * 0.48 + 0.44] }
const photo = svg(600, 400, `<rect width="600" height="400" fill="#f7f3ea"/>${COLORS.map((c, i) => { const [a, b, x, y] = bbox(i); return `<rect x="${a * 600}" y="${b * 400}" width="${(x - a) * 600}" height="${(y - b) * 400}" fill="${c}"/><text x="${a * 600 + 8}" y="${y * 400 - 10}" font-size="16" font-family="sans-serif">${NAMES[i]}</text>` }).join('')}`)

const item = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `li${i + 1}`, position: i + 1, description: NAMES[i], labels: [['RM 18', 'Size 36-40'], ['黄铜扣 25mm'], ['Beg kanvas', 'Biru laut'], ['Tali pinggang kulit'], [], ['Getah 3mm']][i],
  sku: `SKU-${100 + i}`, sizes: [['36', '37', '38', '39', '40'], ['25mm'], [], ['M', 'L'], [], []][i], price: (12 + i * 3).toFixed(2), currency: 'MYR', bbox: bbox(i),
  status: 'needs_review', reasons: [] as string[], item_key: null, stock_qty: null as string | null,
  category: ['Footwear', 'Hardware', null, 'Belts', null, null][i] as string | null, category_suggestion: [null, null, 'Bags', null, 'Hair accessories', 'Rubber'][i] as string | null,
  price_tiers: [] as { size: string | null; min_qty: string; price: string }[], crop_url: svg(160, 120, `<rect width="160" height="120" fill="${COLORS[i]}"/><text x="8" y="64" font-size="14" font-family="sans-serif">${NAMES[i]}</text>`), ...extra,
})
const make = (id: string, minsAgo: number) => ({
  id, party_id: 'p4', party_name: 'SAMPLE Supplier B Footwear (synthetic)', note: 'Spring page 3', source_channel: 'web',
  created_at: new Date(Date.now() - minsAgo * 6e4).toISOString(), image_url: photo,
  items: [item(0), item(1, { sku: 'BK-25-B', reasons: ['unverified_sku', 'no_ocr_check'] }), item(2, { price: null }), item(3, { status: 'confirmed', item_key: 'leather_belt', stock_qty: '14.000',
    price_tiers: [{ size: null, min_qty: '10', price: '19.50' }, { size: 'L', min_qty: '1', price: '23.00' }] }), item(4, { status: 'confirmed', stock_qty: '0.000' }), item(5)],
})
const CATS = ['Footwear', 'Hardware', 'Bags', 'Belts', 'Hardware', 'Rubber']  // what the pretend photo reader proposes
// ?catalog=shapes adds a very tall photo and a photo with 40 products, to check that the dialog and review buttons stay reachable.
const tall = svg(900, 2600, `<rect width="900" height="2600" fill="#f7f3ea"/><text x="40" y="1300" font-size="60" font-family="sans-serif">tall phone photo</text>`)
const shapes = new URLSearchParams(location.search).get('catalog') === 'shapes'
const listings = [make('lst-1', 90), ...(shapes ? [{ ...make('lst-tall', 30), image_url: tall, note: 'Tall photo' },
  { ...make('lst-many', 60), note: '40 products', items: Array.from({ length: 40 }, (_, i) => ({ ...item(i % 6), id: `lm${i}`, position: i + 1 })) }] : [])]

// The product side (src/api/catalog.py): search, the business's categories, moving products, confirming suggestions.
const extraCats = new Set<string>()
const near = (g: string, cats: string[]) => cats.find(c => c.toLowerCase() === g.toLowerCase()) ?? cats.find(c => c.toLowerCase().replace(/s$/, '') === g.toLowerCase().replace(/s$/, ''))
const allItems = () => listings.flatMap(l => l.items.map((i: any) => ({ ...i, listing_id: l.id }))).filter((i: any) => i.status !== 'discarded')
const catNames = () => [...new Set([...extraCats, ...allItems().map((i: any) => i.category).filter(Boolean)])].sort()
function catalogMock(method: string, p: string, body: any): unknown {
  if (p.startsWith('/catalog/items?') && method === 'GET') {
    const q = new URLSearchParams(p.split('?')[1])
    const s = (q.get('q') ?? '').toLowerCase(), cat = q.get('category')
    return allItems().filter((i: any) => (!s || [i.description, i.sku, i.category, ...(i.labels ?? [])].join(' ').toLowerCase().includes(s))
      && (!cat || i.category?.toLowerCase() === cat.toLowerCase()) && (q.get('uncategorised') !== 'true' || !i.category) && (q.get('suggested') !== 'true' || (i.category_suggestion && !i.category)))
  }
  if (p === '/catalog/categories' && method === 'GET') {
    const its = allItems()
    return { categories: catNames().map(name => ({ name, count: its.filter((i: any) => i.category === name).length })), total: its.length, uncategorised: its.filter((i: any) => !i.category).length }
  }
  if (p === '/catalog/categories' && method === 'POST') { const n = String(body.name ?? '').trim(); if (!n) throw new ApiError(422, 'bad_name', 'a category needs a name'); extraCats.add(near(n, catNames()) ?? n); return { name: n } }
  if (p === '/catalog/categories/rename' && method === 'POST') {
    let moved = 0
    allItems().forEach((i: any) => { const it = listings.flatMap(l => l.items).find((x: any) => x.id === i.id) as any; if (it.category === body.old) { it.category = body.new; moved++ } })
    extraCats.delete(body.old); extraCats.add(body.new); return { name: body.new, moved }
  }
  if (p === '/catalog/categories/delete' && method === 'POST') {
    let n = 0
    listings.flatMap(l => l.items).forEach((it: any) => { if (it.category === body.name) { it.category = null; n++ } })
    extraCats.delete(body.name); return { uncategorised: n }
  }
  if (p === '/catalog/items/move' && method === 'POST') {
    const cat = String(body.category ?? '').trim() || null
    const use = cat ? near(cat, catNames()) ?? cat : null
    if (use) extraCats.add(use)
    let moved = 0
    listings.flatMap(l => l.items).forEach((it: any) => { if (body.item_ids.includes(it.id)) { it.category = use; it.category_suggestion = null; moved++ } })
    return { moved, category: use }
  }
  if (p === '/catalog/items/accept-suggestions' && method === 'POST') {
    let accepted = 0
    listings.flatMap(l => l.items).forEach((it: any) => { if (body.item_ids.includes(it.id) && it.category_suggestion) { extraCats.add(it.category_suggestion); it.category = it.category_suggestion; it.category_suggestion = null; accepted++ } })
    return { accepted }
  }
  return undefined
}

// Returns undefined when the path is not a listings route.
export function mockListings(method: string, p: string, owner: boolean, body: any): unknown {
  let m: RegExpMatchArray | null
  if (p.startsWith('/catalog')) return catalogMock(method, p, body)
  const view = (l: ReturnType<typeof make>) => ({ ...l, items: l.items.map(i => (owner ? i : { ...i, price: null, currency: null, price_tiers: [] })) })
  const find = (id: string) => { const l = listings.find(x => x.id === id); if (!l) throw new ApiError(404, 'not_found', 'Listing not found.'); return l }
  if (p === '/listings' && method === 'POST') {
    if (!(body.get('image') instanceof Blob)) throw new ApiError(422, 'image_required', 'image is required')
    const l = make(`lst-${listings.length + 1}`, 0)
    const mode = body.get('categorize') ?? 'suggest'
    l.items.forEach((i: any, k) => { const guess = CATS[k]; if (mode === 'auto') i.category = guess; else if (mode === 'suggest') i.category_suggestion = guess })
    listings.unshift(l)
    return { listing_id: l.id, item_count: l.items.length, items: view(l).items }
  }
  if (p === '/listings' && method === 'GET') return listings.map(l => ({ id: l.id, party_id: l.party_id, party_name: l.party_name, note: l.note, source_channel: l.source_channel, created_at: l.created_at, image_url: l.image_url, thumb_url: l.image_url, items: l.items.length, to_review: l.items.filter(i => i.status === 'needs_review').length }))
  if ((m = p.match(/^\/listings\/([^/]+)\/items\/([^/]+)\/cutout$/)) && (method === 'POST' || method === 'DELETE')) {
    const it: any = find(m[1]).items.find(x => x.id === m![2])
    if (!it) throw new ApiError(404, 'not_found', 'Item not found.')
    it.cutout_url = method === 'POST' ? URL.createObjectURL(body.get('file')) : null  // a blob URL: mock images are shown as they are
    return { cutout_url: it.cutout_url }
  }
  if (p === '/listings/categories' && method === 'GET') return [...new Set(listings.flatMap(l => l.items.map((i: any) => i.category).filter(Boolean)))].sort()
  if ((m = p.match(/^\/listings\/([^/]+)$/)) && method === 'GET') return view(find(m[1]))
  if ((m = p.match(/^\/listings\/([^/]+)\/items\/([^/]+)$/)) && method === 'PATCH') {
    const it: any = find(m[1]).items.find(x => x.id === m![2])
    if (!it) throw new ApiError(404, 'not_found', 'Item not found.')
    if ((body.price !== undefined || body.price_tiers !== undefined) && !owner) throw new ApiError(403, 'forbidden', 'Changing the price needs cost access.')
    if (body.stock_qty !== undefined && body.stock_qty !== null && !(Number(body.stock_qty) >= 0)) throw new ApiError(422, 'validation', 'stock_qty must be 0 or more')
    const sizes: string[] = (body.sizes ?? it.sizes).map((s: string) => s.toLowerCase())
    const tiers = (body.price_tiers ?? (body.sizes ? it.price_tiers : [])) as { size: string | null }[]
    const bad = tiers.find(t => t.size && !sizes.includes(t.size.toLowerCase()))
    if (bad) throw new ApiError(422, 'bad_tier', `size '${bad.size}' is not one of this product's sizes; add it to sizes first`)
    Object.assign(it, body)
    if ('category' in body) { it.category = (body.category ?? '').trim() || null; it.category_suggestion = null }
    if (body.price_tiers !== undefined) it.price_tiers = (body.price_tiers ?? []).map((t: any) => ({ size: t.size ?? null, min_qty: String(Number(t.min_qty ?? 1)), price: String(Number(t.price)) }))
    if (body.stock_qty !== undefined) it.stock_qty = body.stock_qty === null ? null : Number(body.stock_qty).toFixed(3)
    if (body.price !== undefined) it.price = Number(body.price).toFixed(2)
    return it
  }
  if ((m = p.match(/^\/listings\/([^/]+)\/items\/([^/]+)\/ask$/)) && method === 'POST') {
    find(m[1])
    return { rfq_id: 'rfq-mock', sends: (body.supplier_ids as string[]).map((s, i) => ({ supplier_id: s, status: i === 1 ? 'failed' : 'sent', error: i === 1 ? 'SAMPLE: no WhatsApp number on file' : null })) }
  }
  return undefined
}

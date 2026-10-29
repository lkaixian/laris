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
  price_tiers: [] as { size: string | null; min_qty: string; price: string }[], crop_url: svg(160, 120, `<rect width="160" height="120" fill="${COLORS[i]}"/><text x="8" y="64" font-size="14" font-family="sans-serif">${NAMES[i]}</text>`), ...extra,
})
const make = (id: string, minsAgo: number) => ({
  id, party_id: 'p4', party_name: 'SAMPLE Supplier B Footwear (synthetic)', note: 'Spring page 3', source_channel: 'web',
  created_at: new Date(Date.now() - minsAgo * 6e4).toISOString(), image_url: photo,
  items: [item(0), item(1, { sku: 'BK-25-B', reasons: ['unverified_sku', 'no_ocr_check'] }), item(2, { price: null }), item(3, { status: 'confirmed', item_key: 'leather_belt', stock_qty: '14.000',
    price_tiers: [{ size: null, min_qty: '10', price: '19.50' }, { size: 'L', min_qty: '1', price: '23.00' }] }), item(4, { status: 'confirmed', stock_qty: '0.000' }), item(5)],
})
const listings = [make('lst-1', 90)]

// Returns undefined when the path is not a listings route.
export function mockListings(method: string, p: string, owner: boolean, body: any): unknown {
  let m: RegExpMatchArray | null
  const view = (l: ReturnType<typeof make>) => ({ ...l, items: l.items.map(i => (owner ? i : { ...i, price: null, currency: null, price_tiers: [] })) })
  const find = (id: string) => { const l = listings.find(x => x.id === id); if (!l) throw new ApiError(404, 'not_found', 'Listing not found.'); return l }
  if (p === '/listings' && method === 'POST') {
    if (!(body.get('image') instanceof Blob)) throw new ApiError(422, 'image_required', 'image is required')
    const l = make(`lst-${listings.length + 1}`, 0)
    listings.unshift(l)
    return { listing_id: l.id, item_count: l.items.length, items: view(l).items }
  }
  if (p === '/listings' && method === 'GET') return listings.map(l => ({ id: l.id, party_id: l.party_id, party_name: l.party_name, note: l.note, source_channel: l.source_channel, created_at: l.created_at, image_url: l.image_url, thumb_url: l.image_url, items: l.items.length, to_review: l.items.filter(i => i.status === 'needs_review').length }))
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

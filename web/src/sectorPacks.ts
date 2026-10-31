// Sector packs: one declarative object per kind of business. Adding a sector means adding an object here; no page needs to change.
// What a pack changes today: the words (terminology), which documents the chain offers, the deposit and tax defaults, the home hints,
// the hero workflow shown on the Deals page and the sample lines for a new order. Roadmap (not built): per-sector dashboards, catalogue
// fields, appointment books, BOQ quotes and the other sectors in the brief.
import { useEffect, useState } from 'react'
import { getLang } from './i18n'

export type DocKind = 'cpo' | 'so' | 'pf' | 'do' | 'inv' | 'rcp' | 'spo' | 'grn'
type L = { en: string; ms: string }
export interface SectorPack {
  id: string
  name: L
  tagline: L
  accent: string                       // a dot or border colour only, never text, so contrast holds in both themes
  terms: { customer: L; order: L; item: L; delivery: L }
  docs: DocKind[]                      // which documents the chain offers this business
  docNames?: Partial<Record<DocKind, L>>  // a sector's own name for a document
  defaults: { depositPct: number; sstRate: number; round5: boolean; creditDays: number }
  kpis: { id: 'open' | 'deposits' | 'approval' | 'owed'; label: L }[]
  workflow: { trigger: L; data: L; rules: L; approval: L; outcome: L }  // the five-step journey, in this sector's words
  quickActions: { to: DocKind; label: L }[]
  sampleLines: { description: string; qty: number; uom: string; unit_price: number }[]
  questions: { id: string; text: L; enables: DocKind[] }[]
}

export const PACKS: SectorPack[] = [
  {
    id: 'catering', name: { en: 'Food and beverage: Catering', ms: 'Makanan dan minuman: Katering' },
    tagline: { en: 'Event quotes by head count, deposits to confirm, ingredients to order.', ms: 'Sebut harga acara ikut bilangan pax, deposit untuk sahkan, bahan untuk dibeli.' },
    accent: '#0f766e',
    terms: { customer: { en: 'Client', ms: 'Pelanggan' }, order: { en: 'Event booking', ms: 'Tempahan acara' }, item: { en: 'Menu package', ms: 'Pakej menu' }, delivery: { en: 'Event delivery', ms: 'Penghantaran acara' } },
    docs: ['cpo', 'so', 'pf', 'do', 'inv', 'rcp', 'spo'],
    docNames: { so: { en: 'Event Booking', ms: 'Tempahan Acara' }, pf: { en: 'Deposit Request', ms: 'Permintaan Deposit' }, do: { en: 'Event Run-sheet Delivery Order', ms: 'Pesanan Penghantaran Acara' } },
    defaults: { depositPct: 30, sstRate: 0, round5: true, creditDays: 14 },
    kpis: [{ id: 'open', label: { en: 'Upcoming events', ms: 'Acara akan datang' } }, { id: 'deposits', label: { en: 'Deposits pending', ms: 'Deposit belum terima' } },
      { id: 'approval', label: { en: 'Needs approval', ms: 'Perlu kelulusan' } }, { id: 'owed', label: { en: 'Still owed', ms: 'Masih terhutang' } }],
    workflow: {
      trigger: { en: 'A client messages "need lunch for 120 pax, 14 Dec"', ms: 'Pelanggan mesej "perlu makan tengah hari 120 pax, 14 Dis"' },
      data: { en: 'Menu packages, per-head prices and the client\'s past bookings', ms: 'Pakej menu, harga seorang dan tempahan lepas pelanggan' },
      rules: { en: 'Pax x per-head price, halal and dietary add-ons, 30% deposit to confirm', ms: 'Pax x harga seorang, tambahan halal dan diet, deposit 30% untuk sahkan' },
      approval: { en: 'Owner approves quotes and any supplier PO for ingredients', ms: 'Pemilik meluluskan sebut harga dan PO pembekal untuk bahan' },
      outcome: { en: 'Booking confirmed, deposit receipt, ingredient PO draft, entry in the audit log', ms: 'Tempahan disahkan, resit deposit, draf PO bahan, rekod dalam log audit' },
    },
    quickActions: [{ to: 'so', label: { en: 'New event booking', ms: 'Tempahan acara baharu' } }, { to: 'spo', label: { en: 'Order ingredients', ms: 'Pesan bahan' } }],
    sampleLines: [{ description: 'Nasi minyak set (per pax)', qty: 120, uom: 'pax', unit_price: 18 }, { description: 'Air sirap and teh tarik', qty: 120, uom: 'pax', unit_price: 2.5 }, { description: 'Setup and serving crew', qty: 1, uom: 'event', unit_price: 350 }],
    questions: [{ id: 'deposit', text: { en: 'Do you take a deposit to confirm events?', ms: 'Adakah anda ambil deposit untuk sahkan acara?' }, enables: ['pf'] },
      { id: 'deliver', text: { en: 'Do you deliver to the venue?', ms: 'Adakah anda hantar ke tempat acara?' }, enables: ['do'] },
      { id: 'suppliers', text: { en: 'Do you buy ingredients from suppliers?', ms: 'Adakah anda beli bahan daripada pembekal?' }, enables: ['spo'] }],
  },
  {
    id: 'salon', name: { en: 'Services: Beauty and personal care', ms: 'Perkhidmatan: Kecantikan dan penjagaan diri' },
    tagline: { en: 'Services and packages, paid at the chair. Invoices and receipts first.', ms: 'Perkhidmatan dan pakej, bayar di kaunter. Invois dan resit diutamakan.' },
    accent: '#a1457a',
    terms: { customer: { en: 'Guest', ms: 'Tetamu' }, order: { en: 'Appointment', ms: 'Temujanji' }, item: { en: 'Service', ms: 'Perkhidmatan' }, delivery: { en: 'Service done', ms: 'Perkhidmatan selesai' } },
    docs: ['so', 'pf', 'inv', 'rcp', 'spo'],
    docNames: { so: { en: 'Appointment', ms: 'Temujanji' }, pf: { en: 'Package Deposit', ms: 'Deposit Pakej' }, spo: { en: 'Product Restock PO', ms: 'PO Stok Produk' } },
    defaults: { depositPct: 50, sstRate: 6, round5: true, creditDays: 0 },
    kpis: [{ id: 'open', label: { en: 'Appointments booked', ms: 'Temujanji ditempah' } }, { id: 'deposits', label: { en: 'Package deposits pending', ms: 'Deposit pakej belum terima' } },
      { id: 'approval', label: { en: 'Needs approval', ms: 'Perlu kelulusan' } }, { id: 'owed', label: { en: 'Unpaid bills', ms: 'Bil belum bayar' } }],
    workflow: {
      trigger: { en: 'A guest messages "cut and colour Saturday afternoon?"', ms: 'Tetamu mesej "potong dan warna petang Sabtu?"' },
      data: { en: 'Service menu with durations, stylist availability, visit history', ms: 'Menu perkhidmatan dengan tempoh, kekosongan stylist, sejarah lawatan' },
      rules: { en: 'Service price x stylist time, package bundles, no-show deposit', ms: 'Harga perkhidmatan x masa stylist, pakej, deposit tidak hadir' },
      approval: { en: 'Staff book; the owner approves discounts and voids a receipt', ms: 'Staf menempah; pemilik meluluskan diskaun dan membatalkan resit' },
      outcome: { en: 'Appointment held, receipt on payment, rebook reminder draft', ms: 'Temujanji disimpan, resit semasa bayaran, draf peringatan tempah semula' },
    },
    quickActions: [{ to: 'so', label: { en: 'New appointment', ms: 'Temujanji baharu' } }, { to: 'inv', label: { en: 'Bill a guest', ms: 'Bil tetamu' } }],
    sampleLines: [{ description: 'Cut and blow dry', qty: 1, uom: 'visit', unit_price: 55 }, { description: 'Hair colour (short)', qty: 1, uom: 'visit', unit_price: 180 }, { description: 'Treatment add-on', qty: 1, uom: 'visit', unit_price: 45 }],
    questions: [{ id: 'package', text: { en: 'Do you sell prepaid packages?', ms: 'Adakah anda jual pakej prabayar?' }, enables: ['pf'] },
      { id: 'retail', text: { en: 'Do you restock retail products?', ms: 'Adakah anda tambah stok produk runcit?' }, enables: ['spo'] }],
  },
  {
    id: 'general', name: { en: 'General business', ms: 'Perniagaan am' },
    tagline: { en: 'The full quote-to-cash chain with plain words. Use this if your trade is not listed.', ms: 'Rantaian sebut harga hingga bayaran penuh dengan bahasa mudah. Guna jika bidang anda tiada dalam senarai.' },
    accent: '#3f5f8a',
    terms: { customer: { en: 'Customer', ms: 'Pelanggan' }, order: { en: 'Order', ms: 'Pesanan' }, item: { en: 'Item', ms: 'Barang' }, delivery: { en: 'Delivery', ms: 'Penghantaran' } },
    docs: ['cpo', 'so', 'pf', 'do', 'inv', 'rcp', 'spo'],
    defaults: { depositPct: 30, sstRate: 0, round5: false, creditDays: 30 },
    kpis: [{ id: 'open', label: { en: 'Open orders', ms: 'Pesanan terbuka' } }, { id: 'deposits', label: { en: 'Deposits pending', ms: 'Deposit belum terima' } },
      { id: 'approval', label: { en: 'Needs approval', ms: 'Perlu kelulusan' } }, { id: 'owed', label: { en: 'Still owed', ms: 'Masih terhutang' } }],
    workflow: {
      trigger: { en: 'A customer enquires on chat', ms: 'Pelanggan bertanya melalui sembang' },
      data: { en: 'Your price list, past orders and what the customer still owes', ms: 'Senarai harga, pesanan lepas dan baki hutang pelanggan' },
      rules: { en: 'Rules set the price and the deposit; AI only reads and drafts', ms: 'Peraturan tetapkan harga dan deposit; AI hanya membaca dan mendraf' },
      approval: { en: 'Staff draft; the owner approves invoices and supplier POs', ms: 'Staf mendraf; pemilik meluluskan invois dan PO pembekal' },
      outcome: { en: 'A linked document trail and an audit log entry for every step', ms: 'Jejak dokumen berpaut dan rekod log audit untuk setiap langkah' },
    },
    quickActions: [{ to: 'so', label: { en: 'New order', ms: 'Pesanan baharu' } }, { to: 'cpo', label: { en: 'Record customer PO', ms: 'Rekod PO pelanggan' } }],
    sampleLines: [{ description: 'Item A', qty: 10, uom: 'pcs', unit_price: 12 }, { description: 'Item B', qty: 4, uom: 'pcs', unit_price: 30 }],
    questions: [{ id: 'deposit', text: { en: 'Do you ask for a deposit?', ms: 'Adakah anda minta deposit?' }, enables: ['pf'] },
      { id: 'deliver', text: { en: 'Do you deliver goods?', ms: 'Adakah anda hantar barang?' }, enables: ['do'] }],
  },
]

export const packById = (id: string | null | undefined) => PACKS.find(p => p.id === id) ?? PACKS[2]
export const say = (l: L) => (getLang() === 'ms' ? l.ms : l.en)  // Chinese and Tamil fall back to English until translated

export const DOC_NAME: Record<DocKind, L> = {
  cpo: { en: 'Customer PO (received)', ms: 'PO Pelanggan (diterima)' }, so: { en: 'Sales Order', ms: 'Pesanan Jualan' }, pf: { en: 'Proforma Invoice', ms: 'Invois Proforma' },
  do: { en: 'Delivery Order', ms: 'Pesanan Penghantaran' }, inv: { en: 'Invoice', ms: 'Invois' }, rcp: { en: 'Receipt', ms: 'Resit' }, spo: { en: 'Supplier PO (sent)', ms: 'PO Pembekal (dihantar)' }, grn: { en: 'Goods Received', ms: 'Barang Diterima' },
}
export const docName = (p: SectorPack, k: DocKind) => say(p.docNames?.[k] ?? DOC_NAME[k])

// The chosen sector is a demo-mode switch kept in this browser only; the server does not store it yet (roadmap: set at sign-up).
const KEY = 'sector'
const read = () => { try { return localStorage.getItem(KEY) } catch { return null } }
export function useSector(): [SectorPack, (id: string) => void] {
  const [id, setId] = useState<string | null>(read)
  useEffect(() => { const h = () => setId(read()); addEventListener('laris:sector', h); return () => removeEventListener('laris:sector', h) }, [])
  return [packById(id), (v: string) => { try { localStorage.setItem(KEY, v) } catch { /* storage blocked: stays for this visit */ } setId(v); dispatchEvent(new Event('laris:sector')) }]
}

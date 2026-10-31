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
    id: 'product', name: { en: 'Product', ms: 'Produk' },
    tagline: { en: 'You make or sell goods: quote, deposit, deliver, invoice and get paid.', ms: 'Anda buat atau jual barang: sebut harga, deposit, hantar, invois dan terima bayaran.' },
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
  {
    id: 'service', name: { en: 'Service', ms: 'Perkhidmatan' },
    tagline: { en: 'You do work for customers: book, quote the job, invoice and get paid. No delivery step.', ms: 'Anda buat kerja untuk pelanggan: tempah, sebut harga, invois dan terima bayaran. Tiada langkah penghantaran.' },
    accent: '#a1457a',
    terms: { customer: { en: 'Customer', ms: 'Pelanggan' }, order: { en: 'Job', ms: 'Kerja' }, item: { en: 'Service', ms: 'Perkhidmatan' }, delivery: { en: 'Job done', ms: 'Kerja selesai' } },
    docs: ['so', 'pf', 'inv', 'rcp', 'spo'],
    docNames: { so: { en: 'Job Order', ms: 'Pesanan Kerja' }, pf: { en: 'Deposit Request', ms: 'Permintaan Deposit' }, spo: { en: 'Materials PO', ms: 'PO Bahan' } },
    defaults: { depositPct: 50, sstRate: 6, round5: true, creditDays: 0 },
    kpis: [{ id: 'open', label: { en: 'Open jobs', ms: 'Kerja terbuka' } }, { id: 'deposits', label: { en: 'Deposits pending', ms: 'Deposit belum terima' } },
      { id: 'approval', label: { en: 'Needs approval', ms: 'Perlu kelulusan' } }, { id: 'owed', label: { en: 'Unpaid bills', ms: 'Bil belum bayar' } }],
    workflow: {
      trigger: { en: 'A customer messages "can you fix my aircon on Saturday?"', ms: 'Pelanggan mesej "boleh baiki aircond hari Sabtu?"' },
      data: { en: 'Service menu with durations, stylist availability, visit history', ms: 'Menu perkhidmatan dengan tempoh, kekosongan stylist, sejarah lawatan' },
      rules: { en: 'Service price x stylist time, package bundles, no-show deposit', ms: 'Harga perkhidmatan x masa stylist, pakej, deposit tidak hadir' },
      approval: { en: 'Staff book; the owner approves discounts and voids a receipt', ms: 'Staf menempah; pemilik meluluskan diskaun dan membatalkan resit' },
      outcome: { en: 'Job booked, receipt on payment, follow-up reminder draft', ms: 'Kerja ditempah, resit semasa bayaran, draf peringatan susulan' },
    },
    quickActions: [{ to: 'so', label: { en: 'New job', ms: 'Kerja baharu' } }, { to: 'inv', label: { en: 'Bill a customer', ms: 'Bil pelanggan' } }],
    sampleLines: [{ description: 'Cut and blow dry', qty: 1, uom: 'visit', unit_price: 55 }, { description: 'Hair colour (short)', qty: 1, uom: 'visit', unit_price: 180 }, { description: 'Treatment add-on', qty: 1, uom: 'visit', unit_price: 45 }],
    questions: [{ id: 'package', text: { en: 'Do you sell prepaid packages?', ms: 'Adakah anda jual pakej prabayar?' }, enables: ['pf'] },
      { id: 'retail', text: { en: 'Do you restock retail products?', ms: 'Adakah anda tambah stok produk runcit?' }, enables: ['spo'] }],
  },
]

export const packById = (id: string | null | undefined) => PACKS.find(p => p.id === id) ?? PACKS[0]
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

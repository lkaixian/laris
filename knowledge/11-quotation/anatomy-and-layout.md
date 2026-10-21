---
source_url:
  - https://niagawan.com/quotation/
  - https://forms-legal.com/malaysia/business/contracts/quotation-template-malaysia
  - https://refrens.com/en-my/sst-invoice-format
retrieved: 2026-10-22
confidence: med
status: verified (core field list from template sources); REAL DATA needed (actual layouts from SQL Account / AutoCount / Bukku / WhatsApp)
---
# Anatomy and layout of a quotation

Related: [[trade-variants]], [[malaysia-conventions]], [[names-and-document-types]], [[summary]].

Sources agree on the core: quote number, date, validity, itemised prices, total, payment terms, exclusions, acceptance method; for Malaysia add RM, SSM number in header and an "estimated SST" line when SST-registered (src niagawan, forms-legal). "Where it appears" below is inference from common document design, not from a source.

## Layout, top to bottom
1. Header band: logo, company name, SSM reg no, address, phone, email, SST no, optional TIN. Title "QUOTATION / SEBUT HARGA" with quote no, date, valid-until at right.
2. Customer block: company, address, attention (Perhatian), phone, customer ref.
3. Intro line (optional).
4. Line table.
5. Totals box (right aligned): subtotal, discount, SST, grand total, deposit.
6. Terms: payment, delivery/lead time, validity, warranty, exclusions.
7. Bank details (common in the footer, inference).
8. Acceptance block: "Accepted by / Diterima oleh", signature, company chop (stamp), date. The company chop is a common Malaysian convention (inference).
9. Footer: "computer generated, no signature required" on software PDFs (inference).

## Field table
| Field | Required? | Where | Example | Schema today |
|---|---|---|---|---|
| Document title | yes | top | QUOTATION / SEBUT HARGA | `kind` |
| Quote no | yes (src: unique, sequential, never reused) | header right | QT-2026-0001 | `doc_no` |
| Issue date | yes | header right | 22 Oct 2026 | `issued_on` |
| Valid until | strongly recommended; write a calendar date (src niagawan) | header or terms | Valid until 20 Nov 2026 | `valid_until` |
| Seller name | yes | header | ABC Sdn Bhd | tenants.name (only) |
| Seller SSM no | optional but often requested by larger/GLC buyers (src niagawan) | header | 1234567-X (old) / 12-digit new format | missing |
| Seller address/phone/email | yes | header | | missing |
| Seller SST reg no | only if SST-registered (src forms-legal) | header/supplier block | format not verified | missing |
| Seller TIN | not on quote; needed for e-invoice | header, optional | | missing |
| Customer name | yes | customer block | | `parties.name` |
| Attention/contact | usual | customer block | Attn: Ms Tan | `parties.contact` (single text) |
| Customer ref / PO no | optional | customer block | Your ref: RFQ-88 | missing |
| Line no | usual | col 1 | 1 | `line_no` |
| Description | yes | table | A4 flyer 128gsm art paper, 4C both sides | `description` |
| Qty | yes | table | 1000 | `qty` (must be > 0) |
| UOM | usual | table | pcs / set / pax / sqft | `uom` |
| Unit price | yes | table | 0.45 | `unit_price` |
| Line discount | optional (src: discount as own line) | table or totals | -5% | missing |
| Line amount | yes | table | 450.00 | derived |
| Subtotal | yes | totals | 450.00 | derived |
| Discount total | optional | totals | | missing |
| SST (labelled "estimated" if registered, src) | if registered | totals | SST 8% 36.00 | missing |
| Grand total | yes | totals | RM 486.00 | derived (not stored) |
| Deposit | optional (src) | totals/terms | 30% = RM145.80 | missing |
| Payment terms | yes | terms | 30% deposit on acceptance, balance on delivery (src sample) | missing |
| Delivery / lead time | usual | terms | 7 working days from cleared deposit (src sample) | missing |
| Warranty | trade dependent | terms | 3 months | missing |
| Inclusions / exclusions | recommended (src) | terms | Excludes installation | missing |
| Acceptance / signature | recommended (src) | bottom | sign and return | status transitions only |
| Bank details | common (inference) | footer | | missing (tenant data) |
| Currency | yes | totals | MYR | `currency` |
| Remarks | optional | bottom | | missing |

## Physical forms an `in` or `out` quote takes
1. **WhatsApp plain text**: "Boss, banner 3x6ft pvc rm180, pasang rm50, total rm230 ya." No number, date or validity; prices inside prose; mixed BM/English/Manglish. Needs LLM extraction with `needs_review` (inference, REAL DATA needed).
2. **Photo of handwritten sheet** or carbon-copy "Sebut Harga" pad: low OCR confidence; hand-added totals may disagree with lines (inference, REAL DATA needed).
3. **PDF from Word/Excel template**: structured but layout varies per vendor; text layer usually exists so text extraction beats OCR (inference).
4. **Accounting-software PDF** (SQL Account, AutoCount, Bukku): consistent columns, printed doc no, SST column, computer-generated footer (inference; layouts not inspected). REAL DATA needed: export one sample from each.

## Gaps
- No real sample layouts fetched; placement is inference.
- SST registration number and new SSM number formats not verified.

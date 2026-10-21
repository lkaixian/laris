---
source_url: see linked notes
retrieved: 2026-10-22
confidence: med
status: REAL DATA needed (collect real SME quotes before freezing)
---
# Summary: canonical quotation field set for LARIS

Links: [[names-and-document-types]], [[anatomy-and-layout]], [[trade-variants]], [[malaysia-conventions]], [[../07-data-model/bidirectional-schema]].

## Canonical fields mapped to current schema
| Concept | In (supplier quote received) | Out (our quote) | Schema today |
|---|---|---|---|
| Doc kind | quotation / invoice / receipt (also price list, proforma, estimate seen) | quotation (estimate, proforma variants) | `kind` lacks estimate, proforma, price_list, purchase_order |
| Doc no | supplier number | QT-YYYY-NNNN | ok |
| Issue date, valid until | often missing on chat quotes | default by rule | ok; no "defaulted" flag |
| Counterparty | supplier | customer | `parties` (name, contact only) |
| Counterparty IDs (SSM, SST no, TIN, address, attention, phone) | useful | needed for later invoice | MISSING |
| Issuer identity (SSM, SST no, address, logo, bank) | n/a | needed to render PDF | MISSING on tenants |
| Customer ref / PO no | n/a | yes | MISSING |
| Lines: no, description, qty, uom, unit price | yes | yes | ok |
| Line discount | sometimes | yes | MISSING |
| Tax code/rate per line; tax-inclusive flag | unknown incl/excl | SST rate varies by service | MISSING |
| Section/header rows, provisional sum, optional item | BOQ | renovation | MISSING |
| Spec attributes (size, material, pax, grams) | in description | structured per trade | MISSING (attrs jsonb) |
| Qty breaks | price lists | printing | MISSING (workaround: multiple lines) |
| Totals (subtotal, discount, tax, grand) | stated total useful for OCR cross-check | computed | MISSING |
| Deposit %, payment terms | yes | yes | MISSING |
| Delivery / lead time | yes | yes | MISSING |
| Warranty, inclusions, exclusions, notes | yes | yes | MISSING |
| Acceptance evidence (signed copy, chop, customer PO) | n/a | yes | status only |
| Channel / source artefact | yes | yes | ok |
| Currency | yes | yes | ok (MYR assumed) |
| Estimate flag | n/a | yes | MISSING |

## Missing from current schema (prioritised)
1. SST: tenants.sst_registered, sst_no; documents.tax_total; document_lines.tax_rate; tax-inclusive flag for in docs. The schema note put SST out of scope; registered firms need it.
2. Issuer and counterparty identity (SSM, address, bank, attention) for rendering a PDF.
3. Terms: deposit_pct, payment_terms, lead_time_days, terms_text.
4. Line discount and structure (discount_pct, section, is_header, is_provisional).
5. stated_total on in docs for OCR validation.
6. customer_ref/PO number; kind values estimate and proforma.
7. attrs jsonb per line for trade specs.

## Biggest unknowns (REAL DATA needed)
- Real SME samples (WhatsApp, handwritten, SQL Account, AutoCount, Bukku PDFs).
- Legal weight of a quote in Malaysia; primary RMCD/LHDN confirmation (secondary sources conflict, e-invoice exemption RM500k vs RM1m).
- Payment-term norms: only a "30% deposit" sample was found.

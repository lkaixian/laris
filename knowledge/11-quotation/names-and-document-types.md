---
source_url:
  - https://niagawan.com/quotation/
  - https://www.webtoffee.com/blog/quotation-and-proforma-invoice/
  - https://rmc.utm.my/wp-content/uploads/sites/79/2024/07/2.-PK2-KAEDAH-PEROLEHAN-BEKALAN-DAN-PERKHIDMATAN-ASAL.pdf
  - https://mof.gov.my/portal/pdf/TPPA/03-taklimat-mekanisme-pelaksanaan-perolehan-pematuhan-PPPK-bekalan-perkhidmatan.pdf
retrieved: 2026-10-22
confidence: med
status: verified (sebut harga bands, niagawan table); REAL DATA needed (BM labels on real SME documents, legal weight)
---
# Quotation names and related document types (Malaysia)

Related: [[anatomy-and-layout]], [[malaysia-conventions]], [[summary]], [[../07-data-model/bidirectional-schema]].

Legend: "(src)" = from a fetched source. "(inference)" = my general knowledge or reasoning, not verified by a source in this run. Legal-weight statements are not legal advice; no Malaysian-specific source was found for them.

| Term (EN / BM) | Definition | Issued by -> to | Direction in LARIS | Legal weight | Notes |
|---|---|---|---|---|---|
| Quotation / Quote / **Sebut Harga** | Price offer before the customer commits; not a bill (src niagawan). | Seller -> buyer | `out` (our quote to customer); `in` when a supplier quotes us | Offer; generally binding on acceptance if terms are firm and unexpired (inference). Sources conflict: one template says "firm offer", an Indonesian source says "not a binding contract". Needs legal check. | In everyday SME BM, "sebut harga" = quotation (src niagawan). In government procurement it ALSO names a procurement method (see Tender row). |
| **Tawaran Harga** | "Price offer". Loose BM synonym for quotation; "tawaran" also = bid in tenders. | Seller -> buyer | out/in | as quotation | No Malaysian source found defining it. Treat as synonym (inference). |
| **Anggaran / Anggaran Harga / Estimate** | Non-binding approximate price for jobs with unfixed scope (repair, renovation). | Seller -> buyer | out | Weaker than a quotation (src, non-Malaysian: "quotation lebih mengikat"). | LARIS should flag `is_estimate` or separate kind (inference). |
| **Pro forma invoice / Invois Proforma** | Near-final document with confirmed price, issued after buyer has chosen the seller, used to approve or pay a deposit; not an official invoice (src niagawan, webtoffee). | Seller -> buyer | out | Not a tax invoice | Common for deposits and imports. |
| **RFQ** / **Permintaan Sebut Harga** / "Jemputan Sebut Harga" | Buyer asks several suppliers for price and terms; the quotation is the supplier's response (src, general). | Buyer -> supplier | Trigger of `in` flow (our request to supplier), or a customer enquiry on the `out` side | Invitation only | A customer WhatsApp enquiry is functionally an RFQ (inference). Schema has `enquiries` but nothing for OUR RFQs to suppliers. |
| **Tender** (terbuka / terhad) | Formal competitive bid process, mostly government and large corporates. | Buyer invites; bidder submits | out (as bidder) | Bid binding per tender conditions; bid bonds common (inference) | Government supply/services bands (src, secondary; verify against current Treasury circular PK 2.1): pembelian terus up to RM50,000; **sebut harga** RM50,000 to RM500,000; **tender** above RM500,000. Works (kerja) bands differ (PK 2.21; one university circular: quotations RM50k to RM1m, tender above RM1m). Quotation band needs min. 3 MOF-registered local suppliers (src MOF slide). |
| **BOQ / Bill of Quantities / Senarai Kuantiti** | Itemised list of work quantities and rates; pricing schedule of a construction quote or tender (inference, general industry knowledge). | Contractor -> client (priced); client/QS -> contractors (blank) | out | Part of contract documents once awarded (inference) | See [[trade-variants]]. |
| **Price list / Senarai Harga** | Standing list of unit prices; no customer, no validity commitment unless stated. | Seller, published | Not a document; feeds `cost_items` or rate card | None specific | Supplier PDF price lists often lack `valid_until` (inference). |
| **Purchase Order (PO) / Pesanan Pembelian / Order Belian** | Buyer's formal order to a seller, referencing the quote; flows opposite to the quote (src niagawan). | Buyer -> seller | Acceptance evidence for an `out` quote; also OUR PO to suppliers | Binding once accepted (inference) | Not modelled in schema. Store customer PO no on accepted quote. |
| **Delivery Order (DO) / Nota Hantaran / Surat Hantaran** | Accompanies goods leaving premises or a completed job (src niagawan, little detail). Buyer signs to acknowledge receipt. | Seller -> buyer | Downstream of job | Evidence of delivery | Not modelled. |
| **Invoice / Invois / Invois Cukai** | Billing document after delivery or completion; requests payment (src niagawan). Subject to e-invoice rules, see [[malaysia-conventions]]. | Seller -> buyer | `in` invoice supported (`doc_kind='invoice'`); `out` invoice not in scope | Payment demand and tax record | A quotation is not part of Malaysia's e-invoice system (src niagawan). |
| **Receipt / Resit** | Proof of payment. | Seller -> buyer | `in`, kind=receipt | Proof of payment | Already in schema. |

## Differences in one line each
- Quote vs estimate: quote = firm price for stated scope and period; estimate = best guess that may change (inference plus non-Malaysian src).
- Quote vs proforma: proforma follows the buyer's choice and can support a deposit; quote opens negotiation (src webtoffee).
- Quote vs invoice: invoice requests payment after supply; quote requests nothing (src niagawan).
- Quote vs PO: opposite direction; PO is the buyer's acceptance.
- RFQ vs quote: RFQ is the question, quote is the answer.
- Sebut harga (SME sense) = a quotation. Sebut harga (government sense) = a procurement method in the mid-value band.

## Bilingual labels as printed
src niagawan only confirms "sebut harga" for Quotation. Other BM headings likely seen on Malaysian paperwork (inference, REAL DATA needed with scanned samples): "SEBUT HARGA / QUOTATION", "TAWARAN HARGA", "INVOIS / INVOICE", "INVOIS CUKAI / TAX INVOICE", "PESANAN BELIAN / PURCHASE ORDER", "NOTA HANTARAN / DELIVERY ORDER", "RESIT / RECEIPT". Collect 20+ real documents before fixing any classifier wording.

## Gaps
- No Malaysian statute or court source on whether a quotation binds.
- No real SME document samples; label claims above are inference.

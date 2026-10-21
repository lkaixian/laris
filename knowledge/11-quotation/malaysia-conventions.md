---
source_url:
  - https://trykintsugi.com/sales-tax-guides/apac/malaysia
  - https://www.worldfirst.com/my/blog/global-business-tips/sst-registration/
  - https://www.bernama.com/en/news.php?id=2431266
  - https://www.malaymail.com/news/malaysia/2025/06/06/irb-malaysia-exempts-businesses-below-rm500000-from-e-invoicing-delays-mandate-for-rm1-5m-group-to-2026/179391
  - https://www.info-tech.com.my/blog/?p=1938
  - https://chillhub.com.my/?p=2669
  - https://niagawan.com/quotation/
  - https://forms-legal.com/malaysia/business/contracts/quotation-template-malaysia
  - https://www.mondaq.com/government-contracts-procurement--ppp/1229374/malaysian-tax-law---stamp-duty
retrieved: 2026-10-22
confidence: med
status: verified against secondary sources only; REAL DATA needed (confirm on RMCD MySST and LHDN MyInvois primary pages, which were not reachable: sst.customs.gov.my failed DNS)
---
# Malaysia conventions for quotations

Related: [[anatomy-and-layout]], [[names-and-document-types]], [[summary]], [[../04-regulation]] (existing regulation notes may overlap; reconcile).

All tax figures come from secondary guides, not RMCD or LHDN primary pages. Verify before shipping.

## SST on quotes
- Sales tax on goods: 5% or 10% bands (src kintsugi, "as of August 2026"; goods lists not given).
- Service tax: 8% for most taxable services; 6% for food and beverage, telecommunications, logistics, parking, construction, healthcare, education (src kintsugi). Another source (WorldFirst) places rental/leasing and construction at 6%, financial services at 8%. Sources differ on band assignment, so the rate must be a per-line/per-tenant setting, not hard-coded.
- Service tax rate moved 6% to 8% on 1 March 2024 (src niagawan-search summary, forms-legal result); scope widened 1 July 2025 to financial services, leasing, construction, private healthcare (src kintsugi).
- Registration threshold RM500,000 annual taxable turnover (src kintsugi, WorldFirst); exceptions RM1,000,000 (financial services, rental/leasing), RM1,500,000 (construction, private healthcare) per secondary sources. MSMEs may be exempt from service tax on rental/leasing (RM1.5m sales and RM2.5m share capital limits, src WorldFirst, unverified).
- On the quote: show SST only if the seller is registered; label it "estimated" (src niagawan); show the seller's SST registration number in the supplier block (src forms-legal). A non-registered SME shows no SST line. Design consequence: `tax_rate`/`tax_amount` per document or line, plus tenant `sst_no` and `sst_registered`. Earlier schema note put SST out of scope; this is a gap for `in` documents too (supplier prices may be tax-inclusive or exclusive; unknown at parse time, flag `needs_review`).
- Whether a quote is "tax inclusive" or "plus SST" matters for margin (inference): LARIS cost_items should store ex-SST cost.

## e-Invoice interplay
- A quotation is not part of Malaysia's e-invoice system; the invoice that follows is (src niagawan).
- Phasing (secondary): above RM5m from 2024-25; RM1m to RM5m from 1 January 2026 with penalty relief to 31 December 2027 (src chillhub); from 1 January 2026 a single transaction of RM10,000 or more needs an individual e-invoice (src info-tech/chillhub, unverified). Exemption threshold: RM500,000 as of June 2025 (src malaymail); one source says it was raised to RM1m on 6 December 2025 (src info-tech, single secondary source, treat as low confidence). Sub-threshold firms may opt in voluntarily.
- Implication: LARIS quotes need not be MyInvois-valid, but an accepted quote should carry fields that the later invoice needs (buyer TIN, buyer SST/SSM, line classification code) so the accounting system can invoice without re-keying (inference). Out of scope for the MVP.

## Stamp duty
- No source found stating a quotation or PO is dutiable. Stamp duty applies to dutiable instruments in the Stamp Act 1949 First Schedule (agreements, leases, loans, etc.), generally within 30 days of execution; unstamped instruments are inadmissible in court (src mondaq, bakermckenzie search summary). Inference: a plain quotation is not itself a listed instrument, but a signed service/construction agreement formed from it could be. Confirm with a tax adviser. No schema impact.

## Validity conventions
- Write a calendar date, not "valid 30 days" (src niagawan). Stock: about 30 days; imported/supplier-priced: 7 to 14 days; labour only: 30 to 60 days (src niagawan). No legal minimum was found (src forms-legal template leaves days blank).
- WhatsApp quotes often have no validity at all (inference) -> LARIS should default `valid_until = issued_on + tenant default` and mark it as defaulted.

## Payment terms
- Sample: "30% deposit on acceptance, balance on delivery" (src niagawan). No source supports a norm of 50% deposit, 30-day credit, etc.; those are plausible conventions (inference): deposit 30-50% for custom/made-to-order, credit 30 days for B2B accounts, COD for walk-in. REAL DATA needed.
- Store as structured: deposit_pct, balance_terms (COD / net N days / progress stages) plus original text.

## Language mix
- Malay/English mix is normal: bilingual headings, English line descriptions, Malay remarks; some Chinese-run SMEs add Chinese product names or WeChat/WhatsApp phrasing (inference). Only "sebut harga" is source-confirmed. LARIS extraction must be language-agnostic and keep `description` verbatim; normalised `item_key` is separate.
- Currency: RM / MYR, written "RM 1,234.50", "rm1.2k", or "1.2k" in chat (inference).

## Government sebut harga
Bands (src, secondary, verify current Treasury Circular PK 2.1/2.21): direct purchase up to RM50,000; sebut harga above RM50,000 to RM500,000; tender above RM500,000; quotation band needs min. 3 registered local suppliers. Government buyers may require SSM and MOF registration on the quote. Likely out of scope for LARIS.

## Gaps
- Primary RMCD and LHDN pages not read.
- Rates and e-invoice exemption threshold have conflicting secondary reports.

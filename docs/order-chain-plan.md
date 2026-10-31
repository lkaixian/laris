# Order chain plan: Quotation to Receipt

Status: DRAFT for review, 2026-10-31. Nothing built yet.

Goal: Quotation, customer taps Accept, Order, Proforma with recorded deposit, Delivery Order with tap-to-sign proof of delivery, Invoice, Receipt. One customer link, no PDFs sent back and forth (PDF is a Download button only).

## 1. Where the chain stops today

- Quotation to Accept works. `quote_accept_links` and `accept_link_decide()` (`db/accept.sql`) mark the quote `accepted` and insert a `jobs` row.
- Everything after that is missing:
  - `documents` is quote-shaped. `kind_by_direction` only allows quotation, estimate and proforma on outgoing documents, and the `doc_status` enum is quote-shaped.
  - No payments table, no delivery signature, no outgoing invoice or receipt.
  - `knowledge/11-quotation/names-and-document-types.md` lists delivery order and outgoing invoice as "not modelled".
- Reuse:
  - `quote_doc.compose()` (lines and totals), `quote_pdf` (PDF on demand), `next_quote_no` (numbering).
  - `new_link` and the public-link pattern (`src/api/accept.py`).
  - `quote_send` (Telegram, WhatsApp, email).
  - Tracker (`track_rules.py`) and Jobs board.
  - `documents.deposit_pct` already exists.
- The job is the order. Accepting already creates it, so no `orders` table.

## 2. Research findings

- Sequence agreed by the Malaysian SME sources found: proforma, then deposit, then DO signed by the buyer, then real invoice. ([Niagawan](https://niagawan.com/proforma-invoice/), [Lapasar DO](https://lapasar.com/glossary/delivery-order))
- Paying a proforma does not make it a tax invoice; the real invoice still follows.
- A signed DO is proof of delivery, not a payment request. The buyer notes missing or damaged items.
- Electronic Commerce Act 2006 defines an e-signature broadly (any symbol adopted as a signature) but s.9 needs it linked to the signer only. Nothing found on delivery orders or courts accepting tap-to-sign. Keep the "simulated, not a legal e-signature" notice and add this to the lawyer list. ([Skrine](https://www.skrine.com/insights/alerts/april-2020/considerations-in-respect-of-using-electronic-sign))
- SST on deposits: NOT confirmed. [PwC](https://pwc.com/my/en/publications/mtb/service-tax.html) ties service tax to payment received, not deposits specifically. Flag for the accountant, no code.
- e-Invoice: most SMEs are exempt (RM3M threshold, see `knowledge/04-regulation/e-invoice-myinvois.md`). Out of scope.
- No source gave a Malaysian standard deposit percentage. Use the quote's own `deposit_pct`.

## 3. Design

1. **One customer link for the whole deal.** The accept link becomes the deal link; the same URL keeps working after Accept. The page shows a timeline (Quote, Order, Proforma, Delivery, Invoice, Receipt) and the one action due: Accept, see proforma and bank/DuitNow details, sign for delivery, see invoice, see receipt. Each step pushes a short message with that link over the existing channel.
2. **New tables, not the quote state machine.**
   - `deal_docs`: kind (proforma, delivery_order, invoice, receipt), doc_no, frozen line snapshot, totals, status (issued, signed, void), issued by and at.
   - `payments`: amount, method, reference, recorded by, idempotency key, deposit or balance. Append-only; a mistake is fixed by a reversing row.
   - `delivery_signatures`: name, tick, optional drawn mark, hashed IP, timestamp, "received with problems" note.
   - Row-level security, audit triggers, owner checks copied from `accept.sql`.
3. **Money rules.**
   - Proforma = quote lines, deposit at `deposit_pct`.
   - Recording a deposit auto-issues a deposit receipt.
   - Invoice amount = total minus payments received.
   - Final payment auto-issues the receipt.
   - Overpayment blocked by a row lock plus a check.
   - DO is gated on the deposit being recorded, unless the owner enters an override reason.
4. **Roles.** Owner: proforma, record payment, invoice, void. Delivery staff: create and send the DO; the customer signs on their own phone from the link, or by scanning a QR on the driver's phone. New assignable permissions in `src/perms.py`: `record_payments`, `issue_delivery`.
5. **Tracker and Jobs board.** Stage computed from the child documents (awaiting deposit, in production, delivered, awaiting payment, paid). New overdue rules in `track_rules.py`: deposit chase, unpaid invoice past terms.

## 3b. Layout and format of each document (added after review feedback)

What exists: `src/quote_pdf.py` draws ONE hard-coded quotation layout (reportlab, A4, Helvetica, title "Quotation", fixed 6 columns). The only owner knobs are logo, brand colour, quote prefix, payment terms and terms text. Nothing is shaped per document type, and nothing lets a business make the paper look like its own.

Why each type needs its own layout (from `knowledge/11-quotation/anatomy-and-layout.md` and the research):
- **Proforma**: titled "Proforma Invoice / Invois Proforma", states "not a tax invoice", shows deposit due and bank/DuitNow details, validity.
- **Delivery order**: usually NO prices (many buyers do not want prices on the DO; owner toggle), a "received in good order" statement, a signature block with name, date and the tapped signature image, a company chop area, a discrepancy box.
- **Invoice**: "Tax Invoice / Invois Cukai" if SST-registered, deposit already paid deducted, balance due, due date, bank details.
- **Receipt**: amount received, method, reference, what it was for (deposit or balance), balance remaining, "paid" marking.

Design (lazy version that still gives real customisation):
1. **One layout spec per document kind**, as data, not code. A spec lists: title text (4 languages), which columns show (and their labels), which blocks show and in what order (header, parties, meta, lines, totals, deposit box, terms, bank, signature, chop, footer), prices on/off, paper size, language. Defaults ship per kind for the 5 kinds (quotation, proforma, DO, invoice, receipt).
2. **Per-business overrides** stored as JSONB on the tenant (`doc_layouts`, one entry per kind). Owner edits them in Settings, Documents: tick blocks on/off, reorder with up/down, rename column and title labels, choose header style (logo left, centred, or full colour band), font size, footer text, signature and chop slots, show/hide prices on DO. A live preview renders the real sample document beside the form.
3. **One renderer, three outputs.** `quote_doc.compose()` already feeds PDF, the web preview and XLSX. Extend it to take the layout spec, so the PDF, the customer's web page and the owner preview cannot disagree. Today `render_model()` is the only PDF path; it becomes `render(kind, model, layout)`.
4. **Fonts.** Helvetica cannot print Chinese or Tamil, but the app is in four languages. Embed a Unicode TTF (Ubuntu is already self-hosted for the web and has no zh/ta glyphs, so add Noto Sans SC and Noto Sans Tamil for the PDF only) or the PDF shows blank boxes for customers who use those names or labels. Needs a quick check of font licence and PDF size.
5. **Bring-your-own look, without a template engine.** Not building: upload a Word/HTML template with placeholders (injection risk, support burden, hard to keep the web page and PDF in step). Instead: upload letterhead/background image per tenant (full-page PNG behind the content, margins set so content clears it) which covers businesses that print on pre-printed paper. This is the one extra upload; it reuses the logo sniffing and size cap.
6. **Signature and chop on the paper.** DO and invoice PDFs print the captured signature (name, timestamp, drawn mark) and an optional uploaded company chop image. Accepted quotation PDF also prints the customer's acceptance (name, date) so the paper copy matches the digital record.
7. **Numbering display** per kind: prefix per kind (QT, PF, DO, INV, RC) set in Settings, yearly sequence like today's `next_quote_no`.

8. **Match my existing paper (decided: both the owner's own look and a specific existing format).** The owner uploads a photo or PDF of a document they already use (their invoice, DO or receipt). The existing reader (OCR, vision, `src/tabular.py`) extracts the structure only: title wording, column labels and order, which blocks appear and where, colours, whether prices show on the DO. That becomes a PROPOSED layout spec shown beside the sample in the preview. The owner accepts, edits or discards it, the same "AI proposes, owner approves" rule as `tenant_fields`. The model fills in a spec of allowed options and never writes layout code, so output stays inside the renderer's block set. Ceiling: it matches structure and wording, not pixel-exact copies; for an exact look the pre-printed letterhead background (item 5) covers it. Limits to state in the UI: unusual layouts fall back to the nearest default.

**Editor behaviour: 90% of users are not tech-savvy, so drag and drop is the second step, never the first.**
- Step 1, zero effort: pick one of 3 ready-made styles per document (Simple, Classic, Colour band) shown as real previews of their own data. Most owners stop here.
- Step 2, taps: a list of switches ("Show prices", "Show bank details", "Show chop"), plain words, no jargon. Each switch updates the preview at once.
- Step 3, drag blocks: blocks (header, customer, items, totals, terms, bank, signature) are big rows in a vertical list with a grip handle. Drag to reorder; every row also has up and down buttons, because dragging fails on small phones, shaky hands and keyboard users. Min 44 px targets (same as the mark bar).
- Step 4, drag images into slots: logo, chop and signature go into FIXED slots (top-left, top-right, bottom-right, and so on). The owner drags the image to a slot or taps a slot to choose. No free-position canvas, no pixel sizing, no overlapping, so a layout can never come out broken or unprintable.
- Anything fancier (own columns, custom fields) sits under "More options", closed by default.
- Always: Undo, "Reset to default", and "Send me a test copy". A save never changes documents already issued: issued PDFs keep the layout they were issued with (layout snapshot stored on `deal_docs`), so changing the style cannot alter an invoice already sent.
- Implementation: no drag library installed. `MarkPhoto.tsx` already uses pointer events (works with mouse and touch), so reuse that approach for a small reorder list; avoid HTML5 drag events, which do not work on touch screens. Check with the existing axe test run.

Open questions for the owner (defaults in brackets):
- Visual drag-and-drop designer, or block toggles plus reorder [toggles plus reorder, designer later]?
- Print on pre-printed letterhead paper [yes, background image upload; confirmed]?
- Match an existing paper format from an uploaded sample [yes, proposed spec the owner approves; confirmed]?
- DO shows prices by default [no, off by default, owner can switch on]?
- Bilingual headings on every document (English with Malay, like "Invoice / Invois") [yes, on by default, switchable]?

## 4. Build order

Each step ends with a `docs/BUILD_LOG.md` row, a commit, and a GitHub Actions run.

0. **Layout engine first** (section 3b): layout spec per kind, `render(kind, model, layout)`, Unicode fonts, default layouts for all five kinds, tests that every kind renders zh/ta/ms text. New documents are built on it from day one, so nothing is hard-coded twice.
1. Schema and numbering (`db/chain.sql`, prefixes QT / PF / DO / INV / RC). Tests: RLS, append-only, overpayment race.
2. Proforma, record deposit (with AI-read payment slip proposal), deposit receipt. Owner screen on the job.
3. Delivery order and public tap-to-sign, with the deposit gate.
4. Invoice, final payment, receipt, void.
5. Settings, Documents: layout editor with live preview, letterhead and chop upload, then "match my existing paper" from an uploaded sample (item 8).
6. Unified customer page, channel messages, tracker and Jobs board stages, four languages.
7. End-to-end test quote to receipt, plus demo script.

Remember `tests/test_permissions.py`: every new write route needs a `REQ` entry.

## 5. Deferred (ceilings)

- Partial deliveries: one DO per order for now.
- Credit notes: void only.
- Online customer payments: owner records by hand (Stripe is licence-only today).
- MyInvois submission.
- Photo of a payment slip.

## 6. Decisions (owner, 2026-10-31)

- Delivery order: prices OFF by default, owner can switch on.
- Document language: ONE language per business, not bilingual. Setting "Document language" (English, Malay, Chinese or Tamil; default English). Headings, labels and fixed wording all follow it. The customer-facing page follows the same setting.
- Proforma: issued after Accept. It shows SST wording (estimated SST line when SST-registered, "not a tax invoice"). Deposit defaults to the quote's `deposit_pct`.
- Payments: recorded by the owner (manual check stays). AI HELPS but never records: the owner photographs or forwards the bank transfer / DuitNow slip, the existing photo reader proposes amount, date, reference and payer, and matches it to the open proforma or invoice; the owner taps Confirm. A CSV of the bank statement can propose matches for many at once. AI output is kept in `extraction`, never in `ai_actions` (the no-price-keys rule), and a slip is never proof of money received: the screen says "check your bank before confirming".
- Deferrals (my call): partial deliveries are SUPPORTED in the schema (many DOs per order, no UNIQUE), v1 screen has one "Deliver all" button, partial later. Credit notes deferred: before any payment a document can be voided and reissued; after payment, ask for a credit note later. Online customer payments and MyInvois deferred.
- Signature: a typed name plus tap (and optional drawn mark) on the DO is treated as valid proof of delivery. It stores name, time, hashed IP and a hash of the document as signed. The "simulated, not a legal e-signature" notice stays on the quote accept page until the lawyer confirms, then goes.
- Deposit and SST: the system does not compute or file SST at deposit. The deposit receipt is labelled "Deposit receipt, not a tax invoice"; SST is shown on the invoice. When tax falls due is the owner's accountant's call (not verified).

## 7. For the lawyer or accountant

- Is a typed or tap signature on a DO valid proof of delivery under ECA 2006 s.9?
- Does a deposit trigger service tax at receipt? Does a proforma need any SST wording?

---
source_url: https://open.dosm.gov.my/data-catalogue/pricecatcher
retrieved: 2026-10-22
confidence: high
status: verified
---
# ADR: OpenDOSM PriceCatcher as price benchmark

Related: [[pricing-numbers]], [[adr-ocr-paddle-tesseract]]

- **Choice**: bulk-download PriceCatcher monthly files as a market price reference for quote sanity checks. **Alternative**: scraping/none.
- **License**: CC BY 4.0 (attribute OpenDOSM / MDTN-DOSM).
- **Columns**: `date` (YYYY-MM-DD), `premise_code` (int -> premise lookup: name, address, district, state), `item_code` (int -> item lookup: name, unit, category), `price` (RM float).
- **Update**: daily (page: last update 22 Oct 2026 12:00, next 23 Oct 2026 12:00). Over 2M prices/month collected by groundstaff.
- **Access**: no OpenAPI. Files `https://storage.data.gov.my/pricecatcher/pricecatcher_2026-10.parquet` (or .csv), one per month; lookups at `/data-catalogue/lookup_item`, `lookup_premise`.
- **Caveat**: retail consumer items (groceries), per DOSM not for inflation analysis; relevance to SME B2B quotes (materials, trade goods) is limited. Coverage of non-grocery items unconfirmed.

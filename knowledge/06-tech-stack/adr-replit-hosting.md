---
source_url: https://docs.replit.com/billing/deployment-repricing
retrieved: 2026-10-22
confidence: low-medium
status: REAL DATA needed (current Reserved VM prices; Postgres and Object Storage terms)
---
# ADR: Replit Reserved VM hosting

Related: [[pdpa-malaysia]], [[pricing-numbers]]

- **Choice**: Replit Reserved VM for app + bot webhook (always-on, needed for WhatsApp webhook). **Alternative**: any VPS / Fly / Railway (not researched).
- **Plans (replit.com/pricing)**: Core $20/mo ($18 annual), Pro $100/mo ($90 annual; DB rollback up to 28 days).
- **Reserved VM (Feb 2025 repricing, effective 24 Mar 2025)**: shared 0.25 vCPU/1GiB $10/mo; shared 0.5 vCPU/2GiB $20; dedicated 1 vCPU/4GiB $40, 2/8 $80, 4/16 $160. A later billing update shows hourly rates (0.5 vCPU/2GiB $0.0208/h) and App Storage cut to $0.015/GiB-month; undated. Official pricing page rendered placeholders; treat all as possibly stale.
- **PostgreSQL / Object Storage**: Replit offers a Databases product and App Storage (object storage) per the docs index and search, but I could not read their terms or whether Postgres is included in plan credits. UNCONFIRMED.
- PDPA angle: region/data residency of Replit unknown ([[pdpa-malaysia]]).

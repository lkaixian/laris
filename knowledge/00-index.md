---
type: index
updated: 2026-10-22
---
# LARIS knowledge vault

LARIS = bidirectional quotation tracker for Malaysian SMEs (TAWAR + UNTUNG core).
Flow: supplier quotation/receipt IN -> cost book -> customer enquiry IN -> rules-priced quote OUT -> approval -> eSign -> job -> follow-up. AI never sets prices.

Note rules: frontmatter has `source_url`, `retrieved`, `confidence`, `status` (verified | REAL DATA needed). No estimated numbers. Medium-confidence notes rely on search summaries; check the primary source before pitching.

## Read in this order
1. [[problem-statement]] then [[market-summary]] and [[made-to-order-share]]
2. [[refined-stack]] (ADRs in 06-tech-stack) and [[pricing-numbers]]
3. [[bidirectional-schema]], [[state-machines]], [[synthetic-data-spec]]
4. [[2026-10-22-scope-review]] and [[2026-10-22-merge-tawar-untung]]
5. Regulation: [[pdpa-malaysia]], [[e-invoice-myinvois]], [[sst-and-quotation-docs]]
6. Competitors: [[gap-table]]
7. Hackathon: [[rules-and-scoring]]; validation: [[interview-and-timing]]
Sources: [[_sources]]

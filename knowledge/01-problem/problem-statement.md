---
type: problem
updated: 2026-10-22
status: draft, headline number still REAL DATA needed
---
# Problem statement (draft)

**Who:** Malaysian micro and small businesses that quote per job (contractors, printing and signage, custom fabrication, catering, service jobs). MSMEs are 39.7% of GDP and 48.7% of jobs ([[msme-gdp-share-2025]], [[msme-employment-2025]]); DOSM counts 1,069,831 establishments ([[msme-count-dosm-ec2023]]).

**Pain:** supplier quotations arrive in WhatsApp, photos and PDFs and are never tied to the price the owner later gives a customer. When a supplier raises a price, quotes already sent or about to be sent are priced on a stale cost, and nobody notices. Unanswered customer quotes get no follow-up.

**Evidence so far:** adjacent only. 67% of SMEs cite rising costs and average payment delay is 61 days ([[sme-cost-pressure-2026]], [[late-payment-experian-2025]]); PPI rose 9.2% in June 2026 ([[ppi-local-production-2026-06]]). No Malaysian figure for quote turnaround or stale-cost margin loss: [[quotation-response-pain]].

**Headline number to replace:** REAL DATA needed. Source it from Thursday's timing ([[interview-and-timing]]) plus the seed-data margin leak, never from synthetic data alone.

**Sector reality:** services are 87.6% of MSMEs and made-to-order is a minority ([[made-to-order-share]]), so LARIS handles service and job quotes through config templates, not manufacturing only.

**Solution in one line:** LARIS ties every supplier quotation to a cost line with source and date, prices customer quotes from those lines by rule, flags quotes made stale by a newer supplier price, and tracks both directions in one board. See [[refined-stack]] and [[bidirectional-schema]].

# Malaysia PDPA 2010 (as amended by Act A1727): DPO rules and processor obligations (law as of 2026-10-30)

Source key. VERIFIED-PRIMARY = text I read myself from a PDF downloaded from pdp.gov.my. VERIFIED-GAZETTE-COPY = text of Act A1727 read from a PDF hosted by a law firm (christopherleeong.com), which reproduces the PNMB Gazette print (cover says Royal Assent 9 Oct 2024, gazetted 17 Oct 2024). I could NOT fetch lom.agc.gov.my or an official pdp.gov.my copy of Act A1727. SECONDARY = law-firm summary only.
Fetch problems: the pdp.gov.my HTML pages returned navigation only (no body text); I used the PDFs they link to. The SPDP DPO user manual PDF came back unreadable (compressed), so portal steps are not verified from it. The Security Standard text on pdp.gov.my is images (JPG), not text.

## 1. DPO: section, effective date, who must appoint, thresholds, SMEs

### Takeaway
New s12A PDPA (inserted by Act A1727 s6) requires both controllers and processors to appoint DPOs; in force 1 June 2025. The Act itself is unconditional, but the Commissioner's Circular and Guideline say mandatory appointment applies where processing involves more than 20,000 data subjects, OR sensitive personal data (incl. financial) of more than 10,000 data subjects, OR regular and systematic monitoring. There is no SME exemption by size; the test is volume/sensitivity/monitoring. A small organisation below all three triggers is not required (and may record its reasons for not appointing).

### Cited Findings
- s12A(1): "A data controller shall appoint one or more data protection officers who shall be accountable to the data controller for the compliance with this Act." s12A(2): where processing is done by a data processor on behalf of a controller, "the data processor shall appoint one or more data protection officers who shall be accountable to the data processor". s12A(3): the data controller (only) shall notify the Commissioner "in the manner and form as determined by the Commissioner". s12A(4): appointing a DPO does not discharge the controller or processor from duties under the Act. [VERIFIED-GAZETTE-COPY] — [Act A1727 PDF](https://christopherleeong.com/wp-content/uploads/2024/12/PDPA-Amendment-Act-A1727.pdf)
- Act A1727 s1(2): commences on a date appointed by the Minister by gazette notification, different dates for different provisions. [VERIFIED-GAZETTE-COPY] — same PDF.
- Commencement stages: 1 Jan 2025 (ss13-14); 1 Apr 2025 (ss2, 3, 4, 5, 10, 12: includes processor Security Principle); 1 Jun 2025 (s6: s12A DPO and s12B breach notification; s9: s43A data portability). Minister's gazette notification dated 19 Dec 2024; no gazette number found. [SECONDARY] — [Conventus Law](https://conventuslaw.com/report/malaysia-save-the-dates-personal-data-protection-amendments-now-in-operation/)
- 1 June 2025 as the DPO/DBN compliance date is also stated in the Commissioner's SPDP manual per search snippet, and by law firms. [SECONDARY] — [CMS](https://cms.law/en/int/legal-updates/guidelines-on-appointment-of-data-protection-officers-in-malaysia), [DLA Piper](https://privacymatters.dlapiper.com/2025/03/malaysia-guidelines-issued-on-data-breach-notification-and-data-protection-officer-appointment/)
- Guideline on Appointment of DPO, Version 1.0, issued 25 Feb 2025 under s48(g) of Act 709. Para 4.2: controllers and processors "are required to appoint one or more data protection officers if their processing of personal data involves": 4.2.1 personal data exceeding 20,000 data subjects; 4.2.2 sensitive personal data including financial information exceeding 10,000 data subjects; 4.2.3 activities that require regular and systematic monitoring of personal data. [VERIFIED-PRIMARY] — [Guideline PDF](https://www.pdp.gov.my/wp-content/uploads/2025/08/GP_DPO_ENG.pdf)
- Same thresholds in the Commissioner's Circular (Malay text, cover says "Bilangan 1 Tahun 2025, Pelantikan Pegawai Perlindungan Data"; pdp.gov.my page title calls it No. 2/2025; the Guideline itself cites "Circular No. 1/2025 (Appointment of DPO)". Numbering is inconsistent across official sources). Circular para 4(1): controllers and processors "hendaklah melantik" (must appoint) "dalam mana-mana kes jika pemprosesan melibatkan" the three triggers. [VERIFIED-PRIMARY] — [Circular PDF](https://www.pdp.gov.my/wp-content/uploads/2025/02/Pekeliling-DPO.pdf); page: [pdp.gov.my circular page](https://www.pdp.gov.my/en/akta/circular-of-personal-data-protection-commissioner-no-2-2025-appointment-of-data-protection-officer/)
- Guideline 4.5: controller/processor "may keep a record on the reasons for not appointing" a DPO if the para 4.2 conditions are not met. Guideline 4.4 / Circular 4(2): notwithstanding 4.2, notify the Commissioner of an appointment "if there is any urgency" (vague; undefined). [VERIFIED-PRIMARY] — Guideline PDF above.
- "Regular and systematic monitoring" examples in 4.3: online/offline tracking and profiling for behavioural advertising; retail site algorithms monitoring searches and purchases to recommend; telecom networks; wearables monitoring wellness/health; CCTV and connected devices. A loyalty programme run strictly to manage accounts may not count. Circular defines "regular" as continuous or recurring at set times, and "systematic" as arranged, orderly, methodical. [VERIFIED-PRIMARY] — Guideline PDF; Circular PDF.
- Guideline 6.3: DPO may be part-time or full-time "taking into account the organisation's function, structure and size". 6.2: DPO may hold other duties but without conflict of interest (head of marketing is the stated bad example). 6.9 and Circular 4(3): one person may be DPO for several controllers/processors if easily accessible. [VERIFIED-PRIMARY]
- No express "small business" or "SME" exemption or lighter regime appears in the Guideline or Circular text I read (searched by reading full text; size is only a factor in resourcing and part-time/full-time). [VERIFIED-PRIMARY, absence]

### Inferences
- A tiny SaaS or SME holding data on far fewer than 20,000 people, no sensitive data above 10,000 people, and not doing regular and systematic monitoring is outside the mandatory triggers, but note the statute (s12A) reads as unconditional and the thresholds come from Commissioner instruments (Circular/Guideline) made under the Commissioner's functions; a lawyer should confirm the thresholds' legal force. Risk: a SaaS that logs user behaviour continuously could arguably fall in "regular and systematic monitoring" regardless of volume.
- Counting "data subjects" for a multi-tenant SaaS processor: it is unclear whether a processor counts the sum across all customers. Guideline does not say. Flag for lawyer.
- Synthetic data is not personal data, so it should not count toward thresholds; the Guideline does not address synthetic data.

### Gaps
- No official text of Act A1727 from lom.agc.gov.my or pdp.gov.my; relied on law-firm-hosted Gazette PDF.
- Gazette notification number for commencement not found.
- Whether "20,000" counts per year, per entity, or across all clients: not stated in the primary text.
- Whether the thresholds are legally binding versus guidance: not resolved in primary text (Circular says appointment "tertakluk kepada syarat-syarat yang ditetapkan oleh Pesuruhjaya", i.e. subject to conditions set by the Commissioner).

## 2. DPO: how, by when, qualifications, location, publication

### Takeaway
Register the DPO on the SPDP portal (https://daftar.pdp.gov.my) within 21 days of appointment; update within 14 days of any change. DPO must be Malaysia-resident (180 days/year) or easily contactable, fluent in Bahasa Melayu and English. No minimum formal qualification.

### Cited Findings
- Guideline 7.1-7.4: a controller meeting the conditions "shall register the appointed data protection officer and submit their business contact information within twenty-one (21) days from the date of appointment", via the Personal Data Protection System (SPDP) at https://daftar.pdp.gov.my; change of DPO or contact info to be updated "no later than fourteen (14) days from the effective date of the new appointment via SPDP". [VERIFIED-PRIMARY] — [Guideline PDF](https://www.pdp.gov.my/wp-content/uploads/2025/08/GP_DPO_ENG.pdf)
- Circular para 8 says the same in Malay (21 days to register; 14 days to update on cessation). [VERIFIED-PRIMARY] — [Circular PDF](https://www.pdp.gov.my/wp-content/uploads/2025/02/Pekeliling-DPO.pdf)
- Notification duty is on the controller (s12A(3) and Guideline Part B para 7 say "data controller"). Neither the Act nor the Guideline imposes an express SPDP registration duty on a processor. Guideline 15 and 16 (publication, record keeping) apply to "data controller and data processor". [VERIFIED-PRIMARY]
- DPO location: 6.10: must be resident in Malaysia (physically present at least 180 days in a calendar year) OR "easily contactable via any means", AND proficient in Bahasa Melayu and English. So DPO need not be in Malaysia if easily contactable. [VERIFIED-PRIMARY]
- Qualifications 5.4-5.5: no minimum professional qualification unless set by controller/processor or Commissioner; must show sound knowledge of Act 709 and practice, understanding of the business and processing, IT and data security, integrity/governance/ethics, ability to promote data protection culture. Higher skill where large-scale sensitive data, inter-organisation sharing, cross-border transfers (5.3). Controller/processor must ensure the DPO has sufficient training (5.7); Commissioner may set courses and skills benchmarking (5.6). There is a separate "DPO Competency Guideline" PDF: https://www.pdp.gov.my/ppdpv1/wp-content/uploads/2025/08/DATA-PROTECTION-OFFICER-DPO-COMPETENCY-GUIDELINE.pdf (surfaced in search; not read). [VERIFIED-PRIMARY for Guideline; competency guideline not read]
- Appointment method 6.5-6.8: existing employee or outsourced under service contract; contract term of at least 2 years recommended; duties to be spelled out in the contract; outsourcer must name a lead contact. 6.4: if DPO leaves, replace within reasonable time and appoint an interim to monitor the DPO mailbox. [VERIFIED-PRIMARY]
- Publication 15: create a dedicated official business e-mail for the DPO, separate from the individual's personal and work e-mail, actively monitored; publish DPO business contact via any or all of: website/official media, privacy notices, security policies. 16.1: keep records of the appointed DPO. [VERIFIED-PRIMARY]
- Independence 11-12: resources, direct reporting access to senior management; DPO not dismissed for good-faith performance. 8.2: duties incl. advising, monitoring compliance, supporting DPIAs, breach/incident management and reports to the Commissioner. [VERIFIED-PRIMARY]
- The pdp.gov.my "DPO registration guide" page (https://www.pdp.gov.my/panduan-pendaftaran-pegawai-perlindungan-data-dpo/) is a navigation page that links the user manual https://www.pdp.gov.my/ppdpv1/wp-content/uploads/2025/07/Manual_Pengguna_Pendaftaran_DPO_EN.pdf and the portal https://daftar.pdp.gov.my/p_register. Manual content NOT read (PDF unreadable via fetch). [page fetched; manual unverified]

### Inferences
- Penalty for failing to appoint/notify: s12A as shown in Act A1727 has no specific offence subsection (unlike s12B(3)), so only the general penalty provision (s129 of the PDPA? not read) may apply; not verified. Do not assert a penalty for DPO non-appointment.

### Gaps
- SPDP portal step-by-step and form fields: manual not readable. Whether processors can register on SPDP: unknown.
- General offence/penalty for breaching s12A: not verified from the PDPA consolidated text.

## 3. Does a small SaaS processor, or each SME customer, need its own DPO?

### Takeaway
Each entity is assessed separately against the thresholds. s12A(2) applies to the processor in its own right; s12A(1) applies to each controller. A customer's DPO does not cover the processor, and the processor's does not cover the customer (s12A(4), Guideline 6.1: appointment does not discharge duties). Below the thresholds, neither strictly must appoint; above them, each must.

### Cited Findings
- Both controllers and processors must appoint when thresholds are met; the Guideline repeats "data controller or data processor" throughout and 12.1 says the DPO is "accountable to the data controller or data processor who have appointed" them. [VERIFIED-PRIMARY] — [Guideline PDF](https://www.pdp.gov.my/wp-content/uploads/2025/08/GP_DPO_ENG.pdf)
- A processor that must appoint a DPO must also publish the DPO contact details and keep records (Guideline 15-16); notification via SPDP is framed as the controller's duty. [VERIFIED-PRIMARY] — same. CMS and HLC secondary summaries agree. [SECONDARY] — [HLC](https://www.hlc.com/en/publications/malaysia-introduces-mandatory-data-officer-appointment-what-this-means-for-your-business)
- Guideline 6.9 allows a shared or outsourced DPO serving several entities. [VERIFIED-PRIMARY]

### Inferences
- For an SME customer with a few hundred customers, no DPO is mandatory on the thresholds; best practice is still to name a responsible contact. For the SaaS, count depends on whether per-tenant or aggregate data subjects are counted (unresolved). Prudent approach: designate a DPO anyway, low cost (part-time, outsourced, same person allowed).

### Gaps
- No primary statement on aggregate counting for multi-tenant processors.

## 4. Processor obligations (Security Principle, breach, contract, penalties)

### Takeaway
Since 1 April 2025 a processor must itself comply with the Security Principle (new s5(1A)); breach of it carries up to RM1,000,000 and/or 3 years' imprisonment. Breach notification to the Commissioner and individuals (s12B) is a controller duty in the Act; the DBN Guideline expects controllers to contractually require processors to notify them promptly and assist.

### Cited Findings
- New s5(1A): "Where the processing of personal data is carried out by a data processor on behalf of the data controller, the data processor shall comply with the Security Principle as specified in section 9." [VERIFIED-GAZETTE-COPY] — [Act A1727 PDF](https://christopherleeong.com/wp-content/uploads/2024/12/PDPA-Amendment-Act-A1727.pdf)
- s5(2) amended: a controller who contravenes s5(1) "or a data processor who contravenes subsection (1a)" commits an offence; penalty raised from RM300,000/2 years to RM1,000,000 or imprisonment up to 3 years or both. [VERIFIED-GAZETTE-COPY] — same.
- s9(1) amended to "a data controller and a data processor shall" take practical steps to protect personal data; s9(2) amended (words "the data user, the data user shall" replaced with "a data controller, the data processor shall"; ", ensure that the data processor" deleted). The consolidated s9(2) text was not available to me; the original 2010 s9(2) was a controller duty to ensure processors give sufficient guarantees on technical and organisational security measures. The amendment text only shows edits, so I do not state the final wording. [VERIFIED-GAZETTE-COPY for the edits only]
- s4 new definition: "personal data breach" = any breach, loss, misuse or unauthorized access of personal data. [VERIFIED-GAZETTE-COPY]
- s12B (breach notification): the data controller notifies the Commissioner "as soon as practicable" on reason to believe a breach occurred, and the data subject "without unnecessary delay" where significant harm is caused or likely; s12B(3) offence, fine up to RM250,000 or 2 years or both, for a controller failing to notify the Commissioner. No express processor duty in the s12B text. [VERIFIED-GAZETTE-COPY]
- DBN Guideline (issued Feb 2025; PDF https://www.pdp.gov.my/wp-content/uploads/2025/08/GP_DBN_ENG.pdf, NOT read by me): per law-firm summaries, Commissioner notice within 72 hours, notice to data subjects within 7 days of notifying the Commissioner, controller should contractually require the processor to promptly notify it of a breach and provide reasonable assistance; "significant scale" is more than 1,000 data subjects. [SECONDARY] — [CMS](https://cms.law/en/int/legal-updates/guidelines-on-appointment-of-data-protection-officers-in-malaysia), [DLA Piper](https://privacymatters.dlapiper.com/2025/03/malaysia-guidelines-issued-on-data-breach-notification-and-data-protection-officer-appointment/)
- Contract requirement: the Personal Data Protection Standard 2015 requires the data user to bind the processor by contract (law-firm summary). Not read in primary. [SECONDARY] — search result summary of commentary; see section 5 for sources.
- Saving clause s14: Commissioner orders, circulars and notices, and registered codes of practice issued before commencement stay valid as if under the amended Act. [VERIFIED-GAZETTE-COPY]

### Inferences
- A small SaaS processor is now directly criminally exposed (up to RM1m) for security failures, independent of the customer. Customer contracts should include: security measures, breach notice to customer promptly (so the customer can meet 72 hours), sub-processor controls, deletion/return, assistance with data subject requests, and audit rights.
- The "72-hour" and "7-day" periods and the processor-contract clause expectation rest on secondary summaries in this note; the repo runbook flags them unverified.

### Gaps
- DBN Guideline PDF not read: confirm clock start (awareness vs occurrence), processor duties.
- Final consolidated s9(2) wording not obtained; check LOM/AGC reprint of Act 709 (as amended).
- No primary source found on a processor's own direct s12B duty (none appears in the Act text).

## 5. Security Principle: expected controls

### Takeaway
No new JPDP security checklist found. The operative standard remains the Personal Data Protection Standard 2015 (Safety, Storage, Data Integrity), issued under the 2013 Regulations. Detailed control lists in the 2015 Standard (user registration, access control, backups, physical security, contractor clauses, etc.) were not verified from a primary text.

### Cited Findings
- Pdp.gov.my Standard 2015 page lists three standards: Safety (practical security measures vs loss, misuse, unauthorised access or disclosure, alteration, destruction), Storage (permanently destroy/delete when no longer processed), Data Integrity. Detail is in JPG images, not text. [VERIFIED-PRIMARY (page), detail not read] — [pdp.gov.my Standard 2015](https://www.pdp.gov.my/ppdpv1/en/personal-data-protection-standard-2015/)
- A 2024 public consultation (Paper 04/2024) proposed amending the security, retention and data integrity standards; no source found confirming it was finalised. [SECONDARY/unconfirmed] — [PCP 04/2024](https://www.pdp.gov.my/ppdpv1/wp-content/uploads/2025/08/JPDP-FSB-241001-Standard-PCP-ENG-TC.pdf) (listed in search, not read)
- August 2025 consultation on amending the PDP Regulations 2013 (including possibly making Commissioner standards binding); not confirmed finalised. [SECONDARY] — [Baker McKenzie](https://www.bakermckenzie.com/en/insight/publications/alerts/2025/08/malaysia-public-consultation-on-the-personal-data-protection-regulations)
- Further guidelines issued 30 Apr 2026: DPIA, Data Protection by Design, Automated Decision-Making and Profiling. [SECONDARY] — [Rodl](https://www.roedl.com/en/insights/malaysia-new-personal-data-protection-guidelines/), [Baker McKenzie](https://www.bakermckenzie.com/en/insight/publications/2026/05/malaysia-new-personal-data-protection-guidelines)
- The DPO Guideline 8.2.2 mentions security measures against unauthorised access, disclosure, alteration, destruction, and considering certifications/accreditations. It names no specific standard (e.g. ISO 27001). [VERIFIED-PRIMARY]

### Inferences
- Reasonable baseline for a small SaaS: access control, tenant isolation, encryption in transit, backups, logging, deletion on request, vendor/sub-processor contracts. Lawyer to map to the 2015 Standard text.

### Gaps
- Full text of the 2015 Standard security items, and whether it has been replaced since: not verified.

## 6. Repo claim check: C:/LARIS/docs/privacy-and-breach-runbook.md

### Takeaway
The runbook (lines 87-89, "Unverified legal claims") says it could not verify the 1 June 2025 start of the DPO duty or whether a small business must appoint and publish one. Findings: 1 June 2025 start is supported (secondary plus the Guideline's own framing; commencement gazette not read). Small businesses are not exempt by size but are caught only if they meet the thresholds; publication is required only for those who appoint.

### Cited Findings
- Runbook line 9 expects a DPO set in the app, with a health warning `privacy_dpo_missing` until set. That is stricter than the law for entities below the thresholds (Guideline 4.5 lets them record reasons for not appointing). [VERIFIED-PRIMARY for law] — [Guideline PDF](https://www.pdp.gov.my/wp-content/uploads/2025/08/GP_DPO_ENG.pdf); repo file read directly.
- Runbook lists 72-hour, 7-day, "significant harm" vs "more than 1,000 people" as unverified; secondary sources support all four (72 h, 7 days, significant harm, 1,000 = significant scale) but the DBN Guideline PDF was not read. Statute s12B itself says only "as soon as practicable" and "without unnecessary delay". [VERIFIED-GAZETTE-COPY for statute; SECONDARY for numbers]
- The runbook says "ILMU, RunPod, Meta, Telegram, Mailtrap, Replit" are processors with unconfirmed agreements: note the new direct processor duties (s5(1A)) apply to them but your contract still needs the clauses described above.

### Gaps
- The runbook's other items (2-year register, implied consent, access-request time limit, portability scope) were outside this brief.

## Source-reliability notes
- Law-firm items were used only as cross-checks, and where they disagreed with primary text, primary wins. No conflict found on thresholds (20,000 / 10,000 / regular and systematic monitoring) or 21/14-day periods. One inconsistency in official numbering of the DPO Circular (1/2025 vs 2/2025).
- A first-pass search summary said DPO threshold "10,000 for sensitive", consistent with primary. The "2,000" figure suggested in the brief appears nowhere in primary or secondary sources: treat as wrong.

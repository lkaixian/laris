# Malaysia PDPA 2010 (as amended by Act A1727): sensitive/biometric data, AI and automated processing, and an audit of LARIS privacy text

Law as of 2026-10-30. Malaysia only. Not legal advice.

Status labels: **verified-primary** = I read the text myself from an official or official-copy PDF. **secondary-only** = law-firm or press summary only.

Primary texts I actually read (downloaded and run through pdftotext):
- PDPA 2010 (Act 709), consolidated V2022 (pre-amendment), pdp.gov.my: https://www.pdp.gov.my/wp-content/uploads/2024/07/UNDANG-UNDANG-MALAYSIA_AKTA_PERLINDUNGAN_DATA_PERIBADI_2010_709_MALAY_AND-ENG_V2022.pdf
- Act A1727 (Gazette copy, Percetakan Nasional text, hosted by Christopher and Lee Ong, NOT lom.agc.gov.my): https://christopherleeong.com/wp-content/uploads/2024/12/PDPA-Amendment-Act-A1727.pdf . Royal Assent 9 Oct 2024, Gazette 17 Oct 2024.
- JPDP Public Consultation Paper No. 1/2026 (AI framework), pdp.gov.my PDF, text is in Malay: https://www.pdp.gov.my/wp-content/uploads/2026/10/Kertas_Konsultasi_Awam_Bil_1_2026_Kerangka_AI_Perlindungan_Data_Peribadi-1.pdf
- JPDP DBN user manual (Feb 2026), pdp.gov.my: https://www.pdp.gov.my/wp-content/uploads/2026/02/Manual_Pengguna_DBN_Bahasa-Melayu_ver2.pdf

Not fetched / failed: lom.agc.gov.my and mosti.gov.my were not reached (I did not try them after the pdp.gov.my copies worked; MOSTI guideline text not read). The Commissioner's Data Breach Notification Guideline, DPO Guideline, Cross-Border Transfer Guideline, Circular 2/2025, PDP Regulations 2013 and the March 2025 ADM/profiling consultation paper were NOT read; only summaries. Rajah and Tann's page on the AI paper returned HTTP 403. pdp.gov.my pages for DBN and DPO are only stubs linking to manuals (DPO manual PDF not read). The consolidated Act 709 text is pre-amendment, so I applied A1727 by hand; no official consolidated post-amendment text was read.

---

## 1. Definition of sensitive personal data after the amendment; explicit consent; photos and voice notes

### Takeaway
A1727 s.3 adds "biometric data" to "sensitive personal data" in s.4. Sensitive data may be processed only on the s.40 conditions, the first of which is the data subject's explicit consent. Whether a photo or a voice note that is only transcribed is "biometric data" is not settled by any source I could find; on the wording it turns on whether there is "technical processing relating to" physical, physiological or behavioural characteristics.

### Cited Findings
- New definition: "biometric data" means any personal data resulting from technical processing relating to the physical, physiological or behavioural characteristics of a person. Sensitive personal data definition gains the words ", biometric data" after "alleged commission by him of any offence". (A1727 s.3(b),(c)) — verified-primary [A1727](https://christopherleeong.com/wp-content/uploads/2024/12/PDPA-Amendment-Act-A1727.pdf)
- Existing sensitive categories (unchanged): physical or mental health or condition, political opinions, religious or similar beliefs, commission or alleged commission of any offence, plus anything the Minister orders. (s.4) — verified-primary [Act 709](https://www.pdp.gov.my/wp-content/uploads/2024/07/UNDANG-UNDANG-MALAYSIA_AKTA_PERLINDUNGAN_DATA_PERIBADI_2010_709_MALAY_AND-ENG_V2022.pdf)
- s.6(1)(b): sensitive personal data may be processed only in accordance with s.40. s.40(1)(a): "the data subject has given his explicit consent". Other s.40 conditions include employment-law obligations, vital interests, medical purposes, legal proceedings/advice, and data the data subject deliberately made public (I read the first part of the list only). A1727 did not amend s.40 text beyond the "data user" to "data controller" rename. — verified-primary [Act 709](https://www.pdp.gov.my/wp-content/uploads/2024/07/UNDANG-UNDANG-MALAYSIA_AKTA_PERLINDUNGAN_DATA_PERIBADI_2010_709_MALAY_AND-ENG_V2022.pdf) and [A1727 s.2](https://christopherleeong.com/wp-content/uploads/2024/12/PDPA-Amendment-Act-A1727.pdf)
- s.6(2): the general consent requirement for ordinary personal data is lifted where processing is necessary for performing a contract, or "for the taking of steps at the request of the data subject with a view to entering into a contract" (s.6(2)(a),(b)). This applies to non-sensitive data only (s.6(1)(a)). — verified-primary [Act 709](https://www.pdp.gov.my/wp-content/uploads/2024/07/UNDANG-UNDANG-MALAYSIA_AKTA_PERLINDUNGAN_DATA_PERIBADI_2010_709_MALAY_AND-ENG_V2022.pdf)
- Commencement of A1727 is by Minister's gazette notification, with different dates allowed (A1727 s.1(2)). The DBN manual states s.12B takes effect from 1 June 2025. — verified-primary [A1727](https://christopherleeong.com/wp-content/uploads/2024/12/PDPA-Amendment-Act-A1727.pdf), [DBN manual](https://www.pdp.gov.my/wp-content/uploads/2026/02/Manual_Pengguna_DBN_Bahasa-Melayu_ver2.pdf)
- Phased dates 1 Jan 2025 / 1 Apr 2025 / 1 Jun 2025 (biometric and processor duties on 1 Apr 2025 per the repo's note) — secondary-only (the repo note cites DFDL; search results from Rodl and Legal500 give three phases but disagree in one snippet on the third date). Gazette notification not read.
- The AI consultation paper restates that explicit consent is needed "if required under Act 709" for sensitive data processed through AI, tells controllers to state clearly the categories of sensitive data, purpose and AI use, and to assess whether processing is necessary and proportionate before processing sensitive data through an AI system (paras 9.1 to 9.4). It is a draft; "Tarikh Terbitan: XX XX XXXX", consultation 5 to 23 Oct 2026. — verified-primary [Consultation Paper 1/2026](https://www.pdp.gov.my/wp-content/uploads/2026/10/Kertas_Konsultasi_Awam_Bil_1_2026_Kerangka_AI_Perlindungan_Data_Peribadi-1.pdf)
- A search summary says one source quotes the Bill as "physiological or behavioural" only; the enacted text includes "physical" (confirmed above). — secondary-only, resolved by primary.

### Inferences
- Voice notes sent for speech-to-text and discarded: the output is a transcript, not a template used to identify a person. On the wording, a transcript is probably not "biometric data" but the raw audio is a recording of a "physical/behavioural characteristic"; "technical processing" is undefined. I found no JPDP or court statement either way. Treat as unresolved; the AI paper's necessity and proportionality step (9.4) applies if it is sensitive.
- Customer photos used for OCR or product matching: same reasoning; face recognition or any face-template step would clearly be biometric. A photo that happens to show a face and is not processed to identify is uncertain.
- Chat text and voice notes may incidentally contain health or offence information (sensitive categories that already existed). A quotation chatbot cannot rule that out. Explicit consent (not implied) would be needed for those, absent another s.40 condition.
- The s.6(2)(b) "steps at the request of the data subject with a view to entering a contract" ground plausibly covers a customer asking for a quote, for ordinary data, without relying on implied consent. It does not cover sensitive data.

### Gaps
- No JPDP guideline on biometric data found. No official guidance on whether transcribed audio or photos are biometric.
- Remainder of s.40 list (including the "made public" condition) and PDP Regulations 2013 consent-record rules not read.
- lom.agc.gov.my official copy not fetched.

---

## 2. AI guidance, automated decision making (ADM), planned AI law

### Takeaway
The PDPA (as amended) has no automated decision-making or profiling right. JPDP has proposed one (March 2025 consultation) and a separate AI and personal data framework (Oct 2026 consultation, still a draft that adds no new statutory right). MOSTI's AI governance guidelines are voluntary and an AI Governance Bill is only at consultation stage.

### Cited Findings
- Act 709 and A1727 contain no provision on automated decisions or profiling. The only definitions added are "biometric data" and "personal data breach" (A1727 s.3). — verified-primary (absence in the text I read) [A1727](https://christopherleeong.com/wp-content/uploads/2024/12/PDPA-Amendment-Act-A1727.pdf)
- On 20 March 2025 JPDP issued consultation papers No. 1/2025 (DPIA), 2/2025 (Data Protection by Design) and 3/2025 (Automated Decision Making and Profiling), feedback due 19 May 2025. Proposed ADM rights: refuse decisions made entirely by automated means that significantly affect a person, be informed when ADM is used, ask for human review. "ADM" and "profiling" are not defined in the PDPA. — secondary-only [Allen and Gledhill](https://www.allenandgledhill.com/mm/publication/articles/30468/s-personal-data-protection-department-launches-public-consultations-on-guidelines-for-data-protection-impact-assessments-data-protection-by-design-and-automated-decision-making-and-profiling). I did not find whether these were finalised.
- JPDP Public Consultation Paper No. 1/2026, "AI and Personal Data Protection Framework", Version 1.0 draft Guideline, run 5 to 23 Oct 2026, posted on pdp.gov.my 29 Oct 2026. Content I read: AI use does not create a separate legal basis (para 6 area); notice must disclose AI use, including whether the AI makes or supports decisions affecting the data subject (7.3); new notice (and consent where required) before new AI purposes (7.4); processing subject to existing consent rules (8); sensitive data necessity and proportionality (9.4); controller stays responsible when it appoints an AI service provider, must decide whether the provider is a processor or a third party (21.1 to 21.5); cross-border use of external AI must comply with s.129, with a Transfer Impact Assessment where appropriate and records kept (22.1 to 22.4); existing access, correction, withdrawal of consent and portability rights apply to AI-processed data (24 to 29). Section 31 deals with fairness/unfair outcomes. — verified-primary [Consultation Paper 1/2026](https://www.pdp.gov.my/wp-content/uploads/2026/10/Kertas_Konsultasi_Awam_Bil_1_2026_Kerangka_AI_Perlindungan_Data_Peribadi-1.pdf). It is a draft, issue date blank; whether it is finalised after 23 Oct 2026 is unknown. Cited as made under s.48(g) per Conventus/Rajah and Tann summary (secondary-only).
- MOSTI "National Guidelines on AI Governance and Ethics" (AIGE) launched September 2024; voluntary, non-binding. — secondary-only [Rahmat Lim](https://rahmatlim.com/publication/articles/29430/issues-national-guidelines-on-artificial-intelligence-governance-and-ethics-key-principles); mosti.gov.my not read.
- National AI Office issued a public consultation paper on a proposed AI Governance Bill on 10 July 2026 (comments closed 31 July 2026). Timing of enactment conflicts: Baker McKenzie says tabling in the Dewan Rakyat in early 2027; another site says second half of 2026. — secondary-only [Rahmat Lim](https://www.rahmatlim.com/publication/articles/33265/national-ai-office-issues-public-consultation-paper-on-proposed-artificial-intelligence-ai-governance-bill), [Baker McKenzie](https://www.bakermckenzie.com/en/insight/publications/2026/10/malaysia-consultation-on-proposed-ai-and-personal-data-protection-framework)

### Inferences
- LARIS drafts quotes with AI for the owner to review; the customer is not subject to a solely automated decision. If LARIS ever auto-sends prices without human review, the draft 7.3 disclosure and the proposed ADM rights become relevant.
- No statutory ADM right can be cited against LARIS today; any wording in LARIS text implying one is a product choice, not law.

### Gaps
- Final status of the 2025 ADM, DPIA and DPbD guidelines unknown; the March 2025 paper itself was not read.
- Consultation Paper 1/2026 read via keyword search of Malay text, not line by line; the "definitions" and "fairness" parts not studied.
- MOSTI document and the NAIO bill paper not read.

---

## 3. Commercial-transactions scope, exemptions, SME quotations

### Takeaway
The Act applies only to personal data processed "in respect of commercial transactions", which is defined broadly enough to include supplying goods or services, so SME quotations are inside the Act. No exemption in the text I read removes a quoting SME.

### Cited Findings
- s.2(1): the Act applies to any person who processes, or has control over or authorises processing of, personal data "in respect of commercial transactions". — verified-primary [Act 709](https://www.pdp.gov.my/wp-content/uploads/2024/07/UNDANG-UNDANG-MALAYSIA_AKTA_PERLINDUNGAN_DATA_PERIBADI_2010_709_MALAY_AND-ENG_V2022.pdf)
- s.4 "commercial transactions": any transaction of a commercial nature, whether contractual or not, including matters relating to the supply or exchange of goods or services, agency, investments, financing, banking and insurance. — verified-primary (same).
- s.45(1): exemption for data processed by an individual only for personal, family or household affairs. s.45(2) and s.46 list further exemptions (crime, taxation, etc.; I read only the opening). No SME exemption in the sections I read. — verified-primary (same).
- The DBN manual describes the Act as regulating processing "for commercial transaction purposes". — verified-primary [DBN manual](https://www.pdp.gov.my/wp-content/uploads/2026/02/Manual_Pengguna_DBN_Bahasa-Melayu_ver2.pdf)

### Inferences
- Customer names, phone numbers, chat text and quote history held by an SME are in scope. Staff or supplier contacts in a commercial relationship are also likely in scope.

### Gaps
- Full text of s.45(2), s.46 and the Minister's exemption orders not read in detail. Whether a very small business must register as a data controller depends on Gazette class orders (pdp.gov.my has a "Golongan Pengawal Data" page; not read).

---

## 4. Territorial reach: processor abroad, data processed outside Malaysia

### Takeaway
The user pointed to s.2; the relevant provisions are s.2(2)-(4) and s.3(2). The Act covers a person established in Malaysia even where the data is processed by someone it engages; it excludes data processed wholly outside Malaysia unless it is intended to be further processed in Malaysia. A1727 makes data processors directly liable under the Security Principle and rewrote s.129 on cross-border transfers.

### Cited Findings
- s.2(2)(a): applies to a person established in Malaysia where personal data is processed, "whether or not in the context of that establishment, by that person or any other person employed or engaged by that establishment". s.2(2)(b): a person not established in Malaysia but using equipment in Malaysia (other than transit) is covered and must nominate a Malaysian representative (s.2(3)). s.2(4): a company incorporated under the Companies Act 1965 is treated as established in Malaysia. — verified-primary [Act 709](https://www.pdp.gov.my/wp-content/uploads/2024/07/UNDANG-UNDANG-MALAYSIA_AKTA_PERLINDUNGAN_DATA_PERIBADI_2010_709_MALAY_AND-ENG_V2022.pdf)
- s.3(2): "This Act shall not apply to any personal data processed outside Malaysia unless that personal data is intended to be further processed in Malaysia." — verified-primary (same).
- s.4 "data processor": any person, other than an employee of the data user, who processes personal data solely on behalf of the data user and not for its own purposes. — verified-primary (same).
- A1727 s.4 inserts s.5(1A): a data processor processing on behalf of a controller "shall comply with the Security Principle as specified in section 9"; penalty on contravention raised to RM1,000,000 or 3 years or both (from RM300,000 / 2 years). A1727 s.5 rewrites s.9 so both controller and processor must take practical steps to protect data. — verified-primary [A1727](https://christopherleeong.com/wp-content/uploads/2024/12/PDPA-Amendment-Act-A1727.pdf)
- A1727 s.12 deletes the s.129(1) whitelist and rewrites s.129(2): "A data controller may transfer any personal data of a data subject to [a place outside Malaysia if...]" the existing conditions (consent; necessary for contract with the data subject; necessary for a contract with a third party at the data subject's request or in their interest; legal proceedings; avoidance of adverse action; reasonable precautions and due diligence that the data will not be processed in a way that would contravene the Act; etc.). Paragraph (h) (Minister's other cases) is deleted. I read the original conditions and the amending text; the amended s.129 itself was not read as a consolidated text. — verified-primary (same Act and A1727)
- The AI paper (22.1 to 22.4) treats use of an external AI system that sends data abroad as a s.129 transfer needing a TIA "with reference to the applicable Cross-border Transfer Guidelines issued by the Commissioner" and records. Draft. — verified-primary [Consultation Paper 1/2026](https://www.pdp.gov.my/wp-content/uploads/2026/10/Kertas_Konsultasi_Awam_Bil_1_2026_Kerangka_AI_Perlindungan_Data_Peribadi-1.pdf)

### Inferences
- A Malaysian SME is the controller; its sending of customer data to an overseas AI vendor is a s.129 transfer needing one of the s.129(3)-type conditions (consent, contract necessity, or reasonable due diligence). The vendor's own liability as a processor depends on whether it is within s.2 at all; s.3(2) may exclude it unless the data comes back to be further processed in Malaysia, which for LARIS it does (replies and stored quotes). That is an interpretation for the lawyer.
- If LARIS (as a provider) is a Malaysian company it is itself "established in Malaysia" (s.2(4)(b)) and a processor under s.5(1A)/s.9.

### Gaps
- Commissioner's Cross-Border Transfer Guideline (and any TIA template) not read. Whether it was issued in final form: unknown.
- Remaining s.129(3) conditions (f) to (g) cut off at the page break; read original only.

---

## 5. Breach notification, DPO, portability (statute vs guideline)

### Takeaway
The statute says "as soon as practicable" (Commissioner) and "without unnecessary delay" (affected people, only where significant harm). The 72-hour, 7-day and 2-year figures come from the Commissioner's guideline, which I did not read; the Commissioner's own DBN manual does confirm the significant-harm factors and the more-than-1,000 scale test.

### Cited Findings
- s.12B(1): a data controller with reason to believe a personal data breach has occurred "shall, as soon as practicable, notify the Commissioner in the manner and form as determined by the Commissioner". s.12B(2): if the breach "causes or is likely to cause any significant harm to the data subject", notify the data subject "without unnecessary delay". s.12B(3): contravention of (1) is an offence, fine up to RM250,000 or imprisonment up to 2 years or both. No penalty stated for (2). — verified-primary [A1727 s.6](https://christopherleeong.com/wp-content/uploads/2024/12/PDPA-Amendment-Act-A1727.pdf)
- "Personal data breach": any breach, loss, misuse or unauthorised access of personal data (A1727 s.3(d)). — verified-primary (same)
- DBN manual (Feb 2026): s.12B and Circular No. 2/2025 in force from 1 June 2025. Notify when a breach has or is likely to cause significant harm where it: can cause physical injury, financial loss, negative effect on credit record, damage/loss of property; can be misused for unlawful purposes; contains sensitive personal data; combines data that could enable identity fraud; or is "of significant scale" if affected data subjects exceed 1,000. Reporting is online at daftar.pdp.gov.my (module DBN). — verified-primary [DBN manual](https://www.pdp.gov.my/wp-content/uploads/2026/02/Manual_Pengguna_DBN_Bahasa-Melayu_ver2.pdf). I only read lines 40 to 110; the 72-hour figure did not appear in the text I searched (grep for "72" and "jam" returned no hit).
- 72 hours "from when the personal data breach occurred" (late notice needs written explanation and evidence); data subjects "no later than 7 days after the initial notification to the Commissioner"; more than 1,000 subjects triggers Commissioner notice only; all breaches to be logged in a register "at least 2 years". — secondary-only [CMS](https://cms.law/en/sgp/legal-updates/new-guidelines-on-mandatory-breach-notifications-under-malaysia-s-personal-data-protection-act-2010). Conflict: another search summary says the 72 hours run from discovery ("from when a personal data breach is discovered"); the repo vault note also says firms disagree. Guideline issued 25 Feb 2025, effective 1 Jun 2025 (secondary).
- A1727 s.6 inserts s.12A: a data controller shall appoint one or more data protection officers accountable for compliance, and a data processor processing on its behalf shall likewise; the controller must notify the Commissioner of the appointment in the manner the Commissioner determines; appointment does not discharge the controller. No size or sensitivity threshold appears in the statute. — verified-primary [A1727](https://christopherleeong.com/wp-content/uploads/2024/12/PDPA-Amendment-Act-A1727.pdf). Commencement 1 June 2025 and any thresholds in the guideline: secondary-only or unverified (CMS result did not state thresholds; DPO manual not read).
- s.43A portability: a data subject may ask the controller, by written notice by electronic means, to transmit their personal data to another data controller of their choice directly, subject to technical feasibility and format compatibility; completion within a period "as may be prescribed". — verified-primary [A1727 s.9](https://christopherleeong.com/wp-content/uploads/2024/12/PDPA-Amendment-Act-A1727.pdf)
- Access: s.31(1) controller must comply with a data access request not later than 21 days from receipt; if unable, tell the requestor before the 21 days end and comply within a further period (s.31(2) opening seen). Correction (which includes deletion in the Act's definition) also 21 days (s.35). — verified-primary [Act 709](https://www.pdp.gov.my/wp-content/uploads/2024/07/UNDANG-UNDANG-MALAYSIA_AKTA_PERLINDUNGAN_DATA_PERIBADI_2010_709_MALAY_AND-ENG_V2022.pdf)
- Retention Principle s.10: data not kept longer than necessary for the purpose; controller must take all reasonable steps to destroy or permanently delete data no longer needed. No fixed period. s.38: data subject may withdraw consent by written notice. The Act has no stand-alone right to erasure on request. — verified-primary (same)

### Inferences
- Statute alone does not give the 72h or 7-day figures; the app's labels depend on a guideline a lawyer must read.
- "Erase on request" is a LARIS feature, not a statutory right. The legal hooks are s.10 (retention), s.38 (withdrawal of consent) and s.34/35 (correction includes deletion).

### Gaps
- Guideline text (DBN, DPO, portability), Circular 2/2025, DPO thresholds, and breach register required fields: not read.
- Whether the 72-hour clock runs from occurrence or awareness: sources conflict, unresolved.

---

## 6. Part B: LARIS privacy wording that depends on law, with file:line

Paths are under C:/LARIS. "V" = verified-primary status of the law point from sections 1 to 5; "S" = secondary-only; "N" = no source found.

### Takeaway
Most legal claims in LARIS are flagged by the repo itself as unverified. Items that conflict with, or are not backed by, what I verified: the notice is not given in both national and English languages (s.7(3)); the deadline text for access and "within the time the law gives" omits the statutory 21 days; "move my data" is not s.43A portability; notice content omits several s.7(1) items; consent-by-continuing is not backed by any source; some AI-paper items are drafts.

### Cited Findings (each repo claim, with law status)

**Notice wording and language**
- `src/api/bot_text.py:15-18` (en) and `:34-38` (ms) the privacy notice: what is kept, voice notes transcribed and audio not kept, who can see it, "By continuing to message us you accept this", commands. Law: s.7(1) written notice must cover (a) description of the data, (b) purposes, (c) source, (d) right to access and correct and how to contact, (e) classes of third parties, (f) choices to limit processing, (g) obligatory or voluntary, (h) consequences (V). The text covers a partial (a), (b) loosely, (e) generically ("services that run our chat and AI reading"); it does not state the right to correct, obligatory/voluntary, choices to limit, or overseas processing. V
- `src/api/bot_text.py:9,25` and `docs/privacy-and-breach-runbook.md:82`: notice is English OR Malay following the bot language setting; WhatsApp "uses English". **Contradicts s.7(3)**: "A notice under subsection (1) shall be in the national and English languages" and choice means likewise. Mandarin and Tamil notice not required by the Act. V
- `docs/privacy-and-breach-runbook.md:82`: "existing customers are not re-shown it automatically" after `notice_version` change; the draft AI paper 7.4 says new or amended notice before new AI purposes. Draft only (V for the text, but it is a draft).
- `src/api/bot_text.py:16-18`: "By continuing to message us you accept this". Law: s.6(1)(a) consent for ordinary data, s.6(2)(b) alternative basis for taking steps toward a contract at request of the data subject (V); no source found saying a chat notice plus continuing is "consent" or "explicit consent". Runbook itself says unconfirmed (`:85`, `:89`). N for sufficiency; PDP Regulations 2013 not read.
- `src/api/bot_text.py:19,39` DPO contact line "data protection contact": s.12A DPO duty (V text; threshold/commencement S/unverified).
- `src/api/bot_text.py:20-22,40-42` replies to /forget, "erased", "kept ... because it must keep some records": no statutory erasure right (V, see section 5); the "must keep" wording is a business statement; the repo ties it to financial records (`web/src/Privacy.tsx:245`, `:300`). Retention law for quotes (tax records) not researched. N.
- `src/api/bot_text.py:23,43` /mydata: relates to access (s.30, 21 days under s.31). V. Not portability.

**Deadlines**
- `docs/privacy-and-breach-runbook.md:26` "Reply within the time the law gives (check the vault note)" for deletion; `:84` "Decide within the time the law gives (confirm in the vault note)"; `:89` lists "the time limit for answering an access or erasure request" as unverified; `knowledge/04-regulation/pdpa-malaysia.md` has no such time limit. Law: access 21 days, correction 21 days (s.31, s.35) V; no erasure period exists (V). Health warns after 3 days pending (`runbook:84`): product choice, not law.
- `src/api/privacy.py:20-21` RULE_NOTE: "72 hours to the Commissioner and 7 days to the people affected, as we understand the Commissioner's guideline". 72h and 7d: S only. Statute says "as soon as practicable" / "without unnecessary delay" (V).
- `src/api/privacy.py:107` Commissioner due = `detected_at + 72h`. Law: S, and sources conflict on whether the 72h runs from occurrence (CMS) or discovery. If occurrence, the app's due time can be later than the guideline's.
- `src/api/privacy.py:108` subjects due = `commissioner_notified_at + 7 days` and only if `significant_harm`. S for the 7 days; statute requires subject notice where harm is likely (V) and the DBN manual lists significant-harm factors including sensitive data and identity fraud combos (V). The app relies on an owner tick box (`web/src/Privacy.tsx:83`); the guideline factors are not asked.
- `src/api/privacy.py:22,106` notifiable if `significant_harm` OR `people_affected > 1000` (SCALE). DBN manual lists >1,000 as a "significant scale" factor (V). Strictly CMS says 1,000 on its own requires Commissioner notice only (S).
- `web/src/Privacy.tsx:116` UI says "You must report this one (serious harm or many people)"; the "not required by the rule we check" line is the same logic; the DBN manual's factors (a) to (d) (financial loss, misuse, sensitive data, identity fraud) are broader than a tick box (V).
- `docs/privacy-and-breach-runbook.md:49-51` same 72h / 7 days / "more than 1,000"; `:47` "register is kept for at least 2 years" — 2 years: S (CMS). The Act has no register requirement (V, absence).
- `docs/privacy-and-breach-runbook.md:89` lists these as unverified; consistent with my findings.

**Breach register fields**
- `src/api/privacy.py:73-81` and `web/src/Privacy.tsx:10-14`: detected_at (with time zone), summary (no personal data), data_types, people_affected, significant_harm, commissioner_notified_at, subjects_notified_at, notes, status. Required register fields in the Guideline: N (not read). Rows cannot be deleted (db trigger, `runbook:47`) — design choice; also says it is kept "at least 2 years" (S).
- `web/src/Privacy.tsx:168` "Incidents are kept as a record and cannot be deleted" and `:175` "Confirm the deadlines at pdp.gov.my" (good hedge). The runbook does not mention the daftar.pdp.gov.my online DBN portal (V from DBN manual).

**DPO**
- `web/src/Privacy.tsx:40` UI text: "Malaysian privacy law (PDPA) asks a business to publish a contact person". s.12A requires appointing a DPO and notifying the Commissioner (V); "publish" is not in A1727 s.6. A publish-contact duty probably comes from the guideline (N). Zh/ms/ta versions same claim.
- `web/src/Privacy.tsx:249` "contact your privacy contact (DPO)": equates the contact with a DPO. The runbook `:43` says "a name and one contact". s.12A needs the DPO to be notified to the Commissioner (V); the app does not record Commissioner notification of DPO appointment. `docs/privacy-and-breach-runbook.md:89` lists the 1 June 2025 DPO start and small-business application as unverified; statute shows no small-business carve-out (V), thresholds in the guideline (N).
- `knowledge/04-regulation/pdpa-malaysia.md:14` "mandatory DPO (controllers AND processors)" matches A1727 s.6 (V); 1 Jun 2025 date S.

**Retention, erase vs retain**
- `docs/privacy-and-breach-runbook.md:17,66`: chat text blanked after `RETENTION_DAYS` (default 180); supplier reply text cleared at 180 days; catalog/request images at 90 days; `ai_calls` purged at 90 days (`:111`). s.10 requires no fixed number (V); periods are a design choice with no legal source.
- `web/src/Privacy.tsx:244-245,299-300` and `runbook:59-61`: erase removes name, contact, email, address, notes, message text; keeps quotes, lines, dates, prices ("as financial records"), earlier audit log rows. Law basis for keeping quotes as financial records: N (tax/accounting retention law not researched). s.10(2) requires deletion when no longer needed (V).
- `web/src/Privacy.tsx:300` and `runbook:62`: vendors (Telegram, Meta, AI providers) keep their own copies; honest limit. Whether LARIS (as processor) must flow deletion to sub-processors: N.
- `runbook:85`: "/mydata includes the owner's notes on that customer". Access request scope vs s.32 refusal grounds: N.

**Portability**
- `docs/privacy-and-breach-runbook.md:27`: "What do you hold about me / move my data" answered with a JSON export to the person. s.43A is transmission to another controller "directly" by the controller, by written electronic notice (V). A downloadable JSON is an access answer, not obviously s.43A compliance. `src/api/privacy.py:185` labels the endpoint "Access / portability for the owner". `knowledge/...:14` portability date S. Prescribed completion period: N.

**Cross-border and AI**
- `docs/privacy-and-breach-runbook.md:20,78`: text to ILMU (contact details and NRIC masked), audio to ILMU or RunPod, messages via Meta and Telegram; "Processing agreements and data regions are not confirmed". s.129 (V) needs a recognised condition (consent, contract necessity, due diligence). `web/src/Privacy.tsx:300` tells the owner "AI providers keep their own copies"; the customer notice (`bot_text.py:15-17`) says services process it but not that this can be outside Malaysia. AI paper 7.3 and 22 are draft (V as draft). `runbook:113` "Cross-border transfer: the notice names the provider" refers to the AI settings notice, not the chat notice.
- `docs/privacy-and-breach-runbook.md:95,101`: owner must tell customers that questions typed in the app can go to an AI provider; masking misses addresses and non-contact names (`:95`, `docs/technical-debt.md:11`). Law: no source; masking is not a legal test.
- `docs/technical-debt.md:20` row 10: v2 RAG notice not read by a lawyer; consent recorded per business, not per customer. Consistent with s.7 and AI paper 7.1 to 7.4 (notice goes to data subjects) (V as draft).
- `knowledge/04-regulation/pdpa-malaysia.md:21`: dates the consultation paper "5 Oct 2026" and "Not yet law": correct (V). Line 24: "LARIS is a processor for the SME (controller)" consistent with s.4 definition (V); line 25: "Voice notes: plain transcription is not biometric identification, but unconfirmed" consistent with my finding that no source settles it.
- `docs/privacy-and-breach-runbook.md:66` and notice: "audio is not kept". A claim of fact, not law; but it matters for s.7(1)(a) and for biometric analysis (nothing retained to match a person).

**Other**
- `docs/privacy-and-breach-runbook.md:3` and `:87-89` "Unverified legal claims" paragraph: still accurate; this note moves two items to verified: DPO duty exists for controllers and processors (s.12A, V) and portability exists (s.43A, V), and makes 72h/7d/2y still secondary-only.
- `web/src/Privacy.tsx:175`, `runbook:52`: "deadlines must be confirmed at pdp.gov.my" is a hedge; the pdp.gov.my DBN page is only a stub linking a user manual (V).
- `docs/technical-debt.md` contains no privacy-law claims other than row 10; rows 1 to 3 describe masking limits.

### Inferences
- Most urgent for a lawyer: (1) s.7(3) bilingual notice and the missing s.7(1) items; (2) whether the "continue to message = accept" notice is enough consent for ordinary and any incidental sensitive data; (3) s.129 basis for overseas AI/ASR vendors, now with no whitelist; (4) the 72h clock start, 7-day, and 2-year figures from the guideline; (5) DPO notification to the Commissioner; (6) whether a JSON export counts as access (21 days) or portability; (7) whether keeping quotes after /forget is backed by a retention law.

### Gaps
- Tech-and-tools declaration, privacy text in other web files, `src/webhooks` code and the AI-settings notice (`ai_guide.py`) were not in the requested file list and were not read, so the AI notice wording is not audited here.
- No file was edited.

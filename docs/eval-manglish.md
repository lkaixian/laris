# Measuring ILMU accuracy on Manglish (practical protocol)

Why: the README says ILMU speech and extraction are not yet validated on real Manglish audio, and ILMU publishes no accuracy numbers. This is how we measure it ourselves and report it honestly. Nothing here needs new installs.

## A. Typed enquiries (extraction)

60 invented enquiries live in `tests/fixtures/enquiries_eval.jsonl` (made_to_order template, about 14 adversarial: price injection, words for numbers, mixed units, typos, two items).

```
python scripts/eval_enquiries.py --fake                 # offline check that the tool works (a stub, NOT a model result)
set ILMU_API_KEY=...                                    # PowerShell: $env:ILMU_API_KEY="..."
python scripts/eval_enquiries.py --live --json out.json # real calls, 0.5 s apart, max 60 (--max N to cap)
python scripts/eval_enquiries.py --live --catalog       # also lets the model answer with raw material keys
```

Live mode uses the same prompt schema, `redact()` and price-key check as `handle_enquiry`. Note: the real schema only allows recipe keys (signboard_60x30, plywood_shelf, print_part_small, design_service). Lines asking for raw materials (pla hitam, skru m4) can only score fully with `--catalog`; run both and report both, and tell the team if the gap matters. Cost: the tool prints an approximate token count (characters divided by 4) because ILMU responses are not read for usage; multiply by the current ILMU price.

## B. Voice notes (speech to text)

1. Record 20 voice notes, 5 to 20 seconds each, in Telegram itself (hold the mic) so the file is ogg/opus exactly as the bot receives it. Save them from Telegram (Save As) or take them from the bot's inbox.
2. Vary things on purpose: at least 5 different speakers, 2 accents or first languages (Malay, Chinese-Malaysian, Indian-Malaysian, Sabah/Sarawak if possible), quiet room, shop floor noise, car or street, fast and slow speech, and some Malay/English code switching mid-sentence. Say real enquiries (item, quantity, material, deadline), including numbers and sizes like "60 kali 30".
3. Name each file by id: `v01.ogg` ... `v20.ogg` in one folder.
4. Write `refs.csv` with columns `id,reference`. The reference is what was actually SAID, word for word, typed by a person who listened (not what was meant, not corrected spelling, no guessing from the hypothesis). Write numbers the way you want them judged and keep it the same everywhere (all digits or all words). Two people should agree on each line.
5. Run:
```
python scripts/eval_wer.py --live --audio-dir clips --refs refs.csv --save-hyp hyp.csv
python scripts/eval_wer.py hyp.csv        # re-score later without more API calls
```
Text is lowercased and punctuation removed before comparing. WER counts word substitutions, insertions and deletions over reference words; CER does the same per character. The 5 worst clips are printed so you can see what went wrong (usually numbers, product names, or code switching).

## C. Reading the numbers

- WER 10% means about 1 word in 10 is wrong. One wrong digit can ruin an order, so also look at the worst-5 list for numbers and item names, not only the average.
- Extraction: "full line correct" is the number that matters (right item and right quantity). Price-key outputs must be 0; any other value is a bug to fix before the pitch.
- Refusal rate on unclear and non-order lines should be high; a low value means the model invents orders.
- Staff always review the draft quote, so errors cost time, not money. Say that, but do not use it to hide the numbers.

## D. Results table (paste into the PRD)

| Test | n | Speakers / conditions | Metric | Result | Date | Model |
|---|---|---|---|---|---|---|
| Voice to text (real audio) | 20 | 5 speakers, quiet + noisy | WER / CER | _% / _% | | ilmu-asr-v4.2 |
| Enquiry extraction (synthetic text) | 60 | typed, invented | full line correct | _/40 | | ilmu-mini-v3.3 |
| Enquiry extraction, refusal on unclear | 60 | typed, invented | refused / 20 | _/20 | | ilmu-mini-v3.3 |
| Price keys in AI output | 60 | typed, invented | count | 0 | | ilmu-mini-v3.3 |

## E. Honesty rules

- Never quote a number without n (how many clips or lines) and the conditions (speakers, noise, device).
- The typed enquiries are synthetic and written by us. Passing them is NOT real-world accuracy; real customers write differently.
- 20 clips is a small sample: say "on 20 clips from N speakers", not "ILMU is X% accurate".
- `--fake` output is the tool testing itself. Never show it as a result.
- Report the bad results too, with the fix we plan. Re-run and re-date after any model or prompt change.
- Voice recordings of real people need their consent; use team members or consenting volunteers and do not commit the audio.

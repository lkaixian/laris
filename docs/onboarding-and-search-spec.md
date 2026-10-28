# Guided tour and Ctrl+K search: flow sketches (no code yet)

Status 2026-10-29. Sketch for approval. Pages and paths below are the real ones from `web/src/Shell.tsx` (NAV), `web/src/App.tsx` (PAGES) and `docs/roles.md`.

## 1. First-run question

Shown once after sign-in, as a small card (not a blocking page) on top of Home:

```
+--------------------------------------------------+
|  Welcome to LARIS, Aisyah.                       |
|  Is this your first time using LARIS?            |
|                                                  |
|  [ Yes, show me around (about 2 minutes) ]       |
|  [ No, I have used it before ]                   |
|                                  Ask me later    |
+--------------------------------------------------+
```

```
sign in
  |
  v
tour already answered? --yes--> Home (no card)
  |no
  v
card
  |-- Yes ------> tour for the person's kind (owner or staff) --> done, remembered
  |-- No -------> card closes, never asked again (tour stays under "Help > Take the tour")
  |-- Ask later -> card returns on the next sign-in (max 2 times, then treated as No)
```

Kind of tour follows what the person can do, not the word on their badge: owner tour if they hold owner permissions, otherwise the staff tour, with steps they cannot open removed (custom roles included).

Stored per user on the server (so it follows them to another phone), with a local fallback: `{ tour: "owner" | "staff", state: "done" | "skipped" | "later", step }`.

Wording note: you wrote "if no then we follow the tutorial, if yes, not wasting their time". I read it as: first-timers get the tour, returning users skip it. Tell me if you meant the reverse.

## 2. How a step behaves

```
 dimmed page, ONE element highlighted (real button, real page)
        +------------------------------+
        |  3 of 8                      |
        |  Connect your Telegram bot   |
        |  Customers message this bot  |
        |  to ask for quotes.          |
        |                              |
        |  [Back]  [Next]    Skip tour |
        +------------------------------+
```

- Anchors on real elements through `data-tour="channels-telegram"` attributes, so a step cannot point at something that moved.
- Two kinds of step: "look" (Next) and "do it" (the highlighted element is clickable and the step advances when the person really does it, for example opens Team).
- The tour navigates for them (hash route) when the next step is on another page.
- Esc or Skip ends it. Back works. A progress count is always visible. Keyboard: focus moves into the card, Tab stays inside, focus returns afterwards. Screen readers get the step text in a polite live region.
- Motion 1: no animation beyond a fade; respects reduced-motion.
- If the target is missing (permission, empty data) the step is skipped, never stuck.
- Resumable: leaving halfway and returning offers "Continue the tour (step 4 of 8)".

## 3. OWNER tour (8 steps, about 2 minutes)

```
 1 Home            "This is your day at a glance."         look    #/home
 2 Settings        Business name, logo, trade template     do it   Admin > Settings
 3 Channels        Connect your Telegram bot (BotFather)   do it   Admin > Settings > Channels
 4 Team            Invite staff, then "Link Telegram"      do it   Admin > Team
 5 Try it          "Send 50 kg PLA, how much? to your bot" look    waits up to 60 s for the first
                   (tour waits for the first draft quote;           enquiry, else "Skip, I will try later"
                   no bot yet: use Simulate enquiry)
 6 Tracker         Open the draft: lines, prices from      do it   Work > Tracker > open quote
                   your cost book, margin check
 7 Approve + send  Approve (owner only), then Send         look    Work > Tracker > quote > Approve > Send
 8 Follow through  Track, Follow-ups, Jobs after a "yes"   look    Work > Track / Follow-ups / Jobs
 done              "Press Ctrl+K any time to find anything."  ends with the Ctrl+K hint and the
                                                                    existing "Get started" checklist on Home
```

## 4. STAFF tour (5 steps, about 1 minute)

```
 1 Welcome         What staff do here and what stays with     look    #/home
                   the owner (approval, costs, margins)
 2 Link Telegram   Account > Link my Telegram, open the link  do it   (avatar) > Account
                   on your phone and press Start
 3 Add a price     Send a supplier PDF or photo to the bot,   look    Telegram, or Work > Tracker > Upload quote
                   or a product photo captioned /catalog
 4 Review          Documents to review: fix a flagged line,   do it   Work > Tracker > Needs review
                   then it waits for the owner
 5 Ask suppliers   Photograph an item, ask suppliers          look    Suppliers > Ask suppliers   (only if allowed)
 done              "Ctrl+K finds anything."
```

Steps the person's role cannot open (for example Catalog photos, Ask suppliers) are dropped automatically.

## 5. Search bar with Ctrl+K

Header field with the key hint, always visible on desktop; an icon on phones (no key hint on touch):

```
+------------------------------------------------------------+
|  LARIS | Org        [ Search or jump to...    Ctrl K ]   (avatar)
+------------------------------------------------------------+
```

Press Ctrl+K (Cmd+K on Mac) or `/` and the palette opens over the page:

```
+----------------------------------------------------+
|  invi                                         Esc  |
+----------------------------------------------------+
|  FUNCTIONS                                         |
|  [users] Invite a team member                      |
|          Admin > Team > Invite                     |
|  [key]   Link Telegram for a person                |
|          Admin > Team > Link Telegram              |
|  [mail]  Resend an invite                          |
|          Admin > Team > Invites > Resend           |
|  RECORDS                                           |
|  [doc]   Q-2026-014   Aisyah Signs                 |
|          Work > Tracker > Q-2026-014               |
|  Up/Down to move   Enter to open   Esc to close    |
+----------------------------------------------------+
```

Each row = function name on top, "where to click" breadcrumb underneath, as you asked.

Rules:
- Functions come from one registry file (`web/src/functions.ts`): `{ id, label, keywords[], path: ["Admin","Team","Invite"], href, needs?: permission }`. One place to edit when a page is added, same idea as NAV today.
- The registry is filtered with the same checks the sidebar uses (`canOpen`, `can`), so staff never see "Approve a quote" or "Margin report".
- Matching: simple fuzzy on label plus keywords and synonyms ("invite", "add staff", "BotFather", "export pdf", "licence", "cost", "approve").
- Records (contacts, quotes, cost items) come from the existing `/api/search`, grouped under "Records", debounced, only when 2 or more characters.
- Empty query: "Recent" (last 5 opened, local) and "Try: invite, export, approve".
- No match: "Nothing matches 'xyz'. Try: invite, export, quote." plus "Search records for 'xyz'" (opens the existing Search page).
- Enter opens the target. For in-page actions the breadcrumb can also "show me": it navigates and highlights the control with the same spotlight the tour uses.
- "Take the tour" and "Link my Telegram" are themselves functions in the registry.
- Accessibility: `role="combobox"` input with a `listbox`, `aria-activedescendant`, Esc closes and returns focus, focus trap, results announced ("5 results"), works with the keyboard only, full-screen sheet on phones at 360px, no new colours (DESIGN.md).

## 6. Build stages (after approval)

1. Function registry + Ctrl+K palette + header field (files: new `web/src/functions.ts`, `Palette.tsx`, small edits in `Shell.tsx`; no backend).
2. Tour engine: spotlight, step card, `data-tour` anchors, resume, reduced motion (new `Tour.tsx`, anchors added in Shell/Home/Channels/Team/Tracker).
3. Owner and staff step content + first-run card + "Help > Take the tour" (new `tours.ts`, `FirstRun.tsx`).
4. Server memory of the answer: `users.onboarding` jsonb, `GET/POST /api/me/onboarding`, test that it is per user and tenant-safe.

Acceptance: keyboard-only path through both tours, Esc at every step, 360px width without overflow, both themes AA, a missing target never blocks, `npm run build` green, a test that staff do not see owner-only functions in the palette.

## 7. Questions for you

1. Confirm the reading of the first-run question (first-timers get the tour).
2. Owner step 5 waits for a real message to the bot. If no bot is connected yet, is the "Simulate enquiry" button acceptable for the tour?
3. Languages: English only for now, or English and Bahasa Melayu text for the tour and palette labels?

Replies:
1. First-timers get the tour, returning users skip it.
2. "Simulate enquiry" is acceptable for the tour.
3. English and Bahasa Melayu for the tour and palette labels.

Suggestion: 
1. To improve the owner tour step 5, when no bot is connected yet, maybe we can add a bot for the new user after they complete the tour? (this is more likely to be used) (You can add a button to ask)

2. Instead of just "Simulate enquiry", can we add a button to link a bot for the new user after they complete the tour? (the similar as question 1 but instead of adding a bot, it will link the bot for the new user) (the similar as step 3 in staff tour but instead of linking a bot, it will ask the user to link a bot)

2a. As a normal user, I don't think they would know how to create the bot themself either, maybe could we automate this step of bot creation? 

3. Add more keywords for the functions in the registry.

4. Add keyboard shortcuts for the tour: "n" for next, "p" for previous, "s" for skip, "e" for esc.

5. Add keyboard shortcuts for the palette:
   - "/" or "ctrl+k" to open the palette
   - "esc" to close the palette
   - "enter" to select the function
   - "arrow up" and "arrow down" to move between functions

6. Petition to show the last step of the F.A.Q. page as a step in both owner and staff tour? And maybe we can add more relevant steps to the tour from the F.A.Q. page?

6a. The F.A.Q. idealy shouldn't separate into roles, that would make things complicated fast, and showing all of the relevant steps to solving or navigating such features? like how the normal wiki does. Then adding a ? button next to the features or functions in the sidebar would be a good way to show the F.A.Q. page? 
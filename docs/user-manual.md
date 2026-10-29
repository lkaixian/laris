# LARIS User Manual

For owners and staff. Matches the app on master at build log row 160. A live, editable copy of this manual is kept as a Claude doc ("LARIS User Manual"); this file is its snapshot in the repository.

- **Who it is for:** owners and staff of a made-to-order shop (signage, printing, 3D printing) using LARIS to quote and track work.
- **Roles:** the **Owner** can do everything. **Staff** see what their role allows; a button you lack permission for says which permission is missing. Owners create custom roles under **Roles**.
- **Demo data:** the public demo uses synthetic data only. The demo login is in the README.

## Chapter 1: System navigation

Everything is reached from the left sidebar or the search bar at the top; the user menu holds help, the tour, language and sign out.

### 1.1 Sign in

1. Open the LARIS web address in your browser.
2. Type your email and password, then select **Sign in**.
3. Forgot your password? Select **Forgot password?** on the sign-in screen and follow the emailed link.

### 1.2 Find your way with the sidebar

| Group | Pages |
| --- | --- |
| Work | Home, Tracker, Track, Jobs, Follow-ups |
| Suppliers | Contacts, Ask suppliers, Catalog photos, Stale costs |
| Insights | Activity, Assistant |
| Admin | Team, Roles, Settings, Privacy and data, API access, AI settings, System status, Licence |

1. Select a page name in the sidebar to open it.
2. Select the small **?** beside a page name to open its help article.
3. On a phone, open the menu button at the top left to show the sidebar.

### 1.3 Jump anywhere with the command palette

1. Press **Ctrl+K** (Cmd+K on a Mac) or **/**, or select the search field at the top.
2. Type a few letters of a page, an action, a quote number or a customer name.
3. Use the **Up** and **Down** arrow keys to pick a result, then press **Enter**. **Esc** closes it.

> **Pro-Tip:** the palette understands English and Bahasa Melayu: "sebut harga" finds the same pages as "quote".

### 1.4 Help, tour, language and theme

1. Select your avatar at the top right to open the user menu.
2. Choose **Help** for the 17 help articles, or **Take the tour** for a guided walk through the main screens.
3. Under **Language**, choose **English**, **Bahasa Melayu**, **中文** or **தமிழ்**. The page redraws in that language and the choice is remembered on this browser.
4. Select the moon or sun button in the header to switch between dark and light themes.
5. Select **Sign out** when you finish on a shared computer.

> **Note:** Chinese and Tamil cover the menus, status labels and the Jobs, Follow-ups, Track, Activity and Assistant screens. Other pages, server messages and Assistant answers stay in English; help, tour and palette are in English and Malay. The translations have not yet been reviewed by native speakers.

## Chapter 2: Managing jobs

A job is the work you owe a customer; the Jobs page shows every job as a card on a three-column board or a one-week agenda.

### 2.1 How a job is created from a quote

1. Open the quote from **Tracker**.
2. When the customer says yes, select **Record customer accepted** (owner only).
3. Select **Create job from quote**. The quote moves to **Job created** and a card appears in **To do** on **Jobs**.
4. If you sent the customer an accept link, the job is created by itself when they type their name and accept.

> **Note:** the accept link is a simulated e-signature, labelled so in the app, not a legally binding signature.

### 2.2 Create a job by hand

For work that did not start as a quote, such as a repair or a site visit.

1. Open **Jobs** and select **New job** at the top right.
2. Type a **Title** (required, up to 200 characters).
3. Optionally choose a **Customer**, type an **Amount in RM**, pick a **Due date**, an **Assignee** and a **Priority**, and add **Notes**.
4. Select **Create job**. It appears in **To do** with a **Made by hand** badge.

> **Note:** the amount is what you type; the rules engine does not price it, and the job has no quote, PDF or accept link. Needs the **manage contacts** permission.

### 2.3 Read a job card

- the quote number (opens the quote) and the customer, or the title for a job made by hand
- a short summary and the total
- the due date in words: **Due in 3 days**, **Due today**, or **Overdue by 2 days** with an **Overdue** chip
- the priority and who it is assigned to
- buttons to move it, and **Edit**

### 2.4 Move a job through its stages

1. On the card, select **Move [job] to In progress** when work starts.
2. Select **Move [job] to Done** when it is delivered. A message confirms the move.

> **Pro-Tip:** moving needs **manage contacts**. Without it you can still see the board.

### 2.5 Set the due date, assignee, priority and notes

1. On the card, select **Edit**.
2. Set **Due date**, **Assignee** (staff can only pick themselves or Unassigned), **Priority** and **Notes** (up to 2,000 characters).
3. Select **Save [job]**. Only the fields you changed are sent.

### 2.6 Filter the board and plan the week

1. **Mine** shows jobs assigned to you; **Overdue** shows late jobs; **Status** shows one column.
2. Select the cross on a filter chip to remove it, or **Clear all**.
3. Select **Agenda** for a Monday-to-Sunday week (Malaysia time). Use **Previous week**, **This week** and **Next week**.

## Chapter 3: Tracking follow-ups

When a customer has not answered a sent quote within the follow-up window (48 hours for made-to-order), the quote lands on **Follow-ups** with a ready message for you to send or skip.

### 3.1 See what is overdue on Track

1. Open **Track**. Choose a **Kind**: All, Quotes, Supplier documents, Asks or Catalog.
2. Select **Overdue** to show only late items; each carries an **Overdue** chip with its reason.
3. The **Time in stage** column shows each open item's age colour and days, for example "Late, 5 days".
4. Select **Board** to see customer quotes as columns.

| Reason shown | When it appears |
| --- | --- |
| expires soon | the quote's valid-until date is 3 days away or has passed |
| quote waiting for approval/sending | a draft or approved quote is more than 3 days old |
| no reply since sent | sent or opened, no decision after the follow-up window |

### 3.2 Read the age colours

| Colour | Band | Days waiting |
| --- | --- | --- |
| Green | Fresh | 0 to 1 |
| Yellow | Waiting | 2 to 3 |
| Orange | Late | 4 to 7 |
| Red | Stale | 8 or more |

1. The **Age colours** legend above the list shows the bands; on Track it also counts items in each.
2. On **Track**, choose a band in the **Age** filter.
3. On the Track board and on **Follow-ups**, each card has a coloured left edge in its band.
4. On **Follow-ups**, select **Fresh**, **Waiting**, **Late** or **Stale** to show one band.

> **Pro-Tip:** work the red cards first. The chip always names the band and the days, so the colours also work for colour-blind readers and in dark mode.

> **Note:** age colours only count days; the **Overdue** chip follows the rules in 3.1.

### 3.3 Act on a follow-up

1. Open **Follow-ups**. Cards are sorted longest wait first.
2. Read the suggested message; select the quote number to check the quote first.
3. Select **Send follow-up for [quote]**, or **Skip [quote]** if you already called the customer.

> **Pro-Tip:** nothing is sent without you. "No chat contact on file" means call the customer, then **Skip**.

### 3.4 Close the loop

1. Customer says yes: **Record customer accepted**, then **Create job from quote**.
2. Customer says no: **Record customer rejected**, with a reason if you have one.

## Chapter 4: The AI guide and the Assistant

The **AI guide** answers "where do I click?" from the Ctrl+K palette. The **Assistant** answers questions about your own quotes, contacts, costs and jobs, and can move a job or skip a follow-up only after you confirm. Neither prices, approves, sends or deletes anything.

### 4.1 Switch the AI guide on (owner)

1. Open **AI settings** under Admin.
2. Under **What the helper may do**, choose off, **Guide only**, or **Guide plus my data**.
3. Under **Which AI service**, choose **LARIS hosted ILMU**, or **My own AI server** (https on port 443 or 8443, OpenAI format).
4. Select **Test connection**, read **What is sent**, tick the privacy-notice box, and select **Save**.

### 4.2 Ask the AI guide

1. Press **Ctrl+K**, type a question (3 characters or more), choose **Ask the AI guide: [question]**, press **Enter**.

> **Pro-Tip:** the guide sees only your question, with long numbers and personal details removed. It never sees your records.

### 4.3 Ask the Assistant, from its page or the Ask button

1. Open **Assistant**, or select **Ask** at the bottom right of any page.
2. Pick a suggested question or type your own, then press **Enter**.
3. Select a link in the answer to open that quote, contact or job.

### 4.4 Let the Assistant move a job or skip a follow-up

1. Ask, for example **move job QT-2026-0005 to done** or **skip the follow-up for Kopi Corner**.
2. Select the proposal you mean. A box asks **Do this now?**
3. Select **Yes, do it**, or **Cancel**. The change is saved under your name in the Activity log.

| Can do after you confirm | Will never do |
| --- | --- |
| Move a job to To do, In progress or Done | Set or change a price |
| Skip a pending follow-up | Approve or send a quote or a follow-up |
| | Delete anything |

## Chapter 5: Filtering and exporting the Activity log

### 5.1 Read the log

1. Open **Activity** (needs **view audit**). Entries are newest first; new ones appear every 4 seconds.
2. Each entry shows what happened, when, who, the module, the kind of action and its entry number.
3. Select **Load older entries** to go further back.

### 5.2 Filter

1. Search the event words, pick **From** and **To** dates (Malaysia time), and choose **Person**, **Module** and **Action** (Created, Status changed, Other changes).

### 5.3 Choose entries and download them

1. Tick the entries you want, or **Choose all [n] shown**.
2. Select **Download chosen as CSV** or **Download chosen as PDF**.
3. Or select **All matching as CSV/PDF** (up to 1,000 entries).

> **Note:** downloading needs **export data** as well as **view audit**. Entries cannot be edited or deleted, and each download is itself recorded.

## Appendix: Limits

| Feature | Limit |
| --- | --- |
| Age colours | Fixed bands; a business cannot set its own yet |
| Ask button | Actions tested with a mocked model only, not a live one |
| Activity log download | At most 1,000 entries per file; the PDF is a plain table |
| Jobs made by hand | No quote, PDF or accept link; the amount is typed |
| Languages | Chinese and Tamil cover the main work screens only; not reviewed by native speakers |

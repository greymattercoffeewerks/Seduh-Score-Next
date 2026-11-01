# Archive pipeline: Privacy, Terms, pricing-page and participant-notice wording (DRAFT, T-ARC.6)

**Status: DRAFT for the owner. Nothing here is published or wired into the site.** The owner edits and
publishes. Do not copy any of it into `src/marketing/trustContent.js`, `pricingContent.js`,
`privacy-page-draft.md` or `terms-page-draft.md` until the owner has edited it and answered the points
marked `[OWNER]` and `[LEGAL OPEN]`. This file supersedes
[`archive-rule-wording-HELD.md`](archive-rule-wording-HELD.md) for the archive rule (that file is the
2026-10-17 approval of the rule; this one adjusts it to what the build actually does, which the HELD file's
own header asks for). Keep the HELD file until this one is published, then retire both.

**When the owner does publish it, in the same PR** (and not before the `results_archive_optional` flip is
ready to ship, because the Privacy page states what the code really does):

- edit `trustContent.js` and both draft files together (the drafts are the owner-edited source) and update
  `PRIVACY_UPDATED`;
- edit `pricingContent.js` (section 3 below);
- run `trustScreen.test.js` and `pricingScreen.test.js` (the first fails if a review marker such as
  `[OWNER]` reaches a page);
- if a new public page is added: `vite.config.js`, `public/sitemap.xml`, `tools/prerender-public-pages.mjs`
  and `tests/e2e/smoke.spec.js`.

**The word that stays out.** The owner decided on 2026-11-01 (`HANDOFF-CORRECTION-005`, Layer 1 section 8
items) to keep the word for "no charge" out of all public wording until pricing for Layer 2 and 3 is
decided. Nothing below uses it, and nothing below makes any claim about the price of Seduh ID. The live
pages still use it in places; see section 6, item 4.

**How the wording was checked.** Every statement is traced in the table in section 5 to a migration, a source
file or a local spec section. Where a statement rests only on an owner decision, or on code that is built
but not yet merged, the table says so. The wording is plain-language product copy, not legal advice (section 7).

**What is built and what is not, as of 2026-11-01.** The tick that publishes (T-ARC.1) and the browser
staging of the podium (T-ARC.2) are merged to `dev`, dark, and not in the cloud. The unpublish rule and the
tick box (T-ARC.3) and the banner and other screens (T-ARC.4) are not merged. Wording that describes them
(the unpublish rule, the tick box, the in-app warning) is written from the owner's decisions and must be
re-checked against the merged code before it is published. Those lines are marked `[RECHECK]`.

---

## 1. Privacy page

### 1a. "Who can see it": replace the public bullet

The live bullet (`privacy-page-draft.md`, "The public sees ...") says the organiser chooses what is
published as results, for every event. Replace its first two sentences with the text below. Keep the rest of
that bullet (what the podium and the full standings show, the printable sheet, the organisation name, the
exclusions) as it is, with the two corrections in the note under the quote.

> - **The public** sees the name and date of each event, the live audience view (standings and competitor
>   names) while an event is running, and the results of events published to the public results archive.
>   Whether an event's results are published depends on the plan the organiser is on:
>   - **Community events are published automatically.** About 24 hours after an event ends, its podium is
>     published to the public archive. The organiser can publish sooner, and is told in the app that the
>     time is coming.
>   - **On Per-event and Annual, the organiser chooses** whether the results are listed. An event whose
>     results are not listed is still named in the archive (its name, date, venue and city, and the
>     organiser), with no results.

Corrections to the rest of the bullet, so it stays true:

- "By default that is ..." describes the podium and the full standings as an organiser's choice. For a
  Community event there is no choice of scope: the automatic publication is the podium only, never the full
  standings (owner, 2026-10-17; `archive_snapshot_payload` copies no `standings`). Add after the sentence
  describing the podium: "On Community, only the podium is published."
- "the top three" is the top three _places_. When places are tied, everyone sharing the place is shown
  (`podiumRowsOf` in `resultsPublishing.js`). Say so if you want the tie rule public.

`[RECHECK]` "is told in the app that the time is coming" describes T-ARC.4 (the warning banner and the
action text), which is not built. Remove the clause if the screens ship later than the wording.

### 1b. "Who can see it": add a bullet for competitors

> - **If you take part in an event run on the Community plan**, your placing, name and cafe appear in the
>   public archive about 24 hours after the event ends, if you are on the podium. Your phone number, email
>   and set-by-set marks are never published. On the paid plans, the organiser decides whether results are
>   listed. If you want your name removed or changed in a published result, see "Asking us to remove or
>   correct your data" below.

### 1c. New block, "What the public archive publishes automatically"

Placed under "What we hold", or merged into 1a if you prefer fewer headings. This is the exact list, so no
reader has to infer it.

> **What is published to the public archive**
>
> - **A Community event's podium, about 24 hours after it ends.** The event's format, name, city, venue and
>   date, the number of competitors and rounds, the winning time, and the podium: each person's place,
>   name, cafe, and how many sets they got right out of how many. The name of the organisation that ran the
>   event is shown with it. When two or more people share a podium place, all of them are shown.
> - **Not published:** the full standings, phone numbers, emails, set-by-set marks, or the names and
>   details of competitors who are not on the podium.
> - **A name-only entry** (the event's name, date, venue, city and the organiser, with no results) in two
>   cases: on Per-event and Annual when the organiser has not chosen to list the results, and on Community
>   when we cannot build a reliable podium (for example, the organiser's device never sent the final
>   results, or a score was changed after they were prepared). We would rather publish no podium than a
>   wrong one. The organiser can publish the results themselves at any time.
> - **Never for a rehearsal.** An event the organiser has marked as a test is not published.
> - **How we do it.** Your organiser's device prepares the podium when the champion is declared and sends it
>   to us. A job in our database publishes it. The job only copies the fields listed above; it does not
>   work out placings itself.
> - **When an event "ends".** When the champion is declared, when the organiser presses "Finish this
>   event", or when we close a stuck event at the organiser's request. The publication follows about 24
>   hours later (not earlier than 24 hours, and usually within a few minutes after; later if a publish has to be
>   retried).

`[RECHECK]` "presses Finish this event": the action exists as `finish_event` (`20261023130000`) and is on the
events list (`src/core/events.js`); confirm the button label before using it.
`[RECHECK]` "an event the organiser has marked as a test": `events.is_test` is member-editable. That is
already how the archive works today (`20260917130000`); the pipeline re-reads it at the moment of publish.

### 1d. What an organiser can and cannot do

This is mostly Terms (section 2), but the Privacy page should say the part that affects a competitor:

> **Can the organiser stop it?** On Community, the organiser can take a published result down. We count
> how often that happens, and the result is not published again automatically. Publication is a condition
> of the Community plan (see the Terms), so an organiser who removes results is breaking that condition.
> If you are a competitor and want something removed, you do not need to rely on the organiser: ask us,
> as below.

`[RECHECK]` Soft unpublish is owner decision 7 (allowed, counted, not republished). It is built in T-ARC.3
(`removed` state; the tick never revisits a terminal state, `archive_tick` header), which is not merged.
The existing `unpublish_event_results` RPC and a direct delete on `public_results` do exist today.
`[OWNER]` "We count how often that happens" is true only once `admin_archive_status` (T-ARC.3) ships. Say
it only if you will look at the count.

### 1e. "Where it is stored"

Replace the first sentence with (the second sentence, about Cloudflare, stays):

> Data is stored in Singapore, with Supabase (AWS `ap-southeast-1`), and is primarily processed there. If personal data is
> transferred outside Brunei, we will make sure it is protected to a standard comparable to that of the
> Personal Data Protection Order, 2025.

`[LEGAL OPEN]` The second sentence is the owner's chosen line (2026-11-01), taken from the AITI sample
policy's wording ("We will ensure that any transfers of personal data outside of Brunei is protected to a
standard or protection that is comparable to the PDPO", sample policy, infokit p. 15). Supabase
publishes a Data Processing Addendum (Version 1, 1 August 2026, between the customer and Supabase Pte. Ltd.; read
on 2026-11-01). It supplements Supabase's Terms of Service, treats acceptance of the agreement as signing, and
incorporates EU standard contractual clauses; for a customer-chosen region it says data is "stored and primarily
Processed in that region", with stated exceptions, and it otherwise lets Supabase process anywhere it has
facilities. It names neither Brunei nor the PDPO. **That is why the sentence says "primarily processed", not "processed":
the addendum does not promise Singapore-only processing.** Do not claim the addendum satisfies the PDPO. The wording
also does not settle whether the public archive itself, which any reader in any country can see, counts as a transfer (KIV, section 6).
`[OWNER]` "Singapore" and "`ap-southeast-1`" are the live Privacy page's claims and the cloud project's
region (CLAUDE.md, Repo). The Cloudflare sentence and the analytics sentence are unchanged and untouched here.

### 1f. "How long we keep it"

The live text says there is no automatic deletion and no fixed retention period. That stays true for the
published archive, but the pipeline adds two things that do have a period. Replace the paragraph with:

> A result published to the public archive stays there until it is removed, by the organiser or by us at
> your request. There is no automatic deletion of published results, and we do not apply a fixed retention
> period to them.
>
> Before a Community result is published, the organiser's device sends us a prepared copy of the podium,
> which we hold until the result is published. We delete that copy when it is published, or 30 days after it
> was due to be published if it never was. We also keep a record of what the job did for each event (that an
> event was published, skipped or failed, and when) for 12 months. That record contains no names, phone
> numbers or results.

`[RECHECK]` Decision 9 as recorded (`HANDOFF-CORRECTION-005`): staged snapshot deleted when published or 30
days after due; queue/ledger rows 12 months. **The 30-day clearing is built** (`archive_tick`, retention
step, `20261101100000`; the snapshot is also cleared on publish and on skip). **The 12-month purge of ledger
rows is NOT built** in any merged migration (grep of `supabase/migrations/` finds no purge). Either build it
before publishing this paragraph, or delete the last two sentences. Also confirm the claim "no names": the
ledger holds `event_id`, `org_id`, state, times, `last_error` (SQLSTATE only), `outcome_via`; it keeps a
copy of the staged snapshot only until cleared. That is the `archive_tick` header and column list; recheck
if T-ARC.3 adds columns.
`[OWNER]` Retention of the Seduh ID suppression phone and of orphan identities is covered by the C4 draft
(`seduh-id-wording-DRAFT.md` 1c, 1d); this paragraph does not repeat it.

### 1g. "Asking us to remove or correct your data": opt-out and withdrawal

Add to the "Things to know" list, and reconcile with the existing timing sentence (see the note):

> - **Asking us to take your name off a published result, or to stop publishing yours.** Email our Data
>   Protection Officer, [OWNER: name], at [OWNER: DPO email address]. We will acknowledge your request
>   within 10 days. We will tell you what we can do and what the consequence is: for example, we can remove
>   your name from the public archive entry, but we cannot change the organiser's own record of the event.
>   If you took part in a Community event, tell us which one.

`[OWNER]` The 10-day acknowledgement is owner decision 8 (2026-11-01). The AITI infokit illustrates 10 days
for acknowledging a withdrawal of consent, and 10 business days for saying when it will take effect (p. 35).
Those are the infokit's illustrations of what it expects of the Authority, not a legal requirement stated
here. The live page currently says "We aim to do this within 14 working days." Decide whether 10 days is the
acknowledgement and 14 working days stays the completion target (the clean reading), or replace one. Both
cannot be left unexplained on one page.
`[OWNER]` As built, removing a name from a published result is the operator working by hand (no console
screen, no admin function for it; the "hard" removal function of decision 7 was not chosen). Promise only
what you will do by hand.
`[LEGAL OPEN]` Whether a public archive entry can be withdrawn "by consent" at all, when the organiser
published it as part of a competition's results, is for counsel.

### 1h. Seduh ID sentence (hold until the Seduh ID feed is on)

Spec 2.9 asks for one sentence once the Seduh ID feed (T-ID.D1) is live. Do not publish it before then.

> People named in a published podium may also have a private Seduh ID record created for them (see "Seduh ID
> record" above). The record is not published and is not shown in the archive.

This restates the C4 wording (`seduh-id-wording-DRAFT.md` 1a), where the record is created "when you are
named in a published, non-test result". D1 is podium-only (spec 5.2); the C4 text says "a published result"
generally. `[OWNER]` Decide whether to narrow the C4 text to "named in a published podium" when D1 goes live.

### 1i. "Changes to this page"

Update `PRIVACY_UPDATED` and the date shown at the top. Add the infokit items the page does not yet carry if
you intend to rely on the infokit as the working standard: DPO contact, date issued, and the methods and
purposes of collection (spec section 7, "External policy"; infokit p. 14-15).

---

## 2. Terms page

### 2a. "The organiser is in charge of the event": add bullets

> - If your event runs on the Community plan, its results are published to the public archive automatically,
>   about 24 hours after the event ends: the podium, which shows each placed competitor's name, cafe and
>   placing. **Tell your competitors before the event** that their name, cafe and placing will be public.
>   You are responsible for having done so.
> - On the Per-event and Annual plans, you choose whether the results are listed. If you do not, the event
>   is still named in the archive, with no results.
> - You can publish your results earlier than 24 hours after the event ends. You are responsible for
>   checking them first. The automatic publication uses the results as they stand when the event ends.

### 2b. "Pricing": replace the paragraph

> Pricing is set out on the [Pricing page](/pricing/) and is not part of these terms, with one exception: on
> the Community plan, the organiser agrees that the event's results (the podium) are published to the public
> archive automatically, about 24 hours after the event ends.

This is the HELD text (2026-10-17) with "when the event ends" corrected to "about 24 hours after the event
ends" (D-G22; spec 2.9 and the GATING-SPEC consequences note).

### 2c. New section, "Community results are public" (the unpublish rule)

> ## Community results are public
>
> - A condition of using the Community plan is that your event's results are published to the public archive,
>   as described above.
> - If you take a published result down, we may count that and we do not publish it again automatically. We
>   may treat taking results down as breaking this condition, and may ask you to move to a paid plan or stop
>   using the Community plan for new events.
> - A competitor can ask us to remove their own name from a published result (see the
>   [Privacy page](/privacy/)). We will deal with each request ourselves; you do not need to approve it.
> - If a published result is wrong, tell us and correct it by publishing the corrected result.

`[RECHECK]` The first two bullets describe decision 7 (soft unpublish; "the Terms state publication as a
condition", spec 2.7). The consequences in the second bullet ("ask you to move to a paid plan or stop") are
a draft remedy and **not an owner decision**: delete or soften unless you want to commit to it.
`[OWNER]` The last bullet assumes an organiser can republish a corrected result; `publish_event_results`
upserts (`20260917130000`), confirm in the UI.

### 2d. "Governing law": confirm and extend

The live text is: "These terms are governed by the laws of Brunei Darussalam." The owner chose, on
2026-11-01, a governing-law clause of Brunei law and Brunei courts. Replace with:

> These terms are governed by the laws of Brunei Darussalam, and the courts of Brunei Darussalam have
> jurisdiction over any dispute about them.

`[LEGAL OPEN]` Counsel to confirm the wording, in particular whether "have jurisdiction" should be
"have exclusive jurisdiction" and whether a consumer or non-Brunei organiser needs different text.

### 2e. What the Terms must not do

Terms bind organisers, not the public. A competitor who never signs up to the site is not a party to them.
The competitor's protection is the Privacy page and the participant notice (section 4), not the Terms.
`[LEGAL OPEN]` Whether the organiser's responsibility for telling competitors is enough, or whether the
platform needs its own notice at the point a competitor is entered, is a question for counsel.

---

## 3. Pricing page

The page's copy lives in `pricingContent.js`. The owner confirmed the listing rule on 2026-10-17 and the
pricing page already states the Community rule ahead of the code ("The podium is published to the public
archive automatically when the event ends"; "Compulsory: podium only, published when the event ends"). The
build changes three things: the timing (about 24 hours after), the paid tiers' stub, and the early publish.
Nothing below mentions price, the word for "no charge", or Seduh ID.

### 3a. Tier notes (`TIERS[].note`)

| Tier      | Current                                                                          | Draft                                                                                                                        |
| --------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Community | The podium is published to the public archive automatically when the event ends. | The podium is published to the public archive automatically, about 24 hours after the event ends. You can publish sooner.    |
| Per-event | Publishing results to the archive is optional.                                   | You choose whether to publish results to the public archive. If you do not, the event is still named there, with no results. |
| Annual    | Publishing results to the archive is optional.                                   | You choose whether to publish results to the public archive. If you do not, the event is still named there, with no results. |

### 3b. "Result listing" row (`FEATURE_GROUPS`, `results`)

Description:

> Cup Taster: the podium or full standings on a page anyone can open. On Community, the podium is published
> to the public archive automatically, about 24 hours after the event ends. On Per-event and Annual, listing
> is your choice, and an event that is not listed is still named in the archive.

Cells, in tier order:

> - Community: `Compulsory: podium only, published about 24 hours after the event ends`
> - Per-event: `Optional (the event is always named)`
> - Annual: `Optional (the event is always named)`

The Per-event and Annual cell text is the GATING-SPEC consequences note's own wording ("Optional (the event
is always named)"). The Community cell changes "when the event ends" to "about 24 hours after the event
ends" (D-G22).

### 3c. FAQ, "Do my results have to be public?" (`FAQ`)

> On Community, yes: the podium is published to the public archive automatically, about 24 hours after the
> event ends, and you can publish it sooner. Tell your competitors before the event. On Per-event and
> Annual, publishing is your choice, and an unlisted event is still named in the archive with no results.

### 3d. Edits to the existing code comments

`pricingContent.js` has a comment saying "until then publishing is the organiser's choice on every tier, so
this states the tier's policy ahead of the code". Remove it in the PR that flips the key; it will no longer
be true.

### 3e. What the pricing page must not say

- No claim about what the Seduh ID costs, or whether it will. The owner's decision stands until Layer 2 and 3
  pricing is decided.
- No use of the word for "no charge" in any new line here. The existing page uses it (price field, the tools row and one FAQ answer); that is the owner's call (section 6, item 4), not this draft's.
- No claim that a Community event can opt out of the archive.
- No timing promise tighter than "about 24 hours". The job runs every five minutes, so publication is
  normally 24 hours to 24 hours 5 minutes after the end (`archive_tick` header), but a failed publish is
  retried with a back-off of up to a day and a stopped job publishes nothing, so promise no tighter.

---

## 4. Participant notice (for organisers to show at registration)

Short and plain, for a registration form, a sign-up sheet or the organiser's event page. The organiser
fills in the square brackets. This is the notice the Terms bullet asks the organiser to give.

> **Before you enter: how your results are shared**
>
> This event is run with Seduh Score ([organiser name]). Here is what happens with your results:
>
> - The event's results will be on the Seduh Score public archive, so anyone can see them. This happens
>   automatically about 24 hours after the event ends.
> - What is shown: the podium only, with each placed person's **name, cafe and placing** (and how many sets
>   they got right). If you are not on the podium, you are not named in the archive.
> - What is not shown: your phone number, your email, or your set-by-set marks.
> - Want to be left off, or want something corrected? Tell us before the event, or email [DPO email address]
>   afterwards. We will reply within 10 days.
>
> More detail: [link to the Privacy page]. [Organiser name] runs this event; Seduh Score is run by Grey
> Matter Coffee Werks in Brunei.

`[OWNER]` Which plan the event is on changes the notice: the text above is for Community, where publication
is automatic. For Per-event and Annual, replace the first two bullets with "The organiser may publish the
results on the Seduh Score public archive. If they do, [what will be shown]." The organiser, not the
platform, knows which.
`[OWNER]` "If you are not on the podium, you are not named in the archive" is true of the automatic Community
publication (`archive_snapshot_payload` keeps only podium rows; it never copies `standings`). An organiser
who chooses to publish full standings by hand (a paid-plan choice) names everyone; that case is not covered
by this notice.
`[OWNER]` The notice does not mention a Seduh ID record. When the Seduh ID feed is on, the C4 wording
(`seduh-id-wording-DRAFT.md` 2a) already tells organisers to tell competitors; decide whether the notice
needs a line too.

---

## 5. What each statement rests on (for the owner and reviewers)

| Statement                                                                                                      | Source                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A job publishes a Community event's podium about 24 hours after the event ends                                 | `20261101100000_archive_tick.sql` (header rule 1: `due_at` = `ended_at` + 24 hours; "about 24 h to 24 h 5 min", 5-minute schedule); GATING-SPEC D-G22, D-G23                                                                                                  |
| Dark: nothing publishes until the owner flips `results_archive_optional`; pg_cron not created by any migration | same file header ("DARK", "the migration does not create pg_cron"); CHANGELOG T-ARC.1                                                                                                                                                                         |
| "Ends" = champion declared, "Finish this event", or an admin release                                           | `20261023130000_entitlement_open_events.sql` (`events.ended_at / ended_by / ended_via`: `organiser`, `concluded`, `admin_release`; `finish_event`); GATING-SPEC D-G22, D-G23                                                                                  |
| The published fields: format, event name, city, venue, date, competitors, rounds, winning time, podium rows    | `archive_snapshot_payload` in `20261101100000_archive_tick.sql` (whitelist: `format, eventName, city, venue, eventDate, competitors, rounds, winningTimeSecs` and `podium[].{rank,name,cafe,correct,total}`); `buildResultsPayload` in `resultsPublishing.js` |
| Not published: standings, `notListed`, phone, email, set-by-set marks                                          | same whitelist ("no standings, no notListed"); `resultsPublishing.js` ("built from fixed fields only ... a phone number, an email, set-by-set marks"); Privacy page "never include phone numbers, emails or set-by-set marks"                                 |
| The organisation name is shown with the result                                                                 | trigger stamping `org_name` / `org_slug` into every payload, `20261011170000_tenancy_anon_expand.sql`                                                                                                                                                         |
| Shared podium places are all shown                                                                             | `podiumRowsOf` in `resultsPublishing.js`; whitelist accepts 1 to 8 podium rows                                                                                                                                                                                |
| Community publication is podium-only, never full standings                                                     | owner, 2026-10-17 (GATING-SPEC 6b "Decided 2026-10-17 for the Privacy wording"); whitelist                                                                                                                                                                    |
| Test events are never published                                                                                | `archive_tick` header rule 2 (re-read at publish, under `for share`); `check_public_results_org` refusal, `20260917130000_public_results.sql`                                                                                                                 |
| If the snapshot is missing, invalid or stale, a name-only entry is published instead                           | `archive_tick` header rule 5 (`no_snapshot`, `invalid_snapshot`, `stale_snapshot`); `archive_stub_payload` (`format, eventName, eventDate, city, venue`, `listing: 'named_only'`)                                                                             |
| The organiser's device prepares the podium when the champion is declared, and on opening the report            | `20261101110500_stage_archive_payload.sql`; CHANGELOG T-ARC.2 (`archiveSnapshot.js`, called at champion resolve and report open)                                                                                                                              |
| An organiser's own earlier publish is never overwritten                                                        | `archive_tick` header rule 3 (`on conflict do nothing`; `outcome_via` `organiser_early` / `organiser_late`)                                                                                                                                                   |
| Per-event and Annual choose whether to list; unlisted = still named, no results                                | GATING-SPEC D-G21 (6d, 2026-10-18) and D-G15 (6d, 2026-10-23); `archive_tick` header rule 4; the tick box default is unticked: owner decision 10, `HANDOFF-CORRECTION-005`                                                                                    |
| The organiser can publish sooner                                                                               | existing manual publish (`publish_event_results`, `reportScreen.js`); spec 2.6 ("Publish now = the existing manual publish")                                                                                                                                  |
| In-app warning only, no email                                                                                  | owner decision 6, `HANDOFF-CORRECTION-005`; spec 2.6. **The screens are T-ARC.4, not built** (`[RECHECK]`)                                                                                                                                                    |
| Community organiser may unpublish; counted; not republished                                                    | owner decision 7, `HANDOFF-CORRECTION-005`; spec 2.7. `removed` is "reserved for T-ARC.3" (`archive_tick` header). **Not built** (`[RECHECK]`)                                                                                                                |
| No separate removal route for Community competitors beyond asking us                                           | GATING-SPEC 6b ("No extra removal route"); spec 2.7                                                                                                                                                                                                           |
| Staged snapshot cleared on publish and 30 days after due                                                       | `archive_tick` header rule 7 and the retention step (`staged_payload = null where due_at < now() - interval '30 days'`); owner decision 9                                                                                                                     |
| Ledger rows kept 12 months                                                                                     | owner decision 9, `HANDOFF-CORRECTION-005`. **No purge exists in `supabase/migrations/`** (`[RECHECK]`)                                                                                                                                                       |
| The ledger holds no names, phones or results                                                                   | `archive_events` column list in `20261101100000_archive_tick.sql` (spec 2.2): ids, state, times, `listing_choice`, `outcome_via`, `last_error` (SQLSTATE only); snapshot excepted until cleared                                                               |
| Published results have no automatic deletion                                                                   | live Privacy draft, "How long we keep it"; unchanged by the pipeline                                                                                                                                                                                          |
| Data stored with Supabase in Singapore (`ap-southeast-1`)                                                      | live Privacy draft, "Where it is stored"; CLAUDE.md Repo section (project `wxzwanprluqmgoagbkpv`, region `ap-southeast-1`)                                                                                                                                    |
| Transfers outside Brunei protected to a comparable standard                                                    | owner's chosen line, 2026-11-01 (`HANDOFF-CORRECTION-005` decision 12), from the AITI sample policy (infokit p. 15). A statement of intent, not a verified fact about any transfer                                                                            |
| Brunei law and Brunei courts                                                                                   | owner's chosen clause, 2026-11-01 (decision 12). The live Terms already say "laws of Brunei Darussalam"; the courts half is new                                                                                                                               |
| Acknowledge opt-out/withdrawal within 10 days, by email to the DPO address, by hand                            | owner decision 8; the infokit illustrates 10 days for withdrawal (p. 35), as an illustration, not a legal requirement stated here. DPO name and address: **placeholders**                                                                                     |
| Removal is the operator working by hand                                                                        | spec 2.7 ("removal is by asking the operator"); CONVENTIONS runbook (no admin function or screen for it)                                                                                                                                                      |
| Per-event/Annual named-only entry shows name, date, venue, city and organiser                                  | `archive_stub_payload` plus the `org_name` stamp. GATING-SPEC says "name, date and organiser"; venue and city are in the stub too (the code is the source)                                                                                                    |
| Community's only formats are Cup Taster (and later Throwdown, Liga Seduh); no BTC on Community                 | GATING-SPEC 6d (2026-10-23); `pricingContent.js`                                                                                                                                                                                                              |
| The pipeline is not format-restricted in code, BTC has no publish path                                         | `archive_tick` has no format condition (grep: only the payload fields name `format`); spec 1.1 ("Only Cup Taster publishes ... BTC has no publish path"). See section 6, item 6                                                                               |
| Timings are not statements of law                                                                              | the infokit states its tools are illustrative and not legal advice (infokit p. 3, as cited in the spec, section 7)                                                                                                                                            |

---

## 6. Open items: flagged, not settled

None of these is decided here. The wording above assumes none of them. Owner direction, 2026-11-01: legal advice is
not being sought now (not cheap or easy); the plan is basic compliance based on the PDPO and the AITI infokit. Items 1,
3 and 5 are therefore **KIV (keep in view, not blocking)**: revisit when budget or firmer sources arrive. They stay
listed so nobody mistakes the wording for settled law.

1. **Controller or processor.** Whether the operator is the controller or a processor for the public archive,
   and for the staged snapshot. Archive publication on Community is initiated by the platform, which weighs
   toward controller (spec section 7, item 1); each organiser is responsible for telling its competitors
   (Terms). The draft uses neither word, as in the C4 draft. Counsel.
2. **DPO.** No Data Protection Officer is named, and no contact address is decided. The live pages use a
   temporary address (`greymatter.cw@outlook.com`, "TEMPORARY: swap for hello@seduhscore.com later"). The
   draft uses placeholders.
3. **Counsel has not read these clauses.** In particular: the cross-border line (1e), the governing-law
   clause (2d), the Community condition and its remedy (2c), and the participant notice (4).
4. **The word for "no charge" is on the live pages.** `trustContent.js` (lines 32 and 205, in sentences about
   community tools), `pricingContent.js` (the Community `price` field, line 22; the tools row description, line 173; and one FAQ
   answer, line 195) and the Terms draft ("We also offer ... community tools") use it. The owner's decision of
   2026-11-01 covers "all public wording". This draft does not change them, but the owner should decide
   whether the decision reaches the existing text, and whether a Community price label is needed that avoids
   it.
5. **PDPO commencement.** The owner understands that Part 1 took effect on 1 January 2025 and Parts 3 to 9
   on 1 January 2026, from secondary sources (dataguidance.com, securiti.ai, DLA Piper), not from the AITI
   infokit, which states no dates. **Not confirmed against the Gazette.** The interim basis is the infokit
   (spec section 7): a working practice, not a finding of compliance.
6. **BTC and the tick.** The tick has no format condition. BTC has no podium publish path and no staged
   snapshot, so a BTC event on Per-event or Annual that reaches `ended_at` would, once the key is flipped,
   most likely get a name-only entry (or none, if `listing_choice` rules say so). That is a build question
   for T-ARC.4/.5 and for GATING-SPEC G-B3, not a wording one. The wording above says "an event whose results
   are not listed is still named", which would then be true for BTC too. Confirm before publishing.
7. **Supabase's data processing agreement exists; its fit is not confirmed.** Supabase publishes a Data Processing
   Addendum (Version 1, 1 August 2026; see 1e). Still for the owner: confirm it applies to this project's plan.
   It names no Brunei law, and nothing here claims it satisfies the PDPO.
8. **Minors.** No age data is stored. Whether an under-18 competitor on a podium needs a different default
   is an owner decision (spec section 7, item 6; Layer 1 spec 4.3 is unverified).
9. **Breach.** The pipeline adds one breach shape, a wrong person or wrong podium published automatically
   (spec section 7, "Breach"). The wording does not mention it; the incident log should.

---

## 7. Deliberately not said

- No claim of legal compliance with the Personal Data Protection Order, 2025, and no statute named in
  public text. The interim basis is a working practice from the AITI infokit.
- No illustrative timing from the infokit stated as a legal requirement. The only timing in the draft is
  the owner's own commitment (10 days to acknowledge; decision 8), and "about 24 hours" for publication.
- No BNCC, no `seduh_links`, no third-party sharing (the owner, 2026-11-01: BNCC is iced; the archive page
  is public but the platform shares nothing with any third party).
- No Seduh ID price or promise. No claim about login, profiles, claiming or any later layer.
- No email warning (decision 6: in-app only).
- No promise that an organiser can never remove results (decision 7 is soft).
- Length and tone. Two Brunei organisations' published notices that cite the PDPO (checked 2026-11-01) are short:
  one has eleven plain sections with a DPO named by role and an email, and the other names the PDPO and AITI;
  neither gives fixed response times, and neither addresses cross-border transfers or governing law. The cross-border
  and governing-law lines the owner chose go further than both. Structure only was taken from them; no wording.
  If the Privacy page is getting long, cut to 1a, 1b, 1c and 1g first.

---

## 8. Owner's checklist: decide or fill before publishing

**Fill (placeholders in the text above):**

- [ ] DPO name (1g, 4).
- [ ] DPO email address (1g, 4). Decide whether it replaces the temporary contact address everywhere.
- [ ] The date issued: update `PRIVACY_UPDATED` and the date at the top of the Privacy page.
- [ ] Organiser name and Privacy link in the participant notice (4), for each event it is used on.

**Decide:**

- [ ] 1f: the 12-month purge of ledger rows is not built. Build it before publishing that sentence, or drop
      the last two sentences of the paragraph.
- [ ] 1g: 10 days to acknowledge versus the live "14 working days" to complete. Say which is which.
- [ ] 1d and 2c: are you willing to say the unpublish count is watched, and to say that taking results down
      may be treated as breaking the Community condition? Delete the remedy in 2c if not.
- [ ] 1h: the Seduh ID sentence waits for D1. Narrow the C4 text to "named in a published podium" when it
      goes live?
- [ ] 2d: "exclusive" jurisdiction or not (counsel).
- [ ] 3: the tier notes, Result listing cells and FAQ wording.
- [ ] 4: the Community notice as written; the Per-event and Annual variant.
- [ ] Section 6, item 4: does the 2026-11-01 decision about the word reach the existing live pages?
- [ ] Section 6, item 6: BTC events and the tick (a build decision, but it changes what the wording can say).

**Confirm:**

- [ ] Supabase's Data Processing Addendum applies to this project's plan (6, item 7). Do not claim it satisfies the PDPO.
- [ ] Minors (6, item 8).

**KIV (keep in view, not blocking):** revisit when budget or firmer sources arrive; the wording is published on
the infokit and PDPO basis meanwhile.

- [ ] Controller or processor (6, item 1).
- [ ] A lawyer's read of the clauses: cross-border line, governing law, Community condition, participant notice (6, item 3).
- [ ] Gazette confirmation of PDPO commencement (6, item 5).

**Before the PR that publishes:**

- [ ] Re-check every `[RECHECK]` line against what T-ARC.3 and T-ARC.4 actually merged.
- [ ] Remove every `[OWNER]`, `[LEGAL OPEN]` and `[RECHECK]` marker from the text that goes on a page
      (`trustScreen.test.js` fails if one reaches a page).
- [ ] Publish in the same PR as, or before, the `results_archive_optional` flip, never after (CLAUDE.md
      Definition of Done; spec 10, decision 3).
- [ ] The wording may be live before the key flips, but the flip must not precede it.
- [ ] Retire `archive-rule-wording-HELD.md` once this wording is published.

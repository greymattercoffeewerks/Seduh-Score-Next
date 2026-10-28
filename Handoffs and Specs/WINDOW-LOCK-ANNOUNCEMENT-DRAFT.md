# Per-event window lock: announcement DRAFT, surface inventory and owner questions

**Status: DRAFT. Not published, not sent.** Written 2026-10-28 by Claude Code (task 4 of the first-flip preparation).
Nothing here flips `event_window_lock`; it is the last key in the flip order (D-G27) and ROADMAP "Known open items from
T-GATE.B5" item 1(c) says the lock must be announced before it can close anything.

Sources read: `GATING-SPEC.md` (6b, 6d, 6e, D-G15, D-G21, D-G26, D-G27), ROADMAP B5 items 1 to 14, migration
`20261023140000_entitlement_window_lock.sql` (header and policies), `src/core/eventWindow.js`,
`src/core/eventWindowScreen.js`, `src/main.js` lines ~509 to 541, `src/core/errors.js`, `src/marketing/pricingContent.js`,
`src/admin/planOrg.js`.

---

## 0. Read this first: who the notice is for today

A read-only query on the cloud project on 2026-10-28 (counts only) found **one organisation, one live grant (Annual,
organisation-wide), no event-scoped grants**. So there is **no Per-event customer today** to announce to. The notice is
needed before the first Per-event sale, and the person who buys must see it (or its short form) at the point of sale,
not only after. See owner questions Q1 and Q2.

## 1. What exactly locks, and when (from the migration, not from the spec)

An event is locked only when **all** of these hold and the key `event_window_lock` is on:

1. The organisation has **no organisation-wide plan** (an Annual or organisation-wide Per-event organisation is never locked).
2. The event has at least one Per-event grant whose window has **ended**.
3. The event has **no** Per-event grant that is current now. An extension is a new grant starting where the old one ended, so it
   re-opens the event at once.

Consequences: Community events are never locked; a revoked grant does not lock; a grant that has not started does not lock;
a grant on another event never counts. The window is 5 calendar days including the competition date, counted in Brunei
time (UTC+8), starting 00:00 on day 1 and ending at the end of day 5 (D-G15, D-G26).

**Closed** (reads come back empty and writes are refused by the database, for the signed-in organiser and team): the event's
roster, Cup Taster stages, sets, heats, timing and results, all BTC tables (teams, judges, matches, votes, bonuses, bracket,
seeding tie-breaks), the score change log, and the **live displays** (projector, phone and splash stop serving the event).
Applies to reads and writes alike.

**Stays open / readable:** the event's row in the Events list (the organiser still sees it, its state, and can delete it);
the organisation's people and registry; the **public results page** for results that were already **published**
(`public_results`, publishing and unpublishing still work, and `get_scoring_record` for a published result); Guess the Bean;
everything on Community and Annual; the registration page key (`registration_page`, not window-bound, D-G16).

**Not built, so the notice must not promise it:** the automatic CSV email at the end of the window (G-F1) and the automatic
podium publish 24 hours after an event ends (D-G22). Today the organiser has **no copy of the results** other than the public
page and whatever they exported themselves before the window closed (B5 item 6).

**Extension:** a platform admin extends a window with `admin_grant_extend`, a reason is required and logged (audit action
`grant.extend`), via the Plan panel ("Extend this plan" in `src/admin/planOrg.js`). The organiser cannot extend their own plan.

**Warning:** when the key is on, an organiser who opens an event screen in the last **48 hours** sees a notice (see section 3).
No email or other warning is sent.

## 2. Draft notice (plain language, for Per-event customers)

> **Your Per-event plan and the 5-day window**
>
> A Per-event plan covers **one event** and runs for **5 days in a row, including the day of your competition**. You choose
> where the 5 days sit when you apply (for example the two days before and the two days after). The days are counted in
> Brunei time. The window ends at the end of the fifth day.
>
> **While the window is open**, everything works: setting up, the roster, heats, timing, scoring, the report and CSV, and the
> projector, phone and splash screens.
>
> **When the window ends**, that event closes. You will no longer be able to open its setup, roster, scoring or report, and its
> projector, phone and splash screens stop showing it. Nothing is deleted. **Results you have published to the public results
> page stay there** for anyone to see. [Q3: if you choose not to list the event, only its name, date and organiser stay public.]
>
> **Before the window ends**, please **download your results (the report and CSV)** and **publish the results page** if you want
> them to stay public. We do not email you a copy at the end. [REMOVE this sentence if G-F1 ships first.]
> For 48 hours before the end, the event shows a reminder at the top of the screen.
>
> **Need more time?** If the event is postponed or runs over, ask us **before the window ends**. We can extend the window; every
> extension is recorded with the reason. Extending re-opens the event straight away.
>
> **Other plans are not affected.** Community events and Annual plans have no window.
>
> **Contact:** [CONTACT LINE: name, email, phone, response time. The product's existing line is
> "Contact the Seduh Score team on +673 835 1231 or greymatter.cw@outlook.com" (`src/core/errors.js`).]
> [DATE the lock starts being enforced: ____ ]

Short form for the pricing page / checkout (one line): *"A Per-event plan lasts 5 days including your event date (Brunei
time). After that the event's screens close; published results stay public. Ask us to extend it if you need more time."*

## 3. Everywhere a Per-event customer meets the window today

| # | Surface | File | Current wording | When shown | Flags |
|---|---|---|---|---|---|
| 1 | Warning notice (top of any event screen) | `src/core/eventWindow.js` `windowWarningText`; wired at `src/main.js:539` through `showRouteNotice` | "This event's Per-event plan ends at {the end of 13 November 2026} (Brunei time); after that its screens close. Ask Grey Matter Coffee Werks to extend it." | Key on, window ends within 48 h, organiser opens an event screen | "its screens close" is vague and does not say results can be downloaded or that published results stay; no contact details, only a company name; only seen if they open the event; at 360px the shared notice covers the focused heading and a touch scroll dismisses it (B5 items 2, 3: unfixed, Honor phone check owed) |
| 2 | Locked screen (replaces every event screen) | `src/core/eventWindowScreen.js`; `src/core/eventWindow.js` `WINDOW_LOCKED_HEADING`, `windowLockedText` | Heading "This event's Per-event plan has ended". Body: "The setup, roster, scoring and live screens for this event are closed. It ended at {the end of 13 November 2026} (Brunei time). Results that were published stay on the public results page." Then "To open it again, ask Grey Matter Coffee Werks to extend the plan." Buttons "Contact us" (`/contact/`) and "Back to events" | Key on and the database says locked | **"Results that were published stay..." is reassuring only if they were published; an organiser who never published sees nothing to reassure them and no way to get a copy.** "closed" may read as deleted; it does not say nothing was deleted. During a running event this appears mid-competition (the spec accepts that, section 6b) |
| 3 | Audience screens (projector, phone, splash) | no wording; database policy `live_sessions_window_lock_anon`; `public_event_summary` skips locked events | Nothing designed: a locked event simply is not served | Key on, locked | A screen already open keeps its last frame until reloaded (B5 item 4). The anonymous door then offers the organisation's **next** unlocked event instead (B5 item 5, undecided if intended). The audience may see "not live" or another event with no explanation |
| 4 | Plan-limit refusals (not the window) | `src/core/errors.js` `GATING_MESSAGES` | e.g. "This event has reached its entry limit. Nothing already saved has been lost. Contact the Seduh Score team on +673 835 1231 or greymatter.cw@outlook.com" | A refused write | Per-event has no cap; these concern Community. Listed because the same contact line is used |
| 5 | Pricing page | `src/marketing/pricingContent.js` ~line 106 | The window is **deliberately not shown** ("when it starts and the CSV email at its end are still open") | Always | **A buyer is not told about the lock anywhere before paying.** Spec says the page and spec change together (GATING-SPEC consequences list) |
| 6 | Admin Plan panel (operator only, not a customer) | `src/admin/planOrg.js` | "Extend this plan", "The plan was extended." | Admin | Not customer facing; no event names by design (D-A4) |

Wording that is unclear or alarming, in one place: "its screens close" (1), "closed" without "nothing deleted" (2), reassurance that
depends on a step the organiser may not have taken (2), a company name where a contact line belongs (1, 2), and nothing at all for the audience (3).

## 4. Questions the owner must answer before this can go out

1. **Who receives it, and when?** There is no Per-event customer today. Is this notice (a) a page/checkout text for future buyers,
   (b) an email to named people (who?), or (c) both? On what date will the lock be enforced, and how long before that is the notice
   sent? (ROADMAP: the flip needs the announcement first; suggest at least one full Per-event cycle of notice.)
2. **Should the pricing page say it now?** The page deliberately omits the window. Selling Per-event without it contradicts the notice.
3. **Archive listing (GATING-SPEC "not yet answered"; D-G21 tick box):** on Per-event, if the organiser does not tick "publish the
   results in the public archive", nothing but the event's name stays after the lock and there is no CSV email. Do we warn them
   before they untick, and does the notice say so?
4. **The CSV email (G-F1) and the 24-hour podium publish (D-G22) are not built.** Is the lock acceptable to enforce without
   either, given the organiser then has no automatic copy? If not, one of them must ship before the flip.
5. **Contact line:** whose name, email and phone, and what response time can we promise for an extension? The product's code uses
   the Grey Matter phone/email today.
6. **Extension policy:** when do we say yes (postponement, overrun), is it free, can it be asked after the window ended, and is a
   30-day or other limit wanted? The mechanism has no limit.
7. **A competition still running when the window closes** loses its live displays until extended (accepted in the spec). Do we say so
   in plain words in the notice, as above?
8. **Warning channel:** the only warning is the in-app notice in the last 48 hours. Is an email reminder wanted (not built)?
9. **Audience behaviour (3):** is "the audience screen falls through to the organisation's next event" intended (B5 item 5)?
10. **Before enforcing (engineering, from B5):** the 360px notice overlap and scroll-dismiss (items 2, 3) need a fix and an Honor phone
    check, and the BTC read cost needs a follow-up (`WINDOW-LOCK-COST-REPORT-2026-10-27.md`: `btc_teams`, `btc_match_judges` over
    10 ms locally; repeat on a real ended-grant count).

Nothing in this file has been sent or published.

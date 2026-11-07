# Backlog: Tenancy (T-TEN)

The "Known open items" sections for this area, moved verbatim out of `ROADMAP.md` (nothing edited; original order). Each
section is a task's own deferred findings, with CLOSED/Resolved marks where an item was later done. **Add new deferred
findings for this area here, not to `ROADMAP.md`.** Section index: [`README.md`](README.md).

## Known open items from T-TEN.B1/B2/B5 (2026-10-11)

_Three migrations (`20261011100000_tenancy_org_id_immutable`, `20261011110000_tenancy_cross_org_references`, `20261011120000_tenancy_last_owner`) reviewed by schema-guardian, security-reviewer and test-auditor (no blocking findings; every non-blocking one fixed except the items below). **Pushed to the cloud project 2026-10-11 and verified there** (cloud versions `20261010164114`, `20261010164146`, `20261010164214`, applied in order): all triggers enabled, the new functions `SECURITY DEFINER` with `search_path` pinned and no API-role execute, `service_role` TRUNCATE on `org_members` and `orgs` revoked, and a rolled-back live probe confirmed the last owner cannot be demoted. **Still true: no two-org user may exist there until B6 is also pushed.**_

- **`btc_matches_write` is still `FOR ALL`.** Any member can write status and tie-break columns directly (within one org, not a cross-org gap). Splitting the policy is an RLS redesign that needs its own `security-reviewer` pass. Deliberately not in B2.
- **`person_merges.merged_id` has no foreign key or org check.** A bare uuid kept for the audit trail; nothing reads another org's person through it.
- **`org_set_role` writes no audit row.** Role changes are service-role only and invisible after the fact. Consider logging them when an admin console exists. **SUPERSEDED (triage 2026-11-07):** the admin console's `admin_set_role` writes an audited `member.role_set` row in the same transaction (`supabase/migrations/20261014130000_admin_write_rpcs.sql:245`); direct service-role calls remain unaudited by design.
- **`service_role` still holds `TRUNCATE` on the other tenant tables.** B5 revoked it only for `org_members` and `orgs` (a TRUNCATE skips every row trigger, including the last-owner guard). Revoking it everywhere is a wider privilege change.
- **The org_id guard (`033`) sees only tables with an `org_id` column.** A tenant table scoped purely through `event_id` / `stage_id` / `heat_id` (as `ct_sets` was) is not caught by it, so a new such table can again be re-pointed unnoticed. A second guard over parent-column freezes is the follow-up. **CLOSED (triage 2026-11-07):** A catalog guard now fails any tenant table without a BEFORE UPDATE parent-freeze or check trigger, and the last two unfrozen tables were frozen (`supabase/tests/040_cross_org_matrix.sql:523-531`; migration `20261013140000_tenancy_freeze_remaining_parents`).
- **The last-owner guard has no two-session test.** pgTAP runs in one uncommitted transaction, so the org-row lock and the owner-row lock are pinned by source only. Security-reviewer ran the concurrent cases by hand: READ COMMITTED holds; REPEATABLE READ is covered by the owner-row lock. A demotion racing an org deletion can deadlock (Postgres aborts one); accepted.
- **`confirm_heat` still compares `p_org_id <> resolver`** (the NULL trap). No exploitable path was found (it aborts on the missing row), but it joins B6's audit list. **CLOSED (triage 2026-11-07):** B6 replaced the `<>` comparison with a null guard plus `is distinct from` (`supabase/migrations/20261011140000_tenancy_rpc_null_org_guard.sql:1573-1578`).
- **`people.global_person_id` is writable by any member** to any uuid. _Resolved 2026-10-30 by T-ID.B2 (guard trigger and FK; see "Seduh ID")._

---

## Known open items from T-TEN.B6 (2026-10-11)

_Two migrations (`20261011130000_tenancy_resolver_disclosure`, `20261011140000_tenancy_rpc_null_org_guard`; apply together, in order). Reviewed by schema-guardian, security-reviewer (blocked once, then signed off on a delta review) and test-auditor. **pushed to the cloud project 2026-10-11 (cloud versions `20261010213446` and `20261010213533`, applied in order) and verified there**: all 13 resolver, internal-resolver and trigger bodies and all 18 RPC bodies hash identically to the tested local copies; the internal resolvers are executable by no API role; the RPCs are still SECURITY INVOKER with `search_path` pinned; and a live probe on the cloud, built to roll back, showed a stranger who is a member of nothing gets the same refusal from `delete_test_event`, `publish_session` and `publish_event_results` for the true org id, a wrong one and NULL, and for a real versus a missing event, while a direct write naming the real org gets the standard row-level-security refusal and the real owner still resolves their own org. The second migration was applied to the cloud as a short block that rewrites each function's own current definition with the one guard added (the repo file carries the full bodies and the rollback); the result is identical by hash. B1, B2 and B6 are now all in the cloud, so the "no two-org user" rule is lifted: a second org and a two-org member may now be created, only through the service-role provisioning path (B4, not built yet)._

- **Other BEFORE ROW validation triggers still answer before row-level security** (the oracle class B6 closed for the org-match triggers): `check_btc_match_teams_event`, `check_btc_match_judge_event`, `check_btc_bracket_slot_event`, `check_btc_match_bonus_teams`, `check_person_merge_kept_org`, `check_ct_results_set_stage`. A signed-in non-member can tell, from the error, whether two ids they name are related. Pre-existing, not introduced by B6. Same fix pattern (gate on membership of the row's org first, raise the standard 42501). `check_ct_results_set_stage` also compares with `<>` against possibly-NULL subselects, so a missing parent passes the trigger (the foreign key still catches it). **CLOSED (triage 2026-11-07):** all six triggers now refuse non-members with 42501 first and use `is distinct from` (`supabase/migrations/20261013160000_tenancy_trigger_membership_gate.sql:1-25`, pgTAP `045`).
- **Anonymous reads still expose which org owns every event.** `events.org_id`, `live_sessions` and `public_results` are anon-readable (`events_read_public`, `live_sessions_read`, `public_results_read_public`), so "anon learns nothing about org ownership" cannot be signed off until B7/D6 narrow them. This is B7/D6's job, not B6's. **After D6 (once pushed): `events` is closed, but `live_sessions` still lists every organisation that has ever published, with its latest payload (see "Known open items from T-TEN.D6"), and `public_results` is the intentionally public archive, so it still cannot be signed off.**
- **The gated event resolver is about 15x slower in-database for an existing event than a missing one**, for a non-member (microseconds, because the membership lookup only runs when a row is found). Buried in network jitter, so not usable over HTTP; noted so nobody relies on it as a guarantee.
- **Policy scans cost more per row.** `app.is_org_member(app.org_id_for_x(...))` now does a second membership lookup inside the resolver. Measured on 4000 rows as 1.7x to 2.7x for a whole-table policy scan (plan shape unchanged; inlining the membership check was not faster). Fine at current event sizes; E3 should re-measure with realistic data, and a full-table scan on a busy night is the thing to watch.
- **A missing parent id now fails the org-match triggers with P0001** ("must match the owning org…", "person_id must belong to…") where the foreign key used to report 23503. The client treats both as permanent failures, so nothing breaks; the message is just less precise.
- **The gate depends on the session role.** The org-match triggers refuse a caller as a non-member when `auth.uid()` is set or the session role is `authenticated` / `anon`; a session with neither (postgres, seeds, migrations) is checked strictly instead. If a new writer ever needs to run as a different role, it will take the strict path.

---

## Known open items from T-TEN.B3 (2026-10-11)

_One migration, `20261011150000_tenancy_my_orgs` (`my_orgs()` plus the `org_members(user_id)` index). Reviewed by schema-guardian (no blocking), security-reviewer (signed off; 12 SQL probes and 13 real API requests through PostgREST found no way to see another user's membership) and test-auditor. **Pushed to the cloud project 2026-10-11 (cloud version `20261011030525`) and verified there:** function `SECURITY DEFINER`, `STABLE`, `search_path` pinned, no arguments, executable by authenticated only; the index is a plain btree on `user_id`; and a rolled-back live probe showed a stranger and a session with no user id get zero rows, the real owner exactly their own org and role, and anon and the service role are refused._

- **Notes for C1 (`core/orgContext.js`).**
  - Call `my_orgs` with POST (supabase-js `.rpc('my_orgs')`, the default), not GET (`{ get: true }`). The function is STABLE so PostgREST allows GET, but the response varies by Authorization while PostgREST's `Vary` header does not, and shared iPads with several accounts are exactly the case where a cached per-user GET would be wrong.
  - A token whose `sub` is empty or not a UUID makes `my_orgs()` fail with 22P02 (HTTP 400) instead of returning zero rows, the same as every RLS policy that calls `auth.uid()`. GoTrue never issues such a token, but C1 should treat a 400 from `my_orgs` as "no organisation context", not crash.
  - It returns `org_id, name, slug, role`. There is no member list and no user id in it.
- **Expect Supabase linter warning 0029** ("signed-in users can execute a SECURITY DEFINER function") for `my_orgs`. Intended: the function must read `org_members` and `orgs` on the caller's behalf, scoped by `auth.uid()`. Eight other public definer RPCs already carry the same warning. Acknowledge it in the E3 advisor run.
- **`SECURITY INVOKER` would also work today** (the `org_members_read` and `orgs_read` policies pass for the caller's own rows) and would keep row-level security as a second guard. DEFINER was kept because the plan asks for it and so the console does not depend on how `org_members_read` is written later; revisit if the advisor warning matters.
- **The index is scale-readiness only.** At one org and one member the planner keeps scanning; measured on 3000 orgs, 12000 memberships it is used and goes from 0.69 ms to 0.15 ms. It also helps the `where user_id = ...` lookups in the team functions and the cascade from `auth.users`.
- **Row estimate.** A set-returning SQL function is estimated at 1000 rows by default; add `rows 5` only if a later query joins on `my_orgs()`.
- **Last-owner accounts cannot be deleted** until a successor is promoted (B5, intended); account deletion must go through the org first.

---

## Known open items from T-TEN.B4 (2026-10-11)

_One migration, `20261011160000_tenancy_provisioning` (`create_org`, `org_add_existing_member`, `orgs_slug_format`, `trg_orgs_slug_immutable`). Reviewed by schema-guardian (no blocking; 8 non-blocking findings, all fixed or recorded here), security-reviewer (signed off on the boundary; 5 non-blocking, fixed or recorded) and test-auditor. **Pushed to the cloud project 2026-10-11 (cloud version `20261011051012`) and verified there** (function bodies hash-identical to the tested copies, service-role-only grants, the CHECK constraint and the trigger present, a rolled-back live probe of every refusal). Cloud pre-check done 2026-10-11: the one existing slug (`grey-matter-coffee-werks`) satisfies the new CHECK and `auth.users` has the `deleted_at`, `is_anonymous` and `banned_until` columns the eligibility rule reads._

- **Deleting an org frees its slug for reuse**, which defeats the "slugs are permanent because they are in printed links" rationale (D-T8). Only `postgres` can delete an org today. If org deletion ever becomes a real operation, keep a tombstone of retired slugs and refuse them in `create_org`.
- **No audit trail for operator actions.** `create_org`, `org_add_existing_member` and `org_set_role` write no audit row. Consider `raise log` or an `org_events` table when an admin console exists. **SUPERSEDED (triage 2026-11-07):** the admin console's `admin_create_org` and `admin_add_member` write audited rows (`org.create`, `member.add`) in the same transaction (`supabase/migrations/20261014130000_admin_write_rpcs.sql:141,179`); direct service-role SQL remains unaudited by design.
- **Attaching a Team-managed account to a second org** lets the first org's owner (who knows its one-time password) sign in there. Nothing in the schema marks an account as "managed", so this is an operator rule (in the CLAUDE.md runbook), not a database guarantee.
- **Reserved words only protect new orgs.** Slugs are permanent, so the reserved list can grow but cannot un-create an org already named `help` or `status`. If slug routes ever move from `#/live/:orgSlug` to the site root or a subdomain, revisit the list.
- **A name check is a hygiene check, not a spell check.** It refuses control characters, bidi overrides and invisible-only names; it does not refuse look-alike letters in a display name (only in the slug, which is ASCII-only before folding).
- **A rare race is mapped, not tested:** an owner or org deleted between the existence check and the insert surfaces as the same `*_not_found` hint through a foreign-key handler. pgTAP runs in one session so cannot interleave it.
- **PostgREST status codes.** "Not found" and "invalid" refusals use SQLSTATE 22023 (HTTP 400); a conflict is 23505. (P0002 would have been a 500.)
- **Both functions are service-role only**, so there is no way to provision from the app by design (D-T1); an admin console phase will need its own, separately reviewed path.

---

## Known open items from T-TEN.B7 (2026-10-11)

_One migration, `20261011170000_tenancy_anon_expand` (`public_org_by_slug`, `public_event_summary`, the org-stamp trigger on `public_results`, the `published_by` tightening). Pushed to the cloud project 2026-10-11 (cloud version `20261011075747`)._

- **DECISION (product owner, 2026-10-11): an event's name, date and test flag are public as soon as the event exists (Option 1).** `public_event_summary(org_id)` returns an org's newest event to anyone who knows the org id (a random uuid that is itself readable from the published results and the shipped code), whether or not the event is published or announced, rehearsals included. This is strictly narrower than today (anyone can read every org's events with no id), and the splash screen needs the pre-event name. **Do not put confidential details in an event name before announcing it.** Revisit with an "announced" switch on events if organisers ever need secrecy before an announcement; the alternatives were showing an event only once the org has a live session or a published result (loses the pre-event splash name) or that switch.
- **The old anonymous doors are still open** until D6: `events_read_public` (anon reads every org's events, including `org_id`), `live_sessions_read` (every org's live rows, active or not, and the Realtime publication that follows from it) and the audience surfaces' direct `events` read. B7 only adds the narrow doors; D1/D2 switch the client onto them and D6 closes the old ones, after a deploy, with no live event and the venue displays reloaded.
- **Slug probing is possible by design.** `public_org_by_slug` answers "does this slug exist, and what is its id and name" to anyone; that is what a printed audience link needs and is no more than trying the URL. Slugs are low-entropy, so they can be dictionary-guessed. There is no rate limit on it: add one at the edge before many orgs exist, and never put anything sensitive behind a slug alone.
- **Earlier published rows have no `org_name` / `org_slug`**, and stamped names go stale: `orgs.name` can change (only the slug is frozen), and a row keeps the name from its last write until it is republished. A refresh trigger on `orgs` was rejected because it would rewrite published rows and could fail (and so block an org rename) if a published event were later flagged as a test. D3's results screens must tolerate the absence and the staleness.
- **The new payload keys are snake_case (`org_name`, `org_slug`) while the existing ones are camelCase** (`eventName`, `eventDate`); the plan fixes these names, so D3 should read them exactly as written.
- **Readers must use exact top-level keys and escape the values.** A case variant or nested `org_name` is stored untouched (only the exact top-level keys are replaced), and an org name containing quotes, backslashes or markup is stored verbatim, so anything that renders it must escape it.
- **The 256 KB cap is per row, not total (security review F2/F6).** A member can still create many events and publish up to 256 KB on each, the results page reads every row with no limit, and the database does not bound the request size or the nesting depth of a payload (a few thousand levels are accepted; a far deeper one fails with a stack-depth error). Before many orgs exist: a body-size cap at the edge together with the slug rate limit, and a results list that does not pull whole payloads (or paginates). Real payloads are about 3 KB.
- **The anonymous-function pin excludes some functions on purpose:** functions that belong to an extension (pgTAP installs dozens while the file runs), trigger and event-trigger functions (they cannot be called), and `rls_auto_enable`, a Supabase event-trigger helper the cloud project grants to anon and a local stack does not.
- **`public_event_summary` still shows rehearsal events** (with `is_test`), like the table read it replaces; the audience surfaces mark them (D9).
- **`public_results` now has column-level anon grants.** A column added later is invisible to anon until granted, which is the point, but a client that selects `*` as anon fails (`42501`) by design.
- **D2 has two follow-ups:** `findLatestEventForOrg` must call `.rpc('public_event_summary', { p_org_id }).maybeSingle()` (the function returns a set of at most one row), and the `.from('events')` mock in `src/core/events.test.js` must change.

---

## Known open items from T-TEN.C1 (2026-10-11)

_Client only: `src/core/orgContext.js` and `src/core/noOrgScreen.js` (plus `noOrgScreen.css`). **Nothing calls them yet**; C2 wires them in. No migration._

- **C2 must wire it this way.**
  - Call `refresh(session)` from the existing `onAuthStateChange` handler (it defers its own database read, so the auth-lock rule holds) and use `retry()` for the Retry button after an error.
  - `no_org` mounts `mountNoOrgScreen`. Its `onSignedOut` must do what the header's Sign out does (set the hash and dispatch a synthetic `hashchange`, or signing out from `#/events` leaves the old screen up), and C2 must not rely on that callback alone: if the sign-out event makes the router abort the screen first, the callback is skipped.
  - `error` needs the existing `renderRetryableError` shape.
  - Call `destroy()` on unmount. **CLOSED (triage 2026-11-07):** C2 wired `refresh`, the no-org screen, the retryable error and `destroy()` (`src/main.js:153,490,499,1590`).
- **Refines the B3 note.** The B3 item said to treat a 400 from `my_orgs` as "no organisation". Review showed a bare 400 can also come from a proxy or CDN and would lock an organiser out, so only the database's `22P02` means that; any other 400 is an ordinary failure (keeps the last answer).
- **Three copies of "must choose a password first"** now exist (`main.js` twice, `orgContext.js`). Export one predicate from `setPasswordScreen.js` and use it in all three when `main.js` is edited in C2.
- **Two copies of sign-out** now exist (`appShell.js`, `noOrgScreen.js`); the header one has no timeout and shows no failure message. Share one helper when C2 touches the shell, and decide how to avoid two buttons named "Sign out" on the no-org screen (the header's nav links also stay visible there).
- **Two tabs can act in different orgs.** A switch in one tab is not seen by another until it reloads or refreshes. Every write is still checked by the database against the org it names; C6's outbox should key on `getActiveOrgIdFor(<session user>)`.
- **The remembered choice stays on the device** after sign-out (an org id per user id under `seduh.activeOrg.<userId>`; ids only, no names or tokens). Shared iPads keep one entry per account that signed in there.
- **The screen has never been rendered in a browser.** The accessibility review was by reading code and CSS; check it at 360px (full-width button, no sideways scroll for a long email, focus ring, VoiceOver/TalkBack) when C2 mounts it.
- **The copy says "ask its owner to add you".** True for a removed organiser; a Guess the Bean account would ignore it. Revisit with product wording if those accounts ever land here often.

---

## Known open items from T-TEN.C2 (2026-10-11)

_Client only: `src/main.js` and the shared helpers. No migration._

- **C3 added what C2 deliberately left out** (see "Known open items from T-TEN.C3"): the organisation name in the header, the select, the announcement for a deliberate and an involuntary change, and the refusal messages, all routed through `switchOrg`. One thing remains for C7: its automatic switch (a deep link into another organisation) must also go through `switchOrg` or a shared check, not `orgContext.setActiveOrg` directly: the unsynced-changes guard lives only in `switchOrg`, and the handle `mountApp` returns also exposes `orgContext`.
- **C6 closes the remaining outbox gaps.**
  - The guard in `switchOrg` is check-then-act: a change queued between the outbox read and the switch (by the screen still on show, or by a second tab) slips through. Nothing is lost or mis-attributed (the operation's payload carries the old organisation and the database checks membership), but "no old-organisation operations while the new one is active" is not airtight until operations carry their user and organisation.
  - The message "Wait for it to sync" is wrong for a stuck operation or one left by another account, and `switchOrg` counts the whole device. C6 should split pending / stuck / from another account.
  - The no-organisation flush skip keeps other people's operations, but a person removed from their organisation also keeps their own unflushed ones stuck, shown as "Not synced (N)" with no explanation on the no-organisation screen.
  - An involuntary organisation change replaces the screen without checking the outbox, even mid-heat. Drafts are keyed by heat or match id and survive, but C3/C7 should confirm the timing and scoring screens keep an unconfirmed form or running timer when they are unmounted.
- **The remembered organisation list is a hint, not authority.** It holds organisation id, name, slug and role per user under `seduh.orgs.<userId>` (names and slugs are public in the results archive; the role is not), stays on the device after sign-out like the last-used-org hint, and can show an organisation the person was removed from until the next real answer (the database still refuses every read and write). It is erased by an answer of "no organisation".
- **One `my_orgs` request per auth event** (including the hourly token refresh) plus one per console navigation only while the answer is missing.
- **Nav on the no-organisation and error screens.** The shell's nav stays fully populated there (Events just shows the same screen again; the Team link is correctly absent). Two buttons named "Sign out" exist on the no-organisation screen (the header's and the screen's): kept on purpose, since the screen's is the one that works at 360px (the header's is behind the hamburger); the header's now also reports failures. Consider a minimal nav for those two states.
- **Audience routes still use `VITE_DEFAULT_ORG_ID`** (`getLegacyAudienceOrgId()`), until D1. Set, a two-organisation organiser's "Projector view" opens the legacy organisation's display whichever organisation is active: D1/D4 fix this with slug-qualified links. The local `.env` and the e2e dev server still set it; the production dashboard variable is removed in E5 after D1.
- **The "out of date" card has never been rendered in a browser** on a real projector or at 360px; neither has the Retry or loading card. Check in C3/D5.
- **The `organiser-flow.spec.js` hamburger focus test was flaky** (about half the runs): pressing the Menu button while it already had focus cleared the shell's memory of it, so crossing 1366px could drop a keyboard user to the top of the page. Fixed in T-TEN.C3 (see its CHANGELOG entry).
- **Team screen heading and copy naming the organisation** remain C4.

---

## Known open items from T-TEN.C3 (2026-10-11)

_Client only: the organisation slot in `src/core/appShell.js` / `appShell.css`, `src/core/orgLabel.js`, and the wiring in `src/main.js`. No migration._

- **Manual screen-reader and keyboard pass still owed** (NVDA, JAWS, VoiceOver, TalkBack; iOS and Android native pickers). What was verified is in a real Chromium and in the accessibility tree; what a screen reader actually speaks is not. In particular: whether the polite "Now working in …" is spoken before, after, or cut off by the focus move to the new screen's heading. If it is dropped in practice, delay it by about 150ms or make that one message assertive. Headless Chromium also does not let Playwright drive a closed select with the arrow keys, so keyboard operation is covered with `selectOption`, not real key presses.
- **Three or more organisations: a native select switches on the first arrow key**, so reaching the third organisation passes through (and fully switches to) the second, each hop a re-mount. It conforms to WCAG 3.2.2 (the description warns beforehand) and the owner says three organisations are rare. Before a third organisation is realistic, give the control an explicit commit (a Switch button, or a disclosure with its own arrow/Enter/Escape handling).
- **A closed select or label truncates a long name** (about 10 characters at 360px). The full name is on its own line at the top of the Menu below 1366px, in a tooltip for pointer users, and in the picker. From 1366px inline there is no such line, and with a real event name, the inline nav and a normal email the slot is about 110px. It gets twice the free width of the event name, which truncates instead (the page heading repeats it).
- **Deviations from the plan's C3 text:** the slot is in the header's main row, not under the hamburger (so it is always visible, and the matchMedia(1366) focus relocation is not needed for it); focus after a switch lands on the new screen's heading, not back on the control (the new screen's own focus rule, unavoidable without fighting every screen); the announcement reads "Now working in <name>. Showing Events." rather than "Switched to <org>".
- **A second switch made before the first has re-mounted is not announced** (the console is between screens and the announcement path waits for the mounted screen). Rare, and the screen is still right.
- **Two organisations with the same name** are told apart by slug in the list, the label and the announcement; the slug is the unique one.
- **The refusal panel has no timer** (it clears on Escape, on leaving the control, on a tap anywhere, or on the next choice) and, at 360px, can sit over the page heading until dismissed. The tap-anywhere dismissal is there for iOS Safari, which does not reliably blur a select; not verified on a device.
- **A timing-sensitive existing test is flaky under heavy parallel load** (`appShell.test.js`, "still announces at the cap when the wall clock steps backwards during the hold": real timers and a 100ms window). It passes alone and in a quiet full run; it failed twice while mutation runs shared the machine. Not touched by C3.
- **Forced-colors mode hides the Menu button's three bars** (pre-existing, not C3's): worth its own item.

---

## Known open items from T-TEN.C4 (2026-10-12)

_Client only: `src/core/teamScreen.js`, `src/core/orgLabel.js`, and the wiring in `src/main.js`. No migration._

- **An involuntary organisation change still replaces the Team screen**, with a one-time password on it if there is one: a membership that falls away, or another account signing in in a second tab, cannot be refused the way a deliberate switch now is. The password is recoverable (Reset password on that member, from the organisation they belong to), but the screen says "cannot be looked up again". Rare; a fuller answer belongs with C7's deep-link switch and C6's ownership work.
- **The Team screen's wording is fixed at mount.** An operator renaming the organisation, or a second organisation with the same name appearing, while the Team screen is on show leaves the old heading until the next navigation (the header updates at once). Wording only: every request carries the organisation's id. Folding the label into the console key would eject an owner mid-task.
- **The copy says accounts "cannot be added to another organisation from this screen" without saying where it can be done.** Today it is operator-only (decision D-T6), so no route is named; add one when a support route exists.
- **A very long unbroken organisation name** wraps (no sideways scroll at 360px) but pushes the add-a-member form down the screen; a cap on the heading's lines would fix it if it ever matters.
- **Still owed** from C3: the manual screen-reader and real-phone pass, which should include the Team screen's new heading ("Team for <name>").

---

## Known open items from T-TEN.C5 (2026-10-12)

_Client only: `src/core/eventsScreen.js` and the wiring in `src/main.js`. No migration._

- **Publishing uses the event's own organisation**, not the active one (`reportScreen.js` reads `data.event.org_id`). Correct, and what lets T-TEN.C7's deep link into a non-active organisation's event publish at all; but until C7 switches the active organisation for such a link, the header can say one organisation while the report screen on show belongs to another. C7 must either switch or show the event's organisation.
- **Audience links depend on the legacy organisation** until T-TEN.D1/D4 make them slug-qualified: they are offered only while the active organisation is the legacy one.
- **The organisation is fixed when the Events screen mounts**, like the Team screen's wording: a rename while it is on show keeps the old heading until the next navigation. Every request carries the organisation's id, so only the words are stale.

---

## Known open items from T-TEN.C6 (2026-10-12)

_Client only: `core/outbox.js`, `main.js`, `core/appShell.js`, `core/signOut.js`, `core/noOrgScreen.js`. No migration._

- **No way out for operations that can never be sent.** If the account that made them never signs in again on this device, or has since left the organisation, they stay on the device for good and the panel keeps saying "Unsent (N other)" (the wording no longer offers a switch that is impossible). An owner-confirmed discard, or an export, is a product decision and is not built. On a shared venue tablet a permanent amber chip trains people to ignore it.
- **A small window remains between the session and the token.** The owner follows auth events, but a request reads the token from shared storage when it is sent. If another tab signs the account out and a different one in while this tab's request is on its way, the request can carry the new token before this tab's auth event lands. The database then refuses it as a non-member (permanent); the operation is now kept, not removed, if the owner has changed by the time the failure arrives, but a failure that arrives before this tab hears of the change is still judged as it always was.
- **The lost-write notice hides the "waiting for somebody else" sentence** while it is up (it lasts until the tab is closed and is not scoped to an account), though the chip still counts them.
- **Operations queued while nobody is signed in, or before ownership tags existed, belong to whoever signs in next** (their organisation is still read from the payload, so they never go to another one). If that person is in the organisation with a lesser role, the database may refuse them. Pinned by tests so a change is deliberate. Every production payload names its organisation.
- **A flush that skipped the caller's own operation (the owner changed) reports a clean result**; screens that ask "did my write land?" use the whole-queue check, which is why the BTC and time-correction checks were moved to it. A screen that only reads `stopped` could still say "saved" for a write that is queued for another owner. Narrow: screens are replaced when the owner changes.
- **"Unsent (N other)" uses the same amber as the account's own pending changes.** A muted style would need the sync chip's CSS (pinned selector by selector in `appShell.test.js`) to change.
- **Old tabs running old code ignore the tags** and replay everything: reload every open tab after the update.
- **A member removed from every organisation who has changes waiting** sees the sign-out warning on the no-organisation screen, but those changes cannot be sent until they are added back.
- **A manual screen-reader and real-phone pass** is still owed for the C3 to C6 additions (the sync notice, the sign-out warning).
- **The unset-owner default in `core/outbox.js` is "ownership not in use"**, so bare tests need no setup; production sets `null` at mount, before anything can flush. Making `null` the default would mean every outbox test opting out.
- **C7 note:** screens still take their organisation id from the router. A deep link into an event of a non-active organisation must switch the active organisation (the outbox would otherwise hold its writes as "waiting in another organisation").

---

## Known open items from T-TEN.C7 (2026-10-12)

_Client only: `main.js` (the route guard), `core/events.js`, `formats/btc/matches.js`, `core/appShell.js`/`.css`. No migration._

- **Heat, stage and match ids inside a URL are not checked against the event id in it.** The guard decides by the event (or, for a BTC match, the match's event). A hand-built URL such as `/events/<event of A>/heats/<heat of B>/scoring` still renders B's heat while the header says A, for a person who is a member of both. Label integrity only; not asked for by the plan.
- **A link followed while the outbox check is in flight and then abandoned still switches the organisation** (header and the screen the person moved on to agree, so nothing is mixed). No notice is shown for it.
- **The BTC match's event is remembered but not enforced:** `btc_matches.event_id` has no immutability trigger (the event's organisation has one), so the remembered match-to-event answer rests on convention. The match read is network-first for that reason.
- **A person who has just joined a second organisation, with an old cached snapshot of their memberships, gets "Page not found" for its events until they are online** (the organisation list is the one the console already holds).
- **Offline reload of a timing or scoring screen still needs the network to load the screen itself** (unchanged by C7): the guard now finds the event's organisation from the device's memory, but the screen's own load is what fails offline.
- **The unit tests cannot see a one-time password on the Team screen blocking a link** (jsdom runs every navigation twice and the second run finds the flag already cleared); the code resets the flag before switching.
- **A manual screen-reader and real-phone pass** is still owed for the C3 to C7 additions (the notice, the card).

---

## Known open items from T-TEN.D1 (2026-10-12)

_Client only: `main.js` (`mountAudienceBySlug`), `core/orgResolver.js`, `core/config.js`, `core/router.js`, `core/viewer-shell.css`. No migration._

- **The surfaces themselves still read `events` and `live_sessions` directly as anon** (D2 moves them to `public_event_summary` and the resolved organisation; D6 closes the old direct reads, only after D1 to D5 are deployed and no live event is in progress; venue projectors left open run old cached JavaScript). **CLOSED (triage 2026-11-07):** D2 moved the surfaces to `public_event_summary` and D6 closed the direct anon reads, pushed to the cloud 2026-10-13 (`supabase/migrations/20261013100000_tenancy_anon_contract.sql`, `supabase/tests/038_anon_contract.sql`; CHANGELOG entry for T-TEN.D6 in docs/archive/changelog/2026-10-H1.md:773).
- **The organiser's own "Projector view / Phone view / Splash screen" nav links are still the OLD slug-less links** (they show the legacy organisation, so they appear only while that organisation is the active one). D4 makes every generated link slug-qualified. **CLOSED (triage 2026-11-07):** D4 made the nav links slug-qualified via `audienceHash(activeSlug, ...)` for any active organisation (src/main.js:1479-1495).
- **A deterministic failure (an unpushed migration, a revoked grant) shows "We can’t reach Seduh right now" and retries for ever** at one request per 30 seconds per open tab (with a quarter of jitter). Harmless to the database and it stops when the tab navigates away, but it is a misleading card for a permanent fault.
- **A legacy slug that is set but wrong shows "not found" on every old link and does not fall back to `VITE_DEFAULT_ORG_ID`**: set it to `grey-matter-coffee-werks` exactly (the organiser's slug), or leave it unset until the Cloudflare variable is added.
- **Moving from one audience surface to another: the old surface's live connection is only released once the new link's first lookup has answered** (the router takes the old screen down after the new mount resolves, up to 10 seconds on bad wifi). The screen itself shows the new "Opening this link…" card at once; the old surface's updates are already stopped (its abort signal fires the instant the new navigation starts).
- **Real-screen and browser tests do not cover a VoiceOver/TalkBack pass** on the new cards, nor the card at 1920x1080 on a real projector (the width rule is reasoned from the CSS and unit-checked, not measured). Both fold into the manual screen-reader and real-phone pass already owed for the C3 to C7 additions.
- **Not asked of the product owner yet (D4):** whether the audience links should also be offered as a QR code. The only audience links today are the three nav-menu links; `qrcode-generator` is used by Guess the Bean only.

---

## Known open items from T-TEN.D2 (2026-10-12)

_Client only: `core/events.js` and the test fakes. No migration._

- **When the event check cannot be made (a wifi drop of a few seconds, the 4-second bound), the projector and phone say "No event scheduled" rather than "could not check"** (`viewer-shell.js` treats a failed check as "no event" and only re-asks on the next live-session change or reconnect). This predates D2 (same wording before the RPC), so D2 left it: fixing it changes what the audience reads and needs a decision on the wording and a retry. The splash screen is unaffected (it stays on the brand-only line). A tri-state (unknown / none / has) with a neutral "could not check" card and a retry would close it.
- **`supabase/tests/003_rls.sql` still replicates the old anonymous table query.** Done in D6: it now asserts anon cannot touch `events`.
- **The browser test covers the splash screen's request, not the projector's:** the projector only asks for the event while no live session already proves there is one, so whether it asks depends on what earlier tests left behind. The unit and real-screen tests cover the projector's ask.
- **The results pages were not part of the "no anonymous read of `events`" check by browser** (they read `public_results` and RPCs; D3).

---

## Known open items from T-TEN.D3 (2026-10-12)

_Client only: `marketing/resultsScreen.js`, `marketing/resultsSheet.js`, `core/publicResults.js`, `core/orgLabel.js`. No migration._

- **The archive page still downloads every published payload** (it needs them all for its stats tiles and list; only the sheet became per-event). Measured: about 2.7 KB per result, so about 270 KB at 100 results and about 800 KB at 300. Past that it should be paged or given a lighter list (and its stats computed in the database). There is no `limit` or `range` today, and PostgREST's `max_rows` (1000 in the local config; the cloud value was not checked) would silently drop the oldest results and make the tiles wrong past it. A payload may be up to 256 KB (the database's cap), so the worst case is far above the typical.
- **The one result already published in production shows no organiser** (it predates the stamp). **Done 2026-10-12** with the owner's go-ahead: a no-op update of that one row let the trigger stamp the name and slug.
- **The name is the name as of publishing:** a renamed organisation keeps its old name on old results until they are republished (right for a historic result).
- **Two organisations may share a display name**, and the page shows only the name (the database also stamps `org_slug`). Operator-created, so rare; showing the slug when two names on the page collide would tell them apart.
- **A publisher still controls the event name, city, venue and cafe lines**, so a result can be titled to look like another brand; only the "Organised by" line is authoritative (D-T4).
- **The public Privacy page (`marketing/trustContent.js`, `design/copy/privacy-page-draft.md`) does not yet say the public also sees the name of the organisation that ran each published event.** A wording and policy decision for the owner (CLAUDE.md: changing what is public changes the Privacy page). **CLOSED (triage 2026-11-07):** the Privacy page now says the name of the organisation that ran the event is shown with a published podium (src/marketing/trustContent.js:160).
- **The sheet's per-event read has no browser test for an unpublished event**, only unit tests.

---

## Known open items from T-TEN.D4 (2026-10-13)

_Client only: `core/audienceLinksCard.js`, `core/eventsScreen.js`, `main.js`. No migration._

- **The card sits below the events list and the create form.** On a phone the organiser scrolls past the form to reach the QR. A conscious choice (the working screen is unchanged); moving it up, or behind a "Share" button, is a product decision.
- **The links are built on the page the organiser is on.** A link made from a preview or local address opens that address. The organiser should copy links from the production site.
- **There are no BTC-specific links.** The BTC projector and phone use the same slug-qualified routes as Cup Taster, so the three links cover both; a separate card per format was not needed.
- **The QR size (11rem, about 176 px) was chosen by eye** and checked in a screenshot, not scanned by a phone camera. Worth one real scan before an event.
- **Old slug-less links still work through the legacy shim** (D1) until the owner sets `VITE_LEGACY_AUDIENCE_ORG_SLUG` in Cloudflare Pages and later retires them (D6/E).

---

## Known open items from T-TEN.D5 (2026-10-13)

_Tests only: `tests/e2e/audience-isolation.spec.js`, `tests/e2e/support/tenants.js`, `playwright.config.js`._

- **Each local run leaves two organisations behind** (with their organiser and event; the live sessions are ended). The database refuses to remove a sole owner (T-TEN.A5) and the service role has no table access to delete an organisation. Slugs and emails are unique per run, so nothing collides, and CI's stack is thrown away; a long-lived local stack just collects `d5-*` rows until a `supabase db reset`.
- **The Cup Taster payload in the spec is hand-written** (the Brewers Cup one comes from the real assembler). A change to the payload's shape would fail loudly (the screens would not render), not silently.
- **The live-channel organisation filter has no visible effect to test** (a screen without it only re-reads its own organisation). It is a cost and privacy-in-depth setting, not a leak, so no test pins it.
- **The spec needs the whole local stack and the dev server**, so `--project=dev-audience` also runs the harness and organiser-flow projects first unless `--no-deps` is passed.

---

## Known open items from T-TEN.D6 (2026-10-13)

_Database: `supabase/migrations/20261013100000_tenancy_anon_contract.sql`, `supabase/tests/038_anon_contract.sql`, `003_rls.sql`._

- **Pushed to the cloud project on 2026-10-13** (cloud version `20261013010530`), in a quiet window with the displays reloaded, and verified after (see the CHANGELOG entry). A venue display left open on cached pre-D2 JavaScript goes blank until reloaded; that was the cost of the contract step. **CLOSED (triage 2026-11-07):** the push to the cloud is recorded as done (T-TEN.D6 entry, docs/archive/changelog/2026-10-H1.md:773).
- **The splash shows the newest event by creation, test events included.** After the push, https://www.seduhscore.com/app/#/live/grey-matter-coffee-werks/splash read "Test Event 1 · TEST DATA, NOT A LIVE EVENT" because that is the organisation's newest event (`public_event_summary` picks by `created_at`). Not new (it did this before), but worth a decision before a real event: prefer a non-test event, or the live one.
- **An organisation's most recent session stays public.** Only `publish_session` ever deactivates a session, so the latest one (test rehearsals included) stays `active` and readable by anyone, with its standings, names and times, until that organisation publishes again; `GET /rest/v1/live_sessions` therefore lists every organisation that has ever published. The audience surfaces need exactly that today. The real fix is a per-organisation door (an RPC that takes the organisation id) plus an "end the session" action, and then closing the table to anon altogether. Not done.
- **Realtime and a deactivate-only change.** A database change reaches an anonymous screen only if the NEW row is visible to it. `publish_session` deactivates the old row and activates the new one in one transaction, so screens are told by the new row. A future "end the session without a replacement" would not reach open screens by itself (they would show the last state until reloaded); whoever adds that must signal the audience another way.
- **The browser check of "only active rows" is weak on a fresh database** (the test organisations only ever have active sessions); the pgTAP file carries the real proof. It bites on a long-lived local stack.
- **A venue display running pre-D2 code stays blank after the push until reloaded.** That is the intended cost of the contract step, and why it waits for a quiet window.

---

## Known open items from the event-selection guards (2026-10-13)

_`supabase/migrations/20261013120000_public_event_summary_prefers_live.sql`, `core/publish.js`, `cup-taster/timingScreen.js`, `btc/scoringScreen.js`._

- **Applied to the cloud project 2026-10-13** (cloud version `20261013023650`) and verified on production: the splash names the live event. **CLOSED (triage 2026-11-07):** the push is recorded as done (event-selection guards entry, docs/archive/changelog/2026-10-H1.md:755).
- **The links still address the organisation, not an event.** The projector and phone show whichever event of the organisation last went live; the splash shows the live one (or the newest real one). To pin a screen to one specific event while another is live (two real events at once under one organisation), event-pinned audience links (`#/live/<slug>/<event>/...`) and a public door that takes an event id would be needed. Not built; the rehearsal organisation and the take-over guard cover the practice-and-test case.
- **The take-over warning is computed when the screen loads.** If another device makes a different event live afterwards, the warning is stale: absent (the start then replaces it, as before the guard) or still shown (one extra tap). Checking again at the tap would add a network round trip to a time-critical tap, so it does not.
- **A re-render while "Replace it and start heat" is armed** (a pending-work recheck, an error) rebuilds the card; the armed state is lost safely (it asks again) but keyboard focus falls to the page.
- **Only the first publishing action asks.** Confirming a heat or resolving a stage in Cup Taster still publishes without asking (it can only take over if another event started between), and BTC asks only by a warning, not a second tap.
- **"Start heat" uses the native `disabled` attribute on the button that has focus** (existing since 2026-09-11, and an existing test pins it): focus drops to the page while "Starting…" shows, and nothing announces it. `core/dom.js`'s `setBusyDisabled` (`aria-disabled` and `aria-busy`) is the project's pattern for this. The wait itself (`startHeat` and the publish flush) has no bound and no stated failure state if the connection accepts but never answers.
- **A failed live check looks like "nothing is live"** (the guard is deliberately fail-open): on a flaky connection the organiser taps Start with no warning and no sign the check did not run. A third, quiet line ("couldn't check what is on the venue screens") would say so.
- **A failed live-view publish after a successful start is only logged** (existing): the screen reports the heat as started while the venue screens may not have changed; the sync chip is the only surface.
- **The armed state never expires:** once armed it stays "Replace it and start heat" until Cancel or a re-render.
- **`.take-over-warning` is styled in two stylesheets** (Cup Taster timing, BTC scoring); one shared stylesheet would do.

---

## Known open items from T-TEN.E1 (2026-10-13)

_Tests only: `supabase/tests/040_cross_org_matrix.sql`, `supabase/tests/041_cross_org_rpcs.sql`._

- **The freeze-trigger migration is applied to the cloud project** (2026-10-13, cloud version `20261013042316`; two additive triggers on `btc_seeding_tiebreaks` and `score_change_counts`), so production no longer relies on narrow table privileges for those two tables. **CLOSED (triage 2026-11-07):** the push is recorded as done (docs/archive/changelog/2026-10-H1.md:711).
- **The catalog guard for child tables is now "has a BEFORE UPDATE freeze or check trigger", not "every parent column is frozen".** `033` only sees tables that carry an `org_id` column. For tables scoped through `event_id` / `stage_id` / `match_id`, `040` asserts every tenant table has a freezing or checking trigger and its "move" check tries one parent column per table (`ct_results` re-points `heat_entry_id`, not `set_id`). The reviewer probed 16 other mixed-parent re-points by hand (tiebreak winner, bracket slot match/team/feeder, bonus fastest team, `person_id`, `kept_id`, `entry_id`, `set_id`) and all were refused, by check triggers, freeze triggers or a check constraint, but about 20 foreign-key columns on tenant tables are in no `forbid_parent_change` list. A catalog guard ("every FK column on an updatable tenant table is frozen, check-triggered, or not updatable") is the real answer.
- **Mixed-argument RPC calls are not exercised, and a second review proved why it matters:** every id in an attack comes from one organisation, so for several multi-id RPCs (`record_btc_tiebreak`, `record_btc_seeding_tiebreak`, `confirm_btc_match`, `create_btc_bracket_match`) the call is refused by an earlier domain rule and the foreign argument is never reached; the test would still pass if the foreign-argument check were removed. The fix is a fixture state where the own call SUCCEEDS, then an attack that changes only the foreign argument. `031` covers the inserts and manual probes found no hole.
- **`create_btc_match` is attacked only by callers who belong to neither organisation** (it is told no organisation, so a caller who belongs to the resource's organisation is allowed); `user_ab` is not attacked with an event from one organisation and teams from the other.
- **DELETE has no positive control** (a member deleting their own row), so "refused" for a stranger rests on the matching UPDATE control; the stranger's refusals are proven by the rolled-back sentinel and by the INSERT copies being refused with 42501 before any key check.
- **The completeness guard for functions keys on uuid arguments and a name exemption list**, so a new overload of a covered name is treated as covered; an overload-aware check would compare function identities.
- **`get_scoring_record` is only tested as anon on unpublished events here** (019 covers the published path).
- **The anon-privilege pin fails if anything with PUBLIC grants, such as pgTAP itself, is installed in `public`.** Fine under the Supabase test runner, which installs it elsewhere.
- **The `processed_operations` ledger lets a member UPDATE and DELETE their own organisation's rows where default privileges grant it** (its policy is ALL; production has INSERT and SELECT only). A member deleting a ledger row could let an operation replay. Own organisation only, and the privileges narrow it in production, but narrowing the policy to SELECT and INSERT is the structural fix. The matrix now follows the database's privilege rather than asserting insert-only.
- **The completeness guard for tables checks that a freeze or check trigger EXISTS, not which columns it freezes** (a reviewer's point): removing one column from a trigger's argument list would not fail `040`. Decoding `tgargs` against every foreign-key column, the way `033` does for `org_id`, is the real guard.
- **`040`'s guard on views checks `security_invoker` only;** there is no row-level probe of the six views as a stranger, and nothing guards foreign tables beyond the `relkind` filter.

---

## Known open items from T-TEN.E2 (2026-10-13)

_Tests only: `tests/e2e/organiser-tenancy.spec.js`, `tests/e2e/support/tenants.js`, `playwright.config.js`._

- **The event-route guard for people in ONE organisation: fixed** (see "Known open items from the event-link guard"). It used to skip them, so another organisation's event link ended in a generic error with a Retry that could not work.
- **No browser test boots the console without `VITE_DEFAULT_ORG_ID` AND signs in.** The built-app smoke test boots a build made without it (no backend), the unit test covers the memberships path, and the tenancy spec runs against a dev server that has the variable. A dev server started with the variable blank and the tenancy spec run against it would close it.
- **The spec is serial** (one failure hides the rest of the file) and depends on the earlier projects having run; the tests do not depend on each other's state.
- **Each run leaves three organisations and their people behind** on a long-lived local stack (the database refuses to remove a sole owner); slugs and emails are unique per run.

---

## Known open items from the event-link guard (2026-10-13)

_`src/main.js` (`placeOwnOrgEventRoute`, `rememberedLookup`), `src/main.test.js`, `tests/e2e/organiser-tenancy.spec.js`._

- **One extra read, once per event, for people with one organisation** (then remembered on the device). The first time a link to an event is opened on a device, its page waits for that read, for at most 2.5 seconds, before it renders; an event the person just created on this device could be remembered at creation to skip it.
- **Untested branch:** the restart of the navigation when the person or organisation changes while the question is in flight, for ONE-organisation people (a deliberate break of it passes the unit tests; the several-organisation twin is tested).
- **A remembered "this event is in my organisation" answer is trusted for the life of the device's storage**, as for several organisations; an event never changes organisation (T-TEN.B1), and what it is used for is deciding between "open the screen" and "switch", never granting access (the database still decides what is visible). A person removed from an organisation who still has the answer remembered would open the event screen and meet the database's own refusal.

---

## Known open items from T-TEN.E3 (2026-10-13)

_Database: `supabase/migrations/20261013150000_e3_advisor_followups.sql`, `supabase/tests/044_e3_advisor_followups.sql`._

- **Applied to the cloud project 2026-10-13** (cloud version `20261013065727`; verified afterwards: the event-trigger helper is not executable by anon or signed-in callers, the four Guess the Bean policies use the once-per-query form, the three indexes exist). **CLOSED (triage 2026-11-07):** the push is recorded as done (T-TEN.E3 entry, docs/archive/changelog/2026-10-H1.md:648).
- **Unfiltered reads of a leaf table are slow by design of the policy chain** (measured: 0.2 ms per row, 33 s for 160,000 heat entries as a signed-in member). The app always filters by a parent id, so it never meets it. Anything new that reads a tenant table without a parent filter as a signed-in caller (an export, a report across events, a search) should go through a SECURITY DEFINER function that checks the caller once, as `get_dispute_pack` does, or the policies should be redesigned (for example an `org_id` column on the leaf tables, or one policy per command that avoids the double evaluation).
- **96 "multiple permissive policies" advisor warnings**: every tenant table has a `_read` (SELECT) and a `_write` (FOR ALL) policy, so a SELECT evaluates both. Splitting the write policies into INSERT, UPDATE and DELETE (and scoping them `to authenticated`) halves the per-row work of a SELECT. Worth doing together with the unfiltered-read item above when volume asks; `040` and `041` are the safety net.
- **Leaked-password protection is off, on purpose:** a paid-plan Supabase feature (the earlier ROADMAP note says it cannot be enabled on the free tier), so the security advisor keeps flagging `auth_leaked_password_protection`. Not an action item.
- **Advisor findings that are noise at this scale:** "unused index" (10), and five unindexed foreign keys on tables that hold a handful of rows (who published or merged or removed something).
- **Security review, SHOULD-FIX (low): (1) is DONE** in the T-TEN.E3 follow-up (`20261013160000_tenancy_trigger_membership_gate.sql`, applied to the cloud 2026-10-13 as `20261013082049`); **(2) is an accepted risk, not fixed:** the 409 is how an owner learns to choose another address, a uniform answer would break the one-time-password flow, and not pre-confirming would stop new staff signing in until they confirm their email; the real fix is rate limiting at the app or Cloudflare layer. Original text: (1) several cross-reference triggers (`check_person_merge_kept_org`, the `check_btc_*` ones and `check_ct_results_set_stage`) run BEFORE row-level security and are SECURITY DEFINER but lack the membership gate that T-TEN.B6 added to three others, so a signed-in non-member can tell, from the error code (`P0001` against `42501`), whether a guessed id pair exists; the caller needs the right unguessable UUIDs and learns only a yes or no about one id relationship. The fix is the same early `is_org_member` 42501 gate as `check_live_session_org`, and `is distinct from` in place of `<>`; `040`/`041` are the safety net. (2) The `team-accounts` edge function (`supabase/functions/team-accounts/handler.js`) answers 409 "That email already has an account" for ANY taken address, including other tenants' staff and Guess the Bean users, and creates the account with `email_confirm: true`, so an owner can probe whether an arbitrary email has an account anywhere in the project and pre-create one on someone else's email. A uniform response (or rate limiting) and not pre-confirming would close it.
- **Security review, notes:** a removed team member can be restored and have their password reset with no time limit (documented in 20261008120000; the account can be shared with Guess the Bean community use); active `live_sessions` rows (payload and all) are world-readable and `live_sessions.payload` has no size cap, unlike `public_results` (256 KB): a member could write a very large anon-readable payload (an availability concern for the audience and Realtime); `public_event_summary` plus a scraped slug shows an organisation's latest event name, date and `is_test`, rehearsals included (accepted under D-T3, 3 s statement timeout, no rate limit); `get_scoring_record` returns the organiser's free-text correction `reason` once an event is published (anything typed there becomes public); deleting a sole owner's account is refused by the last-owner trigger, so erasing an owner means promoting a successor first; Guess the Bean's anon feed and direct `guesses`/`contacts` inserts have no rate limit (already recorded); `btc_matches_write` is FOR ALL, an in-organisation integrity matter; not checkable locally and worth a look in the cloud dashboard: the exposed-schema list, storage buckets and policies, signup and anonymous sign-in settings, default ACLs, and the Realtime public Broadcast setting (the client only uses `postgres_changes`).

---

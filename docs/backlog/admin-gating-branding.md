# Backlog: Admin console, gating, branding, password recovery

The "Known open items" sections for this area, moved verbatim out of `ROADMAP.md` (nothing edited; original order). Each
section is a task's own deferred findings, with CLOSED/Resolved marks where an item was later done. **Add new deferred
findings for this area here, not to `ROADMAP.md`.** Section index: [`README.md`](README.md).

## Known open items from the Plan panel (T-GATE.C, admin Plan panel, gating step 3; shipped dark, 2026-10-23)

_Source: CHANGELOG `T-GATE.C`. Migration `20261023150000` (057) merged as #309 and pushed to the cloud project 2026-10-26 (keys all off). Status: NOT FINAL until the open items below are settled._

1. **Raw key ids on the Keys screen.** A human label per key is needed before the operator uses the screen with customers in view (ui-accessibility-reviewer; wording observation, not a blocker). **CLOSED (triage 2026-11-07):** the Keys screen now draws each key by a plain name with the id as small text, and a catalog test fails when a key has no name (`src/admin/planFormat.js:44` `keyName`; `src/admin/CLAUDE.md` "Accessibility and wording").
2. **`admin_plan_orgs` is unbounded** (code-reviewer). Paging is needed at scale; fine at today's organisation count.
3. **Release of an already-ended event reports success** (code-reviewer). Decide whether a release of an ended event should be refused with a hint, or stay a no-op success.
4. **Restoring event names in the picker** is a one-line change in `admin_plan_org` plus a D-A4 amendment. The owner's call (security-reviewer's decision: names narrowed out).
5. **The panel never flips a key on its own.** The owner flips by hand, after the cloud push and the backfill, with the flip preconditions already listed under B4 and B5 (`events_open`, `btc_format`, `event_window_lock`). The preview is the gate.
6. **A double-submitted organisation grant creates two rows** (security-reviewer observation). The page-wide claim prevents it in the UI; the database does not. Left as is; a uniqueness rule would need the owner's decision on overlapping grants.
7. **Wording observations, left** (ui-accessibility-reviewer): **Copy pass done (2026-10-26):** plain key names, Off/On wording, "frozen plan" replaced, decision codes hidden from key notes. Still open: the Off and Revoked badges are green; empty field error lines.
8. **Schema-guardian nit, left:** the `app.grant_insert` error prefix still says `admin_grant_create`. Cosmetic; the hint is unchanged.
9. **`module-boundary-checker` was not run as its own agent.** The code-reviewer pass covered it (`boundary.test.js` and the admin leak check are green). Run the dedicated agent before the PR if the owner wants the separate sign-off.
10. **Cloud:** RESOLVED 2026-10-26: migration `20261023150000` was pushed to the cloud project with the other five (cloud versions `20261026151252` to `20261026151547`), keys all off.

## Known open items from T-GATE.B5 (Per-event 5-day window lock; shipped dark, 2026-10-23)

_Source: CHANGELOG `T-GATE.B5`. Migration `20261023140000` (056) merged as #307 and pushed to the cloud project 2026-10-26 (keys all off). Status: NOT FINAL until item 1 is run through._

1. **Flip preconditions for `event_window_lock`** (none may be skipped, as with B3 and B4): (a) **MEASURED 2026-10-27 (local copy, synthetic data) and FIXED by migration `20261027100000` (pgTAP 058), PUSHED to the cloud 2026-10-27 (version `20261027012320`, function bodies verified equal to local):** with the key on, the old locked-events function cost every statement 0.2 to 0.35 ms per ended Per-event grant on the whole platform (17 ms at 100 grants, 170 to 350 ms at 1000), independent of table size; the set-based version costs 3 to 16 ms at 1000 grants. Flip only after the measurement is repeated on the cloud's real ended-grant count (0 on 2026-10-27, so it shows nothing yet); still unmeasured: the Realtime subscriber cost and the `btc_*` tables (a shorter lookup chain than `ct_results`); (b) run `admin_gating_preview('event_window_lock')`, which lists the organisations with a locked event now, and extend or accept each one; (c) announce the lock to Per-event customers before it can close anything.
2. **appShell notice covers the focused heading at 360px** (ui-accessibility-reviewer). The B5 text was shortened, which is not the fix. The real fix belongs to the shared `appShell` notice and its owner.
3. **A touch scroll dismisses the informational notice** (ui-accessibility-reviewer). This is `appShell` shared behaviour, not B5's. It needs a check on the Honor phone (the user's primary device) before the lock is enforced.
4. **A realtime client keeps its last frame until reload** (security-reviewer). After the lock closes an event, a projector, phone or splash that is already open keeps showing its last frame until it is reloaded.
5. **`public_event_summary` falls through to the organisation's next unlocked event** (security-reviewer). The anonymous door skips a locked event, and then offers the next one for the same organisation. Decide whether that is intended before the flip.
6. **No automatic CSV email at window end (G-F1).** The organiser has no copy of the results except the public archive page.
7. **D-G22, the 24-hour podium publish, is still not built** (carried from B4 item 3). **CLOSED (triage 2026-11-07):** built as the archive pipeline `app.archive_tick` (`supabase/migrations/20261101100000_archive_tick.sql`; CHANGELOG "T-ARC.1 to .6").
8. **Accepted (schema-guardian):** publishing after the lock writes an empty payload from the browser. The locked screen blocks that UI, so nothing reaches a user.
9. **By design (security-reviewer):** a Community organisation can register 8 competitors on a fresh event after a lock. The Community cap is per event.
10. **Pre-existing, carried:** `events.status` and `events.is_test` are member-writable (7a risk 2, as in B3 item 4 and B4 item 5).
11. **Not run before the PR:** `module-boundary-checker` on the `src/` change set (`src/core/eventWindow.js`, `src/core/eventWindowScreen.js`/`.css`, `src/main.js`, and the tests). Run it before the PR.
12. **The first-flip precondition list from B4 still applies** (`events_open` and `btc_format`, items 1 and 2 of "Known open items from T-GATE.B4").
13. **Cloud:** RESOLVED 2026-10-26: migrations `20261023100000` to `20261023140000` were pushed to the cloud project (cloud versions `20261026151252` to `20261026151547`), keys all off.
14. **Rule recorded in CONVENTIONS (rule 10):** a restrictive-policy lock binds every invoker path, so each invoker trigger or function that must stay open runs as definer with a guard. The B5 instance (`app.btc_delete_event_children`) is fixed and tested in 056.

## Known open items from T-GATE.B4 (one open event, finish and release, BTC at go-live; shipped dark, 2026-10-23)

_Source: CHANGELOG `T-GATE.B4`. Pushed to the cloud 2026-10-26 (D-G13 satisfied). Migration `20261023130000` (055). Status: NOT FINAL until the B4 PR's CI is seen green and item 6 is done._

1. **Flip runbook: old open events block the first flip of `events_open`.** A Community organisation with a forgotten, never-finished event is at its limit of 1, so its next event creation is refused the moment the key is enforced. Before flipping: run `select * from app.gating_would_lose('events_open')` (or `admin_gating_preview('events_open')`), then either release the stuck events deliberately (`admin_event_release`, each with a reason) or backfill the Annual tier first. Do not flip it blind.
2. **Flip runbook: `btc_format` and live BTC events.** A BTC event that went live before `btc_format` is enforced has no snapshot, so its next `publish_session` is refused mid-event (B4 security-reviewer nit). Do not enforce `btc_format` while a BTC event is live; check `admin_gating_preview('btc_format')` first. The only grant writer is `admin_grant_create`: it requires a platform admin with fresh MFA and is revoked from `service_role`. A CI fixture for this key therefore needs an admin-session helper. **RESOLVED 2026-10-28 (PR #336):** `createTenant` grants an Annual plan through `admin_grant_create` with a real platform-admin session (admin made by SQL as the local database owner, TOTP factor enrolled, `aal2` token computed in `tests/e2e/support/grants.js`); no grant-boundary change. Proved by `btc-entitlement.spec.js` (project `dev-gating`). The cloud precondition (no BTC event live when `btc_format` is flipped) still stands; the runbook re-checks it on the day.
3. **Automatic podium publish 24 hours after an event ends (D-G22) is NOT built.** `ended_at` now exists, but nothing reads it to publish. The publish path is its own task. **CLOSED (triage 2026-11-07):** the 24-hour podium publish was built as the archive pipeline, `app.archive_tick`, and pushed to the cloud (`supabase/migrations/20261101100000_archive_tick.sql`; CHANGELOG "T-ARC.1 to .6" built, five migrations pushed).
4. **RESOLVED in T-GATE.B5:** the Per-event 5-day window lock (G-B5) is built, dark. See "Known open items from T-GATE.B5".
5. **`events.status` and `events.is_test` are still member-writable** (7a risk 2, as in B3 item 4). `is_test` does not exempt an event from the open-event count, by design.
6. **Not run before the PR:** `module-boundary-checker` on `src/core/entitlements.contract.test.js` (the one `src/` change).
7. **Organiser copy for `entitlement_required` and `entitlement_cap_reached`** (G-C2), as in B3 item 10. A Finish button and its copy are the organiser's side of `events_open`. **CLOSED (triage 2026-11-07):** the organiser copy is `GATING_MESSAGES.events_open` and the Finish action is built (`src/core/errors.js:14`, `src/core/eventsScreen.js:127` `renderFinishAction`).
8. **Pre-existing, recorded (security-reviewer):** `btc_format` is not tied to `events.format` for `btc_*` table writes. It is a soft commercial gate only.
9. **Cloud:** RESOLVED 2026-10-26: migrations `20261023100000` to `20261023130000` were pushed to the cloud project (see item above), keys all off.

## Known open items from T-GATE.B3 (enforcement hooks, shipped dark, 2026-10-23)

_Source: CHANGELOG `T-GATE.B3`. Pushed to the cloud 2026-10-26 (D-G13 satisfied). Migration `20261023120000` (054). No key may be flipped until items 1 to 3 are settled._

1. **RESOLVED in T-GATE.B4:** the Community one-open-event rule (D-G20/D-G23) is built, dark: `events_open`, `finish_event`, `admin_event_release`, with "ended" as the database-owned `events.ended_at`. See "Known open items from T-GATE.B4".
2. **RESOLVED in T-GATE.B4 (owner option A, 2026-10-23):** BTC is gated at first go-live, not creation. Any tier may create a BTC event; `btc_format` is checked when it first goes live, counting the event's own Per-event grant. The chicken-and-egg is gone, so switching `btc_format` on no longer stops a Per-event buyer. See "Known open items from T-GATE.B4" for the flip preconditions.
3. **RESOLVED in T-GATE.B5:** the Per-event 5-day window lock (G-B5) is built, dark. See "Known open items from T-GATE.B5".
4. **`events.status` and `events.is_test` are member-writable** (7a risk 2). Not addressed; no rule exempts test events, so none can be bypassed through them.
5. **No CHECK on `events.format`.** Unknown values are capped as Cup Taster (fail closed). Add a CHECK when the format list is final.
6. **`tests/e2e/support/tenants.js` `createTenant`** takes BTC events live as the organiser. It needs a grant before `btc_format` is first enforced in CI. The only grant writer is `admin_grant_create`: it requires a platform admin with fresh MFA and is revoked from `service_role`. A CI fixture for this key therefore needs an admin-session helper. **RESOLVED 2026-10-28 (PR #336):** the helper is `tests/e2e/support/grants.js` (a real platform-admin session made by SQL on the local stack, TOTP enrolled and answered, `admin_grant_create`); `createTenant` now grants Annual by default (`grant: false` opts out).
7. **RESOLVED 2026-10-27 (PR #332):** `listEventsForOrg` now selects `id, format, name, event_date, venue, city, is_test, ended_at`, so the snapshot columns no longer reach the client. (`findEvent` still uses `select('*')`, logged as pre-existing.)
8. **RESOLVED 2026-10-27 (PR #332):** `service_role` snapshot-edit refusal is now covered in `054` (two refusals and a control update; plan 92). Not yet confirmed by a mutation run of pgTAP (reviewed on reading, CI green).
9. **Re-snapshot:** a per-event window that opens after go-live, or a grant bought after go-live, needs `admin_event_resnapshot` (rollout note in the 054 header).
10. **Organiser copy for `entitlement_required` / `entitlement_cap_reached`** (G-C2) not written. The admin copy for the four gating hints is in `NOT_FOR_THE_CONSOLE` (`src/admin/adminErrors.test.js`). **CLOSED (triage 2026-11-07):** organiser copy for both hints exists as `GATING_MESSAGES` per key, shown by the events screen (`src/core/errors.js:9-30`, `src/core/eventsScreen.test.js:497,524`).
11. **Not run before PR:** `module-boundary-checker` on the one `src/` change (a test file under `src/admin/`).
12. **Cloud:** RESOLVED 2026-10-26: migrations `20261023100000`, `20261023110000` and `20261023120000` were pushed to the cloud project (see above), keys all off.

## Known open items from T-GATE.B2 (admin grant writers and key switch, 2026-10-23)

_Source: CHANGELOG `T-GATE.B2`. Pushed to the cloud 2026-10-26 (D-G13 satisfied)._

- **PR #301 merged to `dev`** (stacked on #300). Its CI result is recorded on the PR, not re-checked here.
- **Done locally in T-GATE.B3 (migration 054): the enforcement hooks** (events gate, format freeze, participant cap, snapshot, resnapshot). The Per-event window lock is built in T-GATE.B5 (migration 056), dark.
- **No grant UI yet.** The gating hints are in `NOT_FOR_THE_CONSOLE` (`src/admin/adminErrors.test.js`); move them into the copy map when the grant screen lands. **CLOSED (triage 2026-11-07):** the Plan panel (grant screen) shipped in T-GATE.C and all gating hints now have copy in `ADMIN_ERROR_COPY` (`src/admin/adminErrors.js`, `src/admin/planPanel.js`; `src/admin/CLAUDE.md:189`, "the gating hints are no longer in `NOT_FOR_THE_CONSOLE`").
- **Intentional, recorded nits (security-reviewer):** a platform admin who is also a member can grant their own organisation (audited); the free-text grant `note` is stored verbatim in the audit row, so the screen should warn against participant data.
- **Intentional, recorded nit (code-reviewer):** `admin_grant_extend` does not require the new end to be after `now()`. Revisit if the fixed-date tests are ever made clock-independent.
- **Cloud:** RESOLVED 2026-10-26: migrations `20261023100000` and `20261023110000` were pushed to the cloud project (see above), keys all off.

## Known open items from T-GATE.B1 (entitlement core, 2026-10-23)

_Source: CHANGELOG `T-GATE.B1`. Gating's own spec is `Handoffs and Specs/GATING-SPEC.md` (local, not in git)._

- **Done locally in T-GATE.B2 (migration 053, see "Known open items from T-GATE.B2"): the admin writers** that create and revoke grants. Nothing writes `entitlement_grants` except these. (The one-open-event rule is T-GATE.B4, not B2.)
- **Done locally in T-GATE.B3 (migration 054): the enforcement hooks** (D-G8, D-G19, D-G4). Nothing is enforced until a key is flipped, and no key is flipped before the hooks it depends on. The Per-event window lock is built in T-GATE.B5 (migration 056), dark.
- **Deferred nit (code-reviewer, module-boundary-checker):** the catalog's `note` text ships inside the client bundle once `entitlements.js` reads it. Revisit when the first call site lands; the notes may need to move out of the bundle.
- **`CLAUDE.md` "Entitlements are a stub" (Non-negotiables)** is still accurate for the client. Rewrite it when the first call site lands, not before.
- **RESOLVED 2026-10-26:** migration `20261023100000` was pushed to the cloud project after the BTC pitch, through the Supabase MCP, after the `list_migrations` check.

## Known open items from T-ADM.\* (admin console v1, 2026-10-16)

_Consolidated from the "Known open items" of every T-ADM CHANGELOG entry (B1 to E1) and of the shared-UI refactor that landed between D1 and D2. Each item is stated once, with its source in brackets._

**Database and gate**

- **The database owner can still tamper with the audit log.** The append-only triggers stop every API role and the console, but `postgres` can disable the triggers, rewrite rows or drop the table. There is no tamper evidence and no retention or purge path. (B2)
- **`org_set_role` called directly writes no audit row.** Only the admin wrapper `admin_set_role` records a role change, so one made by service-role SQL is invisible after the fact. The T-TEN.B1/B2/B5 item asked for this once an admin console existed. (B4; T-TEN.B1/B2/B5)
- **Refused calls leave no trace.** No refused call writes an audit row. Audit ids have gaps, and a gap is not evidence of deletion. (E1, B2)
- **TOTP is switched on for the whole project.** Any signed-in user can enrol a factor on their own account. A person with a verified factor cannot change their password from a password-only session (`insufficient_aal`). Whoever holds a new login's one-time password can enrol a factor first, which blocks the real owner. (B6, CLAUDE.md)
- **Attaching a person gives them the organisation's data.** D-A9 (`p_attest_own_password`) is a flag the calling admin sets: a gate and an audit trail, not a proof that the person set their own password. (B4, CLAUDE.md)
- **Accepted limits recorded in the spec.** A second account an admin controls; an orphaned team login whose organisation was deleted; concurrent adds. (B4)
- **The `050` contract has blind spots.** It cannot see an ungated function or a new `app` helper with an innocuous name, nor roles other than `anon`, `authenticated` and `service_role`. (B5)
- **`team_can_manage` and `team_can_restore` were not probed with a platform admin as a member.** This is a minor oracle. (E1)

**Edge Function and first-enrolment window**

- **The first-enrolment window is mitigated, not closed.** An admin with only a password can enrol a factor and reach `aal2` before the owner does. The rollout runbook shortens the window (a temporary password, enrol at once, then the real one), and a factor challenge on first sign-in means someone else enrolled first. (E1; the B1 and B6 entries say "closed by the rollout runbook")
- **The Edge Function has no attack list of its own.** Its only test is the manual script `supabase/tests/manual/admin-accounts-e2e.mjs`, which CI does not run (CI does not serve the function) and which must be run before rollout. (E1, D3, B6)
- **The manual script lacks these checks** (listed by the Batch 12 reviewer): a bearer set to the anon or service key; an expired, stale-TOTP or banned admin; 405 and OPTIONS; a bad or oversized email; an unknown action; a non-JSON body; a concurrent double submit; `Cache-Control: no-store` and no password in the 409 body; direct service-key abuse of `admin_record_account_create` (`account_not_new`, `already_recorded`, a banned actor). (E1)
- **`account.create` is two transactions, not one.** The Auth login is created first, and its `account.create` row is written by `admin_record_account_create` in a second call. If that write fails the new login is deleted. A crash between the two can leave an orphan login that blocks its email until it is reset or removed; the hints `account_state_unknown`, `account_record_failed` and `account_stranded` name the cases. (B6, CLAUDE.md)
- **The D-A14 freshness window is tested with signed claims, not by waiting an hour.** (E1)
- **A timed-out create-organisation step can be repeated.** After a timeout at the organisation step the form stays editable, so a changed link name could create a second organisation for an owner who needed attestation. The message says to check the list first. (D3)

**Console UI and accessibility**

- **Busy-button and control-border contrast are the owner's decision.** Busy-button opacity 0.6 (white on teal, about 3:1) and control-border contrast (`--color-border`, about 2.1 to 2.5:1 against WCAG 1.4.11's 3:1) are unchanged in the shared shapes, and the admin overrides stay until decided. Changing them changes the live organiser console, where the dimmed look is the only busy cue on several screens. (refactor; D2)
- **`/results/` renders `.screen-feedback` unstyled.** This is pre-existing; it needs a marketing-owned class. (refactor; D2)
- **`.stage-meta` and `.roster-list` are restated in `btc/shared.css`.** They are left as they are because they are format-level. (refactor; D2)
- **Organiser sign-out ends every session on every device.** It uses auth-js's default `global` scope. This is pre-existing, unchanged, and not mentioned in the UI. (refactor)
- **No screen-reader pass of the console has been run.** The refactor entry records T5.3 as still owed. (refactor)
- **The console has its own small hash router**, not `core/router.js`. (D1)
- **The Audit log has no filter and only one way to page.** There is no filter by organisation or action; paging is "Show older changes" (50 per page). (D4)
- **The operator's own row still shows a role button.** The database refuses it with `admin_self_target`. (D4)
- **Adding someone as Owner has no confirmation step**, and the role defaults to Organiser. (D4)
- **Chrome ignores `autocomplete="off"` on email fields.** The operator's own address may be autofilled and refused with `admin_self_target`. (D3)
- **An in-app navigation that the person confirms still loses a one-time password.** The notice says so the next time the panel opens. (D3)
- **A request that times out may still succeed afterwards.** The next sign-in replaces the session. (D1)

**Tests and CI**

- **The adversarial spec cannot run against the cloud.** It signs tokens with the local published secret and creates users. (E1)
- **The CI database image differs from the local stack, in a way the adversarial spec had to absorb.** A signed-in member's `PATCH` on `org_members` answers 403 (no table privilege) on the local stack and 204 (a privilege exists, row security makes it a no-op) on the stack CI starts. Either wall holds, and the spec now asserts the invariant (the role read back unchanged, an attach to another organisation refused) and logs the privilege it saw. Worth a pgTAP pin of the API roles' privileges on `org_members` and the other tenant tables, so the first wall's state is a known fact rather than an image detail. (E1, Batch 12 CI run)
- **No dark-theme pass of the console has been run**, and the focus ring in dark mode is unchecked beyond token contrast. (Batch 9 and 11 accessibility reviews)
- **Playwright stubs the Edge Function** at the network edge, because CI does not serve it. The stub refuses any call without a bearer token or for another action, so the create-owner path is proved only by the manual script. (D3)
- **No post-build CI check greps non-admin bundles for admin strings.** Today that check is manual. (D3)
- **The e2e suite does not cover a 50-row audit page or the empty log.** The unit tests do. (D4)
- **Timing-sensitive tests, each seen once and not reproduced.** `src/core/appShell.test.js` ("still announces at the cap when the wall clock steps backwards") failed once under load; two orgs-spec tests failed once in one full admin run; the dev-app organiser flow "Could not load your organisation" failed once on a cold first run. (D2, D3)

**Process and rollout**

- **Rollout done 2026-10-16/17** (CLAUDE.md, "Rollout status"): migrations pushed and compared, advisors run (only the expected findings), `admin-accounts` deployed with `verify_jwt` true, `/admin/` checked live (headers, CSP against the real API host, noindex, unlinked), first admin added and enrolled, throwaway organisation created and removed. (B1 to B6, E1)
- **CLOSED 2026-10-22:** `account.create` and `member.add` have both run against the cloud (audit rows 4, 5, 8 and 9; see the entry below). The two throwaway organisations ("Noice Test", "Noice 2 Test") and their two logins were removed by SQL the same day, with the old "Grey Matter Rehearsal" organisation (no events); the audit rows stay. (smoke test 2026-10-17)
- **Change password panel built (2026-10-28, PR into `dev`).** The console has a "Change password" panel (`#/password`, `aal2` only); the first admin's temporary password is replaced through it. The dashboard "send a password recovery email" is NOT a rotation route for an admin with an authenticator (the link signs in at `aal1`, which GoTrue refuses a password change from, and lands on a page with nothing listening): rotation by someone else is the Auth admin API with the service key, or SQL. Admin password recovery by email (design option b, D-PW3) is deliberately NOT built: revisit when a second admin exists, or when D-PW2 and D-PW4 are done for organisers; a lost authenticator stays a runbook matter. (`Handoffs and Specs/ADMIN-PASSWORD-DESIGN.md`)
- **Admin password change: open items.** (1) **Stale-TOTP session (known gap, owner decision):** GoTrue asks only for `aal2`, so a stolen session whose TOTP is over 60 minutes old cannot call an admin function but CAN change the password and end the owner's other sessions; pinned by test X2 in `admin-console-adversarial.spec.js` (it fails, on purpose, if the gap closes). Mitigation needs the dashboard setting "require current password" (owner: read-only check U2, then decide) or the later password-changed email (D-PW7). **What is and is not protected today (exact):** a walk-up at an unlocked console IS stopped (the form asks for the current password); a stolen `aal2` token, fresh OR stale, is NOT stopped, because it can call `PUT /auth/v1/user` directly and skip the form. Only the server setting changes that: with "require current password" on, GoTrue refuses `current_password`-less or wrong requests whatever the token. `insufficient_aal` (a password-only session) is HTTP 401 on this GoTrue, pinned by X1. **Options considered, none built:** (A) the server setting (real fix, owner's dashboard, availability on this plan unknown, U2); (B) the password-changed email (D-PW7, needs a working sender); (C) Supabase `secure_password_change` (an emailed nonce for sessions older than 24 hours, also needs a sender); (D) a fresh-TOTP step-up inside the panel. **Recommendation: A, then B; do not build D.** D runs in the browser, so a thief with the token skips it exactly as they skip the current-password box; it would add a fourth form step and protect nothing the current-password box does not. (2) The current-password check in the form is UI-only (a throwaway client); the server enforces `current_password` only if the dashboard setting is on. (3) No audit row for a password change (the Auth log is the record); an audited one needs a new function and migration. (4) The owner still has to rotate the first admin's temporary password (service-key route first, then the panel) and read the dashboard settings; the build did neither.
- **TOTP could not be confirmed in the dashboard.** The hosted dashboard had no TOTP switch (Supabase documents TOTP as on by default); it was proven by the first enrolment. The factor cap of 4 (`config.toml` is local only) was therefore not confirmed on the cloud project. (rollout step 3)
- **Draft PR #281 (core sharing) is merged**, so the earlier warning about conflicts with `createOrgPanel.js` is closed. (D4, E1)
- **Duplication: the account lookup.** `createOrgPanel.js` has its own copy of the account lookup (about 120 lines) instead of `accountLookup.js`. The two differ in test ids (`#adm-attest` against `#adm-member-attest`) and in whether an error clears per keystroke. Fold it onto `accountLookup.js`. (D4)
- **Duplication: helpers and field builders.** `retryButton`, `heading`, `stepAside` and `messageFor` are copied across screens and should move to `screenParts.js`. `formParts.js` is a fourth field-with-error builder, not shared with the guess-the-bean, btc and core `labeledField` versions. (D4)
- **Duplication: CSS.** `.adm-member` and `.adm-audit-item` restate the `.card` box. (D4)
- **Duplication for one core refactor:** the one-time password card and its CSS (`core/teamScreen.js`, `.team-password`), clipboard copy (five sites), the Edge Function transport (`core/team.js`), the email regex, and `labeledField`'s hint and error slots. (D3)

---

## Known open items from BR-D1 and BR-D2 (2026-10-17)

_Deferred findings and accepted limits from the BR-D1 and BR-D2 CHANGELOG entries. Each is stated once, with its source in brackets._

- **The Random Selector has its own copy of the WCAG contrast maths.** Extract a shared `core/contrast.js` and have both the brand engine and the Random Selector use it, on a later pass. The brand engine's copy is in `core/brandColor.js`. (BR-D1)
- **The screens are wired to ask for a brand, but nothing answers yet.** BR-E1 (PR #297) did the wiring, including carrying the brand through `formatBody`; the database door is BR-B1. (BR-D2, BR-E1)
- **No logo contrast check.** A logo's own colours are not measured against the surface it sits on. (BR-D2)
- **The splash short-screen fix is covered by a stylesheet test only.** Check it on a real or emulated 1280x360 screen once a brand can be shown (it needs a faked door answer until BR-B1 exists). (BR-D2, still owed after BR-E1)
- **4K was checked emulated, not on a TV.** A real 4K display check is still owed. (BR-D2)
- **Accent-only brands count as unbranded.** A brand with an accent colour and no name or logo changes nothing, not even the credit. This is a decision, recorded here so it is not reopened by accident. (BR-D2)

---

## Known open items from BR-E1 (2026-10-18)

_Deferred findings and accepted limits from the BR-E1 CHANGELOG entry (PR #297)._

- **The database door does not exist.** `public_event_branding(p_org_id, p_event_id)` is BR-B1. The client sends both arguments (the event null when there is none), so the migration must declare `p_event_id` (a default is fine), and return a table or one record with `display_name`, `accent_hex`, `logo_url`, `logo_alt`. How the door treats an event with no entitlement is to be settled there (see the flicker item below). (BR-E1)
- **Do not release BR-E1 before the door exists, and not before the BTC pitch (about 4 November).** Until then every audience page load sends one failing request, then one per 10 minutes. Merging into `dev` is safe. (BR-E1)
- **A brand can show and then go.** The first question names no event and the second names the live event; if the organisation-level answer is a brand and the event-level answer is "nothing", the brand appears and then disappears. Depends on the door's rule for an event with no entitlement. (BR-E1)
- **The connecting card can show unbranded for a few seconds on a bad connection.** The brand reaches the shell only after the shell's first read. Fixing it needs the shell to take a brand getter; not worth it yet. (BR-E1)
- **Not built:** the banners (the splash's full-bleed banner and the projector's idle banner screen) and the logo on the printed results sheet (D-BR11). (BR-E1)
- **Duplicated plumbing, for a later pass:** the "call a database door with a timeout and unwrap the answer" skeleton is now in three places (`core/brandDoor.js`, `core/events.js`'s `findLatestEventForOrg`, `core/orgResolver.js`), and the UUID pattern is in `core/brandDoor.js` and `src/admin/ids.js`. `viewer-shell.js` also keeps a private copy of `raceTimeout`'s job (`withTimeout`). (BR-E1, module-boundary-checker)
- **A new projector body factory must pass its options through** to `createStageBody`, or its display is built unbranded every time; `brandWiring.test.js` checks the two existing ones. (BR-E1)
- **Stale comments:** `src/core/events.js:50-51` and `src/core/CLAUDE.md` still say nothing writes `events.status`; since 2026-10-04 `resolve_stage` writes `'concluded'`. Found by the gating recon, not part of BR-E1. (G-A2) **CLOSED (triage 2026-11-07):** both now say `resolve_stage` writes `events.status` to `concluded` (`src/core/events.js:61`, `src/core/CLAUDE.md:47`).

## Known open items from D-PW1 (organiser password recovery, 2026-10-23)

Built: the "Forgot password?" request screen, the screen a recovery link opens, a signed-in Change password screen. **D-PW2 (email sender), D-PW3 (admin recovery), D-PW4 (button-gated link and email template), D-PW5's server side, D-PW7 (password-changed notification) and D-PW8 (rate limits) are NOT started and wait for the owner's instruction.** Nothing is released and nothing is pushed to the cloud before the BTC pitch (about 4 November).

- **Before a real organiser can use it (owner, outside the repo):** (1) a working email sender must exist (D-PW2): the cloud project sends from Supabase's built-in sender, which is for testing and, per Supabase's documentation, delivers only to the project team's own addresses, so a real organiser may never receive a link; (2) `https://www.seduhscore.com/app/` must be on the Supabase redirect allow-list (Authentication, URL Configuration), or the link lands on `site_url` (the marketing home page) and nothing listens there; (3) check the cloud minimum password length (the form requires 8; the local stack says 6).
- **A link is one click, so a mail scanner can spend it** (spec risk 1). The button-gated link (D-PW4) is the fix and needs the email template; until then a scanned link shows "This link has expired or was already used" with a way to ask for a new one.
- **The recovery gate lives in memory.** After the link signs the person in, a reload (or a second tab) before they save goes straight into the console, signed in with the forgotten password unchanged: they can use Change password from the header. Holding the gate across a reload (a `sessionStorage` marker) was considered and left out.
- **An account with an authenticator app** (any organiser who enrolled a factor) is told so and the link's session is ended; there is no code step in this console (D-PW3). The operator's SQL runbook in CLAUDE.md is the way.
- **The answer time is only floored at 1.2 s.** The real send takes the server longer for an account that exists, so someone calling Supabase's `/recover` directly can still tell addresses apart by timing; nothing in the browser can fix that. A per-address limit (`over_email_send_rate_limit`) and a mail-server failure are folded into the same answer on purpose (they only happen for real accounts), which also means a failing sender shows "we sent a link" and only the auth logs show the failure (spec risk 8, D-PW2).
- **A save that timed out but committed**: resubmitting the same password gets `same_password` ("choose a different password from your current one"). The one-time-password screen behaved the same.
- **No "your password was changed" email** (D-PW7), so a takeover through a borrowed session is not announced; signing out the other sessions is the only mitigation.
- **Local mail catcher e2e** (`tests/e2e/password-recovery.spec.js`, project `dev-recovery`) follows the link itself because the local redirect allow-list holds only the site root (config.toml is not touched): run `npx playwright test --project=dev-recovery --no-deps` with the local stack up. It is in the CI chain after `dev-admin`; its first CI run is the proof that CI's `supabase start` delivers to Mailpit.
- **Pre-existing, logged only:** the footer version link measures 32x16 px at 360px (under the 44px target); `setFeedback` still has verbatim copies in `loginScreen.js` and `eventsScreen.js` (the shared one is now `core/dom.js`); a full vitest run prints a jsdom "Not implemented: navigation" error from a test outside this change.

## Known open items from Petrol Kaizen P4 (feedback ladder, 2026-11-13)

- **The admin field hint sits before its input.** `DESIGN.md` says the hint goes after the input, so the sibling selector that hides the error can reach it. Not changed in P4 (`ui-accessibility-reviewer`, Not fixed). Move the hint and keep the selector.
- **The admin plan panel's errors land in a polite status region** (pre-existing, `planParts.js`). An error should be assertive or sit inline by its cause.
- **The leave-screen and sign-out warning stays a native dialog on purpose** (a one-time password cannot be recovered). Recorded so nobody "fixes" it into an undoable panel; the owner can overrule.

# Seduh Score Next — Claude Code orientation

_State: Phase 0–5 done. See `ROADMAP.md` for current phase and `CHANGELOG.md` for
what's shipped, in what order, and why — this file no longer narrates that history
(it used to; see below for where it moved)._

Read these before touching anything:

1. `Handoffs and Specs/SEDUH-NEXT-HANDOFF.md` — the frozen spec. Vocabulary, schema,
   permission model, the full build plan (§14, T0.1–T6.x), Definition of Done (§11). This
   never gets edited to reflect progress (§0) — it's the original brief.
2. `CONVENTIONS.md` — how this codebase actually builds things, backfilled from what's
   shipped.
3. `CHANGELOG.md` — what's shipped, in what order, and why. The ground truth for "where
   are we."
4. `ROADMAP.md` — living phase-status tracker (the handoff's build plan, kept current —
   unlike the handoff itself).

This file carries only the rules that apply everywhere in the repo. Directory-scoped
`CLAUDE.md` files carry the module-specific conventions and history — Claude Code loads
them automatically once you're working in that subtree, so day-to-day work only pays for
the context it actually touches:

- [src/core/CLAUDE.md](src/core/CLAUDE.md) — shared, format-agnostic modules and `main.js`
  wiring.
- [src/marketing/CLAUDE.md](src/marketing/CLAUDE.md) — the public marketing landing page.
- [src/tools/CLAUDE.md](src/tools/CLAUDE.md) — standalone free community tools (the
  Timer, Brew Planner and Random Selector), outside the core/formats module boundary
  entirely, with no auth/Supabase.
- [src/community/guess-the-bean/CLAUDE.md](src/community/guess-the-bean/CLAUDE.md) —
  Guess the Bean, a free Community-tier tool with real auth+Supabase but no
  roster/scoring/advancement — a third kind of surface, neither `src/tools/` nor
  `src/formats/`.
- [src/admin/CLAUDE.md](src/admin/CLAUDE.md) — the platform operator's console at `/admin/`
  (MFA-gated, audited org provisioning): a fourth kind of surface with its own Supabase client
  and session; nothing outside `src/admin/` may import it (a test fails CI if so).
- [android/guess-the-bean-widget/CLAUDE.md](android/guess-the-bean-widget/CLAUDE.md) —
  native Kotlin/Glance Android home-screen widget for one public Guess the Bean session;
  outside `src/` entirely (own Gradle build, anonymous-only Supabase reads).
- [src/formats/cup-taster/CLAUDE.md](src/formats/cup-taster/CLAUDE.md) — Cup Taster.
- [src/formats/throwdown/CLAUDE.md](src/formats/throwdown/CLAUDE.md) — Throwdown (not started).
- [src/formats/liga-seduh/CLAUDE.md](src/formats/liga-seduh/CLAUDE.md) — Liga Seduh (not started).
- [src/formats/btc/CLAUDE.md](src/formats/btc/CLAUDE.md) — BTC (Barista Team
  Championship; BBTC is the Brunei-specific instance, not the format's name — shipped
  2026-09-23 as the second live format, v3.0).

Any invariant that applies across _every_ format (not just one) belongs here, in
Non-negotiables — not duplicated into each scoped file.

---

## Session state

Read `state.json` first, before Handoff/CONVENTIONS/CHANGELOG. Rewrite it after
every step — current task state only, never a narrative of what happened.
When kb-sync closes a task, state.json resets to the next task's skeleton.

**Read-time backstop (2026-09-08).** `state.json`'s reset contract — only `kb-sync`
sets `task.status` to `"done"`, and only once zero `review.open_findings` entries have
`severity == "blocking"` — is mechanically enforced on write by
`.claude/hooks/state-guard-on-write.cjs`, but that hook only covers writes made through
the Write/Edit tools; a Bash heredoc write bypasses it. So whoever reads `state.json`
first each session is the backstop: if `task.status` is `"done"` but
`review.open_findings` still lists a `severity == "blocking"` entry, treat the file as
corrupted, not as a legitimately closed task — don't act on its `next_action` or
`safe_to_branch` fields as if it parsed cleanly. Hand it to `kb-sync` to resolve
(re-open the task, or confirm the finding was actually fixed and the field is just
stale) before trusting anything else in the file.

## Delegation strategy

The 9 subagents in `.claude/agents/` per handoff §13:

- **After any migration/schema change** → `schema-guardian` (constraints, indexes,
  rollback blocks — and _verify_ the rollback by actually running it in a transaction,
  not just reading it).
- **After any RLS policy, RPC, or Storage change** → `security-reviewer`. Blocking, per
  the Definition of Done — never skip it.
- **After `core/ranking`, `core/advancement`, `core/timeclamp`, or `formats/*/scoring`
  changes** → `scoring-auditor`. Nothing in Phase 4 may start before these three pass
  this review (handoff §14).
- **After any change under `src/**`** → `module-boundary-checker` — the §6 test is "can
  a future format reuse this module without editing it?"
- **After any test file changes** → `test-auditor` — checks that tests assert the
  invariant, not merely pass.
- **After any UI change** → `ui-accessibility-reviewer`, verified at 360px first, before
  wider breakpoints.
- **After outbox/IndexedDB/sync changes** (Phase 3 onward) → `offline-sync-auditor`.
- **After any code change, any file** → `code-reviewer`.
- **End of every task** → `kb-sync`.

Run the relevant reviewers in parallel (single message, multiple Agent calls) when a
change touches more than one concern — e.g. a migration that's both schema and RLS gets
`schema-guardian` + `security-reviewer` together.

**Review with skepticism** (handoff §13): reviews on this project have found real bugs on
second and third passes, so don't wave a change through. But a clean result is a valid
outcome. A reviewer states it plainly and never pads it with nits to look useful, and a
finding that fails verification is dropped, not downgraded.

### Review protocol (adopted 2026-10-17)

Modelled on the process Anthropic describes for its own Code Review: several reviewers
search in parallel, a verification step removes false positives, and what survives is
deduplicated and ranked. `REVIEW.md` is the same calibration for the GitHub review
service (it reads `REVIEW.md` from `main`; the local `/code-review` command reads only
`CLAUDE.md`, which is why the rules everyone needs are here).

1. **Find** in parallel, as above.
2. **Verify before reporting.** Every finding carries a `file:line` and a concrete failing
   input or state, and the reviewer has re-read the code (or run the test) to confirm it.
   Behaviour claims cite the source, never an inference from a name. A finding you cannot
   trace from a real caller to a failure is dropped. Then every 🔴 Important finding, and
   every finding from a gate reviewer (`security-reviewer`, `schema-guardian`,
   `scoring-auditor`, `offline-sync-auditor`), gets an **independent check**: hand it to a
   fresh-context agent that did not produce it, with only the finding and the diff, and
   tell it to try to refute it. Report the finding only if it survives. (Anthropic has a
   separate group of agents vote on each finding; one independent checker is the
   proportionate version here, and the self-check above is not a substitute for it.) If
   the checker can neither confirm nor refute a gate finding, report it as **unverified**
   with what would prove it; it is never silently dropped. Nits skip the checker and are
   capped instead.
3. **Rank** with one scale across all reviewers (definitions in `REVIEW.md`):
   🔴 **Important** is the `state.json` severity `blocking` and holds the task open;
   🟡 **Nit** is non-blocking, at most five per review; 🟣 **Pre-existing** was not
   introduced by this change, so log it, don't fix it in this change.
4. **Deduplicate.** When two reviewers find the same thing, the owning domain reports it
   and the other points to them (each agent already names its owner).
5. **Scale depth to the change.** The triggers in the list above are the floor and are
   never skipped: RLS/RPC/Storage always gets `security-reviewer`, scoring code always
   gets `scoring-auditor`. Above that floor, a docs- or comment-only change needs
   `code-reviewer` at most, and a large or cross-cutting change (many files, a
   shared `core/` primitive, anything tenant-facing) gets every reviewer that applies,
   run twice if the first pass finds a 🔴.
6. **Re-review must converge.** Anthropic found one PR looping through 50+ review rounds,
   most of it re-flagging code that was there from the first pass. So: after a fix, re-run
   only the reviewers that raised 🔴 findings, on the new diff only; never repeat a finding
   already reported; when you report a bug, name its class so the author fixes every
   instance in one commit. After **three** rounds on one change, stop and ask the author to
   step back and reconsider the approach instead of running a fourth. Run one full pass
   before `kb-sync` closes the task.
7. **Reviewers advise; people approve.** No reviewer's output stands in for a human
   merge decision, and a clean pass is not evidence the change is correct.
8. **Record the outcome** in the CHANGELOG `Reviews` line: which reviewers ran, what each
   found, and how each finding ended up (fixed, wrong, intentional, or did not matter).
   A rising share of wrong findings means a reviewer's prompt or `REVIEW.md` needs
   tightening; noise costs a round trip every time.

**Cost note (2026-08-22, user decision):** `kb-sync` and `module-boundary-checker` run
on a cheaper model (`model: haiku` in their `.claude/agents/*.md` frontmatter) — both are
comparatively mechanical (session-log writing; import-path/grep-based boundary checks).
`schema-guardian`, `security-reviewer`, `scoring-auditor`, `offline-sync-auditor`, and
`code-reviewer` stay on the full model deliberately — these are the correctness/security
gates the skeptical-review discipline above depends on, and Phase 4's
own review cycles (T4.1, T4.2) already surfaced real bugs on second and third passes that
a weaker reviewer could plausibly have missed. `test-auditor` and `ui-accessibility-reviewer`
were considered and kept on the full model too.

---

## Non-negotiables

These apply to every format — Cup Taster today, Throwdown/Liga Seduh/BBTC later. Keep
them here, once; a format's own scoped `CLAUDE.md` should link back to this section
rather than restate it.

### Vocabulary — "trio" is banned

`CUP-TASTER-SPEC.md` v4.0 used "trio" to mean _set_, and "set" to mean the stage's whole
collection of sets — that inversion is not carried forward (handoff §2). Enforced by the
`no-trio-vocabulary` ESLint rule under `src/`, case-insensitive, across identifiers,
strings, and comments.

### The module boundary (handoff §6)

**Can a future format reuse this module without editing it?** `src/core/` must never
import from `src/formats/`, and format-specific logic must never leak into `src/core/`.
Enforced by `no-core-format-import`; `module-boundary-checker` catches the subtler cases
a static rule can't (indirect coupling, reimplementing a `core/` primitive inside a
format). v4.x's parallel timer implementation — one in `shared/timer.js`, a second,
incompatible one hand-rolled inside Cup Taster because the first couldn't be reused — is
the specific defect this boundary exists to prevent from recurring. This is also the test
Throwdown/Liga Seduh/BBTC get held to on day one: if building one of them requires
editing something in `src/core/`, that's a signal the module wasn't actually
format-agnostic yet.

### `correct` is a count, never a column (handoff §5.2)

`ct_results` stores one row per cupper per set. Standings positions and tallies are
always derived (a view or a pure function), never persisted as a field. Enforced by
`no-derived-storage`; `scoring-auditor` verifies by reading, since the rule only catches
the obvious property/assignment shapes.

### `elapsed_secs` has exactly one writer: `clampElapsed()`

Both the tap path and the manual-entry path must call it — it's the sole duration cap
(handoff §5.2, §6). Enforced by `no-raw-elapsed-write`.

### Entitlements are a stub, not a system (D14)

`entitlements.js` returns permissive for every key. No call site should branch on a
tier or gate result anywhere in this repo yet — that's explicitly out of scope until a
real entitlement system is built.

### `is_test` renders unmistakably, from the first commit (D9)

Designed in from the first live-surface rendering task, not logged as a defect
afterward. v4.x demo mode was indistinguishable from a real event in the audience view —
that is the failure this project exists to close.

### Tenancy: many organisations, one database (T-TEN, built 2026-10-10 to 2026-10-13)

Supersedes handoff §4's "one organiser, one org" (see `HANDOFF-CORRECTION-002.md`, locked D-T1 to D-T8). The rules
below are enforced by tests that fail CI, not by memory; the "how to add a tenant table" checklist is in
`CONVENTIONS.md`.

- **Every tenant table's parent is frozen.** A table with an `org_id` column has a `before update` trigger calling
  `app.forbid_parent_change('org_id', ...)`; a table scoped through `event_id` / `stage_id` / `heat_id` / `match_id`
  freezes those columns the same way (SQLSTATE 23001). A person who belongs to two organisations must not be able to
  move a row between them. Tests `033` and `040` fail when a tenant table lacks it.
- **Access is `app.is_org_member(...)` and nothing else.** Never a policy that reads `org_members` directly (the
  recursion bug). A cross-reference `BEFORE ROW` `SECURITY DEFINER` trigger (two ids that must agree) must start with
  `app.refuse_non_member(...)`, so a non-member gets the standard 42501 whatever ids they guess (test `045`'s catalog
  guard fails otherwise).
- **Anonymous people reach data only through narrow `SECURITY DEFINER` doors** (`public_org_by_slug`,
  `public_event_summary`, `get_scoring_record`, `submit_guess`, the Guess the Bean feed), never a table read:
  `events` is closed to anon, and `live_sessions` shows anon only ACTIVE rows (D6, `038`).
- **Audience links name the organiser** (`#/live/<slug>/projector|phone|splash`). A slug can never be changed (it is in
  printed and QR links). The old slug-less links are a legacy shim that shows the one organisation named by
  `VITE_LEGACY_AUDIENCE_ORG_SLUG` (see Repo).
- **Organisations are provisioned only by the service role** (runbook in the Repo section); there is no signup. The
  interim rule "no two-organisation user in the cloud" was lifted 2026-10-11 (B1, B2 and B6 are there).
- **Every new tenant table or RPC is added to the cross-organisation matrices** (`040` tables, `041` RPCs). A guard in
  each fails when one is missing, so the fix is a matrix entry, not an exception.

### Platform administration: the operator's console (T-ADM, built 2026-10-15 to 2026-10-16)

The platform operator (today one person) provisions organisations from `/admin/` instead of by hand-written
SQL. Not a tenant surface: it reads and writes **no organisation's participant data** (events, scores, entries,
people); it reads memberships and, through the admin functions, writes them. Module-specific conventions are in
[src/admin/CLAUDE.md](src/admin/CLAUDE.md); the database contract is `CONVENTIONS.md` ("Platform tables and admin
functions"); the locked spec is `Handoffs and Specs/ADMIN-CONSOLE-SPEC.md` (local, not in git).

- **What exists.** `app.platform_admins` and `app.admin_audit_log` (in the `app` schema, never `public`; the audit
  log is append-only by trigger, for every API role and for its owner by default, but the owner could still drop the
  triggers, and it has no purge and no tamper evidence), the `public.admin_*` `SECURITY DEFINER` functions (list and
  detail organisations, find an account by exact email, list the audit log, create an organisation, add a member, set
  a role, plus `am_i_platform_admin` and `admin_can_provision`), the `admin-accounts` Edge Function (makes a NEW login
  with a one-time password), and `/admin/` (noindex, unlinked, its own Supabase client and `sessionStorage` so it can
  never replace an organiser's session). Screens: Organisations (list, detail, add a member, change a role), New
  organisation, Audit log. `admin_record_account_create` is the one `admin_*` function without the platform-admin
  gate: it is service-role only (the Edge Function's audit writer) and carries its own checks.
- **The gate is the database's.** Every other admin function opens with `app.require_platform_admin()`, which
  needs all of: a row in `platform_admins` whose login is active (not banned or deleted); an `aal2` token; a TOTP
  verification in the last **60 minutes** (`amr`); and a live `aal2` session row. It answers `admin_required`,
  `admin_mfa_required` or `admin_session_ended`; the console only translates the hint. Never put an admin function
  behind anything weaker, and never add one that skips it: `048`, `050` and the adversarial attack list fail CI for
  the shapes they can see.
- **Metadata only, and no impersonation, on purpose.** An admin sees organisation names, link names, members
  (email, role, joined), counts and dates, and no participant data: no event, score, entry or person (D-A4). There
  is no "sign in as": attaching a person to an organisation gives THAT person its data, which is why the operator
  cannot target themselves (`admin_self_target`), why attaching an account whose one-time password someone else may
  know needs a deliberate tick (`member_password_unset`, D-A9: a gate and an audit trail, not a proof), and why
  each change is one transaction with its audit row (`org.create`, `member.add`, `member.role_set`).
  `account.create` is recorded by the Edge Function in a second transaction.
- **Add the first or another admin (the only way: no API, migration or seed makes one).** As the database owner (the
  Supabase MCP's `execute_sql` or the SQL editor), in this order, so the window in which a password alone is enough is
  as short as possible: (a) set a temporary random password on the person's login with the service key
  (`PUT /auth/v1/admin/users/<id>` with `{ "password": ... }`; the old one stops working) or, from the Supabase MCP
  (which holds no service key), `update auth.users set encrypted_password = extensions.crypt('<temp>',
extensions.gen_salt('bf', 10)) where id = '<id>'` (the same bcrypt hash, and `encrypted_password =
extensions.crypt('<temp>', encrypted_password)` proves it took; check first that the login has no live session and
  no factor); (b)
  `insert into app.platform_admins (user_id, note) values ('<auth.users.id>', '<who, why, when>');`; (c) they sign in
  at `/admin/` with the temporary password and **enrol their authenticator app at once**; (d) **the console has no change-password screen**, so the temporary password stays until it is rotated from
  the Supabase dashboard (Authentication, Users, send a password recovery email); make it long and random and keep it in
  a password manager (the first admin did; a password change from a password-only session is refused once a factor is
  verified, `insufficient_aal`). **If their first sign-in shows a CHALLENGE screen instead of the enrolment screen,
  someone else has already enrolled a factor: the account is compromised.** Delete that factor in the dashboard,
  rotate the password and start again. Until a factor is verified, anyone holding only the password could enrol
  their own. To remove an admin: `delete from app.platform_admins where user_id = '<id>';` cuts a live session off on
  its next call. Never reset an admin's password through the organiser Team screen (it refuses admins): use the Auth
  admin API.
- **Lost or stolen authenticator or session (the order matters).** (1) End every session of the login first: a
  global sign-out through the Auth admin API (`POST /auth/v1/logout?scope=global` with a token, or the console's
  "Sign out everywhere"), or a password reset (which deletes sessions). A ban only PAUSES the admin functions; it does
  not end sessions, so lift it only after step 3. (2) Remove the factor in the dashboard (Authentication, Users).
  (3) Enrol again yourself immediately. Reversed, a thief holding the old session is offered the enrolment screen the
  moment the factor goes. Provisioning by the SQL runbook below keeps working throughout. While the console is open
  it asks the database again whenever the tab becomes visible and every five minutes, so a revoked admin loses the
  screen without a reload.
- **TOTP is switched on for the whole project, so:** any signed-in user can enrol a factor on their own account;
  a person with a verified factor cannot change their password from a password-only session (`insufficient_aal`);
  and whoever knows a NEW login's one-time password could enrol a factor first and block the real owner's forced
  password change. The blast radius is small (the creator is already trusted) and it is a ROADMAP open item.
- **Known limits, accepted** (threat model, spec section 7): a stolen admin session is bounded by the 60-minute
  window and "Sign out everywhere", not prevented; `account.create` is two transactions, so a crash can leave an
  **orphan login** that nobody can sign in to (no function returns its password), belongs to no organisation and
  has no audit row: it blocks that email (a retry answers "already has an account") until the operator resets its
  password or removes it, and `admin_find_user` finds it (the console words these cases `account_state_unknown`,
  `account_record_failed` and `account_stranded`); refused calls write no audit row; audit ids have gaps that do not
  mean deletion; an admin who attaches someone to an organisation has given them its data.
- **Tests that hold this.** pgTAP `046` to `051` (identity, audit, read and write RPCs, the platform-tables
  contract, the audit writer); Playwright `dev-admin` (the console, plus `admin-console-adversarial.spec.js`: the
  attack list over HTTP, which a new admin function or door must be added to); and, for the Edge Function (not
  served in CI), `supabase/tests/manual/admin-accounts-e2e.mjs`, to run before every rollout.
- **Rollout status (2026-10-17): in the cloud and live (v3.4.0).** Done in order on 2026-10-16/17, each by the owner's
  approval: (1) the pre-checks (the exposed schemas exclude `app`, `pg_graphql` is off, `pg_default_acl` has no `app`
  entry, `postgres` can read `auth.sessions`); (2) the six migrations pushed with the Supabase MCP (cloud versions
  `20261016080210` to `20261016080352`, compared with `list_migrations`; advisors showed only the expected findings:
  `rls_enabled_no_policy` on the two `app` tables, lint 0029 on the admin functions, one unused index); (3) TOTP: the
  hosted dashboard had no switch to flip (Supabase documents TOTP as on by default), an organiser still signed in, and
  it was proven at the first enrolment (step 6); (4) `admin-accounts` deployed (version 1, `verify_jwt` true; the manual
  script had passed 35 of 35 against local first; probes: no auth 401, anon-key bearer 401, GET 405); (5) release PR
  #285 merged and `/admin/` checked live: 200, `no-store`, `X-Robots-Tag: noindex, nofollow`, the CSP with `connect-src
'self' https://*.supabase.co`, the meta robots tag, `/admin` redirecting to `/admin/`, and no link from `/`, `/app/`,
  `/tour/`, `/community/`, the sitemap or `robots.txt`; (6) the first admin, by the temporary-password procedure above,
  with the authenticator factor verified and one `aal2` session; (7) a smoke test on a throwaway organisation
  `console-smoke`, removed afterwards by SQL (the organisation, then the login a Team-screen add had made; the audit rows
  stay, by design).
  **Every console write path has now run against the cloud.** The first smoke test (2026-10-17) proved `org.create`
  with an existing account and `member.role_set` twice (an owner swapped between two accounts, which keeps one owner
  throughout, so `last_owner` never fired). On 2026-10-22 the owner proved the rest with throwaway organisations
  "Noice Test" and "Noice 2 Test": `account.create` with a NEW login (audit rows 4 and 5), `member.role_set` again
  (rows 6 and 7), `org.create` with an existing account and the attestation ticked (row 8) and `member.add` of an
  account whose one-time password was still unset, attestation ticked (row 9, `attested: true`). The two throwaway
  organisations and their two logins are still in the cloud and are removed by SQL on the owner's say-so.
  **The console cannot disable or delete anything**
  (organisation, member or login): a throwaway is removed by SQL, and a requested admin function for it is logged in
  ROADMAP.md ("Admin console: disable or delete", 2026-10-22).

### Definition of Done (handoff §11, restated)

A task is done when: acceptance criteria are demonstrated, not asserted · tests pass
including the negative cases the task names · lint/format clean, hook not firing · no
new TODO without a linked issue · scoring/ranking/timing changes have `scoring-auditor`
sign-off · schema/policy/Storage changes have `security-reviewer` sign-off including a
negative test proving a non-member reads zero rows · UI changes have
`ui-accessibility-reviewer` sign-off at 360px first · outbox/sync changes have
`offline-sync-auditor` sign-off · a session log entry exists (`kb-sync`) · every
migration has a rollback block, applies cleanly from an empty database, and — once
pushed to the linked cloud project — is never edited again (a fix is a new migration).

---

## Git — dev/main, main protected

`dev` is the working branch; `main` is protected (D26) — direct pushes to `main` are
rejected (`GH006`), changes land via PR. This required making the GitHub repo public
(branch protection is a GitHub Pro feature for private repos on the free plan); the
handoff's own `LICENSE.md` already frames this repo as publicly viewable for
transparency/portfolio purposes, so this aligns with that, not against it.

Migrations: local dev (`npm run db:reset`) first, then push to the linked cloud project
once verified — see the Repo section below for the project details and how the first
push (2026-08-30) was actually done (the Supabase MCP's `apply_migration`, not
`supabase db push` — this machine isn't `supabase link`-ed to the cloud project yet).

---

## Architecture (map only — see scoped `CLAUDE.md` files for the "why")

```
Handoffs and Specs/SEDUH-NEXT-HANDOFF.md   ← frozen spec, never edited for progress
Handoffs and Specs/guess-the-bean-next-port-SPEC.md ← Guess the Bean's own spec
index.html                      ← marketing landing page entry (root domain).
tour/index.html                 ← public format/Community tour (marketing-only, no auth).
app/index.html                  ← console SPA entry (moved out of root 2026-09-07 —
                                   see src/marketing/CLAUDE.md for why). Same main.js/
                                   router/screens as always, just served from /app/.
android/guess-the-bean-widget/  ← native Android (Kotlin/Glance) widget, own Gradle build;
                                   not part of the web build. See its own CLAUDE.md.
admin/index.html               ← the platform operator's console at /admin/ (noindex, unlinked,
                                   MFA-gated). See src/admin/CLAUDE.md.
tools/timer/index.html          ← standalone Timer tool entry. See src/tools/CLAUDE.md.
tools/brew-planner/index.html   ← standalone Brew Planner wizard entry. See src/tools/CLAUDE.md.
tools/random-selector/index.html ← standalone Random Selector (split-flap draw) entry, a free
                                   Community tool. See src/tools/CLAUDE.md.
community/index.html            ← public hub linking community tools and future resources.
guess-the-bean/index.html       ← Guess the Bean entry. See
                                   src/community/guess-the-bean/CLAUDE.md.
src/
  core/                         ← shared, format-agnostic modules.
                                   See src/core/CLAUDE.md.
  marketing/                    ← public landing + Tour pages (no auth, no router).
                                   Outside the handoff's original scope —
                                   see src/marketing/CLAUDE.md.
  tools/                        ← standalone free community tools (Timer, Brew Planner,
                                   Random Selector) — no
                                   auth, no Supabase. See src/tools/CLAUDE.md.
  community/
    guess-the-bean/             ← a free Community-tier tool WITH real auth+Supabase
                                   but no roster/scoring/advancement — a third kind of
                                   surface. See src/community/guess-the-bean/CLAUDE.md.
  formats/
    cup-taster/                 ← scoring, timing-surface, entry-surface, viewer-body,
                                   analytics. See src/formats/cup-taster/CLAUDE.md.
    throwdown/                  ← not started. See src/formats/throwdown/CLAUDE.md.
    liga-seduh/                 ← not started. See src/formats/liga-seduh/CLAUDE.md.
    btc/                        ← Barista Team Championship, live (2026-09-23). See
                                   src/formats/btc/CLAUDE.md.
  ui/
    tokens/                     ← design tokens (plain CSS custom properties) — the
                                   console's own paper/stage system; src/marketing/ does
                                   NOT use this file's color tokens (see its own CLAUDE.md).
  liveSurfaces.js               ← composition file beside main.js: registers each
                                   format's projector and phone body (core/formatBody.js).
  main.js                       ← composition root; conventions live in
                                   src/core/CLAUDE.md alongside the rest of the wiring.
public/
  marketing/                    ← the landing page's own static photos (not favicons —
                                   those stay at public/'s root, shared by both entries).
supabase/
  migrations/                   ← forward-only, each with a tested -- rollback: block
  seed.sql                      ← local-dev/CI-only: a fixed org + an authenticated
                                   login (bcrypt via pgcrypto). Applied by `db reset`/a
                                   fresh `start`, never by a bare `db push`.
  tests/                        ← pgTAP, one file per concern, numbered
                                   (000_with_check_gate.sql runs first, per T1.4)
  config.toml                   ← local stack, ports offset +100 (5442x) from the CLI
                                   default so this project's stack can run alongside
                                   the sibling Kira-Kira repo's stack
eslint-rules/                   ← the 4 custom rules enforcing this project's contracts
                                   (no-raw-elapsed-write has its own Linter-based test)
tests/e2e/                      ← Playwright — see CONVENTIONS.md for the three-project
                                   split (dev-harnesses / dev-app / prod smoke) and why.
.claude/
  agents/                       ← the 9 subagents
  hooks/lint-on-write.cjs       ← PostToolUse: ESLint on every .js write
```

## Repo

Local: `C:\Users\mfosa\OneDrive\Documents\seduh-score-next`
GitHub: `github.com/greymattercoffeewerks/Seduh-Score-Next` (public)
Live: `https://www.seduhscore.com/` (canonical public host; the workers.dev hostname remains
an infrastructure endpoint) — marketing landing page at
root, console app at `/app/`. Cloudflare Workers Builds deploys automatically on every
merge to `main` (confirmed via `wrangler deployments list`, PR #68, 2026-09-07 — see
`wrangler.jsonc`'s own comment for the fuller account of this being connected earlier
than documented).
Supabase project: **linked, 2026-08-30** — cloud project "Seduh Score Next"
(`wxzwanprluqmgoagbkpv`, org "Grey Matter Coffee Werks", region `ap-southeast-1`), all
migrations pushed via the Supabase MCP's `apply_migration` (not yet linked locally via
`supabase link` — that needs the project's DB password from the dashboard, not set up
this session; pushing further migrations can keep using the MCP, or `supabase link` once
that password is in hand). The first org + organiser login were provisioned by hand (see
CHANGELOG.md's dated entry) — credentials given to the user in chat, not committed
anywhere. Local dev still defaults to the local stack (`npm run supabase -- start`,
Studio at `http://127.0.0.1:54423`) — nothing about local dev changed.

**Provisioning an org (T-TEN.B4; invite-only — there is no signup and no API role can do this).**
**The admin console is live in the cloud (rolled out 2026-10-17, see "Platform administration"), so `/admin/` is
the normal path and this SQL is the fallback** (the console's New organisation screen is `create_org` plus an audit
row and the same refusals, plus the admin gate, `admin_self_target` and `member_password_unset`). Whenever the console cannot be used (a lost authenticator, for example), run these
as the service role (the Supabase MCP's `execute_sql`), never from the app:

1. Make sure the owner has an account (Auth → Add user in the dashboard) and that **they set their
   own password**. Note their user id.
2. `select public.create_org('Display Name', 'url-slug', '<owner user id>');` returns the new org's id.
   The slug is trimmed and lower-cased, 3 to 40 letters/digits with single hyphens, not a reserved word
   (`app`, `admin`, `api`, `www`, `live`, `results`, `tour`, `community`, `tools`, `guess-the-bean`,
   `about`, `contact`, `privacy`, `terms`, `neutrality`, `login`, `signup`, `auth`, `assets`, `bts`,
   `marketing`, `events`, `team`, `projector`, `phone`, `splash`, `help`, `docs`, `support`, `pricing`,
   `status`, `static`, `settings`, `dashboard`) and not taken. **A slug can never be changed** (it is in
   printed and QR audience links) and deleting an org frees it for reuse, so choose with care.
3. To give an existing account a second membership (a two-org user):
   `select public.org_add_existing_member('<org id>', '<user id>', 'organiser');`. Only attach an account
   whose holder has set their own password, never one a Team screen created with a one-time password
   (that org's owner still knows it).
4. Refusals carry a stable `hint` (`org_slug_taken`, `org_slug_invalid`, `org_slug_reserved`,
   `org_name_invalid`, `org_owner_not_found`, `member_exists`, ...): read the hint, not the text.
5. To make someone else owner or demote an owner use `select public.org_set_role(...)` (B5); an org can
   never be left without an owner.

**Build variables (Cloudflare Workers Builds → Settings → Build → Variables and secrets).** Three, all `VITE_`:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_LEGACY_AUDIENCE_ORG_SLUG=grey-matter-coffee-werks` (the one
organisation the old slug-less audience links mean; retire it, and the shim in `src/core/config.js`, when those
printed links are gone). `VITE_DEFAULT_ORG_ID` was **removed on 2026-10-13** (T-TEN.E5 step 6) and must not come back:
the organiser console takes its organisation from the signed-in person's memberships, and an unset variable never
throws. A change to these variables takes effect only on the NEXT production build (retry the latest build on
`main`). **Preview builds (pull request branches) do not receive them at all**, so a preview shows "supabaseUrl is
required" whatever the dashboard says; only a production build tells you anything. Check a production change by
fetching `/app/`, then its `app-*.js`, and looking for the Supabase project ref and the slug; keep the previous
deployment (Deployments → Rollback) one click away until you have.

**Pushing a migration to the cloud project is a separate, manual step from merging its
PR — merging to `main` only deploys the frontend (Cloudflare Workers Builds); it never
touches the cloud database.** Found the hard way, 2026-09-05: three migrations
(`events_anon_safe_read`, `record_heat_time_overwrite_scoped_to_manual`,
`delete_test_event_rpc`) landed on `main` across PRs #49–#51 and sat live-deployed on the
frontend for hours to a day+ before anyone noticed the cloud database was never updated
to match — surfaced only when a user hit "Something went wrong saving that" clicking the
brand-new Delete button in production, root-caused to the RPC function not existing on
the cloud project. **After merging any PR that adds/changes a migration, immediately
check whether it's been pushed to the cloud project too** — compare
`supabase/migrations/` against `mcp__<supabase-project>__list_migrations`'s own output,
and push whatever's missing via `apply_migration` before considering the task done.
Current phase: check `ROADMAP.md`.

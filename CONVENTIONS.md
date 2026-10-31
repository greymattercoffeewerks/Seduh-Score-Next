# Conventions — Seduh Score Next

How this codebase actually builds things. Backfilled from what's shipped — unlike
`Handoffs and Specs/SEDUH-NEXT-HANDOFF.md` (frozen, never edited for progress), this
file is edited continuously as patterns are established or refined.

---

## Vocabulary

**"trio" is banned** everywhere under `src/` — identifiers, strings, comments. The term
is **set**: three cups, two identical, one different, what a cupper identifies. A
**stage** (prelims/semis/finals) runs a fixed number of sets; a **heat** is a group of
cuppers running the stage's sets together. `CUP-TASTER-SPEC.md` v4.0 used "trio" for
_set_ and "set" for the stage's whole collection — that inversion is not carried
forward. Enforced by `eslint-rules/no-trio-vocabulary.js`, which segments identifiers on
camelCase/snake_case/kebab-case boundaries before comparing (`trioCount` is caught even
though a plain `\btrio\b` regex would miss it — there's no word-boundary between "trio"
and "Count" in one continuous identifier).

---

## The module boundary

`src/core/` — `partition`, `ranking`, `advancement`, `countdown`, `timeclamp`,
`publish`, `viewer-shell`, `export`, `registry`, `entitlements` — is shared and
format-agnostic. `src/formats/<format>/` is where a specific game (Cup Taster, and
later Guess the Bean) builds on top of it.

| Direction                                                                                   | Allowed?                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formats/*` imports from `core/*`                                                           | Yes — this is the normal case                                                                                                                                                             |
| `core/*` imports from `formats/*`                                                           | **Never.** Enforced by `no-core-format-import`                                                                                                                                            |
| `core/*` reimplemented inside `formats/*`                                                   | **Never.** A second timer, ranking, or partition implementation living in a format directory because the `core/` version "didn't fit" is the exact defect this boundary exists to prevent |
| `formats/*` naming a module generically (`scoring.js`) while encoding format-specific rules | Wrong location — belongs under `formats/<format>/`, not `core/`, even with only one caller today                                                                                          |

The test for every new module: **can a future format reuse this without editing it?**
If the answer requires a format check inside a `core/` file, the module needs a real
extension point, not a conditional.

v4.x's `shared/timer.js` is the cautionary tale: tick-based (`ms -= 100`), owned its
overlay by element id, held singleton module state. Cup Taster couldn't reuse it, so it
wrote a second, parallel heat timer that shared nothing with the first — and both
shipped in the same codebase. `core/countdown` (§14 T2.4) is engine-only by design: no
`setInterval`, `setTimeout`, `requestAnimationFrame`, or DOM reference anywhere in the
module, provable by grep. `core/timeclamp` is the one place the duration cap is
enforced, called by every entry path — never a second cap, and never a database `CHECK`
standing in for it.

`src/ui/tokens/` is subject to the same test applied to design rather than logic: a
token layer with format vocabulary or format-specific values baked in (e.g. Cup
Taster-only copy in a shared preview/demo) fails it the same way a `core/` file importing
`formats/*` would. Caught once in practice — see "Design tokens" below.

---

## Local patches are an anti-pattern — fixes go to source

A fix applied to one consuming file instead of the shared module/token it should have
come from creates a second copy of the same logic, silently. Live Seduh Score has paid
for this repeatedly — a header lockup pattern needing the same fix in four separate
files because one of them carried a local override instead of inheriting the shared
rule; a login-state fix that had to be applied in two places because the layout wasn't
unified into one shared surface in the first place. When a bug or a missing behavior
traces back to `core/`, `src/ui/tokens/`, or any other shared module, the fix lands
there — never as a one-off patch in the format or screen that happened to surface it.
If a shared module genuinely can't serve a new caller's need, that's a signal the module
needs a new extension point, not that the caller should route around it locally.

---

## UI rendering & focus management

**Rebuild-then-refocus, never refocus-then-rebuild.** Carried forward from Kira-Kira,
where this was the single most recurring bug class — fixed independently six separate
times. Cup Taster is structurally exposed to the same failure: `render()`-style
rebuilds that replace a DOM subtree via `innerHTML` and rebind every handler on every
state change are exactly the shape v4.x used. Four cuppers finishing within seconds of
each other on the scoring surface is precisely where a dropped tap would hurt most and
be least noticeable.

The rule: whenever an action both (a) rebuilds a DOM subtree from state and (b) wants to
move focus somewhere as a result, the focus call happens **after** the rebuild resolves,
never before — an element targeted before the rebuild may not exist once it lands.
Concretely: `await` the reload/re-render (or the store-driven equivalent), **then**
call `.focus()` on the post-rebuild element. Prefer centralizing reset/refocus logic in
one function every call site shares over patching each call site individually — this is
also the "local patches are an anti-pattern" rule applied to focus management
specifically.

---

## Migration workflow

- Local dev: `npm run db:reset` (wraps `supabase db reset` — applies every migration to
  a fresh local database).
- Every migration needs a `-- rollback:` block, and the rollback must actually be run
  once, inside `begin; ... rollback;`, before the migration is considered done — a
  rollback block that looks correct and isn't (e.g. dropping policies but never
  disabling RLS, leaving a table in a deny-all state instead of "RLS off") is a real
  failure mode, not a hypothetical one.
- **Forward-only, with a sharp edge**: once a migration has been pushed to the linked
  cloud project, don't edit that file again — write a new migration instead. Check
  `npx supabase migration list` before deciding a file is still safe to touch.
- `correct` (or any tally/standings position) is never a migration-added column —
  `schema-guardian` blocks this.
- NULL-aware uniqueness: anywhere two rows could both hold a relevant NULL (e.g.
  `event_entries.person_id` before a walk-up is matched to a `people` row), use a
  partial unique index, never a naive table-level `UNIQUE` — a table-level constraint on
  `event_entries (event_id, person_id)` would fire mid-merge (handoff §5.1).

---

## RLS pattern

Many organisations in one database (T-TEN, `HANDOFF-CORRECTION-002.md`; handoff §4's
"one organiser, one org" no longer holds). A person can belong to several organisations;
the console works in the one they have chosen. Audience surfaces have no login: an anonymous
caller reads only ACTIVE `live_sessions` rows (and published results), plus whatever the
narrow `SECURITY DEFINER` doors answer; `events` is closed to anon. Write anywhere requires
`org_members` membership in the owning org. Everything else is org-scoped read and
write. Every `FOR INSERT`/`FOR UPDATE`/`FOR ALL` policy needs an explicit `WITH CHECK` —
`USING` alone governs reads and the pre-image of updates, not what gets written; CI
(§14 T1.4, `supabase/tests/000_with_check_gate.sql`) fails the build if one is missing.
Every write policy in this schema is declared `FOR ALL` (one policy handling
insert/update/delete together, not three separate ones) — the gate's own query
accounts for this (`cmd in ('INSERT','UPDATE','ALL')`, not just the first two), since
`pg_policies.cmd` shows `'ALL'` for a `FOR ALL` policy, never `'INSERT'`/`'UPDATE'`
individually.

**The chokepoint**: `app.is_org_member(org_id)` — `SECURITY DEFINER STABLE`,
`SET search_path = ''`, fully-qualified `public.` references — never a policy on
`org_members` selecting from `org_members` directly (the classic Supabase recursion
bug, Postgres error 42P17). For tables without a direct `org_id` column, a chain of
resolver functions walks the FK graph up to `events.org_id` (`org_id_for_event` →
`org_id_for_stage` → `org_id_for_heat` → `org_id_for_heat_entry`, each built on the
previous) — the single place each join lives, so no policy re-implements the chain
inline. Mirrors Kira-Kira's `app.can_read_tx` chokepoint pattern.

**Base GRANTs are a separate layer from RLS, and both are required.** A role needs the
underlying table privilege before RLS is even consulted — new tables aren't
auto-exposed to `anon`/`authenticated` by default. Discovered directly (not from prior
knowledge) when the T1.3 RLS policies alone produced `permission denied for table orgs`
against a role with zero GRANTs; fixed with a dedicated grants migration.

**A table with two independent FKs that are supposed to agree needs an explicit check,
not an assumption.** `live_sessions.org_id` and `event_id` had no enforced relationship
until a live-proven cross-org exploit (an org member inserting a row with their own
`org_id` but another org's `event_id`) got caught in review — fixed with a
`before insert or update` trigger resolving the "real" org from `event_id` and
rejecting a mismatch. When adding a table with more than one FK that encodes the same
real-world entity from two directions, check whether the schema alone guarantees they
agree, or whether a trigger is needed.

**Cross-reference triggers refuse a non-member first.** Such a trigger runs BEFORE
row-level security and is `SECURITY DEFINER`, so unless it opens with
`perform app.refuse_non_member(<the row's org>, '<table>')` it answers a non-member with
its own message when guessed ids do not fit and the standard 42501 when they do: a yes/no
oracle about one id pair. Read the org with an `app.org_id_for_*_internal` resolver (they
never depend on who is calling), and compare with `is distinct from`, never `<>` (a
missing parent is NULL, and `NULL <> x` is NULL, which passes). `045` fails when a
`SECURITY DEFINER` `BEFORE ROW` trigger function has neither the gate nor the standard
refusal.

### How to add a tenant table (checklist; each item is enforced by a test that fails CI)

1. **Scope** it to an organisation: an `org_id` column, or a chain of immutable parents up
   to `events.org_id` with an `app.org_id_for_*` resolver (never a policy that walks the
   chain inline).
2. **Row-level security on**, a `_read` and a `_write` policy built on
   `app.is_org_member(...)`, and an explicit `WITH CHECK` on the write one (`000`).
3. **Freeze the parent columns**: a `before update` trigger calling
   `app.forbid_parent_change(...)` for `org_id` and for every parent id column, enabled,
   row-level and unconditional (`033` for `org_id`, `040` for every tenant table, `042`
   for the leaf tables). Do this in the same migration that adds the column.
4. **Base grants** (a separate layer from RLS) kept narrow: no privilege `anon` or
   `authenticated` does not use (`020`; production has narrow privileges, CI's database
   broad ones, so a test must hold in both). **Grant explicitly, in the same migration that
   creates the table.** From 2026-10-30 Supabase stops auto-granting new `public` tables to the
   API roles, so a table with no `grant` answers "permission denied" (also on `db reset`, CI and
   preview branches). Grant only what each role uses (usually `authenticated`; `service_role`
   holds no table privileges in production and our functions are `SECURITY DEFINER`, so do not
   add it by reflex). A table closed to every role on purpose goes in `DENY_ALL` in
   `supabase/migrationGrants.test.js` with the reason; that test fails otherwise.
   **Column-level insert and update grants: a client never chooses `id` or an audit column.**
   Grant `authenticated` INSERT and UPDATE on the listed columns only (`revoke insert, update ...;
grant insert (a, b, c) ...; grant update (a, b, c) ...`), leaving out `id`, `created_at` and
   `created_by` (let the column defaults fill them). Otherwise a client can name a primary key,
   and the answer to a conflict (`23505` on a plain insert, `403 ... (USING expression)` on an
   upsert, against `201` for an unused id) tells a member of any organisation whether a uuid is a
   row of another one. With the column grant, naming the column is refused by the privilege check
   (`403 / 42501`) before any row is looked at, identically for every id. Keep `org_id` and the
   parent ids in the UPDATE list so the freeze trigger (item 3) stays the answer for a move.
   First done for `org_person_affiliations` (`20261031120000`; `063` and
   `tests/e2e/affiliations-id-oracle-live.spec.js` hold it). A function that must write a column
   the client may not (for example `merge_people` copying `created_by`) calls a narrow
   `SECURITY DEFINER` helper that opens with `app.refuse_non_member`. Tables that predate this
   rule still grant every column; see the PR that introduced it for the list.
5. **Two ids that must agree** (a child and a parent from two directions): a
   cross-reference trigger that opens with `refuse_non_member` (above).
6. **Views** are `security_invoker`. Anything anonymous people need is a narrow
   `SECURITY DEFINER` function that checks its own input, never a table grant.
7. **Add it to the matrices**: `supabase/tests/040_cross_org_matrix.sql` (read, update,
   delete, insert and move, for anon, a signed-in stranger, each organisation's member and
   a member of both, with exact row counts) and, for every RPC that takes an organisation,
   event, heat, match, stage, slot, entry or person id,
   `supabase/tests/041_cross_org_rpcs.sql` (six cross-organisation attempts, each refused
   with the function's own guard). The completeness guards in both fail until you do.
8. **Cloud**: merging the migration's PR only deploys the frontend. Push the migration
   with `apply_migration` as a separate, owner-approved step, then compare
   `list_migrations` and re-run the advisors.

### Platform tables and admin functions (the admin console; not tenant tables)

The admin console (`ADMIN-CONSOLE-SPEC.md`, local only) has tables that belong to no organisation:
`app.platform_admins` and `app.admin_audit_log`. **Do not copy the tenant-table checklist for
them, and do not add an exemption to `033`/`040`/`042`.** The rules are these.
`supabase/tests/050_platform_tables_contract.sql` fails CI for the breaks it lists; its header states
what it cannot see (an ungated function with an innocuous name, a new `app` helper with an
innocuous name, roles other than `anon`/`authenticated`/`service_role`), and those are reviewed.

1. **They live in the `app` schema, never `public`.** The API does not expose `app`; the tenant
   guards cover `public` only, so nothing needs exempting. A platform table in `public` makes
   `040` fail (every table in `public` must be in its matrix), and `050` fails on the name alone.
2. **Row-level security on, no policy at all, and an ACL that names only the owner.** Non-exposure
   is not the control (the cloud's exposed-schema setting is a dashboard value, and `anon` and
   `authenticated` hold `USAGE` on `app`): the revokes are. Revoke the table, its identity sequence
   and every function you add (`revoke all ... from public, anon, authenticated, service_role`).
   `050` checks every table, foreign table, sequence and view in `app`: table, column and
   sequence ACLs (a grant to `PUBLIC` included), the owner, and that no default privilege is set
   for the schema.
3. **No foreign keys to tenant tables** from a history table (an audit log must survive an org or a
   login being deleted); an audit table is **append-only for everyone**, including the owner (a
   `BEFORE UPDATE OR DELETE` row trigger and a `BEFORE TRUNCATE` statement trigger, both
   `ENABLE ALWAYS`; see `047`). Be honest in the migration header about what the owner can still do.
4. **An admin function is a public `SECURITY DEFINER` function that opens with
   `perform app.require_platform_admin();` and nothing before it**: no declare initialiser, no
   argument default that calls a function (a default runs before the body). `048` checks that shape
   for every `public.admin_*` function a signed-in caller can run, and `050` that every function that
   touches the platform tables is `SECURITY DEFINER` with `search_path = ''` and not executable by
   `anon` or the service role. A function that writes is `VOLATILE` (`049` checks the three write
   RPCs). The console calls these with **POST** (a convention: nothing tests it, because PostgREST
   also allows GET for a `STABLE` function, which would put ids and emails in URLs and logs).
5. **Every refusal keeps a stable hint** (`admin_required`, `admin_mfa_required`,
   `admin_self_target`, `member_password_unset`, `last_owner`, ...): the UI switches on the hint,
   never the text. A wrapper around an existing function lets that function's own refusals through
   untouched and remaps only the one it must (and only by SQLSTATE **and** exact message).
6. **A change and its audit row are one transaction** (`app.admin_audit` is called last, outside any
   exception handler); a refused call writes nothing; a no-op writes nothing. The audit `detail`
   holds only the pinned keys per action (`049`), and no key may name a secret
   (`app.admin_audit_detail_ok`).
7. **Add the function to the guards on purpose.** A public function that takes a uuid needs an entry in
   `041`'s exemption list (its authorisation is the platform admin, not an organisation, and its test
   file is named in the comment); a new function that is named like admin/platform work or touches the
   platform tables goes in `050`'s exact list; a new reader or writer of the audit table goes in
   `047`'s set; a new read RPC gets its result columns pinned in `048`.
8. **Tests are written to fail.** A catalog check that reads a nullable column (`proconfig`, `relacl`)
   wraps its predicate in `coalesce(..., false)`: `not (NULL)` silently drops the row and the check
   passes for an unpinned function. Set the claims with BOTH `request.jwt.claims` and
   `request.jwt.claim.sub` to the same user, and clear `claim.sub` when there is no user:
   `auth.uid()` reads the legacy `claim.sub` first, `auth.jwt()` reads `claim` then `claims`, and they
   disagree if only one is set (the helpers in `046` to `049` show the pattern). Look only at audit ids
   above a baseline. Exercise success as the `authenticated` role, not only as the owner. Hand-run
   mutants of every rule and confirm the test kills each one.
9. **Cloud and seeds**: as for any migration, merging does not push it. The first admin is inserted
   by SQL by the operator, never in a migration. **No seed inserts an admin** (each test inserts its
   own inside its transaction; a local admin is inserted by hand, as `postgres`): do not add one to
   `supabase/seed.sql`, whose own header warns that `db reset --linked` would apply it to a linked
   project. Confirm the cloud's exposed schemas do not include `app` before pushing.
10. **A second writer of an existing rule shares its body, it does not copy it.** When a new admin function must
    apply the same rules as an existing one (T-GATE.C: `admin_payment_confirm` and `admin_grant_create`), move the
    validation and insert into an `app.*` helper that both call (`app.grant_insert`), and keep the public function's
    gate, its hints and its audit row in its own body. The existing pgTAP file for the original function, left
    untouched and green, is the proof that the refactor changed no behaviour. A copied rule drifts; the helper cannot.

---

### Seduh ID link: the owner's runbook (T-ID.B2, 20261030140000)

`people.global_person_id` is written by the database only: `public.link_person_identity(p_org_id, p_person_id)` (members, own
organisation's person, finds an identity for the person's phone, never creates one, returns nothing) and the owner. The guard
trigger lets a change through only when the transaction-local flag `app.seduh_link_write` is `'on'` and the role is not an
API role; a change of `phone` sets the link to NULL. A new function that must write the column sets the flag itself, and
`062` fails until it is added to its "only writers" list. There is no admin function or console screen for any of the
following (owner decision 7: counts only); each is owner SQL, in ONE transaction. Never put a phone or a name in a note.

- **Unlink one organisation's person (durable).** The block lapses by itself if the person's phone changes.
  `begin; select set_config('app.seduh_link_write','on',true); update public.people set global_person_id = null where id = '<person>'; insert into app.person_link_blocks (person_id, phone_e164) select id, phone from public.people where id = '<person>' on conflict (person_id) do update set phone_e164 = excluded.phone_e164; commit;`
  To lift it: delete the `person_link_blocks` row.
- **Merge identity X into Y (duplicate identities).** Check first: X is not `opted_out` (merging turns it into `merged` and loses
  the opt-out; refuse), Y is not X, and Y does not resolve through `merged_into` back to X (no cycle). Then, in ONE transaction that starts `begin; select set_config('app.seduh_link_write','on',true);` (the flag; Y should be `active`, not a tombstone):
  `update public.people set global_person_id = Y where global_person_id = X;` `update app.seduh_identities set status='merged', merged_into=Y where id=X;`
  `insert into app.seduh_identity_merges (kept_id, merged_id, merged_by, reason_code) values (Y, X, '<operator user id>', '<duplicate_person|phone_changed|recycled_number|other>');`
  The tombstone keeps its `display_name` as is. **A name is blanked only on an erasure or objection request for that person**,
  as a separate step (`update app.seduh_identities set display_name = null where id = X;`, allowed for a tombstone and for opted_out);
  it is never a side effect of a merge.
- **Opt out (erasure/objection, E1).** `update app.seduh_identities set status='opted_out', display_name=null where id = '<id>';` The
  phone stays as the suppression record. The link function still links an opted-out identity (inert), on purpose, so the
  readable link cannot tell a member which phones objected.
- **Accepted signals (spec 3.3):** a member can learn that an identity exists for a phone they type in (a published non-test
  result exists); a member of two organisations sees the same uuid for the same person.

### Seduh ID backfill: the owner's runbook (T-ID.B4, 20261031100000)

The one-time step that creates identities. `app.seduh_identity_backfill(p_apply boolean)` (owner only: no API role, `service_role`
included, can execute it, and it refuses one by name) reads the published, non-test results and answers with counts and uuids only
(never a phone or a name). `false` is a dry run that writes nothing; `true` creates and links. Three scripts in `supabase/scripts/`:
`seduh_identity_backfill_dry_run.sql` (read only), `seduh_identity_backfill.sql` (ends in ROLLBACK until you change it to COMMIT) and
`seduh_identity_backfill_undo.sql` (same). **"Named in a published result"** means: the payload's `podium` (or full `standings`, when
published) holds a name and cafe that exactly ONE entry of that non-test event matches (trimmed; payloads carry no ids and must not
start to), and that entry has a person of the event's organisation. Roster-only people, entries the payload does not name, walk-ups,
test and unpublished events create nothing; a slot that matches several entries, or none, is counted and skipped, never guessed.
Per named person: non-E.164 phone skipped and listed; an owner-blocked person left unlinked (no identity made for them); an existing
identity for the phone (any status, a tombstone resolved through `merged_into`) is reused and never overwritten; otherwise one is created
(`archive`, `active`, the earliest published record's name cut to 120). A person already linked to a different identity is left alone and
listed. A new function that writes `people.global_person_id` must be added to the "only writers" list in test `062`.

1. Push the migration (owner approval; compare `list_migrations`), then run the dry run and read it. Expected skips are listed by person id.
   **Vet the results first:** organisation members write payloads, entries and people, so a forged "published result" can name any phone
   (security review, confirmed). `creates_by_result` lists each result with its organisation, event and identities it would create; check them
   against events you know are real and pass only those result ids as the second argument (`array['<id>']::uuid[]`) in the dry run and the run.
2. Run `seduh_identity_backfill.sql` with ROLLBACK first; read both reports (the second must say 0 to create, 0 to link). **Save
   `created_identity_ids` and `linked_person_ids` from the first report** outside the repo, then change the last line to COMMIT and run again.
3. **Undo a committed run:** paste the two lists into `seduh_identity_backfill_undo.sql`. It unlinks only those people (and only if still linked
   to one of those identities) and deletes only those identities, and only while they are still `archive`/`active`, have no linked person and
   no tombstone points at them; an identity that gained a person since (the link function is legitimate) is kept and counted. Identities that
   existed before the run, and links made by anyone else, are never touched. Deleting an identity is irreversible.

### Entitlement hooks (database checkpoints; T-GATE.B3, 054)

Gating is enforced in the database, never only in the client. The rules a new hook or cap must follow (the
pattern is in `20261023120000_entitlement_enforcement_hooks.sql`; the spec is `GATING-SPEC.md`, local only):

1. **Ask `app.has_entitlement` / `app.entitlement_limit` and nothing else.** A hook is a no-op while its key is
   unenforced (the seed), so it can ship dark and behaviour is unchanged until a key is flipped. A new key is
   seeded off.
2. **A tenant write's hook opens with `app.refuse_non_member(...)`** (a `BEFORE` row trigger runs before row-level
   security, so the standard refusal must come first; test `045`). A refusal is 42501 with a stable hint
   (`entitlement_required`, `entitlement_cap_reached`, ...) and the key in the DETAIL; the UI reads the hint.
3. **An exemption is an explicit allow-list of one, never a list of known values.** An unknown enum value (a
   format the database does not know) is capped or gated as the strictest branch (fail closed). B3's draft skipped
   the cap for any value off the known list; the first fix exempted `btc` and `guess_the_bean`, and an independent
   check found an off-list value still getting through; the final fix exempts `btc` alone.
4. **A cap is counted under a per-parent advisory lock**, over the rows that count (non-withdrawn), and applies to
   the insert AND to every path that adds a counted row back (a reinstate is an UPDATE, not an insert).
5. **A snapshot column is written only by a database definer function.** The trigger checks `current_user`, so a
   member's direct UPDATE is refused even for their own organisation (23001); the stamp itself is set once.
6. **A snapshot is a no-op until a key is enforced**, so events that go live while dark are not frozen at the
   lowest tier. A change of tier after go-live goes through an audited, upward-only admin function.
7. **A column that decides which cap or gate applies** (`events.format`) joins the immutable-parent trigger,
   or a Community organisation can change it to dodge the cap.
8. **A fact the database owns (T-GATE.B4, `events.ended_at`) is written by named definer functions only.** Three parts,
   all needed: the column is nulled on an API insert (a client cannot pre-set it), an API UPDATE of it is refused 23001
   (a `BEFORE UPDATE OF` trigger with a `current_user` check), and the definer functions that may set it are the
   only writers. A status change the client can also make (`concluded`) is accepted as the trigger's own stamp only
   when the organiser can already do the same thing through a definer function (the migration header says why).
9. **A gate that needs a child row is checked at the first transition that creates the child's state, not at the
   parent's creation.** A Per-event grant is scoped to an event, and an event does not exist until it is created, so
   B3's creation-time `btc_format` check refused the very buyer it was for. B4 moved it to first go-live (where the
   event exists and the snapshot is taken).
10. **A restrictive-policy lock binds every invoker path too, so a lock must be read by the definer paths it must leave
    open.** The Per-event window lock (T-GATE.B5, 056) is a RESTRICTIVE row-level-security policy on the event's child
    tables. Every invoker trigger and function that reads or deletes those rows then sees zero of them while the event
    is locked, and does nothing silently. B5's `app.btc_delete_event_children` (a BEFORE DELETE trigger on `events`) would
    have left a locked BTC event undeletable, with its bracket and match rows still in place; it is now SECURITY DEFINER,
    and refuses anything but that trigger (`tg_op`, `tg_table_name`). Rule: when a lock is added, list every invoker
    trigger or function that touches the locked tables, and for each one the lock must NOT close (here, the organiser's
    own delete of an event), run it as definer with a guard that refuses any other caller. Test 056 holds the delete case.

## Testing

- **JS**: Vitest, `*.test.js` next to the file it tests. `npm test` runs everything
  under `src/**`, `supabase/functions/**`, and `eslint-rules/**` (see `vite.config.js`'s
  `test.include`). Pure logic in `core/` gets thorough unit coverage, including the
  exact negative cases each build-plan task names (handoff §14) — not just a happy path.
- **Testing a custom ESLint rule**: use `new Linter().verify(code, config)` inside plain
  Vitest `it()` blocks, not ESLint's `RuleTester` — `RuleTester` expects global
  `describe`/`it` (Mocha-style), which this project doesn't configure (`vitest.config`'s
  `test.globals` is unset), and silently produces "No test found in suite" instead of
  running anything. `eslint-rules/no-raw-elapsed-write.test.js` is the reference shape.
- **A grep-style "this module has no X" test can match its own comment.** A test reading
  a module's source and regex-checking for banned APIs will also match the module's own
  header comment explaining _why_ those APIs are absent (the exact trap
  `no-trio-vocabulary` hit in Phase 0, and `countdown.test.js`'s engine-purity test hit
  again in Phase 2). Require call-parens/property-access (`setInterval(`, `document.`)
  rather than bare word matches.
- **SQL**: pgTAP, `supabase/tests/NNN_description.sql`, numbered so
  `000_with_check_gate.sql` (the T1.4 CI gate) runs first. Every file wraps in
  `begin; ... select plan(N); ... select * from finish(); rollback;` so nothing persists
  between runs. Fixtures insert `auth.users` rows directly, then simulate a specific
  user via `set local role authenticated; set local request.jwt.claim.sub = '<uuid>';`
  — reset both after each block.
- **A pgTAP assertion on a `limit N` result needs distinct sort keys.** Inside one test
  transaction `now()` is frozen, so every row inserted with a default `updated_at` ties,
  and a tie-break on a random `gen_random_uuid()` id makes the test pass or fail by
  chance (`059_public_live_now.sql` test 22 failed about 4 runs in 10). Give the rows
  the test cares about explicit, different timestamps.
- **Phone numbers (T-ID.A3, database and client).** `src/core/phone.js` is the only place a typed phone
  is interpreted; the database only checks the E.164 shape (`app.is_e164`), so a new
  country rule or a library bump is a client change plus a case in
  `tests/fixtures/phone-cases.json`. Run `npm run fixtures:phone` to regenerate
  `supabase/tests/060b_phone_fixture_cases.sql` (the database is held to the same cases;
  a vitest test fails when it is stale). Never edit the generated SQL by hand. See
  `src/core/CLAUDE.md` (`phone`).
- **E2E**: Playwright, `tests/e2e/*.spec.js`. `test:e2e` runs against a production build
  served by `vite preview`. This is a real project dependency (D25, diverging from
  Kira-Kira's ad-hoc use) because three live surfaces — organiser, projector, phone —
  must be proven to agree on one countdown, which Vitest alone can't reach.
- **A test that only proves "it didn't throw" doesn't satisfy any task's acceptance
  criteria.** `test-auditor` exists specifically to catch this — read a task's AC before
  writing its test, and make sure the exact cases it names (e.g. T2.1's `N=2..12`
  table, T2.2's non-first-in-list tie) are present as separate cases, not folded into
  one assertion that could pass on a subset.
- **Windows note**: Vite's default dev/preview host resolves to the IPv6 loopback first
  on this machine, which breaks Playwright's `127.0.0.1` readiness check. `server.host`
  and `preview.host` are pinned to `127.0.0.1` in `vite.config.js` — don't remove this
  thinking it's redundant.

---

## Design tokens

`src/ui/tokens/*.css` — plain CSS custom properties, real as of 2026-08-22 (shipped
ahead of Phase 4; see `CHANGELOG.md`'s "Design system foundation" entry for what shipped
and what review found). `src/ui/tokens/DESIGN.md` is the source of rationale — this
section only records the conventions a new screen or token needs to follow.

- **Import order is fixed**: `index.css` pulls in `fonts.css` → `colors.css` →
  `typography.css` → `spacing.css` → `base.css`, in that order. A screen imports
  `index.css`, never an individual token file directly.
- **One neutral ramp, two surface modes.** `--clr-clay-50`–`950` is the only color ramp;
  `:root`/`[data-surface="paper"]` (light) and `[data-surface="stage"]` (dark) both draw
  from it. Every semantic token (`--color-accent`, `-danger`, `-success`, `-warning`,
  `-gold`) follows one symmetric rule across both modes — paper is a dark tone + white
  `-contrast`, stage is a light tone + `clay-950` `-contrast` — so a new semantic token
  must supply both mode's values in that shape, never a one-off exception.
  `data-surface="stage"` goes on the projector root only; don't hand-build a second dark
  theme anywhere else.
- **`--color-test` (violet, `#6b21c9`) is reserved exclusively for `is_test` indicators**
  (handoff D9) and is fixed across both surface modes. Never reused for a brand color,
  a semantic state, or a future feature's accent.
- **No `box-shadow` token exists, anywhere** (D31, `CHANGELOG.md`). Elevation is a
  border (`--color-border*`) or a background-color step, never a shadow — this is a
  convention enforced by review, not a lint rule, so watch for it specifically in any
  new component.
- **`--color-focus-ring` is the neutral `--color-border-strong`, deliberately not the
  accent hue** — an already-accent-colored element (a primary button, an active tab)
  still needs a focus state that reads as visually distinct from its own resting color.
- **`.tap-target` (`base.css`), not `--tap-target-min` alone**, on any icon-only
  control. The token alone only guarantees `min-height` on an already-wide text button;
  an icon-only button needs width guaranteed too.
- **Fonts are self-hosted only, never CDN-linked** (D30, `CHANGELOG.md`) — the app runs
  on unreliable venue wifi at live events, so a webfont request cannot be a point of
  failure. Adding a new weight/family means downloading the file into
  `src/ui/tokens/fonts/` and adding the `@font-face` rule to `fonts.css` with a full
  system-stack fallback, the same way the existing three (Cabinet Grotesk/Switzer/JetBrains
  Mono) are set up — never a `<link>` to Fontshare, Google Fonts, or any other font CDN.
  `--font-mono` pairs with `.tabular-nums`/`.font-mono-score` for every score/timer
  digit display as a belt-and-suspenders guarantee, even though `--font-mono` (JetBrains
  Mono) is already a genuine fixed-width monospace.
- **`--text-5xl`/`--text-6xl` are fixed-canvas-only** (the projector stage or a
  dedicated big-number panel) — dropping them into an arbitrary responsive container
  without its own step-down/scroll handling caused a real 360px overflow bug in
  `preview.html`; documented directly in `typography.css`.
- A screen introducing its own one-off color, spacing, or shadow value instead of a
  token is the same "local patch" anti-pattern described above, applied to design — the
  fix belongs in `src/ui/tokens/`, not in the screen that needed it. Reserved-hue and
  reserved-accent rules (violet, gold-as-fill-only) apply the same way: if no existing
  semantic token fits, that's a signal the token layer needs a new one, reasoned through
  and contrast-checked, not a hand-picked hex value in the consuming screen.
- **The shared screen-chrome shapes live in `src/ui/tokens/components.css`, once**: `.screen-container` (and
  its headings), `.card`, `.btn` /
  `.btn-primary` / `.btn-outline`, `.form-field` / `.form-field-label` / `.form-field-hint`, `.field-input`,
  `.screen-feedback` (and its tones). `core/dom.js` and `core/loginScreen.js` emit these class names, so a
  page that draws a form links the file **by hand, after `tokens/index.css` and before its own screen CSS**
  (`app/index.html`, `admin/index.html`, every `*.preview.html`). It is deliberately NOT imported by
  `tokens/index.css`: every page loads that, including ones with their own `.form-field` (the timer, Guess
  the Bean) or their own `.screen-feedback` styling (the public results page). A new surface restating one of
  these in its own CSS is the duplication this removed (four copies had drifted: one label colour differed and
  source order decided which rendered): `components.test.js` fails CI for it, and for a page that links a
  stylesheet relying on the shapes without linking this one. A surface that needs a different look overrides
  the specific property in its own CSS, after this file (see `src/admin/admin.css`), and says why.
- **An organiser's brand (BR-D1, BR-D2) follows three rules, each held by a test** (`brandColor.test.js`,
  `brandSlot.test.js`, `brandAttribution.test.js`). (1) **Brand styling goes only on nodes a surface owns, never on
  the shared audience root** (`applyBrandColors(node, brand, mode)` in `core/brandSlot.js`), because the root
  outlives the screen and would leak the colours into whatever is mounted next. (2) **There is one credit,
  "Powered by Seduh Score", built only by `core/poweredBy.js`** (`renderPoweredBy()`, and `poweredByText()` for a
  surface that spells it inside its own wording); a surface never builds its own, and `brandAttribution.test.js`
  requires exactly one visible credit on every branded surface in every state. (3) **A brand can set only
  `--color-accent`, `--color-accent-hover` and `--color-accent-contrast`**, so it can never reach `--color-test`
  or a status colour (`core/brandColor.js` returns only those three, and the colour is moved to stay at 4.5:1 on
  every surface of the mode).
- `src/ui/tokens/preview.html` renders every token in both surface modes — open it
  (`npm run dev`, then `/src/ui/tokens/preview.html`) when changing any token value, and
  keep its demo copy format-agnostic (a leaked Cup-Taster-specific term here was
  `module-boundary-checker`'s one finding on the initial build — see "The module
  boundary" above).

---

## Versioning

**Semver started 2026-09-05** (D27's own condition — "once there's a first real shipped
artifact to number" — was met once production went live on Cloudflare; see CLAUDE.md's
Repo section). Before that, progress was tracked by **handoff phase** (Phase 0–6) alone;
`ROADMAP.md`'s Current State table stays the source of truth for "what phase are we in"
regardless.

`package.json`'s `version` field is the single source; `src/core/version.js` re-exports
it as `APP_VERSION` alongside `NAMEPLATE`, and `appShell.js` renders both in a footer on
every organiser screen (`Seduh Score · <nameplate> · v<version>`) — quick, glance-based
verification for bug reports, matching the legacy Seduh Score site's own footer
(`seduhscore.com/bts/`: "seduhscore.com · v5.16.0").

**Bumped automatically, not by hand** (2026-09-05) — `kb-sync`'s own end-of-task step
runs `npm version patch --no-git-tag-version`, matching `CHANGELOG.md`'s own per-task
granularity, so the footer always names the exact deployed commit without depending on
anyone remembering to do it. This replaces an earlier "bump it yourself" convention that
turned out not to be followed in practice — `package.json` sat at `1.0.0` through months
of shipped, logged tasks before this was caught (found investigating the legacy Seduh
Score repo's own footer-version mechanism, which has the identical manual-and-unenforced
problem — see CHANGELOG.md's dated entry). The legacy repo's version is otherwise the
same shape (a single hardcoded constant `index.html` reads on load), just without
`package.json` as the source of truth, since that codebase predates any real build step.

**Nameplate**: each build cycle takes a place name spiralling outward from Kiulap — the
same convention the legacy site used (Kiulap → Gadong → Kiarong → Menglait → Berakas →
Jerudong → Seria, v1.0 → v5.x, see seduhscore.com/bts/). This is a **separate, fresh
spiral** starting back at Kiulap, not a continuation of that site's already-completed
run — user decision, 2026-09-05: this codebase is a from-scratch rewrite (Supabase,
offline-first outbox, fixed advancement), not a patch on the same one, so it earns its
own lineage rather than picking up mid-spiral. The nameplate only moves on a **major**
bump (1.x → 2.0.0, etc.), reserved for a genuine capability-era boundary — a new format
shipping, or a major cross-cutting relaunch — never on a fixed schedule. See ROADMAP.md's
"Version cycle plan" for the planned future sequence; a cycle's name is picked (and this
section updated) when that cycle actually starts, not before.

**Current cycle: Gadong, v3.0.0** (moved 2026-09-23, from Berakas/v2.x). Trigger: BTC
(Barista Team Championship, renamed from BBTC at the start of Phase T-BTC.2, 2026-09-18)
shipped as the platform's second real competition format — schema, bracket generation
and advancement, five organiser screens, and the public marketing site (landing + Tour)
all went live the same day. Matches legacy's own Gadong cycle almost exactly ("realising
one format was never going to be enough"), even though the _specific_ format differs —
ROADMAP.md's earlier plan had assumed Throwdown would ship second and reserved v3.0/Gadong
for it. BTC beat Throwdown there, so the nameplate moved on ship ORDER, not on which named
format arrived; see ROADMAP.md's "Version cycle plan" table for the corrected sequence
(Kiarong/Menglait now track "whichever of Throwdown/Liga Seduh ships 3rd/4th", not fixed
format assignments). Second time this exact reordering has happened — Berakas jumped
queue ahead of the original Gadong/Throwdown slot in the same way.

**Previous cycle: Berakas, v2.0.0** (2026-09-07, from Kiulap/v1.x). Trigger: the public
marketing landing page (`src/marketing/`) shipped, the site's first real front door — the
console moved to `/app/`, matching legacy's own Berakas cycle almost exactly ("the front
door — seduhscore.com, an organiser zone... Cup Taster as the fourth format"). Cloudflare
deployment of the landing page itself was still pending at the moment of this bump — the
version/nameplate move tracks the code shipping to the repo, not the separate deploy step
(same distinction CLAUDE.md's Repo section already draws for migrations).

---

## Git workflow

`dev` is the working branch; `main` is protected (direct pushes rejected, `GH006`) and
takes changes via PR only. See `CLAUDE.md`'s Git section for why this required making
the repo public.

### Response headers for one path: `public/_headers` (added with the admin console)

Workers Static Assets reads `public/_headers` from the build output (Vite copies `public/` into `dist/`). It is
used for **`/admin` and `/admin/*` only**: `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`,
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and a
script-restricting `Content-Security-Policy` (see `src/admin/CLAUDE.md`; `src/admin/headers.test.js` pins it).
It backs up, never replaces, the page's own tags (`admin/index.html` carries `<meta name="robots">` itself, so
the page is safe if the headers file ever does not take effect). Do not add a rule for a path that is shared
with other pages (the hashed `/assets/` files serve every entry), and do not use `_headers` to hide a path:
`robots.txt` lists nothing under `/admin/` on purpose, because listing it would announce it. Verified
locally 2026-10-15 with `wrangler dev` (headers present on `/admin/` and `/admin`, absent on `/community/`);
the first production response is checked at rollout (spec section 8). The Vite dev server does not apply this
file, so a dev-server run shows no such headers.

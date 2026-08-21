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

One organiser, one org, for October (handoff §4). Read on `live_sessions` is open and
unauthenticated by design — audience surfaces have no login. Write anywhere requires
`org_members` membership in the owning org. Everything else is org-scoped read and
write. Every `FOR INSERT`/`FOR UPDATE`/`FOR ALL` policy needs an explicit `WITH CHECK` —
`USING` alone governs reads and the pre-image of updates, not what gets written; CI
(§14 T1.4) fails the build if one is missing. Membership checks go through a
`SECURITY DEFINER STABLE` helper with `SET search_path = ''`, never a policy on
`org_members` selecting from `org_members` directly (the classic Supabase recursion bug,
Postgres error 42P17).

---

## Testing

- **JS**: Vitest, `*.test.js` next to the file it tests. `npm test` runs everything
  under `src/**` and `supabase/functions/**` (see `vite.config.js`'s `test.include`).
  Pure logic in `core/` gets thorough unit coverage, including the exact negative cases
  each build-plan task names (handoff §14) — not just a happy path.
- **SQL**: pgTAP, `supabase/tests/NNN_description.sql`, numbered. Every file wraps in
  `begin; ... select plan(N); ... select * from finish(); rollback;` so nothing persists
  between runs. `000_sanity.sql` is a Phase 0 placeholder proving the runner and CI
  wiring work before any real schema exists — Phase 1 adds the actual suite.
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

`src/ui/tokens/*.css` — plain CSS custom properties, currently a placeholder directory
(Phase 0). As real UI work starts (Phase 4+), tokens land here first and screens consume
them; a screen introducing its own one-off color or spacing value instead of a token is
the same "local patch" anti-pattern described above, applied to design.

---

## Versioning

No semver yet (D27) — progress is tracked by **handoff phase** (Phase 0–6), not a
version number. `ROADMAP.md`'s Current State table is the source of truth for "what
phase are we in." A semver scheme can start once there's a first real shipped artifact
to number — don't invent version numbers before then.

---

## Git workflow

`dev` is the working branch; `main` is protected (direct pushes rejected, `GH006`) and
takes changes via PR only. See `CLAUDE.md`'s Git section for why this required making
the repo public.

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

One organiser, one org, for October (handoff §4). Read on `live_sessions` is open and
unauthenticated by design — audience surfaces have no login. Write anywhere requires
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

---

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
own lineage rather than picking up mid-spiral. Current cycle: **Kiulap, v1.0.0**. The
next cycle's name gets picked (and this section updated) when that cycle actually starts
— don't pre-name future cycles.

---

## Git workflow

`dev` is the working branch; `main` is protected (direct pushes rejected, `GH006`) and
takes changes via PR only. See `CLAUDE.md`'s Git section for why this required making
the repo public.

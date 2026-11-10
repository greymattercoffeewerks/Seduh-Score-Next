# Versioning: how the number and the place name move

The one place for the version rules. `CONVENTIONS.md` ("Versioning") points here; `ROADMAP.md` ("Version cycle plan")
holds the planned order of places. Read this before you bump `package.json`, open a release PR, or edit the
Behind the Seduh page (`/bts/`).

## Where the number lives

`package.json`'s `version` is the single source. `src/core/version.js` re-exports it as `APP_VERSION` beside
`NAMEPLATE`, and `appShell.js` renders `Seduh Score · <nameplate> · v<version>` in the footer of every organiser
screen, so a bug report can name the build at a glance (the legacy site did the same, `seduhscore.com · v5.16.0`).
Semver started 2026-09-05 (D27); before that, progress was tracked by handoff phase only.

## Which part to bump

Ask what changed for the people who use it: organisers, judges, competitors, the audience, the operator.

| Bump      | When                                                                                                                                                                                             | Examples                                                                                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Major** | A **new competition format** ships, or a **relaunch**: a change to what the product is, not an addition to it. Moves the place name.                                                             | BTC (3.0.0, Gadong). Throwdown (should have been 4.0.0 on 2026-11-03; caught up on 2026-11-09). Liga Seduh (planned 5.0.0, Menglait). Possible relaunches below.                                                                                                 |
| **Minor** | A **new capability** someone can use that they could not before, inside the formats that exist: a new screen or flow, a format module, a community tool, a platform feature, a visible redesign. | BTC live screens (3.1.0). Seeding tie-break (3.2.0). Many organisations (3.3.0). Operator's console (3.4.0). Plans switched on. A Throwdown redemption round. The BTC Draw panel. Petrol V2 and BTC countries should have been minors (both shipped as patches). |
| **Patch** | Everything else: **fixes**, copy, polish, performance, internal or database work, and **groundwork nobody can use yet**.                                                                         | A tie-break bug. New landing headline. The BTC draw engine with no screen yet. A new test or review fix. Docs that ship with the build.                                                                                                                          |

Rules of thumb:

- **Usable or not?** Code that has no screen, button or effect yet is a patch, even if it is large. The release that
  makes it usable is the minor.
- **The highest change wins.** A release that holds one minor-worthy change and ten fixes is a minor.
- **Major test:** would you announce it to organisers as "the new Seduh Score"? Then major. A line in "what's new" is a
  minor.
- A minor resets the patch to 0, a major resets both (`npm version minor|major` does this).

### When there are no new formats left

Majors are rare on purpose. After Liga Seduh (the fourth format, planned 5.0), the number can stay on 5.x for as long
as it takes: 5.1, 5.2 … 5.23 is fine (the legacy site sat at 5.16). A long run on one place means the platform has
settled, not that it stopped moving. A 6.0 needs a relaunch, for example:

- Seduh ID becomes something competitors use themselves (their own profile and history), not only an organiser's record.
- Paid plans go live, so it becomes a commercial product.
- A native app, or scoring on a new kind of device.
- A change that breaks existing links or habits (a new audience link format): the major is how people are told.

## Who bumps, and when

1. **Every task that ships** bumps by default with a **patch**: `kb-sync`'s step runs
   `npm version patch --no-git-tag-version`. A build session that stops at a PR (no `kb-sync`) bumps itself.
2. **A task that adds a capability** bumps **minor** instead (`npm version minor --no-git-tag-version`), and says so in
   its CHANGELOG entry. The closing (Z) task of a phase does this if its tasks did not.
3. **A task that ships a new format** stops and asks the owner, then runs `npm version major --no-git-tag-version`,
   moves `NAMEPLATE` in `src/core/version.js` to the next place, and updates the BTS page (below). Missed once:
   Throwdown went out as 3.6.0 and the place name stayed on Gadong for six days.
4. **The release PR (`dev` into `main`)** is the backstop. Its title names the version, and its template asks which
   part moved and why. Read the CHANGELOG entries since the last release against the table above: if a minor-worthy
   change went out as patches, bump `minor` on `dev` before the release. Check that `package-lock.json` followed.

### The CI gate

CI's `Version bump` job (`tools/check-version-bump.mjs`) runs only on PRs into `main`. It fails when (1) a file the
deployed app is built from changed (`src/**` except notes and `*.test.js`, `public/**`, any `*.html`,
`supabase/migrations/**`, `supabase/functions/**`, `vite.config.js`, `wrangler.jsonc`) and `package.json`'s version is
not higher than `main`'s, or (2) `package-lock.json` disagrees with `package.json`. Docs-, test-, tooling- and CI-only
releases pass. It cannot tell a comment-only `src/` change from a real one: for that, label the PR
`skip-version-check` and re-run the job (the lock rule still applies). Locally:
`node tools/check-version-bump.mjs --base origin/main`. The gate checks that the number went up, not that the right part
did; that is the release PR's job (step 4).

## Place names (the nameplate)

Each major takes a Bruneian place, in the legacy site's order (Kiulap → Gadong → Kiarong → Menglait → Berakas →
Jerudong → Seria). This build is a separate run that started again at Kiulap (owner decision, 2026-09-05: a rewrite, not
a patch on the old app). The place moves on **ship order**, not on which format arrives: BTC took Gadong although the
plan had Throwdown there, and Berakas was used early for the landing page. A place's name is chosen when its cycle
starts, not before; the planned order is `ROADMAP.md`'s "Version cycle plan". Still unused: Menglait (planned for Liga
Seduh), Jerudong, Seria.

| Version | Place   | Moved      | Trigger                                                                                                    |
| ------- | ------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| v4.x    | Kiarong | 2026-11-09 | Throwdown, the third format (shipped 2026-11-03 as 3.6.0; the bump caught up with no feature change).      |
| v3.x    | Gadong  | 2026-09-23 | BTC, the second format: schema, bracket, organiser screens and the public site went live the same day.     |
| v2.x    | Berakas | 2026-09-07 | The public landing page, the site's first front door (console moved to `/app/`). Jumped the planned order. |
| v1.x    | Kiulap  | 2026-09-05 | Cup Taster and the Phase 6 hardening.                                                                      |

The move tracks code shipping to the repo, not the separate deploy step.

## The Behind the Seduh page (`/bts/`)

The page tells this history, so it must agree with the app. `src/marketing/btsPage.test.js` fails when the page's
current place (`data-current` on the rail, `data-bts-place` on the scoreboard) or major version disagrees with
`NAMEPLATE` and `package.json`. When the place moves:

- add a `.bts-rail-item` after "Next" for the new place, move `data-current` and the Current tag to it, and mark the old
  place Shipped;
- add a `.bts-cycle-group` for it, with its first chapter at the top (the trigger, e.g. the new format);
- update the scoreboard (`data-bts-place`, `data-bts-version`, stats) and the `ROADMAP.md` row.

A minor or patch needs no change to the place; a new chapter for a minor is optional. How to add a chapter is in the
comment at the top of `bts/index.html`.

## History of this rule

- 2026-09-05: semver starts; `kb-sync` bumps patch per task (a manual bump had been skipped for months).
- 2026-11-02: bumps were missed for ten days (3.4.1 to 3.5.0); the Z task bumps itself, and the CI gate is added.
- 2026-11-09: the Throwdown major was missed; the BTS consistency test is added.
- 2026-11-10: the patch/minor/major table, "usable or not", the release-PR backstop and this file (moved out of
  `CONVENTIONS.md`).

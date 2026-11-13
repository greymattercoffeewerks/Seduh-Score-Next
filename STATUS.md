# Status — read this first

_As of 2026-11-13, app version 4.5.0, nameplate Kiarong. One page on purpose (budget 8 KB, `npm run check:docs`). `kb-sync` updates it when a
task closes. When it disagrees with `CHANGELOG.md`, the changelog wins: fix this file._

## Where we are

- **Phases 0 to 6 done.** Cup Taster, BTC and Throwdown (TD.1 core knockout) are live formats; Liga Seduh is not started.
- **Behind the Seduh** is rebuilt as a one-chapter reader (`/bts/`) in a PR into `dev` (branch `claude/bts-reader-kiarong`), not yet merged or released; v4.0.0 is the Throwdown major bump caught up (see `CHANGELOG.md`).
- **Tenancy** (many organisations, one database) done 2026-10-14. **Admin console** live in the cloud since 2026-10-17.
- **Gating:** three keys enforced for the Brunei organisation since 2026-11-02 (`cup_taster_participants`, `events_open`,
  `results_archive_optional`); eight stay off. **Seduh ID:** Layer 1a built; the archive feed (1b) is in `queue` mode and
  has published nothing yet.
- **Petrol V2 released** in 3.6.6 (2026-11-09). The shared page hero is in a PR to `dev` from `claude/page-hero-consistency`.
- **Petrol Kaizen P4 (feedback)** built on `claude/keen-wiles-9e7b3c`, uncommitted; re-review and a tablet check owed (`CHANGELOG.md`, 2026-11-13).
- **Open, not merged or not in the cloud** (check `CHANGELOG.md` before trusting this line): password recovery D-PW2 to
  D-PW8 not started; organiser branding BR-E1 in PR #297 (no database door, so no brand shows); T-TD.1.9 (Throwdown 3rd place
  match after a walkover) was in review with its migration not yet in the cloud on 2026-11-03.

## In flight: the March 2027 Board and a beta run

The pitch went well. The owner presents to the Board in March 2027, and the app may be used in the real competition as a
**shadow beta** (manual scoring stays authoritative; Seduh Score runs in parallel and is compared afterwards). The plan is
[`MARCH-2027-BOARD-PLAN.md`](MARCH-2027-BOARD-PLAN.md): BTC team and country model with an optional member backfill to
Seduh ID, Petrol V2 refinement, UX audit and Tour. Known (owner, 2026-11-07): tentatively 20 teams, 2 to 3 per country,
each with its own team name; two preliminary rounds (round 1 random, round 2's rule to be confirmed), then the committee
picks the top 8 by points, ties by the sum of each team's two finish times, confirmed manually by the organiser (wins no
longer order the standings). Both round-2 methods (random without repeats, and by round-1 results) are to be built and
selectable. Registration opens January 2027. Round 2's by-results method is strongest against weakest. Engine spec draft: [`docs/specs/BTC-MARCH-2027-ENGINE-SPEC-DRAFT.md`](docs/specs/BTC-MARCH-2027-ENGINE-SPEC-DRAFT.md).

**Organiser UX (five stages, per the approved mockup).** S1, the shared core kit, is a PR into `dev` from `claude/organiser-ux-s1-core-kit-1f2e99`, not merged. S2, the BTC event dashboard as a run sheet, is on `claude/organiser-ux-s2-btc-dashboard-6ca85a` (no PR yet); its Records card now has the two BTC scores CSVs (4.5.0). S3, the BTC matches screen grouped by round (4.3.0), is merged into `dev`. S4, the cut to the top 8 and its sign-off sheet (4.4.0), is a PR into `dev` from `claude/organiser-ux-s4-the-cut-8e554b`, not merged; a real-tablet check and a printed-PDF check are owed. S5 (copy pass, 4.4.1) is committed, not pushed; B5 sign-off wording is unresolved (see CHANGELOG).

## Handover (2026-11-08, cloud session to a local session)

- **Branch `ccr-dd9e5a6c-bxhucc`, PR #427 into `dev` (open).** #426 (docs trim, STATUS.md, backlog triage, the first plan)
  is merged into `dev`. #427 is docs only: the plan and the engine spec follow the owner's answers. No code, migration or
  cloud change exists for BTC yet. Start with `git fetch origin && git checkout ccr-dd9e5a6c-bxhucc`, then `npm ci`.
- **Next step:** the engine spec's tasks, in this order: E team and judge country, A `prelim_round`, D finish-time
  check, B draw and `create_btc_round`, C ties on points only (built on `claude/btc-c-points-ties-8a4f2f`, PR into `dev`, migration `20261110100000` not in the cloud). E, A and D are in `dev`; B part 1 (the draw engine: pure
  functions, `btc_round_draws`, `create_btc_round`, no screen) shipped in release 3.6.7 (check `CHANGELOG.md` for whether its
  migration `20261109100000` is in the cloud); B part 2 (the Draw panel on the matches screen, front end only) is built on `claude/btc-b2-draw-panel-9d6d63` with a PR into `dev`; B part 3 (redraw a round: migration `20261109110000`, not in the cloud) is on `claude/btc-b3-redraw-round-9d6d63`, PR stacked on part 2's. Each has its reviewers in section
  8 of the spec; the C migration and the draw are scoring and tenancy gates.
- **Waiting on the committee (none blocks the first tasks):** the real team count and round-2 method; which round has the
  10-minute limit and which the 15 (the default is 10:00 preliminary, 15:00 knockout, one function to edit); odd team
  count or a withdrawal (KIV, the draw refuses meanwhile); whether a round-2 rematch is allowed (setting, default
  avoid); what decides a tie when both teams hit the time limit. Registration opens January 2027.
- **Owner-only actions still open:** the backlog items listed in `docs/backlog/README.md` ("Triage"), including closing the
  `btc_matches_write FOR ALL` gap before any beta, the `/results/` indexing decision and republishing the live event.
- **Local session notes:** `state.json` is gitignored; `Handoffs and Specs/` is on the owner's machine only. Run `npm run check:docs` after any doc change; `ROADMAP.md` and
  `CHANGELOG.md` have size budgets. Every migration is pushed to the cloud by hand after merge (see `CLAUDE.md`).

## Where to find things (look up, do not read whole)

| Need                                          | Go to                                                                                  |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| Rules that apply everywhere                   | [`CLAUDE.md`](CLAUDE.md), then the `CLAUDE.md` in the folder you work in               |
| How things are built here                     | [`CONVENTIONS.md`](CONVENTIONS.md)                                                     |
| What shipped in the last two weeks            | [`CHANGELOG.md`](CHANGELOG.md)                                                         |
| An older entry, by task id or title           | [`CHANGELOG-INDEX.md`](CHANGELOG-INDEX.md), then `docs/archive/changelog/`             |
| The live programme and nameplate plan         | [`ROADMAP.md`](ROADMAP.md)                                                             |
| Which version part to bump, place names       | [`docs/versioning.md`](docs/versioning.md)                                             |
| Open items and deferred findings, by area     | [`docs/backlog/README.md`](docs/backlog/README.md)                                     |
| Old status banners and Phases 1 to 5          | [`docs/archive/roadmap/`](docs/archive/roadmap/status-banners-and-finished-phases.md)  |
| Admin operator runbooks and rollout record    | [`docs/runbooks/admin-console.md`](docs/runbooks/admin-console.md)                     |
| Provisioning an organisation, build variables | [`docs/runbooks/provisioning-and-deploy.md`](docs/runbooks/provisioning-and-deploy.md) |
| The frozen spec and local-only specs          | `Handoffs and Specs/` (not in git)                                                     |

## Keeping the hot files short

New deferred findings go to the area's file in `docs/backlog/`, not `ROADMAP.md`. When `CHANGELOG.md` passes about 200 KB,
move its oldest entries verbatim to `docs/archive/changelog/<period>.md` and add one line each to `CHANGELOG-INDEX.md`.
`npm run check:docs` fails CI on a blown budget, a broken link, or an indexed heading missing from its archive file.

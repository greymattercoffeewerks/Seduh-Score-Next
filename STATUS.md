# Status — read this first

_As of 2026-11-18, app version 4.19.0, nameplate Kiarong. One page on purpose (8 KB budget, `npm run check:docs`). `kb-sync` updates it when a
task closes. When it disagrees with `CHANGELOG.md`, the changelog wins: fix this file._

## Where we are

- **Phases 0 to 6 done.** Cup Taster, BTC and Throwdown (TD.1 core knockout) are live formats; Liga Seduh is not started.
- **Behind the Seduh** is rebuilt as a one-chapter reader (`/bts/`) in a PR into `dev` (`claude/bts-reader-kiarong`), not yet released.
- **Tenancy** (many organisations, one database) done 2026-10-14. **Admin console** live in the cloud since 2026-10-17.
- **Gating:** three keys enforced for the Brunei organisation since 2026-11-02 (`cup_taster_participants`, `events_open`,
  `results_archive_optional`); eight stay off. **Seduh ID:** Layer 1a built, claim screens live, person page, `/id/me/`, photo and story card (4.16.0) built; the archive feed (1b) is in `queue` mode and
  has published nothing yet.
- **Organiser home** (`#/events` rebuild, `/events/new`, the `org_event_summaries` door): live as 4.17.0 (#496, release #499); its migration is in the cloud. Owner's real-device check owed.
- **Country pages** (4.10.2): database (#465) and pages (#466) in `dev`. Board only: `noindex`, unlinked, `COUNTRY_PAGES_PUBLIC` false.
- **Petrol Kaizen P4** (PR #457) and **P5** (vocabulary, draft PR on P4's branch) built; tablet checks owed. **P6** (token roles, density) in a PR; iPad owed.
- **Cloud database in sync (checked 2026-11-17):** all 121 migrations on `main` and `dev` are in the cloud project, none extra,
  and no unmerged branch adds a migration.
- **Open, not merged** (check `CHANGELOG.md`): password recovery D-PW2 to D-PW8 not started; organiser branding BR-E1 in
  PR #297 (no database door, so no brand shows).

- **Seduh ID courses and certificates** (4.19.0, PR into `dev` from `claude/seduh-id-c6a-courses-b66a4a`, not merged): a Courses tab in My Seduh ID, a sub-section in the person record, `vis_courses`, an optional "Certified:" line on the story card. **Its migration `20261126100000` must be in the cloud before or with the release** (the new `public_seduh_profile` returns `courses`; the page tolerates an old one).
- **BTC void cup** (4.18.0, PR into `dev` from `claude/btc-void-cup-e36afe`, not merged): a cup where both teams get 0 tokens. **Its migration `20261125110000` must be in the cloud before or with the release** (an old RPC would score a void cup 0-3, silently).

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

## Handover (2026-11-08)

Moved verbatim to [`docs/archive/status/handover-2026-11-08.md`](docs/archive/status/handover-2026-11-08.md): the BTC engine tasks (E, A, D, B, C) and the committee questions. Start there for BTC work.

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

# Status — read this first

_As of 2026-11-07, app version 3.6.3. One page on purpose (budget 8 KB, `npm run check:docs`). `kb-sync` updates it when a
task closes. When it disagrees with `CHANGELOG.md`, the changelog wins: fix this file._

## Where we are

- **Phases 0 to 6 done.** Cup Taster, BTC and Throwdown (TD.1 core knockout) are live formats; Liga Seduh is not started.
- **Tenancy** (many organisations, one database) done 2026-10-14. **Admin console** live in the cloud since 2026-10-17.
- **Gating:** three keys enforced for the Brunei organisation since 2026-11-02 (`cup_taster_participants`, `events_open`,
  `results_archive_optional`); eight stay off. **Seduh ID:** Layer 1a built; the archive feed (1b) is in `queue` mode and
  has published nothing yet.
- **Open, not merged or not in the cloud** (check `CHANGELOG.md` before trusting this line): password recovery D-PW2 to
  D-PW8 not started; organiser branding BR-E1 in PR #297 (no database door, so no brand shows); T-TD.1.9 (Throwdown 3rd place
  match after a walkover) was in review with its migration not yet in the cloud on 2026-11-03.

## In flight: the March 2027 Board and a beta run

The pitch went well. The owner presents to the Board in March 2027, and the app may be used in the real competition as a
**shadow beta** (manual scoring stays authoritative; Seduh Score runs in parallel and is compared afterwards). The plan is
[`MARCH-2027-BOARD-PLAN.md`](MARCH-2027-BOARD-PLAN.md): BTC team and country model with an optional member backfill to
Seduh ID, Petrol V2 refinement, UX audit and Tour. It has 12 owner decisions; the first (the real competition's team
count and format; the bracket refuses fewer than 8 teams) blocks the BTC work.

## Where to find things (look up, do not read whole)

| Need                                          | Go to                                                                                  |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| Rules that apply everywhere                   | [`CLAUDE.md`](CLAUDE.md), then the `CLAUDE.md` in the folder you work in               |
| How things are built here                     | [`CONVENTIONS.md`](CONVENTIONS.md)                                                     |
| What shipped in the last two weeks            | [`CHANGELOG.md`](CHANGELOG.md)                                                         |
| An older entry, by task id or title           | [`CHANGELOG-INDEX.md`](CHANGELOG-INDEX.md), then `docs/archive/changelog/`             |
| The live programme and nameplate plan         | [`ROADMAP.md`](ROADMAP.md)                                                             |
| Open items and deferred findings, by area     | [`docs/backlog/README.md`](docs/backlog/README.md)                                     |
| Old status banners and Phases 1 to 5          | [`docs/archive/roadmap/`](docs/archive/roadmap/status-banners-and-finished-phases.md)  |
| Admin operator runbooks and rollout record    | [`docs/runbooks/admin-console.md`](docs/runbooks/admin-console.md)                     |
| Provisioning an organisation, build variables | [`docs/runbooks/provisioning-and-deploy.md`](docs/runbooks/provisioning-and-deploy.md) |
| The frozen spec and local-only specs          | `Handoffs and Specs/` (not in git)                                                     |

## Keeping the hot files short

New deferred findings go to the area's file in `docs/backlog/`, not `ROADMAP.md`. When `CHANGELOG.md` passes about 200 KB,
move its oldest entries verbatim to `docs/archive/changelog/<period>.md` and add one line each to `CHANGELOG-INDEX.md`.
`npm run check:docs` fails CI on a blown budget, a broken link, or an indexed heading missing from its archive file.

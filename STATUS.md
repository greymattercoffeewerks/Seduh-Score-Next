# Status — read this first

_As of 2026-11-28, app version 4.35.0, nameplate Kiarong. One page on purpose (8 KB budget, `npm run check:docs`). `kb-sync` updates it when a
task closes. When it disagrees with `CHANGELOG.md`, the changelog wins: fix this file._

## Where we are

- **Throwdown Bracket Planner** (4.35.0, PR to `dev`): free Community tool, card 06; reads three pure Throwdown modules; shared pure logic allowed (owner, 28 Nov).
- **Throwdown bracket preview** (4.34.0, live; on the dashboard since 4.34.2): "Plan the event" card, redemption included. Owed: 360px check.
- **Throwdown redemption (TD.3)** (4.33.0, live): migration in the cloud.
- **Share result to a story** (4.32.0, live): Results page Share button. Owed: phone check.
- **Phone results** (4.31.1), **left side menu** (4.31.0, device check passed) and **demo people** (4.31.0, migration in the cloud) are live.
- **In flight:** PR #580 demo data for Cup Taster and Throwdown test events (Load and Clear; its new migration `20261202100000` is NOT in the cloud, push only with the owner's OK).
- **BTC night dashboard, Phase 1** (4.30.0, live): night switch, Needs you list, run strip, standings draft preview.
- **Petrol Figma review fixes** (4.29.0, minor: the audience freshness bar): stage muted text passes 4.5:1; a dropped connection keeps results on screen under a "Connection lost" bar; Timer Reset asks first. Owed: venue and TV check.
- **Phases 0 to 6 done.** Cup Taster, BTC and Throwdown (TD.1 core knockout) are live formats; Liga Seduh is not started.
- **Tenancy** (many organisations, one database) done 2026-10-14. **Admin console** live in the cloud since 2026-10-17.
- **Gating:** three keys enforced for the Brunei organisation since 2026-11-02 (`cup_taster_participants`, `events_open`,
  `results_archive_optional`); eight stay off. **Seduh ID:** Layer 1a built, claim screens live, person page, `/id/me/`, photo and story card (4.16.0), discovery (4.17.3, behind its off switch), courses and certificates (4.19.0), "This isn't mine" on a recorded result (4.20.0), all live (the owner still to confirm the dispute policy, CHANGELOG 4.20.0, and the discovery search policy, 4.17.3); the archive feed (1b) is in `queue` mode and
  has published nothing yet.
- **Organiser home** (`#/events` rebuild): live as 4.17.0; its migration is in the cloud. Owner's real-device check owed.
- **Country pages** (4.10.2): live, data in the cloud. Board only: `noindex`, unlinked, `COUNTRY_PAGES_PUBLIC` false.
- **Petrol Kaizen P4, P5 and P6** are live; tablet and iPad checks owed.
- **Cloud database in sync (checked 2026-11-28):** every migration on `main` is in the cloud, the newest being
  `td_redemption` and `load_demo_roster`.
- **Random Selector redesign** released as **4.21.0**, shared chrome as **4.22.0**. Owed: the owner's 16:9 screen and tablet check (CHANGELOG 4.21.0).
- **Throwdown scoresheet rounds** (Final and 3rd place from judges' paper sheets typed in by a scorekeeper; scores never shown to the audience): **4.23.0** (#524, #525) for the 27 Nov event. Owed: the owner's tablet test event.
- **Throwdown joins Seduh ID** (released as **4.24.0**, #527 to #529; CHANGELOG 4.24.0). Owed: the owner to confirm that "This isn't
  mine" on a Throwdown result also hides that event's matches; on 27 Nov, publish after the final and approve the feed queue.
- **Throwdown vote cap** (4.25.1): a match takes no more taps than judges, plus one tie-break vote when level. In the cloud.
- **Throwdown competitor Edit** (4.25.0), **projector on the shared kit** (4.26.0), **dashboard B and C** (4.28.0): tablet and TV checks owed.
- **Throwdown undo and offline vote screen** (4.27.0): undo a confirmed match; the event screen survives a dropped connection. Migration in the cloud. Owed: the owner's tablet check before 27 Nov.
- **Open, not merged** (check `CHANGELOG.md`): password recovery D-PW2 to D-PW8 not started. Organiser branding
  BR-E1 merged in #297 (2026-10-22) and is on `main`, but the database door (BR-B1) is KIV, so no brand shows.

## In flight: the March 2027 Board and a beta run

The pitch went well. The owner presents to the Board in March 2027, and the app may be used in the real competition as a
**shadow beta** (manual scoring stays authoritative; Seduh Score runs in parallel and is compared afterwards). The plan is
`Handoffs and Specs/MARCH-2027-BOARD-PLAN.md` (local only, not in git): BTC team and country model with an optional member backfill to
Seduh ID, Petrol V2 refinement, UX audit and Tour. Known (owner, 2026-11-07): tentatively 20 teams, 2 to 3 per country,
each with its own team name; two preliminary rounds (round 1 random, round 2's rule to be confirmed), then the committee
picks the top 8 by points, ties by the sum of each team's two finish times, confirmed manually by the organiser (wins no
longer order the standings). Both round-2 methods (random without repeats, and by round-1 results) are to be built and
selectable. Registration opens January 2027. Round 2's by-results method is strongest against weakest. Engine spec draft: [`docs/specs/BTC-MARCH-2027-ENGINE-SPEC-DRAFT.md`](docs/specs/BTC-MARCH-2027-ENGINE-SPEC-DRAFT.md).

**Organiser UX (five stages, per the approved mockup).** All five are live (S1 core kit, S2 run sheet with BTC scores CSVs, S3 matches by round, S4 the cut and sign-off sheet, S5 copy pass; 4.3.0 to 4.5.0). Still owed: S4's real-tablet and printed-PDF checks, and the owner's wording for B5 (the lock reasons in `cutData.js`; see CHANGELOG).

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

Deferred findings go to `docs/backlog/`, not `ROADMAP.md`. When `CHANGELOG.md` passes about 200 KB,
move its oldest entries verbatim to `docs/archive/changelog/<period>.md` and add one line each to `CHANGELOG-INDEX.md`.
`npm run check:docs` fails CI on a blown budget, a broken link, or an indexed heading missing from its archive file.

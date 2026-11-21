# Status — read this first

_As of 2026-11-21, app version 4.26.0, nameplate Kiarong. One page on purpose (8 KB budget, `npm run check:docs`). `kb-sync` updates it when a
task closes. When it disagrees with `CHANGELOG.md`, the changelog wins: fix this file._

## Where we are

- **Phases 0 to 6 done.** Cup Taster, BTC and Throwdown (TD.1 core knockout) are live formats; Liga Seduh is not started.
- **Behind the Seduh** is a one-chapter reader at `/bts/`, live.
- **Tenancy** (many organisations, one database) done 2026-10-14. **Admin console** live in the cloud since 2026-10-17.
- **Gating:** three keys enforced for the Brunei organisation since 2026-11-02 (`cup_taster_participants`, `events_open`,
  `results_archive_optional`); eight stay off. **Seduh ID:** Layer 1a built, claim screens live, person page, `/id/me/`, photo and story card (4.16.0), discovery (4.17.3, behind its off switch), courses and certificates (4.19.0), "This isn't mine" on a recorded result (4.20.0), all live (the owner still to confirm the dispute policy, CHANGELOG 4.20.0, and the discovery search policy, 4.17.3); the archive feed (1b) is in `queue` mode and
  has published nothing yet.
- **Organiser home** (`#/events` rebuild, `/events/new`, the `org_event_summaries` door): live as 4.17.0 (#496, release #499); its migration is in the cloud. Owner's real-device check owed.
- **Country pages** (4.10.2): live, data in the cloud. Board only: `noindex`, unlinked, `COUNTRY_PAGES_PUBLIC` false.
- **Petrol Kaizen P4, P5 and P6** are live; tablet and iPad checks owed.
- **Cloud database in sync (checked 2026-11-20):** all 128 migrations on `dev` are in the cloud project, none extra, including
  `seduh_throwdown_profile` (4.24.0), pushed after #529 merged.
- **Random Selector Tier 1 redesign** (split-flap edition, `/tools/random-selector/`, first adopter of the shared community chrome): merged to `dev` in #518, released as **4.21.0** (minor: a visible redesign). Owed: the owner's check of Present on a real 16:9 screen and Fullscreen on a tablet (CHANGELOG 4.21.0). The shared-chrome rollout to the Timer, Brew Planner and Guess the Bean organiser page (#521) and the share-preview fix (#520, 4.21.1) are released as **4.22.0** (minor: every tool now links to the others).
- **Throwdown scoresheet rounds** (Final and 3rd place decided by judges' paper sheets typed in by a scorekeeper; scores never shown to the audience): released as **4.23.0** (#524, #525) for a real event on 27 Nov. Owed: the owner's test event on a tablet before then.
- **Throwdown joins Seduh ID** (released as **4.24.0**, minor: #527 competitors register with a phone, #528 organisers publish
  results so the archive feed can create identities, #529 the profile shows Throwdown places and the knockout record; owner
  decisions 2026-11-20: two semi-final losers share 3rd with no 3rd place match, walkovers do not count, the 3rd place match does).
  Owed: the owner to confirm that "This isn't mine" on a Throwdown result also hides that event's matches; on 27 Nov, publish
  after the final and approve the feed queue.
- **Throwdown vote cap** (#531 and its review follow-ups, on `dev` as 4.25.1, not yet released): a match takes no more taps than judges, plus one tie-break vote when the panel is level (owner, 2026-11-20). Migration applied to the cloud. All Definition-of-Done reviews run (CHANGELOG 4.25.1).
- **Throwdown projector on the shared kit**: released as **4.26.0** (minor, #539), no migration; owner's TV check 24 to 25 Nov owed.
- **Throwdown competitor Edit** (released as **4.25.0**, minor, #532): name, phone and café or team, before and after the
  draw, on edit rules now shared in `core/registration.js` with Cup Taster. No migration. Owed: the owner's tablet check.
- **Open, not merged** (check `CHANGELOG.md`): password recovery D-PW2 to D-PW8 not started; organiser branding BR-E1 in
  PR #297 (no database door, so no brand shows).

## In flight: the March 2027 Board and a beta run

The pitch went well. The owner presents to the Board in March 2027, and the app may be used in the real competition as a
**shadow beta** (manual scoring stays authoritative; Seduh Score runs in parallel and is compared afterwards). The plan is
[`MARCH-2027-BOARD-PLAN.md`](MARCH-2027-BOARD-PLAN.md): BTC team and country model with an optional member backfill to
Seduh ID, Petrol V2 refinement, UX audit and Tour. Known (owner, 2026-11-07): tentatively 20 teams, 2 to 3 per country,
each with its own team name; two preliminary rounds (round 1 random, round 2's rule to be confirmed), then the committee
picks the top 8 by points, ties by the sum of each team's two finish times, confirmed manually by the organiser (wins no
longer order the standings). Both round-2 methods (random without repeats, and by round-1 results) are to be built and
selectable. Registration opens January 2027. Round 2's by-results method is strongest against weakest. Engine spec draft: [`docs/specs/BTC-MARCH-2027-ENGINE-SPEC-DRAFT.md`](docs/specs/BTC-MARCH-2027-ENGINE-SPEC-DRAFT.md).

**Organiser UX (five stages, per the approved mockup).** All five are live: S1 the shared core kit, S2 the BTC event dashboard as a run sheet (with the two BTC scores CSVs, 4.5.0), S3 the matches screen grouped by round (4.3.0), S4 the cut to the top 8 and its sign-off sheet (4.4.0) and S5 the copy pass (4.4.1). Still owed: S4's real-tablet and printed-PDF checks, and the owner's wording for B5 (the lock reasons in `cutData.js`; see CHANGELOG).

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

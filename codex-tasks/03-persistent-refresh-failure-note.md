# 03 — "Saved, but the page could not refresh" must not vanish after 1.5 seconds

Read `README.md` in this folder first. Branch: `codex/persistent-refresh-note`.

## Why

On the BTC bracket screen, two actions save to the database and then re-read the screen's
data. When the save works but the re-read fails, the screen shows a toast telling the
organiser to reload — and the toast goes away after about 1.5 seconds (the seeding card's
longer messages stay up `max(1500, length × 60)` ms). The instruction is **actionable**
("Reload to see the standings"), so it should stay until the organiser has acted on it.
Logged in ROADMAP: "The 'saved but could not refresh' toast disappears after 1.5 s, as the
knockout tie-break's does; a persistent inline note would be better for an actionable
instruction."

## Where (all in `src/formats/btc/`)

- `bracketScreen.js`
  - the knockout tie-break save: grep for `saved, but the page could not refresh` (about
    L328: `` `${teamName(winnerTeamId)} goes through — saved, but the page could not refresh. Reload to see the bracket.` ``)
  - the seeding order save: `'Order saved, but the page could not refresh. Reload to see the standings.'`
    in `handleRecordSeeding` (it sets `state.seedingReadFailed` as well).
  - `showToast(message, { focus })` and the render loop. State lives in a `state` object;
    the whole screen re-renders on every change, and `withFocusPreservation` restores
    focus by `data-focus-key`.
- `seedingCard.js` — already has a "We could not refresh this list, so it may be out of
  date." note with a "Check again" button when `readFailed` is true; model the new note on
  it.
- `bracketScreen.css` — card styles.
- `src/core/errors.js`, `src/core/dom.js` — helpers (`el`, `setBusyDisabled`, …).

## What to do

1. Introduce a persistent inline note on the bracket screen, rendered near the top of the
   screen (above the cards) as a `role="status"` element **that stays in the DOM** (like
   the seeding card's persistent announcer: attach once, change only its text — a node
   that is removed and re-added reaches a screen reader with its text already in it and may
   not be announced).
2. When either save succeeds but the follow-up read fails, set that note's text to the
   message and keep it. Do not also show the same sentence as a transient toast (one place
   for the message).
3. The note clears when: the organiser presses a "Reload" button inside the note (it
   re-runs the screen's initial load, with the existing `raceTimeout`/loading handling —
   look at how the screen loads on mount and how "Check again" retries), or a later load of
   the screen's data succeeds by any route, or the screen is left.
4. The note must have a visible "Reload" button with a 44px-minimum tap target
   (`tap-target` class), `data-focus-key` for focus preservation, and `aria-disabled`
   (not `disabled`) while the reload runs, using `setBusyDisabled`.
5. Do **not** add this to other screens; the same wording exists in Cup Taster and
   `core/teamScreen.js` but those are out of scope.

## Acceptance

- Tests in `bracketScreen.test.js` / `bracketScreen.seeding.test.js` (extend the existing
  fake clients; look at how `failOrderRead` is used) proving:
  - a tie-break save whose follow-up read fails leaves the note on screen after more than
    the old toast duration (use fake timers), with a working Reload button;
  - the same for a seeding-order save;
  - pressing Reload with a now-working client clears the note and shows fresh data;
  - the note is announced (its text changes inside a node that is attached before the
    change — assert the node identity is stable across renders);
  - no note on the happy path.
- 360px visual check (the dev harness is `src/formats/btc/bracketScreen.preview.html`;
  `?seeding=1` loads the seeding scenario). The note and button must not overflow at 360
  and 320px wide.
- `npm test`, `npm run lint`, `npm run format:check`, `npm run build` green.
- CHANGELOG entry; ROADMAP bullet in "Known open items from T-BTC.seeding-tiebreak" marked
  CLOSED (T-BTC.refresh-note); the matching tie-break bullet too if it is listed.

## Do not

- Change the saves themselves, the RPC calls, or any SQL.
- Touch `core/` (this is BTC-screen-local; if you think it needs a shared helper, say so in
  the PR and do the minimum locally).

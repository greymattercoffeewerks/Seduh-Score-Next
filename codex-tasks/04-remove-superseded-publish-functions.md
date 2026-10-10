# 04 — Delete `publishSession` and `publishHandlers` (superseded, no callers)

Read `README.md` in this folder first. Branch: `codex/remove-superseded-publish`.

## Why

`src/core/publish.js` carries two functions that nothing in production calls any more.
Both formats publish through `core/publishIntent.js` (T-BTC.live-publish). The file says
so itself (L2–3: "`publishSession` and `publishHandlers` below have no production caller;
they remain for the handoff's T5.1 contract and tests."). Dead code with its own tests
still has to be maintained and misleads readers. ROADMAP: "`core/publish.js`'s
`publishSession`/`publishHandlers` have no production caller now … Delete with
`publish.test.js` when convenient."

## What is where

- `src/core/publish.js` — `publishHandlers(client)` (~L47), `publishSession(...)` (~L63),
  and **`findActiveLiveEventId` (~L89 and below), which IS still used in production — keep
  it exactly as is.**
- `src/core/publish.test.js` — tests for `publishSession` (it imports only that).
- References to update (comments/docs only):
  - `src/core/publishIntent.js` L6 ("Why not core/publish.js's publishSession(): …") — keep
    the reasoning, reword so it does not point at a function that no longer exists.
  - `src/formats/cup-taster/liveSession.js` L4 and L47 (comments mentioning
    `publishSession()`).
  - `src/formats/cup-taster/outboxHandlers.js` L5 (comment listing
    `timingHandlers/confirmHandlers/publishHandlers`) — check what the code really spreads;
    fix the comment to match.
  - `src/core/CLAUDE.md` — the `publish` (T5.1) paragraph and the `buildRpcHandler`
    paragraph that says `publish` "gained `publishHandlers(client)`", and the
    `publishIntent` paragraph's "(`publishSession`/`publishHandlers` in `publish.js` are
    superseded …)". Update these to say they were removed, with today's date. Do not
    delete the history, just make it true.
  - `src/formats/cup-taster/CLAUDE.md` — grep for `publishHandlers`.
  - **Do not edit** `Handoffs and Specs/*` (frozen), `CHANGELOG.md` history, or past
    ROADMAP prose, except to mark the open item CLOSED.

## What to do

1. `grep -rn "publishSession\|publishHandlers" src tests supabase tools` (not just `src`)
   and confirm nothing outside the files above calls them. If something does, STOP and
   report instead of deleting.
2. Delete the two functions and any imports only they used (`flushOutbox`,
   `enqueueOperation`, `buildRpcHandler` etc. — check each is still needed by
   `findActiveLiveEventId` before removing it).
3. Delete `publish.test.js`'s `publishSession` tests. If `findActiveLiveEventId` has no
   test of its own anywhere, **keep the file and add** a small test for it rather than
   deleting coverage (grep `findActiveLiveEventId` in `*.test.js` first).
4. The file may now be small; leave the file name alone (renaming ripples through docs).
5. Fix the comments and docs listed above.

## Acceptance

- `grep -rn "publishSession\|publishHandlers" src tests tools` returns only
  history-describing prose in `.md` files (and none in `.js`).
- `findActiveLiveEventId` behaviour and tests unchanged.
- ESLint passes (no unused imports), `npm test`, `npm run format:check`, `npm run build`
  green.
- CHANGELOG entry; mark the ROADMAP item CLOSED (T-HARDEN.remove-publish-superseded).
- Mutation check for the one thing that matters: temporarily break `findActiveLiveEventId`
  and confirm a test fails.

## Do not

- Change `publishIntent.js` behaviour, the outbox, or any handler map.

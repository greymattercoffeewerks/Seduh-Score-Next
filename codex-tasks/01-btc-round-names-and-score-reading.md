# 01 — One vocabulary for BTC round names, and a score screen readers say properly

Read `README.md` in this folder first. Branch: `codex/btc-round-names-score-reading`.

## Why

Two small wording defects on the BTC audience surfaces, both logged in ROADMAP under
"Known open items from T-BTC.phone-view":

1. **Round names are written three ways.** The projector's bracket columns say
   "Quarterfinals", its slot labels say "Final" / "Third place", the phone's headings say
   "Quarterfinals", while the payload's `roundLabel` (from `scoring.js`) says
   "Quarter-final". A person looking at the TV and then at their phone sees two spellings.
2. **"47 – 20"** (an en dash) is read inconsistently by screen readers: some say "47 to
   20", some say "47 20", some say "47 minus 20".

## Where the names live today

Run `grep -rn "Quarter\|Semi\|Third place" src/formats/btc --include=*.js` (skip tests).
Known sites:

- `src/formats/btc/scoring.js` ~L37 — `roundLabel(round)` → "Quarter-final", "Semi-final",
  "Final", "Third place". Used by the payload, the organiser's scoring screen and
  `liveSession.js`.
- `src/formats/btc/bracket.js` ~L19 — organiser bracket screen round headings
  ("Quarterfinals", "Semifinals").
- `src/formats/btc/projectorScreens.js` ~L135–139 — bracket column heads and `SLOT_LABELS`.
- `src/formats/btc/projectorMoments.js` ~L109 — a `third_place: 'Third place'` entry.
- `src/formats/btc/viewerBody.js` ~L42–45 — phone round headings.
- `src/formats/btc/words.js` — shared audience wording; `upNextKicker`, `thenLine` take the
  payload's `roundLabel`.

The en dash score is built in `words.js` `finalScoreLine` (~L71–77) and in
`viewerBody.js` (~L223 and ~L253: `` `${nameOf(a)} ${a.total} – ${b.total} ${nameOf(b)}` ``),
and the projector shows `finalScoreLine` in the champion block.

## What to do

**Round names.** Pick ONE spelling set and define it in exactly one place.

- Recommended: the hyphenated forms the payload already uses. Singular: "Quarter-final",
  "Semi-final", "Final", "Third place". Plural column/section heads: "Quarter-finals",
  "Semi-finals" (add a plural helper next to `roundLabel` in `scoring.js`, or export a
  small map from `words.js` — your call, but one definition, every site imports it).
- The bracket slot labels and moment screens must use the same singular set.
- Update every site above (including the organiser's `bracket.js`) and every test that
  pins the old strings. Do not leave a second copy of the strings anywhere.
- Add a test that fails if any BTC surface spells a round differently from the shared set
  (e.g. render the projector bracket, the phone page and the organiser bracket from the
  demo payload — `demoLivePayload.js` builds one — and assert the round headings come from
  the shared helper's output).

**Score reading.** Make a score such as "47 – 20" read as "47 to 20" for assistive tech
without changing what a sighted person sees.

- Prefer a small shared helper in `words.js` that renders the visible `47 – 20` for sighted
  users and gives assistive tech "47 to 20" (for example the visible text marked
  `aria-hidden="true"` plus a visually-hidden sibling — there is an existing `.sr-only`
  class — or an `aria-label` on a wrapping element **only if** it is valid for that
  element's role; an `aria-label` on a plain `<span>` is ignored by many screen readers).
- `finalScoreLine` currently returns a string used as text. If it has to return a node (or
  an object with `visible` and `spoken`), update its callers (`projectorScreens.js`,
  `viewerBody.js`) and its tests; keep `textContent`-based assertions meaningful (the
  hidden text must not make `textContent` read "47 – 2047 to 20" in places where tests
  or other code read it — if that is unavoidable, say so in the PR).
- Cover all three sites: the champion block on the projector, the phone's result cards
  (`viewerBody.js` ~L223, ~L253).

## Acceptance

- One definition of the round names; no stray literal "Quarterfinals", "Semifinals" or
  "Quarter-final" etc. left in BTC source outside that definition and tests of it.
- A test proves the three surfaces agree on round names.
- A test proves the spoken form of a score is "N to M" (and the visible form unchanged).
- 360px: the phone page's round headings and result cards do not overflow or wrap badly
  (`src/formats/btc/viewerBody.preview.html` is the dev harness; `npm run dev` serves it).
- Full `npm test`, `npm run lint`, `npm run format:check`, `npm run build` green.
- CHANGELOG entry; in ROADMAP mark the two bullets in "Known open items from
  T-BTC.phone-view" (round names; the en dash) `**CLOSED (T-BTC.wording, 2026-10-xx)**`.

## Do not

- Touch Cup Taster's strings. Do not change what the payload carries (`roundLabel` stays
  as the payload field; if you change its text, say so in the PR, since a live payload
  published before this change keeps the old text until the next publish).

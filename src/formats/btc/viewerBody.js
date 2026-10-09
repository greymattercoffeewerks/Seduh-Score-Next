// BTC's phone view: the same published payload as the projector (formats/btc/liveSession.js), as one scrolling
// column of cards in the paper theme, readable at 360px and a companion to the room's screen: the champion once
// there is one, where the event is up to, what is up next, the standings (the top places, the rest on request),
// the bracket and the latest results. Nothing here recomputes who won or who is level: a team's winner flag, a
// match's level and tie-break and a row's position are the payload's own, and the words for them are words.js's,
// shared with the projector so the two never say the same fact differently.
//
// core/viewer-shell.js rebuilds the body on EVERY live update (renderBody is called after it clears the node), so
// the one thing the viewer can change, whether the whole table is showing, lives here, in the body's closure
// (one body per event: core/formatBody.js), and the toggle's focus is carried across the rebuild through the
// cleanup the shell calls just before it clears (the only moment the old toggle is still in the page). The
// toggle itself works in place (it shows and hides rows, it does not rebuild the column), because the shell's
// body is a polite live region and a rebuild would have a screen reader read the whole page again.
import { el } from '../../core/dom.js';
import { sharedPositions } from '../../core/rankMovement.js';
import {
  btcBand,
  hasBtcPublicContent,
  matchLine,
  matchesPlayedLine,
  upNextKicker,
  judgesLine,
  thenLine,
  standingsHeading,
  tiedSuffix,
  winsText,
  qualifyingNote,
  outcomeLine,
  withTiebreak,
  slotOutcome,
  finalScoreLine,
  decidedPodiumPlaces,
  TO_BE_DECIDED,
  podiumPlace as placeOf,
} from './words.js';

// The places shown before "Show all": ties at the last of them are kept together.
export const PHONE_TOP_PLACES = 5;

const ROUND_HEADINGS = {
  quarterfinal: 'Quarterfinals',
  semifinal: 'Semifinals',
  final: 'Final',
  third_place: 'Third place',
};

const STANDINGS_HEADING_ID = 'btc-phone-standings-heading';

const card = (children) => el('section', { className: 'card' }, children);
const meta = (text) => el('p', { className: 'stage-meta', text });
const heading = (text, attrs = {}) => el('h2', { text, attrs });

// A heading that carries its own context ("Up next · Preliminary  A vs B"), so heading navigation lists
// something meaningful rather than a bare name.
const titledHeading = (kicker, title, className) =>
  el('h2', { className }, [
    el('span', { className: 'btc-phone-kicker', text: kicker }),
    document.createTextNode(' '),
    el('span', { className: 'btc-phone-title', text: title }),
  ]);

// qualifyingNote reads as a footer fragment ("top 8 qualify"); on its own line it is a sentence.
const sentence = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// ---------- cards ----------

function renderChampion(payload) {
  const champion = placeOf(payload, 'champion');
  const decided = decidedPodiumPlaces(payload);
  const score = finalScoreLine(payload);
  return [
    el(
      'section',
      { className: 'btc-phone-champion' },
      [
        el('h2', { className: 'btc-phone-champion-title' }, [
          el('span', { className: 'btc-phone-champion-label', text: 'Champion' }),
          document.createTextNode(' '),
          el('span', { className: 'btc-phone-champion-name', text: champion.teamName }),
        ]),
        score ? meta(score) : null,
      ].filter(Boolean),
    ),
    decided.length
      ? card([
          heading('Podium'),
          el(
            'dl',
            { className: 'btc-phone-podium' },
            [champion, ...decided].flatMap((place) => [
              el('dt', { text: place.label }),
              el('dd', { text: place.teamName }),
            ]),
          ),
        ])
      : null,
  ].filter(Boolean);
}

function knockoutProgress(bracket) {
  const slots = (bracket?.rounds ?? []).flatMap((round) => round.slots ?? []);
  return slots.length
    ? `${slots.filter((slot) => slot.status === 'confirmed').length} of ${slots.length} knockout matches played`
    : null;
}

function renderStatus(payload) {
  const { eventName, sectionLabel } = btcBand(payload);
  const progress =
    payload.phase === 'preliminary'
      ? matchesPlayedLine(payload.progress)
      : payload.phase === 'knockout'
        ? knockoutProgress(payload.bracket)
        : null;
  const children = [
    eventName ? meta(eventName) : null,
    sectionLabel ? heading(sectionLabel) : null,
    progress ? meta(progress) : null,
  ].filter(Boolean);
  return children.length ? card(children) : null;
}

function renderUpNext(upNext, thenNext) {
  const judges = judgesLine(upNext.judges);
  return card(
    [
      titledHeading(upNextKicker(upNext.roundLabel), matchLine(upNext)),
      judges ? meta(judges) : null,
      thenNext ? meta(thenLine(thenNext)) : null,
    ].filter(Boolean),
  );
}

// The whole table is in the page; the rows past the top places are `hidden` until asked for.
function renderStandings(payload, { isShowingAll, onToggle }) {
  const standings = payload.standings;
  const shared = sharedPositions(standings, (row) => row.position);
  const beyondTop = (row) => row.position > PHONE_TOP_PLACES;
  const extraCount = standings.filter(beyondTop).length;
  const preliminary = payload.phase === 'preliminary';
  const rows = standings.map((row) => {
    const tr = el('tr', {}, [
      el('td', { text: String(row.position) }),
      // Words, never colour alone: a tie among teams with results is written in the row.
      el('th', { text: row.teamName + tiedSuffix(row, shared), attrs: { scope: 'row' } }),
      el('td', { text: winsText(row.wins) }),
      el('td', { text: String(row.points) }),
    ]);
    if (beyondTop(row)) {
      tr.setAttribute('data-extra', 'true');
      tr.hidden = !isShowingAll();
    }
    return tr;
  });
  const table = el(
    'table',
    { className: 'btc-phone-table', attrs: { 'aria-labelledby': STANDINGS_HEADING_ID } },
    [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Pos', attrs: { scope: 'col' } }),
          el('th', { text: 'Team', attrs: { scope: 'col' } }),
          el('th', { text: 'Wins', attrs: { scope: 'col' } }),
          el('th', { text: 'Pts', attrs: { scope: 'col' } }),
        ]),
      ]),
      el('tbody', {}, rows),
    ],
  );
  // The label says what a tap will do; the state is in the label, so no aria-expanded to double it.
  const labelFor = (showing) =>
    showing ? `Show the top ${PHONE_TOP_PLACES}` : `Show all ${standings.length} teams`;
  const toggle =
    extraCount > 0
      ? el('button', {
          className: 'btn btn-outline tap-target',
          text: labelFor(isShowingAll()),
          attrs: { type: 'button', 'data-btc-toggle': 'standings' },
        })
      : null;
  toggle?.addEventListener('click', () => {
    const showing = onToggle();
    for (const tr of table.querySelectorAll('tr[data-extra]')) tr.hidden = !showing;
    toggle.textContent = labelFor(showing);
  });
  return {
    toggle,
    element: card(
      [
        heading(standingsHeading(payload.phase), { id: STANDINGS_HEADING_ID }),
        table,
        toggle,
        preliminary ? meta(sentence(qualifyingNote(standings))) : null,
      ].filter(Boolean),
    ),
  };
}

function renderBracket(bracket) {
  const rounds = bracket.rounds.filter((round) => round.slots?.length > 0);
  return card([
    heading('Bracket'),
    ...rounds.flatMap((round) => [
      el('h3', { className: 'btc-phone-round', text: ROUND_HEADINGS[round.round] ?? round.label }),
      el(
        'ul',
        { className: 'btc-phone-list' },
        round.slots.map((slot) => {
          const [a, b] = slot.teams;
          const nameOf = (team) => team.name ?? TO_BE_DECIDED;
          const scored = slot.status === 'confirmed' && a.total != null && b.total != null;
          const outcome = slotOutcome(slot, round.round);
          return el(
            'li',
            {},
            [
              el('span', {
                className: 'btc-phone-line',
                text: scored
                  ? `${nameOf(a)} ${a.total} – ${b.total} ${nameOf(b)}`
                  : `${nameOf(a)} vs ${nameOf(b)}`,
              }),
              outcome ? meta(outcome) : null,
              slot.status === 'confirmed'
                ? null
                : meta(
                    a.name === null || b.name === null
                      ? 'Waiting for earlier rounds'
                      : 'Not played yet',
                  ),
            ].filter(Boolean),
          );
        }),
      ),
    ]),
  ]);
}

function renderRecent(results) {
  return card([
    heading('Recent results'),
    el(
      'ul',
      { className: 'btc-phone-list' },
      results.map((result) => {
        const [a, b] = result.teams;
        return el('li', {}, [
          el('span', {
            className: 'btc-phone-line',
            text: `${a.name} ${a.total} – ${b.total} ${b.name}`,
          }),
          meta(`${result.roundLabel} · ${withTiebreak(outcomeLine(result), result.tiebreak)}`),
        ]);
      }),
    ),
  ]);
}

// ---------- the body ----------

// One phone body for one event. renderBody(container, payload) is what core/viewer-shell.js calls once there is
// something to show; it returns the cleanup the shell calls before its next rebuild and on unmount.
export function createBtcViewerBody() {
  let showAll = false;
  let toggle = null;
  let focusToggle = false;

  function paint(container, payload) {
    const standings = payload.standings?.length
      ? renderStandings(payload, {
          isShowingAll: () => showAll,
          onToggle: () => {
            showAll = !showAll;
            return showAll;
          },
        })
      : null;
    toggle = standings?.toggle ?? null;
    const bracket = payload.bracket?.rounds?.some((round) => round.slots?.length > 0)
      ? renderBracket(payload.bracket)
      : null;
    const recent = payload.recentResults?.length ? renderRecent(payload.recentResults) : null;
    // The preliminary round is about the table; once there is a bracket that is what the room is following, and
    // the preliminary table is the record behind it.
    const cards = [
      placeOf(payload, 'champion')?.state === 'decided' ? renderChampion(payload) : [],
      renderStatus(payload),
      payload.upNext ? renderUpNext(payload.upNext, payload.thenNext) : null,
      ...(bracket ? [bracket, recent, standings?.element] : [standings?.element, recent]),
    ]
      .flat()
      .filter(Boolean);
    container.append(el('div', { className: 'btc-phone' }, cards));
    if (focusToggle) {
      focusToggle = false;
      toggle?.focus();
    }
  }

  function renderBody(container, payload) {
    paint(container, payload);
    // Called by the shell just before it clears the container, and on unmount: the one moment the toggle that
    // has focus is still in the page. The shell renders again straight away (the flag is read by that paint);
    // when it paints a holding card instead, nothing reads it, so it is dropped rather than left to refocus
    // the toggle at some later recovery.
    return () => {
      focusToggle = toggle !== null && document.activeElement === toggle;
      queueMicrotask(() => {
        focusToggle = false;
      });
    };
  }

  return { hasContent: hasBtcPublicContent, renderBody };
}

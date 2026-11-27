// Throwdown's Redemption page (organiser console): who is in the redemption round, before and while it is voted. It opens
// from the matches page once a feeding round is complete and the losers have been drawn into groups (owner decision
// 2026-11-27: "a new page shows the redemption competitors"). It reads only; the votes are taken on the matches page,
// where a group is a card like any other match. A module that is not on has no redemption round, so there is no link to
// this page and nothing to show (an organiser who types the address sees one honest sentence).
//
// Read from the same rows and the same bracket module as every other surface (data.js, bracket.js, redemption.js), so it
// can never disagree with the console or the projector. No colour alone: a decided group says "Winner".
import { getSupabase } from '../../core/supabaseClient.js';
import { el } from '../../core/dom.js';
import { findEvent } from '../../core/events.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { loadThrowdown } from './data.js';
import { describeThrowdownError } from './words.js';
import { redemptionRounds, redemptionRoundWords, redemptionSummary } from './redemption.js';

const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

function groupCard(group, revived) {
  const status = group.decided
    ? group.resultKind === 'walkover'
      ? 'Decided by walkover'
      : 'Decided'
    : group.playable
      ? 'Being voted'
      : 'Waiting';
  return el('li', { className: 'td-red-group', attrs: { 'aria-label': `Group ${group.number}` } }, [
    el('h4', { text: `Group ${group.number}` }),
    el(
      'ul',
      { className: 'td-red-brewers' },
      group.brewers.map((b) => {
        const back = revived.get(b.entryId) ?? 0;
        return el(
          'li',
          { className: 'td-red-brewer' },
          [
            el('span', { className: 'td-red-name', text: b.name }),
            group.decided && b.winner ? el('span', { className: 'td-red-winner', text: 'Winner' }) : null,
            group.decided && typeof b.votes === 'number'
              ? el('span', {
                  className: 'td-red-votes',
                  text: `${b.votes} ${b.votes === 1 ? 'vote' : 'votes'}`,
                })
              : null,
            back > 0
              ? el('span', { className: 'td-note', text: `Came back ${times(back)} already` })
              : null,
          ].filter(Boolean),
        );
      }),
    ),
    el('p', { className: 'td-note', text: status }),
  ]);
}

// Pure. The page body for one load. `revived` is the count of times each brewer won a PREVIOUS redemption round.
export function buildRedemptionView(event, data) {
  const rounds = redemptionRounds(data.bracket);
  const head = [
    event.is_test
      ? el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' })
      : null,
    el('h1', { id: 'td-red-heading', text: 'Redemption round', attrs: { tabindex: '-1' } }),
    el('p', { className: 'td-note', text: event.name }),
  ].filter(Boolean);
  if (rounds.length === 0) {
    const saved = redemptionSummary(data.settings?.modules?.redemption);
    return el('section', { className: 'screen-container td-screen' }, [
      ...head,
      el('p', {
        text: saved
          ? `No redemption round yet. It is drawn when the feeding round is complete. ${saved}`
          : 'This event has no redemption round.',
      }),
    ]);
  }
  const cards = rounds.map((round, index) => {
    // who had already come back before this round: wins in the EARLIER redemption rounds
    const before = new Map();
    for (const earlier of rounds.slice(0, index)) {
      for (const g of earlier.groups) {
        for (const b of g.brewers)
          if (b.winner) before.set(b.entryId, (before.get(b.entryId) ?? 0) + 1);
      }
    }
    return el(
      'section',
      { className: 'card td-card', attrs: { 'aria-labelledby': `td-red-${round.id}` } },
      [
        el('h2', { id: `td-red-${round.id}`, text: round.label }),
        el('p', {
          className: 'td-note',
          text: round.feedLabel
            ? `The brewers who lost in ${round.feedLabel}.`
            : 'The brewers who lost.',
        }),
        el('p', { text: redemptionRoundWords(round) }),
        el('h3', { text: `Who is in (${round.entrants.length})` }),
        el(
          'ul',
          { className: 'td-red-roster' },
          round.entrants.map((name) => el('li', { text: name })),
        ),
        el('h3', { text: 'The groups' }),
        el(
          'ol',
          { className: 'td-red-groups' },
          round.groups.map((g) => groupCard(g, before)),
        ),
      ],
    );
  });
  return el('section', { className: 'screen-container td-screen' }, [
    ...head,
    ...cards,
    el('a', {
      className: 'btn btn-primary tap-target',
      text: 'Open the matches to vote',
      attrs: { href: `#/events/${event.id}/throwdown/matches` },
    }),
  ]);
}

export async function mountThrowdownRedemptionScreen(
  root,
  { eventId, client = getSupabase(), signal } = {},
) {
  async function attempt() {
    root.innerHTML = '';
    root.appendChild(
      el('div', { className: 'screen-feedback', text: 'Loading…', attrs: { role: 'status' } }),
    );
    try {
      const [event, data] = await raceTimeout(
        Promise.all([findEvent(eventId, client), loadThrowdown(eventId, client)]),
        DEFAULT_LOAD_TIMEOUT_MS,
      );
      if (signal?.aborted) return;
      root.innerHTML = '';
      root.appendChild(buildRedemptionView(event, data));
      root.querySelector('#td-red-heading')?.focus();
    } catch (err) {
      if (signal?.aborted) return;
      root.innerHTML = '';
      const fb = el('div', {
        className: 'screen-feedback',
        text: err.timedOut
          ? 'This is taking longer than expected — check your connection and try Retry.'
          : describeThrowdownError(err),
        attrs: { role: 'status' },
      });
      fb.dataset.tone = 'error';
      const retry = el('button', {
        className: 'btn btn-outline tap-target',
        text: 'Retry',
        attrs: { type: 'button' },
      });
      retry.addEventListener('click', attempt);
      root.append(fb, retry);
    }
  }
  await attempt();
  return { unmount() {} };
}

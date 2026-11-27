// Throwdown's phone body (the audience view): what core/viewer-shell.js mounts once a Throwdown live session has
// content. A single column of cards, 360px first: the champion (when decided), the latest results, what is being played now
// and the bracket by round. Reads only the live payload (liveSession.js). The TEST banner is the shell's
// (it is told isTest by the live row), so it is on this surface from the first publish.
//
// Words, never colour alone: the winner says "Wins", a walkover says "Walkover", a bye says "Bye". Names are set as
// text. A round that has not been earned does not appear (the payload never contains one).
import { el } from '../../core/dom.js';

export function hasThrowdownPublicContent(payload) {
  return Boolean(payload && typeof payload === 'object' && (payload.eventName || payload.rounds));
}

function sideLine(match) {
  if (match.resultKind === 'walkover') return 'Walkover';
  if (match.resultKind === 'bye') return 'Bye';
  const counts = match.sides.map((s) => s.votes);
  return counts.every((n) => typeof n === 'number') ? counts.join(' to ') : null;
}

function matchItem(match) {
  const winner = match.sides.find((s) => s.winner);
  const line = el(
    'p',
    { className: 'td-phone-vs' },
    match.sides
      .flatMap((side, i) => [
        i > 0 ? document.createTextNode(' vs ') : null,
        el('span', {
          className: 'td-phone-name',
          text: side.name ?? 'To be decided',
          attrs: side.winner ? { 'data-winner': 'true' } : {},
        }),
      ])
      .filter(Boolean),
  );
  const detail = match.decided
    ? `${winner ? `${winner.name} wins` : 'Decided'}${sideLine(match) ? ` · ${sideLine(match)}` : ''}`
    : match.judging
      ? 'Judges scoring'
      : 'Being decided';
  return el('li', { className: 'td-phone-match' }, [
    line,
    el('p', { className: 'td-phone-detail', text: detail }),
  ]);
}

// A decided match in "Latest results": the winner is the headline, the score is a badge, the loser is one muted line
// ("beat ..."), so a result reads at a glance. The score is winner first (the sides are listed in bracket order, which
// is why the old line could say "0 to 1"). Words carry it as well as weight: "beat", and the badge says what it is.
function resultItem(match) {
  const winner = match.sides.find((s) => s.winner);
  const loser = match.sides.find((s) => !s.winner);
  if (!match.decided || !winner || !loser) return matchItem(match);
  let badge = null;
  if (match.resultKind === 'walkover') badge = { text: 'Walkover', label: 'Walkover' };
  else if (match.resultKind === 'bye') badge = { text: 'Bye', label: 'Bye' };
  else if (typeof winner.votes === 'number' && typeof loser.votes === 'number') {
    badge = {
      text: `${winner.votes}\u2013${loser.votes}`,
      label: `${winner.votes} to ${loser.votes}`,
    };
  }
  return el('li', { className: 'td-phone-result' }, [
    el(
      'div',
      { className: 'td-phone-result-top' },
      [
        el('p', {
          className: 'td-phone-result-winner',
          text: winner.name ?? 'To be decided',
        }),
        badge
          ? el('span', {
              className: 'td-phone-score',
              text: badge.text,
              attrs: { 'aria-label': badge.label },
            })
          : null,
      ].filter(Boolean),
    ),
    el('p', {
      className: 'td-phone-detail td-phone-result-loser',
      text: `beat ${loser.name ?? 'To be decided'}`,
    }),
  ]);
}

function card(title, children) {
  return el('section', { className: 'card td-phone-card' }, [
    el('h2', { text: title }),
    ...children,
  ]);
}

export function createThrowdownViewerBody() {
  function renderBody(container, payload) {
    const cards = [];
    if (payload.champion) {
      cards.push(
        el(
          'section',
          { className: 'card td-phone-champion', attrs: { 'aria-label': 'Champion' } },
          [
            el('p', { className: 'td-phone-kicker', text: 'Champion' }),
            el('p', { className: 'td-phone-champion-name', text: payload.champion.name }),
            payload.champion.runnerUp
              ? el('p', { text: `Runner-up: ${payload.champion.runnerUp}` })
              : null,
            payload.champion.thirdPlace
              ? el('p', { text: `3rd place: ${payload.champion.thirdPlace}` })
              : null,
          ].filter(Boolean),
        ),
      );
    }
    if (payload.phase === 'setup') {
      cards.push(
        card('Starting soon', [
          el('p', {
            text: `${payload.competitors ?? 0} competitors. The draw has not been made yet.`,
          }),
        ]),
      );
    }
    if (payload.recent?.length) {
      cards.push(
        card('Latest results', [
          el('ul', { className: 'td-phone-list' }, payload.recent.map(resultItem)),
        ]),
      );
    }
    if (payload.nowPlaying?.length) {
      cards.push(
        card('Now playing', [
          el('ul', { className: 'td-phone-list' }, payload.nowPlaying.map(matchItem)),
        ]),
      );
    }
    for (const round of [...(payload.rounds ?? [])].reverse()) {
      cards.push(
        card(round.label, [el('ul', { className: 'td-phone-list' }, round.matches.map(matchItem))]),
      );
    }
    container.append(el('div', { className: 'td-phone' }, cards));
  }
  return { hasContent: hasThrowdownPublicContent, renderBody };
}

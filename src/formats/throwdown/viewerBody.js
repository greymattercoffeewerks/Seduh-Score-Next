// Throwdown's phone body (the audience view): what core/viewer-shell.js mounts once a Throwdown live session has
// content. A single column of cards, 360px first: the champion (when decided), the latest results, what is being played now
// and the bracket by round. Reads only the live payload (liveSession.js). The TEST banner is the shell's
// (it is told isTest by the live row), so it is on this surface from the first publish.
//
// Words, never colour alone: the winner is labelled "Winner", a walkover says "Walkover", a bye says "Bye". Names are set as
// text. A round that has not been earned does not appear (the payload never contains one).
import { el } from '../../core/dom.js';
import { buildMatchBlock, buildResultRow, buildRound } from '../../core/vocabulary.js';

export function hasThrowdownPublicContent(payload) {
  return Boolean(payload && typeof payload === 'object' && (payload.eventName || payload.rounds));
}

// A match as the shared vocabulary draws it (core/vocabulary.js): decided with a winner is a scoreboard, anything else is
// the "vs" block with its status in words. The score is winner first (the sides are listed in bracket order, which is why
// the old line could say "0 to 1"). A walkover or a bye has no counts: the word stands where the numbers would.
function matchNode(match) {
  const winner = match.sides.find((s) => s.winner);
  const loser = match.sides.find((s) => !s.winner);
  if (match.decided && winner) {
    const note =
      match.resultKind === 'walkover' ? 'Walkover' : match.resultKind === 'bye' ? 'Bye' : null;
    const counted =
      Boolean(loser) && typeof winner.votes === 'number' && typeof loser.votes === 'number';
    return buildResultRow({
      winner: { name: winner.name ?? 'To be decided', score: counted ? winner.votes : null },
      loser: loser
        ? { name: loser.name ?? 'To be decided', score: counted ? loser.votes : null }
        : null,
      note: counted ? null : note,
    });
  }
  return buildMatchBlock({
    names: match.sides.map((s) => s.name ?? 'To be decided'),
    note: match.decided ? 'Decided' : match.judging ? 'Judges scoring' : 'Being decided',
  });
}

function matchList(matches) {
  return el(
    'ul',
    { className: 'td-phone-list' },
    matches.map((m) => el('li', {}, [matchNode(m)])),
  );
}

function card(title, children) {
  return el('section', { className: 'card td-phone-card' }, [
    el('h2', { text: title }),
    ...children,
  ]);
}

export function createThrowdownViewerBody() {
  const userOpen = new Map();
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
      cards.push(card('Latest results', [matchList(payload.recent)]));
    }
    if (payload.nowPlaying?.length) {
      cards.push(card('Now playing', [matchList(payload.nowPlaying)]));
    }
    // The newest round is open, earlier ones are closed; a person's own open or close is kept across live updates
    // (the shell rebuilds the body on every publish), keyed by the round's id.
    const rounds = payload.rounds ?? [];
    [...rounds].reverse().forEach((round, i) => {
      const key = round.id ?? round.label;
      const decided = round.matches.filter((m) => m.decided).length;
      const done = decided === round.matches.length;
      cards.push(
        buildRound({
          className: 'card td-phone-card',
          eyebrow: `${round.label}${done ? ' \u00b7 Done' : ' \u00b7 Now'}`,
          title: round.roundLabel ?? round.label,
          count: `${decided} of ${round.matches.length} decided`,
          open: userOpen.has(key) ? userOpen.get(key) : i === 0,
          onToggle: (open) => userOpen.set(key, open),
          children: [matchList(round.matches)],
        }),
      );
    });
    container.append(el('div', { className: 'td-phone' }, cards));
  }
  return { hasContent: hasThrowdownPublicContent, renderBody };
}

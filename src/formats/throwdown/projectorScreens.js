// Throwdown's venue display (the projector). Two screens: the live bracket (what is being played now, the latest
// results, and the rounds earned so far as columns) and the champion. Format-agnostic machinery (the band, when to
// change screen, the frame) is core/stageDisplay.js and friends; this is only what is Throwdown. The bracket never
// shows a future round: only rounds that exist are drawn, and a decided match is the only one with numbers.
//
// The TEST marker is the shell's (viewer-shell, from the live row's is_test), so it is on this surface from the first
// publish. Meaning is carried by words ("Wins", "Walkover", "Bye"), never colour alone.
import { el } from '../../core/dom.js';
import { renderScreenFrame } from '../../core/stageDisplay.js';
import { stageKicker, stageTitle, renderChampion } from '../../core/stageVocabulary.js';
import { hasThrowdownPublicContent } from './viewerBody.js';

export const hasThrowdownProjectorContent = hasThrowdownPublicContent;

export function throwdownBand(payload) {
  const section =
    payload.phase === 'complete'
      ? 'Final result'
      : payload.phase === 'live'
        ? 'Live bracket'
        : 'Starting soon';
  return { eventName: payload.eventName, sectionLabel: section, live: true };
}

function sideText(match) {
  if (match.resultKind === 'walkover') return 'Walkover';
  if (match.resultKind === 'bye') return 'Bye';
  const counts = match.sides.map((s) => s.votes);
  return counts.every((n) => typeof n === 'number') ? counts.join(' to ') : '';
}

function matchBox(match) {
  const rows = match.sides.map((side) =>
    el(
      'div',
      {
        className: 'td-stage-side',
        attrs: side.winner === null ? {} : { 'data-winner': String(side.winner) },
      },
      [
        el('span', { className: 'td-stage-name', text: side.name ?? 'To be decided' }),
        side.winner ? el('span', { className: 'td-stage-chip', text: 'Wins' }) : null,
        typeof side.votes === 'number'
          ? el('span', { className: 'td-stage-votes', text: String(side.votes) })
          : null,
      ].filter(Boolean),
    ),
  );
  const note = match.decided ? (match.resultKind !== 'votes' ? sideText(match) : '') : '';
  return el(
    'li',
    { className: 'td-stage-match' },
    [...rows, note ? el('span', { className: 'td-stage-note', text: note }) : null].filter(Boolean),
  );
}

const liveScreen = {
  key: 'bracket',
  urgent: false,
  minDwellMs: 0,
  mount(host, payload) {
    const frame = renderScreenFrame();
    host.append(frame.el);
    function paint(next) {
      const nodes = [];
      if (next.nowPlaying?.length) {
        nodes.push(
          stageKicker('Now playing'),
          el('ul', { className: 'td-stage-now' }, next.nowPlaying.map(matchBox)),
        );
      } else {
        nodes.push(stageKicker(next.phase === 'setup' ? 'Starting soon' : 'Between matches'));
        if (next.phase === 'setup') nodes.push(stageTitle(`${next.competitors ?? 0} competitors`));
      }
      if (next.rounds?.length) {
        nodes.push(
          el(
            'div',
            { className: 'td-stage-rounds' },
            next.rounds.map((round) =>
              el('section', { className: 'td-stage-round', attrs: { 'aria-label': round.label } }, [
                el('h3', { className: 'td-stage-round-title', text: round.label }),
                el('ul', { className: 'td-stage-list' }, round.matches.map(matchBox)),
              ]),
            ),
          ),
        );
      }
      frame.main.replaceChildren(...nodes);
    }
    paint(payload);
    return { update: paint, destroy() {} };
  },
};

const championScreen = {
  key: 'champion',
  urgent: false,
  minDwellMs: 60_000,
  mount(host, payload) {
    const frame = renderScreenFrame();
    host.append(frame.el);
    function paint(next) {
      const c = next.champion;
      const podium = [
        c.runnerUp ? `Runner-up ${c.runnerUp}` : null,
        c.thirdPlace ? `3rd place ${c.thirdPlace}` : null,
      ]
        .filter(Boolean)
        .join('   ·   ');
      frame.main.replaceChildren(...renderChampion({ name: c.name, podiumLine: podium || null }));
    }
    paint(payload);
    return { update: paint, destroy() {} };
  },
};

export function selectThrowdownScreen(payload) {
  if (!hasThrowdownPublicContent(payload)) return null;
  return payload.champion ? championScreen : liveScreen;
}

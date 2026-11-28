// Test fixtures for Throwdown's projector: build a live payload from a compact description of a bracket, through the
// REAL `deriveBracket` and `assembleThrowdownPayload`, so the screens are tested on exactly what a room is sent.
//
//   payloadFor({
//     names: ['Ana', 'Bima', ...],                 // every competitor (the roster)
//     rounds: [
//       { phase: 'main', matches: [
//         { a: 'Ana', b: 'Bima', result: [2, 1], at: '2026-11-27T10:00:00Z' },   // votes
//         { a: 'Citra', b: 'Dani', result: 'walkover:1' },                          // slot 1 wins by walkover
//         { a: 'Eka', result: 'bye' },
//         { a: 'Gita', b: 'Hadi', result: 'scores:2' },                             // scoresheets, slot 2 wins
//         { a: 'Ika', b: 'Joko' },                                                  // not decided
//       ] },
//       // a redemption round: kind 'pool', each match a group of 2 to 4 brewers, votes one count per brewer
//       { phase: 'redemption', kind: 'pool', matches: [
//         { sides: ['Ana', 'Bima', 'Citra'], result: [2, 1, 0] },
//         { sides: ['Dani', 'Eka'] },
//       ] },
//     ],
//     scoresheet: { preset: 'latte_art_v1', cups: { final: 1 } },   // optional (module on)
//   })
import { deriveBracket } from './bracket.js';
import { assembleThrowdownPayload } from './liveSession.js';

export function bracketRows({ names, rounds }) {
  const out = { rounds: [], matches: [], slots: [], votes: [], entries: [] };
  const scoreWinners = new Map();
  out.entries = names.map((name) => ({ id: `e${name}`, display_name: name, cafe: 'Secret Cafe' }));
  rounds.forEach((round, i) => {
    const roundId = `r${i + 1}`;
    out.rounds.push({
      id: roundId,
      position: i + 1,
      kind: round.kind ?? (round.phase === 'redemption' ? 'pool' : 'pair'),
      phase: round.phase ?? 'main',
    });
    round.matches.forEach((m, j) => {
      const id = `${roundId}m${j + 1}`;
      const result = m.result ?? null;
      let kind = null;
      let walkoverWinner = null;
      if (Array.isArray(result)) kind = 'votes';
      else if (typeof result === 'string') {
        [kind] = result.split(':');
        if (kind === 'walkover') walkoverWinner = Number(result.split(':')[1]);
      }
      out.matches.push({
        id,
        round_id: roundId,
        position: j + 1,
        result_kind: kind,
        confirmed_at: kind ? (m.at ?? '2026-11-27T10:00:00Z') : null,
        walkover_winner_position: walkoverWinner,
      });
      (m.sides ?? [m.a, m.b]).forEach((who, k) => {
        if (who === undefined && k === 1 && kind === 'bye') return;
        out.slots.push({
          id: `${id}s${k + 1}`,
          match_id: id,
          position: k + 1,
          entry_id: who ? `e${who}` : null,
        });
      });
      if (Array.isArray(result)) {
        result.forEach((count, k) => {
          for (let n = 0; n < count; n += 1)
            out.votes.push({ slot_id: `${id}s${k + 1}`, match_id: id });
        });
      }
      if (kind === 'scores') scoreWinners.set(id, `${id}s${Number(result.split(':')[1])}`);
    });
  });
  return { ...out, scoreWinners };
}

export function payloadFor(description, { eventName = 'Throwdown Night' } = {}) {
  const rows = bracketRows(description);
  return assembleThrowdownPayload({
    event: { name: eventName },
    bracket: deriveBracket(rows),
    activeCount: description.names.length,
    scoresheet: description.scoresheet ?? null,
    competitorNames: description.names,
  });
}

// A single round of `count` matches over fresh names, `decided` of them decided (first seat wins 2 to 1).
export function roundOf(count, { decided = 0, from = 0, phase = 'main' } = {}) {
  return {
    phase,
    matches: Array.from({ length: count }, (_, i) => ({
      a: `P${from + i * 2 + 1}`,
      b: `P${from + i * 2 + 2}`,
      ...(i < decided
        ? { result: [2, 1], at: `2026-11-27T10:${String(i).padStart(2, '0')}:00Z` }
        : {}),
    })),
  };
}

export const namesUpTo = (n) => Array.from({ length: n }, (_, i) => `P${i + 1}`);

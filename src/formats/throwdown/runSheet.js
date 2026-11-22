// Throwdown's run sheet: what phase the event is in, derived from the reads the console already makes. Pure (rows in,
// phases and warnings out: no DOM, no database, no clock); core/runSheet.js and core/eventWarnings.js draw what this
// returns. Nothing is stored: the phases are derived on every load.
//
// Phases, in order: Setup, Draw and start, one phase per main round that EXISTS, Rounds to come, 3rd place, Results.
// Each is { id, label, status, count, progress, nextAction: { label, href }, blockedReason } (the contract in
// core/runSheet.js). `blocked` means the organiser can fix it now; `waiting` means an earlier phase has to finish.
//
// Rules this file keeps:
//   - Nothing is projected (the format rule): a round that has not been earned is never named. "Rounds to come" only
//     counts how many more there will be; it never gives one a name or a match.
//   - Who won is never worked out here: winners, byes and "decided" come from `deriveBracket`, vote arithmetic from
//     `votes.js` (`leadOf`, `tallyVotes`), the words for a match from `words.js` (`matchTitle`).
//   - A read that failed is `null` (`queuedCount`), and its warning stays silent.
import { leadOf, tallyVotes } from './votes.js';
import { matchTitle } from './words.js';

export function throwdownLinks(eventId) {
  const home = `#/events/${encodeURIComponent(eventId)}`;
  return {
    home,
    matches: `${home}/throwdown/matches`,
    results: `${home}/throwdown/results`,
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const activeEntries = (entries) => (entries ?? []).filter((e) => !e.withdrawn);
const mainRounds = (bracket) => bracket.rounds.filter((r) => r.phase === 'main');

// The votes a side holds, summed, for a match that is tap-voted. A scored match carries null votes (no taps).
const totalVotes = (match) => match.sides.reduce((sum, s) => sum + (s.votes ?? 0), 0);

function setupPhase(data, links) {
  const { settings, bracket } = data;
  const active = activeEntries(data.entries).length;
  const count = `${plural(active, 'competitor', 'competitors')} · ${plural(
    settings.judge_count,
    'judge',
    'judges',
  )} · 3rd place ${settings.third_place ? 'on' : 'off'}`;
  const base = { id: 'setup', label: 'Setup', count };
  if (bracket.started) {
    return { ...base, status: 'done', nextAction: null, blockedReason: null };
  }
  if (active < 2) {
    return {
      ...base,
      status: 'blocked',
      nextAction: { label: 'Add competitors', href: links.matches },
      blockedReason: 'Add at least 2 competitors.',
    };
  }
  // Ready: the one thing left to do is the next phase's action, so this card offers none (one primary next step).
  return { ...base, status: 'in_progress', nextAction: null, blockedReason: null };
}

function drawPhase(data, links) {
  const { bracket, draw } = data;
  const active = activeEntries(data.entries).length;
  const base = { id: 'draw', label: 'Draw and start' };
  if (bracket.started) {
    let count = 'Drawn';
    if (draw?.mode === 'random') count = `Random draw · seed ${draw.seed}`;
    else if (draw?.mode === 'manual') count = 'Manual draw';
    return { ...base, status: 'done', count, nextAction: null, blockedReason: null };
  }
  if (active < 2) {
    return {
      ...base,
      status: 'waiting',
      count: 'Not drawn',
      nextAction: null,
      blockedReason: 'Waiting for Setup.',
    };
  }
  return {
    ...base,
    status: 'not_started',
    count: 'Not drawn',
    nextAction: { label: 'Draw and start', href: links.matches },
    blockedReason: null,
  };
}

function roundPhase(round, links) {
  const decided = round.matches.filter((m) => m.decided).length;
  const active = round.matches.filter((m) => !m.decided && totalVotes(m) > 0).length;
  const total = round.matches.length;
  const open = total - decided;
  const next = round.matches.find((m) => m.playable);
  return {
    id: `round-${round.position}`,
    label: round.label,
    status: open === 0 ? 'done' : 'in_progress',
    count: `${decided} of ${total} decided`,
    progress: { done: decided, active, total },
    nextAction: open === 0 || !next ? null : { label: 'Open matches', href: links.matches },
    blockedReason: null,
  };
}

// Only while the Final does not exist. N is how many MORE rounds there will be, never a round's name.
function roundsToComePhase(rounds) {
  const latest = rounds[rounds.length - 1];
  if (!latest || latest.matches.length <= 1) return null;
  const more = Math.ceil(Math.log2(latest.matches.length));
  return {
    id: 'rounds-to-come',
    label: 'Rounds to come',
    status: 'waiting',
    count: `${plural(more, 'more round', 'more rounds')}`,
    nextAction: null,
    blockedReason: `Starts when the ${latest.label} is decided.`,
  };
}

function thirdPlacePhase(data, links, rounds) {
  const { bracket } = data;
  const third = bracket.rounds.find((r) => r.phase === 'third_place');
  if (third) return { ...roundPhase(third, links), id: 'third-place' };
  const base = { id: 'third-place', label: '3rd place' };
  const last = rounds[rounds.length - 1];
  if (last && last.matches.length === 1) {
    return {
      ...base,
      status: 'done',
      count: 'Not played: a semi-final bye or a withdrawn loser.',
      nextAction: null,
      blockedReason: null,
    };
  }
  return {
    ...base,
    status: 'waiting',
    count: 'Not created',
    nextAction: null,
    blockedReason: 'Created with the Final, when both semi-final losers can play.',
  };
}

function resultsPhase(data, links) {
  const { bracket } = data;
  const base = { id: 'results', label: 'Results' };
  if (bracket.complete) {
    return {
      ...base,
      status: 'done',
      count: `Champion: ${bracket.champion}`,
      nextAction: { label: 'Open results', href: links.results },
      blockedReason: null,
    };
  }
  return {
    ...base,
    status: 'not_started',
    count: 'Not decided',
    nextAction: null,
    blockedReason: null,
  };
}

/**
 * Pure. The phases of a Throwdown event.
 * @param {{
 *   eventId: string, settings: { judge_count: number, third_place: boolean }, draw: object|null,
 *   entries: object[], bracket: object
 * }} data the shape `loadThrowdown` returns, plus `eventId`
 */
export function deriveThrowdownPhases(data) {
  const links = throwdownLinks(data.eventId);
  const rounds = mainRounds(data.bracket);
  const finalExists = rounds.length > 0 && rounds[rounds.length - 1].matches.length === 1;
  const phases = [setupPhase(data, links), drawPhase(data, links)];
  for (const round of rounds) phases.push(roundPhase(round, links));
  if (!finalExists) {
    const toCome = roundsToComePhase(rounds);
    if (toCome) phases.push(toCome);
  }
  if (data.settings.third_place) phases.push(thirdPlacePhase(data, links, rounds));
  phases.push(resultsPhase(data, links));
  return phases.map((phase) => ({ progress: null, ...phase }));
}

/**
 * Pure. The warnings worth an organiser's attention (core/eventWarnings.js sorts by severity). `queuedCount` is
 * null when its read failed, and then says nothing. Every warning links to the matches page.
 * @param {{
 *   eventId: string, settings: { judge_count: number }, entries: object[], bracket: object,
 *   queuedCount: number|null
 * }} data
 */
export function deriveThrowdownWarnings(data) {
  const links = throwdownLinks(data.eventId);
  const { bracket, settings } = data;
  const warnings = [];
  const active = activeEntries(data.entries).length;

  if (!bracket.started) {
    if (active < 2) {
      warnings.push({
        id: 'too-few-competitors',
        severity: 'error',
        text: 'Fewer than 2 active competitors. Add competitors before the draw.',
        href: links.matches,
        actionLabel: 'Add competitors',
      });
    } else if (active % 2 === 1) {
      warnings.push({
        id: 'odd-count',
        severity: 'info',
        text: 'Round 1 will have a bye.',
        href: links.matches,
        actionLabel: 'Open matches',
      });
    }
  }

  const withdrawn = new Map(
    (data.entries ?? []).filter((e) => e.withdrawn).map((e) => [e.id, e.display_name]),
  );
  for (const round of bracket.rounds) {
    for (const match of round.matches) {
      if (match.decided) continue;
      const title = matchTitle(match);
      if (match.playable) {
        const tallies = tallyVotes(
          match.sides.map((s) => ({ id: s.slotId, position: s.position, entryId: s.entryId })),
          match.sides.flatMap((s) =>
            Array.from({ length: s.votes ?? 0 }, () => ({ slotId: s.slotId })),
          ),
        );
        const lead = leadOf(tallies);
        if (lead.level && lead.total >= settings.judge_count) {
          warnings.push({
            id: `level-${match.id}`,
            severity: 'warning',
            text: `${title} is level at ${tallies.map((t) => t.votes).join('–')}. An extra tap decides it.`,
            href: links.matches,
            actionLabel: 'Open matches',
          });
        }
      }
      const gone = match.sides.filter((s) => s.entryId && withdrawn.has(s.entryId));
      if (gone.length > 0) {
        warnings.push({
          id: `withdrawn-${match.id}`,
          severity: 'warning',
          text: `${title}: ${gone.map((s) => withdrawn.get(s.entryId)).join(' and ')} withdrew. Record a walkover.`,
          href: links.matches,
          actionLabel: 'Open matches',
        });
      }
    }
  }

  if (data.queuedCount > 0) {
    const n = data.queuedCount;
    warnings.push({
      id: 'queued',
      severity: 'warning',
      text: `${n} ${n === 1 ? 'tap or action is' : 'taps or actions are'} saved on this device and not sent yet.`,
      href: links.matches,
      actionLabel: 'Open matches',
    });
  }
  return warnings;
}

// Pure. The meta line under the heading: the phase in progress, else "Finished", else the first not done.
export function currentPhaseLabel(phases) {
  const active = phases.find((p) => p.status === 'in_progress' || p.status === 'blocked');
  if (active) return active.label;
  if (phases.every((p) => p.status === 'done')) return 'Finished';
  return phases.find((p) => p.status !== 'done')?.label ?? '';
}

// What the organiser home says about each format: the format cards on "+ New event" and the words on an event's row
// and live card. Like main.js and liveSurfaces.js this is a composition file, outside core/, so it may name the
// formats while src/core/ stays format-agnostic (core/eventsScreen.js, core/newEventScreen.js and core/eventHome.js
// only ever receive these as data). Adding a format is one entry in FORMAT_OPTIONS and one in DESCRIBERS.
//
// The facts are the plain counts the database's `org_event_summaries` door returns (its migration lists the keys);
// every key is always present, 0 when a format does not use it. A describer answers the shape core/eventHome.js
// documents (summary, ready, phase, next, progress, attention) and never throws on missing data.

import { MIN_JUDGES } from './formats/btc/runSheet.js';

export const FORMAT_OPTIONS = [
  {
    value: 'cup_taster',
    label: 'Cup Taster',
    kind: 'Individual · timed',
    description:
      'Cuppers find the odd cup in each set against the clock. Heats, then the fastest and most correct go through.',
  },
  {
    value: 'btc',
    label: 'BTC',
    kind: 'Teams · rounds + knockout',
    description:
      'Barista Team Championship. Preliminary rounds, a cut, then a knockout to the podium.',
  },
  {
    value: 'throwdown',
    label: 'Throwdown',
    kind: 'Individual · 1 v 1',
    description: 'Head-to-head knockout. Judges pick a winner each match until one is left.',
  },
];

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const n = (facts, key) => (Number.isFinite(facts?.[key]) ? facts[key] : 0);

function joinParts(parts) {
  const text = parts.filter(Boolean).join(' · ');
  return text === '' ? null : text;
}

function describeCupTaster(event, facts) {
  const entries = n(facts, 'entries_active');
  const heats = n(facts, 'heats');
  const done = n(facts, 'heats_confirmed');
  const active = n(facts, 'heats_active');
  const stages = n(facts, 'stages');
  const attention = [];
  if (!event.ended_at && entries === 0) {
    attention.push({
      id: 'no-cuppers',
      severity: 'warning',
      text: 'no cuppers registered yet.',
      actionLabel: 'Open',
    });
  }
  let next = null;
  if (active > 0) next = 'next: finish the heat in progress';
  else if (entries === 0) next = 'next: register the cuppers';
  else if (heats === 0) next = 'next: set up the stages and heats';
  else if (done < heats) next = 'next: run the next heat';
  return {
    summary: joinParts([
      facts ? plural(entries, 'cupper') : null,
      heats > 0 ? `${heats} ${heats === 1 ? 'heat' : 'heats'} drawn` : null,
    ]),
    ready: facts ? entries > 0 && heats > 0 : null,
    phase:
      stages > 0 ? `Stage ${Math.min(n(facts, 'stages_complete') + 1, stages)} of ${stages}` : null,
    next,
    progress:
      heats > 0
        ? {
            done,
            total: heats,
            active,
            text: `${done} of ${heats} heats confirmed${active > 0 ? ` · ${active} in progress` : ''}`,
          }
        : null,
    attention,
  };
}

function describeBtc(event, facts) {
  const teams = n(facts, 'teams');
  const judges = n(facts, 'judges');
  const matches = n(facts, 'matches');
  const done = n(facts, 'matches_confirmed');
  const active = n(facts, 'matches_active');
  const attention = [];
  if (!event.ended_at && facts && teams > 0 && judges < MIN_JUDGES) {
    attention.push({
      id: 'no-judges',
      severity: 'warning',
      text: judges === 0 ? 'has no judges yet.' : `needs at least ${MIN_JUDGES} judges.`,
      actionLabel: 'Open',
    });
  }
  let next = null;
  if (active > 0) next = 'next: finish the match being scored';
  else if (teams < 2 || teams % 2 === 1) next = 'next: add the teams';
  else if (matches === 0) next = 'next: draw the matches';
  else if (done < matches) next = 'next: score the next match';
  return {
    summary: facts
      ? joinParts([
          plural(teams, 'team'),
          matches > 0 ? `${done} of ${matches} matches done` : 'no matches yet',
        ])
      : null,
    // the same rule as the event's own run sheet (formats/btc/runSheet.js setupState, minus the country check, which
    // the counts cannot see): an even field of at least two, and at least MIN_JUDGES judges
    ready: facts ? teams >= 2 && teams % 2 === 0 && judges >= MIN_JUDGES : null,
    phase: null,
    next,
    progress:
      matches > 0
        ? {
            done,
            total: matches,
            active,
            text: `${done} of ${matches} matches confirmed${active > 0 ? ` · ${active} scoring` : ''}`,
          }
        : null,
    attention,
  };
}

function describeThrowdown(event, facts) {
  const entries = n(facts, 'entries_active');
  const matches = n(facts, 'td_matches');
  const done = n(facts, 'td_confirmed');
  const attention = [];
  if (!event.ended_at && facts && entries < 2) {
    attention.push({
      id: 'few-competitors',
      severity: 'warning',
      text: 'needs at least two competitors.',
      actionLabel: 'Open',
    });
  }
  let next = null;
  if (entries < 2) next = 'next: register the competitors';
  else if (matches === 0) next = 'next: draw the bracket';
  else if (done < matches) next = 'next: score the next match';
  return {
    summary: facts
      ? joinParts([
          plural(entries, 'competitor'),
          matches > 0 ? `${done} of ${matches} matches done` : 'no bracket yet',
        ])
      : null,
    ready: facts ? entries >= 2 && matches > 0 : null,
    phase: null,
    next,
    progress:
      matches > 0
        ? { done, total: matches, active: 0, text: `${done} of ${matches} matches confirmed` }
        : null,
    attention,
  };
}

const DESCRIBERS = {
  cup_taster: describeCupTaster,
  btc: describeBtc,
  throwdown: describeThrowdown,
};

/**
 * The home's `describeEvent`: (event, facts, { isLive }) => the words for that event. A format with no describer
 * (or an event with no facts, the summary read having failed) gets no state line, never an invented one.
 */
export function describeEventForHome(event, facts) {
  if (!facts || !Object.hasOwn(DESCRIBERS, event.format)) return null;
  return DESCRIBERS[event.format](event, facts);
}

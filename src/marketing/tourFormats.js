// The one list the public Tour reads for everything format-shaped: the picker, the comparison table, the live
// format sections, "Ways to play" and the "On the way" pipeline. Pure data and pure functions (no DOM, no imports),
// so a test can feed tourScreen.js a different list.
//
// Adding a format or a mode is one entry here:
//   format: { id, name, kind, status, public, description, modes[], icon, ... }
//     kind   audience kind label: 'Individual' | 'Teams' | '1v1' | 'League' (free text, shown on the picker card)
//     status 'live' | 'testing' | 'planned'
//     public false hides the entry everywhere (picker, table, section, count line, pipeline)
//   mode:   { id, name, status, public, description, nextText? }  (a way to play a format; same flags)
// A LIVE format also needs: `section` (kicker, copy, gets[], note?) and `compare` (the table column's five cells).
// Its media (photo or illustration board) is the one thing tourScreen.js still builds by id (MEDIA there); without
// one the section is text only. Nothing else in tourScreen.js names a format.
//
// Every claim below was checked against the code on 2026-11-13 (see the CHANGELOG entry); a mode's rules are not
// all locked (Spoons Out!), so its copy stays at the level the owner approved and adds no rule details.

export const STATUSES = Object.freeze(['live', 'testing', 'planned']);

export const STATUS_LABELS = Object.freeze({
  live: 'Live',
  testing: 'In testing',
  planned: 'Planned',
});

export const COMPARE_ROWS = Object.freeze([
  { key: 'who', label: 'Who competes' },
  { key: 'won', label: 'How a round is won' },
  { key: 'shape', label: 'Shape of the day' },
  { key: 'screen', label: 'On the big screen' },
  { key: 'goodFor', label: 'Good for' },
]);

export const FORMATS = Object.freeze([
  {
    id: 'cup-taster',
    name: 'Cup Taster',
    kind: 'Individual',
    status: 'live',
    public: true,
    icon: 'cup',
    description: 'Find the odd cup. Accuracy first, time breaks ties.',
    section: {
      kicker: 'Blind set sensory',
      copy: 'Three cups. Two the same. Find the odd one before the clock runs out. Seduh Score keeps the heat moving, scores accuracy, and handles time as the tiebreaker.',
      gets: [
        'A tap timer per cupper, with a manual time if the tap is missed',
        'Standings and advancement worked out for you, stage by stage',
        'A public results page and a printable results sheet',
      ],
    },
    compare: {
      who: 'Individual cuppers in heats',
      won: 'Most odd cups found; fastest time breaks a tie',
      shape: 'Heats, then stages, top cuppers advance',
      screen: 'Live standings and each result as it lands',
      goodFor: 'Sensory skill nights, café events',
    },
    modes: [
      {
        id: 'classic',
        name: 'Classic',
        status: 'live',
        public: true,
        description: 'Cuppers in heats, sets of three, find the odd cup in each.',
      },
      {
        id: 'spoons-out',
        name: 'Spoons Out!',
        status: 'testing',
        public: true,
        description:
          'Two cuppers head to head. Eight cups, three odd. Pull your picks, then call time to stop your opponent.',
        nextText:
          'A head-to-head cupping duel. Correct pulls score, wrong pulls cost a point, one hidden cup pays double, and the first cupper done calls time on both.',
      },
    ],
  },
  {
    id: 'btc',
    name: 'BTC',
    kind: 'Teams',
    status: 'live',
    public: true,
    icon: 'team',
    description: 'Team head-to-head, judges split three tokens per cup.',
    section: {
      kicker: 'Barista Team Championship',
      copy: 'Two teams, one set of cups, scored cup by cup. Preliminary rounds decide who makes the cut, the top 8 go through to a knockout, and a final crowns the champion team.',
      gets: [
        'Round 1 drawn at random; round 2 drawn at random or by round 1 results',
        'The cut to the top 8, with a sign-off sheet for the committee',
        'Match and cup scores you can download as CSV',
      ],
    },
    compare: {
      who: 'Teams, two per match',
      won: 'Judges split three tokens per cup; more tokens earns +5, fastest team +2',
      shape: 'Preliminary rounds, a cut to the top 8, then a knockout',
      screen: 'Live scores and standings',
      goodFor: 'National team championships',
    },
    modes: [],
  },
  {
    id: 'throwdown',
    name: 'Throwdown',
    kind: '1v1',
    status: 'live',
    public: true,
    icon: 'bracket',
    description: 'Knockout bracket, judges vote each match.',
    section: {
      kicker: '1v1 knockout',
      copy: 'Two competitors, one match at a time. Seed the bracket or draw it at random, let the judges vote, and follow the winners through to a final, with an optional 3rd place match, on a live audience view.',
      gets: [
        'A random draw or a bracket you place by hand, with walkovers handled',
        "Judges' votes recorded per match, winner moves on automatically",
        'A printable results page with the podium and a full match log',
      ],
      // Redemption and revival rounds are NOT built: named here as coming, never in the copy or the bullets
      // (a test keeps them out of `.tour-copy`).
      note: 'Live in the organiser console. Redemption and revival rounds are coming later as add-on modules.',
    },
    compare: {
      who: 'Two competitors per match',
      won: 'Judges vote; the majority wins',
      shape: 'A bracket drawn at random or set by hand, to a final and an optional 3rd place match',
      screen: 'Live bracket and match results',
      goodFor: 'Head-to-head battles judged by a panel',
    },
    modes: [],
  },
  {
    id: 'liga-seduh',
    name: 'Liga Seduh',
    kind: 'League',
    status: 'planned',
    public: true,
    icon: 'league',
    description: 'Round robin across a season.',
    nextText:
      'A round robin league where a small field brews across rounds and the standings change as each result lands.',
    modes: [],
  },
]);

const byStatus = (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status);

// What a visitor may see: public formats only, each with only its public modes.
export function publicFormats(formats = FORMATS) {
  return formats
    .filter((f) => f.public !== false)
    .map((f) => ({ ...f, modes: (f.modes ?? []).filter((m) => m.public !== false) }));
}

// Picker order: live, then testing, then planned; the list's own order breaks ties (Array.sort is stable).
export function pickerFormats(formats = FORMATS) {
  return publicFormats(formats).sort(byStatus);
}

// The live formats that have a section and a comparison column, in the list's order.
export function liveFormats(formats = FORMATS) {
  return publicFormats(formats).filter((f) => f.status === 'live');
}

// "Ways to play" appears only when a format has two or more public modes.
export function waysToPlay(format) {
  const modes = (format.modes ?? []).filter((m) => m.public !== false);
  return modes.length >= 2 ? modes : [];
}

// Every public format or mode that is not live yet, testing first, then planned.
export function onTheWay(formats = FORMATS) {
  const rows = [];
  for (const f of publicFormats(formats)) {
    if (f.status !== 'live') {
      rows.push({
        key: f.id,
        family: 'New format',
        name: f.name,
        status: f.status,
        icon: f.icon,
        text: f.nextText ?? f.description,
      });
    }
    for (const m of f.modes) {
      if (m.status === 'live') continue;
      rows.push({
        key: `${f.id}/${m.id}`,
        family: `${f.name} mode`,
        name: m.name,
        status: m.status,
        icon: f.icon,
        text: m.nextText ?? m.description,
      });
    }
  }
  return rows.sort(byStatus);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// "3 live · 1 mode in testing · 1 planned", worked out from the list so it never needs rewording. Empty parts drop.
export function countLine(formats = FORMATS) {
  const list = publicFormats(formats);
  const live = list.filter((f) => f.status === 'live').length;
  const testingFormats = list.filter((f) => f.status === 'testing').length;
  const testingModes = list.flatMap((f) => f.modes).filter((m) => m.status === 'testing').length;
  const planned =
    list.filter((f) => f.status === 'planned').length +
    list.flatMap((f) => f.modes).filter((m) => m.status === 'planned').length;
  return [
    live ? `${live} live` : '',
    testingFormats ? `${plural(testingFormats, 'format', 'formats')} in testing` : '',
    testingModes ? `${plural(testingModes, 'mode', 'modes')} in testing` : '',
    planned ? `${planned} planned` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

export function countWord(n) {
  return NUMBER_WORDS[n] ?? String(n);
}

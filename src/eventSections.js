// Which sections an event has, per format, and which one the current route is: the data core/eventBar.js draws.
// A composition file beside main.js and liveSurfaces.js, because it is the one place that knows both the route
// table and the formats; core never names either (module boundary). A route that is not one of an event's
// sections (a heat's timing, a match's scoring) still gets the trail, with its own leaf label and no section
// marked current.

const HOME = { key: 'home', label: 'Event home' };

// One entry per format: its sections (path is relative to /events/:eventId) and the leaf screens that are not
// sections, keyed by the route pattern. `patterns` maps a route pattern to a section key.
const FORMATS = {
  cup_taster: {
    sections: [
      HOME,
      { key: 'setup', label: 'Setup', path: '/setup' },
      { key: 'roster', label: 'Roster', path: '/roster' },
      { key: 'report', label: 'Report', path: '/report' },
    ],
    patterns: {
      '/events/:eventId': 'home',
      '/events/:eventId/setup': 'setup',
      '/events/:eventId/roster': 'roster',
      '/events/:eventId/report': 'report',
    },
    leaves: {
      '/events/:eventId/stages/:stageId/heats': 'Heats',
      '/events/:eventId/stages/:stageId/standings': 'Standings',
      '/events/:eventId/heats/:heatId/timing': 'Timing',
      '/events/:eventId/heats/:heatId/scoring': 'Scoring',
    },
  },
  btc: {
    sections: [
      HOME,
      { key: 'setup', label: 'Setup', path: '/btc/setup' },
      { key: 'matches', label: 'Matches', path: '/btc/matches' },
      { key: 'standings', label: 'Standings', path: '/btc/standings' },
      { key: 'bracket', label: 'Bracket', path: '/btc/bracket' },
      { key: 'sign-off', label: 'Sign-off', path: '/btc/sign-off' },
    ],
    patterns: {
      '/events/:eventId': 'home',
      '/events/:eventId/btc/setup': 'setup',
      '/events/:eventId/btc/matches': 'matches',
      '/events/:eventId/btc/standings': 'standings',
      '/events/:eventId/btc/bracket': 'bracket',
      '/events/:eventId/btc/sign-off': 'sign-off',
    },
    leaves: {
      '/events/:eventId/btc/matches/:matchId/scoring': 'Score match',
    },
  },
  throwdown: {
    sections: [HOME, { key: 'results', label: 'Results', path: '/throwdown/results' }],
    patterns: {
      '/events/:eventId': 'home',
      '/events/:eventId/throwdown/results': 'results',
    },
    leaves: {},
  },
};

/**
 * What the event bar shows for this event on this route, or null (a format with no sections, a route that is
 * not an event screen).
 * @returns {{ sections: {key: string, label: string, href: string}[], currentKey: string|null,
 *   currentLabel: string|null }|null}
 */
export function describeEventBar(event, pattern) {
  const format = FORMATS[event?.format];
  if (!format) return null;
  const sectionKey = format.patterns[pattern] ?? null;
  const leafLabel = format.leaves[pattern] ?? null;
  if (sectionKey === null && leafLabel === null) return null;
  const base = `#/events/${event.id}`;
  const sections = format.sections.map((s) => ({
    key: s.key,
    label: s.label,
    href: s.path ? `${base}${s.path}` : base,
  }));
  const current = sections.find((s) => s.key === sectionKey);
  return {
    sections,
    currentKey: sectionKey,
    // Event home is the trail's own end ("Events / <name>"); every other screen adds its name.
    currentLabel: sectionKey === 'home' ? null : (leafLabel ?? current?.label ?? null),
  };
}

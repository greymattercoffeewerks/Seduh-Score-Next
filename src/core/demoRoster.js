// Demo roster for a TEST event (client side of supabase/migrations/20261130100000_load_demo_roster.sql).
//
// Registering a cupper or a Throwdown competitor needs a unique phone number (Seduh ID), so trying the app out meant
// typing eight made-up numbers. One call puts eight demo people on the roster of a Cup Taster or Throwdown test event.
// It only ever adds (nothing is deleted) and can be repeated. The database refuses a real event, so this can never touch
// one, whatever a screen does; a screen only offers the card on a test event as a courtesy. A demo person gets a reserved
// fictional phone and no Seduh ID. Format-agnostic: both rosters share it.
import { getSupabase } from './supabaseClient.js';
import { describeError } from './errors.js';
import { el, setBusyDisabled } from './dom.js';

// Mirrors the database function (its name array): change one side, change the other. Only feeds the card's wording;
// what is shown after a load comes from the server's own reply.
export const DEMO_ROSTER_SIZE = 8;

// Resolves to { people, added, reinstated }.
export async function loadDemoRoster(orgId, eventId, client = getSupabase()) {
  const { data, error } = await client.rpc('load_demo_roster', {
    p_org_id: orgId,
    p_event_id: eventId,
  });
  if (error) throw error;
  return data;
}

// Keyed on the hint the database attaches to each refusal, never on wording. Anything else (the registration cap
// included) falls through to describeError.
const REFUSALS = {
  demo_not_test: 'Demo people load only into a test event. Open a test event and try again.',
  demo_roster_format:
    'Demo people are for Cup Taster and Throwdown events. BTC has its own demo data.',
  demo_event_not_found: 'We could not find this event. Reload the page.',
};

export function describeDemoRosterError(err) {
  return REFUSALS[err?.hint] ?? describeError(err);
}

export function describeDemoRosterLoaded({ added = 0, reinstated = 0 } = {}) {
  if (added === 0 && reinstated === 0) {
    return `The ${DEMO_ROSTER_SIZE} demo people are already on the roster.`;
  }
  const parts = [];
  if (added > 0) parts.push(`${added} added`);
  if (reinstated > 0) parts.push(`${reinstated} reinstated`);
  return `Demo people loaded: ${parts.join(', ')}.`;
}

// The card both rosters show on a test event. `idPrefix` keeps ids unique per screen; `noun` is what the screen calls
// its people ('cuppers', 'competitors'). The outcome is the screen's own to show (its feedback region).
export function renderDemoRosterCard({ idPrefix, noun, busy, onLoad }) {
  const button = el('button', {
    className: 'btn btn-outline tap-target',
    text: busy ? 'Loading…' : 'Add demo people',
    attrs: {
      type: 'button',
      'data-focus-key': `${idPrefix}-demo-roster`,
      'aria-describedby': `${idPrefix}-demo-intro`,
    },
  });
  setBusyDisabled(button, busy);
  button.addEventListener('click', onLoad);
  return el(
    'section',
    {
      className: 'card demo-roster-card',
      attrs: { 'aria-labelledby': `${idPrefix}-demo-heading` },
    },
    [
      el('h2', { text: 'Demo people', attrs: { id: `${idPrefix}-demo-heading` } }),
      el('p', {
        id: `${idPrefix}-demo-intro`,
        className: 'stage-meta',
        text: `Add ${DEMO_ROSTER_SIZE} made-up ${noun} with placeholder phone numbers, so you can try the app without typing any. Nothing is erased, and it can be repeated. They have no Seduh ID and never appear in public results.`,
      }),
      button,
    ],
  );
}

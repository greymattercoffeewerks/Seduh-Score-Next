// Demo data for a Cup Taster or Throwdown TEST event: client side of
// supabase/migrations/20261202100000_demo_data_cup_taster_throwdown.sql (which builds on the roster function of
// 20261130100000_load_demo_roster.sql).
//
// Like BTC's demo loader: one click loads eight made-up competitors AND a pre-arranged event (Cup Taster: a scored
// Prelims, four cuppers through to the Finals; Throwdown: a part-played bracket), and one click clears it. Loading
// erases what the test event held, so a screen asks first when there is something to lose. The database refuses a real
// event, so this can never touch one whatever a screen does; a screen only offers the card on a test event as a
// courtesy. Demo people get reserved fictional phones and no Seduh ID. Format-agnostic: each format's demo.js supplies its function names and wording.
import { getSupabase } from './supabaseClient.js';
import { describeError } from './errors.js';
import { el, setBusyDisabled } from './dom.js';

// One demo call. A format passes its own function name (see its demo.js); core knows no format.
export async function callDemo(rpcName, orgId, eventId, client = getSupabase()) {
  const { data, error } = await client.rpc(rpcName, { p_org_id: orgId, p_event_id: eventId });
  if (error) throw error;
  return data;
}

// Keyed on the hint the database attaches to each refusal, never on wording. The registration cap and anything else
// fall through to describeError.
const REFUSALS = {
  demo_not_test: 'Demo data loads only into a test event. Open a test event and try again.',
  demo_wrong_format: 'This demo belongs to a different format. Reload the page.',
  demo_event_not_found: 'We could not find this event. Reload the page.',
  demo_roster_failed: 'The demo people could not be added. Try again.',
};

export function describeDemoDataError(err) {
  return REFUSALS[err?.hint] ?? describeError(err);
}

export const DEMO_CLEARED = 'Demo cleared. The event is empty again.';

// The card both formats show on a test event. `idPrefix` keeps ids unique per screen. The outcome is the screen's own
// to show (its feedback region). `hasData` only changes the wording; the confirmation is the screen's.
export function renderDemoDataCard({ idPrefix, intro, busy, busyWith, hasData, onLoad, onClear }) {
  const load = el('button', {
    className: 'btn btn-outline tap-target',
    text: busy && busyWith !== 'clear' ? 'Loading…' : 'Load demo',
    attrs: {
      type: 'button',
      'data-focus-key': `${idPrefix}-demo-load`,
      'aria-describedby': `${idPrefix}-demo-intro`,
    },
  });
  const clear = el('button', {
    className: 'btn btn-outline tap-target',
    text: busy && busyWith === 'clear' ? 'Clearing…' : 'Clear demo',
    attrs: {
      type: 'button',
      'data-focus-key': `${idPrefix}-demo-clear`,
      'aria-describedby': `${idPrefix}-demo-intro`,
    },
  });
  setBusyDisabled(load, busy);
  setBusyDisabled(clear, busy || !hasData);
  load.addEventListener('click', onLoad);
  // aria-disabled does not stop a click, so an empty event ignores it here.
  clear.addEventListener('click', () => {
    if (hasData) onClear();
  });
  return el(
    'section',
    {
      className: 'card demo-roster-card',
      attrs: { 'aria-labelledby': `${idPrefix}-demo-heading` },
    },
    [
      el('h2', { text: 'Demo data', attrs: { id: `${idPrefix}-demo-heading` } }),
      el('p', {
        id: `${idPrefix}-demo-intro`,
        className: 'stage-meta',
        text: `${intro} They have no Seduh ID and never appear in public results. Loading replaces everything in this test event.`,
      }),
      el('div', { className: 'demo-data-actions' }, [load, clear]),
    ],
  );
}

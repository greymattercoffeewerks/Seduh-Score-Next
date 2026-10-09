// BTC demo data (client side of supabase/migrations/20261009120000_btc_load_demo.sql).
//
// One call loads a ready-made field into a TEST event — 8 teams, 5 judges, and (by default) all 28
// round-robin preliminary matches already scored — replacing whatever the event held, so a
// rehearsal or a presentation never means retyping names or scoring a round-robin by hand. Running it
// again starts over. The database refuses a real (non-test) event, so this can never wipe one,
// whatever the screen does; the screen only offers it on a test event as a courtesy.
import { getSupabase } from '../../core/supabaseClient.js';
import { describeError } from '../../core/errors.js';

// These mirror the database function, which derives the same numbers from its own team-name array
// and judge count (supabase/migrations/20261009120000_btc_load_demo.sql): change one side, change
// the other. This side only feeds the card's wording; the counts shown after a load come from the
// server's own reply, so they cannot be wrong.
export const DEMO_TEAM_COUNT = 8;
export const DEMO_JUDGE_COUNT = 5;
// Every pair once.
export const DEMO_MATCH_COUNT = (DEMO_TEAM_COUNT * (DEMO_TEAM_COUNT - 1)) / 2;

// The load writes a few hundred rows in one transaction, so it gets longer than the 10 s a plain
// read does; past this the screen stops waiting (the request is not cancelled) and says so.
export const DEMO_LOAD_TIMEOUT_MS = 20000;
export const DEMO_TIMEOUT_MESSAGE =
  'This is taking longer than expected. The demo may or may not have loaded. Reload the page to check.';
export const DEMO_REFRESH_FAILED_MESSAGE =
  'The demo loaded, but this page could not refresh. Retry to see it.';

// scored: true  -> roster + every preliminary match, scored (ready for "Generate bracket")
//         false -> roster only: the demo's teams and judges, no matches
// Resolves to the counts the database loaded: { teams, judges, matches }.
export async function loadDemo(orgId, eventId, { scored = true } = {}, client = getSupabase()) {
  const { data, error } = await client.rpc('load_btc_demo', {
    p_org_id: orgId,
    p_event_id: eventId,
    p_scored: scored,
  });
  if (error) throw error;
  return data;
}

// Keyed on the hint the database attaches to each refusal, never on message wording. Anything
// unrecognised falls through to describeError (a raw failure becomes the generic "try again").
const REFUSALS = {
  demo_not_test: 'Demo data can only be loaded into a test event.',
  demo_not_btc: 'Demo data is only available for BTC events.',
  demo_event_not_found: 'That event could not be found — reload the page.',
};

export function describeDemoError(err) {
  return REFUSALS[err?.hint] ?? describeError(err);
}

// What the screen tells the person once the load worked.
export function describeDemoLoaded({ teams, judges, matches }) {
  return matches > 0
    ? `Demo loaded: ${teams} teams, ${judges} judges and ${matches} scored preliminary matches. Generate the bracket when you are ready.`
    : `Demo roster loaded: ${teams} teams and ${judges} judges, no matches.`;
}

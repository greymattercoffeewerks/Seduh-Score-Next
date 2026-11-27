// Throwdown's demo wording and function names (the generic client and card are core/demoData.js).
import { callDemo } from '../../core/demoData.js';

export const DEMO_INTRO =
  'Load 8 made-up competitors with a bracket already part-played, so you can see the screens without typing anything.';
export const DEMO_WARNING =
  'Its competitors, draw, matches and votes will be erased. This cannot be undone.';

export const loadDemo = (orgId, eventId, client) =>
  callDemo('load_td_demo', orgId, eventId, client);
export const clearDemo = async (orgId, eventId, client) => {
  await callDemo('clear_td_demo', orgId, eventId, client);
};

// From the server's own reply: { competitors, decided, open }.
export function describeLoaded(reply = {}) {
  return `Demo loaded: ${reply.competitors ?? 8} competitors, ${reply.decided ?? 0} matches decided, ${reply.open ?? 0} open.`;
}

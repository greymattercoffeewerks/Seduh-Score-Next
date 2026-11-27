// Cup Taster's demo wording and function names (the generic client and card are core/demoData.js).
import { callDemo } from '../../core/demoData.js';

export const DEMO_INTRO =
  'Load 8 made-up cuppers with a scored Prelims and the top 4 in the Finals, so you can see the screens without typing anything.';
export const DEMO_WARNING =
  'Its cuppers, stages, heats and scores will be erased. This cannot be undone.';

export const loadDemo = (orgId, eventId, client) =>
  callDemo('load_ct_demo', orgId, eventId, client);
export const clearDemo = async (orgId, eventId, client) => {
  await callDemo('clear_ct_demo', orgId, eventId, client);
};

// From the server's own reply: { cuppers, stages, heats, scored_heats }.
export function describeLoaded(reply = {}) {
  return `Demo loaded: ${reply.cuppers ?? 8} cuppers, Prelims scored, the top 4 waiting in the Finals.`;
}

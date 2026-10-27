import { raceTimeout } from './timeout.js';

// PostgREST's two forms of “this database has no such RPC”: its schema-cache
// code, or PostgreSQL's undefined-function code. A caller decides whether an
// absent door is recoverable; this transport helper only keeps it distinct
// from a connection or server failure.
export function isDoorAbsent(error) {
  return error?.code === 'PGRST202' || error?.code === '42883' || error?.status === 404;
}

// Calls one narrow database door without deciding what its answer means.
// Keeping the response vocabulary outside core lets each caller retain its
// public contract, while transport failures can never be mistaken for an
// empty successful answer.
export async function callDoor(client, name, args, { timeoutMs } = {}) {
  let response;
  try {
    const request = client.rpc(name, args);
    response = timeoutMs === undefined ? await request : await raceTimeout(request, timeoutMs);
  } catch (error) {
    return { status: 'error', error };
  }
  if (response?.error) {
    return isDoorAbsent(response.error)
      ? { status: 'absent', error: response.error }
      : { status: 'error', error: response.error };
  }
  return { status: 'ok', data: response?.data };
}

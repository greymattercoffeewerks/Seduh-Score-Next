// How fresh the audience display is (Petrol "Figma review fixes"). Format-agnostic: core/viewer-shell.js owns the
// state and mounts this above whichever format's body is live, so Cup Taster, BTC and Throwdown get it with no edit.
//
// Why it exists: a venue's Wi-Fi drops, and a screen that keeps showing the last standings with a "Live" mark tells
// a room full of people something that is no longer true. So there are only two honest states while results are on
// screen:
//   fresh  quiet "Updated HH:MM": the last time this screen heard from the server;
//   lost   a clear "Connection lost — showing results from HH:MM" bar (a mark and words, never colour alone), shown
//          when the realtime channel drops OR the screen has not heard from the server for STALE_AFTER_MS.
// The shell hides the display's own Live marker while it is lost (viewer-shell.css), so "Live" is never unqualified
// during a known interruption.
//
// "Heard from the server" needs a signal even when nothing changes (a quiet room publishes nothing for minutes, and
// a silently dead socket looks identical), so the shell re-reads on a heartbeat. Three missed beats (90 s) is stale:
// one slow request is not an outage.
import { el } from './dom.js';
import { statusMark } from './vocabulary.js';

export const HEARTBEAT_MS = 30_000;
export const STALE_AFTER_MS = 90_000;

// "HH:MM", 24 hour, in the viewer's own time zone. null for anything that is not a real time.
export function formatClock(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Pure. What the freshness bar should say.
 * @param {{ now: number, active: boolean, channelLost: boolean, lastOkAt: number|null, publishedAt?: number|string|null }} input
 *   `active`: results are on screen (a live session with content). `lastOkAt`: when a read last succeeded (ms).
 *   `publishedAt`: the time of the results on screen (the session's snapshot time).
 * @returns {{ kind: 'hidden'|'fresh'|'lost', clock: string|null }}
 */
export function freshnessState({ now, active, channelLost, lastOkAt, publishedAt = null }) {
  if (!active) return { kind: 'hidden', clock: null };
  const silent = lastOkAt == null || now - lastOkAt > STALE_AFTER_MS;
  if (channelLost || silent) {
    // The time of the RESULTS on screen; the last good read when the session carries no time of its own.
    return { kind: 'lost', clock: formatClock(publishedAt ?? lastOkAt) };
  }
  return { kind: 'fresh', clock: formatClock(lastOkAt) };
}

export function freshnessText({ kind, clock }) {
  if (kind === 'lost') {
    return clock
      ? `Connection lost — showing results from ${clock}`
      : 'Connection lost — showing the last results received';
  }
  return clock ? `Updated ${clock}` : 'Updated';
}

// The bar for a state, or null when hidden. A lost bar is a role="alert" so a screen reader hears it appear; a fresh
// one is plain, because it changes every heartbeat and must never be announced.
export function renderFreshness(state) {
  if (state.kind === 'hidden') return null;
  const text = freshnessText(state);
  if (state.kind === 'lost') {
    // The mark is the shape (the attention bang) and its label is the sentence, so words and shape say it together.
    return el(
      'div',
      { className: 'viewer-freshness', attrs: { 'data-kind': 'lost', role: 'alert' } },
      [statusMark('attention', text, { className: 'viewer-freshness-mark' })],
    );
  }
  return el('div', { className: 'viewer-freshness', attrs: { 'data-kind': 'fresh' } }, [
    el('span', { className: 'viewer-freshness-text', text }),
  ]);
}

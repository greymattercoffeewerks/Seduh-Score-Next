import { describe, it, expect } from 'vitest';
import {
  freshnessState,
  freshnessText,
  formatClock,
  renderFreshness,
  STALE_AFTER_MS,
  HEARTBEAT_MS,
} from './freshness.js';

const at = (hhmm) => new Date(`2026-11-24T${hhmm}:00`).getTime();

describe('freshnessState', () => {
  const base = { now: at('14:30'), active: true, channelLost: false, lastOkAt: at('14:30') };

  it('is hidden when no results are on screen, whatever else is true', () => {
    expect(freshnessState({ ...base, active: false, channelLost: true }).kind).toBe('hidden');
  });
  it('is fresh while the server was heard from recently, naming that time', () => {
    expect(freshnessState({ ...base, lastOkAt: at('14:29') })).toEqual({
      kind: 'fresh',
      clock: '14:29',
    });
  });
  it('is lost when the channel is lost, naming the time of the results on screen', () => {
    expect(freshnessState({ ...base, channelLost: true, publishedAt: at('14:12') })).toEqual({
      kind: 'lost',
      clock: '14:12',
    });
  });
  it('falls back to the last good read when the session carries no time of its own', () => {
    expect(freshnessState({ ...base, channelLost: true }).clock).toBe('14:30');
  });
  it('is lost on silence alone, just past the stale threshold and not before', () => {
    const lastOkAt = base.now - STALE_AFTER_MS;
    expect(freshnessState({ ...base, lastOkAt }).kind).toBe('fresh');
    expect(freshnessState({ ...base, lastOkAt: lastOkAt - 1 }).kind).toBe('lost');
  });
  it('is lost when nothing has ever been read', () => {
    expect(freshnessState({ ...base, lastOkAt: null }).kind).toBe('lost');
  });
  it('needs three missed heartbeats, so one slow request is not an outage', () => {
    expect(STALE_AFTER_MS).toBe(3 * HEARTBEAT_MS);
    expect(STALE_AFTER_MS).toBe(90_000);
  });
});

describe('formatClock and freshnessText', () => {
  it('is 24-hour HH:MM, and null for a non-time', () => {
    expect(formatClock(at('09:05'))).toBe('09:05');
    expect(formatClock('nonsense')).toBeNull();
  });
  it('words', () => {
    expect(freshnessText({ kind: 'fresh', clock: '09:05' })).toBe('Updated 09:05');
    expect(freshnessText({ kind: 'lost', clock: '09:05' })).toBe(
      'Connection lost — showing results from 09:05',
    );
    expect(freshnessText({ kind: 'lost', clock: null })).toContain('Connection lost');
  });
});

describe('renderFreshness', () => {
  it('renders nothing when hidden', () => {
    expect(renderFreshness({ kind: 'hidden', clock: null })).toBeNull();
  });
  it('a lost bar carries a shape (the attention mark) and the words, and is an alert', () => {
    const node = renderFreshness({ kind: 'lost', clock: '14:12' });
    expect(node.getAttribute('role')).toBe('alert');
    const mark = node.querySelector('.status[data-state="attention"]');
    expect(mark.textContent).toBe('Connection lost — showing results from 14:12');
  });
  it('a fresh bar is plain text, never a live region', () => {
    const node = renderFreshness({ kind: 'fresh', clock: '14:30' });
    expect(node.getAttribute('role')).toBeNull();
    expect(node.querySelector('[aria-live]')).toBeNull();
    expect(node.textContent).toBe('Updated 14:30');
  });
});

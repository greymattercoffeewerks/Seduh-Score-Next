import { describe, it, expect } from 'vitest';
import { findLiveNow, liveAudienceHref, liveNowRow } from './publicLiveNow.js';

const door = (rows, error = null) => ({
  calls: [],
  rpc(name, args) {
    this.calls.push([name, args]);
    return Promise.resolve({ data: rows, error });
  },
});
const row = (over = {}) => ({
  kind: 'live',
  event_name: 'Cup Night',
  org_name: 'Alpha Coffee',
  org_slug: 'alpha-coffee',
  format: 'cup_taster',
  last_activity_at: '2026-10-29T10:00:00Z',
  listed_count: 1,
  ...over,
});

describe('liveAudienceHref', () => {
  it('links the phone view by organiser slug', () => {
    expect(liveAudienceHref('alpha-coffee')).toBe('/app/#/live/alpha-coffee/phone');
  });
  it.each(['', 'Alpha', 'a b', '../x', 'a--b', '-a', 'javascript:alert(1)', null, 42])(
    'refuses %j',
    (slug) => expect(liveAudienceHref(slug)).toBeNull(),
  );
});

describe('liveNowRow', () => {
  it('keeps only typed live rows', () => {
    expect(liveNowRow(row({ kind: 'registration' }))).toBeNull();
    expect(liveNowRow(row({ kind: undefined }))).toBeNull();
    expect(liveNowRow(row())).toMatchObject({
      kind: 'live',
      eventName: 'Cup Night',
      orgName: 'Alpha Coffee',
    });
  });
  it('cleans names: markup stays text, controls and bidi go, length is capped', () => {
    const r = liveNowRow(
      row({ event_name: '‮<img src=x onerror=1>\n  Night', org_name: 'x'.repeat(200) }),
    );
    expect(r.eventName).toBe('<img src=x onerror=1> Night');
    expect([...r.orgName]).toHaveLength(60);
    expect(r.orgName.endsWith('…')).toBe(true);
  });
  it('drops a row with no usable name or slug, and leaves out a blank organiser', () => {
    expect(liveNowRow(row({ event_name: '   ' }))).toBeNull();
    expect(liveNowRow(row({ org_slug: 'Bad Slug' }))).toBeNull();
    expect(liveNowRow(row({ org_name: ' ' })).orgName).toBeNull();
  });
});

describe('findLiveNow', () => {
  it('asks the one door, once', async () => {
    const client = door([row()]);
    await findLiveNow(client);
    expect(client.calls).toEqual([['public_live_now', {}]]);
  });
  it('returns rows and the true total', async () => {
    const out = await findLiveNow(
      door([row({ listed_count: 5 }), row({ listed_count: 5, org_slug: 'b-co' })]),
    );
    expect(out.rows).toHaveLength(2);
    expect(out.total).toBe(5);
  });
  it('is empty when nothing is live or every row is unusable', async () => {
    expect(await findLiveNow(door([]))).toEqual({ rows: [], total: 0 });
    expect(await findLiveNow(door([row({ kind: 'x' })]))).toEqual({ rows: [], total: 0 });
  });
  it('rejects on a failed or malformed answer (the page swallows it)', async () => {
    await expect(findLiveNow(door(null, { message: 'boom' }))).rejects.toBeTruthy();
    await expect(findLiveNow(door({ not: 'a list' }))).rejects.toThrow();
  });
});

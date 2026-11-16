import { describe, expect, it, vi } from 'vitest';
import {
  CLAIM_LINK_WARNING,
  CLAIM_STATE_TEXT,
  CLAIM_STATES,
  STATUS_CHUNK,
  claimLinkUrl,
  describeClaimError,
  fetchClaimStatuses,
  issueClaimLink,
  normaliseStatus,
  revokeClaimLink,
  whatsappShareUrl,
} from './seduhClaim.js';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO_-';

describe('normaliseStatus', () => {
  it('keeps the five states and only what each carries', () => {
    expect(
      normaliseStatus({ state: 'can_issue', expires_at: '2026-11-20T10:00:00Z', handle: 'x1' }),
    ).toEqual({ state: 'can_issue', expiresAt: expect.any(Date), handle: null });
    expect(normaliseStatus({ state: 'claimed', handle: 'aisha' })).toEqual({
      state: 'claimed',
      expiresAt: null,
      handle: 'aisha',
    });
    expect(
      normaliseStatus({
        state: 'link_open',
        expires_at: '2026-11-20T10:00:00Z',
      }).expiresAt.toISOString(),
    ).toBe('2026-11-20T10:00:00.000Z');
    expect(CLAIM_STATES).toHaveLength(5);
  });
  it('treats an unknown state as the cautious one (no controls) and drops a handle that is not a handle', () => {
    expect(normaliseStatus({ state: 'surprise' }).state).toBe('unavailable');
    expect(normaliseStatus(null).state).toBe('unavailable');
    expect(normaliseStatus({ state: 'claimed', handle: '<script>' }).handle).toBeNull();
    expect(normaliseStatus({ state: 'claimed', handle: 'x'.repeat(31) }).handle).toBeNull();
    expect(normaliseStatus({ state: 'link_open', expires_at: 'not a date' }).expiresAt).toBeNull();
  });
  it('has a sentence for every state', () => {
    for (const state of CLAIM_STATES) expect(CLAIM_STATE_TEXT[state], state).toMatch(/\w/);
    expect(CLAIM_STATE_TEXT.no_identity).toMatch(/published and reviewed/);
  });
});

describe('fetchClaimStatuses', () => {
  it('asks in chunks of at most 500 and maps person id to status', async () => {
    const ids = Array.from({ length: STATUS_CHUNK + 5 }, (_, i) => `p${i}`);
    const rpc = vi.fn(async (_name, args) => ({
      data: args.p_person_ids.map((id) => ({
        person_id: id,
        state: 'can_issue',
        expires_at: null,
        handle: null,
      })),
      error: null,
    }));
    const map = await fetchClaimStatuses('org1', ids, { rpc });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1].p_person_ids).toHaveLength(STATUS_CHUNK);
    expect(rpc.mock.calls[0][0]).toBe('seduh_claim_statuses');
    expect(rpc.mock.calls[0][1].p_org_id).toBe('org1');
    expect(map.size).toBe(ids.length);
    expect(map.get('p3').state).toBe('can_issue');
  });
  it('asks nothing for nobody', async () => {
    const rpc = vi.fn();
    expect((await fetchClaimStatuses('org1', [], { rpc })).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('throws on an error rather than guessing', async () => {
    await expect(
      fetchClaimStatuses('o', ['p'], {
        rpc: async () => ({ data: null, error: { code: '42501' } }),
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('issue and revoke', () => {
  it('returns the token only when it has the right shape', async () => {
    const rpc = vi.fn(async () => ({ data: TOKEN, error: null }));
    expect(await issueClaimLink('p1', { rpc })).toBe(TOKEN);
    expect(rpc).toHaveBeenCalledWith('issue_seduh_claim_link', { p_person_id: 'p1' });
    await expect(
      issueClaimLink('p1', { rpc: async () => ({ data: 'short', error: null }) }),
    ).rejects.toThrow();
    await expect(
      issueClaimLink('p1', { rpc: async () => ({ data: null, error: null }) }),
    ).rejects.toThrow();
    await expect(
      issueClaimLink('p1', {
        rpc: async () => ({ data: null, error: { hint: 'identity_claimed' } }),
      }),
    ).rejects.toMatchObject({ hint: 'identity_claimed' });
  });
  it('revokes by person', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    await revokeClaimLink('p1', { rpc });
    expect(rpc).toHaveBeenCalledWith('revoke_seduh_claim_link', { p_person_id: 'p1' });
    await expect(
      revokeClaimLink('p1', { rpc: async () => ({ error: { hint: 'no_open_link' } }) }),
    ).rejects.toMatchObject({ hint: 'no_open_link' });
  });
});

describe('the link and the share', () => {
  it('puts the token after the # so no server ever sees it', () => {
    const url = claimLinkUrl(TOKEN, 'https://www.seduhscore.com');
    expect(url).toBe(`https://www.seduhscore.com/id/claim/#${TOKEN}`);
    expect(new URL(url).search).toBe('');
    expect(new URL(url).pathname).toBe('/id/claim/');
  });
  it('shares to WhatsApp with the link in the text, encoded', () => {
    const share = whatsappShareUrl('https://x.test/id/claim/#abc', 'Aisha');
    expect(share.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(share.split('text=')[1])).toBe(
      'Hi Aisha, here is your link to claim your Seduh ID: https://x.test/id/claim/#abc',
    );
    expect(decodeURIComponent(whatsappShareUrl('u', '').split('text=')[1])).toBe(
      'here is your link to claim your Seduh ID: u',
    );
  });
  it('warns: once, one person, whoever holds it, send only to that person', () => {
    expect(CLAIM_LINK_WARNING).toMatch(/once/);
    expect(CLAIM_LINK_WARNING).toMatch(/one person/);
    expect(CLAIM_LINK_WARNING).toMatch(/whoever holds it/);
    expect(CLAIM_LINK_WARNING).toMatch(/only to that person/);
    expect(CLAIM_LINK_WARNING).toMatch(/72 hours/);
  });
});

describe('describeClaimError', () => {
  it('has words for each database hint and for a refusal', () => {
    for (const hint of [
      'no_identity',
      'identity_unavailable',
      'identity_claimed',
      'no_open_link',
      'bad_input',
    ]) {
      expect(describeClaimError({ code: 'P0001', hint })).not.toMatch(/_|P0001/);
    }
    expect(describeClaimError({ code: '42501' })).toMatch(/cannot do that/);
    expect(
      new Set(
        ['no_identity', 'identity_claimed', 'no_open_link'].map((hint) =>
          describeClaimError({ hint }),
        ),
      ).size,
    ).toBe(3);
  });
  it('is generic for an unknown error and never shows raw text', () => {
    expect(describeClaimError({ message: 'secret sql detail' })).toBe(
      'Something went wrong. Check your connection and try again.',
    );
    expect(describeClaimError(null)).toMatch(/Something went wrong/);
  });
});

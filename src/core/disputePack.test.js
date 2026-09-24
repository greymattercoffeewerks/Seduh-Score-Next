import { describe, expect, it, vi } from 'vitest';
import { getDisputePack } from './disputePack.js';

describe('getDisputePack', () => {
  it('calls get_dispute_pack with the org and event ids and returns the pack untouched', async () => {
    const pack = {
      pack_version: 1,
      event: { name: 'X' },
      cup_taster: { results: [{ correct: true }] },
    };
    const client = { rpc: vi.fn().mockResolvedValue({ data: pack, error: null }) };

    const result = await getDisputePack('org1', 'ev1', client);

    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith('get_dispute_pack', {
      p_org_id: 'org1',
      p_event_id: 'ev1',
    });
    expect(result).toBe(pack);
  });

  it('throws the server error rather than returning anything (a refusal is never a blank file)', async () => {
    const boom = new Error('get_dispute_pack: event ev1 not found');
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: boom }) };

    await expect(getDisputePack('org1', 'ev1', client)).rejects.toBe(boom);
  });

  it('refuses an empty answer instead of handing the organiser a blank record', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };

    await expect(getDisputePack('org1', 'ev1', client)).rejects.toThrow('returned no data');
  });
});

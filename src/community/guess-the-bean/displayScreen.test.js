import { describe, expect, it, vi } from 'vitest';
import { computeWinner, countdownValues, mountDisplayScreen } from './displayScreen.js';

describe('display reveal invariants', () => {
  it('awards an equal-distance tie to the earliest arrival', () => {
    const first = { id: 'first', name: 'Aiman', guess: 420, created_at: '2026-01-01T00:00:00Z' };
    const later = { id: 'later', name: 'Sarah', guess: 436, created_at: '2026-01-01T00:00:01Z' };
    expect(computeWinner([first, later], 428)).toBe(first);
  });

  it('exposes every countdown digit in order, including the final transition', () => {
    expect(countdownValues()).toEqual([3, 2, 1, 0]);
  });
});

function displayClient({ guesses = [] } = {}) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            order: () =>
              Promise.resolve({
                data: guesses.map(({ id, name, created_at }) => ({ id, name, created_at })),
                error: null,
              }),
          }),
        }),
      }),
    }),
    rpc: vi.fn((name) => {
      if (name === 'session_display_guesses')
        return Promise.resolve({ data: guesses, error: null });
      if (name === 'session_bean_count') return Promise.resolve({ data: 428, error: null });
      return Promise.resolve({ data: null, error: null });
    }),
  };
}

describe('mountDisplayScreen', () => {
  const context = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    setTransform: vi.fn(),
  };

  function mockCanvas() {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  }

  it('uses persisted portrait orientation and the compact QR layout', async () => {
    mockCanvas();
    const client = displayClient();
    client.from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { id: 's1', guess_enabled: true, revealed: false, orientation: 'portrait' },
              error: null,
            }),
          order: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
        }),
      }),
    });
    const root = document.createElement('div');
    const handle = await mountDisplayScreen(root, {
      client,
      search: '?session=s1',
      origin: 'https://example.test',
    });
    expect(root.querySelector('.gtb-display').dataset.orientation).toBe('portrait');
    expect(root.querySelector('.gtb-display-qr svg')).not.toBeNull();
    handle.unmount();
  });

  it('recomputes the winner when a later poll introduces a closer revealed guess', async () => {
    vi.useFakeTimers();
    try {
      mockCanvas();
      const rows = [{ id: 'old', name: 'Old', guess: 450, created_at: '1' }];
      const client = displayClient({ guesses: rows });
      client.from = () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { id: 's1', guess_enabled: true, revealed: true, orientation: 'landscape' },
                error: null,
              }),
            order: () => ({
              order: () =>
                Promise.resolve({
                  data: rows.map(({ id, name, created_at }) => ({ id, name, created_at })),
                  error: null,
                }),
            }),
          }),
        }),
      });
      client.rpc.mockImplementation((name) =>
        name === 'session_display_guesses'
          ? Promise.resolve({ data: rows, error: null })
          : Promise.resolve({ data: 428, error: null }),
      );
      const root = document.createElement('div');
      const handle = await mountDisplayScreen(root, { client, search: '?session=s1' });
      expect(root.textContent).toContain('Old');
      rows.push({ id: 'new', name: 'New winner', guess: 428, created_at: '2' });
      await vi.advanceTimersByTimeAsync(4000);
      expect(root.querySelector('.gtb-display-winner').textContent).toContain('New winner');
      handle.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

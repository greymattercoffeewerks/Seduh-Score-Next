import { describe, it, expect, vi, afterEach } from 'vitest';

const findHeatById = vi.fn();
const mountTimingScreen = vi.fn();
const mountManualTimingScreen = vi.fn();

vi.mock('./heats.js', () => ({ findHeatById: (...args) => findHeatById(...args) }));
vi.mock('./timingScreen.js', () => ({
  mountTimingScreen: (...args) => mountTimingScreen(...args),
}));
vi.mock('./timingManualScreen.js', () => ({
  mountManualTimingScreen: (...args) => mountManualTimingScreen(...args),
}));

const { mountTimingRouteScreen } = await import('./timingRouteScreen.js');

afterEach(() => {
  vi.clearAllMocks();
});

describe('mountTimingRouteScreen', () => {
  it('mounts the app-mode timing screen for a heat with no manual timing_mode', async () => {
    findHeatById.mockResolvedValue({ id: 'h1', timing_mode: 'app' });
    const unmountSpy = vi.fn();
    mountTimingScreen.mockResolvedValue({ unmount: unmountSpy });
    const root = document.createElement('div');
    const client = {};

    await mountTimingRouteScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    expect(mountTimingScreen).toHaveBeenCalledWith(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(mountManualTimingScreen).not.toHaveBeenCalled();
  });

  it('mounts the manual timing screen for a heat with timing_mode "manual"', async () => {
    findHeatById.mockResolvedValue({ id: 'h1', timing_mode: 'manual' });
    mountManualTimingScreen.mockResolvedValue({ unmount: vi.fn() });
    const root = document.createElement('div');
    const client = {};

    await mountTimingRouteScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    expect(mountManualTimingScreen).toHaveBeenCalledWith(root, {
      eventId: 'ev1',
      heatId: 'h1',
      client,
    });
    expect(mountTimingScreen).not.toHaveBeenCalled();
  });

  it('delegates unmount() to whichever inner screen it mounted', async () => {
    findHeatById.mockResolvedValue({ id: 'h1', timing_mode: 'app' });
    const unmountSpy = vi.fn();
    mountTimingScreen.mockResolvedValue({ unmount: unmountSpy });
    const root = document.createElement('div');

    const handle = await mountTimingRouteScreen(root, { eventId: 'ev1', heatId: 'h1', client: {} });
    await handle.unmount();

    expect(unmountSpy).toHaveBeenCalledTimes(1);
  });

  it('renders a Retry-capable error state when the heat lookup fails, without mounting either inner screen', async () => {
    findHeatById.mockRejectedValueOnce(new Error('network down'));
    const root = document.createElement('div');
    document.body.appendChild(root);

    await mountTimingRouteScreen(root, { eventId: 'ev1', heatId: 'h1', client: {} });

    expect(root.querySelector('.screen-feedback').dataset.tone).toBe('error');
    expect(root.querySelector('button').textContent).toBe('Retry');
    expect(mountTimingScreen).not.toHaveBeenCalled();
    expect(mountManualTimingScreen).not.toHaveBeenCalled();
  });

  it('Retry re-attempts the lookup and mounts the correct screen on success', async () => {
    findHeatById.mockRejectedValueOnce(new Error('network down'));
    findHeatById.mockResolvedValueOnce({ id: 'h1', timing_mode: 'app' });
    mountTimingScreen.mockResolvedValue({ unmount: vi.fn() });
    const root = document.createElement('div');
    document.body.appendChild(root);

    await mountTimingRouteScreen(root, { eventId: 'ev1', heatId: 'h1', client: {} });
    root.querySelector('button').dispatchEvent(new Event('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mountTimingScreen).toHaveBeenCalledTimes(1);
  });

  it('two rapid Retry clicks after a failed lookup mount only one inner screen, not two', async () => {
    // A controllable delay, not an instantly-resolving mock — without the
    // re-entrancy guard, both attemptLoad() calls would still be
    // in-flight when the second click fires, each independently mounting
    // its own timing screen into the same root. Regression test for a
    // real gap found in review: mountTimingRouteScreen had no `loading`
    // guard, unlike eventsScreen.js's/eventDashboardScreen.js's own
    // established Retry pattern.
    findHeatById.mockRejectedValueOnce(new Error('network down'));
    let resolveHeat;
    findHeatById.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHeat = () => resolve({ id: 'h1', timing_mode: 'app' });
      }),
    );
    mountTimingScreen.mockResolvedValue({ unmount: vi.fn() });
    const root = document.createElement('div');
    document.body.appendChild(root);

    await mountTimingRouteScreen(root, { eventId: 'ev1', heatId: 'h1', client: {} });
    const retryButton = root.querySelector('button');
    retryButton.dispatchEvent(new Event('click', { bubbles: true }));
    retryButton.dispatchEvent(new Event('click', { bubbles: true }));
    resolveHeat();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mountTimingScreen).toHaveBeenCalledTimes(1);
  });

  it('resolves to an object with a callable unmount() even when the inner screen never mounted', async () => {
    findHeatById.mockRejectedValueOnce(new Error('network down'));
    const root = document.createElement('div');
    document.body.appendChild(root);

    const handle = await mountTimingRouteScreen(root, { eventId: 'ev1', heatId: 'h1', client: {} });
    expect(typeof handle.unmount).toBe('function');
    expect(() => handle.unmount()).not.toThrow();
  });
});

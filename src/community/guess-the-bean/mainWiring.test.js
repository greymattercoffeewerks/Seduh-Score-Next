// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// main.js runs on import. The two screens are stubbed so this tests only its wiring: the shared community frame
// stays around whatever screen is mounted, a repeated SIGNED_IN mounts setup once, and a setup failure writes its
// message into the host, never over the whole page.
const auth = { onSignedIn: null, unmount: vi.fn() };
const mountSetupScreen = vi.fn();
vi.mock('./authScreen.js', () => ({
  mountAuthScreen: vi.fn(async (_root, options) => {
    auth.onSignedIn = options.onSignedIn;
    return { unmount: auth.unmount };
  }),
}));
vi.mock('./setupScreen.js', () => ({ mountSetupScreen: (...args) => mountSetupScreen(...args) }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Guess the Bean organiser page wiring', () => {
  beforeEach(async () => {
    vi.resetModules();
    auth.unmount.mockClear();
    mountSetupScreen.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    document.body.innerHTML = '<div id="app"></div>';
    await import('./main.js');
    await flush();
  });

  it('mounts the screens into a host between the shared header and the tools strip', () => {
    const kids = [...document.getElementById('app').children].map((n) => n.className);
    expect(kids).toEqual(['ct-top', 'gtb-host', 'ct-bottom']);
    expect(document.querySelector('.ct-crumb-current').textContent).toBe('Guess the Bean');
  });

  it('mounts setup once however many times SIGNED_IN fires, and unmounts the auth screen', async () => {
    mountSetupScreen.mockResolvedValue({ unmount() {} });
    auth.onSignedIn();
    auth.onSignedIn();
    await flush();
    expect(mountSetupScreen).toHaveBeenCalledTimes(1);
    expect(mountSetupScreen.mock.calls[0][0].className).toBe('gtb-host');
    expect(auth.unmount).toHaveBeenCalledTimes(1);
  });

  it('shows a failed setup load in the host and keeps the frame', async () => {
    mountSetupScreen.mockRejectedValue(new Error('boom'));
    auth.onSignedIn();
    await flush();
    expect(document.querySelector('.gtb-host').textContent).toContain('Something went wrong');
    expect(document.querySelector('.ct-header')).not.toBeNull();
    expect(document.querySelector('.ct-strip')).not.toBeNull();
  });
});

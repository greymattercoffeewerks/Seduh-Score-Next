import { describe, it, expect, vi, afterEach } from 'vitest';

// A sync refresh that is mid-read when the shell is unmounted must not paint afterwards. In the suite it
// painted into a torn-down jsdom ("document is not defined" at setChip, reported against whichever test file
// ran last). The outbox is mocked so the read can be held open (see appShell.orgSelect.test.js for why).
let releaseRead;
vi.mock('./outbox.js', () => ({
  listPendingOperations: () => Promise.resolve([]),
  listOtherOperations: () => Promise.resolve({ otherOrg: [], otherAccount: [] }),
  listAccountOperations: () => Promise.resolve([]),
  payloadOrgId: () => null,
  partitionOperations: () =>
    new Promise((resolve) => {
      releaseRead = () => resolve({ own: [], otherOrg: [], otherAccount: [] });
    }),
  getOutboxOwner: () => undefined,
  isFlushInProgress: () => false,
  onOperationDropped: () => () => {},
}));

const { mountAppShell } = await import('./appShell.js');

afterEach(() => vi.restoreAllMocks());

describe('unmounting the shell while a sync refresh is reading the outbox', () => {
  it('paints nothing when the read finishes afterwards', async () => {
    const root = document.createElement('div');
    const shell = mountAppShell(root, {
      client: {
        auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
        from: () => ({}),
      },
    });
    shell.clearEventContext(); // starts a refresh, held at the outbox read
    expect(releaseRead).toBeTypeOf('function');
    shell.unmount();
    // The idle chip reads document.activeElement; that read is what ran against a dead document.
    const touched = vi.spyOn(document, 'activeElement', 'get');
    releaseRead();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(touched).not.toHaveBeenCalled();
  });
});

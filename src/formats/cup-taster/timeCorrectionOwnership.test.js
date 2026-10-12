import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isStillQueued, loadPendingWork } from './timeCorrection.js';
import { enqueueOperation, setOutboxOwner, _resetOutboxOwnerForTests } from '../../core/outbox.js';
import { _clearAllForTests } from '../../core/db.js';

// T-TEN.C6: the outbox is shared by every account on the device. "Is my write still waiting?" is a
// question about the write itself, not about who is signed in right now: a correction that is safely
// queued must never read as dropped just because the owner changed (a second tab signed out, the
// organisation changed) before the screen looked.
describe('queued-correction checks do not depend on who is signed in (T-TEN.C6)', () => {
  beforeEach(async () => {
    await _clearAllForTests();
    _resetOutboxOwnerForTests();
  });
  afterEach(() => {
    _resetOutboxOwnerForTests();
  });

  it('isStillQueued still finds an operation after the owner changed', async () => {
    setOutboxOwner({ userId: 'alice', orgId: 'org1' });
    const { id } = await enqueueOperation('correct_heat_time', {
      p_org_id: 'org1',
      p_heat_entry_id: 'he1',
    });
    setOutboxOwner({ userId: 'bob', orgId: 'org1' });
    expect(await isStillQueued({ operationId: id })).toBe(true);
    setOutboxOwner(null);
    expect(await isStillQueued({ operationId: id })).toBe(true);
  });

  it('isStillQueued says no for an operation that is not in the queue at all', async () => {
    setOutboxOwner({ userId: 'alice', orgId: 'org1' });
    expect(await isStillQueued({ operationId: 'nothing-here' })).toBe(false);
  });

  it('loadPendingWork still shows a queued correction and a queued confirm after the owner changed', async () => {
    setOutboxOwner({ userId: 'alice', orgId: 'org1' });
    await enqueueOperation('correct_heat_time', { p_org_id: 'org1', p_heat_entry_id: 'he1' });
    await enqueueOperation('confirm_heat', { p_org_id: 'org1', p_heat_id: 'heat-9' });
    setOutboxOwner({ userId: 'bob', orgId: 'org1' });
    const work = await loadPendingWork('heat-9');
    expect([...work.queuedEntryIds]).toEqual(['he1']);
    expect(work.confirmQueued).toBe(true);
  });
});

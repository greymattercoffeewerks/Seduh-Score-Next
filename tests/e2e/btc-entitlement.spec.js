import { test, expect } from '@playwright/test';
import { createTenant } from './support/tenants.js';
import { setKeyEnforced, withKeyEnforced } from './support/grants.js';

// btc_format switched ON locally (T-GATE.B4, D-G): any organisation may CREATE a BTC event, and going live needs the
// entitlement, checked at the first go-live by the database. The plan comes from createTenant's `grant` (a real
// platform-admin session calling admin_grant_create, support/grants.js) and the key is switched with the audited
// admin_set_key_enforced; nothing here writes the grant or key tables directly.
//
// Runs in its own project, last and alone (playwright.config.js): while the key is on, any other spec that takes a
// BTC event live for an un-granted organisation would be refused. The key is put back OFF in `finally` and again in
// afterAll, and forced off before the test in case an earlier run was killed with it on.

test.describe('btc_format enforced, locally (real admin session, real database)', () => {
  test.describe.configure({ mode: 'serial' });

  const uniq = Date.now().toString(36);
  const tenants = [];

  test.beforeAll(async () => {
    test.setTimeout(90000);
    await setKeyEnforced('btc_format', false);
  });

  test.afterAll(async () => {
    test.setTimeout(90000);
    for (const tenant of tenants) await tenant.cleanUp();
    await setKeyEnforced('btc_format', false);
  });

  test('a granted organisation creates a BTC event and takes it live; an un-granted one is refused at go-live', async () => {
    test.setTimeout(120000);
    let refusedOrg;
    let dormantId;

    await withKeyEnforced('btc_format', async () => {
      // the default createTenant: an Annual grant given through admin_grant_create, then a BTC event taken live
      const granted = await createTenant({
        label: 'btc-granted',
        format: 'btc',
        payload: { kind: 'btc' },
        eventName: `BTC granted ${uniq}`,
      });
      tenants.push(granted);
      expect(granted.grantId).toMatch(/^[0-9a-f-]{36}$/);
      expect(granted.liveId).toBeTruthy();

      // no plan: creating the BTC event is allowed (D-G: the check moved to the first go-live) ...
      refusedOrg = await createTenant({
        label: 'btc-community',
        grant: false,
        live: false,
      });
      tenants.push(refusedOrg);
      expect(refusedOrg.grantId).toBeNull();
      const event = await refusedOrg.createEvent({ format: 'btc', name: `BTC community ${uniq}` });
      expect(event.id).toBeTruthy();

      // ... and going live is refused by the database with the stable hint
      const refusal = await refusedOrg
        .goLive({ eventId: event.id, format: 'btc', payload: { kind: 'btc' } })
        .then(
          () => null,
          (error) => error.message,
        );
      expect(refusal, 'the go-live of an un-granted BTC event must be refused').not.toBeNull();
      expect(refusal).toContain('403');
      expect(refusal).toContain('42501');
      expect(refusal).toContain('entitlement_required');
      expect(refusal).toContain('btc_format');

      // the UPDATE path of the same check: a session made inactive can not be switched on either
      const dormant = await refusedOrg.goLive({
        eventId: event.id,
        format: 'btc',
        payload: { kind: 'btc' },
        active: false,
      });
      dormantId = dormant.id;
      const activation = await refusedOrg.activate(dormant.id).then(
        () => null,
        (error) => error.message,
      );
      expect(activation, 'activating an un-granted BTC session must be refused').toContain(
        'entitlement_required',
      );
    });

    // the key is OFF again, and the very same organisation and session now go live: the refusal came from the key
    await refusedOrg.activate(dormantId);
  });
});

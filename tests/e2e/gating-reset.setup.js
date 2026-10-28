import { test } from '@playwright/test';
import { setKeyEnforced } from './support/grants.js';

// A run killed while btc-entitlement.spec.js had btc_format on would leave it on, and the Plan panel spec (which
// requires every key to read Off) would then fail for a reason that points elsewhere. This puts the key back off
// before the admin specs; the spec resets it itself too.
test('btc_format is off before the specs that need a fresh stack', async () => {
  test.setTimeout(60000);
  await setKeyEnforced('btc_format', false);
});

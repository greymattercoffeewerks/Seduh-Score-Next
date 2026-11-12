import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';

// A feedback part (core/feedback.js) a test opened and never answered is attached to document.body, outside the
// test's own root, so it would otherwise be found by the NEXT test's lookup. Tests that run in a node environment have
// no document.
afterEach(() => {
  if (typeof document === 'undefined') return;
  for (const node of document.querySelectorAll('dialog.dialog, .confirm-panel, .toast-region')) {
    node.remove();
  }
});

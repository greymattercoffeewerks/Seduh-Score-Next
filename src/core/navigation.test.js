import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { goToHash, replaceHash } from './navigation.js';

let hashChanges;
const onChange = () => {
  hashChanges += 1;
};

async function settle() {
  // jsdom queues its own hashchange for a real hash change.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  location.hash = '';
  await settle();
  hashChanges = 0;
  window.addEventListener('hashchange', onChange);
});

afterEach(async () => {
  window.removeEventListener('hashchange', onChange);
  location.hash = '';
  await settle();
});

describe('goToHash', () => {
  it('moves to a different hash and lets the browser announce it (no extra synthetic event)', async () => {
    location.hash = '#/events/ev1/setup';
    await settle();
    hashChanges = 0;
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    goToHash('#/events');
    expect(location.hash).toBe('#/events');
    expect(dispatch).not.toHaveBeenCalled();
    dispatch.mockRestore();
  });

  it('fires a hashchange itself when the hash is already there (nothing else would)', () => {
    location.hash = '#/events';
    hashChanges = 0;
    goToHash('#/events');
    expect(location.hash).toBe('#/events');
    expect(hashChanges).toBe(1);
  });

  it('adds a history entry', async () => {
    location.hash = '#/a';
    await settle();
    const before = history.length;
    goToHash('#/b');
    expect(history.length).toBe(before + 1);
  });
});

describe('replaceHash', () => {
  it('sets the hash without adding a history entry, and always announces it once', async () => {
    location.hash = '#/events/ev1/setup';
    await settle();
    const before = history.length;
    hashChanges = 0;
    replaceHash('#/events');
    expect(location.hash).toBe('#/events');
    expect(history.length).toBe(before);
    expect(hashChanges).toBe(1);
  });

  it('announces once even when the hash is already there', () => {
    location.hash = '#/events';
    hashChanges = 0;
    replaceHash('#/events');
    expect(hashChanges).toBe(1);
  });
});

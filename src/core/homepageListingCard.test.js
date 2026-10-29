import { describe, it, expect, vi } from 'vitest';
import {
  buildHomepageListingCard,
  findEventHomepageListing,
  setEventHomepageListing,
} from './homepageListingCard.js';

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('buildHomepageListingCard', () => {
  it('is an unchecked, labelled checkbox by default', async () => {
    const card = buildHomepageListingCard(
      { id: 'e1', is_test: false },
      { load: async () => false },
    );
    const box = card.querySelector('input[type=checkbox]');
    expect(box.getAttribute('aria-disabled')).toBe('true'); // until the flag has been read
    await settle();
    expect(box.getAttribute('aria-disabled')).toBe('false');
    expect(box.checked).toBe(false);
    expect(card.textContent).toContain(
      'List this event on the Seduh Score homepage while it is live',
    );
    expect(card.querySelector('[role=status]')).not.toBeNull();
  });
  it('offers no checkbox on a test event and says why', () => {
    const card = buildHomepageListingCard({ id: 'e1', is_test: true });
    expect(card.querySelector('input')).toBeNull();
    expect(card.textContent).toMatch(/never listed/);
  });
  it('saves a change and reports it', async () => {
    const save = vi.fn().mockResolvedValue(true);
    const card = buildHomepageListingCard(
      { id: 'e1', is_test: false },
      { save, load: async () => false },
    );
    await settle();
    const box = card.querySelector('input');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await settle();
    expect(save).toHaveBeenCalledWith('e1', true);
    expect(box.checked).toBe(true);
    expect(card.querySelector('[role=status]').textContent).toMatch(/Listed/);
  });
  it('puts the box back and says so when the save fails', async () => {
    const save = vi.fn().mockRejectedValue(new Error('nope'));
    const card = buildHomepageListingCard(
      { id: 'e1', is_test: false },
      { save, load: async () => false },
    );
    await settle();
    const box = card.querySelector('input');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await settle();
    expect(box.checked).toBe(false);
    expect(box.getAttribute('aria-disabled')).toBe('false');
    expect(card.querySelector('[role=status]').textContent).toMatch(/Could not save/);
  });
});

describe('the card without the migration or without the event', () => {
  it('removes itself when the flag cannot be read (column missing in the database)', async () => {
    const host = document.createElement('div');
    host.append(
      buildHomepageListingCard(
        { id: 'e1', is_test: false },
        { load: async () => Promise.reject(new Error('42703')) },
      ),
    );
    await settle();
    expect(host.children).toHaveLength(0);
  });
  it('shows the stored value when it is on', async () => {
    const card = buildHomepageListingCard({ id: 'e1', is_test: false }, { load: async () => true });
    await settle();
    expect(card.querySelector('input').checked).toBe(true);
  });
  it('reads only the flag column for that event', async () => {
    const seen = {};
    const b = {
      select: (c) => ((seen.select = c), b),
      eq: (c, v) => ((seen.eq = [c, v]), b),
      maybeSingle: () => Promise.resolve({ data: { list_on_homepage: true }, error: null }),
    };
    expect(await findEventHomepageListing('e1', { from: () => b })).toBe(true);
    expect(seen).toEqual({ select: 'list_on_homepage', eq: ['id', 'e1'] });
  });
});

describe('keyboard and timing', () => {
  it('never uses the disabled attribute, so focus stays on the checkbox while saving', async () => {
    let finish;
    const save = vi.fn(() => new Promise((r) => (finish = r)));
    const card = buildHomepageListingCard(
      { id: 'e1', is_test: false },
      { save, load: async () => false },
    );
    document.body.append(card);
    await settle();
    const box = card.querySelector('input');
    box.focus();
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(box.disabled).toBe(false);
    expect(box.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(box);
    // a second change while saving is ignored and put back
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(save).toHaveBeenCalledTimes(1);
    finish(true);
    await settle();
    expect(box.checked).toBe(true);
    expect(document.activeElement).toBe(box);
    card.remove();
  });
  it('says so when the read never answers', async () => {
    vi.useFakeTimers();
    const card = buildHomepageListingCard(
      { id: 'e1', is_test: false },
      { load: () => new Promise(() => {}) },
    );
    await vi.advanceTimersByTimeAsync(10001);
    vi.useRealTimers();
    expect(card.querySelector('[role=status]').textContent).toMatch(/Could not load/);
    expect(card.querySelector('input').getAttribute('aria-disabled')).toBe('true');
  });
});

describe('setEventHomepageListing', () => {
  const client = (result) => {
    const seen = {};
    const b = {
      update: (v) => ((seen.update = v), b),
      eq: (c, v) => ((seen.eq = [c, v]), b),
      select: () => Promise.resolve(result),
    };
    return { seen, from: (t) => ((seen.table = t), b) };
  };
  it('updates only the flag, for that event', async () => {
    const c = client({ data: [{ list_on_homepage: true }], error: null });
    expect(await setEventHomepageListing('e1', true, c)).toBe(true);
    expect(c.seen).toEqual({
      table: 'events',
      update: { list_on_homepage: true },
      eq: ['id', 'e1'],
    });
  });
  it('treats zero rows touched (not a member) as a failure, not success', async () => {
    await expect(
      setEventHomepageListing('e1', true, client({ data: [], error: null })),
    ).rejects.toThrow();
  });
});

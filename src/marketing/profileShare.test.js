// The Share control: no control without a public name, a holding state while the card is drawn, two styles, share vs save
// branching, and plain-words failures. The drawing and the share sheet are injected; no canvas, no network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normaliseProfile } from '../core/seduhProfile.js';
import { shareStoryCard } from '../core/storyCard.js';
import { buildShareControl } from './profileShare.js';
import { mountProfilePage } from './profileScreen.js';

const raw = (over = {}) => ({
  has_profile: true,
  handle: 'syafiqah',
  identity: {
    display_name: 'Syafiqah Omar',
    country_code: 'BN',
    founding_number: 1,
    photo_url: null,
  },
  recorded_results: [
    {
      event_name: 'Kiulap Open',
      format: 'cup_taster',
      organiser_name: 'Proof Org',
      event_date: '2026-03-15',
      placing: 2,
      stage: 'Final',
      correct: 6,
      total: 8,
      time_secs: 100,
      provenance: 'seduh_score',
    },
  ],
  knockout_record: { won: 0, lost: 0, opponents: [] },
  organiser_records: [],
  self_reported: [],
  judging_roles: [],
  cafe_affiliations: [],
  ...over,
});

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  document.body.replaceChildren();
});

const tick = () => new Promise((r) => setTimeout(r, 0));
function mount(profile, options) {
  const control = buildShareControl(profile, options);
  if (control) document.body.append(control);
  return control;
}

describe('buildShareControl', () => {
  it('draws no control when the name is hidden', () => {
    const hidden = normaliseProfile(
      raw({
        identity: {
          display_name: null,
          country_code: null,
          founding_number: null,
          photo_url: null,
        },
      }),
    );
    expect(buildShareControl(hidden)).toBeNull();
  });

  it('opens a labelled dialog, shows a holding state, then the preview and an enabled Share picture', async () => {
    let finish;
    const render = vi.fn(() => new Promise((r) => (finish = r)));
    const control = mount(normaliseProfile(raw()), { render, share: vi.fn() });
    const open = control.querySelector('button');
    expect(open.textContent).toBe('Share');
    open.click();
    const dialog = control.querySelector('dialog');
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBe('profile-share-title');
    expect(control.querySelector('[role="status"]').textContent).toBe('Making the picture…');
    const go = [...control.querySelectorAll('button')].find(
      (b) => b.textContent === 'Share picture',
    );
    expect(go.disabled).toBe(true);
    finish(new Blob(['x'], { type: 'image/png' }));
    await tick();
    expect(go.disabled).toBe(false);
    const img = control.querySelector('img.profile-share-preview');
    expect(img.getAttribute('src')).toBe('blob:preview');
    expect(img.getAttribute('alt')).toContain('Syafiqah Omar');
    expect(control.querySelector('[role="status"]').textContent).toBe('');
  });

  it('hands the card spec of the chosen style, and the page QR address, to the renderer', async () => {
    const render = vi.fn(async () => new Blob(['x']));
    const control = mount(normaliseProfile(raw()), { render, share: vi.fn() });
    control.querySelector('button').click();
    await tick();
    expect(render.mock.calls[0][0].eyebrow).toBe('Whole record');
    expect(render.mock.calls[0][1].qrUrl).toBe('https://www.seduhscore.com/id/syafiqah');
    const latest = control.querySelector('[data-style="latest"]');
    latest.click();
    await tick();
    expect(render.mock.calls[1][0].eyebrow).toBe('Latest result');
    expect(latest.getAttribute('aria-pressed')).toBe('true');
    expect(control.querySelector('[data-style="record"]').getAttribute('aria-pressed')).toBe(
      'false',
    );
    // switching back reuses the drawn picture
    control.querySelector('[data-style="record"]').click();
    await tick();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('passes the photo address to the renderer, or none without a photo', async () => {
    const path = `/storage/v1/object/public/seduh-avatars/syafiqah/${'a'.repeat(32)}.webp`;
    const withPhoto = raw();
    withPhoto.identity.photo_url = path;
    const render = vi.fn(async () => new Blob(['x']));
    const control = mount(normaliseProfile(withPhoto), {
      render,
      share: vi.fn(),
      supabaseUrl: 'https://proj.supabase.co',
    });
    control.querySelector('button').click();
    await tick();
    expect(render.mock.calls[0][1].photoUrl).toBe(`https://proj.supabase.co${path}`);
    document.body.replaceChildren();
    const none = vi.fn(async () => new Blob(['x']));
    const c2 = mount(normaliseProfile(raw()), {
      render: none,
      share: vi.fn(),
      supabaseUrl: 'https://proj.supabase.co',
    });
    c2.querySelector('button').click();
    await tick();
    expect(none.mock.calls[0][1].photoUrl).toBeNull();
  });

  it('disables Share picture while another style is being drawn', async () => {
    let finish;
    const render = vi
      .fn()
      .mockResolvedValueOnce(new Blob(['a']))
      .mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const control = mount(normaliseProfile(raw()), { render, share: vi.fn() });
    control.querySelector('button').click();
    await tick();
    const go = [...control.querySelectorAll('button')].find(
      (b) => b.textContent === 'Share picture',
    );
    expect(go.disabled).toBe(false);
    control.querySelector('[data-style="latest"]').click();
    expect(go.disabled).toBe(true);
    finish(new Blob(['b']));
    await tick();
    expect(go.disabled).toBe(false);
  });

  it('shares the drawn picture on the Share picture tap, naming the file by handle', async () => {
    const blob = new Blob(['x']);
    const share = vi.fn(async () => 'shared');
    const control = mount(normaliseProfile(raw()), { render: async () => blob, share });
    control.querySelector('button').click();
    await tick();
    [...control.querySelectorAll('button')].find((b) => b.textContent === 'Share picture').click();
    await tick();
    expect(share.mock.calls[0][0]).toBe(blob);
    expect(share.mock.calls[0][1].filename).toBe('seduh-id-syafiqah-story.png');
    expect(control.querySelector('[role="status"]').textContent).toBe('Shared.');
  });

  it('says in words when the picture was saved instead, and stays quiet when the share sheet was cancelled', async () => {
    const results = ['saved', 'cancelled'];
    const share = vi.fn(async () => results.shift());
    const control = mount(normaliseProfile(raw()), { render: async () => new Blob(['x']), share });
    control.querySelector('button').click();
    await tick();
    const go = [...control.querySelectorAll('button')].find(
      (b) => b.textContent === 'Share picture',
    );
    const status = control.querySelector('[role="status"]');
    go.click();
    await tick();
    expect(status.textContent).toMatch(/Picture saved/);
    go.click();
    await tick();
    expect(status.textContent).toBe('');
  });

  it('says it could not make the picture, in plain words, and offers Try again', async () => {
    const render = vi.fn(async () => {
      throw new Error('no canvas');
    });
    const control = mount(normaliseProfile(raw()), { render, share: vi.fn() });
    control.querySelector('button').click();
    await tick();
    expect(control.querySelector('[role="status"]').textContent).toBe(
      'Could not make the picture. Please try again.',
    );
    const go = [...control.querySelectorAll('button')].find((b) => b.textContent === 'Try again');
    expect(go.disabled).toBe(false);
    expect(render).toHaveBeenCalledTimes(1);
    go.click();
    await tick();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('closes on a backdrop tap and Close, returning focus to Share, but not on a tap inside the dialog box', async () => {
    const control = mount(normaliseProfile(raw()), {
      render: async () => new Blob(['x']),
      share: vi.fn(),
    });
    const open = control.querySelector('button');
    open.click();
    await tick();
    const dialog = control.querySelector('dialog');
    // jsdom lays nothing out: the box is 0 x 0 at the origin, so (0, 0) is inside it and (50, 50) is the backdrop
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    expect(dialog.hasAttribute('open')).toBe(true);
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 }));
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(control.querySelector('img.profile-share-preview')).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it('offers only the whole-record style when there is no competed entry', () => {
    const control = mount(normaliseProfile(raw({ recorded_results: [] })), { share: vi.fn() });
    expect(control.querySelector('[data-style]')).toBeNull();
  });
});

describe('shareStoryCard branching (the share-or-save choice the control relies on)', () => {
  const blob = new Blob(['x'], { type: 'image/png' });
  it('shares when the browser can share the file, saves otherwise', async () => {
    const shared = { share: vi.fn(async () => {}), canShare: () => true };
    expect(await shareStoryCard(blob, { filename: 'a.png' }, shared)).toBe('shared');
    const doc = document;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:x');
    const noShare = { canShare: () => false };
    expect(await shareStoryCard(blob, { filename: 'a.png' }, noShare, doc)).toBe('saved');
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
});

describe('on the person page', () => {
  it('shows Share in the hero for a public name and not for a page with no identity', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await mountProfilePage(root, 'syafiqah', {
      fetchProfile: async () => normaliseProfile(raw()),
    });
    expect(root.querySelector('.profile-hero .profile-share button').textContent).toBe('Share');
    const none = document.createElement('div');
    document.body.append(none);
    await mountProfilePage(none, 'syafiqah', {
      fetchProfile: async () =>
        normaliseProfile(
          raw({
            identity: {
              display_name: null,
              country_code: null,
              founding_number: null,
              photo_url: null,
            },
          }),
        ),
    });
    expect(none.querySelector('.profile-share')).toBeNull();
  });
});

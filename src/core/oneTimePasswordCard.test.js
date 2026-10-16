import { describe, it, expect, vi, afterEach } from 'vitest';
import { oneTimePasswordCard } from './oneTimePasswordCard.js';

const PASSWORD = 'k7mx-p3qa-9wdn';
const COPY_FAILED = 'Could not copy it. Select the password and copy it yourself.';

function setClipboard(value) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}
afterEach(() => setClipboard(undefined));

const build = (overrides = {}) =>
  oneTimePasswordCard({
    idPrefix: 'pw',
    heading: 'Login created for kim@example.com',
    password: PASSWORD,
    copyFailedText: COPY_FAILED,
    ...overrides,
  });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('oneTimePasswordCard', () => {
  it('is a section named by its heading and described by the password', () => {
    const card = build();
    expect(card.tagName).toBe('SECTION');
    expect(card.id).toBe('pw-card');
    expect(card.getAttribute('aria-labelledby')).toBe('pw-heading');
    expect(card.querySelector('#pw-heading').textContent).toBe('Login created for kim@example.com');
    expect(card.getAttribute('aria-describedby')).toBe('pw-password');
    // every part's id comes from the prefix
    expect([...card.querySelectorAll('[id]')].map((n) => n.id)).toEqual([
      'pw-heading',
      'pw-password',
      'pw-copy',
      'pw-copy-status',
    ]);
    expect(card.querySelector('code#pw-password').textContent).toBe(PASSWORD);
    expect(card.textContent).toContain('One-time password:');
  });

  it('names a Done button from the prefix too, and never writes "undefined" into the description', () => {
    const card = build({
      onDone: () => {},
      paragraphs: [{ text: 'No id, so it cannot describe the card', describes: true }],
    });
    expect(card.querySelector('#pw-done')).not.toBeNull();
    expect(card.getAttribute('aria-describedby')).toBe('pw-password');
  });

  it('shows the password only as the code block text, never in an attribute', () => {
    const card = build({ onDone: () => {}, paragraphs: [{ id: 'pw-w', text: 'Once.' }] });
    for (const node of [card, ...card.querySelectorAll('*')]) {
      for (const attribute of node.attributes) {
        expect(attribute.value, `${node.tagName} ${attribute.name}`).not.toContain(PASSWORD);
      }
    }
    expect(card.textContent.split(PASSWORD)).toHaveLength(2);
  });

  it('puts the caller paragraphs after the password, in order, and describes only those that say so', () => {
    const card = build({
      paragraphs: [
        { id: 'pw-warning', text: 'Shown once.', describes: true, className: 'warn' },
        { text: 'Pass it on.' },
        { id: 'pw-note', text: 'A note.' },
      ],
    });
    expect(card.getAttribute('aria-describedby')).toBe('pw-password pw-warning');
    const texts = [...card.querySelectorAll('p')].map((p) => p.textContent);
    expect(texts).toEqual(['One-time password:', 'Shown once.', 'Pass it on.', 'A note.']);
    expect(card.querySelectorAll('button')[0].getAttribute('type')).toBe('button');
    expect(card.querySelector('#pw-warning').className).toBe('warn');
  });

  it('lets a caller keep ids that already exist, one at a time', () => {
    const card = build({
      ids: { card: 'team-issued', heading: 'team-issued-heading', password: 'team-password' },
    });
    expect(card.id).toBe('team-issued');
    expect(card.getAttribute('aria-labelledby')).toBe('team-issued-heading');
    expect(card.querySelector('#team-password').textContent).toBe(PASSWORD);
    expect(card.querySelector('#pw-copy')).not.toBeNull();
  });

  it('only takes focus when asked to', () => {
    expect(build().hasAttribute('tabindex')).toBe(false);
    expect(build({ focusable: true }).getAttribute('tabindex')).toBe('-1');
  });

  it('puts the caller classes on their parts and keeps the shared ones', () => {
    const card = build({
      onDone: () => {},
      classes: {
        card: 'mine-card',
        muted: 'mine-muted',
        password: 'mine-password',
        actions: 'mine-actions',
        copy: 'btn btn-outline',
        done: 'btn btn-primary',
      },
    });
    expect(card.className).toBe('card one-time-card mine-card');
    expect(card.querySelector('code').className).toBe('one-time-password mine-password');
    expect(card.querySelector('p').className).toBe('mine-muted');
    expect(card.querySelector('#pw-copy-status').className).toBe('mine-muted');
    expect(card.querySelector('.mine-actions')).not.toBeNull();
    expect(card.querySelector('#pw-copy').className).toBe('btn btn-outline');
    expect(card.querySelector('#pw-done').className).toBe('btn btn-primary');
  });

  it('makes Copy the main button and Done the quieter one unless told otherwise', () => {
    const card = build({ onDone: () => {} });
    expect(card.querySelector('#pw-copy').className).toBe('btn btn-primary tap-target');
    expect(card.querySelector('#pw-done').className).toBe('btn btn-outline tap-target');
  });

  describe('Copy', () => {
    it('copies the password and says so in a polite status line', async () => {
      const writeText = vi.fn(() => Promise.resolve());
      setClipboard({ writeText });
      const card = build();
      const status = card.querySelector('#pw-copy-status');
      expect(status.getAttribute('role')).toBe('status');
      expect(status.getAttribute('aria-live')).toBe('polite');
      expect(status.textContent).toBe('');
      card.querySelector('#pw-copy').click();
      await flush();
      expect(writeText).toHaveBeenCalledWith(PASSWORD);
      expect(status.textContent).toBe('Copied.');
    });

    it('says the caller words when the browser will not copy', async () => {
      setClipboard({ writeText: () => Promise.reject(new Error('denied')) });
      const card = build();
      card.querySelector('#pw-copy').click();
      await flush();
      expect(card.querySelector('#pw-copy-status').textContent).toBe(COPY_FAILED);
    });

    it('says the caller words, and copies nothing, once the screen is no longer showing it', async () => {
      const writeText = vi.fn(() => Promise.resolve());
      setClipboard({ writeText });
      let shown = true;
      const card = build({ isStillShown: () => shown });
      shown = false;
      card.querySelector('#pw-copy').click();
      await flush();
      expect(writeText).not.toHaveBeenCalled();
      expect(card.querySelector('#pw-copy-status').textContent).toBe(COPY_FAILED);
    });
  });

  describe('Done', () => {
    it('is there only when there is something to do on it', () => {
      expect(build().querySelector('#pw-done')).toBeNull();
    });

    it('calls onDone and carries the caller accessible name', () => {
      const onDone = vi.fn();
      const card = build({ onDone, doneLabel: 'Done: hide it' });
      const done = card.querySelector('#pw-done');
      expect(done.getAttribute('aria-label')).toBe('Done: hide it');
      expect(done.textContent).toBe('Done');
      done.click();
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });
});

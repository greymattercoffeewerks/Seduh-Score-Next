import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toast, confirmInPlace, confirmDialog, emptyState } from './feedback.js';
import { answerFeedback, feedbackButton } from './feedbackTestKit.js';

const escape = () =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

let row;
let trigger;
beforeEach(() => {
  document.body.innerHTML = '';
  row = document.createElement('div');
  trigger = document.createElement('button');
  trigger.textContent = 'Lock';
  row.appendChild(trigger);
  document.body.appendChild(row);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('confirmInPlace', () => {
  it('opens beside the trigger, names the consequence, and puts focus on Cancel', () => {
    confirmInPlace(trigger, { title: 'Lock standings?', body: 'This cannot be undone.' });
    const panel = document.querySelector('.confirm-panel');
    expect(row.nextElementSibling).toBe(panel);
    expect(panel.textContent).toContain('Lock standings?');
    expect(panel.textContent).toContain('This cannot be undone.');
    expect(document.activeElement).toBe(feedbackButton('cancel'));
    // Cancel comes before the destructive button, so Tab from Cancel never lands on it first by accident.
    const actions = [...panel.querySelectorAll('button')].map((b) => b.dataset.feedbackAction);
    expect(actions).toEqual(['cancel', 'confirm']);
  });

  it('sets aria-expanded and aria-controls while open and clears them after', async () => {
    const answer = confirmInPlace(trigger, { title: 'x' });
    const panel = document.querySelector('.confirm-panel');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(panel.id);
    answerFeedback('cancel');
    expect(await answer).toBe(false);
    expect(trigger.hasAttribute('aria-expanded')).toBe(false);
    expect(trigger.hasAttribute('aria-controls')).toBe(false);
  });

  it('resolves true on confirm and false on Cancel, and removes the panel either way', async () => {
    const yes = confirmInPlace(trigger, { title: 'x' });
    answerFeedback('confirm');
    expect(await yes).toBe(true);
    expect(document.querySelector('.confirm-panel')).toBeNull();
    const no = confirmInPlace(trigger, { title: 'x' });
    answerFeedback('cancel');
    expect(await no).toBe(false);
    expect(document.querySelector('.confirm-panel')).toBeNull();
  });

  it('closes on Escape, answers false, and returns focus to the trigger', async () => {
    const answer = confirmInPlace(trigger, { title: 'x' });
    escape();
    expect(await answer).toBe(false);
    expect(document.querySelector('.confirm-panel')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('shows the violet Test event strip only for a test event', () => {
    confirmInPlace(trigger, { title: 'x', isTest: true });
    expect(document.querySelector('.confirm-panel .feedback-test').textContent).toBe('Test event');
    escape();
    confirmInPlace(trigger, { title: 'x' });
    expect(document.querySelector('.feedback-test')).toBeNull();
  });

  it('pressing the same trigger again closes the panel (a toggle) instead of stacking another', async () => {
    const first = confirmInPlace(trigger, { title: 'x' });
    const second = confirmInPlace(trigger, { title: 'x' });
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(document.querySelectorAll('.confirm-panel')).toHaveLength(0);
  });

  it('a panel for another trigger replaces the open one, which answers false', async () => {
    const other = document.createElement('button');
    row.appendChild(other);
    const first = confirmInPlace(trigger, { title: 'first' });
    const second = confirmInPlace(other, { title: 'second' });
    expect(await first).toBe(false);
    expect(document.querySelectorAll('.confirm-panel')).toHaveLength(1);
    expect(trigger.hasAttribute('aria-expanded')).toBe(false);
    answerFeedback('confirm');
    expect(await second).toBe(true);
  });

  it('a screen that re-rendered under the panel settles the question as no, without a keypress', async () => {
    const answer = confirmInPlace(trigger, { title: 'x' });
    document.body.innerHTML = ''; // render() replaced the DOM, the panel went with it
    expect(await answer).toBe(false);
    expect(trigger.hasAttribute('aria-expanded')).toBe(false);
    // and the next panel opens normally: nothing is left registered
    document.body.appendChild(row); // the screen drew itself again
    const next = confirmInPlace(trigger, { title: 'again' });
    expect(document.querySelectorAll('.confirm-panel')).toHaveLength(1);
    answerFeedback('confirm');
    expect(await next).toBe(true);
  });

  it('a screen that re-rendered under the panel leaves nothing behind: Escape still settles it', async () => {
    const answer = confirmInPlace(trigger, { title: 'x' });
    document.body.innerHTML = ''; // render() replaced the DOM, the panel went with it
    escape();
    expect(await answer).toBe(false);
  });

  it('with no trigger it still opens (at the end of the page)', () => {
    confirmInPlace(null, { title: 'x' });
    expect(document.body.lastElementChild.className).toBe('confirm-panel');
  });

  it('uses the danger tone for a button that destroys something', () => {
    confirmInPlace(trigger, { title: 'x', tone: 'danger', confirmLabel: 'Redraw round' });
    expect(document.querySelector('.confirm-panel').dataset.tone).toBe('danger');
    expect(feedbackButton('confirm').className).toContain('fb-btn--danger');
    expect(feedbackButton('confirm').textContent).toBe('Redraw round');
  });
});

describe('confirmDialog', () => {
  it('is a <dialog>, modal where the browser can, with focus on Cancel and the text as its name', () => {
    confirmDialog({ title: 'Delete the guesses?', body: 'Permanent.' });
    const dialog = document.querySelector('dialog.dialog');
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(feedbackButton('cancel'));
    expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h2').id);
    expect(dialog.getAttribute('aria-describedby')).toBe(
      dialog.querySelector('p.feedback-body').id,
    );
  });

  it('resolves true only on the destructive button', async () => {
    const yes = confirmDialog({ title: 'x' });
    answerFeedback('confirm');
    expect(await yes).toBe(true);
    expect(document.querySelector('dialog')).toBeNull();
    const no = confirmDialog({ title: 'x' });
    answerFeedback('cancel');
    expect(await no).toBe(false);
  });

  it('Escape (the dialog cancel event) answers false', async () => {
    const answer = confirmDialog({ title: 'x' });
    const dialog = document.querySelector('dialog');
    dialog.dispatchEvent(new Event('cancel'));
    dialog.dispatchEvent(new Event('close'));
    expect(await answer).toBe(false);
  });

  it('gives focus back to what had it, and shows the Test event strip for a test event', async () => {
    trigger.focus();
    const answer = confirmDialog({ title: 'x', isTest: true });
    expect(document.querySelector('dialog .feedback-test').textContent).toBe('Test event');
    answerFeedback('cancel');
    await answer;
    expect(document.activeElement).toBe(trigger);
  });
});

describe('toast', () => {
  it('shows in one persistent polite live region and goes after about 3 seconds', () => {
    vi.useFakeTimers();
    toast('Cupper added');
    const region = document.querySelector('.toast-region');
    expect(region.getAttribute('aria-live')).toBe('polite');
    // the region was made by this call, so its first message follows it (a live region inserted with text is not announced)
    expect(region.textContent).toBe('');
    vi.advanceTimersByTime(50);
    expect(region.textContent).toBe('Cupper added');
    toast('Saved');
    expect(document.querySelectorAll('.toast-region')).toHaveLength(1);
    vi.advanceTimersByTime(2949);
    expect(region.querySelectorAll('.toast')).toHaveLength(2);
    vi.advanceTimersByTime(52);
    expect(region.querySelectorAll('.toast')).toHaveLength(0);
  });

  it('keeps the order of messages sent in the same tick on a fresh page', () => {
    vi.useFakeTimers();
    toast('A');
    toast('B');
    vi.advanceTimersByTime(50);
    expect([...document.querySelectorAll('.toast')].map((n) => n.textContent)).toEqual(['A', 'B']);
  });

  it('can be dismissed early', () => {
    const dismiss = toast('x');
    dismiss();
    expect(document.querySelectorAll('.toast')).toHaveLength(0);
  });
});

describe('emptyState', () => {
  it('builds .empty with its kind, a sentence, and an optional title and action', () => {
    const action = document.createElement('button');
    const node = emptyState({
      kind: 'first-use',
      title: 'No records yet',
      text: 'Confirm a match.',
      action,
    });
    expect(node.className).toBe('empty');
    expect(node.dataset.kind).toBe('first-use');
    expect(node.querySelector('.empty-title').textContent).toBe('No records yet');
    expect(node.querySelector('.empty-text').textContent).toBe('Confirm a match.');
    expect(node.lastElementChild).toBe(action);
  });

  it('refuses a kind that is not one of the three', () => {
    expect(() => emptyState({ kind: 'sad', text: 'x' })).toThrow(/unknown kind/);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  captureCorrectionDrafts,
  renderTimeCorrection,
  restoreCorrectionDrafts,
} from './timeCorrectionEditor.js';
import { CorrectionInputError, REASON_MAX_LENGTH } from './timeCorrection.js';

const entry = { entry_id: 'e1', id: 'he1', displayName: 'Cupper One', elapsed_secs: 200 };

let host;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

// Mounted in the document: focus() only takes effect on attached nodes.
function mount(onCorrect = vi.fn()) {
  const { toggle, panel } = renderTimeCorrection(entry, { onCorrect });
  host.append(toggle, panel);
  const q = (selector) => panel.querySelector(selector);
  const buttonByText = (text) =>
    [...panel.querySelectorAll('button')].find((b) => b.textContent === text);
  const reasonRadio = (label) =>
    [...panel.querySelectorAll('label.time-correction-reason')]
      .find((l) => l.textContent === label)
      .querySelector('input');
  const [minutes, seconds] = panel.querySelectorAll('.time-correction-input');
  return {
    toggle,
    panel,
    onCorrect,
    minutes,
    seconds,
    q,
    buttonByText,
    reasonRadio,
    other: q('.time-correction-other'),
    error: q('[role="alert"]'),
    save: buttonByText('Save correction'),
    cancel: buttonByText('Cancel'),
  };
}

describe('renderTimeCorrection', () => {
  it('starts closed: only the Edit time button is visible, and it names the cupper', () => {
    const { toggle, panel } = mount();
    expect(toggle.textContent).toBe('Edit time');
    // Starts with the visible text (WCAG 2.5.3), then says whose time it is.
    expect(toggle.getAttribute('aria-label')).toBe('Edit time, Cupper One');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
    expect(toggle.hidden).toBe(false);
    expect(panel.hidden).toBe(true);
    expect(toggle.id).toBe('time-correction-toggle-e1');
    expect(panel.id).toBe('time-correction-panel-e1');
    expect(panel.getAttribute('role')).toBe('group');
    expect(panel.getAttribute('aria-label')).toBe("Edit Cupper One's time");
  });

  it('opening it reveals the panel, hides the toggle and puts focus in the minutes field — never on <body>', () => {
    const { toggle, panel, minutes } = mount();
    toggle.click();
    expect(panel.hidden).toBe(false);
    expect(toggle.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(minutes);
  });

  it('pre-fills the time that is recorded now, and says so', () => {
    const { minutes, seconds, panel } = mount();
    expect([minutes.value, seconds.value]).toEqual(['3', '20']);
    expect(panel.textContent).toContain('Recorded 3:20.');
  });

  it('gives every field and button an accessible name that says which cupper it is for', () => {
    const { minutes, seconds, other, save, cancel } = mount();
    expect(minutes.getAttribute('aria-label')).toBe('Cupper One: corrected minutes');
    expect(seconds.getAttribute('aria-label')).toBe('Cupper One: corrected seconds');
    expect(other.getAttribute('aria-label')).toBe('Cupper One: other reason');
    expect(save.getAttribute('aria-label')).toBe('Save correction, Cupper One');
    expect(cancel.getAttribute('aria-label')).toBe('Cancel, Cupper One');
    // Each name contains the button's visible text.
    expect(save.getAttribute('aria-label')).toContain(save.textContent);
    expect(cancel.getAttribute('aria-label')).toContain(cancel.textContent);
  });

  it('offers the quick-pick reasons as one radio group, none chosen to begin with', () => {
    const { panel } = mount();
    const radios = [...panel.querySelectorAll('input[type="radio"]')];
    expect(radios.map((r) => r.closest('label').textContent)).toEqual([
      'Missed the stop',
      "Manual timekeeper's time",
      'Wrong cupper',
      'Other',
    ]);
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
    expect(radios.some((r) => r.checked)).toBe(false);
    expect(panel.querySelector('legend').textContent).toBe('Why is the time changing?');
  });

  it('each cupper’s radio group is separate, so two open editors never share a selection', () => {
    const a = renderTimeCorrection(entry, { onCorrect: vi.fn() });
    const b = renderTimeCorrection(
      { ...entry, entry_id: 'e2', id: 'he2', displayName: 'Cupper Two' },
      { onCorrect: vi.fn() },
    );
    const nameOf = (parts) => parts.panel.querySelector('input[type="radio"]').name;
    expect(nameOf(a)).not.toBe(nameOf(b));
    expect(a.panel.id).not.toBe(b.panel.id);
  });

  it('keeps the free-text box hidden until Other is chosen, then reveals it — without stealing focus', () => {
    const { other, reasonRadio } = mount();
    expect(other.hidden).toBe(true);
    reasonRadio('Other').click();
    expect(other.hidden).toBe(false);
    // Arrow keys fire `change` on every radio they pass: pulling focus into the
    // box would trap a keyboard user on "Other" instead of letting them arrow on.
    expect(document.activeElement).not.toBe(other);
    reasonRadio('Wrong cupper').click();
    expect(other.hidden).toBe(true);
  });

  it('caps the free-text reason at the same length the server enforces', () => {
    const { other } = mount();
    expect(other.getAttribute('maxlength')).toBe(String(REASON_MAX_LENGTH));
  });

  it('Cancel closes the panel, clears any error and returns focus to the Edit time button', () => {
    const { toggle, panel, cancel, save, error, onCorrect } = mount();
    toggle.click();
    save.click(); // no reason chosen → local error
    expect(error.textContent).not.toBe('');
    cancel.click();
    expect(panel.hidden).toBe(true);
    expect(toggle.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(error.textContent).toBe('');
    expect(document.activeElement).toBe(toggle);
    expect(onCorrect).not.toHaveBeenCalled();
  });

  describe('Save correction', () => {
    it('without a reason shows a local error and never calls onCorrect', () => {
      const { minutes, seconds, save, error, onCorrect } = mount();
      minutes.value = '3';
      seconds.value = '12';
      save.click();
      expect(error.textContent).toBe('Choose or type a reason for the change.');
      expect(onCorrect).not.toHaveBeenCalled();
      expect(save.hasAttribute('aria-disabled')).toBe(false);
    });

    it('with Other chosen but nothing typed shows the same error', () => {
      const { reasonRadio, save, error, onCorrect } = mount();
      reasonRadio('Other').click();
      save.click();
      expect(error.textContent).toBe('Choose or type a reason for the change.');
      expect(onCorrect).not.toHaveBeenCalled();
    });

    it('with Other chosen and only spaces typed shows the same error', () => {
      const { reasonRadio, other, save, error, onCorrect } = mount();
      reasonRadio('Other').click();
      other.value = '    ';
      save.click();
      expect(error.textContent).toBe('Choose or type a reason for the change.');
      expect(onCorrect).not.toHaveBeenCalled();
    });

    it('with a bad time shows the time error and never calls onCorrect', () => {
      const { minutes, seconds, reasonRadio, save, error, onCorrect } = mount();
      reasonRadio('Missed the stop').click();
      minutes.value = '3';
      seconds.value = '75';
      save.click();
      expect(error.textContent).toContain('Seconds must be a whole number from 0 to 59');
      expect(onCorrect).not.toHaveBeenCalled();
    });

    it('with an emptied field is refused rather than read as 0:00', () => {
      const { minutes, reasonRadio, save, error, onCorrect } = mount();
      reasonRadio('Missed the stop').click();
      minutes.value = '';
      save.click();
      expect(error.textContent).toContain('Minutes must be a whole number');
      expect(onCorrect).not.toHaveBeenCalled();
    });

    it('hands onCorrect the entry id, the time in seconds and a quick-pick reason, and shows it is saving', () => {
      const { minutes, seconds, reasonRadio, save, error, onCorrect } = mount();
      reasonRadio("Manual timekeeper's time").click();
      minutes.value = '3';
      seconds.value = '12';
      save.click();
      expect(onCorrect).toHaveBeenCalledTimes(1);
      expect(onCorrect).toHaveBeenCalledWith(
        'e1',
        192,
        "Manual timekeeper's time",
        expect.any(Function),
      );
      expect(error.textContent).toBe('');
      expect(save.getAttribute('aria-disabled')).toBe('true');
      expect(save.textContent).toBe('Saving…');
    });

    it('passes the typed Other reason, trimmed', () => {
      const { reasonRadio, other, save, onCorrect } = mount();
      reasonRadio('Other').click();
      other.value = '  Judge started the clock late  ';
      save.click();
      expect(onCorrect).toHaveBeenCalledWith(
        'e1',
        200,
        'Judge started the clock late',
        expect.any(Function),
      );
    });

    it('restores the Save button when the caller’s restore callback runs (a render that threw)', () => {
      const { reasonRadio, save, onCorrect } = mount();
      reasonRadio('Wrong cupper').click();
      save.click();
      expect(save.getAttribute('aria-disabled')).toBe('true');
      const restore = onCorrect.mock.calls[0][3];
      restore();
      expect(save.hasAttribute('aria-disabled')).toBe(false);
      expect(save.textContent).toBe('Save correction');
    });

    it('clears an earlier error once a valid save goes through', () => {
      const { minutes, seconds, reasonRadio, save, error } = mount();
      save.click();
      expect(error.textContent).not.toBe('');
      reasonRadio('Wrong cupper').click();
      minutes.value = '3';
      seconds.value = '12';
      save.click();
      expect(error.textContent).toBe('');
    });
  });
});

describe('validation errors', () => {
  it('a missing reason points at the reason group: focus, aria-invalid, aria-describedby', () => {
    const { toggle, save, error, reasonRadio, panel } = mount();
    toggle.click();
    save.click();
    const first = reasonRadio('Missed the stop');
    expect(error.textContent).toBe('Choose or type a reason for the change.');
    expect(document.activeElement).toBe(first);
    // aria-invalid belongs on the radiogroup, not on one radio inside it.
    const group = panel.querySelector('[role="radiogroup"]');
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(group.getAttribute('aria-describedby')).toBe(error.id);
    expect(first.hasAttribute('aria-invalid')).toBe(false);
    expect(panel.contains(error)).toBe(true);
  });

  it('Other chosen but empty points at the free-text box instead', () => {
    const { reasonRadio, other, save } = mount();
    reasonRadio('Other').click();
    save.click();
    expect(document.activeElement).toBe(other);
    expect(other.getAttribute('aria-invalid')).toBe('true');
  });

  it('a bad seconds value points at the seconds field, a bad minutes value at the minutes field', () => {
    const { minutes, seconds, reasonRadio, save, error } = mount();
    reasonRadio('Missed the stop').click();
    seconds.value = '75';
    save.click();
    expect(document.activeElement).toBe(seconds);
    expect(seconds.getAttribute('aria-describedby')).toBe(error.id);
    seconds.value = '12';
    minutes.value = '';
    save.click();
    expect(document.activeElement).toBe(minutes);
  });

  it('the error clears as soon as the person fixes the field — typing, or choosing a reason', () => {
    const { minutes, reasonRadio, save, error, panel } = mount();
    save.click();
    expect(error.textContent).not.toBe('');
    reasonRadio('Wrong cupper').click();
    expect(error.textContent).toBe('');
    expect(panel.querySelector('[role="radiogroup"]').hasAttribute('aria-invalid')).toBe(false);

    minutes.value = '';
    save.click();
    expect(error.textContent).not.toBe('');
    minutes.dispatchEvent(new Event('input', { bubbles: true }));
    expect(error.textContent).toBe('');
    expect(minutes.hasAttribute('aria-invalid')).toBe(false);
  });

  it('keeps its error line in the document while empty, as a live region — not display: none', () => {
    const { error } = mount();
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.isConnected).toBe(true);
    expect(error.textContent).toBe('');
    expect(error.className).toBe('time-correction-error');
  });

  it('puts the error above the buttons so it is on screen when focus lands on the field', () => {
    const { panel, error, save } = mount();
    const order = [...panel.children];
    expect(order.indexOf(error)).toBeLessThan(order.indexOf(save.parentElement));
  });
});

describe('Save correction — outcomes reported through done()', () => {
  function saveOnce(onCorrect) {
    const parts = mount(onCorrect);
    parts.toggle.click();
    parts.reasonRadio('Missed the stop').click();
    parts.minutes.value = '3';
    parts.seconds.value = '12';
    parts.save.click();
    return parts;
  }

  it('done() re-enables Save and leaves the panel as it was', () => {
    const onCorrect = vi.fn();
    const { save, panel } = saveOnce(onCorrect);
    onCorrect.mock.calls[0][3]();
    expect(save.hasAttribute('aria-disabled')).toBe(false);
    expect(save.textContent).toBe('Save correction');
    expect(panel.hidden).toBe(false);
  });

  it('done({ error }) shows a time problem beside the minutes field and keeps what was typed', () => {
    const onCorrect = vi.fn();
    const { error, minutes, save, reasonRadio } = saveOnce(onCorrect);
    onCorrect.mock.calls[0][3]({
      error: new CorrectionInputError('That is already the recorded time (3:20).', 'time'),
    });
    expect(error.textContent).toBe('That is already the recorded time (3:20).');
    expect(document.activeElement).toBe(minutes);
    expect(save.hasAttribute('aria-disabled')).toBe(false);
    expect(reasonRadio('Missed the stop').checked).toBe(true);
    expect(minutes.value).toBe('3');
  });

  it('done({ queued: true }) closes the panel and parks the Edit button so the old time is not corrected twice', () => {
    const onCorrect = vi.fn();
    const { toggle, panel, save } = saveOnce(onCorrect);
    onCorrect.mock.calls[0][3]({ queued: true });
    expect(panel.hidden).toBe(true);
    expect(toggle.hidden).toBe(false);
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    expect(toggle.textContent).toBe('Waiting to sync');
    expect(toggle.getAttribute('aria-label')).toBe('Waiting to sync, Cupper One');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(save.hasAttribute('aria-disabled')).toBe(false);
  });
});

describe('keyboard and reason handling', () => {
  it('Escape closes the panel and returns focus to the Edit button', () => {
    const { toggle, panel, minutes, onCorrect } = mount();
    toggle.click();
    minutes.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
    expect(onCorrect).not.toHaveBeenCalled();
  });

  it('saves the quick-pick chosen LAST, not text left in the Other box from earlier', () => {
    const { reasonRadio, other, save, onCorrect } = mount();
    reasonRadio('Other').click();
    other.value = 'Judge started the clock late';
    reasonRadio('Wrong cupper').click();
    save.click();
    expect(onCorrect).toHaveBeenCalledWith('e1', 200, 'Wrong cupper', expect.any(Function));
  });

  it('saves the typed text when Other is the choice, not a quick pick chosen earlier', () => {
    const { reasonRadio, other, save, onCorrect } = mount();
    reasonRadio('Wrong cupper').click();
    reasonRadio('Other').click();
    other.value = 'Judge started the clock late';
    save.click();
    expect(onCorrect).toHaveBeenCalledWith(
      'e1',
      200,
      'Judge started the clock late',
      expect.any(Function),
    );
  });
});

describe('drafts survive a screen re-render', () => {
  function rebuild() {
    // What a screen's render() does: throw the DOM away and build it again.
    host.innerHTML = '';
    const again = mount();
    return again;
  }

  it('captures only the editors that are open, with what is typed in them', () => {
    const first = mount();
    expect(captureCorrectionDrafts(host)).toEqual([]);
    first.toggle.click();
    first.minutes.value = '4';
    first.seconds.value = '5';
    first.reasonRadio('Other').click();
    first.other.value = 'Wrong heat';
    expect(captureCorrectionDrafts(host)).toEqual([
      {
        entryId: 'e1',
        minutes: '4',
        seconds: '5',
        recorded: 200,
        edited: true,
        reason: '__other__',
        other: 'Wrong heat',
        // Opening the editor put focus in the minutes field, and it is still there.
        focused: 'minutes',
      },
    ]);
  });

  it('reopens the rebuilt editor with the same time and reason, without taking focus', () => {
    const first = mount();
    first.toggle.click();
    first.minutes.value = '4';
    first.seconds.value = '5';
    first.reasonRadio('Other').click();
    first.other.value = 'Wrong heat';
    document.activeElement.blur(); // nothing in the editor has focus when the screen re-renders
    const drafts = captureCorrectionDrafts(host);

    const again = rebuild();
    expect(again.panel.hidden).toBe(true);
    const outside = document.createElement('button');
    host.append(outside);
    outside.focus();
    restoreCorrectionDrafts(host, drafts);

    expect(again.panel.hidden).toBe(false);
    expect(again.toggle.hidden).toBe(true);
    expect(again.toggle.getAttribute('aria-expanded')).toBe('true');
    expect([again.minutes.value, again.seconds.value]).toEqual(['4', '5']);
    expect(again.reasonRadio('Other').checked).toBe(true);
    expect(again.other.hidden).toBe(false);
    expect(again.other.value).toBe('Wrong heat');
    expect(document.activeElement).toBe(outside);
  });

  it('restores a quick-pick reason too, and leaves the Other box hidden', () => {
    const first = mount();
    first.toggle.click();
    first.reasonRadio('Wrong cupper').click();
    const drafts = captureCorrectionDrafts(host);
    const again = rebuild();
    restoreCorrectionDrafts(host, drafts);
    expect(again.reasonRadio('Wrong cupper').checked).toBe(true);
    expect(again.other.hidden).toBe(true);
  });

  it('skips the row whose correction just went through', () => {
    const first = mount();
    first.toggle.click();
    first.reasonRadio('Wrong cupper').click();
    const drafts = captureCorrectionDrafts(host);
    const again = rebuild();
    restoreCorrectionDrafts(host, drafts, { skipEntryId: 'e1' });
    expect(again.panel.hidden).toBe(true);
    expect(again.toggle.hidden).toBe(false);
  });

  it('does nothing, and does not throw, for a row that no longer has an editor', () => {
    const first = mount();
    first.toggle.click();
    const drafts = captureCorrectionDrafts(host);
    host.innerHTML = '';
    expect(() => restoreCorrectionDrafts(host, drafts)).not.toThrow();
  });
});

describe('saving state', () => {
  it('a second click while a save is in flight is ignored, and the busy state is in the accessible name', () => {
    const { reasonRadio, save, onCorrect } = mount();
    reasonRadio('Wrong cupper').click();
    save.click();
    expect(save.getAttribute('aria-label')).toBe('Saving correction, Cupper One');
    expect(save.getAttribute('aria-busy')).toBe('true');
    // aria-disabled, not `disabled`: the button keeps focus and stays discoverable.
    expect(save.disabled).toBe(false);
    save.click();
    expect(onCorrect).toHaveBeenCalledTimes(1);
    onCorrect.mock.calls[0][3]();
    expect(save.getAttribute('aria-label')).toBe('Save correction, Cupper One');
    expect(save.hasAttribute('aria-busy')).toBe(false);
  });
});

describe('a correction that is waiting to sync', () => {
  it('is built parked when the outbox says so — the old time is not offered again', () => {
    const { toggle, panel } = renderTimeCorrection(entry, { onCorrect: vi.fn(), queued: true });
    host.append(toggle, panel);
    expect(toggle.textContent).toBe('Waiting to sync');
    expect(toggle.getAttribute('aria-label')).toBe('Waiting to sync, Cupper One');
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    // Not `disabled`: it stays in the tab order so a keyboard user can find out why.
    expect(toggle.disabled).toBe(false);
    toggle.click();
    expect(panel.hidden).toBe(true);
  });

  it('a parked button after done({ queued: true }) does not reopen on click either', () => {
    const onCorrect = vi.fn();
    const parts = mount(onCorrect);
    parts.toggle.click();
    parts.reasonRadio('Missed the stop').click();
    parts.save.click();
    onCorrect.mock.calls[0][3]({ queued: true });
    parts.toggle.click();
    expect(parts.panel.hidden).toBe(true);
  });
});

describe('restoring a draft safely', () => {
  function rebuildWith(overrides) {
    host.innerHTML = '';
    const { toggle, panel } = renderTimeCorrection(
      { ...entry, ...overrides },
      { onCorrect: vi.fn() },
    );
    host.append(toggle, panel);
    const [minutes, seconds] = panel.querySelectorAll('.time-correction-input');
    return {
      toggle,
      panel,
      minutes,
      seconds,
      radio: (label) =>
        [...panel.querySelectorAll('label.time-correction-reason')]
          .find((l) => l.textContent === label)
          .querySelector('input'),
    };
  }

  it('does not write an old time over another device’s correction: the typed time only comes back if the recorded time is the one it was typed against', () => {
    const first = mount();
    first.toggle.click();
    first.minutes.value = '4'; // the person typed a new time against 3:20…
    first.seconds.value = '5';
    first.reasonRadio('Wrong cupper').click();
    const drafts = captureCorrectionDrafts(host);

    // …but another device has since corrected the time to 2:30.
    const again = rebuildWith({ elapsed_secs: 150 });
    restoreCorrectionDrafts(host, drafts);

    expect(again.panel.hidden).toBe(false);
    expect([again.minutes.value, again.seconds.value]).toEqual(['2', '30']); // fresh prefill stands
    expect(again.radio('Wrong cupper').checked).toBe(true); // the reason still comes back
  });

  it('an editor nobody had changed comes back with the CURRENT recorded time, not the stale prefill', () => {
    const first = mount();
    first.toggle.click(); // opened, nothing typed: still showing the old 3:20 prefill
    const drafts = captureCorrectionDrafts(host);
    expect(drafts[0].edited).toBe(false);

    const again = rebuildWith({ elapsed_secs: 150 });
    restoreCorrectionDrafts(host, drafts);
    expect([again.minutes.value, again.seconds.value]).toEqual(['2', '30']);
  });

  it('puts focus back in the field that had it, and says so', () => {
    const first = mount();
    first.toggle.click(); // focuses the minutes input
    first.seconds.focus();
    const drafts = captureCorrectionDrafts(host);
    expect(drafts[0].focused).toBe('seconds');

    const again = rebuildWith({});
    expect(restoreCorrectionDrafts(host, drafts)).toBe(true);
    expect(document.activeElement).toBe(again.seconds);
  });

  it('restores focus on a radio', () => {
    const first = mount();
    first.toggle.click();
    first.reasonRadio('Wrong cupper').focus();
    const drafts = captureCorrectionDrafts(host);
    expect(drafts[0].focused).toBe('radio:Wrong cupper');
    const again = rebuildWith({});
    expect(restoreCorrectionDrafts(host, drafts)).toBe(true);
    expect(document.activeElement).toBe(again.radio('Wrong cupper'));
  });

  it('restores focus on the Other box', () => {
    const first = mount();
    first.toggle.click();
    first.reasonRadio('Other').click();
    first.other.focus();
    const drafts = captureCorrectionDrafts(host);
    expect(drafts[0].focused).toBe('other');
    const again = rebuildWith({});
    expect(restoreCorrectionDrafts(host, drafts)).toBe(true);
    expect(document.activeElement).toBe(again.panel.querySelector('.time-correction-other'));
  });

  it('reports no focus restored when nothing in the editor had focus', () => {
    const first = mount();
    first.toggle.click();
    document.activeElement?.blur?.();
    const drafts = captureCorrectionDrafts(host);
    rebuildWith({});
    expect(restoreCorrectionDrafts(host, drafts)).toBe(false);
  });
});

describe('drafts and the states that must not be resurrected', () => {
  it('an editor whose Save is in flight is not captured — it would come back with a fresh, enabled Save', () => {
    const { toggle, reasonRadio, save } = mount();
    toggle.click();
    reasonRadio('Wrong cupper').click();
    save.click(); // in flight: nobody has called done() yet
    expect(captureCorrectionDrafts(host)).toEqual([]);
  });

  it('a parked row declines a restored draft — the old time is not offered again', () => {
    const first = mount();
    first.toggle.click();
    first.reasonRadio('Wrong cupper').click();
    const drafts = captureCorrectionDrafts(host);

    host.innerHTML = '';
    const { toggle, panel } = renderTimeCorrection(entry, { onCorrect: vi.fn(), queued: true });
    host.append(toggle, panel);
    expect(restoreCorrectionDrafts(host, drafts)).toBe(false);
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
  });
});

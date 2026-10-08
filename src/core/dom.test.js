import { describe, it, expect } from 'vitest';
import {
  el,
  labeledField,
  brandMark,
  setBusyDisabled,
  withFocusPreservation,
  passwordToggle,
  brandLockup,
} from './dom.js';

describe('el', () => {
  it('creates an element with the given tag', () => {
    expect(el('div').tagName).toBe('DIV');
  });

  it('sets className, id, and text via textContent — never innerHTML', () => {
    const node = el('p', { className: 'card', id: 'my-id', text: '<b>not markup</b>' });
    expect(node.className).toBe('card');
    expect(node.id).toBe('my-id');
    expect(node.textContent).toBe('<b>not markup</b>');
    expect(node.querySelector('b')).toBeNull();
  });

  it('sets arbitrary attributes', () => {
    const node = el('input', { attrs: { type: 'number', 'aria-label': 'Heat number' } });
    expect(node.getAttribute('type')).toBe('number');
    expect(node.getAttribute('aria-label')).toBe('Heat number');
  });

  it('appends children in order', () => {
    const child1 = el('span', { text: 'a' });
    const child2 = el('span', { text: 'b' });
    const parent = el('div', {}, [child1, child2]);
    expect([...parent.children]).toEqual([child1, child2]);
  });

  it('omits text/className/id/attrs entirely when not given, without throwing', () => {
    const node = el('div');
    expect(node.textContent).toBe('');
    expect(node.className).toBe('');
    expect(node.id).toBe('');
  });
});

describe('labeledField', () => {
  it('wraps the input with a visible, aria-hidden label', () => {
    const input = el('input', { attrs: { 'aria-label': 'Name' } });
    const field = labeledField('Name', input);
    expect(field.className).toBe('form-field');
    const label = field.querySelector('.form-field-label');
    expect(label.textContent).toBe('Name');
    expect(label.getAttribute('aria-hidden')).toBe('true');
    expect(field.contains(input)).toBe(true);
  });

  it('appends any extra nodes after the input', () => {
    const input = el('input');
    const hint = el('p', { className: 'form-field-hint', text: 'A hint' });
    const field = labeledField('Label', input, [hint]);
    expect([...field.children].at(-1)).toBe(hint);
  });

  it('omits extra nodes entirely when none are given', () => {
    const input = el('input');
    const field = labeledField('Label', input);
    expect(field.children).toHaveLength(2); // label span + input, no third child
  });
});

describe('setBusyDisabled', () => {
  it('sets aria-disabled and aria-busy, never the native disabled property', () => {
    const node = el('button');
    setBusyDisabled(node, true);
    expect(node.disabled).toBe(false);
    expect(node.getAttribute('aria-disabled')).toBe('true');
    expect(node.getAttribute('aria-busy')).toBe('true');
  });

  it('removes both attributes when not busy', () => {
    const node = el('button');
    setBusyDisabled(node, true);
    setBusyDisabled(node, false);
    expect(node.hasAttribute('aria-disabled')).toBe(false);
    expect(node.hasAttribute('aria-busy')).toBe(false);
  });

  it('a busy-marked control stays focusable, unlike native disabled', () => {
    const node = el('button');
    document.body.appendChild(node);
    setBusyDisabled(node, true);
    node.focus();
    expect(document.activeElement).toBe(node);
    document.body.removeChild(node);
  });
});

describe('withFocusPreservation', () => {
  it('restores focus, by data-focus-key, to the equivalent control after a full teardown/rebuild', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.appendChild(el('button', { attrs: { 'data-focus-key': 'submit' } }));
    root.querySelector('[data-focus-key="submit"]').focus();
    expect(document.activeElement).toBe(root.querySelector('[data-focus-key="submit"]'));

    withFocusPreservation(root, () => {
      root.innerHTML = '';
      root.appendChild(el('button', { attrs: { 'data-focus-key': 'submit' } }));
    });

    expect(document.activeElement).toBe(root.querySelector('[data-focus-key="submit"]'));
    document.body.removeChild(root);
  });

  it('falls back to data-field when data-focus-key is absent', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.appendChild(el('input', { attrs: { 'data-field': 'email' } }));
    root.querySelector('[data-field="email"]').focus();

    withFocusPreservation(root, () => {
      root.innerHTML = '';
      root.appendChild(el('input', { attrs: { 'data-field': 'email' } }));
    });

    expect(document.activeElement).toBe(root.querySelector('[data-field="email"]'));
    document.body.removeChild(root);
  });

  it('falls back to id when neither data-focus-key nor data-field is present', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.appendChild(el('input', { id: 'gtb-orientation' }));
    root.querySelector('#gtb-orientation').focus();

    withFocusPreservation(root, () => {
      root.innerHTML = '';
      root.appendChild(el('input', { id: 'gtb-orientation' }));
    });

    expect(document.activeElement).toBe(root.querySelector('#gtb-orientation'));
    document.body.removeChild(root);
  });

  it('does nothing when renderFn reports it already moved focus itself', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.appendChild(el('button', { attrs: { 'data-focus-key': 'submit' } }));
    root.querySelector('[data-focus-key="submit"]').focus();

    withFocusPreservation(root, () => {
      root.innerHTML = '';
      const heading = el('h1', { text: 'Error', attrs: { tabindex: '-1' } });
      root.appendChild(heading);
      heading.focus();
      return true;
    });

    expect(document.activeElement).toBe(root.querySelector('h1'));
    document.body.removeChild(root);
  });

  it('is a no-op when nothing inside root had focus beforehand', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    withFocusPreservation(root, () => {
      root.innerHTML = '';
      root.appendChild(el('button', { attrs: { 'data-focus-key': 'x' } }));
    });

    expect(document.activeElement).toBe(outside);
    document.body.removeChild(root);
    document.body.removeChild(outside);
  });
});

describe('brandMark', () => {
  it('builds a real SVG element (createElementNS, not el()) with the right namespace and shape', () => {
    const svg = brandMark();
    expect(svg.tagName).toBe('svg');
    // A plain el()/createElement build would land in the HTML namespace,
    // not SVG — the specific failure mode this test guards against
    // (createElement('svg') vs. createElementNS(SVG_NS, 'svg') look
    // identical by tagName alone, so this checks the namespace directly).
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.getAttribute('aria-label')).toBe('Seduh');
    expect(svg.querySelectorAll('path')).toHaveLength(3);
    expect(svg.querySelector('circle')).not.toBeNull();
  });

  it('uses currentColor throughout, never a hardcoded color — every consumer recolors it via CSS on the parent', () => {
    const svg = brandMark();
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.querySelector('circle').getAttribute('fill')).toBe('currentColor');
  });

  it('returns a fresh node on each call, not a shared/cached one — three simultaneous consumers must not fight over one DOM node', () => {
    expect(brandMark()).not.toBe(brandMark());
  });
});

describe('passwordToggle', () => {
  const inputs = () =>
    [document.createElement('input'), document.createElement('input')].map((i) => {
      i.type = 'password';
      return i;
    });

  it('is a plain button (it must not submit a form) with a polite status line, starting hidden', () => {
    const [a] = inputs();
    const [button, status] = passwordToggle([a]);
    expect(button.type).toBe('button');
    expect(button.textContent).toBe('Show');
    expect(button.getAttribute('aria-label')).toBe('Show password');
    expect(button.hasAttribute('aria-pressed')).toBe(false);
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('');
    expect(a.type).toBe('password');
  });

  it('keeps the 44px tap-target class and hides the status line visually, not from the accessibility tree', () => {
    const [button, status] = passwordToggle(inputs());
    expect(button.classList.contains('tap-target')).toBe(true);
    expect(status.classList.contains('sr-only')).toBe(true);
  });

  it('can start shown', () => {
    const [a] = inputs();
    const [button] = passwordToggle([a], { shown: true });
    expect(a.type).toBe('text');
    expect(button.textContent).toBe('Hide');
    expect(button.getAttribute('aria-label')).toBe('Hide password');
  });

  it('flips every input it is given, in place, announcing each change', () => {
    const [a, b] = inputs();
    a.value = 'one';
    b.value = 'two';
    const [button, status] = passwordToggle([a, b]);
    button.click();
    expect([a.type, b.type]).toEqual(['text', 'text']);
    expect([a.value, b.value]).toEqual(['one', 'two']);
    expect(status.textContent).toBe('Password is shown');
    button.click();
    expect([a.type, b.type]).toEqual(['password', 'password']);
    expect(status.textContent).toBe('Password is hidden');
  });

  it('tells the caller the new state, and works with no callback at all', () => {
    const [a] = inputs();
    const calls = [];
    const [button] = passwordToggle([a], { onToggle: (shown) => calls.push(shown) });
    button.click();
    button.click();
    expect(calls).toEqual([true, false]);
    const [bare] = passwordToggle([a]);
    expect(() => bare.click()).not.toThrow();
  });
});

describe('brandLockup', () => {
  it('is one unit: a decorative mark and the wordmark text, in that order', () => {
    const lockup = brandLockup();
    expect(lockup.className).toBe('brand-lockup');
    const [mark, name] = lockup.children;
    expect(mark.className).toBe('brand-lockup-mark');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.querySelector('svg')).not.toBeNull();
    expect(name.className).toBe('brand-lockup-name');
    expect(name.textContent).toBe('Seduh Score');
    expect(lockup.children).toHaveLength(2);
  });

  it('takes a different name, and extra hook classes for the caller, without losing the shared ones', () => {
    const lockup = brandLockup({ name: 'Custom', markClass: 'my-mark', nameClass: 'my-name' });
    expect(lockup.querySelector('.brand-lockup-mark.my-mark')).not.toBeNull();
    expect(lockup.querySelector('.brand-lockup-name.my-name').textContent).toBe('Custom');
  });

  it('builds a fresh lockup each time', () => {
    expect(brandLockup()).not.toBe(brandLockup());
  });

  it('is plain inline spans (it sits inside links and headings) and never hides the name from assistive tech', () => {
    const lockup = brandLockup();
    const [mark, name] = lockup.children;
    expect([lockup, mark, name].map((node) => node.tagName)).toEqual(['SPAN', 'SPAN', 'SPAN']);
    expect(lockup.hasAttribute('aria-hidden')).toBe(false);
    expect(name.hasAttribute('aria-hidden')).toBe(false);
  });

  it('puts the name in text, never markup', () => {
    const lockup = brandLockup({ name: '<b>x</b>' });
    expect(lockup.querySelector('b')).toBeNull();
    expect(lockup.querySelector('.brand-lockup-name').textContent).toBe('<b>x</b>');
  });
});

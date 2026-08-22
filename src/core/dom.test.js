import { describe, it, expect } from 'vitest';
import { el } from './dom.js';

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

// The person-page placeholder: no data call, and nothing in it depends on which handle the path names, so a real
// handle and an unknown one look the same (worker/index.js serves this one shell for both).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountProfilePlaceholder } from './profileScreen.js';

afterEach(() => vi.unstubAllGlobals());

function mounted() {
  const root = document.createElement('div');
  mountProfilePlaceholder(root);
  return root;
}

describe('mountProfilePlaceholder', () => {
  it('makes no network call', () => {
    const outbound = vi.fn(() => Promise.reject(new Error('no data call')));
    vi.stubGlobal('fetch', outbound);
    mounted();
    expect(outbound).not.toHaveBeenCalled();
  });

  it('is identical whatever the path says', () => {
    window.history.pushState({}, '', '/id/real-person/');
    const real = mounted().innerHTML;
    window.history.pushState({}, '', '/id/nobody-here/');
    expect(mounted().innerHTML).toBe(real);
  });

  it('has one h1 and puts the header and footer beside <main> as landmarks', () => {
    const root = mounted();
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelector('h1').textContent).toBe('Seduh ID profile');
    const main = root.querySelector('main');
    expect(main).not.toBeNull();
    expect(main.querySelector('header, footer')).toBeNull();
    expect(root.querySelector('header')).not.toBeNull();
    expect(root.querySelector('footer')).not.toBeNull();
  });
});

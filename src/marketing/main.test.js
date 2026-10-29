import { describe, it, expect, vi } from 'vitest';

const findLatestPublishedResult = vi.fn();
vi.mock('../core/publicResults.js', () => ({ findLatestPublishedResult }));

describe('landing entry (main.js)', () => {
  it('makes no Supabase request when run inside the build-time prerender (a jsdom window)', async () => {
    // Vitest's jsdom window reports a jsdom user agent, exactly like the prerender's window.
    expect(window.navigator.userAgent).toMatch(/jsdom/i);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    document.body.innerHTML = '<div id="app"></div>';
    await import('./main.js');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(findLatestPublishedResult).not.toHaveBeenCalled();
    expect(document.querySelector('.petrol-story')).not.toBeNull();
    expect(document.querySelector('.petrol-story-latest')).toBeNull();
  });
});

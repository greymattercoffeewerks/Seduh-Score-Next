import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_VERSION, NAMEPLATE } from '../core/version.js';
import { enhanceBts, TOPICS } from './bts.js';

// bts/index.html is static HTML (every chapter, readable with no script); bts.js turns it into a one-chapter
// reader. These tests load the real page, so a content edit that breaks the reader's assumptions fails here.
const PAGE = readFileSync('bts/index.html', 'utf8');
const CSS = readFileSync('src/marketing/bts.css', 'utf8');

function load() {
  const parsed = new DOMParser().parseFromString(PAGE, 'text/html');
  document.body.className = parsed.body.className;
  document.body.innerHTML = parsed.body.innerHTML;
  window.history.replaceState(null, '', '/bts/');
  return document.body;
}

const visible = (root, selector) =>
  [...root.querySelectorAll(selector)].filter((n) => !n.closest('[hidden]'));
const chapterIds = (root) => [...root.querySelectorAll('.bts-chapter')].map((c) => c.id);
const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
};

describe('Behind the Seduh: the page agrees with the app (the Gadong-to-Kiarong miss)', () => {
  const root = new DOMParser().parseFromString(PAGE, 'text/html');
  const major = APP_VERSION.split('.')[0];

  it('the current cycle on the rail is NAMEPLATE, with the same major version', () => {
    const current = root.querySelectorAll('.bts-cycle[data-current]');
    expect(current).toHaveLength(1);
    expect(current[0].querySelector('.bts-cycle-place').textContent).toBe(NAMEPLATE);
    expect(current[0].querySelector('.bts-cycle-ver').textContent).toMatch(
      new RegExp(`^v${major}\\.x `),
    );
  });

  it('the Current tag sits on that cycle and the scoreboard, nowhere else', () => {
    const tags = [...root.querySelectorAll('.bts-current')];
    expect(tags).toHaveLength(2);
    expect(tags.filter((t) => t.closest('.bts-cycle[data-current]'))).toHaveLength(1);
    expect(tags.filter((t) => t.closest('.bts-board'))).toHaveLength(1);
  });

  it('the scoreboard names NAMEPLATE and a version on the same major', () => {
    expect(root.querySelector('[data-bts-place]').textContent).toBe(NAMEPLATE);
    expect(root.querySelector('[data-bts-version]').textContent).toMatch(
      new RegExp(`^v${major}\\.\\d+\\.\\d+$`),
    );
  });

  it("the current cycle's newest chapter is the page's first chapter", () => {
    const first = root.querySelector('.bts-chapter');
    expect(first.closest('.bts-cycle-group').dataset.cycle).toBe(NAMEPLATE.toLowerCase());
  });
});

describe('Behind the Seduh: the static content', () => {
  const root = new DOMParser().parseFromString(PAGE, 'text/html');

  it('every chapter id is unique and every rail link points at a chapter of its own cycle', () => {
    const ids = chapterIds(root);
    expect(new Set(ids).size).toBe(ids.length);
    const links = root.querySelectorAll('a.bts-cycle');
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const link of links) {
      const target = root.getElementById(link.getAttribute('href').slice(1));
      expect(target.closest('.bts-cycle-group').dataset.cycle).toBe(link.dataset.cycle);
    }
  });

  it('every entry has a name, a Felt like line, Shipped text and only known topics', () => {
    const entries = root.querySelectorAll('.bts-entry');
    expect(entries.length).toBeGreaterThan(30);
    for (const entry of entries) {
      expect(entry.querySelector('.bts-entry-name').textContent.trim()).not.toBe('');
      expect(entry.querySelector('.bts-felt-v').textContent.trim()).not.toBe('');
      expect(entry.querySelector('.bts-ship-v').textContent.trim()).not.toBe('');
      expect(entry.dataset.tags).toBeTruthy();
      for (const tag of entry.dataset.tags.split('|')) expect(TOPICS).toContain(tag);
    }
  });

  it('the scoreboard entry count matches the entries on the page', () => {
    const stat = [...root.querySelectorAll('.bts-stats div')].find(
      (d) => d.querySelector('dt').textContent === 'log entries',
    );
    expect(Number(stat.querySelector('dd').textContent)).toBe(
      root.querySelectorAll('.bts-entry').length,
    );
  });

  it('links the shared Petrol V2 tokens, not a copy of them', () => {
    const sheets = [...root.querySelectorAll('link[rel="stylesheet"]')].map((l) =>
      l.getAttribute('href'),
    );
    expect(sheets).toEqual(['/src/ui/tokens/index.css', '/src/marketing/bts.css']);
    expect(root.querySelectorAll('style')).toHaveLength(0);
  });

  it('every in-page link lands on something that exists', () => {
    const links = root.querySelectorAll('a[href^="#"]');
    expect(links.length).toBeGreaterThan(5);
    for (const a of links) {
      expect(root.getElementById(a.getAttribute('href').slice(1))).not.toBeNull();
    }
  });

  it('keeps the formats that have not run live honest', () => {
    const text = root.body.textContent.replace(/\s+/g, ' ');
    expect(text).toContain('Throwdown has not yet been run at a live event');
    expect(text).toMatch(/no screen for it yet/);
  });
});

describe('Behind the Seduh: the reader', () => {
  let root;
  let reader;
  beforeEach(() => {
    root = load();
    reader = enhanceBts(root, window);
  });
  afterEach(() => reader?.destroy());

  it('with no hash, shows only the newest chapter, in the current cycle', () => {
    const shown = visible(root, '.bts-chapter');
    expect(shown.map((c) => c.id)).toEqual([chapterIds(root)[0]]);
    const selected = root.querySelectorAll('.bts-cycle[aria-current="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0].dataset.cycle).toBe(NAMEPLATE.toLowerCase());
  });

  it('a cycle tab opens that cycle at its newest chapter and lists only its chapters', () => {
    root.querySelector('.bts-cycle[data-cycle="kiulap"]').click();
    expect(visible(root, '.bts-chapter').map((c) => c.id)).toEqual(['ms-kiulap']);
    const listed = [...root.querySelectorAll('.bts-ch')].map((b) => b.dataset.chapter);
    expect(listed).toEqual(['ms-kiulap']);
    expect(window.location.hash).toBe('#ms-kiulap');
  });

  it('older and newer walk the chapters in page order, across cycles', () => {
    const ids = chapterIds(root);
    root.querySelector('.bts-pg.is-older').click();
    expect(visible(root, '.bts-chapter')[0].id).toBe(ids[1]);
    reader.go(ids[ids.length - 1]);
    expect(root.querySelector('.bts-pg.is-older')).toBeNull();
    root.querySelector('.bts-pg.is-newer').click();
    expect(visible(root, '.bts-chapter')[0].id).toBe(ids[ids.length - 2]);
  });

  it('a chapter link elsewhere on the page opens that chapter in the reader', () => {
    root.querySelector('.bts-facts a[href="#ms-gadong-live"]').click();
    expect(visible(root, '.bts-chapter').map((c) => c.id)).toEqual(['ms-gadong-live']);
    expect(root.querySelector('.bts-cycle[aria-current="true"]').dataset.cycle).toBe('gadong');
  });

  it('an old link to a chapter that moved still lands on it, on page load', () => {
    reader.destroy();
    root = load();
    window.history.replaceState(null, '', '/bts/#ms-gadong-throwdown');
    reader = enhanceBts(root, window);
    expect(visible(root, '.bts-chapter').map((c) => c.id)).toEqual(['ms-kiarong-throwdown']);
    expect(window.location.hash).toBe('#ms-kiarong-throwdown');
  });

  it('keyboard focus survives the rebuild: a chapter button keeps it, older moves it to the heading', () => {
    const second = root.querySelectorAll('.bts-ch')[1];
    const id = second.dataset.chapter;
    second.focus();
    second.click();
    expect(document.activeElement.dataset.chapter).toBe(id);
    root.querySelector('.bts-pg.is-older').click();
    expect(document.activeElement.classList.contains('bts-chapter-title')).toBe(true);
    expect(document.activeElement.closest('.bts-chapter').hidden).toBe(false);
  });

  it('the chapter being read is marked in the list by more than colour, hidden from screen readers', () => {
    const current = root.querySelector('.bts-ch[aria-current="true"] .bts-ch-title');
    const mark = current.querySelector('[aria-hidden="true"]');
    expect(mark.textContent.trim()).toBe('▸');
    const others = root.querySelectorAll(
      '.bts-ch[aria-current="false"] .bts-ch-title [aria-hidden]',
    );
    expect(others).toHaveLength(0);
  });

  it('Clear returns focus to search from the keyboard only', () => {
    const search = root.querySelector('#bts-search');
    type(search, 'btc');
    root
      .querySelector('.bts-result button')
      .dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
    expect(document.activeElement).not.toBe(search);
    type(search, 'btc');
    root.querySelector('.bts-result button').click();
    expect(document.activeElement).toBe(search);
  });

  it('search reaches across cycles, shows exactly the matching entries and says how many', () => {
    const term = 'btc';
    const titleOf = (e) =>
      e.closest('.bts-chapter').querySelector('.bts-chapter-title').textContent;
    const expected = [...root.querySelectorAll('.bts-entry')].filter((e) =>
      `${e.textContent} ${titleOf(e)}`.toLowerCase().includes(term),
    );
    const cycles = new Set(expected.map((e) => e.closest('.bts-cycle-group').dataset.cycle));
    expect(cycles.size).toBeGreaterThan(1);
    type(root.querySelector('#bts-search'), 'BTC');
    const entries = visible(root, '.bts-entry');
    expect(entries).toEqual(expected);
    expect(root.querySelector('.bts-result').textContent).toMatch(
      new RegExp(`^${entries.length} entr`),
    );
    expect(root.querySelectorAll('.bts-cycle[aria-current="true"]')).toHaveLength(0);
  });

  it('a search with no match shows the empty state, and clearing returns to the chapter', () => {
    const before = visible(root, '.bts-chapter')[0].id;
    type(root.querySelector('#bts-search'), 'zzz no such thing');
    expect(visible(root, '.bts-entry')).toHaveLength(0);
    expect(root.querySelector('.bts-empty').hidden).toBe(false);
    [...root.querySelectorAll('.bts-result button')][0].click();
    expect(visible(root, '.bts-chapter').map((c) => c.id)).toEqual([before]);
    expect(root.querySelector('#bts-search').value).toBe('');
  });

  it('a topic and Live now filter together', () => {
    root.querySelector('[data-topic="Formats"]').click();
    root.querySelector('[data-live]').click();
    const entries = visible(root, '.bts-entry');
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.dataset.tags.split('|')).toContain('Formats');
      expect(e.hasAttribute('data-live')).toBe(true);
    }
    const all = [...root.querySelectorAll('.bts-entry')].filter(
      (e) => e.dataset.tags.split('|').includes('Formats') && e.hasAttribute('data-live'),
    );
    expect(entries).toHaveLength(all.length);
  });

  it('long Shipped text folds behind a toggle that says what it does', () => {
    const folded = root.querySelector('.bts-ship-v.is-folded');
    expect(folded.textContent.length).toBeGreaterThan(320);
    const toggle = folded.closest('.bts-entry').querySelector('.bts-text-btn');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(folded.classList.contains('is-folded')).toBe(false);
    expect(toggle.textContent).toBe('Fold it back');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('does nothing harmful on a page without the reader', () => {
    document.body.innerHTML = '<p>nothing here</p>';
    expect(enhanceBts(document.body, window)).toBeNull();
  });
});

describe('Behind the Seduh: with no script', () => {
  it('every chapter of every cycle is in the markup, unhidden', () => {
    const root = new DOMParser().parseFromString(PAGE, 'text/html');
    const chapters = [...root.querySelectorAll('.bts-chapter')];
    expect(chapters.length).toBeGreaterThan(10);
    expect(chapters.every((c) => !c.hasAttribute('hidden'))).toBe(true);
  });
});

describe('Behind the Seduh: the stylesheet', () => {
  it('hides log content only under .bts-js (the reader) or [hidden]', () => {
    const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{[^{}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(50);
    const hiding = rules.filter(
      (r) =>
        /\.bts-(chapter|entry|cycle-group|ship-v|entries|pane)\b/.test(r.split('{')[0]) &&
        /display:\s*none|visibility:\s*hidden/.test(r),
    );
    for (const rule of hiding) expect(rule.split('{')[0]).toMatch(/\.bts-js|\[hidden\]/);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COMMUNITY_HUB_HREF, COMMUNITY_TOOLS, otherCommunityTools } from './communityTools.js';
import { buildCommunityToolChrome } from './toolChrome.js';
import { communityToolCard } from './toolCard.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('the list of community tools', () => {
  it('has unique ids and addresses, and a one-line pitch for each', () => {
    expect(new Set(COMMUNITY_TOOLS.map((tool) => tool.id)).size).toBe(COMMUNITY_TOOLS.length);
    expect(new Set(COMMUNITY_TOOLS.map((tool) => tool.href)).size).toBe(COMMUNITY_TOOLS.length);
    for (const tool of COMMUNITY_TOOLS) {
      expect(tool.title).toBeTruthy();
      expect(tool.body).toBeTruthy();
      expect(tool.eyebrow).toBeTruthy();
    }
  });

  it('offers a tool every tool but itself, and never the widget download', () => {
    expect(otherCommunityTools('random-selector').map((tool) => tool.id)).toEqual([
      'timer',
      'guess-the-bean',
      'brew-planner',
      'throwdown-planner',
    ]);
    expect(otherCommunityTools('timer').map((tool) => tool.id)).not.toContain('timer');
    expect(otherCommunityTools('timer').map((tool) => tool.id)).not.toContain(
      'guess-the-bean-widget',
    );
  });

  it('is the one source the hub cards and the strip both read', async () => {
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    await import('./communityHub.js');
    const cards = [...app.querySelectorAll('.community-tool-card')];
    expect(cards.map((card) => card.querySelector('h2').textContent)).toEqual(
      COMMUNITY_TOOLS.map((tool) => tool.title),
    );
    expect(cards.map((card) => card.getAttribute('href'))).toEqual(
      COMMUNITY_TOOLS.map((tool) => tool.href),
    );
    expect(cards.map((card) => card.querySelector('.community-card-body').textContent)).toEqual(
      COMMUNITY_TOOLS.map((tool) => tool.body),
    );

    // The strip on a tool page names the same tools with the same words as the hub does.
    const chrome = buildCommunityToolChrome({
      toolId: 'random-selector',
      toolName: 'Random Selector',
    });
    const stripCards = [...chrome.bottom.querySelectorAll('.ct-tool')];
    expect(stripCards).toHaveLength(4);
    for (const card of stripCards) {
      const tool = COMMUNITY_TOOLS.find((t) => t.href === card.getAttribute('href'));
      expect(tool).toBeDefined();
      expect(card.querySelector('.ct-tool-title').textContent).toBe(tool.title);
      expect(card.querySelector('.ct-tool-body').textContent).toBe(tool.body);
    }
  });
});

describe('the community tool chrome', () => {
  function build(options = {}) {
    const chrome = buildCommunityToolChrome({
      toolId: 'timer',
      toolName: 'Competition Timer',
      edition: 'Test edition',
      ...options,
    });
    document.body.append(chrome.top, chrome.bottom);
    return chrome;
  }

  it('gives a reusable frame without knowing the tool: header, breadcrumb, controls slot, strip, footer', () => {
    const chrome = build();
    expect(chrome.top.querySelector('.public-header')).not.toBeNull();
    const crumb = chrome.top.querySelector('nav[aria-label="Breadcrumb"]');
    expect(crumb.textContent).toBe('Community Tools/Competition Timer');
    expect(crumb.querySelector('a').getAttribute('href')).toBe(COMMUNITY_HUB_HREF);
    expect(crumb.querySelector('[aria-current="page"]').textContent).toBe('Competition Timer');
    expect(chrome.controls.closest('.ct-bar')).not.toBeNull();
    expect(chrome.bottom.querySelector('.ct-footer').textContent).toBe(
      'Seduh Score · Free community tools, no account needed' + 'Competition Timer · Test edition',
    );
  });

  it('leaves the current tool out of its own strip, and links the rest by their hub names', () => {
    const chrome = build({ toolId: 'timer' });
    const titles = [...chrome.bottom.querySelectorAll('.ct-tool-title')].map((n) => n.textContent);
    expect(titles).toEqual([
      'Guess the Bean',
      'Brew Planner',
      'Random Selector',
      'Throwdown Bracket Planner',
    ]);
    expect(chrome.bottom.querySelector('.ct-tool-open').textContent).toBe('Open Guess the Bean →');
    expect(chrome.bottom.querySelector('.ct-strip-all').getAttribute('href')).toBe('/community/');
    expect(chrome.bottom.querySelector('h2').textContent).toBe('Running an event? These help too.');
  });

  it('puts the header on the stage surface, whatever the tool page is', () => {
    const chrome = build();
    expect(chrome.top.querySelector('.ct-header').getAttribute('data-surface')).toBe('stage');
    expect(chrome.bottom.querySelector('.ct-strip').getAttribute('data-surface')).toBe('stage');
  });

  it('hides everything but the controls while presenting, and shows it again after', () => {
    const chrome = build();
    chrome.controls.append(document.createElement('button'));
    chrome.setPresenting(true);
    expect(chrome.top.querySelector('.ct-header').hidden).toBe(true);
    expect(chrome.top.querySelector('.ct-crumbs').hidden).toBe(true);
    expect(chrome.bottom.querySelector('.ct-strip').hidden).toBe(true);
    expect(chrome.bottom.querySelector('.ct-footer').hidden).toBe(true);
    // The row and its controls stay, and the brand fills in for the hidden header.
    expect(chrome.controls.closest('.ct-bar').hidden).toBe(false);
    expect(chrome.top.querySelector('.ct-present-brand').hidden).toBe(false);
    chrome.setPresenting(false);
    expect(chrome.top.querySelector('.ct-header').hidden).toBe(false);
    expect(chrome.top.querySelector('.ct-present-brand').hidden).toBe(true);
  });

  it('drops the whole bar, brand and controls included, when the tool has no controls to keep', () => {
    const chrome = build();
    chrome.setPresenting(true, { keepBar: false });
    expect(chrome.top.querySelector('.ct-bar').hidden).toBe(true);
    expect(chrome.top.querySelector('.ct-header').hidden).toBe(true);
    expect(chrome.bottom.querySelector('.ct-strip').hidden).toBe(true);
    expect(chrome.top.querySelector('.ct-present-brand').hidden).toBe(true);
    chrome.setPresenting(false, { keepBar: false });
    expect(chrome.top.querySelector('.ct-bar').hidden).toBe(false);
  });

  it('keeps two builds independent, with no shared state', () => {
    const first = buildCommunityToolChrome({ toolId: 'timer', toolName: 'A' });
    const second = buildCommunityToolChrome({ toolId: 'brew-planner', toolName: 'B' });
    first.setPresenting(true);
    expect(second.top.querySelector('.ct-header').hidden).toBe(false);
  });
});

describe('the tool entries that adopt the chrome', () => {
  // vitest runs from the repo root. A tool that builds the chrome but whose HTML entry forgets one of the two sheets
  // renders an unstyled header and strip, and no unit test of the DOM would notice.
  const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');
  const sheets = (html) =>
    [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
  const FRAMED = [
    [
      'random-selector',
      'tools/random-selector/index.html',
      '/src/tools/random-selector/randomSelector.css',
    ],
    [
      'throwdown-planner',
      'tools/throwdown-planner/index.html',
      '/src/community/throwdown-planner/throwdownPlanner.css',
    ],
    ['timer', 'tools/timer/index.html', '/src/tools/timer/timer.css'],
    ['brew-planner', 'tools/brew-planner/index.html', '/src/tools/brew-planner/brewPlanner.css'],
    ['guess-the-bean', 'guess-the-bean/index.html', '/src/community/guess-the-bean/shared.css'],
  ];

  it.each(FRAMED)(
    '%s links the header sheet, then the chrome sheet, then its own',
    (_id, entry, own) => {
      const links = sheets(read(entry));
      const header = links.indexOf('/src/marketing/publicHeader.css');
      const chrome = links.indexOf('/src/community/toolChrome.css');
      expect(header, 'publicHeader.css').toBeGreaterThan(-1);
      expect(chrome, 'toolChrome.css').toBeGreaterThan(header);
      expect(links.indexOf(own), 'the tool sheet').toBeGreaterThan(chrome);
    },
  );

  it('names every framed tool in the list the strip reads', () => {
    for (const [id] of FRAMED) {
      expect(
        COMMUNITY_TOOLS.some((t) => t.id === id),
        id,
      ).toBe(true);
    }
  });

  it('leaves the Guess the Bean live display and participant page without the frame', () => {
    for (const entry of ['guess-the-bean/display/index.html', 'guess-the-bean/play/index.html']) {
      expect(sheets(read(entry)), entry).not.toContain('/src/community/toolChrome.css');
    }
  });
});

describe('the community tool card', () => {
  const tool = COMMUNITY_TOOLS.find((t) => t.id === 'brew-planner');

  it('writes the same eyebrow, name, pitch and address in the hub card and the strip card', () => {
    const hub = communityToolCard(tool, { variant: 'hub' });
    const strip = communityToolCard(tool, { variant: 'strip' });
    for (const card of [hub, strip]) {
      expect(card.getAttribute('href')).toBe(tool.href);
      expect(card.textContent).toContain(tool.eyebrow);
      expect(card.textContent).toContain(tool.title);
      expect(card.textContent).toContain(tool.body);
    }
    expect(hub.querySelector('h2').textContent).toBe(tool.title);
    expect(strip.querySelector('.ct-tool-open').textContent).toBe(`Open ${tool.title} →`);
  });

  it('marks an external download as noopener and uses its own link text', () => {
    const widget = COMMUNITY_TOOLS.find((t) => t.external);
    const card = communityToolCard(widget, { variant: 'hub' });
    expect(card.getAttribute('rel')).toBe('noopener');
    expect(card.querySelector('.community-card-arrow').textContent).toBe(widget.arrowText);
  });

  it('refuses an unknown variant', () => {
    expect(() => communityToolCard(tool, { variant: 'x' })).toThrow(/unknown variant/);
  });
});

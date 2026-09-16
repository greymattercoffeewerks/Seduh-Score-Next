// Prerender stable public routes after Vite has produced its asset manifest.
// The generated HTML remains a normal client-rendered page for visitors; this
// build step only makes its initial content immediately crawlable.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const DIST_DIRECTORY = resolve('dist');
const ROUTES = [
  {
    output: 'index.html',
    url: 'https://www.seduhscore.com/',
    rootMarker: '<div class="petrol-page"',
    marker: 'One tablet',
  },
  {
    output: 'tour/index.html',
    url: 'https://www.seduhscore.com/tour/',
    rootMarker: '<main class="tour-page"',
    marker: 'A better way to ',
  },
  {
    output: 'community/index.html',
    url: 'https://www.seduhscore.com/community/',
    rootMarker: '<main class="community-hub"',
    marker: 'Useful on the ',
  },
  {
    output: 'tools/timer/index.html',
    url: 'https://www.seduhscore.com/tools/timer/',
    rootMarker: '<main class="timer"',
    marker: 'Seduh Timer',
  },
];
const GLOBAL_KEYS = [
  'document',
  'HTMLElement',
  'IntersectionObserver',
  'MutationObserver',
  'Node',
  'ResizeObserver',
  'SVGElement',
  'setInterval',
  'clearInterval',
  'window',
];

class NoopObserver {
  observe() {}

  disconnect() {}

  unobserve() {}
}

function matchMedia(query) {
  return {
    matches: query.includes('reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  };
}

async function prerenderRoute({ output, url, rootMarker, marker }) {
  const outputPath = resolve(DIST_DIRECTORY, output);
  const builtHtml = await readFile(outputPath, 'utf8');
  const outputDom = new JSDOM(builtHtml);
  const renderDom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url,
  });
  const previousGlobals = Object.fromEntries(GLOBAL_KEYS.map((key) => [key, globalThis[key]]));

  renderDom.window.matchMedia = matchMedia;
  Object.assign(globalThis, {
    document: renderDom.window.document,
    HTMLElement: renderDom.window.HTMLElement,
    IntersectionObserver: NoopObserver,
    MutationObserver: renderDom.window.MutationObserver,
    Node: renderDom.window.Node,
    ResizeObserver: NoopObserver,
    SVGElement: renderDom.window.SVGElement,
    setInterval: () => 0,
    clearInterval: () => {},
    window: renderDom.window,
  });

  try {
    const bundleSrc = outputDom.window.document
      .querySelector('script[type="module"]')
      ?.getAttribute('src');
    if (!bundleSrc?.startsWith('/assets/'))
      throw new Error(`Could not find the built bundle for /${output}.`);

    await import(pathToFileURL(resolve(DIST_DIRECTORY, bundleSrc.slice(1))).href);

    const renderedContent = renderDom.window.document.querySelector('#app').innerHTML;
    if (!renderedContent.includes(rootMarker) || !renderedContent.includes(marker)) {
      throw new Error(`Prerendered /${output} did not contain its expected public content.`);
    }

    outputDom.window.document.querySelector('#app').innerHTML = renderedContent;
    await writeFile(outputPath, outputDom.serialize(), 'utf8');
  } finally {
    Object.assign(globalThis, previousGlobals);
    renderDom.window.close();
    outputDom.window.close();
  }
}

for (const route of ROUTES) await prerenderRoute(route);

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// A shared link's preview comes from the page's og:image. Without one, WhatsApp and others fall back to the
// biggest icon they can find, which was the 32x32 favicon, stretched into a blotchy thumbnail (owner report,
// 2026-11-19, the Random Selector). So: every page that sets a share title also names a share image, the image
// is a real image file this site serves, and any size it declares (width and height together) is its real size.

const REPO = process.cwd();
const SITE = 'https://www.seduhscore.com/';
const SKIP = new Set([
  'node_modules',
  'dist',
  '.git',
  '.wrangler',
  'android',
  'supabase',
  'src',
  'tests',
  'public',
  '.claude',
]);

function pages(dir = REPO) {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...pages(full));
    else if (name === 'index.html') found.push(full);
  }
  return found;
}

const meta = (html, key) => {
  const tag = html.match(
    new RegExp(`<meta\\s+(?:property|name)="${key}"\\s+content="([^"]*)"`, 'i'),
  );
  return tag ? tag[1] : null;
};

// Width and height read from the file itself, so this test needs no image library: a PNG's IHDR chunk, or a
// JPEG's start-of-frame segment.
function imageSize(file) {
  const bytes = readFileSync(file);
  if (bytes.subarray(1, 4).toString('ascii') === 'PNG') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  expect(bytes.readUInt16BE(0), `${file} is neither a PNG nor a JPEG`).toBe(0xffd8);
  for (let at = 2; at + 9 < bytes.length;) {
    const marker = bytes.readUInt16BE(at);
    const length = bytes.readUInt16BE(at + 2);
    // SOF0 to SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker)) {
      return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
    }
    at += 2 + length;
  }
  throw new Error(`${file}: no JPEG frame header found`);
}

const all = pages().map((file) => ({ file, html: readFileSync(file, 'utf8') }));
const shared = all.filter(({ html }) => /og:title/.test(html));

describe('link previews', () => {
  it('finds the public pages that set a share title (the tools and the Community hub among them)', () => {
    const names = shared.map(({ file }) => relative(REPO, file).split(sep).join('/'));
    for (const page of [
      'tools/random-selector/index.html',
      'tools/timer/index.html',
      'tools/brew-planner/index.html',
      'community/index.html',
    ]) {
      expect(names).toContain(page);
    }
  });

  it.each(shared.map(({ file, html }) => [relative(REPO, file).split(sep).join('/'), html]))(
    '%s has a share title this test can read (a page is never dropped by the reader)',
    (_page, html) => {
      expect(meta(html, 'og:title')).toBeTruthy();
    },
  );

  it.each(shared.map(({ file, html }) => [relative(REPO, file).split(sep).join('/'), html]))(
    '%s names a share image this site serves',
    (_page, html) => {
      const image = meta(html, 'og:image');
      expect(image, 'og:image').toBeTruthy();
      expect(image.startsWith(SITE)).toBe(true);
      const served = join(REPO, 'public', image.slice(SITE.length));
      expect(existsSync(served) && statSync(served).isFile(), served).toBe(true);
      expect(served).toMatch(/\.(png|jpe?g)$/i);
      const width = meta(html, 'og:image:width');
      const height = meta(html, 'og:image:height');
      // Both or neither: one without the other is a half-declared size.
      expect(Boolean(width), 'og:image:width and og:image:height together').toBe(Boolean(height));
      if (width) {
        expect(imageSize(served)).toEqual({ width: Number(width), height: Number(height) });
      }
    },
  );

  it('serves a 180x180 touch icon at the root (Safari finds it there; the tool and Community pages also link it)', () => {
    expect(imageSize(join(REPO, 'public', 'apple-touch-icon.png'))).toEqual({
      width: 180,
      height: 180,
    });
  });
});

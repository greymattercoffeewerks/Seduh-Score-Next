import { describe, expect, it, vi } from 'vitest';
import {
  STORY_HEIGHT,
  STORY_WIDTH,
  drawStoryCard,
  qrMatrixFor,
  renderStoryCard,
  shareStoryCard,
  storyThemeFrom,
  wrapLines,
} from './storyCard.js';

// A context that records what is drawn and measures text as 10px a character.
function recordingContext() {
  const texts = [];
  const rects = [];
  const images = [];
  const ctx = {
    font: '',
    fillStyle: '',
    measureText: (value) => ({ width: String(value).length * 10 }),
    fillRect: (...args) => rects.push({ fill: ctx.fillStyle, args }),
    strokeRect: () => {},
    drawImage: (...args) => images.push(args),
    fillText: (text, x, y) => texts.push({ text, x, y, font: ctx.font }),
  };
  return { ctx, texts, rects, images };
}

const SPEC = {
  eyebrow: 'Fictional Cup',
  tile: 'XA',
  title: 'Testland',
  subtitle: 'Built from official results.',
  stats: [
    { value: '3', label: 'championships' },
    { value: '5', label: 'teams sent' },
    { value: '2–1', label: 'matches won–lost' },
    { value: '99', label: 'a fourth one that must not be drawn' },
  ],
  highlight: { label: 'Best finish', text: '4th place', detail: 'Alpha Brew · 2025' },
  provenance: 'From the organiser’s records.',
  address: 'seduhscore.com/id/country/xa',
};

describe('wrapLines', () => {
  const measure = (t) => t.length * 10;
  it('breaks on spaces and keeps every word', () => {
    expect(wrapLines('aaa bbb ccc ddd', measure, 80, 5)).toEqual(['aaa bbb', 'ccc ddd']);
  });
  it('cuts a word wider than the line, by characters', () => {
    expect(wrapLines('abcdefghij', measure, 40, 5)).toEqual(['abcd', 'efgh', 'ij']);
  });
  it('ends the last line with an ellipsis that fits, when text is left over', () => {
    const lines = wrapLines('one two three four five six', measure, 70, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
    expect(measure(lines[1])).toBeLessThanOrEqual(70);
  });
  it('is empty for no text', () => {
    expect(wrapLines('', measure, 100)).toEqual([]);
    expect(wrapLines(undefined, measure, 100)).toEqual([]);
  });
});

describe('drawStoryCard', () => {
  it('covers the whole 1080 x 1920 card with the background first', () => {
    const { ctx, rects } = recordingContext();
    drawStoryCard(ctx, SPEC);
    expect([STORY_WIDTH, STORY_HEIGHT]).toEqual([1080, 1920]);
    expect(rects[0].args).toEqual([0, 0, 1080, 1920]);
  });

  it('draws the title, the code as text, the address, the provenance and the best finish', () => {
    const { ctx, texts } = recordingContext();
    drawStoryCard(ctx, SPEC);
    const said = texts.map((t) => t.text);
    expect(said).toEqual(
      expect.arrayContaining(['Testland', 'XA', 'seduhscore.com/id/country/xa', '4th place']),
    );
    expect(said).toContain('From the organiser’s records.');
    expect(said).toContain('BEST FINISH');
  });

  it('draws at most three headline numbers', () => {
    const { ctx, texts } = recordingContext();
    drawStoryCard(ctx, SPEC);
    const said = texts.map((t) => t.text);
    expect(said).toEqual(expect.arrayContaining(['3', '5', '2–1']));
    expect(said).not.toContain('99');
  });

  it('keeps everything inside the card, and above the bottom margin', () => {
    const { ctx, texts } = recordingContext();
    drawStoryCard(ctx, SPEC);
    for (const t of texts) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + t.text.length * 10).toBeLessThanOrEqual(STORY_WIDTH);
      expect(t.y).toBeLessThan(STORY_HEIGHT);
    }
  });

  it('draws the flag only when it has one, and the QR code only when it has one', () => {
    const plain = recordingContext();
    drawStoryCard(plain.ctx, SPEC);
    expect(plain.images).toHaveLength(0);
    const withFlag = recordingContext();
    const flag = {};
    drawStoryCard(withFlag.ctx, SPEC, { flag });
    expect(withFlag.images).toHaveLength(1);
    expect(withFlag.images[0][0]).toBe(flag);

    const qrRun = recordingContext();
    drawStoryCard(qrRun.ctx, SPEC, { qr: { size: 3, isDark: (r, c) => (r + c) % 2 === 0 } });
    const dark = qrRun.rects.filter((r) => r.fill === '#000000');
    expect(dark).toHaveLength(5); // the 5 dark cells of a 3 x 3 checkerboard
    expect(plain.rects.filter((r) => r.fill === '#000000')).toEqual([]);
  });

  it('places each dark QR cell at its own row and column (not transposed)', () => {
    const { ctx, rects } = recordingContext();
    drawStoryCard(ctx, SPEC, { qr: { size: 4, isDark: (r, c) => r === 0 && c === 3 } });
    const dark = rects.filter((r) => r.fill === '#000000');
    expect(dark).toHaveLength(1);
    const [x, y] = dark[0].args;
    // left of the code box is 1080-96-260=724, top 1920-96-260=1564, padding 20, cell (260-40)/4=55
    expect([x, y]).toEqual([724 + 20 + 3 * 55, 1564 + 20]);
  });

  it('draws a card with no highlight and no stats without failing', () => {
    const { ctx, texts } = recordingContext();
    drawStoryCard(ctx, { title: 'Bare', address: 'seduhscore.com' });
    expect(texts.map((t) => t.text)).toContain('Bare');
  });

  it('keeps the highlight above the footer even for a name that needs two lines', () => {
    const { ctx, texts } = recordingContext();
    drawStoryCard(ctx, { ...SPEC, title: 'Bosnia and Herzegovina '.repeat(6) });
    const detail = texts.find((t) => t.text === 'Alpha Brew · 2025');
    expect(detail.y).toBeLessThan(1920 - 96 - 260);
  });

  it('wraps a title too long for one line to two lines that each fit, and cuts it with an ellipsis', () => {
    const { ctx, texts } = recordingContext();
    // 150 characters at 10px each cannot fit the 888px line: it takes two lines and the rest is cut.
    drawStoryCard(ctx, { ...SPEC, title: 'Bosnia and Herzegovina '.repeat(12).trim() });
    const titleLines = texts.filter((t) => t.font.startsWith('700 84px'));
    expect(titleLines).toHaveLength(2);
    for (const t of titleLines) expect(t.text.length * 10).toBeLessThanOrEqual(STORY_WIDTH - 192);
    expect(titleLines[1].text.endsWith('…')).toBe(true);
    expect(titleLines[0].text.endsWith('…')).toBe(false);
  });

  it('caps the highlight text at one line, with an ellipsis, so the detail stays clear of the footer', () => {
    const { ctx, texts } = recordingContext();
    drawStoryCard(ctx, {
      ...SPEC,
      highlight: { label: 'Best finish', text: 'word '.repeat(30), detail: 'x' },
    });
    const lines = texts.filter((t) => t.font.startsWith('700 76px'));
    expect(lines).toHaveLength(1);
    expect(lines[0].text.endsWith('…')).toBe(true);
  });

  it('keeps a name that fits at the largest size on one line', () => {
    const { ctx, texts } = recordingContext();
    drawStoryCard(ctx, SPEC);
    expect(texts.filter((t) => t.font.startsWith('700 132px')).map((t) => t.text)).toEqual([
      'Testland',
    ]);
  });
});

describe('storyThemeFrom', () => {
  it('reads tokens from the element and falls back for what is not defined', () => {
    const element = document.createElement('div');
    element.style.setProperty('--color-accent', '#123456');
    document.body.append(element);
    const theme = storyThemeFrom(element);
    expect(theme.accent).toBe('#123456');
    expect(theme.background).toBeTruthy();
    element.remove();
  });
});

describe('qrMatrixFor', () => {
  it('answers the matrix of the address, or null when the library cannot load', async () => {
    const cells = [
      [true, false],
      [false, true],
    ];
    const asked = [];
    const factory = () => ({
      addData: (text) => {
        asked.push(text);
      },
      make: () => {},
      getModuleCount: () => 2,
      isDark: (r, c) => cells[r][c],
    });
    const matrix = await qrMatrixFor('https://x.test/', async () => factory);
    expect(asked).toEqual(['https://x.test/']); // the code encodes exactly the address given
    expect(matrix.size).toBe(2);
    expect(matrix.isDark(0, 0)).toBe(true);
    expect(
      await qrMatrixFor('https://x.test/', async () => {
        throw new Error('no');
      }),
    ).toBeNull();
  });
});

describe('renderStoryCard', () => {
  it('draws on a 1080 x 1920 canvas and answers the picture', async () => {
    const { ctx } = recordingContext();
    const blob = new Blob(['png'], { type: 'image/png' });
    const canvas = { getContext: () => ctx, toBlob: (cb) => cb(blob) };
    const result = await renderStoryCard(SPEC, { canvasFactory: () => canvas });
    expect(result).toBe(blob);
    expect([canvas.width, canvas.height]).toEqual([1080, 1920]);
  });
  it('rejects when there is no canvas context, or no picture', async () => {
    await expect(
      renderStoryCard(SPEC, { canvasFactory: () => ({ getContext: () => null }) }),
    ).rejects.toThrow();
    const { ctx } = recordingContext();
    await expect(
      renderStoryCard(SPEC, {
        canvasFactory: () => ({ getContext: () => ctx, toBlob: (cb) => cb(null) }),
      }),
    ).rejects.toThrow();
  });
});

describe('shareStoryCard', () => {
  const blob = new Blob(['png'], { type: 'image/png' });
  const doc = () => {
    const link = { click: vi.fn(), remove: vi.fn() };
    return { link, doc: { createElement: () => link, body: { append: vi.fn() } } };
  };

  it('shares the file where the browser can share files', async () => {
    const nav = { canShare: vi.fn(() => true), share: vi.fn(async () => {}) };
    const { doc: d } = doc();
    expect(await shareStoryCard(blob, { filename: 'a.png', title: 't' }, nav, d)).toBe('shared');
    expect(nav.canShare.mock.calls[0][0].files[0].name).toBe('a.png');
    expect(nav.share.mock.calls[0][0].files).toHaveLength(1);
  });

  it('saves the picture when the browser cannot share files', async () => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
    const { doc: d, link } = doc();
    const nav = { canShare: () => false, share: vi.fn() };
    expect(await shareStoryCard(blob, { filename: 'a.png' }, nav, d)).toBe('saved');
    expect(nav.share).not.toHaveBeenCalled();
    expect(link.download).toBe('a.png');
    expect(link.click).toHaveBeenCalled();
  });

  it('saves when there is no share at all, and when sharing fails for any reason but the person closing it', async () => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
    expect(await shareStoryCard(blob, { filename: 'a.png' }, {}, doc().doc)).toBe('saved');
    const failing = {
      canShare: () => true,
      share: async () => {
        throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
      },
    };
    expect(await shareStoryCard(blob, { filename: 'a.png' }, failing, doc().doc)).toBe('saved');
  });

  it('does not save after the person closes the share sheet', async () => {
    const nav = {
      canShare: () => true,
      share: async () => {
        throw Object.assign(new Error('x'), { name: 'AbortError' });
      },
    };
    const { doc: d, link } = doc();
    expect(await shareStoryCard(blob, { filename: 'a.png' }, nav, d)).toBe('cancelled');
    expect(link.click).not.toHaveBeenCalled();
  });
});

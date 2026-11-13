import { describe, expect, it } from 'vitest';
import { buildQrBlock } from './qrBlock.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('buildQrBlock', () => {
  it('shows the caption and the address as text at once, with the code hidden from assistive technology', () => {
    const block = buildQrBlock(
      { url: 'https://www.seduhscore.com/id/country/', caption: 'Every country’s record' },
      { loadQr: () => new Promise(() => {}) },
    );
    expect(block.querySelector('.qr-block-caption').textContent).toBe('Every country’s record');
    expect(block.querySelector('.qr-block-url').textContent).toBe('www.seduhscore.com/id/country/');
    expect(block.querySelector('.qr-block-code').getAttribute('aria-hidden')).toBe('true');
  });

  it('fills the code from the library, and hides the empty box when the library cannot load', async () => {
    const asked = [];
    const ok = buildQrBlock(
      { url: 'https://x.test/', caption: 'c' },
      {
        loadQr: async () => () => ({
          addData: (text) => asked.push(text),
          make: () => {},
          createSvgTag: () => '<svg></svg>',
        }),
      },
    );
    await flush();
    expect(ok.querySelector('.qr-block-code svg')).not.toBeNull();
    expect(asked).toEqual(['https://x.test/']);
    const bad = buildQrBlock(
      { url: 'https://x.test/', caption: 'c' },
      {
        loadQr: async () => {
          throw new Error('x');
        },
      },
    );
    await flush();
    expect(bad.querySelector('.qr-block-code').hidden).toBe(true);
    expect(bad.querySelector('.qr-block-url').textContent).toBe('x.test/');
  });
});

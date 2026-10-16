import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyText } from './clipboard.js';

function setClipboard(value) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

afterEach(() => {
  setClipboard(undefined);
});

describe('copyText', () => {
  it('writes the text it was given and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });
    expect(await copyText('k7mx-p3qa-9wdn')).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('k7mx-p3qa-9wdn');
  });

  it('says no, and does not throw, when the browser refuses', async () => {
    setClipboard({ writeText: vi.fn(() => Promise.reject(new DOMException('denied'))) });
    expect(await copyText('x')).toBe(false);
  });

  it('says no when writeText throws instead of rejecting', async () => {
    setClipboard({
      writeText: () => {
        throw new TypeError('not allowed');
      },
    });
    expect(await copyText('x')).toBe(false);
  });

  it('says no when there is no Clipboard API at all (an insecure page, an old browser)', async () => {
    setClipboard(undefined);
    expect(await copyText('x')).toBe(false);
    setClipboard({});
    expect(await copyText('x')).toBe(false);
  });

  it('does not say yes before the write has finished', async () => {
    let finish;
    setClipboard({ writeText: () => new Promise((resolve) => (finish = resolve)) });
    let result = 'pending';
    const pending = copyText('x').then((value) => (result = value));
    await Promise.resolve();
    expect(result).toBe('pending');
    finish();
    await pending;
    expect(result).toBe(true);
  });
});

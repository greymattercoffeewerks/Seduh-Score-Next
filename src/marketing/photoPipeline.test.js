// The photo pipeline's loop and rules (T-ID2.C2), with the browser calls injected. The real canvas (EXIF gone, 512 x 512, a real
// WebP) is proved in a browser by tests/e2e/seduh-photo-live.spec.js.
import { describe, expect, it, vi } from 'vitest';
import {
  PHOTO,
  cropSquare,
  encodeUnderLimit,
  prepareAvatar,
  randomHex32,
} from './photoPipeline.js';

const blobOf = (type, size) => ({ type, size });
const file = (over = {}) => ({ name: 'p.jpg', type: 'image/jpeg', size: 3 * 1024 * 1024, ...over });

describe('cropSquare', () => {
  it.each([
    [4000, 3000, { sx: 500, sy: 0, side: 3000 }],
    [3000, 4000, { sx: 0, sy: 500, side: 3000 }],
    [512, 512, { sx: 0, sy: 0, side: 512 }],
    [101, 100, { sx: 0, sy: 0, side: 100 }],
  ])('takes the centred square of %i x %i', (w, h, expected) => {
    expect(cropSquare(w, h)).toEqual(expected);
  });
});

describe('encodeUnderLimit: 200 KB or less, by lowering the quality', () => {
  it('lowers the quality until the file fits, and returns the first one that does', async () => {
    // a 700 KB picture at the top quality, shrinking with quality
    const encode = vi.fn(async (type, q) => blobOf(type, Math.round(700000 * q * q)));
    const out = await encodeUnderLimit(encode);
    expect(out.type).toBe('image/webp');
    expect(out.ext).toBe('webp');
    expect(out.blob.size).toBeLessThanOrEqual(PHOTO.maxBytes);
    // the quality just above it did not fit (so it is the first that fits, not an arbitrary one)
    const idx = encode.mock.calls.length - 1;
    expect(idx).toBeGreaterThan(0);
    expect(
      encode.mock.results[idx - 1] && (await encode.mock.results[idx - 1].value).size,
    ).toBeGreaterThan(PHOTO.maxBytes);
  });

  it('falls back to JPEG when the browser cannot write WebP (it answers a PNG)', async () => {
    const encode = async (type) =>
      type === 'image/webp' ? blobOf('image/png', 100) : blobOf(type, 90000);
    const out = await encodeUnderLimit(encode);
    expect(out).toMatchObject({ type: 'image/jpeg', ext: 'jpg' });
  });

  it('falls back to JPEG when WebP works but never fits and JPEG does', async () => {
    const encode = async (type) => blobOf(type, type === 'image/webp' ? 900000 : 150000);
    expect(await encodeUnderLimit(encode)).toMatchObject({ type: 'image/jpeg' });
  });

  it('gives up (null) when nothing fits or nothing can be written', async () => {
    expect(await encodeUnderLimit(async (type) => blobOf(type, 900000))).toBeNull();
    expect(await encodeUnderLimit(async () => null)).toBeNull();
  });

  it('never returns an empty or oversize file, even exactly at the limit', async () => {
    expect((await encodeUnderLimit(async (t) => blobOf(t, PHOTO.maxBytes))).blob.size).toBe(
      PHOTO.maxBytes,
    );
    expect(
      await encodeUnderLimit(async (t) => blobOf(t, PHOTO.maxBytes + 1), { qualities: [0.5] }),
    ).toBeNull();
    expect(await encodeUnderLimit(async (t) => blobOf(t, 0), { qualities: [0.5] })).toBeNull();
  });
});

// a fake canvas: a 2d context that records the draw, and toBlob that shrinks with quality like a real encoder
function fakeCanvasKit({ rawBytes = 800000, writesWebp = true } = {}) {
  const calls = { draw: null, size: null, fill: [] };
  const makeCanvas = (size) => {
    calls.size = size;
    return {
      getContext: () => ({
        fillRect: (...a) => calls.fill.push(a),
        drawImage: (...a) => {
          calls.draw = a;
        },
      }),
      toBlob: (cb, type, q) => {
        if (type === 'image/webp' && !writesWebp) return cb(blobOf('image/png', 10));
        cb(blobOf(type, Math.round(rawBytes * q * q)));
      },
    };
  };
  return { makeCanvas, calls };
}

describe('prepareAvatar', () => {
  it('crops the centre square, draws it at 512 x 512 on white, and ends up 200 KB or less from a big picture', async () => {
    const { makeCanvas, calls } = fakeCanvasKit();
    const close = vi.fn();
    const decode = async () => ({ source: 'SRC', width: 4000, height: 3000, close });
    const out = await prepareAvatar(file({ size: 9 * 1024 * 1024 }), { decode, makeCanvas });
    expect(out.ok).toBe(true);
    expect(out.size).toBeLessThanOrEqual(PHOTO.maxBytes);
    expect(calls.size).toBe(512);
    expect(calls.draw).toEqual(['SRC', 500, 0, 3000, 3000, 0, 0, 512, 512]);
    expect(calls.fill[0]).toEqual([0, 0, 512, 512]);
    expect(close).toHaveBeenCalled();
  });

  it('accepts a file up to 10 MB and refuses more, with its own hint', async () => {
    const { makeCanvas } = fakeCanvasKit();
    const decode = async () => ({ source: 'S', width: 600, height: 600 });
    expect(
      (await prepareAvatar(file({ size: PHOTO.maxInputBytes }), { decode, makeCanvas })).ok,
    ).toBe(true);
    expect(
      await prepareAvatar(file({ size: PHOTO.maxInputBytes + 1 }), { decode, makeCanvas }),
    ).toEqual({
      ok: false,
      hint: 'photo_input_too_big',
    });
  });

  it('refuses something that is not an image, and a picture the browser cannot open', async () => {
    const { makeCanvas } = fakeCanvasKit();
    expect(await prepareAvatar(file({ type: 'application/pdf' }), { makeCanvas })).toEqual({
      ok: false,
      hint: 'photo_not_image',
    });
    expect(await prepareAvatar(null, { makeCanvas })).toEqual({
      ok: false,
      hint: 'photo_not_image',
    });
    const decode = async () => {
      throw new Error('bad');
    };
    expect(await prepareAvatar(file(), { decode, makeCanvas })).toEqual({
      ok: false,
      hint: 'photo_unreadable',
    });
    expect(
      await prepareAvatar(file(), {
        decode: async () => ({ source: 'S', width: 0, height: 10 }),
        makeCanvas,
      }),
    ).toEqual({
      ok: false,
      hint: 'photo_unreadable',
    });
  });

  it('says photo_too_big when no quality fits, and uses JPEG on a browser with no WebP', async () => {
    const decode = async () => ({ source: 'S', width: 800, height: 800 });
    const huge = fakeCanvasKit({ rawBytes: 50_000_000 });
    expect(await prepareAvatar(file(), { decode, makeCanvas: huge.makeCanvas })).toEqual({
      ok: false,
      hint: 'photo_too_big',
    });
    const noWebp = fakeCanvasKit({ writesWebp: false });
    expect(await prepareAvatar(file(), { decode, makeCanvas: noWebp.makeCanvas })).toMatchObject({
      ok: true,
      ext: 'jpg',
    });
  });

  it('uploads only pixels: the result is the canvas blob, never the original file', async () => {
    const { makeCanvas } = fakeCanvasKit();
    const original = file();
    const out = await prepareAvatar(original, {
      decode: async () => ({ source: 'S', width: 700, height: 900 }),
      makeCanvas,
    });
    expect(out.blob).not.toBe(original);
    expect(Object.keys(out)).not.toContain('file');
  });
});

describe('randomHex32', () => {
  it('is 32 lower-case hex digits, from the crypto it is given, and differs each time', () => {
    const a = randomHex32();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomHex32()).not.toBe(a);
    const fixed = { getRandomValues: (b) => b.fill(255) };
    expect(randomHex32(fixed)).toBe('ff'.repeat(16));
  });
});

// The profile photo's browser pipeline (T-ID2.C2): choose, crop square from the centre, resize to 512 x 512, re-encode (WebP, or JPEG
// where the browser cannot write WebP), and lower the quality until the file is 200 KB or less. The page accepts up to 10 MB to choose
// from. Drawing the picture onto a canvas and encoding it AGAIN is what strips location and camera data (EXIF and every other
// metadata block): only pixels cross over, so nothing of the original file is uploaded. The Storage bucket enforces the type and the
// size on its own; this keeps an honest person from meeting that refusal.
//
// The browser calls (decode a file, make a canvas) are INJECTED (`decode`, `makeCanvas`) so the loop is unit-tested without a browser;
// the real ones are the defaults and are proved in a real browser by tests/e2e/seduh-photo-live.spec.js (an EXIF-tagged JPEG goes in,
// the stored file has no EXIF and is 512 x 512).
export const PHOTO = Object.freeze({
  size: 512,
  maxBytes: 204800,
  maxInputBytes: 10 * 1024 * 1024,
  // descending; the first one that fits wins
  qualities: Object.freeze([0.88, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4, 0.32, 0.24, 0.16]),
  // what the browser may be asked to open (the browser decides what it can really decode)
  inputTypes: Object.freeze([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/heic',
    'image/heif',
  ]),
});

/** Pure. The centred square of a w x h picture: { sx, sy, side }. */
export function cropSquare(width, height) {
  const side = Math.min(width, height);
  return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side };
}

/**
 * Pure-ish. Tries each quality in turn and returns the first blob that is `maxBytes` or less, `{ blob, type, ext }`, or null.
 * `encode(type, quality)` resolves to a Blob or null. WebP first at each quality; a browser that cannot write WebP answers a PNG (or
 * null), which is skipped, so it falls back to JPEG for the whole run.
 */
export async function encodeUnderLimit(
  encode,
  { maxBytes = PHOTO.maxBytes, qualities = PHOTO.qualities } = {},
) {
  const types = [
    ['image/webp', 'webp'],
    ['image/jpeg', 'jpg'],
  ];
  for (const [type, ext] of types) {
    for (const quality of qualities) {
      const blob = await encode(type, quality);
      // another type (or nothing) back means the browser cannot write this one: go to the next type
      if (!blob || blob.type !== type) break;
      if (blob.size > 0 && blob.size <= maxBytes) return { blob, type, ext };
    }
  }
  return null;
}

const defaultDecode = async (file) => {
  // imageOrientation: 'from-image' applies the camera's rotation, so a phone portrait is upright before it is cropped
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    close: () => bitmap.close?.(),
  };
};
const defaultMakeCanvas = (size) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
};

/**
 * Prepares a chosen file for upload: `{ ok: true, blob, type, ext, size }` or `{ ok: false, hint }` with a hint meFlow.js has
 * words for: photo_not_image, photo_input_too_big, photo_unreadable, photo_too_big. Never throws.
 */
export async function prepareAvatar(
  file,
  { decode = defaultDecode, makeCanvas = defaultMakeCanvas } = {},
) {
  if (!file || typeof file.size !== 'number') return { ok: false, hint: 'photo_not_image' };
  if (file.type && !file.type.startsWith('image/')) return { ok: false, hint: 'photo_not_image' };
  if (file.size > PHOTO.maxInputBytes) return { ok: false, hint: 'photo_input_too_big' };
  let decoded;
  try {
    decoded = await decode(file);
  } catch {
    return { ok: false, hint: 'photo_unreadable' };
  }
  try {
    const { width, height } = decoded;
    if (!(width > 0 && height > 0)) return { ok: false, hint: 'photo_unreadable' };
    const { sx, sy, side } = cropSquare(width, height);
    const canvas = makeCanvas(PHOTO.size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, hint: 'photo_unreadable' };
    // JPEG has no transparency: a transparent PNG would turn black, so paint white underneath
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PHOTO.size, PHOTO.size);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.source, sx, sy, side, side, 0, 0, PHOTO.size, PHOTO.size);
    const encode = (type, quality) =>
      new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
    const out = await encodeUnderLimit(encode);
    if (!out) return { ok: false, hint: 'photo_too_big' };
    return { ok: true, ...out, size: out.blob.size };
  } catch {
    return { ok: false, hint: 'photo_unreadable' };
  } finally {
    decoded?.close?.();
  }
}

/** A random 32-hex file name part (128 bits) from the browser's crypto. */
export function randomHex32(cryptoObj = globalThis.crypto) {
  const bytes = new Uint8Array(16);
  cryptoObj.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

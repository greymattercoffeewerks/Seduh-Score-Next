// A shuffle that can be explained afterwards. A random draw that decides who meets whom is only defensible if
// "why this order?" has an answer, so the order is a pure function of a recorded SEED: the same seed and the same
// list always give the same order. The seed itself is made once, from the browser's secure random source, and
// stored with the draw (Throwdown stores it in td_draws.seed).
//
// Format-agnostic: nothing here knows what is being shuffled. This is the fairness of the *seed* (unpredictable
// before the draw, recorded after it); the order is a deterministic Fisher-Yates over a seeded 32-bit generator
// (mulberry32). It is for ordering a draw, not for drawing a prize: the Random Selector's rejection-sampled engine
// (src/tools/random-selector/randomSelector.js) is a different job, and lifting that one into core/ is a separate, later task.

// xmur3: a string -> 32-bit hash, so any recorded text seed becomes the generator's starting state.
function hashSeed(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

// mulberry32: a small, well-behaved generator returning floats in [0, 1).
function generator(state) {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A fresh seed: 12 hex characters (48 bits) from crypto.getRandomValues. Short enough to read out in a venue and
// print on a results sheet.
export function newSeed() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// A new array with the items in the order `seed` gives. The input is not changed.
export function seededShuffle(items, seed) {
  if (typeof seed !== 'string' || seed.length === 0) {
    throw new TypeError('seededShuffle: a non-empty text seed is required');
  }
  const out = [...items];
  const next = generator(hashSeed(seed));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

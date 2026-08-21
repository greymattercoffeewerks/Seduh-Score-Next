// Heat sizing (handoff §2, §14 T2.1). A heat targets `target` cuppers and never
// drops below `min` — splitting N cuppers into the fewest heats that hit `target`
// as closely as possible, sizes differing by at most 1, larger heats first.
export function partition(n, { target = 4, min = 2 } = {}) {
  if (n < min) {
    throw new Error(`partition: n (${n}) is below the minimum heat size (${min})`);
  }

  let heats = Math.ceil(n / target);
  while (heats > 1 && Math.floor(n / heats) < min) {
    heats -= 1;
  }

  const base = Math.floor(n / heats);
  const remainder = n % heats;

  return Array.from({ length: heats }, (_, i) => base + (i < remainder ? 1 : 0));
}

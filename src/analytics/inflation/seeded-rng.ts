/**
 * Tiny deterministic RNG utilities for the Insights inflation overlay.
 *
 * Everything is seeded off stable string keys (user index + day index), so the
 * same (day, user) always yields the same draws. That determinism is what lets
 * the overlay be reproducible and reversible WITHOUT persisting anything: turn
 * it off and back on and the historical inflated numbers are identical, because
 * they are recomputed from the date, never stored.
 */

/** 32-bit FNV-1a string hash → uint32 seed. */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 PRNG → function returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh generator seeded by an arbitrary key. */
export function rng(seed: string): () => number {
  return mulberry32(hashSeed(seed));
}

/** Standard-normal draw (Box-Muller) consuming two values from `g`. */
export function gauss(g: () => number): number {
  const u1 = Math.max(1e-9, g());
  const u2 = g();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

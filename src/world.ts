import { WORLD_W } from './config';

/** Brings any x back onto the ring, into [0, WORLD_W). */
export const wrap = (x: number) => ((x % WORLD_W) + WORLD_W) % WORLD_W;

/** Shortest signed distance from `from` to `to` round the ring: positive means `to` is ahead to the right. */
export const wdx = (from: number, to: number) => wrap(to - from + WORLD_W / 2) - WORLD_W / 2;

/** Small seeded generator (mulberry32), so the hull is laid out the same way every time. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

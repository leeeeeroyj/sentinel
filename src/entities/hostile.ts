import Phaser from 'phaser';
import { CRAFT, GROUND_Y, HOSTILE } from '../config';
import { wdx, wrap } from '../world';
import { drop, STAND_Y, type Colonist } from './colonist';

export type HostileKind = 'snatcher' | 'husk';

/** A Snatcher seeks a colonist, descends onto it, then lifts it away. Husks only use `seek`. */
export type HostileState = 'seek' | 'descend' | 'lift';

export interface Hostile {
  kind: HostileKind;
  x: number;
  y: number;
  /** Cruising height it bobs round while seeking. */
  base: number;
  /** Seconds left warping in; harmless and unshootable until 0. */
  warp: number;
  state: HostileState;
  target?: Colonist;
  carry?: Colonist;
  /** Seconds alive, for the bob. */
  t: number;
  /** Wander direction when there's nothing to seek. */
  dir: number;
  /** Husk's twitch: a random offset to its heading, re-rolled every HOSTILE.husk.jitter s. */
  jit: number;
  jx: number;
  jy: number;
  dead: boolean;
  img: Phaser.GameObjects.Image;
}

export function createHostile(scene: Phaser.Scene, kind: HostileKind, x: number, y: number, warp = HOSTILE.warp): Hostile {
  const img = scene.add.image(0, 0, kind).setDepth(7).setTint(0xffffff);
  return {
    kind, x: wrap(x), y, base: y, warp, state: 'seek', t: Math.random() * 10, dir: Math.random() < 0.5 ? -1 : 1,
    jit: 0, jx: 0, jy: 0, dead: false, img,
  };
}

/** Fuses a Snatcher (and whatever it holds) into a Husk. The held colonist is lost. */
export function fuse(e: Hostile) {
  if (e.carry) e.carry.state = 'dead';
  e.carry = undefined;
  e.target = undefined;
  e.kind = 'husk';
  e.state = 'seek';
  e.img.setTexture('husk');
}

/** Lets go of whatever it holds (it was shot, or rammed). */
export function release(e: Hostile) {
  if (e.carry) drop(e.carry);
  e.carry = undefined;
  e.target = undefined;
}

/** Returns 'fused' on the frame a lifting Snatcher reaches the top with its catch. */
export function updateSnatcher(e: Hostile, dt: number, colonists: Colonist[], others: Hostile[]): 'fused' | undefined {
  const S = HOSTILE.snatcher;
  if (e.state === 'seek') {
    const t = e.target;
    if (!t || t.state !== 'walk') {
      e.target = undefined;
      let best = Infinity;
      for (const c of colonists) {
        if (c.state !== 'walk' || others.some((f) => f !== e && !f.dead && f.target === c)) continue;
        const d = Math.abs(wdx(e.x, c.x));
        if (d < best) { best = d; e.target = c; }
      }
    }
    const tx = e.target ? wdx(e.x, e.target.x) : e.dir * 50;
    e.x = wrap(e.x + Math.sign(tx) * Math.min(Math.abs(tx), S.seek * dt));
    e.y += (e.base + Math.sin(e.t * 1.3) * S.bob - e.y) * Math.min(1, dt * 2);
    if (e.target && Math.abs(tx) < 3) e.state = 'descend';
  } else if (e.state === 'descend') {
    const c = e.target;
    if (!c || c.state !== 'walk') {
      e.state = 'seek';
      e.target = undefined;
    } else {
      e.x = c.x;
      e.y = Math.min(e.y + S.descend * dt, STAND_Y - S.grab);
      if (e.y >= c.y - S.grab) {
        c.state = 'taken';
        e.carry = c;
        e.state = 'lift';
      }
    }
  } else {
    e.y -= S.lift * dt;
    if (e.carry) {
      e.carry.x = e.x;
      e.carry.y = e.y + S.grab;
    }
    if (e.y < S.fuseY) {
      fuse(e);
      return 'fused';
    }
  }
  return undefined;
}

/** Husks home in on the craft with a twitch, so they never fly a straight line. */
export function updateHusk(e: Hostile, dt: number, craftX: number, craftY: number) {
  const H = HOSTILE.husk;
  e.jit -= dt;
  if (e.jit <= 0) {
    e.jit = H.jitter;
    e.jx = (Math.random() - 0.5) * H.jitterX;
    e.jy = (Math.random() - 0.5) * H.jitterY;
  }
  const tx = wdx(e.x, craftX) + e.jx, ty = craftY - e.y + e.jy, d = Math.hypot(tx, ty) || 1;
  e.x = wrap(e.x + (tx / d) * H.speed * dt);
  e.y = Phaser.Math.Clamp(e.y + (ty / d) * H.speed * dt, CRAFT.minY - 2, GROUND_Y - 12);
}

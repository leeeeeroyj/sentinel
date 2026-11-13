import Phaser from 'phaser';
import { COLONIST, GROUND_Y, WORLD_W } from '../config';
import { wdx, wrap } from '../world';

/**
 * walk: on the hull. taken: held by a lifting Snatcher. falling: dropped, under gravity. carried: hanging under
 * the craft. dead: gone for good (until the ring is restored, in a later milestone).
 */
export type ColonistState = 'walk' | 'taken' | 'falling' | 'carried' | 'dead';

export interface Colonist {
  x: number;
  y: number;
  /** Where it strolls round; moves to wherever it's set down. */
  home: number;
  dir: number;
  state: ColonistState;
  vy: number;
  /** The height it was dropped from, to judge the landing. */
  fallFrom: number;
  img: Phaser.GameObjects.Image;
}

/** A colonist's centre when standing: the sprite is 8 px tall at half size. */
export const STAND_Y = GROUND_Y - 4;

export function createColonists(scene: Phaser.Scene): Colonist[] {
  return Array.from({ length: COLONIST.count }, (_, i) => {
    const home = wrap(140 + (i * WORLD_W) / COLONIST.count + (i % 3) * 37);
    const img = scene.add.image(0, 0, 'colonist').setScale(0.5).setDepth(6).setTint(0xffffff);
    return { x: home, y: STAND_Y, home, dir: i % 2 ? 1 : -1, state: 'walk', vy: 0, fallFrom: 0, img };
  });
}

export function drop(c: Colonist) {
  c.state = 'falling';
  c.vy = 0;
  c.fallFrom = c.y;
}

export function setDown(c: Colonist) {
  c.state = 'walk';
  c.y = STAND_Y;
  c.home = c.x;
  c.vy = 0;
}

/** Walking and falling. Returns how a fall ended, on the frame it hits the hull. */
export function updateColonist(c: Colonist, dt: number): 'survived' | 'lost' | undefined {
  if (c.state === 'walk') {
    c.x = wrap(c.x + c.dir * COLONIST.walk * dt);
    const away = wdx(c.home, c.x);
    if (Math.abs(away) > COLONIST.roam) c.dir = -Math.sign(away);
  } else if (c.state === 'falling') {
    c.vy = Math.min(c.vy + COLONIST.gravity * dt, COLONIST.maxFall);
    c.y += c.vy * dt;
    if (c.y >= STAND_Y) {
      const height = STAND_Y - c.fallFrom;
      if (height > COLONIST.safeFall) {
        c.state = 'dead';
        return 'lost';
      }
      setDown(c);
      return 'survived';
    }
  }
  return undefined;
}

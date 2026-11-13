import Phaser from 'phaser';
import { FX } from './config';

const STREAK = 'fx-streak';
const WHITE = 0xffffff;

/** Slows particles down over their life, so sparks fly out fast and hang in the air. */
class Drag extends Phaser.GameObjects.Particles.ParticleProcessor {
  constructor(private readonly perSecond: number) {
    super(0, 0, true);
  }

  override update(p: Phaser.GameObjects.Particles.Particle, _delta: number, step: number) {
    const k = Math.exp(-this.perSecond * step);
    p.velocityX *= k;
    p.velocityY *= k;
  }
}

export type BurstSize = 'small' | 'big' | 'huge';

/** `shake` is in game pixels (Phaser's own camera shake scales with canvas size and zoom, far too much at 4×). */
const BURSTS: Record<BurstSize, { sparks: number; speed: number; life: number; ring: number; shake: number }> = {
  small: { sparks: 24, speed: 140, life: 450, ring: 14, shake: 0.8 },
  big: { sparks: 60, speed: 200, life: 650, ring: 26, shake: 1.8 },
  huge: { sparks: 140, speed: 250, life: 900, ring: 44, shake: 3.5 },
};

/**
 * Spark bursts, shockwave rings, screen shake and wobble (lens bulge, hue swing, camera roll), adapted from Space
 * Raider. Effects are placed in screen space but stay pinned to the ring: call `update` with the unwrapped `travel`
 * each frame and everything already on screen slides with the world. Honours prefers-reduced-motion (no shake, roll
 * or bulge, fewer sparks).
 */
export class Effects {
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly rings: Phaser.GameObjects.Graphics[] = [];
  private readonly barrel: Phaser.Filters.Barrel | undefined;
  private readonly hue: Phaser.Filters.ColorMatrix | undefined;
  private wobble = { bulge: 0, hue: 0, roll: 0, rollPhase: 0, shake: 0 };
  private readonly rest: { x: number; y: number };
  private readonly calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  private travel = 0;
  // The next burst's settings, read by the emitter's onEmit callbacks.
  private palette = [WHITE];
  private speed = 100;
  private life = 400;

  constructor(private readonly scene: Phaser.Scene) {
    if (!scene.textures.exists(STREAK)) {
      const g = scene.make.graphics({}, false);
      g.fillStyle(WHITE).fillRect(0, 0, 4, 1);
      g.generateTexture(STREAK, 4, 1);
      g.destroy();
    }
    let angle = 0;
    this.sparks = scene.add.particles(0, 0, STREAK, {
      emitting: false,
      blendMode: Phaser.BlendModes.ADD,
      // rotate is worked out before angle, so it picks the direction and angle reuses it: each streak points where it flies.
      rotate: { onEmit: () => (angle = Math.random() * 360) },
      angle: { onEmit: () => angle },
      speed: { onEmit: () => this.speed * (0.25 + Math.random() * 0.75) },
      lifespan: { onEmit: () => this.life * (0.5 + Math.random() * 0.5) },
      tint: { onEmit: () => Phaser.Utils.Array.GetRandom(this.palette) },
      scaleX: { start: 1.6, end: 0.3 },
      scaleY: 1,
      alpha: { start: 1, end: 0 },
    }).setDepth(20);
    this.sparks.addParticleProcessor(new Drag(4));

    const cam = scene.cameras.main;
    this.rest = { x: cam.scrollX, y: cam.scrollY };
    if (scene.game.renderer.type === Phaser.WEBGL) {
      if (FX.bloom.enabled) {
        const bloom = cam.filters.internal.addParallelFilters();
        bloom.top.addThreshold(FX.bloom.threshold, 1);
        bloom.top.addBlur(0, FX.bloom.offset, FX.bloom.offset, FX.bloom.spread, WHITE, FX.bloom.steps);
        bloom.blend.blendMode = Phaser.BlendModes.ADD;
        bloom.blend.amount = FX.bloom.amount;
      }
      this.barrel = cam.filters.internal.addBarrel(1).setActive(false);
      this.hue = cam.filters.internal.addColorMatrix().setActive(false);
    }
  }

  /** An explosion at screen (x, y): sparks in the given colours, a shockwave ring and a shake. */
  burst(x: number, y: number, colors: number[], size: BurstSize = 'small') {
    const b = BURSTS[size];
    this.emit(x, y, b.sparks, [...colors, ...colors, WHITE], b.speed, b.life);
    this.ring(x, y, colors[0], b.ring, b.life * 0.7);
    if (size !== 'small') this.ring(x, y, WHITE, b.ring * 0.6, b.life * 0.5);
    this.shake(b.shake);
    if (size === 'big') this.kick(0.05, 25, 0);
    if (size === 'huge') this.kick(0.12, 45, 0.03);
  }

  /** A celebration or a puff: sparks and a ring, with no shake. */
  pop(x: number, y: number, colors: number[], sparks: number) {
    this.emit(x, y, sparks, [...colors, WHITE], 120, 520);
    this.ring(x, y, colors[0], 10 + sparks / 6, 420);
  }

  /** A ring sweeping out from (x, y), for the pulse. */
  wave(x: number, y: number, color: number, radius: number, ms: number) {
    this.ring(x, y, color, radius, ms);
  }

  /** A full-screen white flash for `ms` (skipped with reduced motion). */
  flash(ms: number, strength = 1) {
    if (this.calm) return;
    const v = Math.round(255 * strength);
    this.scene.cameras.main.flash(ms, v, v, v);
  }

  shake(pixels: number) {
    this.wobble.shake = Math.max(this.wobble.shake, pixels);
  }

  /** Screen wobble: lens bulge (barrel amount), a hue swing in degrees and a camera roll in radians. */
  kick(bulge: number, hue: number, roll: number) {
    const w = this.wobble;
    w.bulge = Math.max(w.bulge, bulge);
    w.hue = Math.max(w.hue, hue);
    if (roll > w.roll) {
      w.roll = roll;
      w.rollPhase = 0;
    }
  }

  /** `travel` is the unwrapped distance the view has moved; effects scroll with it. */
  update(dt: number, travel: number) {
    this.travel = travel;
    this.sparks.x = -travel;
    for (const r of this.rings) r.x = -travel;
    const w = this.wobble;
    const ease = Math.exp(-4 * dt);
    w.bulge *= ease;
    w.hue *= ease;
    w.roll *= Math.exp(-3 * dt);
    w.rollPhase += dt * 22;
    w.shake *= Math.exp(-7 * dt);
    if (w.shake < 0.05) w.shake = 0;
    const still = this.calm;
    if (this.barrel) {
      this.barrel.setActive(!still && w.bulge > 0.002);
      this.barrel.amount = 1 + w.bulge * Math.cos(w.rollPhase * 0.7);
    }
    if (this.hue) {
      this.hue.setActive(w.hue > 0.5);
      this.hue.colorMatrix.hue(w.hue);
    }
    const cam = this.scene.cameras.main;
    cam.setRotation(!still && w.roll > 0.0005 ? w.roll * Math.sin(w.rollPhase) : 0);
    const s = still ? 0 : w.shake;
    cam.setScroll(this.rest.x + (Math.random() * 2 - 1) * s, this.rest.y + (Math.random() * 2 - 1) * s);
  }

  private emit(x: number, y: number, count: number, palette: number[], speed: number, life: number) {
    this.palette = palette;
    this.speed = speed;
    this.life = life;
    this.sparks.explode(this.calm ? Math.ceil(count / 3) : count, x + this.travel, y);
  }

  private ring(x: number, y: number, color: number, radius: number, ms: number) {
    const g = this.scene.add.graphics().setDepth(19).setBlendMode(Phaser.BlendModes.ADD);
    g.x = -this.travel;
    this.rings.push(g);
    const cx = x + this.travel, t = { p: 0 };
    this.scene.tweens.add({
      targets: t, p: 1, duration: ms, ease: 'Quad.out',
      onUpdate: () => g.clear().lineStyle(2 - t.p, color, 1 - t.p).strokeCircle(cx, y, 2 + radius * t.p),
      onComplete: () => {
        g.destroy();
        this.rings.splice(this.rings.indexOf(g), 1);
      },
    });
  }
}

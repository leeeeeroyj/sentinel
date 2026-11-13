import Phaser from 'phaser';
import { COLONIST, COLORS, CRAFT, FIRE, FONT, GROUND_Y, HOSTILE, HOUNDS, HUD_H, HUD_STATE, LASER, LIFE, MINE, MIRROR, POINTS, RENDER_SCALE, TEXT, WIDTH, WORLD_W } from '../config';
import { Backdrop } from '../backdrop';
import { Controls, type ControlState } from '../controls';
import { createColonists, drop, setDown, updateColonist, type Colonist } from '../entities/colonist';
import {
  canFire, createHostile, release, tickFire, updateHound, updateHusk, updateMinelayer, updateSnatcher, type Hostile, type HostileKind,
} from '../entities/hostile';
import { toggleMute } from '../sfx';
import { fitCamera } from '../view';
import { wdx, wrap } from '../world';
import type { HudState } from './HudScene';

/** The craft's flight state. `x` is a world position on the ring; `facing` is 1 (right) or -1 (left). */
export interface Craft {
  x: number;
  y: number;
  vx: number;
  facing: number;
  /** How far ahead of the craft the view is centred; eases toward facing × CRAFT.lead. */
  lead: number;
  /** Seconds of blinking invulnerability left. */
  invuln: number;
  /** Seconds until it reappears after being destroyed; 0 while flying. */
  down: number;
  carry?: Colonist;
}

/** One laser streak. It stays where it was fired in the world and grows ahead of the craft until it hits. */
interface Beam {
  x: number;
  y: number;
  dir: number;
  len: number;
  life: number;
  /** Length at which it hit something; it stops growing there. */
  stop: number;
}

interface Popup {
  x: number;
  life: number;
  text: Phaser.GameObjects.Text;
}

/** An enemy shot: a small aimed pellet. */
interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

/** Hangs still where a Minelayer dropped it. Harmless while `arm` > 0; can't be shot. */
interface Mine {
  x: number;
  y: number;
  life: number;
  arm: number;
  img: Phaser.GameObjects.Image;
}

/**
 * The game. The camera never scrolls: the scene keeps `camX` (the world x at the centre of the view) and draws
 * everything at `WIDTH / 2 + wdx(camX, x)`, which is what lets the ring loop with no seam.
 */
export class RingScene extends Phaser.Scene {
  private controls!: Controls;
  private backdrop!: Backdrop;
  private craftImg!: Phaser.GameObjects.Image;
  private flame!: Phaser.GameObjects.Graphics;
  /** Laser streaks, tethers and warp-in rings, redrawn each frame. */
  private lines!: Phaser.GameObjects.Graphics;

  // Run state, all reset in create() (scene.restart reuses this instance). Public for the dev-only test handle.
  craft: Craft = { x: 0, y: 0, vx: 0, facing: 1, lead: 0, invuln: 0, down: 0 };
  camX = 0;
  /** Unwrapped distance the view has moved, for the parallax layers. */
  travel = 0;
  colonists: Colonist[] = [];
  hostiles: Hostile[] = [];
  beams: Beam[] = [];
  popups: Popup[] = [];
  shots: Shot[] = [];
  mines: Mine[] = [];
  score = 0;
  ships = 0;
  pulses = 0;
  /** Sends a new group of Snatchers when the last one is gone. Waves replace this in milestone 4. */
  spawning = true;
  wave = 1;
  /** Seconds spent in this wave, for the Hound timer, and when the next Hound comes. */
  stall = 0;
  nextHound = 0;
  private clock = 0;
  private fireCool = 0;
  private over = 0;
  private leaving = false;

  constructor() {
    super('ring');
  }

  create() {
    this.craft = { x: CRAFT.startX, y: CRAFT.startY, vx: 0, facing: 1, lead: CRAFT.lead, invuln: 0, down: 0 };
    this.camX = wrap(this.craft.x + this.craft.lead);
    this.travel = 0;
    this.clock = 0;
    this.fireCool = 0;
    this.score = 0;
    this.ships = CRAFT.ships;
    this.pulses = CRAFT.pulses;
    this.over = 0;
    this.leaving = false;
    this.spawning = true;
    this.beams = [];
    this.popups = [];
    this.hostiles = [];
    this.shots = [];
    this.mines = [];
    this.wave = 1;
    this.stall = 0;
    this.nextHound = this.houndTime();

    fitCamera(this, RENDER_SCALE);
    this.cameras.main.fadeIn(250);
    this.controls = new Controls(this);
    this.backdrop = new Backdrop(this, 0);
    this.colonists = createColonists(this);
    this.lines = this.add.graphics().setDepth(8);
    this.flame = this.add.graphics().setDepth(9);
    this.craftImg = this.add.image(0, 0, 'player').setDepth(10);
    this.spawnGroup();
    this.scene.launch('hud');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scene.stop('hud'));
  }

  update(_time: number, delta: number) {
    const dt = Math.min(0.05, delta / 1000);
    this.clock += dt;
    const input = this.controls.read();
    if (input.mute) toggleMute(this);
    if (input.back) this.leave();

    this.fly(input, dt);
    this.fire(input, dt);
    if (input.pulse) this.pulse();
    this.updateHostiles(dt);
    this.updateHazards(dt);
    this.updateHounds(dt);
    this.updateColonists(dt);
    this.updateBeams(dt);
    this.collide();
    this.updatePopups(dt);
    if (this.spawning && !this.hostiles.some((e) => e.kind === 'snatcher')) this.spawnGroup();
    if (this.over > 0 && (this.over -= dt) <= 0) this.leave();

    this.backdrop.update(this.camX, this.travel, this.clock);
    this.draw();

    const hud: HudState = {
      score: this.score, ships: this.ships, pulses: this.pulses, wave: this.wave, device: input.device,
      hound: this.hostiles.some((e) => e.kind === 'hound') ? 'on' : this.houndWarning ? 'blink' : 'off',
      taken: this.colonists.some((c) => c.state === 'taken'),
    };
    this.registry.set(HUD_STATE, hud);
  }

  /** Screen x of a world x. */
  sx(x: number) {
    return WIDTH / 2 + wdx(this.camX, x);
  }

  onScreen(x: number, margin = 16) {
    return Math.abs(wdx(this.camX, x)) < WIDTH / 2 + margin;
  }

  /** Puts a hostile on the ring. Exposed for dev-only test hooks too. */
  spawn(kind: HostileKind, x: number, y: number, warp = HOSTILE.warp) {
    const e = createHostile(this, kind, x, y, warp);
    this.hostiles.push(e);
    return e;
  }

  /** Removes a hostile without scoring it (test hooks). */
  remove(e: Hostile) {
    release(e);
    e.dead = true;
    e.img.destroy();
    this.hostiles = this.hostiles.filter((f) => f !== e);
  }

  /** Test hook: clears every hostile, shot and mine, and stops new arrivals and Hounds. */
  calm() {
    this.spawning = false;
    this.nextHound = Infinity;
    [...this.hostiles].forEach((e) => this.remove(e));
    this.mines.forEach((m) => m.img.destroy());
    this.mines = [];
    this.shots = [];
  }

  /** Five Snatchers spread round the part of the ring you can't see. */
  private spawnGroup() {
    const span = WORLD_W - WIDTH - 120;
    for (let i = 0; i < HOSTILE.group; i++) {
      const x = this.camX + WIDTH / 2 + 60 + ((i + Math.random() * 0.5) * span) / HOSTILE.group;
      this.spawn('snatcher', x, 60 + Math.random() * 60);
    }
    if (!this.hostiles.some((e) => e.kind === 'minelayer')) this.spawn('minelayer', this.camX + WORLD_W / 2, 90 + Math.random() * 40);
  }

  /** Seconds into a wave before the first Hound: shorter each wave, down to a floor. */
  private houndTime() {
    return Math.max(HOUNDS.min, HOUNDS.first - HOUNDS.perWave * (this.wave - 1));
  }

  /** True while the HOUND lamp blinks: the last few seconds before the first Hound of the wave. */
  get houndWarning() {
    const first = this.houndTime();
    return this.stall >= first - HOUNDS.warn && this.stall < first;
  }

  /** Stall too long and Hounds come: one beside you, then another every HOUNDS.every s. */
  private updateHounds(dt: number) {
    this.stall += dt;
    if (this.stall < this.nextHound || !this.flying) return;
    this.nextHound = this.stall + HOUNDS.every;
    const c = this.craft;
    this.spawn('hound', c.x + c.facing * HOUNDS.ahead, Math.max(CRAFT.minY + 20, c.y - 30));
  }

  /** Smart bomb: everything on screen goes (hostiles score), nothing off screen is touched. */
  private pulse() {
    if (this.pulses <= 0 || !this.flying) return;
    this.pulses--;
    for (const e of [...this.hostiles]) if (this.onScreen(e.x, 8)) this.kill(e);
    for (const m of this.mines) if (this.onScreen(m.x, 8)) m.life = 0;
    this.shots = this.shots.filter((sh) => !this.onScreen(sh.x, 8));
    this.cameras.main.flash(160, 255, 255, 255);
  }

  private updateHazards(dt: number) {
    for (const sh of this.shots) {
      sh.x = wrap(sh.x + sh.vx * dt);
      sh.y += sh.vy * dt;
      sh.life -= dt;
    }
    this.shots = this.shots.filter((sh) => sh.life > 0 && sh.y > HUD_H && sh.y < GROUND_Y);
    for (const m of this.mines) {
      m.life -= dt;
      m.arm -= dt;
      if (m.life <= 0) m.img.destroy();
    }
    this.mines = this.mines.filter((m) => m.life > 0);
  }

  private shoot(e: Hostile) {
    const c = this.craft, dx = wdx(e.x, c.x), dy = c.y - e.y, d = Math.hypot(dx, dy) || 1;
    this.shots.push({ x: e.x, y: e.y, vx: (dx / d) * FIRE.speed, vy: (dy / d) * FIRE.speed, life: FIRE.life });
  }

  /** Puts a mine on the ring (Minelayers, and test hooks). */
  layMine(x: number, y: number) {
    const img = this.add.image(0, 0, 'mine').setScale(0.5).setDepth(6.5);
    this.mines.push({ x: wrap(x), y, life: MINE.life, arm: MINE.arm, img });
  }

  private get flying() {
    return this.craft.down <= 0 && this.over <= 0;
  }

  /** Push the way you want to go: a strong push turns the craft, a weak one only nudges it. */
  private fly(input: ControlState, dt: number) {
    const c = this.craft;
    c.invuln = Math.max(0, c.invuln - dt);
    if (c.down > 0) {
      c.down -= dt;
      if (c.down <= 0 && this.over <= 0) {
        c.down = 0;
        c.invuln = LIFE.invuln;
      }
    }
    const mx = this.flying ? input.move.x : 0, my = this.flying ? input.move.y : 0;
    if (Math.abs(mx) > CRAFT.turnThreshold) c.facing = Math.sign(mx);
    c.vx += mx * CRAFT.accel * dt;
    if (!mx) c.vx *= Math.exp(-CRAFT.drag * dt);
    c.vx = Phaser.Math.Clamp(c.vx, -CRAFT.maxSpeed, CRAFT.maxSpeed);
    c.x = wrap(c.x + c.vx * dt);
    c.y = Phaser.Math.Clamp(c.y + my * CRAFT.climb * dt, CRAFT.minY, CRAFT.maxY);
    c.lead += (c.facing * CRAFT.lead - c.lead) * Math.min(1, dt * CRAFT.leadEase);
    const cam = wrap(c.x + c.lead);
    this.travel += wdx(this.camX, cam);
    this.camX = cam;
  }

  private fire(input: ControlState, dt: number) {
    this.fireCool -= dt;
    if (!input.fire || !this.flying || this.fireCool > 0) return;
    const c = this.craft;
    this.beams.push({ x: wrap(c.x + c.facing * 9), y: c.y + 1, dir: c.facing, len: 0, life: LASER.life, stop: Infinity });
    this.fireCool = LASER.cooldown;
  }

  /** Each streak grows until it reaches its range or the first solid hostile in its line. */
  private updateBeams(dt: number) {
    for (const b of this.beams) {
      b.life -= dt;
      b.len = Math.min(b.stop, b.len + LASER.speed * dt, LASER.range);
      if (b.stop < Infinity) continue;
      let hit: Hostile | undefined, nearest = Infinity;
      for (const e of this.hostiles) {
        if (e.dead || e.warp > 0) continue;
        const d = wdx(b.x, e.x) * b.dir;
        if (d > -4 && d < b.len && d < nearest && Math.abs(e.y - b.y) < LASER.halfHeight) { hit = e; nearest = d; }
      }
      if (hit) {
        b.stop = b.len = Math.max(0, nearest);
        this.kill(hit);
      }
    }
    this.beams = this.beams.filter((b) => b.life > 0);
  }

  private updateHostiles(dt: number) {
    for (const e of this.hostiles) {
      if (e.dead) continue;
      e.t += dt;
      if (e.warp > 0) { e.warp = Math.max(0, e.warp - dt); continue; }
      const c = this.craft;
      if (e.kind === 'snatcher') updateSnatcher(e, dt, this.colonists, this.hostiles);
      else if (e.kind === 'husk') updateHusk(e, dt, c.x, c.y);
      else if (e.kind === 'hound') updateHound(e, dt, c.x, c.y);
      else if (updateMinelayer(e, dt)) this.layMine(e.x, e.y + 6);
      if (tickFire(e, dt) && this.flying && this.onScreen(e.x, -8)) this.shoot(e);
    }
  }

  private updateColonists(dt: number) {
    const c0 = this.craft;
    for (const c of this.colonists) {
      if (c.state === 'carried') {
        c.x = c0.x;
        c.y = c0.y + COLONIST.hang;
        if (c.y >= GROUND_Y - 10) {
          setDown(c);
          c0.carry = undefined;
          this.addScore(POINTS.land, c.x, c.y, 'SAFE ' + POINTS.land);
        }
        continue;
      }
      const landed = updateColonist(c, dt);
      if (landed === 'survived') this.addScore(POINTS.safeFall, c.x, c.y);
      if (c.state === 'falling' && this.flying && !c0.carry
        && Math.abs(wdx(c0.x, c.x)) < COLONIST.catchX && Math.abs(c0.y + 8 - c.y) < COLONIST.catchY) {
        c.state = 'carried';
        c0.carry = c;
        this.addScore(POINTS.catch, c.x, c.y, 'CAUGHT ' + POINTS.catch);
      }
    }
  }

  /** The craft against every solid hostile, shot and armed mine. A ram destroys both. */
  private collide() {
    const c = this.craft;
    if (!this.flying || c.invuln > 0) return;
    const near = (x: number, y: number, hx: number, hy: number) => Math.abs(wdx(c.x, x)) < hx && Math.abs(c.y - y) < hy;
    for (const sh of this.shots) {
      if (!near(sh.x, sh.y, FIRE.hitX, FIRE.hitY)) continue;
      sh.life = 0;
      this.destroyCraft();
      return;
    }
    for (const m of this.mines) {
      if (m.arm > 0 || !near(m.x, m.y, MINE.hitX, MINE.hitY)) continue;
      m.life = 0;
      this.destroyCraft();
      return;
    }
    for (const e of this.hostiles) {
      if (e.dead || e.warp > 0) continue;
      if (Math.abs(wdx(c.x, e.x)) < HOSTILE.hitX && Math.abs(c.y - e.y) < HOSTILE.hitY) {
        this.kill(e);
        this.destroyCraft();
        return;
      }
    }
  }

  private kill(e: Hostile) {
    if (e.dead) return;
    this.addScore(POINTS[e.kind], e.x, e.y);
    this.remove(e);
  }

  private destroyCraft() {
    const c = this.craft;
    if (c.carry) {
      drop(c.carry);
      c.carry = undefined;
    }
    c.vx = 0;
    this.ships = Math.max(0, this.ships - 1);
    c.down = LIFE.respawnDelay;
    if (this.ships === 0) {
      // Placeholder until milestone 4 brings the real game-over screen with RETRY and TITLE.
      this.over = LIFE.gameOverDelay;
      this.add.text(WIDTH / 2, 100, 'GAME OVER', { fontFamily: FONT, fontSize: '16px', color: TEXT.danger })
        .setOrigin(0.5).setDepth(12);
    }
  }

  /** Scores and floats the points up from (x, y). */
  private addScore(n: number, x: number, y: number, label = String(n)) {
    this.score += n;
    const text = this.add.text(0, y - 12, label, { fontFamily: FONT, fontSize: '8px', color: TEXT.amber })
      .setOrigin(0.5).setDepth(11);
    this.popups.push({ x, life: 1, text });
  }

  private updatePopups(dt: number) {
    for (const p of this.popups) {
      p.life -= dt;
      p.text.y -= 14 * dt;
      p.text.setAlpha(Math.min(1, p.life / 0.3));
      if (p.life <= 0) p.text.destroy();
    }
    this.popups = this.popups.filter((p) => p.life > 0);
  }

  private draw() {
    const blink = (hz: number) => Math.floor(this.clock * hz) % 2 === 0;
    const place = (img: Phaser.GameObjects.Image, x: number, y: number) => {
      const on = this.onScreen(x);
      img.setVisible(on);
      if (on) img.setPosition(Math.round(this.sx(x)), Math.round(y));
      return on;
    };
    const g = this.lines.clear();

    for (const c of this.colonists) {
      if (c.state === 'dead') { c.img.setVisible(false); continue; }
      if (!place(c.img, c.x, c.y)) continue;
      c.img.setFlipX(c.dir < 0).setTintMode(c.state === 'taken' && blink(6) ? Phaser.TintModes.FILL : Phaser.TintModes.MULTIPLY);
    }

    for (const e of this.hostiles) {
      if (!place(e.img, e.x, e.y)) continue;
      const x = Math.round(this.sx(e.x)), y = Math.round(e.y);
      if (e.warp > 0) {
        // Warp-in: faint and closing in on itself, so it's seen before it can hurt.
        const k = e.warp / HOSTILE.warp;
        e.img.setAlpha(0.25 + 0.5 * (1 - k));
        g.lineStyle(1, COLORS.beam, 0.8).strokeCircle(x, y, 4 + 16 * k);
        continue;
      }
      const warn = canFire(e) && e.cool < FIRE.warn && blink(14);
      e.img.setAlpha(1).setTintMode(warn ? Phaser.TintModes.FILL : Phaser.TintModes.MULTIPLY);
      if (e.kind === 'hound') e.img.setFlipX(e.vx < 0);
      if (e.carry) {
        g.fillStyle(0x7dffb0, 0.45);
        for (let yy = y + 5; yy < e.carry.y - 6; yy += 3) g.fillRect(x - 1, Math.round(yy), 2, 1);
      }
    }

    for (const m of this.mines) {
      if (!place(m.img, m.x, m.y)) continue;
      m.img.setAlpha(m.arm > 0 ? 0.35 : m.life < 1 && blink(8) ? 0.4 : 1);
    }
    for (const sh of this.shots) {
      if (!this.onScreen(sh.x)) continue;
      g.fillStyle(blink(12) ? 0xffffff : COLORS.danger).fillRect(Math.round(this.sx(sh.x)) - 1, Math.round(sh.y) - 1, 2, 2);
    }

    for (const b of this.beams) {
      const x0 = this.sx(b.x), a = Math.max(0, b.life / LASER.life);
      const seg = (from: number, to: number, color: number, h: number) => {
        const xa = x0 + b.dir * from, xb = x0 + b.dir * to;
        g.fillStyle(color, a).fillRect(Math.round(Math.min(xa, xb)), Math.round(b.y) - (h > 1 ? 1 : 0), Math.max(1, Math.round(Math.abs(xb - xa))), h);
      };
      for (let d = 0; d < b.len - 16; d += 6) seg(d, Math.min(d + 4, b.len - 16), d < b.len * 0.4 ? 0xff5fd2 : COLORS.beam, 1);
      seg(Math.max(0, b.len - 16), b.len, 0xffffff, 2);
    }

    for (const p of this.popups) p.text.setX(Math.round(this.sx(p.x)));
    this.drawCraft(blink);
  }

  private drawCraft(blink: (hz: number) => boolean) {
    const c = this.craft, x = Math.round(this.sx(c.x)), y = Math.round(c.y);
    const shown = c.down <= 0 && !(c.invuln > 0 && blink(10));
    this.craftImg.setVisible(shown).setPosition(x, y).setFlipX(MIRROR.has('player') !== c.facing < 0);
    const g = this.flame.clear();
    if (shown && Math.abs(c.vx) > 30 && Math.sign(c.vx) === c.facing) {
      const len = Math.abs(c.vx) > 120 ? 4 : 2;
      g.fillStyle(blink(20) ? COLORS.amber : COLORS.flame);
      g.fillRect(c.facing > 0 ? x - 8 - len : x + 8, y, len, 1);
    }
  }

  private leave() {
    if (this.leaving) return;
    this.leaving = true;
    this.cameras.main.fadeOut(250);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('title'));
  }
}

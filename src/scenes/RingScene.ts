import Phaser from 'phaser';
import {
  COLONIST, COLORS, CRAFT, EXTRA_EVERY, FIRE, FONT, KIND_COLORS, GROUND_Y, HOSTILE, HOUNDS, HUD_H, HUD_STATE, LASER, LIFE, MINE, MIRROR, POINTS,
  RENDER_SCALE, TEXT, WAVES, WIDTH, WORLD_W,
} from '../config';
import { Backdrop } from '../backdrop';
import { Controls, type ControlState } from '../controls';
import { createColonists, drop, setDown, updateColonist, type Colonist } from '../entities/colonist';
import {
  canFire, createHostile, fuse, release, tickFire, updateHound, updateHusk, updateMinelayer, updateSnatcher, type Hostile, type HostileKind,
} from '../entities/hostile';
import { Effects } from '../effects';
import { touchControls } from '../touch';
import { playSound, toggleMute, type SoundName } from '../sfx';
import { bonusFor, firePaceOf, minelayersIn, paceOf, restores, snatchersIn } from '../waves';
import { fitCamera } from '../view';
import { wdx, wrap } from '../world';
import { SCAN, type HudState, type ScanState } from './HudScene';

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
  private fx!: Effects;
  /** Whole seconds of the Hound warning already beeped. */
  private warnBeeps = 0;
  private banner!: { title: Phaser.GameObjects.Text; sub: Phaser.GameObjects.Text; life: number };

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
  /** Runs the waves: arrivals, wave end, Hounds. Test hooks switch it off with calm(). */
  spawning = true;
  wave = 1;
  /** Snatchers this wave still to warp in, and seconds until the next group. */
  toSpawn = 0;
  groupT = 0;
  /** Seconds left in the break between waves; 0 during a wave. */
  between = 0;
  /** Seconds since the last ship was lost; -1 while the run is on. */
  over = -1;
  /** Seconds spent in this wave, for the Hound timer, and when the next Hound comes. */
  stall = 0;
  nextHound = 0;
  private clock = 0;
  private fireCool = 0;
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
    this.over = -1;
    this.between = 0;
    this.leaving = false;
    this.spawning = true;
    this.beams = [];
    this.popups = [];
    this.hostiles = [];
    this.shots = [];
    this.mines = [];

    fitCamera(this, RENDER_SCALE);
    this.warnBeeps = 0;
    this.cameras.main.fadeIn(250);
    this.controls = new Controls(this);
    this.backdrop = new Backdrop(this, 0);
    this.colonists = createColonists(this);
    this.lines = this.add.graphics().setDepth(8);
    this.flame = this.add.graphics().setDepth(9);
    this.craftImg = this.add.image(0, 0, 'player').setDepth(10);
    this.fx = new Effects(this);
    // Banners sit behind every sprite, so they never hide a hazard.
    const bannerText = (y: number, size: number, color: string) =>
      this.add.text(WIDTH / 2, y, '', { fontFamily: FONT, fontSize: `${size}px`, color, align: 'center' }).setOrigin(0.5).setDepth(5);
    this.banner = { title: bannerText(84, 16, TEXT.amber), sub: bannerText(102, 8, TEXT.ink), life: 0 };
    this.startWave(1);
    this.scene.launch('hud');
    touchControls.show(true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scene.stop('hud');
      touchControls.show(false);
    });
  }

  update(_time: number, delta: number) {
    const dt = Math.min(0.05, delta / 1000);
    this.clock += dt;
    const input = this.controls.read();
    if (input.mute) toggleMute(this);
    if (input.back) this.leave();
    if (this.over >= 0 && (this.over += dt) > LIFE.retryDelay && input.confirm) this.retry();

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
    if (!this.dark && this.colonists.every((c) => c.state === 'dead')) this.goDark();
    if (this.spawning) this.runWave(dt);
    if ((this.banner.life -= dt) <= 0) this.banner.title.setVisible(false), this.banner.sub.setVisible(false);

    this.backdrop.update(this.camX, this.travel, this.clock);
    this.fx.update(dt, this.travel);
    this.draw();

    const hud: HudState = {
      score: this.score, ships: this.ships, pulses: this.pulses, wave: this.wave, device: input.device,
      hound: this.hostiles.some((e) => e.kind === 'hound') ? 'on' : this.houndWarning ? 'blink' : 'off',
      taken: this.colonists.some((c) => c.state === 'taken'),
      over: this.over >= 0,
      scan: this.scanState(),
      colonists: this.colonists.map((c) => (c.state === 'dead' ? 0 : c.state === 'taken' ? 2 : 1)),
    };
    this.registry.set(HUD_STATE, hud);
  }

  /** What the scanner shows: the craft, the view, and a dot per live colonist and solid hostile. */
  private scanState(): ScanState {
    const dots: number[] = [];
    for (const c of this.colonists) if (c.state !== 'dead') dots.push(c.x, c.y, c.state === 'taken' ? SCAN.taken : SCAN.colonist);
    for (const e of this.hostiles) if (e.warp <= 0) dots.push(e.x, e.y, SCAN[e.kind]);
    return { craftX: this.craft.x, craftY: this.craft.y, camX: this.camX, dark: this.dark, dots };
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

  get dark() {
    return this.backdrop.isDark;
  }

  /** A world x somewhere in the part of the ring you can't see: slot i of n, spread evenly round it. */
  private unseenX(i: number, n: number) {
    const span = WORLD_W - WIDTH - 120;
    return this.camX + WIDTH / 2 + 60 + ((i + Math.random() * 0.5) * span) / n;
  }

  /** The next group of Snatchers (Husks while the ring is dark), spread round the part of the ring you can't see. */
  private spawnGroup() {
    const n = Math.min(WAVES.group, this.toSpawn);
    this.toSpawn -= n;
    this.groupT = WAVES.groupEvery;
    for (let i = 0; i < n; i++) this.spawn(this.dark ? 'husk' : 'snatcher', this.unseenX(i, n), 60 + Math.random() * 60);
  }

  private startWave(n: number) {
    this.wave = n;
    this.between = 0;
    this.stall = 0;
    this.nextHound = this.houndTime();
    if (restores(n)) this.restore();
    this.toSpawn = snatchersIn(n);
    this.spawnGroup();
    const layers = minelayersIn(n);
    for (let i = 0; i < layers; i++) this.spawn('minelayer', this.unseenX(i, layers), 80 + Math.random() * 50);
    this.showBanner(`WAVE ${n}`, '', WAVES.banner);
    if (n > 1) this.sfx('start');
  }

  /** Groups keep coming until the wave's quota is out; the wave ends when every Snatcher, Husk and Minelayer is gone. */
  private runWave(dt: number) {
    if (this.between > 0) {
      if ((this.between -= dt) <= 0) this.startWave(this.wave + 1);
      return;
    }
    if (this.over >= 0) return;
    this.groupT -= dt;
    const hunting = this.hostiles.some((e) => e.kind === 'snatcher' || (this.dark && e.kind === 'husk'));
    if (this.toSpawn > 0 && (this.groupT <= 0 || !hunting)) this.spawnGroup();
    if (this.toSpawn === 0 && this.hostiles.every((e) => e.kind === 'hound')) this.endWave();
  }

  /** Clears the leftovers, pays the colonist bonus and starts the break before the next wave. */
  private endWave() {
    [...this.hostiles].forEach((e) => this.remove(e));
    this.mines.forEach((m) => m.img.destroy());
    this.mines = [];
    this.shots = [];
    const alive = this.colonists.filter((c) => c.state !== 'dead').length;
    const bonus = bonusFor(this.wave, alive);
    this.gain(bonus);
    this.sfx('waveClear');
    this.showBanner(`WAVE ${this.wave} CLEARED`, `BONUS  ${alive} × ${bonusFor(this.wave, 1)}  =  ${bonus}`, WAVES.intermission);
    this.between = WAVES.intermission;
    this.nextHound = Infinity;
  }

  /** The last colonist is gone: the lights die, and every Snatcher becomes a Husk. */
  private goDark() {
    this.backdrop.setDark(true);
    for (const e of this.hostiles) {
      if (e.kind !== 'snatcher') continue;
      fuse(e);
      if (this.onScreen(e.x)) this.fx.pop(this.sx(e.x), e.y, [...KIND_COLORS.husk], 10);
    }
    this.sfx('dark');
    this.fx.flash(350, 0.6);
    this.fx.shake(4);
    this.fx.kick(0.08, 60, 0.02);
    this.showBanner('THE RING IS DARK', 'COLONISTS RETURN ON WAVE ' + Math.ceil((this.wave + 1) / WAVES.restoreEvery) * WAVES.restoreEvery, 2.5);
  }

  /** Every 5th wave: all ten colonists back on the hull, and the lights on. */
  private restore() {
    this.backdrop.setDark(false);
    this.craft.carry = undefined;
    this.colonists.forEach((c) => c.img.destroy());
    this.colonists = createColonists(this);
  }

  private showBanner(title: string, sub: string, secs: number) {
    this.banner.title.setText(title).setVisible(true);
    this.banner.sub.setText(sub).setVisible(!!sub);
    this.banner.life = secs;
  }

  /** Test hook: ends the wave as if every hostile had been destroyed. */
  clearWave() {
    this.toSpawn = 0;
    [...this.hostiles].forEach((e) => this.remove(e));
    this.spawning = true;
  }

  retry() {
    this.scene.restart();
  }

  /** Seconds into a wave before the first Hound: shorter each wave, down to a floor. */
  private houndTime() {
    return Math.max(HOUNDS.min, HOUNDS.first - HOUNDS.perWave * (this.wave - 1));
  }

  /** True while the HOUND lamp blinks: the last few seconds before the first Hound of the wave. */
  get houndWarning() {
    const first = this.houndTime();
    return this.nextHound === first && this.stall >= first - HOUNDS.warn && this.stall < first;
  }

  /** Stall too long and Hounds come: one beside you, then another every HOUNDS.every s. */
  private updateHounds(dt: number) {
    this.stall += dt;
    if (this.houndWarning) {
      const beeps = Math.floor(this.stall - (this.houndTime() - HOUNDS.warn)) + 1;
      if (beeps > this.warnBeeps) { this.warnBeeps = beeps; this.sfx('houndWarn'); }
    } else if (this.stall < 1) this.warnBeeps = 0;
    if (this.stall < this.nextHound || !this.flying) return;
    this.nextHound = this.stall + HOUNDS.every;
    const c = this.craft;
    this.spawn('hound', c.x + c.facing * HOUNDS.ahead, Math.max(CRAFT.minY + 20, c.y - 30));
    this.sfx('warp');
  }

  /** Smart bomb: everything on screen goes (hostiles score), nothing off screen is touched. */
  private pulse() {
    if (this.pulses <= 0 || !this.flying) return;
    this.pulses--;
    for (const e of [...this.hostiles]) if (this.onScreen(e.x, 8)) this.kill(e, true);
    for (const m of this.mines) if (this.onScreen(m.x, 8)) this.fx.pop(this.sx(m.x), m.y, [...KIND_COLORS.mine], 5);
    for (const m of this.mines) if (this.onScreen(m.x, 8)) m.life = 0;
    this.shots = this.shots.filter((sh) => !this.onScreen(sh.x, 8));
    const x = this.sx(this.craft.x), y = this.craft.y;
    this.fx.wave(x, y, 0xffffff, 420, 500);
    this.fx.wave(x, y, COLORS.beam, 260, 650);
    this.fx.flash(160);
    this.fx.shake(3);
    this.fx.kick(0.1, 40, 0);
    this.sfx('pulse');
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
    this.sfx('bolt');
  }

  /** Puts a mine on the ring (Minelayers, and test hooks). */
  layMine(x: number, y: number) {
    const img = this.add.image(0, 0, 'mine').setScale(0.5).setDepth(6.5);
    this.mines.push({ x: wrap(x), y, life: MINE.life, arm: MINE.arm, img });
  }

  private get flying() {
    return this.craft.down <= 0 && this.over < 0;
  }

  /** Push the way you want to go: a strong push turns the craft, a weak one only nudges it. */
  private fly(input: ControlState, dt: number) {
    const c = this.craft;
    c.invuln = Math.max(0, c.invuln - dt);
    if (c.down > 0) {
      c.down -= dt;
      if (c.down <= 0 && this.over < 0) {
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
    this.sfx('laser');
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

  private updateHostiles(dt0: number) {
    // Later waves run the hostiles' clocks faster: they move and shoot more often.
    const pace = paceOf(this.wave), firePace = firePaceOf(this.wave);
    for (const e of this.hostiles) {
      const dt = dt0 * pace;
      if (e.dead) continue;
      e.t += dt;
      if (e.warp > 0) { e.warp = Math.max(0, e.warp - dt0); continue; }
      const c = this.craft;
      if (e.kind === 'snatcher') {
        const was = e.state;
        if (updateSnatcher(e, dt, this.colonists, this.hostiles) === 'fused') {
          this.sfx('fuse');
          if (this.onScreen(e.x)) this.fx.burst(this.sx(e.x), e.y, [...KIND_COLORS.husk]);
        } else if (was !== 'lift' && e.state === 'lift') this.sfx('snatch');
      }
      else if (e.kind === 'husk') updateHusk(e, dt, c.x, c.y);
      else if (e.kind === 'hound') updateHound(e, dt, c.x, c.y);
      else if (updateMinelayer(e, dt)) {
        this.layMine(e.x, e.y + 6);
        if (this.onScreen(e.x)) this.sfx('mine');
      }
      if (tickFire(e, dt0 * firePace) && this.flying && this.onScreen(e.x, -8)) this.shoot(e);
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
          this.sfx('land');
          this.fx.pop(this.sx(c.x), c.y, [COLORS.beam], 12);
          this.addScore(POINTS.land, c.x, c.y, 'SAFE ' + POINTS.land);
        }
        continue;
      }
      const landed = updateColonist(c, dt);
      if (landed === 'survived') {
        this.addScore(POINTS.safeFall, c.x, c.y);
        this.sfx('land');
        this.fx.pop(this.sx(c.x), c.y, [COLORS.beam], 8);
      } else if (landed === 'lost') {
        this.sfx('lost');
        if (this.onScreen(c.x)) this.fx.burst(this.sx(c.x), c.y, [...KIND_COLORS.colonist]);
      }
      if (c.state === 'falling' && this.flying && !c0.carry
        && Math.abs(wdx(c0.x, c.x)) < COLONIST.catchX && Math.abs(c0.y + 8 - c.y) < COLONIST.catchY) {
        c.state = 'carried';
        c0.carry = c;
        this.sfx('catch');
        this.fx.pop(this.sx(c.x), c.y, [COLORS.beam], 10);
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

  /** Destroys and scores a hostile. A pulse plays one big sound for the lot, so its kills stay quiet. */
  private kill(e: Hostile, quiet = false) {
    if (e.dead) return;
    if (e.carry) this.sfx('fall');
    const big = e.kind === 'minelayer';
    this.addScore(POINTS[e.kind], e.x, e.y);
    this.fx.burst(this.sx(e.x), e.y, [...KIND_COLORS[e.kind]], big ? 'big' : 'small');
    if (!quiet) this.sfx(big ? 'boomBig' : 'boom');
    this.remove(e);
  }

  private sfx(name: SoundName) {
    playSound(this, name);
  }

  private destroyCraft() {
    const c = this.craft;
    if (c.carry) {
      drop(c.carry);
      c.carry = undefined;
      this.sfx('fall');
    }
    this.fx.burst(this.sx(c.x), c.y, [...KIND_COLORS.player], 'huge');
    this.fx.flash(120, 0.8);
    this.sfx('die');
    c.vx = 0;
    this.ships = Math.max(0, this.ships - 1);
    c.down = LIFE.respawnDelay;
    if (this.ships === 0) {
      this.over = 0;
      touchControls.show(false);
      this.time.delayedCall(900, () => this.sfx('gameOver'));
    }
  }

  /** Scores and floats the points up from (x, y). */
  private addScore(n: number, x: number, y: number, label = String(n)) {
    this.gain(n);
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

    // An amber arrow on the edge nearest each colonist being carried off out of sight, at their height.
    for (const c of this.colonists) {
      if (c.state !== 'taken' || this.onScreen(c.x, -4) || !blink(4)) continue;
      const side = wdx(this.camX, c.x) < 0 ? -1 : 1, x = side < 0 ? 4 : WIDTH - 5;
      const y = Math.round(Phaser.Math.Clamp(c.y, HUD_H + 6, GROUND_Y - 6));
      g.fillStyle(COLORS.amber);
      for (let i = 0; i < 4; i++) g.fillRect(x + side * i, y - (3 - i), 1, (3 - i) * 2 + 1);
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
    const shown = this.flying && !(c.invuln > 0 && blink(10));
    this.craftImg.setVisible(shown).setPosition(x, y).setFlipX(MIRROR.has('player') !== c.facing < 0);
    const g = this.flame.clear();
    if (shown && Math.abs(c.vx) > 30 && Math.sign(c.vx) === c.facing) {
      const len = Math.abs(c.vx) > 120 ? 4 : 2;
      g.fillStyle(blink(20) ? COLORS.amber : COLORS.flame);
      g.fillRect(c.facing > 0 ? x - 8 - len : x + 8, y, len, 1);
    }
  }

  /** Adds points, with an extra ship and pulse at every EXTRA_EVERY. */
  private gain(n: number) {
    const before = Math.floor(this.score / EXTRA_EVERY);
    this.score += n;
    const extra = Math.floor(this.score / EXTRA_EVERY) - before;
    if (extra <= 0 || this.over >= 0) return;
    this.ships += extra;
    this.pulses += extra;
    this.sfx('extraShip');
    const c = this.craft, text = this.add.text(0, c.y - 20, '+SHIP +PULSE', { fontFamily: FONT, fontSize: '8px', color: TEXT.beam })
      .setOrigin(0.5).setDepth(11);
    this.popups.push({ x: c.x, life: 1.5, text });
  }

  leave() {
    if (this.leaving) return;
    this.leaving = true;
    this.cameras.main.fadeOut(250);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('title'));
  }
}

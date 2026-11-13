import Phaser from 'phaser';
import { COLORS, CRAFT, HUD_STATE, MIRROR, RENDER_SCALE, WIDTH } from '../config';
import { Backdrop } from '../backdrop';
import { Controls, type ControlState } from '../controls';
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

  // Run state, all reset in create() (scene.restart reuses this instance).
  craft: Craft = { x: 0, y: 0, vx: 0, facing: 1, lead: 0 };
  camX = 0;
  /** Unwrapped distance the view has moved, for the parallax layers. */
  travel = 0;
  private clock = 0;
  private score = 0;
  private ships = 0;
  private pulses = 0;
  private leaving = false;

  constructor() {
    super('ring');
  }

  create() {
    this.craft = { x: CRAFT.startX, y: CRAFT.startY, vx: 0, facing: 1, lead: CRAFT.lead };
    this.camX = wrap(this.craft.x + this.craft.lead);
    this.travel = 0;
    this.clock = 0;
    this.score = 0;
    this.ships = CRAFT.ships;
    this.pulses = CRAFT.pulses;
    this.leaving = false;

    fitCamera(this, RENDER_SCALE);
    this.cameras.main.fadeIn(250);
    this.controls = new Controls(this);
    this.backdrop = new Backdrop(this, 0);
    this.flame = this.add.graphics().setDepth(9);
    this.craftImg = this.add.image(0, 0, 'player').setDepth(10);
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
    this.backdrop.update(this.camX, this.travel, this.clock);
    this.drawCraft();

    const hud: HudState = { score: this.score, ships: this.ships, pulses: this.pulses, wave: 1, device: input.device };
    this.registry.set(HUD_STATE, hud);
  }

  /** Screen x of a world x. */
  sx(x: number) {
    return WIDTH / 2 + wdx(this.camX, x);
  }

  /** Push the way you want to go: a strong push turns the craft, a weak one only nudges it. */
  private fly(input: ControlState, dt: number) {
    const c = this.craft, mx = input.move.x;
    if (Math.abs(mx) > CRAFT.turnThreshold) c.facing = Math.sign(mx);
    c.vx += mx * CRAFT.accel * dt;
    if (!mx) c.vx *= Math.exp(-CRAFT.drag * dt);
    c.vx = Phaser.Math.Clamp(c.vx, -CRAFT.maxSpeed, CRAFT.maxSpeed);
    c.x = wrap(c.x + c.vx * dt);
    c.y = Phaser.Math.Clamp(c.y + input.move.y * CRAFT.climb * dt, CRAFT.minY, CRAFT.maxY);
    c.lead += (c.facing * CRAFT.lead - c.lead) * Math.min(1, dt * CRAFT.leadEase);
    const cam = wrap(c.x + c.lead);
    this.travel += wdx(this.camX, cam);
    this.camX = cam;
  }

  private drawCraft() {
    const c = this.craft, x = Math.round(this.sx(c.x)), y = Math.round(c.y);
    this.craftImg.setPosition(x, y).setFlipX(MIRROR.has('player') !== c.facing < 0);
    const g = this.flame.clear();
    if (Math.abs(c.vx) > 30 && Math.sign(c.vx) === c.facing) {
      const len = Math.abs(c.vx) > 120 ? 4 : 2;
      g.fillStyle(Math.floor(this.clock * 20) % 2 ? COLORS.amber : COLORS.flame);
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

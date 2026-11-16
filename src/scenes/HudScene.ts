import Phaser from 'phaser';
import { COLORS, FONT, GROUND_Y, HUD_H, HUD_SCALE, HUD_STATE, KIND_COLORS, MIRROR, TEXT, WIDTH, WORLD_W } from '../config';
import { wdx } from '../world';
import type { Device } from '../controls';
import { MUTED, toggleMute } from '../sfx';
import type { RingScene } from './RingScene';
import { fitCamera } from '../view';

/** Scanner dot codes, so the ring scene can send a flat number list each frame. */
export const SCAN = { colonist: 0, taken: 1, snatcher: 2, husk: 3, minelayer: 4, hound: 5 } as const;
const SCAN_COLORS = [COLORS.beam, COLORS.amber, KIND_COLORS.snatcher[0], KIND_COLORS.husk[0], KIND_COLORS.minelayer[0], KIND_COLORS.hound[0]];

export interface ScanState {
  craftX: number;
  craftY: number;
  camX: number;
  dark: boolean;
  /** Flat triples: world x, y, SCAN code. */
  dots: number[];
}

export interface HudState {
  score: number;
  ships: number;
  pulses: number;
  wave: number;
  device: Device;
  /** HOUND lamp: blinks as the warning, stays lit while Hounds are out. */
  hound: 'off' | 'blink' | 'on';
  /** TAKEN lamp: a Snatcher is holding a colonist. */
  taken: boolean;
  /** The last ship is gone: show the game-over panel. */
  over: boolean;
  scan: ScanState;
  /** One per colonist: 0 lost, 1 alive, 2 being carried off. */
  colonists: number[];
  /** The high score (this run's score once it beats the stored one), and whether this run set it. */
  hi: number;
  newHi: boolean;
  paused: boolean;
  /** Attract mode: no hints, pause, sound or game-over panel. */
  attract: boolean;
}

// HUD space is the design size × HUD_SCALE (832×456): sprites drawn here at native 16 px come out half the size
// of game sprites, with no resampling.
const S = HUD_SCALE;
const W = WIDTH * S, BAR = HUD_H * S;
const MAX_ICONS = 4;
const HINTS: Record<Device, string> = {
  kbm: 'ARROWS FLY  ·  SPACE FIRE  ·  SHIFT PULSE  ·  P PAUSE  ·  M SOUND',
  pad: 'STICK FLY  ·  A FIRE  ·  B PULSE  ·  START PAUSE  ·  Y SOUND',
  touch: 'STICK FLY  ·  HOLD FIRE  ·  TAP PULSE',
};
const OVER_HINTS: Record<Device, string> = {
  kbm: 'ENTER RETRY  ·  ESC TITLE',
  pad: 'A RETRY  ·  BACK TITLE',
  touch: 'TAP RETRY OR TITLE',
};
const PAUSE_HINTS: Record<Device, string> = { kbm: 'P OR ENTER RESUME  ·  ESC TITLE', pad: 'START OR A RESUME  ·  BACK TITLE', touch: 'TAP RESUME' };
const PANEL = { w: 360, h: 172, y: 110 };
/** Pause on touch: two bars after the score, with a thumb-sized tap zone. */
const PAUSE = { x: 196, y: 9 };
/** The scanner, in HUD pixels: the whole ring squeezed between x0 and x1, centred on the craft. */
const SCANNER = { x0: 224, x1: 608, y0: 4, y1: 58 };
const PIPS = { x: 624, y: 36, step: 8, w: 6, h: 12 };
const SPEAKER = { x: W - 28, y: 8, w: 20, h: 16 };
const LAMP = { x: 716, w: 76, h: 20, hound: 6, taken: 32 };

const pts = (n: number) => String(n).padStart(6, '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Top bar and hint strip, drawn over the game at twice its resolution. */
export class HudScene extends Phaser.Scene {
  private score!: Phaser.GameObjects.Text;
  private wave!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private dynamic!: Phaser.GameObjects.Graphics;
  private icons: Phaser.GameObjects.Image[] = [];
  private shown = '';
  private lamps!: { hound: Phaser.GameObjects.Text; taken: Phaser.GameObjects.Text };
  private overPanel!: Phaser.GameObjects.Container;
  private overScore!: Phaser.GameObjects.Text;
  private overHi!: Phaser.GameObjects.Text;
  private pauseMenu!: Phaser.GameObjects.Container;
  private pauseHint!: Phaser.GameObjects.Text;
  private pauseZones: Phaser.GameObjects.Zone[] = [];
  private pauseTap!: Phaser.GameObjects.Zone;
  private speakerTap!: Phaser.GameObjects.Zone;

  constructor() {
    super('hud');
  }

  create() {
    fitCamera(this, HUD_SCALE);
    this.icons = [];
    this.shown = '';
    const label = (x: number, y: number, text: string, color = TEXT.dim) =>
      this.add.text(x, y, text, { fontFamily: FONT, fontSize: '16px', color });

    const g = this.add.graphics();
    g.fillStyle(COLORS.void).fillRect(0, 0, W, BAR);
    g.fillStyle(COLORS.line).fillRect(0, BAR - 2, W, 2);

    label(8, 8, 'SCORE');
    this.score = label(76, 8, '', TEXT.amber);
    label(624, 8, 'WAVE');
    this.wave = label(684, 8, '', TEXT.amber);
    this.dynamic = this.add.graphics();
    const lampText = (y: number, text: string) => label(LAMP.x + LAMP.w / 2, y + 1, text).setOrigin(0.5, 0).setDepth(1);
    this.lamps = { hound: lampText(LAMP.hound, 'HOUND'), taken: lampText(LAMP.taken, 'TAKEN') };
    this.hint = label(W / 2, (GROUND_Y + 4) * S, '').setOrigin(0.5, 0);

    this.overPanel = this.buildOverPanel(label);

    // Phones have no M key: the speaker is a tap target, padded for a thumb.
    this.speakerTap = this.add.zone(SPEAKER.x - 12, 0, SPEAKER.w + 24, BAR).setOrigin(0).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => toggleMute(this));
    // And no P key: on touch, II after the score pauses.
    this.pauseTap = this.add.zone(PAUSE.x - 16, 0, 46, BAR).setOrigin(0).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => (this.scene.get('ring') as RingScene).setPaused(true));
    this.buildPause(label);
  }

  /** The pause panel: RESUME and TITLE, as buttons a thumb or the mouse can hit. */
  private buildPause(label: (x: number, y: number, text: string, color?: string) => Phaser.GameObjects.Text) {
    const ring = () => this.scene.get('ring') as RingScene;
    this.pauseZones = [];
    const w = 380, h = 190, x = W / 2, top = PANEL.y, g = this.add.graphics();
    g.fillStyle(COLORS.void, 0.55).fillRect(0, BAR, W, GROUND_Y * S - BAR);
    g.fillStyle(COLORS.void, 0.94).fillRect(x - w / 2, top, w, h);
    g.lineStyle(2, COLORS.line).strokeRect(x - w / 2, top, w, h);
    const parts: Phaser.GameObjects.GameObject[] = [g, this.add.text(x, top + 20, 'PAUSED', { fontFamily: FONT, fontSize: '32px', color: TEXT.ink }).setOrigin(0.5, 0)];
    const button = (bx: number, text: string, primary: boolean, act: () => void) => {
      const bw = 150, bh = 48, by = top + 84, art = this.add.graphics();
      if (primary) art.fillStyle(COLORS.amber).fillRect(bx - bw / 2, by, bw, bh);
      else art.lineStyle(2, COLORS.ink).strokeRect(bx - bw / 2 + 1, by + 1, bw - 2, bh - 2);
      const t = label(bx, by + bh / 2, text, primary ? '#060813' : TEXT.ink).setOrigin(0.5);
      const zone = this.add.zone(bx - bw / 2, by, bw, bh).setOrigin(0).setInteractive({ useHandCursor: true }).on('pointerdown', act);
      this.pauseZones.push(zone);
      parts.push(art, t, zone);
    };
    button(x - 85, 'RESUME', true, () => ring().setPaused(false));
    button(x + 85, 'TITLE', false, () => ring().leave());
    this.pauseHint = label(x, top + h - 34, '').setOrigin(0.5, 0);
    parts.push(this.pauseHint);
    this.pauseMenu = this.add.container(0, 0, parts).setVisible(false).setDepth(10);
  }

  update() {
    const s = this.registry.get(HUD_STATE) as HudState | undefined;
    if (!s) return;
    this.dynamic.clear();
    this.score.setText(pts(s.score));
    this.wave.setText(String(s.wave).padStart(2, '0'));
    this.hint.setText(s.attract || s.paused ? '' : (s.over ? OVER_HINTS : HINTS)[s.device]);
    const over = s.over && !s.attract;
    if (over !== this.overPanel.visible) {
      this.overPanel.setVisible(over);
      this.overScore.setText(`SCORE ${pts(s.score)}   ·   WAVE ${String(s.wave).padStart(2, '0')}`);
      this.overHi.setText(s.newHi ? 'NEW HIGH SCORE!' : `HI ${pts(s.hi)}`).setColor(s.newHi ? TEXT.amber : TEXT.dim);
    }
    const pauseTap = s.device === 'touch' && !s.attract && !s.over && !s.paused;
    this.pauseTap.input!.enabled = pauseTap;
    this.speakerTap.input!.enabled = !s.attract;
    this.pauseMenu.setVisible(s.paused);
    for (const z of this.pauseZones) z.input!.enabled = s.paused;
    if (s.paused) this.pauseHint.setText(PAUSE_HINTS[s.device]);

    const key = `${s.ships}:${s.pulses}`;
    if (key !== this.shown) {
      this.shown = key;
      this.icons.forEach((i) => i.destroy());
      this.icons = [
        ...Array.from({ length: Math.min(s.ships, MAX_ICONS) }, (_, i) => this.add.image(16 + i * 20, 42, 'player').setFlipX(MIRROR.has('player'))),
        ...Array.from({ length: Math.min(s.pulses, MAX_ICONS) }, (_, i) => this.add.image(112 + i * 20, 42, 'pulse')),
      ];
    }

    const blink = (hz: number) => Math.floor(this.time.now / (500 / hz)) % 2 === 0;
    this.drawScanner(s.scan, blink);
    s.colonists.forEach((c, i) => {
      this.dynamic.fillStyle(c === 0 ? COLORS.line : c === 2 && blink(6) ? COLORS.amber : COLORS.beam)
        .fillRect(PIPS.x + i * PIPS.step, PIPS.y, PIPS.w, PIPS.h);
    });
    this.lamp(this.lamps.hound, LAMP.hound, s.hound === 'on' || (s.hound === 'blink' && blink(4)), COLORS.danger);
    this.lamp(this.lamps.taken, LAMP.taken, s.taken && blink(3), COLORS.amber);

    if (pauseTap) this.dynamic.fillStyle(COLORS.ink).fillRect(PAUSE.x, PAUSE.y, 5, 14).fillRect(PAUSE.x + 9, PAUSE.y, 5, 14);
    if (s.attract) return;
    // Speaker: three waves when on, a cross when muted. Drawn in 2 px blocks to match the game's pixels.
    const muted = this.registry.get(MUTED) === true;
    const g = this.dynamic.fillStyle(muted ? COLORS.danger : COLORS.ink);
    const px = (x: number, y: number, w = 1, h = 1) => g.fillRect(SPEAKER.x + x * 2, SPEAKER.y + y * 2, w * 2, h * 2);
    px(0, 2, 2, 3); px(2, 1, 1, 5); px(3, 0, 1, 7);
    if (muted) for (let i = 0; i < 4; i++) { px(5 + i, 1 + i); px(8 - i, 1 + i); }
    else { px(5, 2, 1, 3); px(7, 1, 1, 5); px(9, 0, 1, 7); }
  }

  /** GAME OVER, the final score, and RETRY / TITLE buttons big enough for a thumb. Hidden until the run ends. */
  private buildOverPanel(label: (x: number, y: number, text: string, color?: string) => Phaser.GameObjects.Text) {
    const ring = () => this.scene.get('ring') as RingScene;
    const g = this.add.graphics();
    g.fillStyle(COLORS.void, 0.88).fillRect(-PANEL.w / 2, 0, PANEL.w, PANEL.h);
    g.lineStyle(2, COLORS.line).strokeRect(-PANEL.w / 2, 0, PANEL.w, PANEL.h);
    const title = this.add.text(0, 14, 'GAME OVER', { fontFamily: FONT, fontSize: '32px', color: TEXT.danger }).setOrigin(0.5, 0);
    this.overScore = label(0, 58, '', TEXT.ink).setOrigin(0.5, 0);
    this.overHi = label(0, 82, '', TEXT.dim).setOrigin(0.5, 0);
    const button = (x: number, text: string, act: () => void) => {
      const b = this.add.text(x, 116, text, {
        fontFamily: FONT, fontSize: '16px', color: TEXT.amber, backgroundColor: '#0e1228', padding: { x: 16, y: 10 },
      }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
      b.on('pointerdown', act);
      return b;
    };
    const retry = button(-80, 'RETRY', () => ring().retry());
    const title2 = button(80, 'TITLE', () => ring().leave());
    return this.add.container(W / 2, PANEL.y, [g, title, this.overScore, this.overHi, retry, title2]).setDepth(5).setVisible(false);
  }

  /**
   * The whole ring at a glance, centred on the craft: colonists cyan (amber while taken), hostiles in their colours,
   * the craft a blinking white dash, and brackets marking what's on screen.
   */
  private drawScanner(s: ScanState, blink: (hz: number) => boolean) {
    const { x0, x1, y0, y1 } = SCANNER, w = x1 - x0, mid = x0 + w / 2, k = w / WORLD_W, g = this.dynamic;
    g.fillStyle(0x04050c).fillRect(x0, y0, w, y1 - y0);
    g.lineStyle(2, COLORS.line).strokeRect(x0 + 1, y0 + 1, w - 2, y1 - y0 - 2);
    g.fillStyle(s.dark ? 0x3a1520 : 0x2a8fa6);
    for (let x = x0 + 2; x < x1 - 2; x += 4) g.fillRect(x, y1 - 8, 2, 2);
    const sy = (y: number) => y0 + 4 + ((y - HUD_H) / (GROUND_Y - HUD_H)) * (y1 - y0 - 12);
    const dot = (wx: number, wy: number, color: number, dw: number, dh: number) => {
      const x = mid + wdx(s.craftX, wx) * k;
      if (x < x0 + 2 || x > x1 - 2 - dw) return;
      g.fillStyle(color).fillRect(Math.round(x), Math.round(sy(wy)), dw, dh);
    };
    for (let i = 0; i < s.dots.length; i += 3) {
      const code = s.dots[i + 2];
      if (code === SCAN.taken && !blink(6)) dot(s.dots[i], s.dots[i + 1], 0xffffff, 2, 4);
      else if (code <= SCAN.taken) dot(s.dots[i], s.dots[i + 1], SCAN_COLORS[code], 2, 4);
      else dot(s.dots[i], s.dots[i + 1], SCAN_COLORS[code], 4, 4);
    }
    if (blink(3)) dot(s.craftX, s.craftY, 0xffffff, 6, 2);
    g.fillStyle(COLORS.ink);
    for (const [edge, d] of [[-WIDTH / 2, 1], [WIDTH / 2, -1]] as const) {
      const rx = Math.round(mid + wdx(s.craftX, s.camX + edge) * k), hx = d > 0 ? rx : rx - 4;
      g.fillRect(rx, y0 + 2, 2, 6).fillRect(hx, y0 + 2, 6, 2).fillRect(rx, y1 - 8, 2, 6).fillRect(hx, y1 - 4, 6, 2);
    }
  }

  /** An alarm lamp: a dark slot with a dim label, or filled with its colour and a dark label when lit. */
  private lamp(text: Phaser.GameObjects.Text, y: number, on: boolean, color: number) {
    const g = this.dynamic;
    g.fillStyle(on ? color : COLORS.panel).fillRect(LAMP.x, y, LAMP.w, LAMP.h);
    g.lineStyle(2, on ? color : COLORS.line).strokeRect(LAMP.x + 1, y + 1, LAMP.w - 2, LAMP.h - 2);
    text.setColor(on ? '#060813' : TEXT.dim);
  }
}

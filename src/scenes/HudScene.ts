import Phaser from 'phaser';
import { COLORS, FONT, GROUND_Y, HUD_H, HUD_SCALE, HUD_STATE, MIRROR, TEXT, WIDTH } from '../config';
import type { Device } from '../controls';
import { MUTED, toggleMute } from '../sfx';
import { fitCamera } from '../view';

export interface HudState {
  score: number;
  ships: number;
  pulses: number;
  wave: number;
  device: Device;
}

// HUD space is the design size × HUD_SCALE (832×456): sprites drawn here at native 16 px come out half the size
// of game sprites, with no resampling. The scanner, lamps and colonist pips arrive in later milestones.
const S = HUD_SCALE;
const W = WIDTH * S, BAR = HUD_H * S;
const MAX_ICONS = 4;
const HINTS: Record<Device, string> = {
  kbm: 'ARROWS FLY  ·  SPACE FIRE  ·  SHIFT PULSE  ·  M SOUND',
  pad: 'STICK FLY  ·  A FIRE  ·  B PULSE  ·  Y SOUND',
  touch: 'STICK FLY  ·  HOLD FIRE  ·  TAP PULSE',
};
const SPEAKER = { x: W - 28, y: 8, w: 20, h: 16 };

const pts = (n: number) => String(n).padStart(6, '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Top bar and hint strip, drawn over the game at twice its resolution. */
export class HudScene extends Phaser.Scene {
  private score!: Phaser.GameObjects.Text;
  private wave!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private dynamic!: Phaser.GameObjects.Graphics;
  private icons: Phaser.GameObjects.Image[] = [];
  private shown = '';

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
    this.hint = label(W / 2, (GROUND_Y + 4) * S, '').setOrigin(0.5, 0);

    // Phones have no M key: the speaker is a tap target, padded for a thumb.
    this.add.zone(SPEAKER.x - 12, 0, SPEAKER.w + 24, BAR).setOrigin(0).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => toggleMute(this));
  }

  update() {
    const s = this.registry.get(HUD_STATE) as HudState | undefined;
    if (!s) return;
    this.score.setText(pts(s.score));
    this.wave.setText(String(s.wave).padStart(2, '0'));
    this.hint.setText(HINTS[s.device]);

    const key = `${s.ships}:${s.pulses}`;
    if (key !== this.shown) {
      this.shown = key;
      this.icons.forEach((i) => i.destroy());
      this.icons = [
        ...Array.from({ length: Math.min(s.ships, MAX_ICONS) }, (_, i) => this.add.image(16 + i * 20, 42, 'player').setFlipX(MIRROR.has('player'))),
        ...Array.from({ length: Math.min(s.pulses, MAX_ICONS) }, (_, i) => this.add.image(112 + i * 20, 42, 'pulse')),
      ];
    }

    // Speaker: three waves when on, a cross when muted. Drawn in 2 px blocks to match the game's pixels.
    const muted = this.registry.get(MUTED) === true;
    const g = this.dynamic.clear().fillStyle(muted ? COLORS.danger : COLORS.ink);
    const px = (x: number, y: number, w = 1, h = 1) => g.fillRect(SPEAKER.x + x * 2, SPEAKER.y + y * 2, w * 2, h * 2);
    px(0, 2, 2, 3); px(2, 1, 1, 5); px(3, 0, 1, 7);
    if (muted) for (let i = 0; i < 4; i++) { px(5 + i, 1 + i); px(8 - i, 1 + i); }
    else { px(5, 2, 1, 3); px(7, 1, 1, 5); px(9, 0, 1, 7); }
  }
}

import Phaser from 'phaser';
import { ATTRACT, attractSeed } from '../attract';
import { loadHi } from '../hi';
import { CRAFT, FONT, MIRROR, RENDER_SCALE, SPRITES, TEXT, WIDTH, type SpriteKey } from '../config';
import { Backdrop } from '../backdrop';
import { Controls } from '../controls';
import { playMusic } from '../music';
import { playSound, registerSounds, restoreMute, toggleMute } from '../sfx';
import { fitCamera } from '../view';
import { wrap } from '../world';

const HOSTILES: SpriteKey[] = ['snatcher', 'husk', 'minelayer', 'hound'];

export class TitleScene extends Phaser.Scene {
  private controls!: Controls;
  private backdrop!: Backdrop;
  private padStatus: Phaser.GameObjects.Text | undefined;
  private start!: Phaser.GameObjects.Text;
  private leaving = false;
  private travel = 0;
  private clock = 0;

  constructor() {
    super('title');
  }

  preload() {
    for (const key of SPRITES) this.load.image(key, `sprites/${key}.png`);
  }

  create() {
    // Attract mode goes straight to the ring once the sprites are loaded.
    if (ATTRACT) return void this.scene.start('ring', { attract: attractSeed() });
    this.leaving = false;
    this.padStatus = undefined;
    this.controls = new Controls(this);
    fitCamera(this, RENDER_SCALE);
    registerSounds(this);
    restoreMute(this);
    playMusic(this, 'title');
    this.cameras.main.fadeIn(250);
    this.backdrop = new Backdrop(this, 0);
    // Colonists, mines and HUD icons play at half size; 0.5 is still pixel-exact on the 4x canvas.
    const sprite = (key: SpriteKey, x: number, y: number, scale = 1) => this.add.image(x, y, key).setFlipX(MIRROR.has(key)).setScale(scale).setDepth(5);

    const cx = WIDTH / 2;
    this.add.graphics().setDepth(4).fillStyle(0x060813, 0.72).fillRect(0, 0, WIDTH, 228);
    const text = (x: number, y: number, str: string, size: number, color: string) =>
      this.add.text(x, y, str, { fontFamily: FONT, fontSize: `${size}px`, color, align: 'center' }).setOrigin(0.5, 0).setDepth(5);

    text(cx, 10, 'ORBITAL RING PATROL', 8, TEXT.dim);
    text(cx, 20, 'SENTINEL', 24, TEXT.amber);
    text(cx, 48, 'SHOOT THE SNATCHERS. CATCH THE COLONISTS. HOLD THE RING.', 8, TEXT.ink);
    const hi = loadHi();
    if (hi) text(WIDTH - 40, 2, `HI ${hi.toLocaleString('en-US')}`, 8, TEXT.amber);

    text(66, 64, 'YOU', 8, TEXT.dim);
    sprite('player', 66, 84);
    text(140, 64, 'GUARD', 8, TEXT.beam);
    for (let i = 0; i < 3; i++) sprite('colonist', 128 + i * 12, 88, 0.5);
    text(274, 64, 'HOSTILES', 8, TEXT.danger);
    HOSTILES.forEach((key, i) => sprite(key, 238 + i * 18, 84));
    sprite('mine', 238 + HOSTILES.length * 18, 88, 0.5);

    this.start = text(cx, 106, '> START <', 16, TEXT.amber).setInteractive({ useHandCursor: true });
    this.start.on('pointerdown', () => this.begin());
    const touchScreen = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    text(cx, 128, touchScreen ? 'TAP START' : 'PRESS ENTER OR A, OR CLICK START', 8, TEXT.dim);

    const column = (x: number, title: string, keys: string, actions: string) => {
      text(x, 142, title, 8, TEXT.amber);
      this.add.text(x - 4, 154, keys, { fontFamily: FONT, fontSize: '8px', color: TEXT.ink, align: 'right', lineSpacing: 2 }).setOrigin(1, 0).setDepth(5);
      this.add.text(x + 4, 154, actions, { fontFamily: FONT, fontSize: '8px', color: TEXT.dim, lineSpacing: 2 }).setDepth(5);
    };
    if (touchScreen) {
      column(cx, 'TOUCH', 'LEFT THUMB\nRIGHT THUMB\nTAP II\nTAP SPEAKER', 'STICK: FLY\nFIRE + PULSE\nPAUSE, TOP LEFT\nSOUND, TOP RIGHT');
      return;
    }
    column(112, 'KEYBOARD + MOUSE', '← →\n↑ ↓\nSPACE / CLICK\nSHIFT / R-CLICK\nP\nM', 'FLY + FACE\nCLIMB / DIVE\nFIRE\nPULSE\nPAUSE\nSOUND ON/OFF');
    column(304, 'CONTROLLER', 'L-STICK\nA / RT\nB / LT\nSTART\nY', 'FLY + FACE\nFIRE\nPULSE\nPAUSE\nSOUND ON/OFF');
    this.padStatus = text(cx, 218, '', 8, TEXT.dim);
  }

  update(_time: number, delta: number) {
    const dt = delta / 1000;
    this.clock += dt;
    this.travel += 30 * dt;
    this.backdrop.update(wrap(CRAFT.startX + this.travel), this.travel, this.clock);
    const input = this.controls.read();
    if (input.mute) toggleMute(this);
    if (input.confirm) this.begin();
    this.start.setAlpha(Math.sin(this.clock * 4) > -0.5 ? 1 : 0.5);
    const pad = this.controls.pad();
    this.padStatus?.setText(pad ? 'CONTROLLER CONNECTED' : 'USING A CONTROLLER? PRESS ANY BUTTON ON IT').setColor(pad ? TEXT.beam : TEXT.dim);
  }

  private begin() {
    if (this.leaving) return;
    this.leaving = true;
    playSound(this, 'start');
    this.cameras.main.fadeOut(250);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('ring'));
  }
}

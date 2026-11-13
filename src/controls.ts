import Phaser from 'phaser';

export type Device = 'kbm' | 'pad' | 'touch';

export interface ControlState {
  /** Flight: x pushes left/right (and turns the craft past CRAFT.turnThreshold), y climbs (-) or dives (+). Each -1..1. */
  move: { x: number; y: number };
  /** Held. */
  fire: boolean;
  /** Edges: true only on the frame they're pressed. */
  pulse: boolean;
  confirm: boolean;
  back: boolean;
  mute: boolean;
  device: Device;
}

const DEADZONE = 0.2;
const TRIGGER_THRESHOLD = 0.3;
// Standard gamepad mapping (Xbox layout).
const BTN = { A: 0, B: 1, Y: 3, LB: 4, RB: 5, BACK: 8, START: 9 } as const;
const TRACKED = Object.values(BTN);

type KeyName = 'LEFT' | 'RIGHT' | 'UP' | 'DOWN' | 'A' | 'D' | 'W' | 'S' | 'SPACE' | 'J' | 'SHIFT' | 'K' | 'M' | 'ENTER' | 'ESC';

/**
 * One input layer. Keyboard: arrows or WASD fly, Space/J fire, Shift/K pulse, M sound, Enter start, Esc back.
 * Mouse: left button fires, right button pulses. Controller: left stick or D-pad flies, A/RT/RB fire, B/LT/LB pulse,
 * Y sound, Start/A confirm, Back returns. Touch arrives in milestone 6. The last device used decides the hints.
 * Construct one per scene.
 */
export class Controls {
  /** Phones and tablets start in touch mode, so the hints are right before the first touch. */
  device: Device = window.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'kbm';
  private prevButtons = new Set<number>();
  private prevTriggerL = false;
  private prevRightMouse = false;
  private readonly keys: Record<KeyName, Phaser.Input.Keyboard.Key>;

  constructor(private readonly scene: Phaser.Scene) {
    this.keys = scene.input.keyboard!.addKeys('LEFT,RIGHT,UP,DOWN,A,D,W,S,SPACE,J,SHIFT,K,M,ENTER,ESC') as Controls['keys'];
    scene.input.mouse?.disableContextMenu();
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => (this.device = p.wasTouch ? 'touch' : 'kbm'));
  }

  /** The first connected controller, if the browser has seen one (it needs a button press first). */
  pad(): Phaser.Input.Gamepad.Gamepad | undefined {
    const pad = this.scene.input.gamepad?.pad1;
    return pad && pad.connected ? pad : undefined;
  }

  read(): ControlState {
    const k = this.keys;
    const just = Phaser.Input.Keyboard.JustDown;
    const pointer = this.scene.input.activePointer;
    // Phaser reports a touch as a held left button, so only a real mouse fires this way.
    const mouse = !pointer.wasTouch && pointer.isDown;
    const rightMouse = mouse && pointer.rightButtonDown();
    const move = {
      x: (k.RIGHT.isDown || k.D.isDown ? 1 : 0) - (k.LEFT.isDown || k.A.isDown ? 1 : 0),
      y: (k.DOWN.isDown || k.S.isDown ? 1 : 0) - (k.UP.isDown || k.W.isDown ? 1 : 0),
    };
    let fire = k.SPACE.isDown || k.J.isDown || (mouse && pointer.leftButtonDown());
    let pulse = just(k.SHIFT) || just(k.K) || (rightMouse && !this.prevRightMouse);
    this.prevRightMouse = rightMouse;
    let confirm = just(k.ENTER) || just(k.SPACE);
    let back = just(k.ESC);
    let mute = just(k.M);
    if (move.x || move.y || fire || pulse || confirm || back || mute) this.device = 'kbm';

    const pad = this.pad();
    const down = new Set(pad ? TRACKED.filter((i) => pad.buttons[i]?.pressed) : []);
    const edges = new Set([...down].filter((i) => !this.prevButtons.has(i)));
    this.prevButtons = down;
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : v);
      let mx = dz(pad.leftStick.x), my = dz(pad.leftStick.y);
      if (pad.left) mx = -1;
      if (pad.right) mx = 1;
      if (pad.up) my = -1;
      if (pad.down) my = 1;
      const padFire = down.has(BTN.A) || down.has(BTN.RB) || pad.R2 > TRIGGER_THRESHOLD;
      const triggerL = pad.L2 > TRIGGER_THRESHOLD;
      const padPulse = edges.has(BTN.B) || edges.has(BTN.LB) || (triggerL && !this.prevTriggerL);
      this.prevTriggerL = triggerL;
      if (mx || my || down.size || padFire || triggerL) this.device = 'pad';
      if (mx || my) { move.x = mx; move.y = my; }
      fire ||= padFire;
      pulse ||= padPulse;
      confirm ||= edges.has(BTN.A) || edges.has(BTN.START);
      back ||= edges.has(BTN.BACK);
      mute ||= edges.has(BTN.Y);
    }
    const len = Math.hypot(move.x, move.y);
    if (len > 1) { move.x /= len; move.y /= len; }
    return { move, fire, pulse, confirm, back, mute, device: this.device };
  }
}

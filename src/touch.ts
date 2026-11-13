import { TOUCH, WIDTH } from './config';

type Button = 'fire' | 'pulse';
type Point = { x: number; y: number };
type Layout = { stick: Point & { r: number }; fire: Point & { r: number }; pulse: Point & { r: number }; sides: boolean; gutter: number };

const BUTTONS: Button[] = ['fire', 'pulse'];
const RGB = { stick: '255, 192, 77', fire: '111, 247, 255', pulse: '255, 77, 109' };
/** Gap (CSS px) kept between controls and the screen edges. */
const MARGIN = 8;

/**
 * The touch controls, drawn as page elements so they can sit in the empty bars beside the game on wide phones.
 * Touches are read from the whole page, because Phaser only hears touches that start on its canvas. The left thumb
 * holds the stick (anywhere in the left bar takes it); the right thumb can slide between FIRE and PULSE.
 */
class TouchControls {
  private stickHeld: { id: number; x: number; y: number } | undefined;
  /** Which button each other touch is on (or none). */
  private readonly held = new Map<number, Button | null>();
  private els: { ring: HTMLDivElement; knob: HTMLDivElement; fire: HTMLDivElement; pulse: HTMLDivElement } | undefined;
  private shown = false;
  private touched = false;
  private readonly coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;

  constructor() {
    window.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => {
      if (this.stickHeld?.id === e.pointerId) Object.assign(this.stickHeld, { x: e.clientX, y: e.clientY });
      else if (this.held.has(e.pointerId)) this.held.set(e.pointerId, this.button(e.clientX, e.clientY));
    });
    const up = (e: PointerEvent) => {
      if (this.stickHeld?.id === e.pointerId) this.stickHeld = undefined;
      this.held.delete(e.pointerId);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Shown while flying on touch screens (or once the screen has been touched); hidden on menus and game over. */
  show(on: boolean) {
    this.shown = on;
    if (!on) {
      this.stickHeld = undefined;
      this.held.clear();
    }
    this.render();
  }

  get active() {
    return this.stickHeld !== undefined || [...this.held.values()].some(Boolean);
  }

  /** The thumb's offset from the stick's centre, -1..1 on each axis, clamped to the rim. */
  stick(): Point | undefined {
    const h = this.stickHeld;
    if (!h) return undefined;
    const { stick } = this.layout();
    let x = (h.x - stick.x) / stick.r, y = (h.y - stick.y) / stick.r;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return len < TOUCH.deadzone ? { x: 0, y: 0 } : { x, y };
  }

  pressed(which: Button) {
    for (const b of this.held.values()) if (b === which) return true;
    return false;
  }

  /** Redraws the controls. Call once per frame. */
  render() {
    const visible = this.shown && (this.coarse || this.touched);
    if (!visible) {
      if (this.els) for (const el of [this.els.ring, this.els.fire, this.els.pulse]) el.style.display = 'none';
      return;
    }
    const els = (this.els ??= this.build());
    const l = this.layout(), v = this.stick(), on = Boolean(this.stickHeld);
    Object.assign(els.ring.style, {
      display: 'block', left: `${l.stick.x - l.stick.r}px`, top: `${l.stick.y - l.stick.r}px`, width: `${l.stick.r * 2}px`, height: `${l.stick.r * 2}px`,
      background: `rgba(${RGB.stick}, 0.08)`, border: `2px solid rgba(${RGB.stick}, ${on ? 0.6 : 0.35})`,
    });
    const k = l.stick.r * 0.4;
    Object.assign(els.knob.style, {
      width: `${k * 2}px`, height: `${k * 2}px`, background: `rgba(${RGB.stick}, ${on ? 0.55 : 0.25})`,
      transform: `translate(${l.stick.r - k - 2 + (v?.x ?? 0) * l.stick.r}px, ${l.stick.r - k - 2 + (v?.y ?? 0) * l.stick.r}px)`,
    });
    for (const b of BUTTONS) {
      const c = l[b], down = this.pressed(b);
      Object.assign(els[b].style, {
        display: 'flex', left: `${c.x - c.r}px`, top: `${c.y - c.r}px`, width: `${c.r * 2}px`, height: `${c.r * 2}px`,
        fontSize: `${Math.max(9, c.r * 0.42)}px`,
        background: `rgba(${RGB[b]}, ${down ? 0.45 : 0.12})`, border: `2px solid rgba(${RGB[b]}, ${down ? 0.85 : 0.45})`,
      });
    }
  }

  private down(e: PointerEvent) {
    if (e.pointerType !== 'touch' || !this.shown) return;
    this.touched = true;
    const l = this.layout();
    const nearStick = Math.hypot(e.clientX - l.stick.x, e.clientY - l.stick.y) <= l.stick.r * TOUCH.grab;
    const inLeftBar = l.sides && e.clientX < l.gutter;
    if (!this.stickHeld && (nearStick || inLeftBar)) {
      this.stickHeld = { id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    this.held.set(e.pointerId, this.button(e.clientX, e.clientY));
  }

  /** The nearest button within grab range of a point; in the right bar, the nearer of the two. */
  private button(x: number, y: number): Button | null {
    const l = this.layout();
    let best: Button | null = null, bestD = Infinity;
    for (const b of BUTTONS) {
      const d = Math.hypot(x - l[b].x, y - l[b].y);
      if (d < bestD && (d <= l[b].r * TOUCH.grab || (l.sides && x > window.innerWidth - l.gutter))) [best, bestD] = [b, d];
    }
    return best;
  }

  private layout(): Layout {
    const canvas = document.querySelector('#game canvas');
    const rect = canvas?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const k = rect.width / WIDTH;
    const gutter = Math.min(rect.left, window.innerWidth - rect.right);
    const base = TOUCH.stick.r * k;
    if (gutter >= base * 2 + MARGIN * 2) {
      // Wide screens: the stick fills the left bar; FIRE sits low in the right bar with PULSE above it.
      const r = Math.min(base * 1.25, gutter / 2 - MARGIN);
      const y = Math.min(rect.top + TOUCH.stick.y * k, window.innerHeight - r - MARGIN);
      const fr = Math.min(TOUCH.fire.r * k * 1.3, gutter / 2 - MARGIN), pr = fr * 0.72, rx = window.innerWidth - gutter / 2;
      return {
        sides: true, gutter,
        stick: { x: gutter / 2, y, r },
        fire: { x: rx, y, r: fr },
        pulse: { x: rx, y: Math.max(pr + MARGIN, y - fr - pr - MARGIN * 2), r: pr },
      };
    }
    const at = (p: { x: number; y: number; r: number }) => ({ x: rect.left + p.x * k, y: rect.top + p.y * k, r: p.r * k });
    return { sides: false, gutter, stick: at(TOUCH.stick), fire: at(TOUCH.fire), pulse: at(TOUCH.pulse) };
  }

  private build() {
    const ring = document.createElement('div');
    const knob = document.createElement('div');
    Object.assign(ring.style, { position: 'fixed', borderRadius: '50%', pointerEvents: 'none', zIndex: '5', boxSizing: 'border-box' });
    Object.assign(knob.style, { position: 'absolute', left: '0', top: '0', borderRadius: '50%' });
    ring.append(knob);
    document.body.append(ring);
    const button = (label: string) => {
      const el = document.createElement('div');
      el.textContent = label;
      Object.assign(el.style, {
        position: 'fixed', borderRadius: '50%', pointerEvents: 'none', zIndex: '5', boxSizing: 'border-box',
        alignItems: 'center', justifyContent: 'center', color: '#e6eaff', fontFamily: 'Silkscreen, monospace',
      });
      document.body.append(el);
      return el;
    };
    return { ring, knob, fire: button('FIRE'), pulse: button('PULSE') };
  }
}

export const touchControls = new TouchControls();

export const WIDTH = 416;
export const HEIGHT = 228;
/** Top bar height. */
export const HUD_H = 32;
/** The hull's walking line: colonists stand on it. */
export const GROUND_Y = 212;

/**
 * The canvas renders at this multiple of the design size. The game scene zooms its camera by it, and the HUD scene
 * zooms by half as much, so native 16 px sprites show at half size there without being shrunk.
 */
export const RENDER_SCALE = 4;
export const HUD_SCALE = RENDER_SCALE / 2;

/** Once round the ring, in design pixels. Every world x lives in [0, WORLD_W). */
export const WORLD_W = WIDTH * 8;

export const FONT = 'Silkscreen, monospace';

export const COLORS = {
  void: 0x060813,
  panel: 0x0e1228,
  line: 0x232a52,
  ink: 0xe6eaff,
  amber: 0xffc04d,
  beam: 0x6ff7ff,
  danger: 0xff4d6d,
  flame: 0xff7a3d,
};

export const TEXT = {
  ink: '#e6eaff',
  dim: '#8d95c2',
  amber: '#ffc04d',
  beam: '#6ff7ff',
  danger: '#ff4d6d',
  off: '#4a5288',
};

/** Sprite slots exported by tools/sprites.py to assets/sprites/<slot>.png. */
export const SPRITES = ['player', 'colonist', 'snatcher', 'husk', 'hound', 'minelayer', 'mine', 'pulse'] as const;
export type SpriteKey = (typeof SPRITES)[number];
/** Picks whose art faces left; they're flipped so they face right at rest. */
export const MIRROR: ReadonlySet<SpriteKey> = new Set(['player']);

/**
 * The patrol craft. Speeds in design pixels per second. Push left or right to accelerate and face that way;
 * a push weaker than `turnThreshold` nudges without turning. `lead` is how far ahead of the craft the view centres.
 */
export const CRAFT = {
  accel: 460,
  drag: 2.4,
  maxSpeed: 175,
  climb: 115,
  turnThreshold: 0.5,
  lead: 120,
  leadEase: 2.2,
  minY: HUD_H + 10,
  maxY: GROUND_Y - 10,
  startX: 300,
  startY: 120,
  ships: 3,
  pulses: 3,
};

/** How fast each backdrop layer scrolls relative to the craft (1 = with the hull). */
export const PARALLAX = { stars: 0.12, planet: 0.03, skyline: 0.45 };

/** Registry key the game writes its HUD state to each frame; the HUD scene reads it. */
export const HUD_STATE = 'hudState';

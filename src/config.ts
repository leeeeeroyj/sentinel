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

/**
 * Death and respawn: the craft is gone for `respawnDelay` s, then blinks and can't be hit for `invuln` s.
 * After game over, RETRY and TITLE ignore input for `retryDelay` s so a held button doesn't skip the screen.
 */
export const LIFE = { respawnDelay: 1.2, invuln: 2, retryDelay: 0.8 };

/** The laser: one streak per `cooldown` s while fire is held. It grows at `speed` px/s to `range`, fading over `life` s. */
export const LASER = { cooldown: 0.17, speed: 1150, range: 300, life: 0.3, halfHeight: 7 };

/**
 * Colonists stand with their feet on GROUND_Y. A fall from more than `safeFall` px above the hull (5 tiles) kills;
 * a shorter one scores `points.land` / 2.
 */
export const COLONIST = {
  count: 10,
  walk: 5,
  roam: 24,
  gravity: 38,
  maxFall: 46,
  safeFall: 80,
  /** Catch window round the spot just under the craft. */
  catchX: 10,
  catchY: 9,
  /** Carried colonists hang this far below the craft. */
  hang: 9,
};

/** Hostiles. Speeds in px/s. Every one warps in over `warp` s, harmless and unshootable until it's solid. */
export const HOSTILE = {
  warp: 0.5,
  group: 5,
  /** Craft-to-hostile collision box (half sizes), a little smaller than the sprites. */
  hitX: 10,
  hitY: 9,
  snatcher: { seek: 30, descend: 34, lift: 13, bob: 10, grab: 10, fuseY: HUD_H + 12 },
  husk: { speed: 62, jitter: 0.35, jitterX: 60, jitterY: 50 },
  minelayer: { speed: 22, sway: 28, swayRate: 0.9, dropEvery: 1.5 },
  /** Hounds steer by acceleration, so they overshoot when you turn. */
  hound: { accelX: 260, accelY: 200, maxSpeed: 125 },
};

/**
 * Enemy fire. A shooter flashes white for `warn` s, then fires one aimed shot, but only while it's on screen.
 * Cooldowns are the base gap between shots plus up to `spread` s at random. Minelayers never fire.
 */
export const FIRE = {
  warn: 0.35,
  speed: 72,
  life: 3,
  spread: 1.2,
  firstDelay: 1.5,
  cooldown: { snatcher: 2.6, husk: 1.7, hound: 1.2 },
  hitX: 5,
  hitY: 4,
};

/** Mines hang still for `life` s, fade in harmless for `arm` s, blink for the last second, and can't be shot. */
export const MINE = { life: 6, arm: 0.4, hitX: 7, hitY: 6 };

/**
 * Stall in a wave for `first` s (minus `perWave` each wave, never under `min`) and the HOUND lamp blinks for `warn` s.
 * Then a Hound warps in beside you, and another every `every` s until the wave ends.
 */
export const HOUNDS = { first: 60, perWave: 5, min: 30, warn: 3, every: 10, ahead: 150 };

export const POINTS = { snatcher: 150, husk: 150, minelayer: 250, hound: 200, catch: 500, land: 500, safeFall: 250 };

/**
 * Waves. Snatchers come in groups of `group`: `first` in wave 1 and `more` each wave after. The next group warps in
 * every `groupEvery` s, or as soon as no Snatcher is left. Hostiles move `pace` faster and shoot `firePace` more often
 * each wave, up to the caps. Each colonist alive at the end scores `bonusPer` × wave, capped at `bonusCap`.
 * Every `restoreEvery`th wave brings back all ten colonists and the ring's lights.
 */
export const WAVES = {
  first: 15,
  more: 3,
  group: 5,
  groupEvery: 15,
  /** Minelayers per wave, by wave number; the last entry repeats. */
  minelayers: [1, 1, 2, 2, 3, 3, 4],
  pace: 0.05,
  paceCap: 1.5,
  firePace: 0.06,
  firePaceCap: 1.6,
  bonusPer: 100,
  bonusCap: 500,
  restoreEvery: 5,
  /** Seconds the wave-cleared banner shows before the next wave starts. */
  intermission: 3.5,
  /** Seconds the WAVE n banner shows as a wave starts. */
  banner: 1.6,
};

/** An extra ship and an extra pulse every this many points. */
export const EXTRA_EVERY = 10_000;

/**
 * Bloom (a full-screen blur every frame) is the costly effect: off by default, and always off in headless tests.
 * Sparks, rings and shake are cheap and always on.
 */
export const FX = {
  bloom: { enabled: false, threshold: 0.45, spread: 1.4, offset: 3, steps: 2, amount: 0.75 },
};

/** Spark colours for each thing that can blow up, and its dot colour on the scanner (the first entry). */
export const KIND_COLORS = {
  snatcher: [0x7dffb0, 0x6ff7ff],
  husk: [0xff5fd2, 0xff4d6d],
  minelayer: [0xffc04d, 0xff7a3d],
  hound: [0xff4d6d, 0xffd166],
  player: [0xffffff, 0x6ff7ff, 0xffc04d],
  colonist: [0xff4d6d, 0xffffff],
  mine: [0xffc04d, 0xffffff],
} as const;

import Phaser from 'phaser';
import { GROUND_Y, HEIGHT, HUD_H, PARALLAX, WIDTH, WORLD_W } from './config';
import { rng, wrap } from './world';

type Ctx = CanvasRenderingContext2D;

/** Lit while any colonist lives; dark once the last one is lost. */
interface Palette {
  sky: string[];
  starAlpha: number;
  planet: string[];
  planetRing: string;
  tower: string; towerEdge: string; windows: string[]; windowRate: number;
  dome: string; domeLow: string; domeRim: string;
  hullTower: string; hullTowerEdge: string; hullWindow: string; beacon: string; mast: string;
  plate: string; seam: string; rivet: string; strip: string; stripDim: string;
}

const PALETTES: Record<'lit' | 'dark', Palette> = {
  lit: {
    sky: ['#05060f', '#070918', '#0a0d22', '#0e122d'], starAlpha: 1,
    planet: ['#1d2f6b', '#26408a', '#3157a8', '#22397c'], planetRing: 'rgba(111,247,255,0.45)',
    tower: '#0e1331', towerEdge: '#151b44', windows: ['#27346f', '#a98431'], windowRate: 0.2,
    dome: '#183764', domeLow: '#244c86', domeRim: '#4b86c9',
    hullTower: '#1b2250', hullTowerEdge: '#2b3672', hullWindow: '#ffcf6e', beacon: '#ff5f73', mast: '#2b3672',
    plate: '#141a3c', seam: '#0e122b', rivet: '#232c60', strip: '#6ff7ff', stripDim: '#2a8fa6',
  },
  dark: {
    sky: ['#0c0710', '#120a16', '#190d1b', '#22101f'], starAlpha: 0.5,
    planet: ['#2a1020', '#3a1424', '#4a1a2a', '#2a1020'], planetRing: 'rgba(255,77,109,0.35)',
    tower: '#0a0b17', towerEdge: '#0e0f1f', windows: ['#4a1420', '#4a1420'], windowRate: 0.03,
    dome: '#0f101d', domeLow: '#0f101d', domeRim: '#191a2c',
    hullTower: '#11131f', hullTowerEdge: '#171a2d', hullWindow: '#3a1018', beacon: '#2a0f16', mast: '#151830',
    plate: '#0c0e1b', seam: '#090a14', rivet: '#13162a', strip: '#3a1520', stripDim: '#3a1520',
  },
};

/** Star and skyline textures repeat at this width. */
const PERIOD = 832;
const SKYLINE_H = 84;
/** The hull texture starts this far above the walking line, to fit domes and towers. */
const HULL_RISE = 40;
const HULL_H = HEIGHT - GROUND_Y + HULL_RISE;
const PLANET = { w: 260, h: 104, r: 46, period: 1100 };

/**
 * Sky, stars, the planet the ring circles, a far skyline and the ring's hull. Everything is baked once into canvas
 * textures. Stars and skyline scroll with `travel` (unwrapped distance flown); the hull texture is exactly one lap
 * wide, so it scrolls by world position and repeats seamlessly where the ring joins.
 */
export class Backdrop {
  private readonly stars: Phaser.GameObjects.TileSprite;
  private readonly skyline: Phaser.GameObjects.TileSprite;
  private readonly hull: Phaser.GameObjects.TileSprite;
  private readonly planet: Phaser.GameObjects.Image;
  private readonly twinkle: Phaser.GameObjects.Graphics;
  private dark = false;

  constructor(private readonly scene: Phaser.Scene, depth = 0) {
    for (const key of ['bd-sky', 'bd-stars', 'bd-skyline', 'bd-hull', 'bd-planet']) if (scene.textures.exists(key)) scene.textures.remove(key);
    scene.textures.createCanvas('bd-sky', WIDTH, GROUND_Y - HUD_H);
    scene.textures.createCanvas('bd-stars', PERIOD, GROUND_Y - HUD_H);
    scene.textures.createCanvas('bd-skyline', PERIOD, SKYLINE_H);
    scene.textures.createCanvas('bd-hull', WORLD_W, HULL_H);
    scene.textures.createCanvas('bd-planet', PLANET.w, PLANET.h);

    // 8 px of overscan each side, so a camera shake never shows an edge.
    scene.add.image(-8, HUD_H, 'bd-sky').setOrigin(0).setDisplaySize(WIDTH + 16, GROUND_Y - HUD_H).setDepth(depth);
    this.stars = scene.add.tileSprite(-8, HUD_H, WIDTH + 16, GROUND_Y - HUD_H, 'bd-stars').setOrigin(0).setDepth(depth + 0.1);
    this.twinkle = scene.add.graphics().setDepth(depth + 0.15);
    this.planet = scene.add.image(0, 128, 'bd-planet').setDepth(depth + 0.2);
    this.skyline = scene.add.tileSprite(-8, GROUND_Y - SKYLINE_H, WIDTH + 16, SKYLINE_H, 'bd-skyline').setOrigin(0).setDepth(depth + 0.3);
    this.hull = scene.add.tileSprite(-8, GROUND_Y - HULL_RISE, WIDTH + 16, HULL_H, 'bd-hull').setOrigin(0).setDepth(depth + 0.4);
    this.redraw();
  }

  get isDark() {
    return this.dark;
  }

  setDark(dark: boolean) {
    if (dark === this.dark) return;
    this.dark = dark;
    this.redraw();
  }

  /** `camX` is the world x at the centre of the view; `travel` is unwrapped distance; `clock` is seconds. */
  update(camX: number, travel: number, clock: number) {
    this.stars.tilePositionX = travel * PARALLAX.stars;
    this.skyline.tilePositionX = travel * PARALLAX.skyline;
    this.hull.tilePositionX = wrap(camX - WIDTH / 2 - 8);
    const px = (((330 - travel * PARALLAX.planet) % PLANET.period) + PLANET.period) % PLANET.period - 200;
    this.planet.setPosition(Math.round(px), 128).setVisible(px > -PLANET.w / 2 && px < WIDTH + PLANET.w / 2);

    const g = this.twinkle.clear();
    for (let i = 0; i < 10; i++) {
      if (Math.sin(clock * (1.5 + i * 0.3) + i) <= 0.6) continue;
      const x = ((((i * 97 - travel * PARALLAX.stars) % WIDTH) + WIDTH) % WIDTH) | 0;
      g.fillStyle(0xffffff, this.dark ? 0.5 : 1).fillRect(x, HUD_H + 8 + ((i * 53) % 120), 1, 1);
    }
  }

  private redraw() {
    const p = PALETTES[this.dark ? 'dark' : 'lit'];
    this.paint('bd-sky', (ctx, w, h) => {
      const band = Math.ceil(h / p.sky.length);
      p.sky.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, i * band, w, band); });
    });
    this.paint('bd-stars', (ctx, w, h) => {
      const r = rng(3);
      ctx.globalAlpha = p.starAlpha;
      for (let i = 0; i < 150; i++) {
        const b = r();
        ctx.fillStyle = b > 0.92 ? '#ffffff' : b > 0.6 ? '#9fb0ff' : '#3d4780';
        ctx.fillRect(Math.floor(r() * w), Math.floor(r() * (h - 40)), 1, 1);
      }
      ctx.globalAlpha = 1;
    });
    this.paint('bd-planet', (ctx, w, h) => drawPlanet(ctx, w, h, p));
    this.paint('bd-skyline', (ctx, w, h) => drawSkyline(ctx, w, h, p));
    this.paint('bd-hull', (ctx, w, h) => drawHull(ctx, w, h, p, this.dark));
  }

  private paint(key: string, draw: (ctx: Ctx, w: number, h: number) => void) {
    const tex = this.scene.textures.get(key) as Phaser.Textures.CanvasTexture;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, tex.width, tex.height);
    draw(ctx, tex.width, tex.height);
    tex.refresh();
  }
}

function drawPlanet(ctx: Ctx, w: number, h: number, p: Palette) {
  const cx = w / 2, cy = h / 2, r = PLANET.r;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  for (let i = 0; i < 12; i++) { ctx.fillStyle = p.planet[i % 4]; ctx.fillRect(cx - r, cy - r + i * 8, r * 2, 8); }
  ctx.fillStyle = 'rgba(4,5,12,0.55)'; ctx.beginPath(); ctx.arc(cx + 18, cy + 10, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = p.planetRing; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(cx, cy + 4, w / 2 - 2, 9, -0.08, 0, Math.PI * 2); ctx.stroke();
}

/** Far habitat blocks with a scatter of lit windows. Wraps at the texture width. */
function drawSkyline(ctx: Ctx, w: number, h: number, p: Palette) {
  const r = rng(11);
  let x = 0;
  while (x < w) {
    const bw = 10 + Math.floor(r() * 26), bh = 16 + Math.floor(r() * 58), ww = Math.min(bw, w - x);
    ctx.fillStyle = p.tower; ctx.fillRect(x, h - bh, ww, bh);
    ctx.fillStyle = p.towerEdge; ctx.fillRect(x, h - bh, ww, 1);
    for (let wy = h - bh + 3; wy < h - 2; wy += 4) for (let wx = x + 2; wx < x + ww - 2; wx += 3) {
      const roll = r();
      if (roll < p.windowRate) { ctx.fillStyle = roll < p.windowRate * 0.8 ? p.windows[0] : p.windows[1]; ctx.fillRect(wx, wy, 1, 1); }
    }
    if (r() < 0.3) { ctx.fillStyle = p.tower; ctx.fillRect(x + Math.floor(ww / 2), h - bh - 6, 1, 6); }
    x += bw + Math.floor(r() * 6);
  }
}

function drawDome(ctx: Ctx, x: number, base: number, w: number, h: number, p: Palette, dark: boolean, r: () => number) {
  const cx = x + w / 2;
  for (let yy = 0; yy < h; yy++) {
    const t = yy / h, half = Math.max(1, Math.round((w / 2) * Math.sqrt(1 - t * t)));
    ctx.fillStyle = yy > h * 0.6 ? p.dome : p.domeLow;
    ctx.fillRect(Math.round(cx - half), base - 1 - yy, half * 2, 1);
    ctx.fillStyle = p.domeRim;
    ctx.fillRect(Math.round(cx - half), base - 1 - yy, 1, 1);
    ctx.fillRect(Math.round(cx + half) - 1, base - 1 - yy, 1, 1);
  }
  if (!dark) {
    ctx.fillStyle = '#cfe8ff';
    ctx.fillRect(Math.round(cx - w / 4), base - h + 3, 2, 1);
    ctx.fillRect(Math.round(cx - w / 4) - 1, base - h + 4, 1, 1);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = r() < 0.7 ? '#ffcf6e' : '#ff9a4d';
      ctx.fillRect(Math.round(x + 3 + r() * (w - 6)), base - 3 - Math.floor(r() * 4), 1, 1);
    }
  } else {
    // A crack running down the glass.
    ctx.fillStyle = '#26283f';
    let px = Math.round(cx - w / 5);
    for (let i = 0; i < h - 3; i++) { ctx.fillRect(px, base - h + 2 + i, 1, 1); px += r() < 0.5 ? 1 : -1; }
  }
}

/**
 * One full lap of hull: domes, towers and masts on a plated band with a lit strip along the walking line.
 * The layout is seeded and kept clear of the texture's ends, so the seam where the ring joins can't be seen.
 */
function drawHull(ctx: Ctx, w: number, h: number, p: Palette, dark: boolean) {
  const r = rng(5), base = HULL_RISE;
  let x = 20;
  while (x < w - 90) {
    const kind = r();
    if (kind < 0.45) {
      const dw = 22 + Math.floor(r() * 22), dh = 12 + Math.floor(r() * 14);
      drawDome(ctx, x, base, dw, dh, p, dark, r);
      x += dw;
    } else if (kind < 0.75) {
      const tw = 6 + Math.floor(r() * 6), th = 18 + Math.floor(r() * 18);
      ctx.fillStyle = p.hullTower; ctx.fillRect(x, base - th, tw, th);
      ctx.fillStyle = p.hullTowerEdge; ctx.fillRect(x, base - th, 1, th);
      for (let wy = base - th + 3; wy < base - 2; wy += 4) {
        if (r() < 0.6 && (!dark || r() < 0.15)) { ctx.fillStyle = p.hullWindow; ctx.fillRect(x + 2, wy, Math.max(1, tw - 4), 1); }
      }
      ctx.fillStyle = p.beacon; ctx.fillRect(x + Math.floor(tw / 2), base - th - 2, 1, 2);
      x += tw;
    } else {
      const mh = 14 + Math.floor(r() * 16);
      ctx.fillStyle = p.mast; ctx.fillRect(x, base - mh, 1, mh); ctx.fillRect(x - 2, base - mh + 3, 5, 1);
      x += 3;
    }
    x += 24 + Math.floor(r() * 70);
  }
  ctx.fillStyle = p.plate; ctx.fillRect(0, base, w, h - base);
  ctx.fillStyle = p.seam; for (let px = 0; px < w; px += 32) ctx.fillRect(px, base + 1, 1, h - base);
  ctx.fillStyle = p.rivet; for (let px = 6; px < w; px += 16) { ctx.fillRect(px, base + 5, 1, 1); ctx.fillRect(px + 8, base + 11, 1, 1); }
  for (let px = 0; px < w; px++) {
    // Dead stretches of strip; the pattern repeats every 26 px, which divides the lap, so the seam stays hidden.
    if (dark && (px * 7) % 26 < 10) continue;
    ctx.fillStyle = dark ? p.strip : px % 8 < 6 ? p.strip : p.stripDim;
    ctx.fillRect(px, base, 1, 1);
  }
}

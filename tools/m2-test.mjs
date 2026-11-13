// Milestone 2 check for Sentinel: drives the dev build in headless Chrome over CDP. Scenarios are set up through the
// dev-only handle; the craft flies and fires with real key events, and the game's own rules decide the outcome.
// Usage: node m2-test.mjs <project-dir> <out-dir>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [project, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const PORT = 5198, DBG = 9338, W = 1664, H = 912;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] });
const chrome = spawn('google-chrome', [
  '--headless=new', '--no-sandbox', '--hide-scrollbars', '--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${DBG}`, `--user-data-dir=${out}/profile`, `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });
const cleanup = () => { try { vite.kill(); } catch {} try { chrome.kill(); } catch {} };
process.on('exit', cleanup);

async function until(fn, ms = 15000, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(step); }
  throw new Error('timeout');
}

await until(async () => (await fetch(`http://localhost:${PORT}/`)).ok);
const target = await until(async () => (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).find((t) => t.type === 'page'));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
const KEYS = { ArrowRight: [39, 'ArrowRight'], ArrowLeft: [37, 'ArrowLeft'], ArrowUp: [38, 'ArrowUp'], ArrowDown: [40, 'ArrowDown'], Enter: [13, 'Enter'], Escape: [27, 'Escape'], ' ': [32, 'Space'] };
const key = (type, k) => send('Input.dispatchKeyEvent', { type, key: k, code: KEYS[k][1], windowsVirtualKeyCode: KEYS[k][0], nativeVirtualKeyCode: KEYS[k][0] });
const down = (k) => key('rawKeyDown', k), up = (k) => key('keyUp', k);
const tap = async (k, ms = 80) => { await down(k); await sleep(ms); await up(k); };

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${PORT}/` });
await until(() => evaluate(`!!(window.__sentinel && window.__sentinel.scene.isActive('title'))`));
await sleep(600);
await tap('Enter');
await until(() => evaluate(`__sentinel.scene.isActive('ring') && __sentinel.scene.isActive('hud')`));
await sleep(600);

const R = `__sentinel.scene.getScene('ring')`;
// Plain-data snapshot (the entities hold Phaser images, which can't cross CDP).
const state = () => evaluate(`(() => { const s = ${R}; const { carry, ...craft } = s.craft; return {
  craft: { ...craft, carrying: !!carry }, score: s.score, ships: s.ships, over: s.over,
  colonists: s.colonists.map((c) => ({ x: c.x, y: c.y, state: c.state })),
  hostiles: s.hostiles.map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, state: e.state, warp: e.warp, carrying: !!e.carry })),
  alive: s.colonists.filter((c) => c.state !== 'dead').length }; })()`);
const run = (body) => evaluate(`(() => { const s = ${R}; ${body} })()`);
const clearHostiles = () => run(`s.spawning = false; [...s.hostiles].forEach((e) => s.remove(e));`);
// A Snatcher already lifting colonist i, with the colonist at height y.
const lifting = (i, y) => run(`const c = s.colonists[${i}]; c.y = ${y}; c.state = 'taken';
  const e = s.spawn('snatcher', c.x, ${y} - 10, 0); e.state = 'lift'; e.target = c; e.carry = c; return e.x;`);
const park = (x, y, facing) => run(`Object.assign(s.craft, { x: ((${x}) % 3328 + 3328) % 3328, y: ${y}, vx: 0, facing: ${facing}, lead: ${facing} * 120, invuln: 0, down: 0 });`);

await clearHostiles();
let s = await state();
check('10 colonists on the hull at the start', s.alive === 10 && s.colonists.every((c) => c.state === 'walk'), `alive ${s.alive}`);

// 1. A Snatcher left alone: seeks, descends, lifts, and fuses into a Husk at the top. The colonist is lost.
await park(s.colonists[5].x + 1600, 120, 1);
const c5 = s.colonists[5];
await run(`s.spawn('snatcher', ${c5.x} + 40, 110);`);
await sleep(200);
s = await state();
check('new Snatcher warps in first (harmless)', s.hostiles[0].warp > 0, `warp ${s.hostiles[0].warp.toFixed(2)}`);
const t0 = Date.now();
await until(async () => (await state()).hostiles[0]?.state === 'descend', 10000).catch(() => {});
check('Snatcher seeks a colonist and descends', (await state()).hostiles[0]?.state === 'descend');
await until(async () => (await state()).hostiles[0]?.state === 'lift', 10000).catch(() => {});
s = await state();
const taken = s.colonists.findIndex((c) => c.state === 'taken');
check('Snatcher grabs the colonist and lifts', s.hostiles[0]?.state === 'lift' && taken >= 0, `colonist ${taken}`);
await run(`const e = s.hostiles[0]; Object.assign(s.craft, { x: e.x - 60, y: 120, facing: 1, lead: 120, vx: 0 });`);
await sleep(500);
await shot('1-snatcher-lifting');
await run(`Object.assign(s.craft, { x: (s.hostiles[0].x + 1600) % 3328 });`);
await until(async () => (await state()).hostiles[0]?.kind === 'husk', 25000).catch(() => {});
s = await state();
check('reaching the top fuses it into a Husk', s.hostiles[0]?.kind === 'husk', `after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
check('colonist lost: count drops to 9', s.alive === 9 && s.colonists[taken].state === 'dead', `alive ${s.alive}`);
check('score unchanged by a fuse', s.score === 0, `score ${s.score}`);
await clearHostiles();

// 2. Shoot a lifting Snatcher: the colonist falls; catch it (+500), then fly it down (+500).
s = await state();
const i2 = s.colonists.findIndex((c) => c.state === 'walk');
const x2 = await lifting(i2, 120);
await park(x2 - 100, 111, 1);
await sleep(150);
await tap(' ', 120);
await until(async () => (await state()).hostiles.length === 0, 3000).catch(() => {});
s = await state();
check('laser (Space) destroys the lifting Snatcher: +150', s.hostiles.length === 0 && s.score === 150, `score ${s.score}`);
check('its colonist falls', s.colonists[i2].state === 'falling');
await sleep(250);
await shot('2-colonist-falling');
s = await state();
await park(s.colonists[i2].x, s.colonists[i2].y + 30, 1);
await until(async () => (await state()).craft.carrying, 4000).catch(() => {});
s = await state();
check('catching it mid-air: +500', s.craft.carrying && s.colonists[i2].state === 'carried' && s.score === 650, `score ${s.score}`);
await sleep(300);
await shot('3-colonist-caught');
await down('ArrowDown');
await until(async () => !(await state()).craft.carrying, 6000).catch(() => {});
await up('ArrowDown');
s = await state();
check('flying it down to the hull sets it down: +500', s.colonists[i2].state === 'walk' && s.score === 1150, `score ${s.score}, state ${s.colonists[i2].state}`);
await sleep(200);
await shot('4-colonist-landed');

// 3. A short drop (under 80 px) survives on its own: +250.
s = await state();
const i3 = s.colonists.findIndex((c, i) => c.state === 'walk' && i !== i2);
const x3 = await lifting(i3, 170);
await park(x3 - 150, 161, 1);
await sleep(150);
const before3 = (await state()).score;
await tap(' ', 120);
await until(async () => (await state()).colonists[i3].state === 'walk', 6000).catch(() => {});
s = await state();
check('short drop survives: +150 kill, +250 landing', s.colonists[i3].state === 'walk' && s.score - before3 === 400, `+${s.score - before3}`);

// 4. A high drop loses the colonist.
const i4 = s.colonists.findIndex((c, i) => c.state === 'walk' && i !== i2 && i !== i3);
const x4 = await lifting(i4, 100);
await park(x4 - 150, 91, 1);
await sleep(150);
const before4 = (await state()).score, alive4 = (await state()).alive;
await tap(' ', 120);
await until(async () => (await state()).colonists[i4].state === 'dead', 8000).catch(() => {});
s = await state();
check('high drop (108 px) loses the colonist, no landing points', s.colonists[i4].state === 'dead' && s.score - before4 === 150 && s.alive === alive4 - 1, `+${s.score - before4}, alive ${s.alive}`);

// 5. Laser misses what isn't in line, and the beam stops at the first hit.
await park(1000, 120, 1);
await run(`s.spawn('husk', 1080, 150, 0).id = 'below'; s.spawn('husk', 1060, 120, 0).id = 'near'; s.spawn('husk', 1120, 120, 0).id = 'far';`);
await run(`s.hostiles.forEach((e) => { e.jit = 99; e.jx = 0; e.jy = 0; });`);
await tap(' ', 120);
await sleep(200);
s = await state();
check('one shot kills only the nearest Husk in line', s.hostiles.map((e) => e.id).sort().join() === 'below,far', s.hostiles.map((e) => e.id).join());
await down(' ');
await sleep(90);
await shot('5-laser');
await up(' ');
await clearHostiles();

// 6. Ramming a Husk costs a ship; the craft returns blinking and can't be hit for 2 s.
await park(1500, 120, 1);
const ships0 = (await state()).ships;
await run(`s.spawn('husk', 1500, 120, 0);`);
await sleep(150);
s = await state();
check('ramming a Husk destroys both and costs a ship', s.ships === ships0 - 1 && s.hostiles.length === 0 && s.craft.down > 0, `ships ${s.ships}`);
await until(async () => (await state()).craft.invuln > 0, 3000).catch(() => {});
s = await state();
check('craft respawns with invulnerability', s.craft.down === 0 && s.craft.invuln > 1.5, `invuln ${s.craft.invuln.toFixed(2)}`);
await run(`s.spawn('husk', s.craft.x, s.craft.y, 0).jit = 99;`);
await sleep(400);
s = await state();
check('invulnerable craft is not hit', s.ships === ships0 - 1 && s.hostiles.length === 1, `ships ${s.ships}`);
await shot('6-respawn-blink');
await clearHostiles();
await until(async () => (await state()).craft.invuln === 0, 3000).catch(() => {});

// 7. A warping-in hostile can't hurt.
await run(`s.spawn('husk', s.craft.x, s.craft.y);`);
await sleep(250);
s = await state();
check('a hostile still warping in is harmless', s.ships === ships0 - 1, `ships ${s.ships}, warp ${s.hostiles[0]?.warp.toFixed(2)}`);
await clearHostiles();

// 8. Losing the last ship ends the run and returns to the title.
await run(`s.ships = 1; s.spawn('husk', s.craft.x, s.craft.y, 0);`);
await sleep(300);
s = await state();
check('last ship lost: game over', s.ships === 0 && s.over > 0);
await shot('7-game-over');
await until(() => evaluate(`__sentinel.scene.isActive('title')`), 6000).then(() => check('game over returns to the title', true), () => check('game over returns to the title', false));

// 9. Natural play: groups of five keep arriving while no Snatcher is left.
await tap('Enter');
await until(() => evaluate(`__sentinel.scene.isActive('ring')`));
await sleep(400);
s = await state();
check('a fresh run starts with a group of five Snatchers', s.hostiles.length === 5 && s.hostiles.every((e) => e.kind === 'snatcher'), `${s.hostiles.length}`);

const fps = await evaluate(`Math.round(__sentinel.loop.actualFps)`);
console.log(`fps (headless, SwiftShader): ${fps}`);
check('no page errors', errors.length === 0, errors.join(' | '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
ws.close(); cleanup();
process.exit(failed ? 1 : 0);

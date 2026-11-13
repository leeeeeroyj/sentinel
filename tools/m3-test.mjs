// Milestone 3 check for Sentinel: drives the dev build in headless Chrome over CDP. Scenarios are set up through the
// dev-only handle; the craft flies and fires with real key events, and the game's own rules decide the outcome.
// Usage: node m3-test.mjs <project-dir> <out-dir>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [project, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const PORT = 5197, DBG = 9337, W = 1664, H = 912;
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
const KEYS = { ArrowRight: [39, 'ArrowRight'], ArrowLeft: [37, 'ArrowLeft'], ArrowUp: [38, 'ArrowUp'], ArrowDown: [40, 'ArrowDown'], Enter: [13, 'Enter'], Escape: [27, 'Escape'], ' ': [32, 'Space'], Shift: [16, 'ShiftLeft'] };
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
const run = (body) => evaluate(`(() => { const s = ${R}; ${body} })()`);
const state = () => run(`const { carry, ...craft } = s.craft; return {
  craft: { ...craft, carrying: !!carry }, score: s.score, ships: s.ships, pulses: s.pulses, stall: s.stall,
  hostiles: s.hostiles.map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, warp: e.warp, cool: e.cool, flash: e.img.tintMode === 1 })),
  mines: s.mines.map((m) => ({ id: m.id, x: m.x, y: m.y, arm: m.arm, life: m.life })), shots: s.shots.map((sh) => ({ id: sh.id, x: sh.x, y: sh.y })),
  beams: s.beams.map((b) => b.len), hud: __sentinel.registry.get('hudState') };`);
const X = 1000, Y = 120;
const park = (invuln = 0) => run(`Object.assign(s.craft, { x: ${X}, y: ${Y}, vx: 0, facing: 1, lead: 120, invuln: ${invuln}, down: 0 });`);
const calm = () => run(`s.calm();`);
// A hostile that holds still-ish and won't fire until told to.
const place = (kind, dx, y, extra = '') => run(`const e = s.spawn('${kind}', ${X} + ${dx}, ${y}, 0); e.cool = 1e9; e.jit = 1e9; e.jx = e.jy = 0; ${extra} return true;`);

await calm();
await park();
await run(`s.colonists.forEach((c) => { c.x = c.home = (${X} + 800) % 3328; });`); // far away, so Snatchers here stay hunting

// 1. One of each, on screen, for a look.
for (const [i, kind] of ['snatcher', 'husk', 'minelayer', 'hound'].entries()) {
  await park(99);
  await place(kind, 90, Y - 10, kind === 'minelayer' ? 'e.dropT = 0.05;' : '');
  await sleep(kind === 'minelayer' ? 700 : 150);
  const s = await state();
  check(`${kind} spawns and shows`, s.hostiles.length === 1 && s.hostiles[0].kind === kind && await run(`return s.hostiles[0].img.visible`));
  if (kind === 'minelayer') check('Minelayer lays mines as it goes', s.mines.length >= 1, `${s.mines.length} mine(s)`);
  await shot(`${i + 1}-${kind}`);
  await calm();
}

// 2. Enemy fire: a white flash first, then an aimed shot that costs a ship.
await park();
await place('snatcher', 120, 80, 'e.cool = 0.8; e.id = "gun";');
let flashedAt = 0, firedAt = 0, flashShot = false;
const t2 = Date.now();
while (Date.now() - t2 < 3000 && !firedAt) {
  const s = await state();
  if (!flashedAt && s.hostiles[0]?.flash) {
    flashedAt = Date.now();
    if (!flashShot) { flashShot = true; await shot('5-white-flash-before-firing'); }
  }
  if (s.shots.length) firedAt = Date.now();
  await sleep(30);
}
check('a hostile flashes white before it fires', flashedAt > 0 && firedAt >= flashedAt, `flash ${flashedAt - t2} ms, shot ${firedAt - t2} ms`);
const ships2 = (await state()).ships;
await run(`s.hostiles[0].cool = 1e9;`);
await until(async () => (await state()).ships < ships2, 4000).catch(() => {});
check('an aimed shot hits the craft and costs a ship', (await state()).ships === ships2 - 1);
await calm();
await until(async () => (await state()).craft.down === 0, 3000);
await run(`s.craft.invuln = 0;`);

await place('snatcher', 1600, 80, 'e.cool = 0.1;');
await sleep(1000);
check('hostiles off screen never fire', (await state()).shots.length === 0);
await calm();

// 3. Mines: the laser passes through them; armed ones destroy the craft, arming ones don't.
await park();
await run(`s.layMine(${X} + 60, ${Y} + 1);`);
await sleep(500);
await tap(' ', 120);
await sleep(150);
let s = await state();
check('the laser passes through a mine', s.mines.length === 1 && Math.max(0, ...s.beams) > 100, `beam ${Math.max(0, ...s.beams).toFixed(0)} px`);
const ships3 = s.ships;
await run(`s.layMine(s.craft.x, s.craft.y); s.mines[1].arm = 1e9;`);
await sleep(300);
check('a mine still fading in is harmless', (await state()).ships === ships3);
await run(`s.mines[1].life = 0;`);
await run(`Object.assign(s.craft, { x: s.mines[0].x, y: s.mines[0].y });`);
await sleep(200);
s = await state();
check('an armed mine destroys the craft', s.ships === ships3 - 1 && s.mines.length === 0, `ships ${s.ships}`);
await calm();
await until(async () => (await state()).craft.down === 0, 3000);
await run(`s.layMine(${X} + 300, 100); s.mines[0].life = 0.4;`);
await sleep(700);
check('mines fizzle out on their own', (await state()).mines.length === 0);

// 4. The pulse clears every hostile, shot and mine on screen, and nothing off screen.
await park(99);
await place('snatcher', 90, 60); await place('husk', 140, 150); await place('minelayer', -60, 80); await place('hound', 170, 90);
await run(`s.hostiles.forEach((e) => { e.id = 'on'; e.vx = e.vy = 0; });`);
await place('snatcher', 1200, 80, 'e.id = "off";');
await run(`s.layMine(${X} + 40, 70); s.layMine(${X} - 60, 190); s.layMine(${X} + 1300, 120);
  s.mines.forEach((m, i) => { m.id = i < 2 ? 'on' : 'off'; });
  s.shots.push({ id: 'on', x: ${X} + 60, y: 170, vx: 0, vy: 0, life: 99 }, { id: 'on', x: ${X} - 40, y: 60, vx: 0, vy: 0, life: 99 },
    { id: 'off', x: ${X} + 1500, y: 120, vx: 0, vy: 0, life: 99 });`);
await sleep(500);
await shot('6-before-pulse');
const before4 = await state();
await tap('Shift');
await sleep(150);
s = await state();
const left = (list) => list.map((o) => o.id).join() || 'none';
check('pulse clears every hostile on screen (and scores them)', left(s.hostiles) === 'off' && s.score - before4.score === 150 + 150 + 250 + 200, `left ${left(s.hostiles)}, +${s.score - before4.score}`);
check('pulse clears mines and shots on screen only', left(s.mines) === 'off' && left(s.shots) === 'off', `mines ${left(s.mines)}, shots ${left(s.shots)}`);
check('pulse uses one charge', s.pulses === before4.pulses - 1, `${before4.pulses} → ${s.pulses}`);
await sleep(200);
await shot('7-after-pulse');
await run(`s.pulses = 0;`);
await place('husk', 100, 60);
await tap('Shift');
await sleep(100);
check('no charges, no pulse', (await state()).hostiles.length === 2);
await calm();

// 5. Hounds: the lamp blinks 3 s before the first one, then stays lit while they're out.
const times = await run(`return [1, 3, 7, 9].map((w) => { s.wave = w; return s.houndTime(); });`);
await run(`s.wave = 1;`);
check('Hound timer: 60 s in wave 1, 5 s less each wave, never under 30', times.join() === '60,50,30,30', times.join());
await park();
await run(`s.stall = 55.5; s.nextHound = 60;`);
s = await state();
check('HOUND lamp off before the warning', s.hud.hound === 'off');
const t5 = Date.now();
await until(async () => (await state()).hud.hound === 'blink', 3000);
const blinkAt = Date.now();
await sleep(1200);
await shot('8-hound-lamp-blinking');
await until(async () => (await state()).hostiles.some((e) => e.kind === 'hound'), 5000);
const houndAt = Date.now();
s = await state();
check('HOUND lamp blinks 3 s before the first Hound', Math.abs((houndAt - blinkAt) / 1000 - 3) < 0.35, `${((houndAt - blinkAt) / 1000).toFixed(2)} s (blink after ${((blinkAt - t5) / 1000).toFixed(1)} s)`);
const hound = s.hostiles.find((e) => e.kind === 'hound');
check('the Hound warps in beside the craft', hound.warp > 0 && Math.abs(hound.x - (s.craft.x + 150)) < 30, `dx ${(hound.x - s.craft.x).toFixed(0)}`);
await sleep(300);
s = await state();
check('lamp stays lit while Hounds are out', s.hud.hound === 'on');
check('next Hound due 10 s later', Math.abs(await run(`return s.nextHound - s.stall;`) - 9.7) < 0.4);
await run(`s.craft.invuln = 99;`);
await sleep(600);
await shot('9-hound');

const fps = await evaluate(`Math.round(__sentinel.loop.actualFps)`);
console.log(`fps (headless, SwiftShader): ${fps}`);
check('no page errors', errors.length === 0, errors.join(' | '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
ws.close(); cleanup();
process.exit(failed ? 1 : 0);

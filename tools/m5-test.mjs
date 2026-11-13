// Milestone 5 check for Sentinel: drives the dev build in headless Chrome over CDP. Scenarios are set up through the
// dev-only handle; the craft flies and fires with real key events, and the game's own rules decide the outcome.
// Usage: node m5-test.mjs <project-dir> <out-dir>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [project, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const PORT = 5195, DBG = 9335, W = 1664, H = 912;
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
const X = 1000, Y = 120;
const park = (extra = '') => run(`Object.assign(s.craft, { x: ${X}, y: ${Y}, vx: 0, facing: 1, lead: 120, invuln: 0, down: 0 }); ${extra}`);
const still = (kind, dx, y, extra = '') => run(`const e = s.spawn('${kind}', ${X} + ${dx}, ${y}, 0); e.cool = 1e9; e.jit = 1e9; e.jx = e.jy = 0; ${extra} return true;`);
// Record every sound the game asks for.
await run(`window.__played = []; const m = s.sound, play = m.play.bind(m); m.play = (k, c) => { window.__played.push(String(k).replace('sfx-', '')); return play(k, c); };`);
const played = () => evaluate(`window.__played.splice(0)`);
const heard = async (name, ms = 1500) => { const end = Date.now() + ms; let all = []; while (Date.now() < end) { all = all.concat(await played()); if (all.includes(name)) return true; await sleep(50); } return false; };

// 1. Every voice is built at load.
const voices = ['laser', 'boom', 'boomBig', 'die', 'bolt', 'mine', 'snatch', 'fall', 'catch', 'land', 'lost', 'fuse', 'warp', 'pulse', 'houndWarn', 'dark', 'waveClear', 'extraShip', 'gameOver', 'start'];
const missing = await evaluate(`${JSON.stringify(voices)}.filter((v) => !__sentinel.cache.audio.exists('sfx-' + v))`);
check('every sound voice is built at load', missing.length === 0, missing.join());

// 2. Scanner and pips follow the game.
await sleep(800);
let hud = await evaluate(`__sentinel.registry.get('hudState')`);
let expectDots = await run(`return s.colonists.filter((c) => c.state !== 'dead').length + s.hostiles.filter((e) => e.warp <= 0).length;`);
check('scanner gets a dot per live colonist and solid hostile', hud.scan.dots.length / 3 === expectDots, `${hud.scan.dots.length / 3} dots, expected ${expectDots}`);
check('ten colonist pips, all alive', hud.colonists.length === 10 && hud.colonists.every((c) => c === 1));
await shot('1-hud-scanner');

// 3. Sounds on the game's events.
await run(`s.calm();`);
await park();
await down(' '); check('laser sounds on each streak', await heard('laser')); await up(' ');
await still('husk', 80, Y + 1);
await tap(' ', 100);
check('a kill booms', await heard('boom'));
await sleep(250); // let the last shot's cooldown run out
await still('minelayer', 80, Y + 1, 'e.t = 0; e.dropT = 1e9;');
await tap(' ', 100);
check('a Minelayer kill booms bigger', await heard('boomBig'));
await run(`s.calm();`);
await still('snatcher', 100, 70, 'e.cool = 0.4;');
check('enemy fire sounds', await heard('bolt'));
await run(`s.calm();`);
await still('minelayer', 100, 70, 'e.dropT = 0.05;');
check('a mine drop sounds on screen', await heard('mine'));
await run(`s.calm(); s.craft.invuln = 99;`);
// An abduction: alarm on the grab, whistle when it's shot loose, a catch, a landing.
await run(`const c = s.colonists[0]; c.x = c.home = ${X} + 60; c.y = 208; c.state = 'walk'; const e = s.spawn('snatcher', ${X} + 60, 190, 0); e.cool = 1e9; e.target = c; e.state = 'descend';`);
check('a grab sounds the snatch alarm', await heard('snatch', 2500));
await run(`const e = s.hostiles[0]; e.y = 100; e.carry.y = 110; Object.assign(s.craft, { x: e.x - 100, y: 100 });`);
await played();
await sleep(100);
await tap(' ', 100);
check('shooting a lifter sets the colonist whistling down', await heard('fall'));
await run(`const c = s.colonists[0]; Object.assign(s.craft, { x: c.x, y: c.y + 20 });`);
check('a catch chimes', await heard('catch', 3000));
await down('ArrowDown');
check('setting them down chimes', await heard('land', 4000));
await up('ArrowDown');
await run(`const c = s.colonists[1]; c.y = 90; c.state = 'falling'; c.vy = 46; c.fallFrom = 90;`);
check('a colonist lost to a fall sounds', await heard('lost', 4000));
await run(`s.spawn('snatcher', s.craft.x + 900, 60, 0).cool = 1e9; const c = s.colonists[2]; c.state = 'taken'; const e = s.hostiles[0]; e.carry = e.target = c; e.state = 'lift'; e.y = 46;`);
check('a fuse sounds', await heard('fuse', 2000));
await run(`s.calm(); s.craft.invuln = 0;`);
await park();
await still('husk', 120, 80); await still('hound', 160, 150); await still('snatcher', -40, 60);
await tap('Shift');
check('pulse sounds once for the lot (no separate booms)', await (async () => { await sleep(150); const p = await played(); return p.includes('pulse') && !p.includes('boom'); })());
await run(`s.wave = 1; s.stall = 56.2; s.nextHound = 60; s.craft.invuln = 99;`);
check('Hound warning beeps', await heard('houndWarn', 1500));
check('a Hound warps in with a sound', await heard('warp', 5000));
await run(`s.calm(); s.score = 9990; s.gain(20);`);
check('an extra ship plays its jingle', await heard('extraShip'));
await run(`s.calm(); s.spawning = true; s.toSpawn = 0;`);
check('a cleared wave plays its fanfare', await heard('waveClear'));
await run(`s.calm(); s.between = 0; s.colonists.forEach((c) => { c.state = 'dead'; });`);
check('the ring going dark sounds', await heard('dark'));
await run(`s.calm(); s.restore(); s.craft.invuln = 0;`);
await park();
await run(`s.ships = 1; s.spawn('husk', s.craft.x, s.craft.y, 0);`);
check('losing the craft explodes', await heard('die'));
check('game over plays its tune', await heard('gameOver', 2500));
await tap('Escape');
await until(() => evaluate(`__sentinel.scene.isActive('title')`));
await tap('Enter');
await until(() => evaluate(`__sentinel.scene.isActive('ring')`));
await sleep(500);

// 4. Effects stay pinned to the ring while the view moves.
await run(`s.calm();`);
await park();
await still('husk', 80, Y + 1);
await tap(' ', 100);
await sleep(60);
const anchor = await run(`return { fx: s.fx.sparks.x, travel: s.travel, alive: s.fx.sparks.getAliveParticleCount() };`);
await down('ArrowRight'); await sleep(400); await up('ArrowRight');
const later = await run(`return { fx: s.fx.sparks.x, travel: s.travel };`);
check('sparks scroll with the world', anchor.alive > 0 && Math.abs(anchor.fx + anchor.travel) < 0.01 && Math.abs(later.fx + later.travel) < 0.01 && later.travel - anchor.travel > 20, JSON.stringify({ anchor, later }));

// 5. Mid-burst readability: kills and a pulse next to live hazards.
await run(`s.calm();`);
await park();
await still('husk', 70, Y + 1); await still('snatcher', 150, 80, 'e.id = "keep";'); await run(`s.layMine(${X} + 110, 150); s.mines[0].arm = 0; s.shots.push({ x: ${X} + 90, y: 100, vx: 0, vy: 0, life: 99 });`);
await tap(' ', 100);
await sleep(90);
await shot('2-mid-burst-kill');
await run(`s.calm(); s.pulses = 3;`);
await park();
await still('husk', 60, 90); await still('hound', 140, 150); await still('minelayer', 180, 60); await still('snatcher', -50, 170);
await run(`s.layMine(${X} + 40, 160); s.layMine(${X} + 120, 70); s.mines.forEach((m) => { m.arm = 0; });`);
await tap('Shift');
await sleep(110);
await shot('3-mid-pulse');
await run(`s.calm(); s.craft.invuln = 0;`);
await park();
await still('husk', 0, Y);
await sleep(120);
await shot('4-mid-death');
await sleep(1500);

// 6. Edge arrow for an abduction off screen.
await run(`s.calm(); s.craft.invuln = 99; const c = s.colonists[3]; c.state = 'taken'; c.x = ${X} + 600; c.y = 120; const e = s.spawn('snatcher', c.x, 110, 0); e.carry = e.target = c; e.state = 'lift'; e.cool = 1e9;`);
await park(`s.craft.invuln = 99;`);
let arrowSeen = false;
for (let i = 0; i < 6 && !arrowSeen; i++) {
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: W - 40, y: 0, width: 40, height: H, scale: 1 } });
  // Amber (#ffc04d) somewhere along the right edge means the arrow is drawn.
  const png = Buffer.from(r.result.data, 'base64');
  writeFileSync(`${out}/edge.png`, png);
  arrowSeen = await evaluate(`(async () => { const img = new Image(); img.src = 'data:image/png;base64,${r.result.data}'; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && Math.abs(d[i + 1] - 192) < 12 && d[i + 2] < 100) return true; return false; })()`);
  await sleep(120);
}
check('an amber arrow marks an abduction off screen', arrowSeen);
await shot('5-edge-arrow');
hud = await evaluate(`__sentinel.registry.get('hudState')`);
check('the taken colonist blinks on the scanner and pips, TAKEN lamp on', hud.colonists[3] === 2 && hud.taken === true && hud.scan.dots.some((v, i) => i % 3 === 2 && v === 1));

// 7. Frame time with effects on (bloom off): a busy stretch of real wave 1, firing and pulsing.
await run(`s.calm(); s.restore(); s.spawning = true; s.craft.invuln = 999; s.pulses = 9; s.toSpawn = 10; for (let i = 0; i < 6; i++) s.spawn('husk', s.craft.x + 100 + i * 30, 60 + i * 20, 0).cool = 1e9;`);
await evaluate(`window.__frames = []; (function tick(t) { window.__frames.push(t); if (window.__frames.length < 100000) requestAnimationFrame(tick); })(performance.now())`);
await down(' '); await down('ArrowRight');
for (let i = 0; i < 4; i++) { await sleep(1500); await tap('Shift'); }
await up('ArrowRight'); await up(' ');
const ft = await evaluate(`(() => { const f = window.__frames; const d = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b); return { n: d.length, median: d[d.length >> 1], p95: d[Math.floor(d.length * 0.95)], fps: Math.round(__sentinel.loop.actualFps) }; })()`);
console.log(`frame time (headless SwiftShader, effects on, bloom off): median ${ft.median.toFixed(1)} ms, p95 ${ft.p95.toFixed(1)} ms, ${ft.fps} fps over ${ft.n} frames`);
check('frame time holds under effects (median ≤ 40 ms headless)', ft.median <= 40, `median ${ft.median.toFixed(1)} ms`);

check('no page errors', errors.length === 0, errors.join(' | '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
ws.close(); cleanup();
process.exit(failed ? 1 : 0);

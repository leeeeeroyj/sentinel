// Milestone 4 check for Sentinel: drives the dev build in headless Chrome over CDP. Scenarios are set up through the
// dev-only handle; the craft flies and fires with real key events, and the game's own rules decide the outcome.
// Usage: node m4-test.mjs <project-dir> <out-dir>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [project, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const PORT = 5196, DBG = 9336, W = 1664, H = 912;
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
const state = () => run(`return {
  score: s.score, ships: s.ships, pulses: s.pulses, wave: s.wave, toSpawn: s.toSpawn, between: s.between, dark: s.dark, over: s.over,
  banner: s.banner.title.visible ? s.banner.title.text + ' / ' + s.banner.sub.text : '',
  kinds: s.hostiles.map((e) => e.kind), alive: s.colonists.filter((c) => c.state !== 'dead').length, hud: __sentinel.registry.get('hudState') };`);
const count = (kinds, k) => kinds.filter((x) => x === k).length;
const click = async (x, y) => {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
};

// 1. Wave 1 opens with its banner, a group of five and its Minelayer; groups follow.
let s = await state();
check('wave 1 opens: five Snatchers, one Minelayer, 10 more to come', s.wave === 1 && count(s.kinds, 'snatcher') === 5 && count(s.kinds, 'minelayer') === 1 && s.toSpawn === 10, JSON.stringify({ kinds: s.kinds.length, toSpawn: s.toSpawn }));
check('WAVE 1 banner', s.banner.startsWith('WAVE 1'), s.banner);
const table = await evaluate(`import('/src/waves.ts').then((m) => ({
  snatchers: [1, 2, 5].map(m.snatchersIn), minelayers: [1, 3, 5, 7, 12].map(m.minelayersIn),
  pace: [1, 6, 11, 20].map(m.paceOf), firePace: [1, 6, 20].map(m.firePaceOf), restores: [4, 5, 10, 11].map(m.restores) }))`);
check('wave table: 15, 18, 27 Snatchers; Minelayers 1, 2, 3, 4, 4', table.snatchers.join() === '15,18,27' && table.minelayers.join() === '1,2,3,4,4', JSON.stringify(table));
check('ramp: pace 1 → 1.25 → 1.5 (cap); fire pace capped at 1.6', table.pace.join() === '1,1.25,1.5,1.5' && table.firePace.join() === '1,1.3,1.6', `${table.pace} / ${table.firePace}`);
check('restore waves are 5, 10, …', table.restores.join() === 'false,true,true,false');
await run(`s.hostiles.filter((e) => e.kind === 'snatcher').forEach((e) => s.remove(e));`);
await sleep(200);
s = await state();
check('next group warps in as soon as no Snatcher is left', count(s.kinds, 'snatcher') === 5 && s.toSpawn === 5, `${count(s.kinds, 'snatcher')} out, ${s.toSpawn} to come`);
await run(`s.groupT = 0.05;`);
await sleep(200);
s = await state();
check('…or when the group timer runs out', count(s.kinds, 'snatcher') === 10 && s.toSpawn === 0, `${count(s.kinds, 'snatcher')} out`);

// 2. Wave bonus maths: 0, 4 and 10 survivors at waves 1 and 6.
const expect = { 1: [0, 400, 1000], 6: [0, 2000, 5000] };
for (const wave of [1, 6]) for (const [i, alive] of [0, 4, 10].entries()) {
  await run(`s.calm(); s.between = 0; s.restore(); s.colonists.forEach((c, i) => { if (i >= ${alive}) c.state = 'dead'; }); s.wave = ${wave};`);
  await sleep(100);
  const before = (await state()).score;
  await run(`s.clearWave();`);
  await sleep(150);
  s = await state();
  check(`bonus at wave ${wave} with ${alive} alive: ${expect[wave][i]}`, s.score - before === expect[wave][i] && s.between > 0, `+${s.score - before}, ${s.banner}`);
  if (wave === 6 && alive === 4) await shot('1-wave-cleared');
}
await run(`s.calm(); s.between = 0; s.restore(); s.wave = 1; s.score = 0;`);

// 3. The next wave follows the break; Hounds don't hold a wave open.
await run(`s.spawning = true; s.toSpawn = 0; s.spawn('hound', s.craft.x + 300, 80, 0);`);
await sleep(200);
s = await state();
check('a wave ends with only Hounds left, and they leave too', s.kinds.length === 0 && s.between > 0, `${s.kinds}`);
await until(async () => (await state()).wave === 2, 6000).catch(() => {});
s = await state();
check('wave 2 starts after the break: 18 Snatchers in all', s.wave === 2 && count(s.kinds, 'snatcher') === 5 && s.toSpawn === 13 && s.hud.wave === 2, `wave ${s.wave}, toSpawn ${s.toSpawn}`);

// 4. Lose every colonist: lights out, Snatchers turn to Husks, and new arrivals are Husks.
await run(`s.calm(); for (let i = 0; i < 3; i++) s.spawn('snatcher', s.craft.x + 80 + i * 40, 70, 0).cool = 1e9; s.craft.invuln = 99;`);
await run(`s.colonists.forEach((c) => { c.state = 'dead'; });`);
await sleep(200);
s = await state();
check('last colonist lost: the ring goes dark', s.dark === true && s.alive === 0);
check('every Snatcher becomes a Husk', s.kinds.length === 3 && s.kinds.every((k) => k === 'husk'), s.kinds.join());
await sleep(500);
await shot('2-ring-dark');
await run(`s.calm(); s.spawning = true; s.toSpawn = 5; s.groupT = 0;`);
await sleep(200);
s = await state();
check('new arrivals come as Husks while dark', count(s.kinds, 'husk') === 5 && count(s.kinds, 'snatcher') === 0, s.kinds.join());

// 5. Skip to wave 5: colonists and lights come back.
await run(`s.wave = 4; s.clearWave();`);
await sleep(150);
await run(`s.between = 0.05;`);
await until(async () => (await state()).wave === 5, 3000).catch(() => {});
s = await state();
check('wave 5 restores all ten colonists and the lights', s.wave === 5 && s.alive === 10 && s.dark === false, `wave ${s.wave}, alive ${s.alive}, dark ${s.dark}`);
check('wave 5 sends Snatchers again, not Husks', count(s.kinds, 'snatcher') === 5 && count(s.kinds, 'minelayer') === 3, s.kinds.join());
await sleep(1800);
await shot('3-wave-5-restored');

// 6. An extra ship and pulse every 10,000.
await run(`s.calm(); s.score = 9900; Object.assign(s.craft, { x: 1000, y: 120, vx: 0, facing: 1, lead: 120, invuln: 0 }); const e = s.spawn('husk', 1080, 120, 0); e.cool = 1e9; e.jit = 1e9; e.jx = e.jy = 0;`);
const before6 = await state();
await tap(' ', 120);
await sleep(200);
s = await state();
check('crossing 10,000 gives a ship and a pulse', s.score === 10050 && s.ships === before6.ships + 1 && s.pulses === before6.pulses + 1, `ships ${before6.ships}→${s.ships}, pulses ${before6.pulses}→${s.pulses}`);
await run(`s.score = 19950; s.gain(200);`);
s = await state();
check('…and again at 20,000', s.ships === before6.ships + 2);

// 7. Game over, RETRY with Enter, then TITLE with a click.
await run(`s.calm(); s.ships = 1; s.spawn('husk', s.craft.x, s.craft.y, 0);`);
await sleep(300);
s = await state();
check('last ship lost: game over', s.ships === 0 && s.over >= 0 && s.hud.over === true);
await tap('Enter');
await sleep(150);
check('RETRY ignores a press in the first moment', (await state()).over >= 0);
await sleep(1200);
await shot('4-game-over');
await tap('Enter');
await sleep(800);
s = await state();
check('Enter retries: a fresh run', s.over === -1 && s.score === 0 && s.wave === 1 && s.ships === 3 && s.hud?.over === false, JSON.stringify({ over: s.over, score: s.score, ships: s.ships }));
await run(`s.calm(); s.ships = 1; s.spawn('husk', s.craft.x, s.craft.y, 0);`);
await sleep(1300);
await click(992, 472);
await until(() => evaluate(`__sentinel.scene.isActive('title')`), 4000).then(() => check('clicking TITLE returns to the title', true), () => check('clicking TITLE returns to the title', false));

const fps = await evaluate(`Math.round(__sentinel.loop.actualFps)`);
console.log(`fps (headless, SwiftShader): ${fps}`);
check('no page errors', errors.length === 0, errors.join(' | '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
ws.close(); cleanup();
process.exit(failed ? 1 : 0);

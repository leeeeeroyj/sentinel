// Milestone 1 check for Sentinel: drives the dev build in headless Chrome over CDP with real key events.
// Usage: node m1-test.mjs <project-dir> <out-dir>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [project, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const PORT = 5199, DBG = 9339, W = 1664, H = 912, WORLD = 3328;
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
const KEYS = { ArrowRight: 39, ArrowLeft: 37, ArrowUp: 38, ArrowDown: 40, Enter: 13, Escape: 27 };
const key = (type, k) => send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: KEYS[k], nativeVirtualKeyCode: KEYS[k] });
const down = (k) => key('rawKeyDown', k), up = (k) => key('keyUp', k);
const tap = async (k) => { await down(k); await sleep(80); await up(k); };

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${PORT}/` });
await until(() => evaluate(`!!(window.__sentinel && window.__sentinel.scene.isActive('title'))`));
await sleep(800);
await shot('1-title');
check('title scene runs', true);

await tap('Enter');
await until(() => evaluate(`__sentinel.scene.isActive('ring') && __sentinel.scene.isActive('hud')`));
await sleep(600);
const ring = `__sentinel.scene.getScene('ring')`;
// Milestone 1 checks flight only: clear the hostiles so nothing rams the craft mid-lap.
await evaluate(`(() => { const s = ${ring}; s.calm(); })()`);
const state = () => evaluate(`(() => { const s = ${ring}; return { ...s.craft, camX: s.camX, travel: s.travel }; })()`);
const s0 = await state();
check('ring + hud start, craft at start', Math.abs(s0.x - 300) < 1 && s0.facing === 1, JSON.stringify(s0));
await shot('2-ring-start');

// Full lap to the right: accumulate distance from wrapped x, and note the seam crossing.
await down('ArrowRight');
let prev = s0.x, dist = 0, crossed = false, maxV = 0;
const lapStart = Date.now();
while (dist < WORLD && Date.now() - lapStart < 40000) {
  await sleep(100);
  const s = await state();
  const d = ((s.x - prev + WORLD * 1.5) % WORLD) - WORLD / 2;
  if (s.x < prev - WORLD / 2) crossed = true;
  dist += d; prev = s.x; maxV = Math.max(maxV, s.vx);
  if (s.x < 0 || s.x >= WORLD) { check('x stays in [0, W)', false, String(s.x)); break; }
}
await up('ArrowRight');
const s1 = await state();
check('flew a full lap right', dist >= WORLD, `distance ${dist.toFixed(0)} px in ${((Date.now() - lapStart) / 1000).toFixed(1)} s`);
check('crossed the seam (x wrapped to 0)', crossed);
check('top speed capped at 175', maxV <= 175.01 && maxV > 170, `max vx ${maxV.toFixed(1)}`);
check('back near the start after one lap', Math.abs(((s1.x - s0.x + WORLD * 1.5) % WORLD) - WORLD / 2) < 120, `start ${s0.x.toFixed(0)} now ${s1.x.toFixed(0)}`);
check('view leads ahead when facing right', Math.abs(s1.lead - 120) < 5, `lead ${s1.lead.toFixed(1)}`);
await sleep(2500);
const s2 = await state();
check('drag slows the craft with no input', Math.abs(s2.vx) < 10, `vx ${s2.vx.toFixed(1)}`);

// Turn round: a left push turns the craft and the view swings to lead left.
await down('ArrowLeft'); await sleep(2500);
const s3 = await state();
await up('ArrowLeft');
check('left push turns the craft', s3.facing === -1 && s3.vx < -150, `facing ${s3.facing}, vx ${s3.vx.toFixed(0)}`);
check('view swings to lead left', s3.lead < -100, `lead ${s3.lead.toFixed(1)}`);

// Climb and dive stop at the limits.
await down('ArrowUp'); await sleep(1800); await up('ArrowUp');
const top = (await state()).y;
await down('ArrowDown'); await sleep(1800); await up('ArrowDown');
const bottom = (await state()).y;
check('climb stops at the top limit (42)', Math.abs(top - 42) < 0.01, `y ${top}`);
check('dive stops above the hull (202)', Math.abs(bottom - 202) < 0.01, `y ${bottom}`);

// Seam screenshots: park the craft so the join is in view, from both directions.
await evaluate(`(() => { const s = ${ring}; Object.assign(s.craft, { x: ${WORLD} - 60, y: 120, vx: 0, facing: 1, lead: 120 }); })()`);
await sleep(300);
const seam = await state();
check('seam is on screen for the screenshot', Math.abs(((0 - seam.camX + WORLD * 1.5) % WORLD) - WORLD / 2) < 208, `camX ${seam.camX.toFixed(0)}`);
await shot('3-seam-facing-right');
await evaluate(`(() => { const s = ${ring}; Object.assign(s.craft, { x: 60, y: 150, vx: 0, facing: -1, lead: -120 }); })()`);
await sleep(300);
await shot('4-seam-facing-left');

// Esc returns to the title.
await tap('Escape');
await until(() => evaluate(`__sentinel.scene.isActive('title') && !__sentinel.scene.isActive('hud')`), 5000).then(() => check('Esc returns to title, HUD stops', true), () => check('Esc returns to title, HUD stops', false));

const fps = await evaluate(`Math.round(__sentinel.loop.actualFps)`);
console.log(`fps (headless, SwiftShader): ${fps}`);
check('no page errors', errors.length === 0, errors.join(' | '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
ws.close(); cleanup();
process.exit(failed ? 1 : 0);

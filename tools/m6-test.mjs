// Milestone 6 check for Sentinel: drives the dev build in headless Chrome over CDP. Scenarios are set up through the
// dev-only handle; the craft flies and fires with real key events, and the game's own rules decide the outcome.
// Usage: node m6-test.mjs <project-dir> <out-dir>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [project, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const PORT = 5194, DBG = 9334;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] });
const chrome = spawn('google-chrome', [
  '--headless=new', '--no-sandbox', '--hide-scrollbars', '--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${DBG}`, `--user-data-dir=${out}/profile`, 'about:blank',
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


// Touch: CDP takes the full list of fingers down each time; it turns each change (added, moved, lifted) into pointer events.
const fingers = new Map();
const sendTouch = (type) => send('Input.dispatchTouchEvent', { type, touchPoints: [...fingers].map(([id, p]) => ({ id, x: p.x, y: p.y })) });
const press = (id, x, y) => { fingers.set(id, { x, y }); return sendTouch('touchStart'); };
const move = (id, x, y) => { fingers.set(id, { x, y }); return sendTouch('touchMove'); };
const lift = (id) => { fingers.delete(id); return sendTouch(fingers.size ? 'touchMove' : 'touchEnd'); };
const tapAt = async (x, y, ms = 80) => { await press(9, x, y); await sleep(ms); await lift(9); };

async function open(w, h) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true, screenOrientation: w > h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
  await send('Page.navigate', { url: `http://localhost:${PORT}/` });
  await until(() => evaluate(`!!(window.__sentinel && window.__sentinel.scene.isActive('title'))`));
  await sleep(700);
}
const canvasRect = () => evaluate(`(() => { const r = document.querySelector('#game canvas').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height, k: r.width / 416 }; })()`);
const controls = () => evaluate(`[...document.body.children].filter((el) => el.style.position === 'fixed' && el.style.display !== 'none').map((el) => { const r = el.getBoundingClientRect(); return { label: el.textContent || 'stick', x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; })`);

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] }).catch(() => {});

const R = `__sentinel.scene.getScene('ring')`;
const run = (body) => evaluate(`(() => { const s = ${R}; ${body} })()`);

for (const [w, h, layout] of [[844, 390, 'corners'], [932, 390, 'side bars']]) {
  await open(w, h);
  check(`[${w}×${h}] page treats this as a touch screen`, await evaluate(`matchMedia('(pointer: coarse)').matches`));
  const rect = await canvasRect();
  // Start by tapping START on the title.
  await tapAt(rect.left + 208 * rect.k, rect.top + 114 * rect.k);
  await until(() => evaluate(`__sentinel.scene.isActive('ring')`), 5000).then(() => check(`[${w}×${h}] tapping START begins the game`, true), () => check(`[${w}×${h}] tapping START begins the game`, false));
  await sleep(500);
  await run(`s.calm(); s.craft.invuln = 999;`);
  const ctl = await controls();
  const stick = ctl.find((c) => c.label === 'stick'), fire = ctl.find((c) => c.label === 'FIRE'), pulse = ctl.find((c) => c.label === 'PULSE');
  check(`[${w}×${h}] stick, FIRE and PULSE shown (${layout})`, !!(stick && fire && pulse), JSON.stringify(ctl.map((c) => [c.label, Math.round(c.x), Math.round(c.y), Math.round(c.r)])));
  const inBars = stick.x + stick.r <= rect.left + 1 && fire.x - fire.r >= rect.left + rect.width - 1 && pulse.x - pulse.r >= rect.left + rect.width - 1;
  check(`[${w}×${h}] controls sit ${layout === 'side bars' ? 'in the bars beside the game' : 'over the bottom corners'}`, layout === 'side bars' ? inBars : !inBars && stick.y > rect.top + rect.height * 0.6);
  const touching = [stick, fire, pulse].every((c) => c.x - c.r >= 0 && c.x + c.r <= w && c.y - c.r >= 0 && c.y + c.r <= h);
  check(`[${w}×${h}] every control is fully on screen`, touching);
  const big = [stick, fire, pulse].every((c) => c.r * 2 >= 36);
  check(`[${w}×${h}] tap targets at least 36 px across`, big, [stick, fire, pulse].map((c) => Math.round(c.r * 2)).join(', '));
  await shot(`${w}x${h}-1-playing`);

  // Fly: push right, then left (turns), then up.
  await run(`Object.assign(s.craft, { vx: 0, facing: 1 });`);
  await press(1, stick.x, stick.y);
  await move(1, stick.x + stick.r, stick.y);
  await sleep(600);
  let st = await run(`return { vx: s.craft.vx, facing: s.craft.facing, y: s.craft.y, device: __sentinel.registry.get('hudState').device };`);
  check(`[${w}×${h}] stick right flies right`, st.vx > 100 && st.facing === 1, `vx ${st.vx.toFixed(0)}`);
  check(`[${w}×${h}] hints switch to touch`, st.device === 'touch');
  await move(1, stick.x - stick.r, stick.y);
  await sleep(900);
  st = await run(`return { vx: s.craft.vx, facing: s.craft.facing, y: s.craft.y };`);
  check(`[${w}×${h}] stick left turns the craft`, st.vx < -50 && st.facing === -1, `vx ${st.vx.toFixed(0)}, facing ${st.facing}`);
  const y0 = st.y;
  await move(1, stick.x, stick.y - stick.r);
  await sleep(500);
  st = await run(`return { y: s.craft.y };`);
  check(`[${w}×${h}] stick up climbs`, st.y < y0 - 20, `${y0.toFixed(0)} → ${st.y.toFixed(0)}`);

  // Fire with the other thumb while still holding the stick (two touches at once).
  await move(1, stick.x + stick.r * 0.3, stick.y);
  await run(`Object.assign(s.craft, { y: 120, facing: 1, lead: 120 }); const e = s.spawn('husk', s.craft.x + 90, 121, 0); e.cool = 1e9; e.jit = 1e9; e.jx = e.jy = 0;`);
  const score0 = await run(`return s.score;`);
  await press(2, fire.x, fire.y);
  await sleep(300);
  await shot(`${w}x${h}-2-stick-and-fire`);
  await lift(2);
  st = await run(`return { score: s.score, h: s.hostiles.length };`);
  check(`[${w}×${h}] FIRE kills while the stick is held`, st.h === 0 && st.score - score0 === 150, `+${st.score - score0}`);
  await lift(1);

  // PULSE is a tap.
  await run(`s.pulses = 3; for (let i = 0; i < 3; i++) { const e = s.spawn('husk', s.craft.x + 60 + i * 40, 70 + i * 40, 0); e.cool = 1e9; e.jit = 1e9; e.jx = e.jy = 0; }`);
  await tapAt(pulse.x, pulse.y, 200);
  await sleep(150);
  st = await run(`return { pulses: s.pulses, h: s.hostiles.length };`);
  check(`[${w}×${h}] tapping PULSE fires one pulse`, st.pulses === 2 && st.h === 0, `pulses ${st.pulses}, hostiles ${st.h}`);

  // Catch a falling colonist and fly them down with the stick.
  await run(`const c = s.colonists[0]; Object.assign(s.craft, { y: 140, vx: 0 }); c.x = s.craft.x; c.y = 100; c.state = 'falling'; c.vy = 20; c.fallFrom = 100;`);
  await until(() => run(`return !!s.craft.carry;`), 4000).then(() => check(`[${w}×${h}] catching a colonist`, true), () => check(`[${w}×${h}] catching a colonist`, false));
  const score1 = await run(`return s.score;`);
  await press(1, stick.x, stick.y);
  await move(1, stick.x, stick.y + stick.r);
  await until(() => run(`return !s.craft.carry;`), 5000).catch(() => {});
  await lift(1);
  check(`[${w}×${h}] stick down sets them on the hull: +500`, (await run(`return s.score;`)) - score1 === 500);

  // The speaker is a tap target.
  const muted0 = await evaluate(`__sentinel.registry.get('muted') === true`);
  await tapAt(rect.left + (rect.width * (832 - 18)) / 832, rect.top + (rect.height * 16) / 456);
  await sleep(100);
  check(`[${w}×${h}] tapping the speaker toggles sound`, (await evaluate(`__sentinel.registry.get('muted') === true`)) !== muted0);
  await tapAt(rect.left + (rect.width * (832 - 18)) / 832, rect.top + (rect.height * 16) / 456);

  // Game over: controls hide, RETRY is a tap.
  await run(`s.calm(); s.ships = 1; s.craft.invuln = 0; s.spawn('husk', s.craft.x, s.craft.y, 0);`);
  await sleep(1300);
  check(`[${w}×${h}] touch controls hide on game over`, (await controls()).length === 0);
  check(`[${w}×${h}] game-over hint is for touch`, await run(`return __sentinel.scene.getScene('hud').hint.text === 'TAP RETRY OR TITLE';`));
  await shot(`${w}x${h}-3-game-over`);
  await tapAt(rect.left + ((416 - 80) / 832) * rect.width, rect.top + ((120 + 96 + 20) / 456) * rect.height);
  await sleep(700);
  st = await run(`return { over: s.over, ships: s.ships };`);
  check(`[${w}×${h}] tapping RETRY starts a fresh run`, st.over === -1 && st.ships === 3, JSON.stringify(st));
  check(`[${w}×${h}] controls come back`, (await controls()).length === 3);
}

// Portrait: the turn-sideways overlay covers the game.
await open(390, 844);
const rotate = await evaluate(`getComputedStyle(document.getElementById('rotate')).display`);
check('portrait phone shows TURN YOUR PHONE SIDEWAYS', rotate === 'flex', rotate);
await shot('portrait');

const fps = await evaluate(`Math.round(__sentinel.loop.actualFps)`);
console.log(`fps (headless, SwiftShader): ${fps}`);
check('no page errors', errors.length === 0, errors.join(' | '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
ws.close(); cleanup();
process.exit(failed ? 1 : 0);

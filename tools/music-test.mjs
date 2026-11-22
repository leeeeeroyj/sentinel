// Music: every piece is written correctly and renders to a loop that isn't silent or clipped; the title has its
// theme; a run plays the patrol, the dark ring its own piece and the patrol again once the colonists return; pause
// holds the music and resume picks it up; a jingle dips it and it comes back; game over stops it; retry and the
// title bring it back.
// Usage: node tools/music-test.mjs <project-dir> <out-dir>
import { session } from './cdp.mjs';

const [project, out] = process.argv.slice(2);
const t = await session({ project, out, port: 5281, debugPort: 9481 });
const { evaluate, until, tap, check, sleep } = t;
const G = 'window.__sentinel';
const S = `${G}.scene.getScene('ring')`;
const music = (expr) => evaluate(`(async () => { const m = await import('/src/music.ts'); return ${expr}; })()`);
const now = () => music('m.musicNow()');
const gain = async () => (await now())?.gain ?? -1;
/** Taps a key until the game shows it took it (the first frames of a run, and slow headless frames, can miss one). */
const until1 = async (key, cond) => { for (let i = 0; i < 10 && !(await cond()); i++) { await tap(key); await sleep(250); } };

await until(() => evaluate(`!!${G} && ${G}.scene.isActive('title')`));
const errors = await music('m.songErrors()');
check('every piece is written correctly', errors.length === 0, errors.join('; '));
const renders = await music(`Object.entries(m.SONGS).map(([name, song]) => {
  const t0 = performance.now(), b = m.renderSong(new OfflineAudioContext(1, 1, 48000), song), ms = performance.now() - t0, d = b.getChannelData(0);
  let peak = 0, sum = 0;
  for (const v of d) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
  return { name, secs: +b.duration.toFixed(1), ms: Math.round(ms), peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(3) };
})`);
for (const r of renders) check(`${r.name} renders a ${r.secs} s loop in ${r.ms} ms, neither silent nor clipped`, r.secs > 10 && r.rms > 0.03 && r.peak <= 0.901, JSON.stringify(r));

await sleep(300);
check('the title plays its theme', (await now())?.name === 'title');
await tap('Enter');
await until(() => evaluate(`${G}.scene.isActive('ring') && !!${G}.registry.get('hudState')`), 5000);
await sleep(500);
check('the audio context runs after a key press', (await evaluate(`${G}.sound.context.state`)) === 'running');
let m = await now();
check('a run plays the patrol', m?.name === 'ring' && m.playing, JSON.stringify(m));

await until1('p', () => evaluate(`${S}.paused`));
m = await now();
check('pause holds the music', m?.paused && !m.playing, JSON.stringify(m));
await until1('p', () => evaluate(`!${S}.paused`));
await sleep(100);
m = await now();
check('resume picks it up', m?.playing && !m.paused, JSON.stringify(m));

await evaluate(`${S}.goDark()`);
await sleep(200);
check('the dark ring has its own piece', (await now())?.name === 'dark');
await evaluate(`${S}.restore()`);
await sleep(200);
check('the patrol comes back with the colonists', (await now())?.name === 'ring');

await evaluate(`${S}.clearWave()`);
await sleep(300);
const low = await gain();
check('the wave-clear jingle dips the music', low > 0 && low < 0.12, `gain ${low.toFixed(3)}`);
await sleep(2600);
const back = await gain();
check('and it comes back', Math.abs(back - 0.3) < 0.01, `gain ${back.toFixed(3)}`);

await evaluate(`(() => { const s = ${S}; s.calm(); s.ships = 1; s.craft.invuln = 0; s.destroyCraft(); })()`);
await sleep(300);
check('game over stops the music', (await now()) === null);
for (let i = 0; i < 20 && !(await now()); i++) { await tap('Enter'); await sleep(200); }
m = await now();
check('retry starts the patrol again', m?.name === 'ring' && m.playing, JSON.stringify(m));

await until1('m', () => evaluate(`${G}.sound.mute`));
check('M mutes the music with everything else', (await evaluate(`${G}.sound.mute`)) && (await now())?.playing);
await until1('m', () => evaluate(`!${G}.sound.mute`));
await until1('Escape', () => evaluate(`${G}.scene.isActive('title')`));
await sleep(300);
check('back on the title, its theme plays', (await now())?.name === 'title');
t.done();

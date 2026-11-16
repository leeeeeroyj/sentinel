// Pause and high score: P, Start (the pad) and the page going to the background pause the run; P or Enter resumes;
// Esc from the pause menu goes to the title. A run's score becomes the high score (sentinel-hi), shown on the
// title and the game-over panel, and a lower score doesn't replace it.
// Usage: node tools/pause-hi-test.mjs <project-dir> <out-dir>
import { session } from './cdp.mjs';

const [project, out] = process.argv.slice(2);
const t = await session({ project, out, port: 5245, debugPort: 9415, width: 1664, height: 912 });
const { evaluate, until, shot, tap, check, sleep } = t;
const G = 'window.__sentinel';
const S = `${G}.scene.getScene('ring')`;
const hud = `${G}.scene.getScene('hud')`;
const x = () => evaluate(`${S}.backdrop ? ${S}.travel + ${S}.hostiles.reduce((a, e) => a + e.x + e.y, 0) : 0`);
const start = async () => {
  await until(() => evaluate(`${G}.scene.isActive('title')`));
  await sleep(400);
  await tap('Enter');
  await until(() => evaluate(`${G}.scene.isActive('ring') && !!${G}.registry.get('hudState')`), 5000);
  await sleep(1500);
};

await until(() => evaluate(`!!${G}`));
await evaluate(`localStorage.clear()`);
await start();

await tap('p');
await sleep(100);
const a = await x();
await sleep(600);
check('P pauses: the hostiles hold still', (await evaluate(`${S}.paused`)) && (await x()) === a);
check('the pause panel shows', await evaluate(`${hud}.pauseMenu.visible`));
await shot('1-paused');
await tap('p');
await sleep(400);
check('P again resumes', !(await evaluate(`${S}.paused`)) && (await x()) !== a);
await tap('p');
await sleep(100);
await tap('Enter');
await sleep(100);
check('Enter resumes', !(await evaluate(`${S}.paused`)));
await evaluate(`Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange'))`);
await sleep(100);
check('the page going to the background pauses', await evaluate(`${S}.paused`));
// Phaser's own loop sleeps on the same event: wake it.
await evaluate(`delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))`);
await sleep(200);
await tap('Escape');
await until(() => evaluate(`${G}.scene.isActive('title')`), 3000).catch(() => {});
check('Esc from the pause menu goes to the title', await evaluate(`${G}.scene.isActive('title') && !${G}.scene.isActive('hud')`));

await start();
check('a run started after leaving from pause is not paused, and its clocks run', !(await evaluate(`${S}.paused || ${S}.time.paused || ${S}.tweens.paused`)));
const over = async (score) => {
  await evaluate(`(() => { const s = ${S}; s.calm(); s.score = ${score}; s.ships = 1; s.craft.invuln = 0; s.destroyCraft(); })()`);
  await until(() => evaluate(`${S}.over >= 0`), 3000);
  await sleep(400);
};
await over(1234);
await shot('2-new-high');
check('game over saves the high score', (await evaluate(`localStorage.getItem('sentinel-hi')`)) === '1234');
check('the panel says NEW HIGH SCORE!', await evaluate(`${hud}.overHi.text === 'NEW HIGH SCORE!'`));
await sleep(1200);
await tap('Enter');
await until(() => evaluate(`${S}.over < 0`), 3000);
await sleep(500);
await over(500);
check('a lower score leaves it alone', (await evaluate(`localStorage.getItem('sentinel-hi')`)) === '1234');
{ const hi = await evaluate(`${hud}.overHi.text`); check('and the panel shows the high score', hi === 'HI 001,234', hi); }
await tap('Escape');
await until(() => evaluate(`${G}.scene.isActive('title')`), 3000);
await sleep(400);
await shot('3-title');
check('the title shows HI', await evaluate(`${G}.scene.getScene('title').children.list.some((o) => o.text === 'HI 1,234')`));
t.done();

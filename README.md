<div align="center">

# Sentinel

**Hold the ring. Shoot the Snatchers. Catch the colonists.**

A side-scrolling patrol shooter on a looping orbital ring. It runs in the browser with a keyboard and mouse or a controller.

### [▶ Play it now](https://leeeeeroyj.github.io/sentinel/)

[![Deploy](https://github.com/leeeeeroyj/sentinel/actions/workflows/deploy.yml/badge.svg)](https://github.com/leeeeeroyj/sentinel/actions/workflows/deploy.yml)
![Phaser 4](https://img.shields.io/badge/Phaser-4-8a5cf6)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178c6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![Sentinel gameplay: the patrol craft fires its laser across the ring while a Snatcher lifts a colonist away, another drops onto the hull, a rescued colonist falls and two Husks close in](docs/screenshot.png)

</div>

## About

Sentinel is an original arcade game inspired by the mechanics of Williams Electronics' 1981 arcade game *Defender*. You fly patrol round an orbital colony ring, eight screens around, that loops with no edges. Drones called Snatchers drop onto the colonists walking the hull and carry them off. Shoot them down, catch whoever falls, and set them back down safely.

- **A world that loops.** Fly far enough either way and you come back round to where you started. The hull's domes, towers and masts repeat every lap, so you learn the ring as you play.
- **Push the way you want to go.** No thrust or reverse buttons: push left or right to fly and face that way, and the view swings ahead of you when you turn.
- **Rescue, not just shooting.** Every abduction is a race. Hit a Snatcher low and its catch drops safely; hit it high and you'd better be underneath.
- **Warning before harm.** New hostiles fade in inside a closing ring, harmless until they're solid.
- **Sound with no audio files.** Sound effects are generated in code, sfxr style, when the game loads.

## Status

Sentinel is in active development. This build is the **first playable** version (milestone 2 of 7): the laser, colonists, Snatchers and Husks, rescues, scoring, ships and respawns. Still to come:

- Minelayers and their mines, Hounds that punish stalling, enemy fire and the pulse (smart bomb)
- Waves, wave bonuses, the ring going dark when the last colonist is lost, and extra ships every 10,000 points
- A long-range scanner, alarm lamps, sound effects and explosions
- Touch controls for phones

Until waves arrive, a new group of five Snatchers warps in whenever the last one is gone.

## How to play

Ten colonists walk the hull. Snatchers seek them out, drop onto them and climb slowly away. If a Snatcher reaches the top of the sky, it fuses with its catch into a Husk and that colonist is gone.

- **Shoot a Snatcher that's lifting someone** and the colonist falls.
- **Catch them in mid-air** for 500, then **fly them down to the hull** for 500 more.
- **A short fall** (80 px, five tiles, or less) they survive on their own, for 250. From any higher, they're lost.
- **Ramming a hostile** destroys it, but costs you a ship. You start with 3. After a respawn your craft blinks and can't be hit for 2 seconds.

| Hostile | Points | Behaviour |
| --- | ---: | --- |
| Snatcher | 150 | Drifts over the nearest colonist, drops onto them and lifts them away. |
| Husk | 150 | A Snatcher fused with its catch. Twitchy: it homes in on you, never in a straight line. |

| Rescue | Points |
| --- | ---: |
| Catch a falling colonist | 500 |
| Set them down on the hull | 500 |
| A colonist survives a short fall | 250 |

## Controls

| | Keyboard + mouse | Controller |
| --- | --- | --- |
| Fly and turn | ← → or A D | Left stick or D-pad |
| Climb and dive | ↑ ↓ or W S | Left stick or D-pad |
| Fire | Hold Space, J or left click | Hold A, RT or RB |
| Sound on / off | M, or click the speaker (top right) | Y |
| Start | Enter or Space, or click **START** | A or Start |
| Back to the title | Esc | Back |

A weak push nudges the craft without turning it. Controllers show up once you press a button.

## Run it locally

You need [Node.js](https://nodejs.org/) 20.19+ or 22.12+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check and build to dist/
```

Every push to `main` builds the game and deploys it to GitHub Pages.

## Project layout

```
src/
  main.ts            game setup
  config.ts          tunables: ring size, flight, laser, points, colours
  world.ts           ring maths (wrap-around distance) and the seeded generator
  backdrop.ts        stars, planet, skyline and the hull, baked to tiling textures
  entities/          colonists, Snatchers and Husks
  controls.ts        keyboard, mouse and gamepad input
  sfx.ts             procedural sound effects
  scenes/            title screen, the ring and the HUD
assets/sprites/      the game's 16 × 16 sprites
design/              concept sheet and build plan
tools/sprites.py     sprite search and export script
tools/m*-test.mjs    headless Chrome checks for each milestone
```

## Credits

- **Sprites:** from the CC0 [Angais/pixel-art-atlas-1.4m](https://huggingface.co/datasets/Angais/pixel-art-atlas-1.4m) collection of AI-generated pixel art, found with [Pixel Search](https://huggingface.co/spaces/cfahlgren1/pixel-search).
- **Font:** [Silkscreen](https://fonts.google.com/specimen/Silkscreen) by Jason Kottke (SIL Open Font License).
- **Engine:** [Phaser](https://phaser.io/).
- **Inspiration:** Williams Electronics' *Defender*. Sentinel is an original game and isn't affiliated with or endorsed by the original's rights holders.

## License

The code is released under the [MIT License](LICENSE). The sprites in `assets/sprites/` and `design/` are CC0 (public domain), and the Silkscreen font is under the SIL Open Font License.

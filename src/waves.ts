import { WAVES } from './config';

/** How many Snatchers a wave sends in all. */
export const snatchersIn = (wave: number) => WAVES.first + WAVES.more * (wave - 1);

export const minelayersIn = (wave: number) => WAVES.minelayers[Math.min(wave, WAVES.minelayers.length) - 1];

/** Movement speed multiplier for this wave. */
export const paceOf = (wave: number) => Math.min(WAVES.paceCap, 1 + WAVES.pace * (wave - 1));

/** Fire rate multiplier for this wave (cooldowns tick this much faster). */
export const firePaceOf = (wave: number) => Math.min(WAVES.firePaceCap, 1 + WAVES.firePace * (wave - 1));

/** End-of-wave bonus for the colonists still alive. */
export const bonusFor = (wave: number, survivors: number) => survivors * Math.min(WAVES.bonusCap, WAVES.bonusPer * wave);

/** Waves 5, 10, 15… bring every colonist and the ring's lights back. */
export const restores = (wave: number) => wave % WAVES.restoreEvery === 0;

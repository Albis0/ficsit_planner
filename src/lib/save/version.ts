import { OLDEST_SAVE_VERSION } from './extract';
import type { SaveHeader } from './header';

/** The newest game build and save version this reader was checked against (1.2). */
export const KNOWN_BUILD = 502094;
export const KNOWN_SAVE_VERSION = 60;

/** The game version that writes a save version: 46 is 1.0, 51-52 are 1.1, 58 and up are 1.2. */
export const gameVersion = (saveVersion: number) =>
  saveVersion >= 58 ? '1.2' : saveVersion >= 51 ? '1.1' : saveVersion >= OLDEST_SAVE_VERSION ? '1.0' : 'Early Access';

/** Written by a game newer than the one this reader was checked against: it may read only in part. */
export const isNewer = (h: Pick<SaveHeader, 'build' | 'saveVersion'>) => h.saveVersion > KNOWN_SAVE_VERSION || h.build > KNOWN_BUILD;

/** Saves from before 1.0 are laid out differently and are not read at all. */
export const isSupported = (h: Pick<SaveHeader, 'saveVersion'>) => h.saveVersion >= OLDEST_SAVE_VERSION;

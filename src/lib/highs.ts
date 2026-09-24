import loadHighs, { type Highs } from 'highs';
import wasmUrl from 'highs/runtime?url';

let instance: Promise<Highs> | undefined;

/** Loads the bundled HiGHS WebAssembly solver once; works offline since the wasm ships with the app. */
export const getHighs = () => (instance ??= loadHighs({ locateFile: () => wasmUrl }));

/** Drops the instance so the next call loads a fresh one; a wasm abort leaves the old one unusable. */
export const resetHighs = () => {
  instance = undefined;
};

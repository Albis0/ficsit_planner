import loadHighs, { type Highs } from 'highs';
import wasmUrl from 'highs/runtime?url';

let instance: Promise<Highs> | undefined;

/** Loads the bundled HiGHS WebAssembly solver once; works offline since the wasm ships with the app. */
export const getHighs = () => (instance ??= loadHighs({ locateFile: () => wasmUrl }));

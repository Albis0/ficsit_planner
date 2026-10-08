import loadHighs, { type Highs } from 'highs';
import wasmUrl from 'highs/runtime?url';

let instance: Promise<Highs> | undefined;

/** Size of the solver wasm, for the progress bar when the server doesn't say how much it will send. */
const WASM_BYTES = 3_531_385;

/** Fetches the wasm and reports how far it got, 0 to 1. Resolves to nothing if it can't be read in pieces. */
async function fetchWasm(onProgress: (done: number) => void): Promise<ArrayBuffer | undefined> {
  const res = await fetch(wasmUrl);
  if (!res.ok || !res.body) return undefined;
  // A compressed reply's length is not what comes out of the reader.
  const sent = res.headers.get('content-encoding') ? 0 : Number(res.headers.get('content-length'));
  const total = sent > 0 ? sent : WASM_BYTES;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    onProgress(Math.min(0.99, loaded / total));
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return bytes.buffer;
}

/**
 * Loads the bundled HiGHS WebAssembly solver once; works offline since the wasm ships with the app. The first caller's
 * onProgress hears how much of the wasm has arrived.
 */
export const getHighs = (onProgress?: (done: number) => void) =>
  (instance ??= (async () => {
    const wasmBinary = onProgress ? await fetchWasm(onProgress).catch(() => undefined) : undefined;
    return loadHighs(wasmBinary ? { wasmBinary } : { locateFile: () => wasmUrl });
  })());

/** Drops the instance so the next call loads a fresh one; a wasm abort leaves the old one unusable. */
export const resetHighs = () => {
  instance = undefined;
};

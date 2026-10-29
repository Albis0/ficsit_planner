import { readCapped } from '../capped';
import { Reader, SaveError } from './reader';

const CHUNK_TAG = 0x9e2a83c1;
const CHUNK_V2 = 0x22222222;

// Deflate cannot shrink more than about 1032 to 1; a chunk claiming more than this is lying about its size.
const MAX_RATIO = 1100;

// The chunks together go into one buffer; no browser makes one bigger than this, and a real late-game save is far below it.
const MAX_BODY = 2 ** 31;

const inflate = (part: Uint8Array, max: number) =>
  readCapped(new Blob([part as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate')), max);

/** Unpacks the body after the header: a run of zlib chunks, each behind a small header of its own. */
export async function inflateBody(bytes: Uint8Array, start: number, progress?: (done: number) => void): Promise<Uint8Array> {
  // Walk the chunk headers first, so the whole body goes into one buffer.
  const r = new Reader(bytes, start);
  const chunks: { at: number; packed: number; size: number }[] = [];
  let total = 0;
  while (r.pos < r.size) {
    if (r.u32() !== CHUNK_TAG) throw new SaveError(`Damaged save: no chunk at byte ${r.pos - 4}`);
    const v2 = r.u32() === CHUNK_V2;
    r.skip(8); // largest chunk size
    if (v2) r.skip(1); // compression, 3 is zlib
    const packed = r.i64();
    const size = r.i64();
    r.skip(16); // the same two sizes again
    // The sizes come from the file: checked before a buffer is made for them.
    if (packed < 0 || size < 0 || size > packed * MAX_RATIO + 1024) throw new SaveError('Damaged save: chunk size');
    chunks.push({ at: r.pos, packed, size });
    total += size;
    if (total > MAX_BODY) throw new SaveError('Damaged save: body is too big');
    r.skip(packed);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const [i, c] of chunks.entries()) {
    const part = await inflate(bytes.subarray(c.at, c.at + c.packed), c.size).catch(() => {
      throw new SaveError(`Damaged save: chunk ${i + 1} does not unpack`);
    });
    if (part.length !== c.size) throw new SaveError(`Damaged save: chunk ${i + 1} unpacks to the wrong size`);
    out.set(part, at);
    at += part.length;
    progress?.((i + 1) / chunks.length);
  }
  return out;
}

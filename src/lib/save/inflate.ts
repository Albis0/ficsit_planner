import { Reader, SaveError } from './reader';

const CHUNK_TAG = 0x9e2a83c1;
const CHUNK_V2 = 0x22222222;

const inflate = async (part: Uint8Array) =>
  new Uint8Array(
    await new Response(new Blob([part as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer(),
  );

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
    if (packed < 0 || size < 0) throw new SaveError('Damaged save: chunk size');
    chunks.push({ at: r.pos, packed, size });
    total += size;
    r.skip(packed);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const [i, c] of chunks.entries()) {
    const part = await inflate(bytes.subarray(c.at, c.at + c.packed)).catch(() => {
      throw new SaveError(`Damaged save: chunk ${i + 1} does not unpack`);
    });
    if (part.length !== c.size) throw new SaveError(`Damaged save: chunk ${i + 1} unpacks to the wrong size`);
    out.set(part, at);
    at += part.length;
    progress?.((i + 1) / chunks.length);
  }
  return out;
}

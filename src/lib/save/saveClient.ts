import type { SaveStep } from './extract';
import { readHeader, type SaveHeader } from './header';
import { SaveError } from './reader';
import type { SaveMessage, SaveRequest } from './save.worker';
import type { SaveData } from './types';

export type SaveProgress = { step: SaveStep; done: number };

/** Why reading a save stopped: the player cancelled, the file is not a readable save, or something else broke. */
export class SaveFailed extends Error {
  constructor(
    message: string,
    readonly reason: 'cancelled' | 'damaged' | 'failed',
  ) {
    super(message);
  }
}

/** Reads a save in a worker of its own. There is no time limit, a big save just takes longer; cancel() ends it. */
export function importSave(file: Blob, onProgress?: (p: SaveProgress) => void): { result: Promise<SaveData>; cancel: () => void } {
  const worker = new Worker(new URL('./save.worker.ts', import.meta.url), { type: 'module' });
  let fail: (e: SaveFailed) => void = () => {};
  const result = new Promise<SaveData>((resolve, reject) => {
    fail = reject;
    worker.onmessage = ({ data }: MessageEvent<SaveMessage>) => {
      if ('progress' in data) return onProgress?.(data.progress);
      worker.terminate();
      if (data.ok) resolve(data.save);
      else reject(new SaveFailed(data.error, data.damaged ? 'damaged' : 'failed'));
    };
    worker.onerror = (e) => {
      e.preventDefault();
      worker.terminate();
      reject(new SaveFailed(e.message || 'The save reader stopped', 'failed'));
    };
  });
  worker.postMessage({ file } satisfies SaveRequest);
  return {
    result,
    cancel: () => {
      worker.terminate();
      fail(new SaveFailed('Cancelled', 'cancelled'));
    },
  };
}

/** Reads only a save's header, on the main thread, for listing saves without opening them. Undefined if it is not a save. */
export async function readSaveHeader(file: Blob): Promise<SaveHeader | undefined> {
  // The header is a few hundred bytes; a long mod list can push it further, so the whole file is the fallback.
  for (const bytes of [64 * 1024, file.size]) {
    try {
      return readHeader(new Uint8Array(await file.slice(0, bytes).arrayBuffer()));
    } catch (e) {
      if (!(e instanceof SaveError) || bytes >= file.size) return undefined;
    }
  }
  return undefined;
}

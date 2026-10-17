/// <reference lib="webworker" />
import { readSave, type SaveStep } from './extract';
import { SaveError } from './reader';
import type { SaveData } from './types';

// Reads a save off the main thread. A new worker per file: it holds the whole unpacked body, and ending it frees that.

export type SaveRequest = { file: Blob };
export type SaveMessage =
  | { progress: { step: SaveStep; done: number } }
  | { ok: true; save: SaveData }
  | { ok: false; error: string; damaged: boolean };

declare const self: DedicatedWorkerGlobalScope;

const post = (m: SaveMessage) => self.postMessage(m);

self.onmessage = async ({ data }: MessageEvent<SaveRequest>) => {
  let last = '';
  // At most one message per step and percent; the parse step alone would send thousands.
  const progress = (step: SaveStep, done: number) => {
    const key = `${step} ${Math.floor(done * 100)}`;
    if (key === last) return;
    last = key;
    post({ progress: { step, done } });
  };
  try {
    progress('read', 0);
    const bytes = new Uint8Array(await data.file.arrayBuffer());
    progress('read', 1);
    post({ ok: true, save: await readSave(bytes, progress) });
  } catch (e) {
    post({ ok: false, error: e instanceof Error ? e.message : String(e), damaged: e instanceof SaveError });
  }
};

/// <reference lib="webworker" />
import { getHighs, resetHighs } from './highs';
import { autoAssign, SolverError, solve, type RecipeMod, type SolveInput, type SolveResult } from './solver';
import { toFailure, type SolveFailure } from './solveFailure';

// Runs HiGHS off the main thread so solving (and auto placement's many re-solves) never freezes the UI.

export type SolverRequest =
  | { id: number; kind: 'solve'; input: SolveInput }
  | { id: number; kind: 'autoAssign'; input: SolveInput; stock: { sloops: number; shards: number } };

export type SolverResponse =
  | { id: number; ok: true; value: SolveResult | Record<string, RecipeMod> }
  | { id: number; ok: false; failure: SolveFailure };

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async ({ data: req }: MessageEvent<SolverRequest>) => {
  let reply: SolverResponse;
  try {
    const highs = await getHighs();
    const value = req.kind === 'solve' ? solve(highs, req.input) : autoAssign(highs, req.input, req.stock);
    reply = { id: req.id, ok: true, value };
  } catch (e) {
    if (!(e instanceof SolverError)) resetHighs();
    reply = { id: req.id, ok: false, failure: toFailure(e) };
  }
  self.postMessage(reply);
};

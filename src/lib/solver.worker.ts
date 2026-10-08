/// <reference lib="webworker" />
import { applyGame } from './game';
import { getHighs, resetHighs } from './highs';
import { calcModel } from './model/calc';
import type { CalcInput, CalcResult } from './model/calc/result';
import { autoAssign, fewestBuildings, heldByPins, SolverError, solve, type RecipeMod, type SolveInput, type SolveResult } from './solver';
import { toFailure, type SolveFailure } from './solveFailure';

// Runs HiGHS off the main thread so solving (and auto placement's many re-solves) never freezes the UI.

export type SolverRequest =
  | { id: number; kind: 'solve'; input: SolveInput }
  | { id: number; kind: 'autoAssign'; input: SolveInput; stock: { sloops: number; shards: number }; all?: boolean }
  | { id: number; kind: 'model'; input: CalcInput };

export type SolverResponse =
  | { id: number; ok: true; value: SolveResult | Record<string, RecipeMod> | CalcResult }
  | { id: number; ok: false; failure: SolveFailure };

/** The solver's own loading, 0 to 1, then 1 once it is ready. */
export type SolverLoading = { loading: number };

declare const self: DedicatedWorkerGlobalScope;

// Starts loading the solver as soon as the worker starts, and says how far it got.
const report = (loading: number) => self.postMessage({ loading } satisfies SolverLoading);
report(0.01);
getHighs(report)
  .then(() => report(1))
  .catch(() => report(1));

self.onmessage = async ({ data: req }: MessageEvent<SolverRequest>) => {
  let reply: SolverResponse;
  try {
    const highs = await getHighs(report);
    applyGame(req.input.game);
    let value: SolveResult | Record<string, RecipeMod> | CalcResult;
    if (req.kind === 'model') value = calcModel(highs, req.input.model, req.input.tier);
    else if (req.kind === 'solve') {
      const result = req.input.objective === 'buildings' ? fewestBuildings(highs, req.input) : solve(highs, req.input);
      result.heldByPins = heldByPins(highs, req.input, result);
      value = result;
    } else value = autoAssign(highs, req.input, req.stock, req.all);
    reply = { id: req.id, ok: true, value };
  } catch (e) {
    if (!(e instanceof SolverError)) resetHighs();
    reply = { id: req.id, ok: false, failure: toFailure(e) };
  }
  self.postMessage(reply);
};

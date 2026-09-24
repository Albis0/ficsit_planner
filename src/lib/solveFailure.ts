import type { StringKey } from './lang';
import { SolverError, type SolverErrorCode } from './solver';

/** A failed solve in a form that survives postMessage: the code, plus HiGHS' status when there is one. */
export interface SolveFailure {
  code: SolverErrorCode;
  status?: string;
}

export const toFailure = (e: unknown): SolveFailure =>
  e instanceof SolverError ? { code: e.code, status: e.status } : { code: 'stopped', status: e instanceof Error ? e.message : String(e) };

const KEYS: Record<SolverErrorCode, StringKey> = {
  infeasible: 'errInfeasible',
  pinnedInfeasible: 'errPinnedInfeasible',
  stopped: 'errStopped',
};

export const failureText = (f: SolveFailure, t: (k: StringKey, vars?: Record<string, string>) => string) =>
  t(KEYS[f.code], { status: f.status ?? '' });

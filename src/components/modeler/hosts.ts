import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameRules } from '../../lib/game';
import { calcKey } from '../../lib/model/calc';
import { adaptModel } from '../../lib/model/calc/adapter';
import type { CalcResult } from '../../lib/model/calc/result';
import { emptyModel, type Model } from '../../lib/model/types';
import { calcAsync } from '../../lib/solverClient';
import type { SolveFailure } from '../../lib/solveFailure';
import { useStore } from '../../store';
import type { ModelHost } from './ModelEditor';

const EMPTY = emptyModel();

/** A factory tab as the home of a hand-built model. */
export function useFactoryHost(planId: string): ModelHost {
  const model = useStore((s) => s.plans.find((p) => p.id === planId)?.model) ?? EMPTY;
  const enabled = useStore((s) => s.plans.find((p) => p.id === planId)?.enabled);
  const extraction = useStore((s) => s.plans.find((p) => p.id === planId)?.extraction);
  const caps = useStore((s) => s.plans.find((p) => p.id === planId)?.caps);
  const on = useMemo(() => (enabled ? new Set(enabled) : undefined), [enabled]);
  const editModel = useStore((s) => s.editModel);
  const undoModel = useStore((s) => s.undoModel);
  const redoModel = useStore((s) => s.redoModel);
  return useMemo(
    () => ({
      key: planId,
      model,
      edit: (fn, merge) => editModel(planId, fn, merge),
      undo: () => undoModel(planId),
      redo: () => redoModel(planId),
      on,
      extraction,
      caps,
    }),
    [planId, model, editModel, undoModel, redoModel, on, extraction, caps],
  );
}

/**
 * Works a model out in the worker a moment after it changes, and only when something the numbers depend on changed:
 * dragging a card around doesn't. Keeps the last numbers while the next ones come.
 */
export function useModelCalc(model: Model | undefined, tier: number, game: GameRules, active = true) {
  const [state, setState] = useState<{ calc?: CalcResult; error?: SolveFailure; busy: boolean }>({ busy: false });
  const key = model ? calcKey(model, tier) : '';
  const latest = useRef(model);
  latest.current = model;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the model's numbers; positions don't count.
  useEffect(() => {
    const m = latest.current;
    if (!active || !m) return;
    let cancelled = false;
    setState((s) => ({ ...s, busy: true }));
    const timer = setTimeout(async () => {
      try {
        const calc = await calcAsync({ model: m, tier, game });
        if (!cancelled) setState({ calc, busy: false });
      } catch (e) {
        if (!cancelled) setState({ error: e as SolveFailure, busy: false });
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, active, game]);
  // The totals, list and transport view read the model's numbers in the solver's shape.
  const adapted = useMemo(() => (model ? adaptModel(model, state.calc) : undefined), [model, state.calc]);
  return { ...state, adapted };
}

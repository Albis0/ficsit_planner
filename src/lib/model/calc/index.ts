import type { Highs } from 'highs';
import type { Model } from '../types';
import { basicCalc, read } from './basic';
import { compile } from './compile';
import type { CalcResult } from './result';

/** Works out a hand-built model with the calculator it's set to. */
export function calcModel(highs: Highs, model: Model, tier: number): CalcResult {
  const net = compile(model, tier);
  if (model.calc === 'off')
    return read(
      net,
      () => 0,
      () => 0,
      'off',
    );
  return basicCalc(highs, net);
}

/**
 * The parts of a model the numbers depend on: moving a card, writing a note, bending a belt or ticking "built" changes
 * nothing here, so it doesn't work the model out again.
 */
export function calcKey(model: Model, tier: number): string {
  const nodes = model.nodes.filter((n) => n.k !== 'note' && n.k !== 'group').map(({ x: _x, y: _y, done: _d, label: _l, ...rest }) => rest);
  const links = model.links.map(({ pts: _p, line: _s, ...rest }) => rest);
  return JSON.stringify([model.calc, model.drain ?? false, tier, nodes, links]);
}

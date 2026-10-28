import { describe, expect, test } from 'bun:test';

import { cleanup, render } from '@testing-library/react';
import { Inspector } from '../../src/components/Inspector';
import { data } from '../../src/lib/data';
import { describeUse, NO_MOD, type SolveResult } from '../../src/lib/solver';
import { useStore } from '../../src/store';

const smelter = data.recipes.find((r) => r.id === 'Recipe_IngotIron_C')!;

// One un-clocked iron line of 6.65 machines: spread as 6 at 100% and one at 65% with "full", 7 at 95% without.
const open = (full: boolean, count = 6.65) => {
  useStore.setState({ inspect: smelter.id });
  const result = {
    recipes: [describeUse(smelter, NO_MOD, count, false, full)],
    raw: [],
    supplies: [],
    targets: [],
    surplus: [],
    missing: [],
  } as unknown as SolveResult;
  return render(<Inspector result={result} />);
};

describe('the clock on a line that runs full', () => {
  test('at 100% and one slower the slider and the field are locked at 100', () => {
    const view = open(true);
    const slider = view.container.querySelector('input[type="range"]') as HTMLInputElement;
    const field = view.container.querySelector('input.rate-input') as HTMLInputElement;
    expect(slider.disabled).toBe(true);
    expect(slider.value).toBe('100');
    expect(field.disabled).toBe(true);
    expect(field.value).toBe('100');
    expect(view.getByText('At 100%, one slower')).toBeTruthy();
    cleanup();
  });

  test('machines spread evenly keep a free clock showing the average', () => {
    const view = open(false);
    const slider = view.container.querySelector('input[type="range"]') as HTMLInputElement;
    const field = view.container.querySelector('input.rate-input') as HTMLInputElement;
    expect(slider.disabled).toBe(false);
    expect(field.disabled).toBe(false);
    expect(slider.value).toBe('95');
    expect(view.queryByText('At 100%, one slower')).toBeNull();
    cleanup();
  });

  test('a whole number of machines, all at 100%, keeps a free clock', () => {
    const view = open(true, 6);
    const slider = view.container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider.disabled).toBe(false);
    expect(slider.value).toBe('100');
    expect(view.queryByText('At 100%, one slower')).toBeNull();
    cleanup();
  });
});

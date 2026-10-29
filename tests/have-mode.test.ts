import { describe, expect, test } from 'bun:test';
import { cleanPlan } from '../src/lib/sanitize';
import { haveOff, haveOn, keepScaled, newPlan } from '../src/store';

const IRON = 'Desc_OreIron_C';
const COPPER = 'Desc_OreCopper_C';
const WATER = 'Desc_Water_C';

const plan = () => ({ ...newPlan('A'), targets: [{ item: 'Desc_Motor_C', rate: 10 }] });

describe('I have', () => {
  test('the raw inputs in use go on hand, rounded, water left out; a pin already there stays as it is', () => {
    const raw = [
      { item: IRON, rate: 315.456 },
      { item: COPPER, rate: 90 },
      { item: WATER, rate: 12 },
    ];
    expect(haveOn(raw)(plan())).toEqual({ have: true, fixed: { [IRON]: 315.46, [COPPER]: 90 } });
    expect(haveOn(raw)({ ...plan(), fixed: { [IRON]: 200 } }).fixed).toEqual({ [IRON]: 200, [COPPER]: 90 });
  });

  test('back to I want: the pins and the mode go and the products are the amounts that were typed', () => {
    const on = { ...plan(), have: true as const, fixed: { [IRON]: 100 } };
    const patch = haveOff();
    expect(patch.fixed).toEqual({});
    expect({ ...on, ...patch }.have).toBeUndefined();
    expect({ ...on, ...patch }.targets).toEqual([{ item: 'Desc_Motor_C', rate: 10 }]);
  });

  test('making the scaled amounts the default also ends the mode', () => {
    const on = { ...plan(), have: true as const, fixed: { [IRON]: 100 } };
    const next = { ...on, ...keepScaled([{ item: 'Desc_Motor_C', rate: 6.33333 }])(on) };
    expect(next.targets).toEqual([{ item: 'Desc_Motor_C', rate: 6.333 }]);
    expect(next.fixed).toEqual({});
    expect(next.have).toBeUndefined();
  });

  test('a saved plan keeps the mode only when it is exactly on', () => {
    const base = plan();
    expect(cleanPlan({ ...base, have: true }, base).have).toBe(true);
    expect(cleanPlan({ ...base, have: 'yes' }, base).have).toBeUndefined();
    expect(cleanPlan({ ...base, have: false }, base).have).toBeUndefined();
  });
});

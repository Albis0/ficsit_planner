import { beforeEach, describe, expect, test } from 'bun:test';
import { canRedo, canUndo, autoScope, powerScope, record, undo } from '../src/lib/model/history';
import { activePowerPlan, newPlan, newPowerPlan, useStore } from '../src/store';

const s = () => useStore.getState();
const item = 'Desc_IronPlate_C';

// The store is shared by every test file in the run: each test starts from a blank factory and a blank plant.
beforeEach(() => {
  const plan = newPlan('Factory 1');
  const plant = newPowerPlan('Plant 1');
  useStore.setState({ mode: 'factory', plans: [plan], active: plan.id, power: [plant], activePower: plant.id });
});

describe('undo on the Auto floor', () => {
  test('a target added, changed and removed is undone step by step, and redone', () => {
    s().set({ mode: 'factory' });
    const id = s().active;
    s().addTarget(item);
    expect(canUndo(autoScope(id))).toBe(true);
    s().setTarget(0, 30);
    s().removeTarget(0);
    expect(s().plans[0].targets).toEqual([]);
    s().undoPlan();
    expect(s().plans[0].targets).toEqual([{ item, rate: 30 }]);
    s().undoPlan();
    expect(s().plans[0].targets).toEqual([{ item, rate: 10 }]);
    s().undoPlan();
    expect(s().plans[0].targets).toEqual([]);
    expect(canUndo(autoScope(id))).toBe(false);
    expect(canRedo(autoScope(id))).toBe(true);
    s().redoPlan();
    expect(s().plans[0].targets).toEqual([{ item, rate: 10 }]);
  });

  test('typing a rate in quick steps is one step to undo', () => {
    s().addTarget(item);
    s().setTarget(0, 1);
    s().setTarget(0, 12);
    s().setTarget(0, 120);
    s().undoPlan();
    expect(s().plans[0].targets[0].rate).toBe(10);
  });

  test('the tab keeps its name, and a change that changes nothing is not a step', () => {
    s().renamePlan(s().active, 'Plates');
    s().addTarget(item);
    s().addTarget(item);
    s().undoPlan();
    expect(s().plans[0].name).toBe('Plates');
    expect(s().plans[0].targets).toEqual([]);
    expect(canUndo(autoScope(s().active))).toBe(false);
  });

  test('on a hand-built floor the plan buttons leave things alone: the floor has its own undo', () => {
    const id = s().active;
    s().setFloor(id, 'manual');
    s().addTarget('Desc_Wire_C');
    const targets = s().plans[0].targets;
    s().undoPlan();
    expect(s().plans[0].targets).toBe(targets);
    s().setFloor(id, 'auto');
  });
});

describe('undo on a power plant', () => {
  test('a generator added to the plant on screen goes away with undo, and the factories it feeds stay as they are', () => {
    s().set({ mode: 'power' });
    const pp = activePowerPlan(s());
    s().addPlant('Build_GeneratorCoal_C', 'Desc_Coal_C');
    expect(activePowerPlan(s()).plants).toHaveLength(1);
    expect(canUndo(powerScope(pp.id))).toBe(true);
    s().setPowered(s().plans[0].id, true);
    const fed = activePowerPlan(s()).factories;
    s().undoPlan();
    expect(activePowerPlan(s()).plants).toHaveLength(0);
    expect(activePowerPlan(s()).factories).toEqual(fed);
    s().redoPlan();
    expect(activePowerPlan(s()).plants).toHaveLength(1);
    s().set({ mode: 'factory' });
  });
});

describe('history', () => {
  test('scopes do not mix, and a new edit clears what could be redone', () => {
    record('t:a', { n: 1 });
    record('t:b', { n: 2 });
    expect(undo('t:a', { n: 3 })).toEqual({ n: 1 });
    expect(canRedo('t:a')).toBe(true);
    expect(canUndo('t:a')).toBe(false);
    record('t:a', { n: 4 });
    expect(canRedo('t:a')).toBe(false);
    expect(canUndo('t:b')).toBe(true);
  });
});

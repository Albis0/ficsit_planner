import { describe, expect, test } from 'bun:test';
import { reopen } from '../src/lib/closedTab';
import { newPlan, type Plan } from '../src/store';

const plan = (id: string, name: string, extra: Partial<Plan> = {}): Plan => ({ ...newPlan(name, [], []), id, ...extra });
const tabs = (plans: Plan[], active = plans[0].id) => ({ plans, power: [], active, activePower: '' });

describe('undoing a closed tab', () => {
  test('the tab comes back where it was and what was done since stays', () => {
    const a = plan('a', 'A', { targets: [{ item: 'Desc_Motor_C', rate: 10 }] });
    const b = plan('b', 'B');
    const c = plan('c', 'C');
    const was = tabs([a, b, c]);
    const edited = { ...a, targets: [{ item: 'Desc_Motor_C', rate: 77 }] };
    const back = reopen(was, tabs([edited, c]));
    expect(back.plans.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(back.plans[0].targets[0].rate).toBe(77);
  });

  test('a "comes from" that pointed at the closed tab points at it again', () => {
    const a = plan('a', 'A');
    const b = plan('b', 'B', { supplies: [{ item: 'Desc_IronPlate_C', rate: 5, from: 'a' }] });
    const { from: _, ...loose } = b.supplies[0];
    const back = reopen(tabs([a, b]), tabs([{ ...b, supplies: [loose] }], 'b'));
    expect(back.plans.map((p) => p.id)).toEqual(['a', 'b']);
    expect(back.plans[1].supplies[0].from).toBe('a');
  });

  test('closing the last tab left a blank one, which makes way', () => {
    const a = plan('a', 'A', { targets: [{ item: 'Desc_Motor_C', rate: 10 }] });
    const back = reopen(tabs([a]), tabs([plan('blank', 'Factory 1')], 'blank'));
    expect(back.plans.map((p) => p.id)).toEqual(['a']);
    expect(back.active).toBe('a');
  });

  test('a blank tab the player has since filled stays', () => {
    const a = plan('a', 'A', { targets: [{ item: 'Desc_Motor_C', rate: 10 }] });
    const filled = plan('blank', 'Factory 1', { targets: [{ item: 'Desc_Cable_C', rate: 30 }] });
    const back = reopen(tabs([a]), tabs([filled], 'blank'));
    expect(back.plans.map((p) => p.id)).toEqual(['a', 'blank']);
  });
});

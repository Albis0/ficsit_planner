import { describe, expect, test } from 'bun:test';
import { type FactoryRow, type PlantRow, sumItems, totalsOf } from '../src/lib/overview';

const factory = (patch: Partial<FactoryRow>): FactoryRow => ({
  id: 'f',
  name: 'F',
  manual: false,
  empty: false,
  pending: false,
  failed: false,
  makes: [],
  raw: [],
  brings: [],
  surplus: [],
  mw: 0,
  machines: 0,
  extractors: 0,
  ...patch,
});
const plant = (patch: Partial<PlantRow>): PlantRow => ({
  id: 'p',
  name: 'P',
  empty: false,
  pending: false,
  failed: false,
  made: 0,
  own: 0,
  surplus: [],
  ...patch,
});

describe('the All page', () => {
  test('items are added up per item, the largest first', () => {
    const list = sumItems([
      [
        { item: 'a', rate: 5 },
        { item: 'b', rate: 20 },
      ],
      [
        { item: 'a', rate: 30 },
        { item: 'c', rate: 0 },
      ],
    ]);
    expect(list).toEqual([
      { item: 'a', rate: 35 },
      { item: 'b', rate: 20 },
    ]);
  });

  test('power left over is what the plants make, less their own chains and the factories', () => {
    const t = totalsOf(
      [factory({ mw: 300, machines: 5, extractors: 2 }), factory({ mw: 150, machines: 3, extractors: 1 })],
      [plant({ made: 600, own: 50 }), plant({ made: 200 })],
    );
    expect(t.used).toBe(450);
    expect(t.made).toBe(800);
    expect(t.own).toBe(50);
    expect(t.spare).toBe(300);
    expect(t.machines).toBe(8);
    expect(t.extractors).toBe(3);
  });

  test('a grid that falls short shows it as a negative spare, and with no plants everything is short', () => {
    expect(totalsOf([factory({ mw: 500 })], [plant({ made: 300 })]).spare).toBe(-200);
    expect(totalsOf([factory({ mw: 500 })], []).spare).toBe(-500);
  });

  test('what factories and plants leave over is pooled per item', () => {
    const t = totalsOf(
      [factory({ surplus: [{ item: 'HOR', rate: 10 }] }), factory({ surplus: [{ item: 'HOR', rate: 5 }] })],
      [plant({ surplus: [{ item: 'Waste', rate: 2 }] })],
    );
    expect(t.surplus).toEqual([
      { item: 'HOR', rate: 15 },
      { item: 'Waste', rate: 2 },
    ]);
  });
});

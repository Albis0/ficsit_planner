import { describe, expect, test } from 'bun:test';
import { data } from '../src/lib/data';
import { capacity, carRate, carriersFor, haul } from '../src/lib/transport';

const item = (id: string) => data.items[id];

describe('freight cars, against the wiki (Tutorial:Train throughput)', () => {
  // Two Mk.6 belts feed 2,400 a minute; the round trip is exactly the time to fill.
  const fill = (hold: number, feed: number) => (hold / feed) * 60 + 27.08;
  test.each([
    [50, 1431.17],
    [100, 1793.08],
    [200, 2052.62],
    [500, 2247.83],
  ])('stacks of %i: %d a minute at most', (stack, expected) => {
    const hold = 32 * stack;
    expect(carRate(hold, 2400, fill(hold, 2400))).toBeCloseTo(expected, 0);
  });

  test('fluid car on two Mk.2 pipes: 979 m³ a minute', () => {
    expect(carRate(2400, 1200, fill(2400, 1200))).toBeCloseTo(979.06, 1);
  });

  test('quickwire on two Mk.4 belts, five minutes round trip: 14.56 a second', () => {
    expect(carRate(32 * 500, 960, 300) / 60).toBeCloseTo(14.56, 2);
  });
});

describe('capacities', () => {
  test('freight car: 32 stacks, or 2,400 m³', () => {
    expect(capacity('train', item('Desc_IronPlate_C'))).toBe(32 * 200);
    expect(capacity('train', item('Desc_LiquidOil_C'))).toBe(2400);
  });
  test('truck 48, tractor 25, explorer 12, drone 9 stacks; fluid truck 3,200 m³', () => {
    const ore = item('Desc_OreIron_C');
    expect(capacity('truck', ore)).toBe(48 * 100);
    expect(capacity('tractor', ore)).toBe(25 * 100);
    expect(capacity('explorer', ore)).toBe(12 * 100);
    expect(capacity('drone', ore)).toBe(9 * 100);
    expect(capacity('fluidTruck', item('Desc_Water_C'))).toBe(3200);
  });
});

describe('what can carry what', () => {
  test('fluids go by pipe, train or fluid truck; never by drone', () => {
    expect(carriersFor(item('Desc_LiquidOil_C'))).toEqual(['line', 'train', 'fluidTruck']);
  });
  test('solids by belt, train, truck, tractor, explorer or drone', () => {
    expect(carriersFor(item('Desc_Coal_C'))).toEqual(['line', 'train', 'truck', 'tractor', 'explorer', 'drone']);
  });
  test('the tier decides: tractors at tier 3, trucks at 5, trains at 6, drones at 8', () => {
    const coal = item('Desc_Coal_C');
    expect(carriersFor(coal, 2)).toEqual(['line']);
    expect(carriersFor(coal, 3)).toEqual(['line', 'tractor']);
    expect(carriersFor(coal, 5)).toEqual(['line', 'truck', 'tractor']);
    expect(carriersFor(coal, 8)).toContain('drone');
  });
});

describe('hauls', () => {
  test('drone, 1 km: 6 batteries a trip (24,000 MJ + 6 MJ a metre there and back, 6,000 MJ a battery)', () => {
    const h = haul(item('Desc_Coal_C'), 100, 'drone', 1000);
    expect(h.batteries?.perTrip).toBeCloseTo(6);
    expect(h.roundTrip).toBeCloseTo(102 + 2000 / 75);
  });

  test('a belt needs no vehicles, and several lanes past the fastest belt', () => {
    const h = haul(item('Desc_OreIron_C'), 1500, 'line', 0, 9);
    expect(h.line?.lanes).toBe(2);
    expect(h.vehicles).toBe(0);
  });

  test('coal by train, 2 km: enough cars, a locomotive per four, a platform per car at each end', () => {
    const h = haul(item('Desc_Coal_C'), 1200, 'train', 2000);
    expect(h.vehicles).toBeGreaterThan(0);
    expect(h.vehicles * (h.perVehicle ?? 0)).toBeGreaterThanOrEqual(1200);
    expect(h.locomotives).toBe(Math.ceil(h.vehicles / 4));
    expect(h.stations.find((x) => x.station.id === 'Build_TrainDockingStation_C')?.count).toBe(2 * h.vehicles);
    expect(h.estimate).toBe(true);
  });

  test('trucks: further means more of them', () => {
    const near = haul(item('Desc_OreIron_C'), 2000, 'truck', 500);
    const far = haul(item('Desc_OreIron_C'), 2000, 'truck', 5000);
    expect(far.vehicles).toBeGreaterThan(near.vehicles);
    expect(far.fuel ?? 0).toBeGreaterThan(near.fuel ?? 0);
  });
});

describe('routes are saved with the factory', () => {
  const { cleanPlan } = require('../src/lib/sanitize');
  const { newPlan, mergeState, persisted, useStore } = require('../src/store');
  const { pack, unpack } = require('../src/lib/share');

  test('known items and carriers stay, distances are kept between 0 and 100 km, anything else goes', () => {
    const p = cleanPlan(
      {
        transport: {
          'in:Desc_OreIron_C': { by: 'train', distance: 2000 },
          'out:Desc_Motor_C': { by: 'drone', distance: 1e9 },
          'in:Desc_Coal_C': { by: 'rocket', distance: 10 },
          'sideways:Desc_Coal_C': { by: 'truck', distance: 10 },
          'in:Nope_C': { by: 'truck', distance: 10 },
          'out:Desc_Rotor_C': { by: 'truck', distance: 'far' },
        },
      },
      newPlan('Factory 1'),
    );
    expect(p.transport).toEqual({
      'in:Desc_OreIron_C': { by: 'train', distance: 2000 },
      'out:Desc_Motor_C': { by: 'drone', distance: 100000 },
      'out:Desc_Rotor_C': { by: 'truck', distance: 1000 },
    });
  });

  test('a plan without routes has no transport key at all, so older saves read back as they were', () => {
    expect('transport' in cleanPlan({}, newPlan('Factory 1'))).toBe(false);
  });

  test('routes survive a reload and a shared link', () => {
    const plan = { ...newPlan('Iron'), transport: { 'in:Desc_OreIron_C': { by: 'train', distance: 2500 } } };
    const state = persisted(mergeState({ plans: [plan], active: plan.id }, useStore.getState()));
    const back = mergeState(JSON.parse(JSON.stringify(state)), useStore.getState());
    expect(back.plans[0].transport).toEqual(plan.transport);
    expect(cleanPlan(unpack(JSON.parse(JSON.stringify(pack(plan)))), newPlan('x')).transport).toEqual(plan.transport);
  });

  test('the transport view is a view a save can name', () => {
    expect(mergeState({ view: 'transport' }, useStore.getState()).view).toBe('transport');
    expect(mergeState({ view: 'sideways' }, useStore.getState()).view).not.toBe('sideways');
  });
});

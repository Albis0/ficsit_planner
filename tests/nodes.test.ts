import { describe, expect, test } from 'bun:test';
import { DEFAULT_EXTRACTION, planExtraction } from '../src/lib/extraction';
import { cleanPlan } from '../src/lib/sanitize';
import { newPlan } from '../src/store';

const iron = (rate: number, nodes?: Record<string, number>) =>
  planExtraction([{ item: 'Desc_OreIron_C', rate }], { ...DEFAULT_EXTRACTION, ...(nodes ? { nodes: { Desc_OreIron_C: nodes } } : {}) })[0];

describe('your own nodes', () => {
  test('without nodes, every extractor sits on the chosen purity', () => {
    // Miner Mk.2 gives 120/min on a normal node.
    expect(iron(240).built).toBe(2);
    expect(iron(240).onNodes).toBeUndefined();
  });

  test('extractors go on the best nodes first, one each', () => {
    // 300/min with one pure (240) and one impure (60) node: both, at 100%.
    const u = iron(300, { pure: 1, impure: 1 });
    expect(u.onNodes?.placed).toEqual({ impure: 1, normal: 0, pure: 1 });
    expect(u.onNodes?.extra).toBe(0);
    expect(u.clock).toBeCloseTo(1);
  });

  test('a pure node alone is enough when it covers the rate, and runs slower', () => {
    const u = iron(120, { pure: 1, impure: 1 });
    expect(u.onNodes?.placed).toEqual({ impure: 0, normal: 0, pure: 1 });
    expect(u.clock).toBeCloseTo(0.5);
  });

  test('what the nodes cannot give is counted on more nodes of the chosen purity', () => {
    const u = iron(500, { pure: 1, impure: 1 });
    // 240 + 60 from the nodes, 200 more on normal nodes: 2 extra.
    expect(u.onNodes?.extra).toBe(2);
    expect(u.built).toBe(4);
  });

  test('saved nodes are cleaned: whole counts, raw resources only', () => {
    const p = cleanPlan(
      { extraction: { nodes: { Desc_OreIron_C: { pure: 1.7, impure: -2 }, Desc_IronPlate_C: { pure: 1 }, Desc_Coal_C: {} } } },
      newPlan('Factory 1'),
    );
    expect(p.extraction.nodes).toEqual({ Desc_OreIron_C: { pure: 1 } });
  });
});

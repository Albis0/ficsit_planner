import { beforeAll, describe, expect, test } from 'bun:test';
import loadHighs, { type Highs } from 'highs';
import { calcModel } from '../src/lib/model/calc';
import { cleanModel } from '../src/lib/model/sanitize';
import { type MLink, type MNode, type Model, MODEL_VERSION } from '../src/lib/model/types';

/**
 * A big hand-built floor has to stay quick: working out 3000 cards must not freeze the page again (a number changed in a
 * 3000-card factory once froze it for about two seconds). The limits are several times what a plain run takes, so a
 * busy computer does not fail them but a slowdown of a whole order does.
 */

let highs: Highs;
beforeAll(async () => {
  highs = await loadHighs();
});

const at = { x: 0, y: 0 };

/** `lines` copies of: iron miner → smelter → output, so 3 × lines cards and 2 × lines belts. */
function bigFloor(lines: number): Model {
  const nodes: MNode[] = [];
  const links: MLink[] = [];
  for (let i = 0; i < lines; i++) {
    nodes.push(
      { id: `m${i}`, ...at, k: 'extract', extractor: 'Build_MinerMk2_C', item: 'Desc_OreIron_C', n: 1 },
      { id: `s${i}`, ...at, k: 'machine', recipe: 'Recipe_IngotIron_C', n: 1 },
      { id: `o${i}`, ...at, k: 'out' },
    );
    links.push({ id: `a${i}`, a: `m${i}`, ap: 0, b: `s${i}`, bp: 0 }, { id: `b${i}`, a: `s${i}`, ap: 0, b: `o${i}`, bp: 0 });
  }
  return { v: MODEL_VERSION, calc: 'basic', nodes, links, seq: nodes.length + 1 };
}

const timed = <T>(run: () => T) => {
  const t = performance.now();
  const value = run();
  return { value, ms: performance.now() - t };
};

describe('a big floor stays quick', () => {
  const floor = bigFloor(1000);

  test('the floor is 3000 cards and survives cleaning whole', () => {
    expect(floor.nodes).toHaveLength(3000);
    expect(cleanModel(floor)?.nodes).toHaveLength(3000);
  });

  test('working out 3000 cards takes under 3 seconds', () => {
    const { value, ms } = timed(() => calcModel(highs, floor, 9));
    expect(Object.keys(value.nodes)).toHaveLength(3000);
    expect(ms).toBeLessThan(3000);
  }, 20000);

  test('cleaning 3000 cards takes under 1 second', () => {
    expect(timed(() => cleanModel(floor)).ms).toBeLessThan(1000);
  });
});

import { useMemo } from 'react';
import { data, type Cost } from '../lib/data';
import type { ExtractionUse } from '../lib/extraction';
import { useT } from '../lib/i18n';
import { recipeLabel } from '../lib/text';
import type { SolveResult, Target } from '../lib/solver';
import { useStore } from '../store';
import { groupClocks } from '../lib/clocks';
import { Icon } from './Icon';
import { Slot } from './Slot';

/** Buildings to place and the parts they cost, summed across the whole plan. */
function buildBill(result: SolveResult, extraction: ExtractionUse[]) {
  const buildings = new Map<string, number>();
  const add = (id: string, n: number) => buildings.set(id, (buildings.get(id) ?? 0) + n);
  for (const u of result.recipes) add(u.recipe.machine, u.built);
  for (const e of extraction) add(e.extractor.id, e.built);

  const parts = new Map<string, number>();
  for (const [id, n] of buildings) {
    const cost: Cost[] = data.machines[id]?.cost ?? data.extractors.find((e) => e.id === id)?.cost ?? [];
    for (const c of cost) parts.set(c.item, (parts.get(c.item) ?? 0) + c.amount * n);
  }
  return {
    buildings: [...buildings].sort((a, b) => b[1] - a[1]),
    parts: [...parts].filter(([id]) => data.items[id]).sort((a, b) => b[1] - a[1]),
  };
}

export function TableView({ result, extraction }: { result: SolveResult; extraction: ExtractionUse[] }) {
  const { t, name, num } = useT();
  const inspect = useStore((s) => s.inspect);
  const set = useStore((s) => s.set);
  const bill = useMemo(() => buildBill(result, extraction), [result, extraction]);

  const flows = (list: Target[]) =>
    list.map((s) => (
      <div key={s.item} className="flow">
        <Icon id={s.item} size={30} />
        <b>{num(s.rate)}</b> {name(data.items[s.item])}
      </div>
    ));

  return (
    <div className="table-wrap">
      <table className="plan-table">
        <thead>
          <tr>
            <th>{t('recipe')}</th>
            <th>{t('building')}</th>
            <th className="n">{t('count')}</th>
            <th className="n">{t('clock')}</th>
            <th className="n">{t('power')}</th>
            <th>{t('inputs')}</th>
            <th>{t('outputs')}</th>
          </tr>
        </thead>
        <tbody>
          {result.recipes.map((u) => (
            <tr
              key={u.recipe.id}
              className={`${u.recipe.kind} ${inspect === u.recipe.id ? 'selected' : ''}`}
              onClick={() => set({ inspect: u.recipe.id })}
            >
              <td>
                {recipeLabel(name(u.recipe), u.recipe.kind)}
                {u.recipe.kind !== 'standard' && <span className={`kind ${u.recipe.kind}`}>{t(u.recipe.kind)}</span>}
              </td>
              <td className="dim">
                <span className="flow">
                  <Icon id={u.recipe.machine} size={34} />
                  {name(data.machines[u.recipe.machine])}
                </span>
              </td>
              <td className="n strong">{u.built}</td>
              <td className="n">
                {groupClocks(u.clocks)
                  .map((g) => (groupClocks(u.clocks).length > 1 ? `${g.n}× ` : '') + `${num(g.clock * 100)}%`)
                  .join(', ')}
                {u.shards > 0 && <span className="mod-badge shard">{u.shards} ◆</span>}
                {u.sloops > 0 && <span className="mod-badge sloop">{u.sloops} ●</span>}
              </td>
              <td className="n">{num(u.power)} MW</td>
              <td>{flows(u.inputs)}</td>
              <td>{flows(u.outputs)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="bill">
        <h3 className="section-title">{t('buildCost')}</h3>
        <p className="hint">{t('buildCostHint')}</p>
        <div className="bill-grid">
          <div>
            <span className="control-label">{t('buildings')}</span>
            <div className="slots">
              {bill.buildings.map(([id, n]) => (
                <Slot key={id} id={id} rate={n} size={64} />
              ))}
            </div>
          </div>
          <div>
            <span className="control-label">{t('parts')}</span>
            <div className="slots">
              {bill.parts.map(([id, n]) => (
                <Slot key={id} id={id} rate={n} size={64} />
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

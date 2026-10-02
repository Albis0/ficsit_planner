import { Fragment, useMemo, useState } from 'react';
import { buildingById, data } from '../lib/data';
import type { ExtractionUse } from '../lib/extraction';
import { useT } from '../lib/i18n';
import { plantIdOf } from '../lib/power';
import { recipeLabel } from '../lib/text';
import type { RecipeUse, SolveResult } from '../lib/solver';
import { useStore } from '../store';
import { groupClocks } from '../lib/clocks';
import { buildGroups, groupsLabel, isPipe } from '../lib/groups';
import { matchFlows, splitByDestination } from '../lib/split';
import { Icon } from './Icon';
import { Slot } from './Slot';
import { useSplitText } from './SplitText';

/** Buildings to place and the parts they cost, summed across the whole plan. */
function buildBill(result: SolveResult, extraction: ExtractionUse[]) {
  const buildings = new Map<string, number>();
  const add = (id: string, n: number) => buildings.set(id, (buildings.get(id) ?? 0) + n);
  for (const u of result.recipes) add(u.recipe.machine, u.built);
  for (const e of extraction) add(e.extractor.id, e.built);

  const parts = new Map<string, number>();
  for (const [id, n] of buildings) {
    const cost = buildingById(id)?.cost ?? [];
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
  const tier = useStore((s) => s.tier);
  const set = useStore((s) => s.set);
  const generated = result.grid?.plants ?? {};
  const bill = useMemo(() => buildBill(result, extraction), [result, extraction]);
  const splits = useMemo(() => {
    const flows = matchFlows(result);
    return new Map(result.recipes.map((u) => [u.recipe.id, splitByDestination(u, flows, tier)]));
  }, [result, tier]);
  const words = useSplitText();

  // What the pointer is on, else the selected line: its inputs light up where other lines make them, and its
  // outputs where other lines take them. Pointing at one item lights that item everywhere.
  const [hover, setHover] = useState<{ row?: string; item?: string }>({});
  const focus = result.recipes.find((u) => u.recipe.id === (hover.row ?? inspect));
  const needs = new Set(focus?.inputs.map((x) => x.item));
  const gives = new Set(focus?.outputs.map((x) => x.item));
  const mark = (u: RecipeUse, item: string, side: 'in' | 'out') => {
    if (hover.item) return item === hover.item ? 'link' : '';
    if (!focus) return '';
    if (u === focus) return 'link';
    if (side === 'out' && needs.has(item)) return 'feeds';
    if (side === 'in' && gives.has(item)) return 'takes';
    return '';
  };
  const rowMark = (u: RecipeUse) => {
    if (u === focus && !hover.item) return '';
    const hits = (side: 'in' | 'out') => (side === 'in' ? u.inputs : u.outputs).map((x) => mark(u, x.item, side)).filter(Boolean);
    const all = [...hits('in'), ...hits('out')];
    return all.includes('feeds') ? 'feeds' : all.includes('takes') ? 'takes' : all.includes('link') ? 'link' : '';
  };

  const flows = (u: RecipeUse, side: 'in' | 'out') =>
    (side === 'in' ? u.inputs : u.outputs).map((s) => (
      <div
        key={s.item}
        className={`flow ${mark(u, s.item, side)}`}
        onPointerEnter={() => setHover((h) => ({ ...h, item: s.item }))}
        onPointerLeave={() => setHover((h) => ({ ...h, item: undefined }))}
      >
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
          {result.recipes.map((u) => {
            const split = splits.get(u.recipe.id);
            return (
              <Fragment key={u.recipe.id}>
                <tr
                  className={`${u.recipe.kind} ${inspect === u.recipe.id ? 'selected' : ''} ${rowMark(u)}`}
                  onClick={() => set({ inspect: u.recipe.id })}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && setHover({ row: u.recipe.id })}
                  onPointerLeave={() => setHover({})}
                >
                  <td className="recipe-cell">
                    {recipeLabel(name(u.recipe), u.recipe.kind)}
                    {u.recipe.kind !== 'standard' && <span className={`kind ${u.recipe.kind}`}>{t(u.recipe.kind)}</span>}
                  </td>
                  <td className="dim" data-label={t('building')}>
                    <span className="flow">
                      <Icon id={u.recipe.machine} size={34} />
                      {name(buildingById(u.recipe.machine))}
                    </span>
                  </td>
                  <td className="n strong" data-label={t('count')}>
                    {u.built}
                    <TableGroups use={u} tier={tier} />
                    {split && split.extra > 0 && <span className="table-groups">{t('splitExtraShort', { n: split.extra })}</span>}
                  </td>
                  <td className="n clocks" data-label={t('clock')}>
                    {groupClocks(u.clocks)
                      .map((g) => `${groupClocks(u.clocks).length > 1 ? `${g.n}× ` : ''}${num(g.clock * 100)}%`)
                      .join(', ')}
                    {u.shards > 0 && <span className="mod-badge shard">{u.shards} ◆</span>}
                    {u.sloops > 0 && <span className="mod-badge sloop">{u.sloops} ●</span>}
                  </td>
                  <td className={`n ${u.recipe.kind === 'power' ? 'made' : ''}`} data-label={t('power')}>
                    {u.recipe.kind === 'power' ? `+${num(generated[plantIdOf(u.recipe.id) ?? ''] ?? 0)}` : num(u.power)} MW
                  </td>
                  <td data-label={t('inputs')}>{flows(u, 'in')}</td>
                  <td data-label={t('outputs')}>{flows(u, 'out')}</td>
                </tr>
                {split?.groups.map((g) => (
                  <tr
                    key={g.to.map((d) => (d.kind === 'recipe' ? d.recipe.id : d.kind)).join()}
                    className={`split-row ${inspect === u.recipe.id ? 'selected' : ''}`}
                    title={words.extra(split)}
                    onClick={() => set({ inspect: u.recipe.id })}
                  >
                    <td className="recipe-cell">{t('splitTo', { to: words.where(g.to) })}</td>
                    <td className="dim" data-label={t('building')} />
                    <td className="n" data-label={t('count')}>
                      {g.use.built}
                      {g.groups && <span className="table-groups">{t('groupsShort', { sizes: groupsLabel(g.groups.sizes) })}</span>}
                    </td>
                    <td className="n clocks" data-label={t('clock')}>
                      {groupClocks(g.use.clocks)
                        .map((c) => `${groupClocks(g.use.clocks).length > 1 ? `${c.n}× ` : ''}${num(c.clock * 100)}%`)
                        .join(', ')}
                    </td>
                    <td className="n" data-label={t('power')}>
                      {num(g.use.power)} MW
                    </td>
                    <td data-label={t('inputs')}>{flows(g.use, 'in')}</td>
                    <td data-label={t('outputs')}>{flows(g.use, 'out')}</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
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

/** Under the machine count: "6 + 4 groups" when one belt or pipe can't serve the whole line. */
function TableGroups({ use, tier }: { use: RecipeUse; tier: number }) {
  const { t, name, num } = useT();
  const g = buildGroups(use, tier);
  if (!g) return null;
  const transport = t(isPipe(g.transport) ? 'pipeName' : 'beltName', { mk: g.transport.name });
  return (
    <span className="table-groups" title={t('groupsWhy', { rate: num(g.rate), item: name(data.items[g.item]), transport })}>
      {t('groupsShort', { sizes: groupsLabel(g.sizes) })}
    </span>
  );
}

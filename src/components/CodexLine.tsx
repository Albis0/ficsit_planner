import type { ReactNode } from 'react';
import { type CodexIndex, nameOf } from '../lib/codex';
import { data, recipeById } from '../lib/data';
import { useT } from '../lib/i18n';
import type { ItemInsight, Line } from '../lib/insights';
import type { Target } from '../lib/solver';
import { recipeLabel } from '../lib/text';
import { CodexLink } from './Codex';
import { Icon } from './Icon';

const fluid = (item: string) => data.items[item]?.form !== 'solid';

/** A figure in a box: raw resources, buildings, power. */
export function Readout({ label, value, tone }: { label: string; value: ReactNode; tone?: 'power' | 'good' }) {
  return (
    <div className={`codex-readout${tone ? ` ${tone}` : ''}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

/** Items with their rates in a row of small icons, each linking to its page. `total`: plain amounts, not per minute. */
export function Flows({ list, index, total }: { list: Target[]; index: CodexIndex; total?: boolean }) {
  const { t, num } = useT();
  return (
    <span className="codex-flows">
      {list.map((x) => (
        <CodexLink key={x.item} page={{ kind: 'item', id: x.item }} className="codex-flow" title={nameOf(x.item, index.data)}>
          <Icon id={x.item} size={24} />
          <span>
            {num(x.rate)}
            {!total && <small>{fluid(x.item) ? t('m3PerMin') : t('perMin')}</small>}
          </span>
        </CodexLink>
      ))}
    </span>
  );
}

/** Raw resources, water last since it costs nothing. */
export const rawOrder = (list: Target[]) =>
  [...list].sort((a, b) => Number(a.item === 'Desc_Water_C') - Number(b.item === 'Desc_Water_C') || b.rate - a.rate);

/**
 * Everything behind one building of the part's recipe: the raw resources, the buildings of each step
 * and the power, worked out with the planner.
 */
export function ProductionLine({ id, insight, index }: { id: string; insight: ItemInsight; index: CodexIndex }) {
  const { t, num } = useT();
  const { line } = insight;
  const recipe = recipeById.get(insight.recipe)!;
  const unit = fluid(id) ? t('m3PerMin') : t('perMin');
  return (
    <>
      <p className="codex-text">
        {t('lineIntro', {
          building: nameOf(recipe.machine, index.data),
          rate: `${num(line.rate)}${unit}`,
        })}
      </p>
      <div className="codex-readouts">
        <Readout label={t('lineRaw')} value={`${num(line.rawTotal)}${t('perMin')}`} tone="good" />
        <Readout label={t('lineBuildings')} value={num(line.buildings)} />
        <Readout label={t('linePower')} value={`${num(line.power)} ${t('mw')}`} tone="power" />
      </div>
      {line.raw.length > 0 && (
        <div className="codex-line-row">
          <span className="codex-line-label">{t('lineRawList')}</span>
          <Flows list={rawOrder(line.raw)} index={index} />
        </div>
      )}
      {line.missing.length > 0 && (
        <div className="codex-line-row">
          <span className="codex-line-label">{t('lineMissing')}</span>
          <Flows list={line.missing} index={index} />
        </div>
      )}
      {line.surplus.length > 0 && (
        <div className="codex-line-row">
          <span className="codex-line-label">{t('lineSurplus')}</span>
          <Flows list={line.surplus} index={index} />
        </div>
      )}
      <div className="codex-table-wrap">
        <table className="codex-table codex-steps">
          <thead>
            <tr>
              <th>{t('lineStep')}</th>
              <th>{t('building')}</th>
              <th className="num">{t('lineCount')}</th>
            </tr>
          </thead>
          <tbody>
            {line.steps.map(([rid, count]) => {
              const r = recipeById.get(rid);
              if (!r) return null;
              return (
                <tr key={rid}>
                  <td>
                    <CodexLink page={{ kind: 'item', id: r.outputs[0].item }} className="codex-machine">
                      <Icon id={r.outputs[0].item} size={24} />
                      {recipeLabel(r.name, r.kind)}
                    </CodexLink>
                    {r.kind === 'alternate' && <span className="codex-pill alt">{t('altShort')}</span>}
                  </td>
                  <td>
                    <CodexLink page={{ kind: 'building', id: r.machine }} className="codex-machine">
                      <Icon id={r.machine} size={24} />
                      {nameOf(r.machine, index.data)}
                    </CodexLink>
                  </td>
                  <td className="num">{num(count)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">{t('lineNote')}</p>
    </>
  );
}

/** "−35%" or "+12%": the change against the standard recipe's line, green when it saves. */
export function Delta({ share, lowerIsBetter = true }: { share: number; lowerIsBetter?: boolean }) {
  if (!Number.isFinite(share)) return null;
  if (Math.abs(share) < 0.005) return <span className="codex-delta">±0%</span>;
  const good = lowerIsBetter ? share < 0 : share > 0;
  return (
    <span className={`codex-delta ${good ? 'good' : 'bad'}`}>
      {share > 0 ? '+' : '−'}
      {Math.round(Math.abs(share) * 100)}%
    </span>
  );
}

/**
 * Every recipe for the part side by side, each with its whole line: which one needs the fewest raw
 * resources, the least power, the fewest buildings.
 */
export function RecipeCompare({ insight, index, only }: { insight: ItemInsight; index: CodexIndex; only?: string[] }) {
  const { t, num } = useT();
  const base = insight.compare.find((c) => c.recipe === insight.recipe);
  const rows = insight.compare
    .filter((c) => !only || only.includes(c.recipe))
    .sort((a, b) => Number(b.recipe === insight.recipe) - Number(a.recipe === insight.recipe) || a.rawTotal - b.rawTotal);
  const complete = rows.filter((c) => c.missing.length === 0);
  const best = (f: (l: Line) => number) => (complete.length > 1 ? Math.min(...complete.map(f)) : undefined);
  const bestRaw = best((l) => l.rawTotal);
  const bestPower = best((l) => l.power);
  const bestBuildings = best((l) => l.buildings);
  const baseStandard = base && recipeById.get(base.recipe)?.kind === 'standard';
  return (
    <div className="codex-table-wrap">
      <table className="codex-table codex-compare">
        <thead>
          <tr>
            <th>{t('recipe')}</th>
            <th>{t('lineRawList')}</th>
            <th className="num">{t('lineRaw')}</th>
            <th className="num">{t('linePower')}</th>
            <th className="num">{t('lineBuildings')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const r = recipeById.get(c.recipe)!;
            // A share needs a whole line on both sides: nothing brought in, and something to divide by.
            const vs = baseStandard && base && c !== base && c.missing.length === 0 && base.missing.length === 0;
            const mark = (value: number, top: number | undefined) =>
              top !== undefined && c.missing.length === 0 && value <= top + 1e-6 ? 'best' : undefined;
            return (
              <tr key={c.recipe}>
                <td>
                  <span className="codex-compare-name">
                    {recipeLabel(r.name, r.kind)}
                    {r.kind === 'alternate' ? (
                      <span className="codex-pill alt">{t('altShort')}</span>
                    ) : (
                      <span className="codex-pill">{t('standardShort')}</span>
                    )}
                  </span>
                  {c.missing.length > 0 && (
                    <span className="codex-compare-note">
                      {t('needsBroughtIn', { list: c.missing.map((m) => nameOf(m.item, index.data)).join(', ') })}
                    </span>
                  )}
                </td>
                <td>
                  <Flows list={rawOrder(c.raw)} index={index} />
                </td>
                <td className={`num ${mark(c.rawTotal, bestRaw) ?? ''}`}>
                  {num(c.rawTotal)}
                  {vs && <Delta share={c.rawTotal / base.rawTotal - 1} />}
                </td>
                <td className={`num ${mark(c.power, bestPower) ?? ''}`}>
                  {num(c.power)}
                  {vs && <Delta share={c.power / base.power - 1} />}
                </td>
                <td className={`num ${mark(c.buildings, bestBuildings) ?? ''}`}>
                  {num(c.buildings)}
                  {vs && <Delta share={c.buildings / base.buildings - 1} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

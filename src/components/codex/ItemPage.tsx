import type { ReactNode } from 'react';
import { type CodexIndex, nameOf, pageKey, partSource, recipesFor, schematicIcon } from '../../lib/codex';
import { data } from '../../lib/data';
import { PURITIES, PURITY } from '../../lib/extraction';
import { layerOfItem } from '../../lib/finds';
import { useT } from '../../lib/i18n';
import { fuelRate } from '../../lib/power';
import { recipeLabel } from '../../lib/text';
import { useStore } from '../../store';
import { ITEM_NOTES } from '../../locales/codex-notes.en';
import { elevatorAmount } from '../../lib/game';
import { ProductionLine, RecipeCompare } from '../CodexLine';
import { Glyph } from '../Glyph';
import { onMapAny, openMapOn } from '../MapNav';
import { Icon } from '../Icon';
import { CodexLink } from './route';
import { Amount, Amounts, ColorChip, Head, Notes, RecipeCard, Section, UnlockLine, schematicWhere } from './parts';
import { phaseOpens } from './parts';

export function ItemPage({ id, index }: { id: string; index: CodexIndex }) {
  const { t, num } = useT();
  const buildFactory = useStore((s) => s.buildFactory);
  const buildPlant = useStore((s) => s.buildPlant);
  const game = useStore((s) => s.settings.game);
  const it = index.data.items[id];
  if (!it) return <p className="hint">{t('codexMissing')}</p>;
  const planned = data.items[id];
  const recipes = recipesFor(id);
  const uses = (index.usedIn.get(id) ?? []).filter((r) => r.kind !== 'power');
  const burners = data.generators.filter((g) => g.fuels.some((f) => f.item === id));
  const built = index.builtWith.get(id) ?? [];
  const paid = index.paidWith.get(id) ?? [];
  const sold = index.soldAs.get(id) ?? [];
  const crafts = index.data.crafts[id] ?? [];
  const extractors =
    it.kind === 'resource' ? data.extractors.filter((e) => (e.resources.length ? e.resources.includes(id) : it.form === 'solid')) : [];
  const source = partSource(id, index);
  const fluidUnit = it.form !== 'solid';
  const stats: [string, ReactNode][] = [];
  if (source) stats.push('tier' in source ? [t('statTier'), source.tier] : [t('statResearch'), source.mam]);
  if (it.stack) stats.push([t('statStack'), num(it.stack)]);
  if (it.sink) stats.push([t('statSink'), `${num(it.sink)} ${t('pointsShort')}`]);
  if (fluidUnit && planned?.color) stats.push([t('statColor'), <ColorChip key="color" hex={planned.color} />]);
  if (it.energy) stats.push([t('statEnergy'), `${num(it.energy)} MJ`]);
  if (it.radioactive) stats.push([t('statRadioactive'), t('yes')]);
  const find = layerOfItem(id);
  if (find) stats.push([t('statInWorld'), num(index.data.counts[find])]);
  const leftBy = index.data.creatures.filter((c) => c.drop === id);
  if (it.kind === 'resource' && data.worldLimits[id] !== undefined)
    stats.push([t('statWorld'), data.worldLimits[id] === null ? t('unlimited') : `${num(data.worldLimits[id]!)}${t('perMin')}`]);
  const tag = it.kind === 'part' ? (fluidUnit ? t(`form_${it.form}`) : t('kind_part')) : t(`kind_${it.kind}`);
  const canPlan = !!planned && !planned.raw && recipes.length > 0;
  const insight = index.data.insights.items[id];
  const line = insight?.line;
  // Sink points for every raw resource the whole line takes: which parts are worth making just to sink.
  if (it.sink && line && line.rawTotal > 0 && line.missing.length === 0)
    stats.push([t('statPointsPerRaw'), num(Math.round(((it.sink * line.rate) / line.rawTotal) * 10) / 10)]);
  const phases = index.data.phases.flatMap((p) =>
    p.cost.filter((c) => c.item === id).map((c) => ({ phase: p, amount: elevatorAmount(c.amount, game) })),
  );
  const note = ITEM_NOTES[id];

  return (
    <>
      <Head
        icon={id}
        name={it.name}
        tag={tag}
        stats={stats}
        desc={it.desc}
        actions={
          canPlan || burners.length || onMapAny(id) ? (
            <>
              {canPlan && (
                <button type="button" className="primary-button" title={t('buildFactoryHint')} onClick={() => buildFactory(id, it.name)}>
                  <Glyph name="factory" size={18} />
                  {t('buildFactory')}
                </button>
              )}
              {burners.length > 0 && (
                <button type="button" className="ghost-button" title={t('burnThisHint')} onClick={() => buildPlant(burners[0].id, id)}>
                  <Glyph name="bolt" size={18} />
                  {t('burnThis')}
                </button>
              )}
              {onMapAny(id) && (
                <button type="button" className="ghost-button" onClick={() => openMapOn(id)}>
                  <Glyph name="map" size={18} />
                  {t('showOnMap')}
                </button>
              )}
            </>
          ) : undefined
        }
      />
      {note && <Notes text={note} />}
      {phases.length > 0 && (
        <Section title={t('elevatorTitle')}>
          <div className="codex-uses">
            {phases.map(({ phase, amount }) => (
              <CodexLink key={phase.phase} page={{ kind: 'guide', id: 'elevator' }} className="codex-use">
                <Icon id="Build_SpaceElevator_C" size={30} />
                <span className="codex-use-name">{t('phaseN', { n: phase.phase })}</span>
                <span className="codex-use-where">{phaseOpens(phase, index, t)}</span>
                <span className="codex-use-rate">× {num(amount)}</span>
              </CodexLink>
            ))}
          </div>
        </Section>
      )}
      {extractors.length > 0 && (
        <Section title={t('howToGet')}>
          <div className="codex-table-wrap">
            <table className="codex-table">
              <thead>
                <tr>
                  <th>{t('extractor')}</th>
                  {PURITIES.map((p) => (
                    <th key={p}>{t(p)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {extractors.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <CodexLink page={{ kind: 'building', id: e.id }} className="codex-machine">
                        <Icon id={e.id} size={24} />
                        {e.name}
                      </CodexLink>
                    </td>
                    {PURITIES.map((p) => (
                      <td key={p}>{e.purity ? num(e.rate * PURITY[p]) : p === 'normal' ? num(e.rate) : '–'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">{t('extractorNote', { unit: fluidUnit ? t('unitM3') : t('unitItems') })}</p>
        </Section>
      )}
      {recipes.length > 0 && (
        <Section title={t('howToMake')} count={recipes.length}>
          <div className="codex-recipes">
            {recipes.map((r) => (
              <RecipeCard key={r.id} recipe={r} index={index} build={canPlan ? id : undefined} />
            ))}
          </div>
        </Section>
      )}
      {insight && line && (
        <Section title={t('lineTitle')}>
          <ProductionLine id={id} insight={insight} index={index} />
        </Section>
      )}
      {insight && insight.compare.length > 1 && (
        <Section title={t('compareTitle')} count={insight.compare.length}>
          <RecipeCompare insight={insight} index={index} />
          <p className="hint">{t('compareNote', { rate: `${num(insight.line.rate)}${fluidUnit ? t('m3PerMin') : t('perMin')}` })}</p>
        </Section>
      )}
      {crafts.length > 0 && (
        <Section title={t('craftedAt')}>
          {crafts.map((c) => (
            <div key={c.id} className="codex-craft">
              <Amounts list={c.inputs} index={index} />
              <span className="codex-arrow" aria-hidden>
                →
              </span>
              <Amount item={id} amount={c.amount} index={index} />
              <UnlockLine id={c.unlock} index={index} />
            </div>
          ))}
        </Section>
      )}
      {burners.length > 0 && (
        <Section title={t('burnedIn')}>
          <div className="codex-table-wrap">
            <table className="codex-table">
              <thead>
                <tr>
                  <th>{t('generator')}</th>
                  <th>{t('mw')}</th>
                  <th>{t('burns')}</th>
                  <th>{t('waterUse')}</th>
                </tr>
              </thead>
              <tbody>
                {burners.map((g) => {
                  const rate = fuelRate(g, id);
                  const water = g.supplement ? (g.power * 60 * g.supplementRatio) / 1000 : 0;
                  return (
                    <tr key={g.id}>
                      <td>
                        <CodexLink page={{ kind: 'building', id: g.id }} className="codex-machine">
                          <Icon id={g.id} size={24} />
                          {g.name}
                        </CodexLink>
                      </td>
                      <td>{num(g.power)}</td>
                      <td>
                        {num(rate)}
                        {fluidUnit ? t('m3PerMin') : t('perMin')}
                      </td>
                      <td>{water ? `${num(water)}${t('m3PerMin')}` : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      {uses.length > 0 && (
        <Section title={t('usedToMake')} count={uses.length}>
          <div className="codex-uses">
            {uses
              .sort((a, b) => a.outputs[0].item.localeCompare(b.outputs[0].item))
              .map((r) => (
                <CodexLink key={r.id} page={{ kind: 'item', id: r.outputs[0].item }} className="codex-use">
                  <Icon id={r.outputs[0].item} size={30} />
                  <span className="codex-use-name">{recipeLabel(r.name, r.kind)}</span>
                  {r.kind === 'alternate' && <span className="codex-pill alt">{t('altShort')}</span>}
                  <span className="codex-use-rate">
                    {num(r.inputs.find((x) => x.item === id)!.rate)}
                    {fluidUnit ? t('m3PerMin') : t('perMin')}
                  </span>
                </CodexLink>
              ))}
          </div>
        </Section>
      )}
      {built.length > 0 && (
        <Section title={t('usedToBuild')} count={built.length}>
          <div className="codex-amounts wrap">
            {built
              .sort((a, b) => b.amount - a.amount)
              .map((b) => (
                <CodexLink key={pageKey(b.page)} page={b.page} className="codex-amount">
                  <span className="slot">
                    <Icon id={(b.page as { id: string }).id} size={34} />
                  </span>
                  <span className="codex-amount-text">
                    <b>× {num(b.amount)}</b>
                    <span>{nameOf((b.page as { id: string }).id, index.data)}</span>
                  </span>
                </CodexLink>
              ))}
          </div>
        </Section>
      )}
      {paid.length > 0 && (
        <Section title={t('paidInto')} count={paid.length}>
          <div className="codex-uses">
            {paid.map((p) => {
              const s = index.schematic.get(p.id)!;
              return (
                <CodexLink key={p.id} page={{ kind: 'schematic', id: p.id }} className="codex-use">
                  <Icon id={schematicIcon(s, index.data) ?? id} size={30} />
                  <span className="codex-use-name">{s.name}</span>
                  <span className="codex-use-where">{schematicWhere(s, t)}</span>
                  <span className="codex-use-rate">× {num(p.amount)}</span>
                </CodexLink>
              );
            })}
          </div>
        </Section>
      )}
      {leftBy.length > 0 && (
        <Section title={t('droppedBy')} count={leftBy.length}>
          <div className="codex-uses">
            {leftBy.map((c) => (
              <CodexLink key={c.id} page={{ kind: 'creature', id: c.id }} className="codex-use">
                <Icon id={c.id} size={30} />
                <span className="codex-use-name">{c.name}</span>
                {c.health && <span className="codex-use-where">{t('healthN', { n: num(c.health) })}</span>}
              </CodexLink>
            ))}
          </div>
        </Section>
      )}
      {sold.length > 0 && (
        <Section title={t('soldInShop')}>
          <div className="codex-uses">
            {sold.map((p) => {
              const s = index.schematic.get(p.id)!;
              const coupons = s.cost.find((c) => c.item === 'Desc_ResourceSinkCoupon_C')?.amount ?? 0;
              return (
                <CodexLink key={p.id} page={{ kind: 'schematic', id: p.id }} className="codex-use">
                  <Icon id="Desc_ResourceSinkCoupon_C" size={30} />
                  <span className="codex-use-name">{t('shopDeal', { n: num(p.amount), coupons })}</span>
                </CodexLink>
              );
            })}
          </div>
        </Section>
      )}
    </>
  );
}

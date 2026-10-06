import type { ReactNode } from 'react';
import { type CodexIndex, nameOf } from '../../lib/codex';
import { data, generatorById } from '../../lib/data';
import { PURITIES, PURITY } from '../../lib/extraction';
import { useT } from '../../lib/i18n';
import { fuelRate } from '../../lib/power';
import { recipeLabel } from '../../lib/text';
import { BUILDING_NOTES } from '../../locales/codex-notes.en';
import { shardsFor } from '../../lib/solver';
import { Icon } from '../Icon';
import { CodexLink } from './route';
import { Amounts, Head, Notes, Section, UnlockLine } from './parts';
import { PhaseList } from './parts';

export function BuildingPage({ id, index }: { id: string; index: CodexIndex }) {
  const { t, num } = useT();
  const b = index.data.buildings[id];
  if (!b) return <p className="hint">{t('codexMissing')}</p>;
  const machine = data.machines[id];
  const generator = generatorById.get(id);
  const extractor = data.extractors.find((e) => e.id === id);
  const recipes = data.recipes.filter((r) => r.machine === id && r.kind !== 'power');
  const stats: [string, ReactNode][] = [];
  const tier = machine?.tier ?? generator?.tier ?? extractor?.tier;
  if (tier !== undefined) stats.push([t('statTier'), tier]);
  for (const [k, v] of b.stats ?? []) stats.push([t(`stat_${k}`), `${num(v)}${t(`statUnit_${k}`)}`]);
  if (machine?.variable) {
    const ranges = recipes.map((r) => r.powerRange).filter(Boolean) as [number, number][];
    if (ranges.length)
      stats.push([
        t('stat_power'),
        `${num(Math.min(...ranges.map((r) => r[0])))}–${num(Math.max(...ranges.map((r) => r[1])))}${t('statUnit_power')}`,
      ]);
  }
  if (generator?.kind === 'geothermal')
    stats.push([t('stat_makes'), t('geyserRange', { impure: generator.power / 2, pure: generator.power * 2 })]);
  if (generator?.kind === 'augmenter') stats.push([t('stat_makes'), `${num(generator.power)}${t('statUnit_power')}`]);

  // What a clock change does to a building with a fixed draw: production buildings and extractors.
  const base = machine && !machine.variable && machine.power > 0 ? machine : extractor && extractor.power > 0 ? extractor : undefined;
  const note = BUILDING_NOTES[id];
  const elevator = id === 'Build_SpaceElevator_C';

  return (
    <>
      <Head icon={id} name={b.name} tag={t(`group_${b.group}`)} stats={stats} desc={b.desc} />
      {note && <Notes text={note} />}
      {elevator && (
        <Section title={t('elevatorPhases')}>
          <PhaseList index={index} />
        </Section>
      )}
      {(b.cost || b.unlock) && (
        <Section title={t('buildCost')}>
          {b.cost && <Amounts list={b.cost} index={index} />}
          <UnlockLine id={b.unlock} index={index} />
        </Section>
      )}
      {extractor && (
        <Section title={t('extractionRates')}>
          <div className="codex-table-wrap">
            <table className="codex-table">
              <thead>
                <tr>
                  <th>{t('clock')}</th>
                  {extractor.purity ? PURITIES.map((p) => <th key={p}>{t(p)}</th>) : <th>{t('rate')}</th>}
                </tr>
              </thead>
              <tbody>
                {[1, 1.5, 2, 2.5].map((c) => (
                  <tr key={c}>
                    <td>{num(c * 100)}%</td>
                    {extractor.purity ? (
                      PURITIES.map((p) => <td key={p}>{num(extractor.rate * PURITY[p] * c)}</td>)
                    ) : (
                      <td>{num(extractor.rate * c)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            {extractor.resources.length
              ? t('extractsThese', { list: extractor.resources.map((r) => nameOf(r, index.data)).join(', ') })
              : t('extractsSolids')}
          </p>
        </Section>
      )}
      {generator && generator.kind === 'fuel' && (
        <Section title={t('fuelsTitle')}>
          <div className="codex-table-wrap">
            <table className="codex-table">
              <thead>
                <tr>
                  <th>{t('fuel')}</th>
                  <th>{t('burns')}</th>
                  <th>{t('waterUse')}</th>
                  <th>{t('waste')}</th>
                </tr>
              </thead>
              <tbody>
                {generator.fuels.map((f) => {
                  const rate = fuelRate(generator, f.item);
                  const fluid = data.items[f.item]?.form !== 'solid';
                  const water = generator.supplement ? (generator.power * 60 * generator.supplementRatio) / 1000 : 0;
                  return (
                    <tr key={f.item}>
                      <td>
                        <CodexLink page={{ kind: 'item', id: f.item }} className="codex-machine">
                          <Icon id={f.item} size={24} />
                          {nameOf(f.item, index.data)}
                        </CodexLink>
                      </td>
                      <td>
                        {num(rate)}
                        {fluid ? t('m3PerMin') : t('perMin')}
                      </td>
                      <td>{water ? `${num(water)}${t('m3PerMin')}` : '–'}</td>
                      <td>
                        {f.byproduct && f.byproductAmount
                          ? `${num(rate * f.byproductAmount)}${t('perMin')} ${nameOf(f.byproduct, index.data)}`
                          : '–'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint">{t('fuelsNote', { mw: num(generator.power) })}</p>
        </Section>
      )}
      {generator?.kind === 'augmenter' && generator.booster && (
        <Section title={t('augmenterTitle')}>
          <p className="codex-text">
            {t('augmenterText', {
              boost: num((generator.boost ?? 0) * 100),
              fed: num((generator.booster.boost + (generator.boost ?? 0)) * 100),
              item: nameOf(generator.booster.item, index.data),
              seconds: num(generator.booster.duration),
            })}
          </p>
        </Section>
      )}
      {base && (
        <Section title={t('clockTitle')}>
          <div className="codex-table-wrap">
            <table className="codex-table">
              <thead>
                <tr>
                  <th>{t('clock')}</th>
                  <th className="num">{t('calcOutput')}</th>
                  <th className="num">{t('calcPower')}</th>
                  <th className="num">{t('calcShards')}</th>
                </tr>
              </thead>
              <tbody>
                {[0.5, 1, 1.5, 2, 2.5].map((c) => (
                  <tr key={c}>
                    <td>{num(c * 100)}%</td>
                    <td className="num">× {num(c)}</td>
                    <td className="num">
                      {num(base.power * c ** base.powerExp)} {t('mw')}
                    </td>
                    <td className="num">{shardsFor(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodexLink page={{ kind: 'guide', id: 'overclock' }} className="text-button">
            {t('readOverclock')}
          </CodexLink>
        </Section>
      )}
      {machine && machine.somersloopSlots > 0 && (
        <Section title={t('sloopTitle')}>
          <p className="codex-text">{machine.somersloopSlots === 1 ? t('sloopTextOne') : t('sloopText', { n: machine.somersloopSlots })}</p>
          <CodexLink page={{ kind: 'guide', id: 'sloops' }} className="text-button">
            {t('readGuide')}
          </CodexLink>
        </Section>
      )}
      {recipes.length > 0 && (
        <Section title={t('runsRecipes')} count={recipes.length}>
          <div className="codex-uses">
            {[...recipes]
              .sort((a, b) => Number(a.kind === 'alternate') - Number(b.kind === 'alternate') || a.name.localeCompare(b.name))
              .map((r) => (
                <CodexLink key={r.id} page={{ kind: 'item', id: r.outputs[0].item }} className="codex-use">
                  <Icon id={r.outputs[0].item} size={30} />
                  <span className="codex-use-name">{recipeLabel(r.name, r.kind)}</span>
                  {r.kind === 'alternate' && <span className="codex-pill alt">{t('altShort')}</span>}
                  {r.kind === 'converter' && <span className="codex-pill conv">{t('converter')}</span>}
                  <span className="codex-use-rate">
                    {num(r.outputs[0].rate)}
                    {data.items[r.outputs[0].item]?.form !== 'solid' ? t('m3PerMin') : t('perMin')}
                  </span>
                </CodexLink>
              ))}
          </div>
        </Section>
      )}
    </>
  );
}

import type { ReactNode } from 'react';
import type { CodexIndex } from '../../lib/codex';
import { useT } from '../../lib/i18n';
import { Glyph } from '../Glyph';
import { openMapOn } from '../MapNav';
import { Icon } from '../Icon';
import { CodexLink } from './route';
import { Amount, Amounts, Head, Section, UnlockLine } from './parts';

/** Game speeds are in cm/s; km/h reads better next to the game's own vehicles. */
export const kmh = (cmPerS: number) => Math.round(cmPerS * 0.036);

export function CreaturePage({ id, index }: { id: string; index: CodexIndex }) {
  const { t, num } = useT();
  const c = index.data.creatures.find((x) => x.id === id);
  if (!c) return <p className="hint">{t('codexMissing')}</p>;
  const stats: [string, ReactNode][] = [];
  if (c.health) stats.push([t('statHealth'), num(c.health)]);
  if (c.run) stats.push([t('statRun'), t('kmh', { n: kmh(c.run) })]);
  if (c.sprint) stats.push([t('statSprint'), t('kmh', { n: kmh(c.sprint) })]);
  stats.push([t('statInWorld'), num(c.count)]);
  const kin = index.data.creatures.filter((x) => x.family === c.family && x.id !== c.id);
  return (
    <>
      <Head
        icon={c.id}
        name={c.name}
        tag={t(`family_${c.family}`)}
        stats={stats}
        desc={c.note}
        actions={
          <button type="button" className="ghost-button" onClick={() => openMapOn(c.id)}>
            <Glyph name="map" size={18} />
            {t('showOnMap')}
          </button>
        }
      />
      <Section title={t('whereFound')}>
        <p className="hint">{t('spawnPoints', { n: num(c.spawners), count: num(c.count) })}</p>
      </Section>
      {c.drop && (
        <Section title={t('drops')}>
          <div className="codex-amounts">
            <Amount item={c.drop} index={index} />
          </div>
        </Section>
      )}
      {kin.length > 0 && c.family !== 'passive' && (
        <Section title={t(`family_${c.family}`)} count={kin.length}>
          <div className="codex-uses">
            {kin.map((k) => (
              <CodexLink key={k.id} page={{ kind: 'creature', id: k.id }} className="codex-use">
                <Icon id={k.id} size={30} />
                <span className="codex-use-name">{k.name}</span>
                {k.health && <span className="codex-use-where">{t('healthN', { n: num(k.health) })}</span>}
              </CodexLink>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

export function VehiclePage({ id, index }: { id: string; index: CodexIndex }) {
  const { t, num } = useT();
  const v = index.data.vehicles[id];
  if (!v) return <p className="hint">{t('codexMissing')}</p>;
  const stats: [string, ReactNode][] = [];
  if (v.slots) stats.push([v.fluid ? t('statTank') : t('stat_slots'), num(v.slots)]);
  return (
    <>
      <Head icon={id} name={v.name} tag={t('kind_vehicle')} stats={stats} desc={v.desc} />
      {(v.cost || v.unlock) && (
        <Section title={t('buildCost')}>
          {v.cost && <Amounts list={v.cost} index={index} />}
          <UnlockLine id={v.unlock} index={index} />
        </Section>
      )}
    </>
  );
}

import type { ReactNode } from 'react';
import { type CodexIndex, type Page, pageKey } from '../../lib/codex';
import { useT } from '../../lib/i18n';
import { CodexLink } from './route';
import { Icon } from '../Icon';
import { Health } from './Hearts';
import { Section } from './parts';

type T = ReturnType<typeof useT>['t'];
type Num = ReturnType<typeof useT>['num'];
type Stat = CodexIndex['data']['stats'][string][number];
type StatLabel = Extract<Parameters<T>[0], `st_${string}`>;

/** A number with its unit: 5/s, 15°, 1.5×, 250 m. A footprint keeps its length in the unit slot: 8 × 10 m. */
const withUnit = (n: string, unit: string, key = '') =>
  key === 'footprint' ? `${n} × ${unit} m` : !unit ? n : /^[/°×]/.test(unit) ? `${n}${unit}` : `${n} ${unit}`;

/** Where the Satisfactory Wiki gave a number the game files don't hold. */
const WikiMark = () => <small className="stat-note">wiki</small>;

/** One number of a page, with its unit, and the wiki's mark where the game files don't hold it. */
function Cell({ row, num }: { row: Stat; num: Num }) {
  const [key, value, unit, wiki] = row;
  return (
    <>
      {key === 'heals' ? <Health hp={value} /> : withUnit(num(value), unit, key)}
      {wiki && (
        <>
          {' '}
          <WikiMark />
        </>
      )}
    </>
  );
}

/** The numbers a page shows in its header (damage, reload, fuel use ...), from scripts/extract-stats.mjs. */
export function numberRows(id: string, index: CodexIndex, t: T, num: Num): [string, ReactNode][] {
  return (index.data.stats[id] ?? [])
    .filter(([key]) => !key.includes(':'))
    .map((row) => [t(`st_${row[0]}` as StatLabel), <Cell key={row[0]} row={row} num={num} />]);
}

/** The Jetpack's fuels: how long one item burns, and how long a full tank flies. */
export function FuelTable({ id, index }: { id: string; index: CodexIndex }) {
  const { t, num } = useT();
  const rows = index.data.stats[id]?.filter(([key]) => key.startsWith('burn:')) ?? [];
  if (!rows.length) return null;
  const flight = (fuel: string) => index.data.stats[id]?.find(([key]) => key === `flight:${fuel}`);
  return (
    <Section title={t('jetFuels')}>
      <div className="codex-table-wrap">
        <table className="codex-table">
          <thead>
            <tr>
              <th>{t('jetFuel')}</th>
              <th>{t('jetBurn')}</th>
              <th>{t('jetFlight')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, burn]) => {
              const fuel = key.slice('burn:'.length);
              const f = flight(fuel);
              return (
                <tr key={fuel}>
                  <td>
                    <CodexLink page={{ kind: 'item', id: fuel }} className="codex-machine">
                      <Icon id={fuel} size={24} />
                      {index.data.items[fuel]?.name ?? fuel}
                    </CodexLink>
                  </td>
                  <td>{num(burn)} s</td>
                  <td>{f ? `${num(f[1])} s` : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">
        {t('jetFlightNote')} <WikiMark />
      </p>
    </Section>
  );
}

interface Ranked {
  page: Page;
  name: string;
  icon: string;
  sort: number;
  cells: ReactNode[];
}

/** One table, biggest first: a name, then a number or two to compare down the column. */
function RankTable({ title, heads, rows }: { title: string; heads: string[]; rows: Ranked[] }) {
  const { t } = useT();
  if (!rows.length) return null;
  return (
    <Section title={title} count={rows.length}>
      <div className="codex-table-wrap">
        <table className="codex-table">
          <thead>
            <tr>
              <th>{t('numName')}</th>
              {heads.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...rows]
              .sort((a, b) => b.sort - a.sort)
              .map((r) => (
                <tr key={pageKey(r.page)}>
                  <td>
                    <CodexLink page={r.page} className="codex-machine">
                      <Icon id={r.icon} size={24} />
                      {r.name}
                    </CodexLink>
                  </td>
                  {r.cells.map((c, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the cells of a row never reorder
                    <td key={i}>{c}</td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** Every number the Codex holds, side by side: weapons, creatures, food, buildings and vehicles. */
export function NumbersPage({ index }: { index: CodexIndex }) {
  const { t, num } = useT();
  const { stats, items, creatures, buildings, vehicles } = index.data;
  const row = (id: string, key: string) => stats[id]?.find(([k]) => k === key);
  const cell = (id: string, key: string) => {
    const r = row(id, key);
    return r ? <Cell row={r} num={num} /> : '–';
  };
  const ranked = (ids: string[], key: string, keys: string[], make: (id: string) => Omit<Ranked, 'sort' | 'cells'>): Ranked[] =>
    ids.filter((id) => row(id, key)).map((id) => ({ ...make(id), sort: row(id, key)?.[1] ?? 0, cells: keys.map((k) => cell(id, k)) }));
  const item = (id: string) => ({ page: { kind: 'item', id } as Page, name: items[id]?.name ?? id, icon: id });
  const withStats = Object.keys(stats);
  const area = (id: string) => {
    const r = row(id, 'footprint');
    return r ? r[1] * Number(r[2]) : 0;
  };
  const places = withStats.filter(
    (id) => buildings[id] && area(id) > 0 && ['production', 'extraction', 'power'].includes(buildings[id].group),
  );
  return (
    <>
      <RankTable
        title={t('numWeapons')}
        heads={[t('st_damage'), t('st_dps'), t('st_range')]}
        rows={ranked(
          withStats.filter((id) => items[id]?.kind === 'ammo'),
          'damage',
          ['damage', 'dps', 'range'],
          item,
        )}
      />
      <RankTable
        title={t('numCreatures')}
        heads={[t('statHealth'), t('st_damage')]}
        rows={creatures
          .filter((c) => row(c.id, 'damage'))
          .map((c) => ({
            page: { kind: 'creature', id: c.id } as Page,
            name: c.name,
            icon: c.id,
            sort: c.health ?? 0,
            cells: [c.health ? <Health key="health" hp={c.health} /> : '–', cell(c.id, 'damage')],
          }))}
      />

      <RankTable title={t('numFood')} heads={[t('st_heals')]} rows={ranked(withStats, 'heals', ['heals'], item)} />
      <RankTable
        title={t('numBuildings')}
        heads={[t('st_footprint'), t('numArea')]}
        rows={places.map((id) => ({
          page: { kind: 'building', id } as Page,
          name: buildings[id].name,
          icon: id,
          sort: area(id),
          cells: [cell(id, 'footprint'), `${num(area(id))} m²`],
        }))}
      />
      <RankTable
        title={t('numVehicles')}
        heads={[t('st_fuelUse')]}
        rows={withStats
          .filter((id) => vehicles[id] && row(id, 'fuelUse'))
          .map((id) => ({
            page: { kind: 'vehicle', id } as Page,
            name: vehicles[id].name,
            icon: id,
            sort: row(id, 'fuelUse')?.[1] ?? 0,
            cells: [cell(id, 'fuelUse')],
          }))}
      />
    </>
  );
}

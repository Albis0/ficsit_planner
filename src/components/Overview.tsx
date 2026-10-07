import type { ReactNode } from 'react';
import { useT } from '../lib/i18n';
import { type FactoryRow, type PlantRow, useOverview } from '../lib/overview';
import { useStore } from '../store';
import { Icon } from './Icon';
import { RateChips, SinkPoints } from './Summary';

/** A list of items as icon-and-rate chips, or a dash when there are none. */
const Chips = ({ list, muted }: { list: { item: string; rate: number }[]; muted?: boolean }) =>
  list.length ? <RateChips list={list} muted={muted} /> : <span className="ov-none">–</span>;

const Cell = ({ label, children }: { label: string; children: ReactNode }) => <td data-label={label}>{children}</td>;

/**
 * The "All" tab: every factory and power plant on one page, and the totals under them. Read-only; a row opens its tab.
 */
export function OverviewPage() {
  const { t, num } = useT();
  const set = useStore((s) => s.set);
  const o = useOverview();
  const { totals } = o;
  // The pool: what's left over added up, less what factories take from it; below zero, it's short.
  const left = o.pool.filter((l) => l.left > 0.01).map((l) => ({ item: l.item, rate: l.left }));
  const short = o.pool.filter((l) => l.left < -0.01).map((l) => ({ item: l.item, rate: -l.left }));
  // A plant with nothing in it yet isn't listed.
  const plants = o.plants.filter((p) => !p.empty);
  const grid = plants.length > 0;
  const open = (id: string, power: boolean) =>
    set(power ? { mode: 'power', activePower: id, inspect: undefined } : { mode: 'factory', active: id, inspect: undefined });

  const state = (r: FactoryRow | PlantRow) =>
    r.failed ? <span className="ov-note bad">{t('ovFailed')}</span> : r.pending ? <span className="ov-note">{t('solving')}…</span> : null;

  return (
    <div className="overview">
      <div className="summary">
        <div className="readouts">
          <div className="readout power">
            <span className="readout-label">{t('ovPowerUsed')}</span>
            <span className="readout-value">
              {num(totals.used)} <small>MW</small>
            </span>
            <span className={`readout-sub ${grid && totals.spare < -0.5 ? 'bad' : ''}`}>
              {!grid
                ? t('ovNoPlants')
                : totals.spare < -0.5
                  ? t('ovMadeShort', { made: num(totals.made), short: num(-totals.spare) })
                  : t('ovMadeSpare', { made: num(totals.made), spare: num(Math.max(0, totals.spare)) })}
            </span>
          </div>
          <div className="readout">
            <span className="readout-label">{t('machines')}</span>
            <span className="readout-value">{totals.machines}</span>
          </div>
          <div className="readout">
            <span className="readout-label">{t('extractors')}</span>
            <span className="readout-value">{totals.extractors}</span>
          </div>
          {left.length > 0 && (
            <div className="readout fill">
              <span className="readout-label">{t('ovPoolLeft')}</span>
              <RateChips list={left} muted />
              <SinkPoints list={left} />
            </div>
          )}
          {short.length > 0 && (
            <div className="readout fill short">
              <span className="readout-label">{t('ovPoolShort')}</span>
              <RateChips list={short} />
            </div>
          )}
        </div>
      </div>

      <div className="ov-scroll">
        <section className="ov-section">
          <h2 className="ov-title">{t('ovFactories')}</h2>
          <table className="ov-table">
            <thead>
              <tr>
                <th>{t('ovName')}</th>
                <th>{t('ovMakes')}</th>
                <th>{t('ovTakes')}</th>
                <th>{t('ovLeft')}</th>
                <th className="num">{t('power')}</th>
              </tr>
            </thead>
            <tbody>
              {o.factories.map((f) => (
                <tr key={f.id}>
                  <td className="ov-name">
                    <button type="button" onClick={() => open(f.id, false)}>
                      {f.name}
                    </button>
                    {f.manual && <small className="ov-tag">{t('ovHandBuilt')}</small>}
                  </td>
                  {f.empty ? (
                    <td colSpan={4} className="ov-empty">
                      {t('ovNothingPlanned')}
                    </td>
                  ) : (
                    <>
                      <Cell label={t('ovMakes')}>{state(f) ?? <Chips list={f.makes} />}</Cell>
                      <Cell label={t('ovTakes')}>
                        <Chips list={[...f.raw, ...f.brings]} />
                      </Cell>
                      <Cell label={t('ovLeft')}>
                        <Chips list={f.surplus} muted />
                      </Cell>
                      <td className="num" data-label={t('power')}>
                        {f.pending || f.failed ? '' : num(f.mw)} <small>MW</small>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {plants.length > 0 && (
          <section className="ov-section">
            <h2 className="ov-title">{t('ovPlants')}</h2>
            <table className="ov-table plants">
              <thead>
                <tr>
                  <th>{t('ovName')}</th>
                  <th className="num">{t('ovMade')}</th>
                  <th className="num">{t('ovOwnChain')}</th>
                  <th>{t('ovLeft')}</th>
                </tr>
              </thead>
              <tbody>
                {plants.map((p) => (
                  <tr key={p.id}>
                    <td className="ov-name">
                      <button type="button" onClick={() => open(p.id, true)}>
                        {p.icon && <Icon id={p.icon} size={24} />}
                        {p.name}
                      </button>
                    </td>
                    <td className="num" data-label={t('ovMade')}>
                      {state(p) ?? (
                        <>
                          {num(p.made)} <small>MW</small>
                        </>
                      )}
                    </td>
                    <td className="num" data-label={t('ovOwnChain')}>
                      {num(p.own)} <small>MW</small>
                    </td>
                    <Cell label={t('ovLeft')}>
                      <Chips list={p.surplus} muted />
                    </Cell>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  );
}

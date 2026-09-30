import { type ReactNode, useMemo, useState } from 'react';
import { type CodexIndex, GUIDE_ICON, type GuideId, nameOf, useCodex } from '../lib/codex';
import { data, generatorById, recipeById, transportFor } from '../lib/data';
import { versusStandard } from '../lib/insights';
import { PURITIES, PURITY } from '../lib/extraction';
import { useWorld } from '../lib/finds';
import { useT } from '../lib/i18n';
import { fuelRate, MAX_CLOCK } from '../lib/power';
import { shardsFor } from '../lib/solver';
import { recipeLabel } from '../lib/text';
import { CodexLink, PhaseList, phaseOpens } from './Codex';
import { Delta, Flows, rawOrder } from './CodexLine';
import { Glyph } from './Glyph';
import { openMapOn } from './MapNav';
import { Icon } from './Icon';
import { RateInput } from './RateInput';

/** Mechanics explained with the game's own numbers, and small calculators to try them on. */
export function GuidePage({ id }: { id: GuideId }) {
  const { t } = useT();
  return (
    <>
      <header className="codex-cat-head">
        <Icon id={GUIDE_ICON[id]} size={72} />
        <div>
          <span className="codex-tag">{t(id === 'crashsites' ? 'cat_world' : 'cat_guides')}</span>
          <h2 className="codex-title">{t(`guide_${id}`)}</h2>
        </div>
      </header>
      {id === 'start' && <Start />}
      {id === 'elevator' && <Elevator />}
      {id === 'power' && <Power />}
      {id === 'oil' && <Oil />}
      {id === 'nuclear' && <Nuclear />}
      {id === 'alternates' && <Alternates />}
      {id === 'overclock' && <Overclock />}
      {id === 'sloops' && <Sloops />}
      {id === 'nodes' && <Nodes />}
      {id === 'fuel' && <Fuel />}
      {id === 'transport' && <Transport />}
      {id === 'world' && <World />}
      {id === 'sink' && <Sink />}
      {id === 'crashsites' && <CrashSites />}
    </>
  );
}

function Text({ k }: { k: Parameters<ReturnType<typeof useT>['t']>[0] }) {
  const { t } = useT();
  return (
    <div className="codex-text">
      {t(k)
        .split('\n\n')
        .map((p) => (
          <p key={p}>{p}</p>
        ))}
    </div>
  );
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="codex-section">
      <h3 className="codex-h">{title}</h3>
      {children}
    </section>
  );
}

/** A row of buildings to pick from, drawn as inventory slots. */
function Picker({ ids, value, onChange, label }: { ids: string[]; value: string; onChange: (id: string) => void; label: string }) {
  const name = (id: string) => data.machines[id]?.name ?? data.items[id]?.name ?? id;
  return (
    <div className="codex-picker" role="radiogroup" aria-label={label}>
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={id === value}
          className="slot"
          title={name(id)}
          aria-label={name(id)}
          onClick={() => onChange(id)}
        >
          <Icon id={id} size={40} />
        </button>
      ))}
    </div>
  );
}

function Readout({ label, value, tone }: { label: string; value: ReactNode; tone?: 'power' | 'good' }) {
  return (
    <div className={`codex-readout${tone ? ` ${tone}` : ''}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

// Buildings with a fixed draw: the ones a clock or a somersloop changes in a predictable way.
const FIXED = Object.values(data.machines).filter((m) => !m.variable && m.power > 0);

function Overclock() {
  const { t, num } = useT();
  const [id, setId] = useState('Build_ConstructorMk1_C');
  const [clock, setClock] = useState(2.5);
  const m = data.machines[id];
  const power = m.power * clock ** m.powerExp;
  const perOutput = clock ** (m.powerExp - 1);
  return (
    <>
      <Text k="guideText_overclock" />
      <Box title={t('tryIt')}>
        <div className="codex-calc">
          <Picker ids={FIXED.map((x) => x.id)} value={id} onChange={setId} label={t('building')} />
          <div className="clock-control">
            <input
              type="range"
              min={1}
              max={MAX_CLOCK * 100}
              step={1}
              value={Math.round(clock * 100)}
              aria-label={t('clockSpeed')}
              onChange={(e) => setClock(Number(e.target.value) / 100)}
              style={{ ['--fill' as string]: `${((clock * 100 - 1) / (MAX_CLOCK * 100 - 1)) * 100}%` }}
            />
            <RateInput
              value={Math.round(clock * 10000) / 100}
              label={t('clockSpeed')}
              onChange={(n) => setClock(Math.min(MAX_CLOCK, Math.max(0.01, n / 100)))}
            />
            <span className="unit">%</span>
          </div>
          <div className="codex-readouts">
            <Readout label={t('calcOutput')} value={`× ${num(clock)}`} tone="good" />
            <Readout label={t('calcPower')} value={`${num(power)} ${t('mw')}`} tone="power" />
            <Readout label={t('calcShards')} value={shardsFor(clock)} />
            <Readout label={t('calcPerPart')} value={`× ${num(perOutput)}`} />
          </div>
          <p className="hint">{t('calcOverclockNote', { name: m.name, base: num(m.power) })}</p>
        </div>
      </Box>
      <Box title={t('atAGlance')}>
        <div className="codex-table-wrap">
          <table className="codex-table">
            <thead>
              <tr>
                <th>{t('clock')}</th>
                <th>{t('calcOutput')}</th>
                <th>{t('calcPowerMul')}</th>
                <th>{t('calcShards')}</th>
              </tr>
            </thead>
            <tbody>
              {[0.5, 1, 1.5, 2, 2.5].map((c) => (
                <tr key={c}>
                  <td>{num(c * 100)}%</td>
                  <td>× {num(c)}</td>
                  <td>× {num(c ** m.powerExp)}</td>
                  <td>{shardsFor(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Box>
    </>
  );
}

function Sloops() {
  const { t, num } = useT();
  const withSlots = FIXED.filter((m) => m.somersloopSlots > 0);
  const [id, setId] = useState('Build_ManufacturerMk1_C');
  const m = data.machines[id];
  const [filled, setFilled] = useState(m.somersloopSlots);
  const n = Math.min(filled, m.somersloopSlots);
  const boost = 1 + n / m.somersloopSlots;
  return (
    <>
      <Text k="guideText_sloops" />
      <Box title={t('tryIt')}>
        <div className="codex-calc">
          <Picker
            ids={withSlots.map((x) => x.id)}
            value={id}
            onChange={(next) => {
              setId(next);
              setFilled(data.machines[next].somersloopSlots);
            }}
            label={t('building')}
          />
          <div className="sloop-slots">
            {Array.from({ length: m.somersloopSlots }, (_, i) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: the slots are positions, not items.
                key={i}
                type="button"
                className={i < n ? 'filled' : ''}
                aria-label={t('sloopSlotN', { n: i + 1 })}
                aria-pressed={i < n}
                onClick={() => setFilled(i < n ? i : i + 1)}
              />
            ))}
            <span className="slot-label">{t('sloopsOf', { n, slots: m.somersloopSlots })}</span>
          </div>
          <div className="codex-readouts">
            <Readout label={t('calcOutput')} value={`× ${num(boost)}`} tone="good" />
            <Readout label={t('calcPowerMul')} value={`× ${num(boost ** 2)}`} />
            <Readout label={t('calcPower')} value={`${num(m.power * boost ** 2)} ${t('mw')}`} tone="power" />
          </div>
        </div>
      </Box>
      <Box title={t('atAGlance')}>
        <div className="codex-table-wrap">
          <table className="codex-table">
            <thead>
              <tr>
                <th>{t('building')}</th>
                <th>{t('slotsCol')}</th>
                <th>{t('calcPower')}</th>
                <th>{t('fullSloops')}</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(data.machines)
                .filter((x) => x.somersloopSlots > 0)
                .map((x) => (
                  <tr key={x.id}>
                    <td>
                      <CodexLink page={{ kind: 'building', id: x.id }} className="codex-machine">
                        <Icon id={x.id} size={24} />
                        {x.name}
                      </CodexLink>
                    </td>
                    <td>{x.somersloopSlots}</td>
                    <td>{x.variable ? t('varies') : `${num(x.power)} ${t('mw')}`}</td>
                    <td>{x.variable ? t('timesFour') : `${num(x.power * 4)} ${t('mw')}`}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Box>
    </>
  );
}

function Nodes() {
  const { t, num } = useT();
  const solid = data.items.Desc_OreIron_C;
  return (
    <>
      <Text k="guideText_nodes" />
      <Box title={t('atAGlance')}>
        <div className="codex-table-wrap">
          <table className="codex-table">
            <thead>
              <tr>
                <th>{t('extractor')}</th>
                <th>{t('clock')}</th>
                {PURITIES.map((p) => (
                  <th key={p}>{t(p)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.extractors
                .filter((e) => e.purity)
                // Miners by mark first, then the fluid extractors.
                .sort(
                  (a, b) =>
                    a.resources.length - b.resources.length || (a.resources.length ? a.name.localeCompare(b.name) : a.rate - b.rate),
                )
                .flatMap((e) =>
                  [1, 2.5].map((c) => (
                    <tr key={`${e.id}${c}`}>
                      <td>
                        {c === 1 && (
                          <CodexLink page={{ kind: 'building', id: e.id }} className="codex-machine">
                            <Icon id={e.id} size={24} />
                            {e.name}
                          </CodexLink>
                        )}
                      </td>
                      <td>{num(c * 100)}%</td>
                      {PURITIES.map((p) => {
                        const rate = e.rate * PURITY[p] * c;
                        const fluid = e.resources.length > 0;
                        const belt = fluid ? undefined : transportFor(solid, rate).transport;
                        return (
                          <td key={p}>
                            {num(rate)}
                            {belt && <small className="codex-belt">{belt.name}</small>}
                          </td>
                        );
                      })}
                    </tr>
                  )),
                )}
            </tbody>
          </table>
        </div>
        <p className="hint">{t('nodesNote')}</p>
      </Box>
    </>
  );
}

function Fuel() {
  const { t, num } = useT();
  return (
    <>
      <Text k="guideText_fuel" />
      <Box title={t('atAGlance')}>
        <div className="codex-table-wrap">
          <table className="codex-table">
            <thead>
              <tr>
                <th>{t('generator')}</th>
                <th>{t('fuel')}</th>
                <th>{t('energyCol')}</th>
                <th>{t('burns')}</th>
                <th>{t('waterUse')}</th>
              </tr>
            </thead>
            <tbody>
              {data.generators
                .filter((g) => g.kind === 'fuel')
                .flatMap((g) =>
                  g.fuels.map((f, i) => {
                    const item = data.items[f.item];
                    const fluid = item.form !== 'solid';
                    const water = g.supplement ? (g.power * 60 * g.supplementRatio) / 1000 : 0;
                    return (
                      <tr key={g.id + f.item}>
                        <td>
                          {i === 0 && (
                            <CodexLink page={{ kind: 'building', id: g.id }} className="codex-machine">
                              <Icon id={g.id} size={24} />
                              {g.name} · {num(g.power)} {t('mw')}
                            </CodexLink>
                          )}
                        </td>
                        <td>
                          <CodexLink page={{ kind: 'item', id: f.item }} className="codex-machine">
                            <Icon id={f.item} size={24} />
                            {item.name}
                          </CodexLink>
                        </td>
                        <td>
                          {num(item.energy ?? 0)} MJ{fluid ? '/m³' : ''}
                        </td>
                        <td>
                          {num(fuelRate(g, f.item))}
                          {fluid ? t('m3PerMin') : t('perMin')}
                        </td>
                        <td>{water ? `${num(water)}${t('m3PerMin')}` : '–'}</td>
                      </tr>
                    );
                  }),
                )}
            </tbody>
          </table>
        </div>
        <p className="hint">{t('fuelGuideNote')}</p>
      </Box>
    </>
  );
}

function Transport() {
  const { t, num } = useT();
  return (
    <>
      <Text k="guideText_transport" />
      <Box title={t('beltsTitle')}>
        <div className="codex-table-wrap">
          <table className="codex-table">
            <thead>
              <tr>
                <th>{t('beltCol')}</th>
                <th>{t('rate')}</th>
                <th>{t('statTier')}</th>
              </tr>
            </thead>
            <tbody>
              {data.belts.map((b) => (
                <tr key={b.id}>
                  <td>
                    <CodexLink page={{ kind: 'building', id: b.id }} className="codex-machine">
                      <Icon id={b.id} size={24} />
                      {t('beltName', { mk: b.name })}
                    </CodexLink>
                  </td>
                  <td>
                    {num(b.rate)}
                    {t('perMin')}
                  </td>
                  <td>{b.tier}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Box>
      <Box title={t('pipesTitle')}>
        <div className="codex-table-wrap">
          <table className="codex-table">
            <thead>
              <tr>
                <th>{t('pipeCol')}</th>
                <th>{t('rate')}</th>
                <th>{t('statTier')}</th>
              </tr>
            </thead>
            <tbody>
              {data.pipes.map((p) => (
                <tr key={p.id}>
                  <td>
                    <CodexLink page={{ kind: 'building', id: p.id }} className="codex-machine">
                      <Icon id={p.id} size={24} />
                      {t('pipeName', { mk: p.name })}
                    </CodexLink>
                  </td>
                  <td>
                    {num(p.rate)}
                    {t('m3PerMin')}
                  </td>
                  <td>{p.tier}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Box>
    </>
  );
}

function World() {
  const { t, num } = useT();
  const rows = Object.entries(data.worldLimits).sort((a, b) => (b[1] ?? Infinity) - (a[1] ?? Infinity));
  const most = Math.max(...rows.map(([, v]) => v ?? 0));
  return (
    <>
      <Text k="guideText_world" />
      <Box title={t('atAGlance')}>
        <div className="codex-bars">
          {rows.map(([id, limit]) => (
            <CodexLink key={id} page={{ kind: 'item', id }} className="codex-bar">
              <Icon id={id} size={30} />
              <span className="codex-bar-name">{data.items[id]?.name}</span>
              <span className="codex-bar-track">
                <span style={{ width: limit === null ? '100%' : `${(limit / most) * 100}%` }} className={limit === null ? 'endless' : ''} />
              </span>
              <b>{limit === null ? t('unlimited') : `${num(limit)}${data.items[id]?.form === 'solid' ? t('perMin') : t('m3PerMin')}`}</b>
            </CodexLink>
          ))}
        </div>
      </Box>
    </>
  );
}

/** Every crash site's price, read from the level: how many open free, for power or for parts, and which parts. */
function CrashSites() {
  const { t, num } = useT();
  const world = useWorld();
  const pods = world?.finds.pod ?? [];
  const parts = new Map<string, number[]>();
  for (const [, , cost] of pods) if (cost && 'item' in cost) parts.set(cost.item, [...(parts.get(cost.item) ?? []), cost.amount]);
  const rows = [...parts].sort(
    (a, b) => b[1].length - a[1].length || (data.items[a[0]]?.name ?? '').localeCompare(data.items[b[0]]?.name ?? ''),
  );
  const count = (f: (c: (typeof pods)[number][2]) => boolean) => pods.filter((p) => f(p[2])).length;
  return (
    <>
      <Text k="guideText_crashsites" />
      <p>
        <button type="button" className="ghost-button" onClick={() => openMapOn('pod')}>
          <Glyph name="map" size={18} />
          {t('showOnMap')}
        </button>
      </p>
      {world && (
        <>
          <Box title={t('atAGlance')}>
            <div className="codex-readouts">
              <Readout label={t('crashFree')} value={num(count((c) => !c))} tone="good" />
              <Readout label={t('crashPower')} value={num(count((c) => !!c && 'mw' in c))} />
              <Readout label={t('crashParts')} value={num(count((c) => !!c && 'item' in c))} />
            </div>
          </Box>
          <Box title={t('crashPartsTitle')}>
            <div className="codex-table-wrap">
              <table className="codex-table">
                <thead>
                  <tr>
                    <th>{t('item')}</th>
                    <th>{t('crashSites')}</th>
                    <th>{t('crashAmounts')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([id, amounts]) => (
                    <tr key={id}>
                      <td>
                        <CodexLink page={{ kind: 'item', id }} className="codex-machine">
                          <Icon id={id} size={24} />
                          {data.items[id]?.name ?? id}
                        </CodexLink>
                      </td>
                      <td>{amounts.length}</td>
                      <td>
                        {Math.min(...amounts) === Math.max(...amounts)
                          ? num(amounts[0])
                          : `${num(Math.min(...amounts))}–${num(Math.max(...amounts))}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Box>
        </>
      )}
    </>
  );
}

// Parts a Sink takes: anything worth points.
const SINKABLE = Object.values(data.items)
  .filter((i) => i.sink > 0 && i.form === 'solid')
  .sort((a, b) => b.sink - a.sink);

function Sink() {
  const { t, num } = useT();
  const [id, setId] = useState('Desc_Motor_C');
  const [rate, setRate] = useState(10);
  const item = data.items[id];
  const top = SINKABLE.slice(0, 12);
  return (
    <>
      <Text k="guideText_sink" />
      <Box title={t('tryIt')}>
        <div className="codex-calc">
          <Picker
            ids={top.map((i) => i.id).concat(top.some((i) => i.id === id) ? [] : [id])}
            value={id}
            onChange={setId}
            label={t('item')}
          />
          <div className="codex-calc-row">
            <RateInput value={rate} label={t('perMin')} onChange={setRate} step />
            <span className="unit">
              {item.name} {t('perMin')}
            </span>
          </div>
          <div className="codex-readouts">
            <Readout label={t('pointsPerMin')} value={num(item.sink * rate)} tone="good" />
            <Readout label={t('pointsPerHour')} value={num(item.sink * rate * 60)} />
          </div>
        </div>
      </Box>
      <Box title={t('bestPoints')}>
        <div className="codex-bars">
          {top.map((i) => (
            <CodexLink key={i.id} page={{ kind: 'item', id: i.id }} className="codex-bar">
              <Icon id={i.id} size={30} />
              <span className="codex-bar-name">{i.name}</span>
              <span className="codex-bar-track">
                <span style={{ width: `${(i.sink / top[0].sink) * 100}%` }} />
              </span>
              <b>
                {num(i.sink)} {t('pointsShort')}
              </b>
            </CodexLink>
          ))}
        </div>
      </Box>
    </>
  );
}

/** The first hours, and the buildings each milestone tier brings. */
function Start() {
  const { t } = useT();
  const index = useCodex();
  const tiers = useMemo(() => {
    if (!index) return [];
    return Array.from({ length: 10 }, (_, tier) => {
      const ids = index.data.schematics
        .filter((s) => (s.type === 'milestone' || s.type === 'hub') && s.tier === tier)
        .flatMap((s) => s.unlocks.filter((u) => index.data.buildings[u] || index.data.vehicles[u]));
      return { tier, ids: [...new Set(ids)] };
    }).filter((x) => x.ids.length);
  }, [index]);
  return (
    <>
      <Text k="guideText_start" />
      {index && tiers.length > 0 && (
        <Box title={t('startTiers')}>
          <div className="codex-tier-rows">
            {tiers.map(({ tier, ids }) => (
              <div key={tier} className="codex-tier-row">
                <CodexLink page={{ kind: 'cat', id: 'milestones' }} className="codex-tier-label">
                  {t('tierN', { tier })}
                </CodexLink>
                <div className="codex-tier-icons">
                  {ids.map((id) => (
                    <CodexLink
                      key={id}
                      page={{ kind: index.data.buildings[id] ? 'building' : 'vehicle', id }}
                      className="slot"
                      title={nameOf(id, index.data)}
                    >
                      <Icon id={id} size={36} />
                    </CodexLink>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Box>
      )}
    </>
  );
}

/** Raw resources behind a number of parts, from each part's worked-out line. Water left out. */
function rawBehind(index: CodexIndex, cost: { item: string; amount: number }[]) {
  const total = new Map<string, number>();
  for (const c of cost) {
    const line = index.data.insights.items[c.item]?.line;
    if (!line) continue;
    for (const r of line.raw) total.set(r.item, (total.get(r.item) ?? 0) + (r.rate / line.rate) * c.amount);
  }
  return [...total]
    .filter(([id]) => id !== 'Desc_Water_C')
    .map(([item, rate]) => ({ item, rate: Math.round(rate) }))
    .sort((a, b) => b.rate - a.rate);
}

function Elevator() {
  const { t, num } = useT();
  const index = useCodex();
  return (
    <>
      <Text k="guideText_elevator" />
      {index && (
        <>
          <Box title={t('elevatorPhases')}>
            <PhaseList index={index} />
          </Box>
          <Box title={t('elevatorRawTitle')}>
            <div className="codex-table-wrap">
              <table className="codex-table codex-compare">
                <thead>
                  <tr>
                    <th>{t('phase')}</th>
                    <th>{t('elevatorRawCol')}</th>
                    <th className="num">{t('total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {index.data.phases.map((p) => {
                    const raw = rawBehind(index, p.cost);
                    return (
                      <tr key={p.phase}>
                        <td>
                          <b>{t('phaseN', { n: p.phase })}</b>
                          <span className="codex-compare-note">{phaseOpens(p, index, t)}</span>
                        </td>
                        <td>
                          <Flows list={raw} index={index} total />
                        </td>
                        <td className="num">{num(raw.reduce((n, r) => n + r.rate, 0))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="hint">{t('elevatorRawNote')}</p>
          </Box>
        </>
      )}
    </>
  );
}

function Power() {
  const { t, num } = useT();
  const index = useCodex();
  return (
    <>
      <Text k="guideText_power" />
      {index && (
        <Box title={t('powerCompare')}>
          <div className="codex-table-wrap">
            <table className="codex-table codex-compare">
              <thead>
                <tr>
                  <th>{t('fuel')}</th>
                  <th>{t('powerRawCol')}</th>
                  <th className="num">{t('powerPerRaw')}</th>
                  <th className="num">{t('powerChain')}</th>
                </tr>
              </thead>
              {data.generators
                .filter((g) => g.kind === 'fuel')
                .map((g) => (
                  <tbody key={g.id}>
                    <tr className="codex-group-row">
                      <td colSpan={4}>
                        <CodexLink page={{ kind: 'building', id: g.id }} className="codex-machine">
                          <Icon id={g.id} size={28} />
                          {g.name} · {num(g.power)} {t('mw')}
                        </CodexLink>
                      </td>
                    </tr>
                    {index.data.insights.fuels
                      .filter((f) => f.generator === g.id)
                      .map((f) => {
                        const byHand = f.missing.length > 0;
                        return (
                          <tr key={f.fuel}>
                            <td>
                              <CodexLink page={{ kind: 'item', id: f.fuel }} className="codex-machine">
                                <Icon id={f.fuel} size={24} />
                                {nameOf(f.fuel, index.data)}
                              </CodexLink>
                            </td>
                            <td>
                              {f.raw.length > 0 && <Flows list={rawOrder(f.raw)} index={index} />}
                              {byHand && (
                                <span className="codex-compare-note">
                                  {t('needsBroughtIn', { list: f.missing.map((m) => nameOf(m.item, index.data)).join(', ') })}
                                </span>
                              )}
                            </td>
                            <td className="num">{f.rawTotal > 0 && !byHand ? num(Math.round((f.mw / f.rawTotal) * 10) / 10) : '–'}</td>
                            <td className="num">{f.chainPower > 0.05 ? `${num(Math.round(f.chainPower * 10) / 10)} ${t('mw')}` : '–'}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                ))}
            </table>
          </div>
          <p className="hint">{t('powerCompareNote')}</p>
        </Box>
      )}
    </>
  );
}

const OIL = 'Desc_LiquidOil_C';
const OIL_LEFTOVERS = ['Desc_HeavyOilResidue_C', 'Desc_PolymerResin_C'];
const plainName = (r: { name: string; kind: string }) => recipeLabel(r.name, r.kind);

/** Crude oil and what it turns into: each refinery recipe, what it leaves, and where that goes. */
function Oil() {
  const { t, num } = useT();
  const index = useCodex();
  const oil = data.recipes
    .filter((r) => r.inputs.some((i) => i.item === OIL) && r.kind !== 'converter')
    .sort((a, b) => Number(a.kind === 'alternate') - Number(b.kind === 'alternate') || a.name.localeCompare(b.name));
  const uses = (item: string) => data.recipes.filter((r) => r.inputs.some((i) => i.item === item) && r.kind !== 'power');
  return (
    <>
      <Text k="guideText_oil" />
      {index && (
        <>
          <Box title={t('oilRecipes')}>
            <div className="codex-table-wrap">
              <table className="codex-table codex-compare">
                <thead>
                  <tr>
                    <th>{t('recipe')}</th>
                    <th>{t('oilIn')}</th>
                    <th>{t('oilOut')}</th>
                  </tr>
                </thead>
                <tbody>
                  {oil.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span className="codex-compare-name">
                          <CodexLink page={{ kind: 'item', id: r.outputs[0].item }} className="codex-machine">
                            <Icon id={r.outputs[0].item} size={24} />
                            {plainName(r)}
                          </CodexLink>
                          {r.kind === 'alternate' && <span className="codex-pill alt">{t('altShort')}</span>}
                        </span>
                      </td>
                      <td>
                        <Flows list={r.inputs} index={index} />
                      </td>
                      <td>
                        <Flows list={r.outputs} index={index} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">{t('oilNote')}</p>
          </Box>
          {OIL_LEFTOVERS.map((b) => (
            <Box key={b} title={t('oilWhereTo', { item: nameOf(b, index.data) })}>
              <div className="codex-uses">
                {uses(b).map((r) => (
                  <CodexLink key={r.id} page={{ kind: 'item', id: r.outputs[0].item }} className="codex-use">
                    <Icon id={r.outputs[0].item} size={30} />
                    <span className="codex-use-name">{plainName(r)}</span>
                    {r.kind === 'alternate' && <span className="codex-pill alt">{t('altShort')}</span>}
                    <span className="codex-use-rate">
                      {num(r.inputs.find((i) => i.item === b)?.rate ?? 0)}
                      {t('m3PerMin')}
                    </span>
                  </CodexLink>
                ))}
              </div>
            </Box>
          ))}
        </>
      )}
    </>
  );
}

function Nuclear() {
  const { t, num } = useT();
  const index = useCodex();
  const plant = generatorById.get('Build_GeneratorNuclear_C');
  return (
    <>
      <Text k="guideText_nuclear" />
      {index && plant && (
        <Box title={t('atAGlance')}>
          <div className="codex-table-wrap">
            <table className="codex-table codex-compare">
              <thead>
                <tr>
                  <th>{t('fuel')}</th>
                  <th className="num">{t('mw')}</th>
                  <th className="num">{t('burns')}</th>
                  <th className="num">{t('rodLasts')}</th>
                  <th>{t('waste')}</th>
                </tr>
              </thead>
              <tbody>
                {plant.fuels.map((f) => {
                  const rate = fuelRate(plant, f.item);
                  return (
                    <tr key={f.item}>
                      <td>
                        <CodexLink page={{ kind: 'item', id: f.item }} className="codex-machine">
                          <Icon id={f.item} size={24} />
                          {nameOf(f.item, index.data)}
                        </CodexLink>
                      </td>
                      <td className="num">{num(plant.power)}</td>
                      <td className="num">
                        {num(rate)}
                        {t('perMin')}
                      </td>
                      <td className="num">{t('minutesShort', { n: num(1 / rate) })}</td>
                      <td>
                        {f.byproduct && f.byproductAmount ? (
                          <Flows list={[{ item: f.byproduct, rate: rate * f.byproductAmount }]} index={index} />
                        ) : (
                          t('noWaste')
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint">{t('nuclearNote', { water: num((plant.power * 60 * plant.supplementRatio) / 1000) })}</p>
        </Box>
      )}
    </>
  );
}

type AltSort = 'raw' | 'power' | 'buildings';

/** Every alternate against the standard recipe for the same part, whole lines compared. */
function Alternates() {
  const { t } = useT();
  const index = useCodex();
  const [sort, setSort] = useState<AltSort>('raw');
  const rows = useMemo(() => {
    if (!index) return [];
    return index.data.schematics
      .filter((s) => s.type === 'alternate')
      .flatMap((s) => {
        const r = s.unlocks.map((u) => recipeById.get(u)).find(Boolean);
        const vs = r && versusStandard(index.data.insights.items[r.outputs[0].item], r.id);
        return r && vs && !vs.needsMore ? [{ s, r, vs }] : [];
      });
  }, [index]);
  const sorted = [...rows].sort((a, b) => a.vs[sort] - b.vs[sort]);
  return (
    <>
      <Text k="guideText_alternates" />
      {index && (
        <Box title={t('altAll', { n: rows.length })}>
          <div className="segmented codex-sort" role="radiogroup" aria-label={t('sortBy')}>
            {(['raw', 'power', 'buildings'] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={sort === k} onClick={() => setSort(k)}>
                {t(`sort_${k}`)}
              </button>
            ))}
          </div>
          <div className="codex-table-wrap">
            <table className="codex-table codex-compare">
              <thead>
                <tr>
                  <th>{t('alternate')}</th>
                  <th>{t('item')}</th>
                  <th className="num">{t('lineRaw')}</th>
                  <th className="num">{t('linePower')}</th>
                  <th className="num">{t('lineBuildings')}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(({ s, r, vs }) => (
                  <tr key={s.id}>
                    <td>
                      <CodexLink page={{ kind: 'schematic', id: s.id }} className="codex-machine">
                        <Icon id={r.outputs[0].item} size={24} />
                        {plainName({ name: s.name, kind: 'alternate' })}
                      </CodexLink>
                    </td>
                    <td>
                      <CodexLink page={{ kind: 'item', id: r.outputs[0].item }} className="codex-machine">
                        {nameOf(r.outputs[0].item, index.data)}
                      </CodexLink>
                    </td>
                    <td className="num">
                      <Delta share={vs.raw} />
                    </td>
                    <td className="num">
                      <Delta share={vs.power} />
                    </td>
                    <td className="num">
                      <Delta share={vs.buildings} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">{t('altAllNote')}</p>
        </Box>
      )}
    </>
  );
}

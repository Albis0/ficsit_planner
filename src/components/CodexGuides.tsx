import { type ReactNode, useState } from 'react';
import { GUIDE_ICON, type GuideId } from '../lib/codex';
import { data, transportFor } from '../lib/data';
import { PURITIES, PURITY } from '../lib/extraction';
import { useT } from '../lib/i18n';
import { fuelRate, MAX_CLOCK } from '../lib/power';
import { shardsFor } from '../lib/solver';
import { CodexLink } from './Codex';
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
          <span className="codex-tag">{t('cat_guides')}</span>
          <h2 className="codex-title">{t(`guide_${id}`)}</h2>
          <p className="codex-lead">{t(`guideSub_${id}`)}</p>
        </div>
      </header>
      {id === 'overclock' && <Overclock />}
      {id === 'sloops' && <Sloops />}
      {id === 'nodes' && <Nodes />}
      {id === 'fuel' && <Fuel />}
      {id === 'transport' && <Transport />}
      {id === 'world' && <World />}
      {id === 'sink' && <Sink />}
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
      </Box>
      <Box title={t('pipesTitle')}>
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

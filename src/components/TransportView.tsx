import { data, type Item } from '../lib/data';
import { useT } from '../lib/i18n';
import type { SolveResult } from '../lib/solver';
import { type Carrier, carriersFor, type Haul, haul } from '../lib/transport';
import { type Route, usePlan, useStore } from '../store';
import type { FactoryLinks } from './GraphView';
import { Icon } from './Icon';
import { RateInput } from './RateInput';
import { Slot } from './Slot';

const VEHICLE_ICON: Record<Exclude<Carrier, 'line'>, string> = {
  train: 'Desc_Locomotive_C',
  truck: 'Desc_Truck_C',
  fluidTruck: 'Desc_FluidTruck_C',
  tractor: 'Desc_Tractor_C',
  explorer: 'Desc_Explorer_C',
  drone: 'Desc_DroneTransport_C',
};

const fluid = (item: Item) => item.form !== 'solid';

/** What a carrier is called on its button: belt or pipe, train, or the vehicle's own name. */
export function useCarrierLabel() {
  const { t, name } = useT();
  return (c: Carrier, item: Item) =>
    c === 'line'
      ? t(fluid(item) ? 'carrierPipe' : 'carrierBelt')
      : c === 'train'
        ? t('carrierTrain')
        : name(data.vehicles.find((v) => v.id === VEHICLE_ICON[c]));
}

const carrierIcon = (c: Carrier, item: Item, tier: number) =>
  c === 'line' ? haul(item, 0, 'line', 0, tier).line!.transport.id : VEHICLE_ICON[c];

/** Minutes and seconds, "4:10". */
const clock = (seconds: number) => {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** What a haul takes: vehicles and stations as slots, then the trip, the power and the fuel or batteries. */
export function HaulResult({ h, item }: { h: Haul; item: Item }) {
  const { t, num } = useT();
  if (h.line) {
    const { transport, lanes } = h.line;
    return (
      <div className="haul-result">
        <Slot id={transport.id} rate={lanes} size={48} />
        <span className="haul-stat">{t(fluid(item) ? 'pipeName' : 'beltName', { mk: transport.name })}</span>
      </div>
    );
  }
  if (h.vehicles === 0) return <div className="haul-result haul-none">—</div>;
  return (
    <div className="haul-result">
      <Slot
        id={h.carrier === 'train' ? 'Desc_FreightWagon_C' : VEHICLE_ICON[h.carrier as Exclude<Carrier, 'line'>]}
        rate={h.vehicles}
        size={48}
      />
      {h.locomotives ? <Slot id="Desc_Locomotive_C" rate={h.locomotives} size={48} /> : null}
      {h.stations.map((s) => (
        <Slot key={s.station.id} id={s.station.id} rate={s.count} size={48} />
      ))}
      <span className="haul-stats">
        {h.roundTrip !== undefined && <span className="haul-stat">{t('roundTrip', { time: clock(h.roundTrip) })}</span>}
        <span className="haul-stat">{t('upToMw', { mw: num(h.power) })}</span>
        {h.fuel !== undefined && h.fuel > 0 && <span className="haul-stat">{t('fuelMw', { mw: num(h.fuel) })}</span>}
        {h.batteries && <span className="haul-stat">{t('batteriesPerMin', { n: num(h.batteries.perMinute) })}</span>}
        {h.estimate && <span className="estimate-tag">{t('estimate')}</span>}
      </span>
    </div>
  );
}

interface Row {
  key: string;
  item: string;
  rate: number;
  note: string;
}

/** One row per item and direction: ore both mined and brought in, or a product with some left over, travel together. */
const merge = (rows: Row[]): Row[] => {
  const by = new Map<string, Row>();
  for (const r of rows) {
    const seen = by.get(r.key);
    by.set(r.key, seen ? { ...seen, rate: seen.rate + r.rate, note: [seen.note, r.note].filter(Boolean).join(' · ') } : r);
  }
  return [...by.values()];
};

/** One input or output: what it is, how it travels (picked here), how far, and what that takes. */
function HaulCard({ row, route, tier }: { row: Row; route: Route; tier: number }) {
  const { t, name, num } = useT();
  const label = useCarrierLabel();
  const plan = usePlan();
  const updatePlan = useStore((s) => s.updatePlan);
  const item = data.items[row.item];
  const options = carriersFor(item, tier);
  const by = options.includes(route.by) ? route.by : 'line';
  const h = haul(item, row.rate, by, route.distance, tier);
  const save = (next: Route) => {
    const { [row.key]: _, ...rest } = plan.transport ?? {};
    updatePlan({ transport: next.by === 'line' && next.distance === 1000 ? rest : { ...rest, [row.key]: next } });
  };
  return (
    <li className="haul">
      <div className="haul-head">
        <Icon id={row.item} size={40} />
        <span className="haul-name">
          <b>
            {num(row.rate)}
            {fluid(item) ? t('m3PerMin') : t('perMin')}
          </b>{' '}
          {name(item)}
        </span>
        <span className="haul-note">{row.note}</span>
      </div>
      <div className="haul-pick" role="radiogroup" aria-label={`${t('carriedBy')}: ${name(item)}`}>
        {options.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === by}
            title={label(c, item)}
            onClick={() => save({ ...route, by: c })}
          >
            <Icon id={carrierIcon(c, item, tier)} size={28} />
            <span>{label(c, item)}</span>
          </button>
        ))}
      </div>
      {by !== 'line' && (
        <div className="haul-distance">
          <span className="control-label">{t('distanceOneWay')}</span>
          <RateInput
            value={route.distance}
            label={`${t('distanceOneWay')}: ${name(item)}`}
            max={100000}
            onChange={(v) => save({ by, distance: v })}
          />
          <span className="haul-unit">m</span>
        </div>
      )}
      <HaulResult h={h} item={item} />
    </li>
  );
}

/**
 * The factory's third view: everything that comes in and goes out, each with how it travels and what that takes in
 * vehicles, stations and power. Belts and pipes unless a vehicle is picked.
 */
export function TransportView({ result, links }: { result: SolveResult; links?: FactoryLinks }) {
  const { t, num } = useT();
  const plan = usePlan();
  const tier = useStore((s) => s.tier);
  const routes = plan.transport ?? {};
  const routeOf = (key: string): Route => routes[key] ?? { by: 'line', distance: 1000 };

  const incoming: Row[] = merge([
    ...result.raw.map((x) => ({ key: `in:${x.item}`, item: x.item, rate: x.rate, note: t('rawInput') })),
    ...result.supplies.map((x) => {
      const from = links?.from.get(x.item);
      return { key: `in:${x.item}`, item: x.item, rate: x.rate, note: from ? t('fromFactoryLabel', { name: from }) : t('fromAnywhere') };
    }),
  ]);
  const outgoing: Row[] = merge([
    ...result.targets.map((x) => {
      const to = links?.to.get(x.item)?.map((d) => d.name) ?? [];
      const own = links?.own.has(x.item) ?? true;
      const note = [...(own ? [t('productLabel')] : []), ...to.map((n) => t('toFactoryLabel', { name: n }))].join(' · ');
      return { key: `out:${x.item}`, item: x.item, rate: x.rate, note };
    }),
    ...result.surplus.map((x) => ({ key: `out:${x.item}`, item: x.item, rate: x.rate, note: t('surplus') })),
  ]);

  // Everything the routes take together: vehicles and stations by building, and the power for all of them.
  const total = new Map<string, number>();
  let power = 0;
  for (const row of [...incoming, ...outgoing]) {
    const item = data.items[row.item];
    const route = routeOf(row.key);
    const by = carriersFor(item, tier).includes(route.by) ? route.by : 'line';
    if (by === 'line') continue;
    const h = haul(item, row.rate, by, route.distance, tier);
    const add = (id: string, n: number) => n > 0 && total.set(id, (total.get(id) ?? 0) + n);
    add(by === 'train' ? 'Desc_FreightWagon_C' : VEHICLE_ICON[by], h.vehicles);
    add('Desc_Locomotive_C', h.locomotives ?? 0);
    for (const s of h.stations) add(s.station.id, s.count);
    power += h.power;
  }

  const list = (title: string, rows: Row[]) =>
    rows.length > 0 && (
      <section className="haul-group">
        <h3 className="section-title">{title}</h3>
        <ul className="haul-list">
          {rows.map((row) => (
            <HaulCard key={row.key} row={row} route={routeOf(row.key)} tier={tier} />
          ))}
        </ul>
      </section>
    );

  return (
    <div className="transport-wrap">
      {list(t('comingIn'), incoming)}
      {list(t('goingOut'), outgoing)}
      {total.size > 0 && (
        <section className="haul-group haul-total">
          <h3 className="section-title">{t('transportTotal')}</h3>
          <div className="slots">
            {[...total].map(([id, n]) => (
              <Slot key={id} id={id} rate={n} size={64} />
            ))}
          </div>
          <span className="haul-stat">{t('upToMw', { mw: num(power) })}</span>
        </section>
      )}
      <p className="hint">{t('transportNote')}</p>
    </div>
  );
}

import { craftableItems, data, itemLocked } from '../../lib/data';
import { useT } from '../../lib/i18n';
import type { CalcResult } from '../../lib/model/calc/result';
import { cardSize, freeSpot } from '../../lib/model/layout';
import { addNode, removeNodes, updateNode } from '../../lib/model/ops';
import { isPart, type IoNode, type Model } from '../../lib/model/types';
import type { SolveResult } from '../../lib/solver';
import { useStore } from '../../store';
import { ItemPicker } from '../ItemPicker';
import { RateInput } from '../RateInput';
import { Slot } from '../Slot';
import { type ModelHost, revealCard } from './ModelEditor';

/** Anything can come in from outside a hand-built floor, ore by train included. */
const inItems = Object.values(data.items);

/** What reaches an output card, a minute, and the item on it when the card takes anything. */
function arriving(model: Model, calc: CalcResult | undefined, id: string): { rate: number; item?: string } {
  let rate = 0;
  let item: string | undefined;
  for (const l of model.links) {
    if (l.b !== id && l.a !== id) continue;
    const c = calc?.links[l.id];
    if (!c) continue;
    rate += c.rate;
    item ??= c.items[0]?.[0];
  }
  return { rate, item };
}

/** A new card off to the right of the floor, at the top, where it lies on nothing. */
function spotFor(model: Model, kind: 'in' | 'out'): { x: number; y: number } {
  const parts = model.nodes.filter(isPart);
  if (!parts.length) return { x: 0, y: 0 };
  const size = cardSize({ id: '', k: kind, x: 0, y: 0 });
  const top = Math.min(...parts.map((n) => n.y));
  const x = kind === 'out' ? Math.max(...parts.map((n) => n.x + cardSize(n).w)) + 120 : Math.min(...parts.map((n) => n.x)) - size.w - 120;
  return freeSpot(model.nodes, { x, y: top, ...size });
}

/**
 * The side panel on a hand-built floor: what the floor puts out and what comes into it, read from the floor itself, so
 * the two always agree. Amounts set here are the most each output takes or each input brings; adding one puts its
 * card on the floor, ready for a belt.
 */
export function FloorPanel({ host, calc, result }: { host: ModelHost; calc?: CalcResult; result?: SolveResult }) {
  const { t, name, num } = useT();
  const set = useStore((s) => s.set);
  const tier = useStore((s) => s.tier);
  const showLocked = useStore((s) => s.settings.showLocked);
  const { model } = host;
  const shown = calc?.mode === 'off' ? undefined : calc;
  const outs = model.nodes.filter((n): n is IoNode => n.k === 'out' && n.tag !== 'spare');
  const ins = model.nodes.filter((n): n is IoNode => n.k === 'in');

  const add = (kind: 'in' | 'out', item: string) => {
    let made = '';
    host.edit((m) => {
      const added = addNode(m, { k: kind, item, ...spotFor(m, kind) });
      made = added.id;
      return added.model;
    });
    set({ inspect: made });
    revealCard(made);
  };

  const row = (n: IoNode, size: number) => {
    const flow = arriving(model, shown, n.id);
    const item = n.item ?? flow.item;
    const it = item ? data.items[item] : undefined;
    const value = n.lim ?? (shown ? Math.round(flow.rate * 1e4) / 1e4 : Number.NaN);
    // A limit set and something else arriving: say what actually comes.
    const differs = shown && n.lim !== undefined && Math.abs(flow.rate - n.lim) > 1e-6;
    return (
      <div className="item-card floor-io" key={n.id}>
        {it ? <Slot id={it.id} size={size} /> : <span className="slot-empty" style={{ width: size, height: size }} />}
        <button
          type="button"
          className="item-card-name floor-io-name"
          onClick={() => {
            set({ inspect: n.id });
            revealCard(n.id);
          }}
        >
          {it ? name(it) : t('anything')}
          {differs && <small className="floor-io-now">{t('floorNow', { n: num(flow.rate) })}</small>}
        </button>
        <span className="item-card-rate">
          <RateInput
            value={value}
            label={it ? name(it) : t('anything')}
            placeholder={t('noLimit')}
            onChange={(v) => host.edit((m) => updateNode(m, n.id, { lim: v }), `${n.id}:lim`)}
            onClear={() => host.edit((m) => updateNode(m, n.id, { lim: undefined }), `${n.id}:lim`)}
            step
          />
          <span className="unit">{t('perMin')}</span>
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label={`${t('remove')} ${it ? name(it) : t('anything')}`}
          onClick={() => host.edit((m) => removeNodes(m, [n.id]))}
        >
          ×
        </button>
      </div>
    );
  };

  const surplus = result?.surplus ?? [];
  return (
    <div className="panel-body targets manual">
      <section className="stack">
        <h3 className="section-title">{t('productsTitle')}</h3>
        {outs.map((n) => row(n, 64))}
        <ItemPicker
          items={showLocked ? craftableItems : craftableItems.filter((i) => !itemLocked(i.id, tier))}
          label={t('addProduct')}
          onPick={(id) => add('out', id)}
          exclude={outs.flatMap((n) => (n.item ? [n.item] : []))}
        />
        {surplus.length > 0 && (
          <>
            <h3 className="section-title exports-title">{t('floorLeftOver')}</h3>
            <ul className="exports-list">
              {surplus.map((x) => (
                <li key={x.item}>
                  <Slot id={x.item} size={40} />
                  <span className="exports-text">
                    <b>
                      {num(x.rate)}
                      {t('perMin')}
                    </b>{' '}
                    {name(data.items[x.item])}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="stack">
        <h3 className="section-title">{t('floorComesIn')}</h3>
        {ins.map((n) => row(n, 52))}
        <ItemPicker
          items={inItems}
          label={t('addSupply')}
          onPick={(id) => add('in', id)}
          exclude={ins.flatMap((n) => (n.item ? [n.item] : []))}
        />
      </section>
    </div>
  );
}

import type { ReactNode } from 'react';
import { craftableItems, data, itemLocked } from '../lib/data';
import { useT } from '../lib/i18n';
import type { SolveResult, Target } from '../lib/solver';
import { useExports } from '../lib/solution';
import { usePlan, useStore } from '../store';
import { InventoryPanel } from './InventoryPanel';
import { ItemPicker } from './ItemPicker';
import { RateInput } from './RateInput';
import { Slot } from './Slot';

const supplyItems = Object.values(data.items).filter((i) => !i.raw);

/** Item cards with an amount each: targets, or items already on hand. */
export function Cards({
  list,
  size,
  onRate,
  onRemove,
  extra,
}: {
  list: Target[];
  size: number;
  onRate: (i: number, v: number) => void;
  onRemove: (i: number) => void;
  /** More under the name, e.g. which factory an on-hand item comes from. */
  extra?: (i: number) => ReactNode;
}) {
  const { t, name } = useT();
  return list.map((target, i) => {
    const item = data.items[target.item];
    return (
      <div className="item-card" key={target.item}>
        <Slot id={item.id} size={size} />
        <span className="item-card-name">
          {name(item)}
          {extra?.(i)}
        </span>
        <span className="item-card-rate">
          <RateInput value={target.rate} label={name(item)} onChange={(v) => onRate(i, v)} step />
          <span className="unit">{t('perMin')}</span>
        </span>
        <button type="button" className="icon-button" aria-label={`${t('remove')} ${name(item)}`} onClick={() => onRemove(i)}>
          ×
        </button>
      </div>
    );
  });
}

export function TargetsPanel({ result }: { result?: SolveResult }) {
  const { t, name, num } = useT();
  const plan = usePlan();
  const s = useStore();
  const others = s.plans.filter((p) => p.id !== plan.id);
  const exports = useExports(plan.id);
  // Taken from the tab that already makes it, if one does; the source can be changed on the card.
  const made = new Map<string, string>();
  for (const o of others) for (const x of o.targets) if (!made.has(x.item)) made.set(x.item, o.id);

  return (
    <div className="panel-body targets">
      <section className="stack">
        <h3 className="section-title">{t('productsTitle')}</h3>
        <Cards list={plan.targets} size={64} onRate={s.setTarget} onRemove={s.removeTarget} />
        <ItemPicker
          items={s.settings.hideLocked ? craftableItems.filter((i) => !itemLocked(i.id, s.tier)) : craftableItems}
          label={t('addProduct')}
          onPick={s.addTarget}
          exclude={plan.targets.map((x) => x.item)}
        />
        {exports.length > 0 && (
          <>
            <h3 className="section-title exports-title">{t('exportsTitle')}</h3>
            <ul className="exports-list">
              {exports.map((x) => (
                <li key={`${x.to}-${x.item}`}>
                  <Slot id={x.item} size={40} />
                  <span className="exports-text">
                    <b>
                      {num(x.rate)}
                      {t('perMin')}
                    </b>{' '}
                    {name(data.items[x.item])}
                  </span>
                  <button type="button" className="text-button" onClick={() => s.set({ active: x.to, inspect: undefined })}>
                    {t('toFactory', { name: s.plans.find((p) => p.id === x.to)?.name ?? '' })}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="stack">
        <h3 className="section-title">{t('suppliesTitle')}</h3>
        <Cards
          list={plan.supplies}
          size={52}
          onRate={s.setSupply}
          onRemove={s.removeSupply}
          extra={(i) =>
            others.length > 0 && (
              <label className="supply-from">
                <span>{t('comesFrom')}</span>
                <select value={plan.supplies[i].from ?? ''} onChange={(e) => s.setSupplyFrom(i, e.target.value || undefined)}>
                  <option value="">{t('fromAnywhere')}</option>
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            )
          }
        />
        <ItemPicker
          items={supplyItems}
          label={t('addSupply')}
          onPick={(id) => s.addSupply(id)}
          exclude={plan.supplies.map((x) => x.item)}
        />
        {others.length > 0 && (
          <ItemPicker
            items={supplyItems}
            label={t('takeFromFactory')}
            onPick={(id) => s.addSupply(id, 10, made.get(id) ?? others[0].id)}
            exclude={plan.supplies.map((x) => x.item)}
          />
        )}
      </section>

      <InventoryPanel result={result} />
    </div>
  );
}

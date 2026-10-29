import { useShallow } from 'zustand/react/shallow';
import type { ReactNode } from 'react';
import { craftableItems, data, itemLocked } from '../lib/data';
import { useT } from '../lib/i18n';
import { minerLabel } from '../lib/text';
import { MINERS } from '../lib/extraction';
import type { SolveResult, Target } from '../lib/solver';
import { useExports } from '../lib/solution';
import { usePool } from '../lib/overview';
import { haveOff, haveOn, POOL, toggleLine, togglePooled, usePlan, useStore } from '../store';
import { ExtractionControls, useExtraction } from './ExtractionControls';
import { Fold } from './Fold';
import { InventoryPanel } from './InventoryPanel';
import { ItemPicker } from './ItemPicker';
import { RateInput } from './RateInput';
import { Slot } from './Slot';
import { SupplyAdd } from './SupplyAdd';

const supplyItems = Object.values(data.items).filter((i) => !i.raw);
// What can be on hand as a pin: the raw resources, water aside (it is everywhere).
const rawItems = Object.values(data.items).filter((i) => i.raw && i.id !== 'Desc_Water_C');

/** Item cards with an amount each: targets, or items already on hand. */
export function Cards({
  list,
  size,
  onRate,
  onRemove,
  extra,
  locked,
}: {
  list: Target[];
  size: number;
  onRate: (i: number, v: number) => void;
  onRemove: (i: number) => void;
  /** More under the name, e.g. which factory an on-hand item comes from. */
  extra?: (i: number) => ReactNode;
  /** The amounts are worked out, not typed. */
  locked?: boolean;
}) {
  const { t, name } = useT();
  return list.map((target, i) => {
    const item = data.items[target.item];
    const more = extra?.(i);
    return (
      <div className={`item-card ${more ? 'has-extra' : ''}`} key={target.item}>
        <Slot id={item.id} size={size} />
        <span className="item-card-main">
          <span className="item-card-name">{name(item)}</span>
          {more && <span className="item-card-extra">{more}</span>}
        </span>
        <span className="item-card-rate">
          <RateInput value={target.rate} label={name(item)} onChange={(v) => onRate(i, v)} step disabled={locked} />
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
  const s = useStore(
    useShallow((x) => ({
      addSupply: x.addSupply,
      addTarget: x.addTarget,
      plans: x.plans,
      power: x.power,
      removeSupply: x.removeSupply,
      removeTarget: x.removeTarget,
      set: x.set,
      setSupply: x.setSupply,
      setFixed: x.setFixed,
      setSupplyFrom: x.setSupplyFrom,
      setTarget: x.setTarget,
      settings: x.settings,
      tier: x.tier,
      updatePlan: x.updatePlan,
    })),
  );
  const others = s.plans.filter((p) => p.id !== plan.id);
  // What the tier can't make yet stays out of every list, unless Settings shows it.
  const unlocked = (list: typeof supplyItems) => (s.settings.showLocked ? list : list.filter((i) => !itemLocked(i.id, s.tier)));
  const later = (list: typeof supplyItems) => (s.settings.showLocked ? undefined : list.filter((i) => itemLocked(i.id, s.tier)));
  const exports = useExports(plan.id);
  // The pool (what the other factories and the plants leave over) is worked out only once there is something to take it from.
  const poolOn = others.length > 0 || s.power.some((p) => p.plants.length > 0);
  const pool = usePool(plan.id, poolOn);
  const have = !!plan.have;
  const onHand = Object.keys(plan.fixed);
  // "I have" with something on hand: the products show the most that allows, and can't be typed.
  const worked = have && onHand.length > 0 && result ? result.targets : undefined;
  const products = worked
    ? plan.targets.map((x) => ({ ...x, rate: Math.round((worked.find((y) => y.item === x.item)?.rate ?? x.rate) * 100) / 100 }))
    : plan.targets;
  const setHave = (on: boolean) => s.updatePlan(on ? haveOn(result?.raw ?? []) : haveOff());

  const onHandItems = (
    <>
      <Cards
        list={plan.supplies}
        size={52}
        onRate={s.setSupply}
        onRemove={s.removeSupply}
        extra={(i) => {
          const supply = plan.supplies[i];
          const left = pool.find((l) => l.item === supply.item)?.left ?? 0;
          return (
            poolOn && (
              <>
                <label className="supply-from">
                  <span>{t('comesFrom')}</span>
                  <select value={supply.from ?? ''} onChange={(e) => s.setSupplyFrom(i, e.target.value || undefined)}>
                    <option value="">{t('fromAnywhere')}</option>
                    <option value={POOL}>{t('thePool')}</option>
                    {others.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
                {supply.from === POOL && (
                  <span className={`supply-pool ${supply.rate > left + 1e-6 ? 'short' : ''}`}>
                    {supply.rate > left + 1e-6
                      ? t('poolShort', { n: num(supply.rate - Math.max(0, left)) })
                      : t('poolHas', { n: num(left) })}
                  </span>
                )}
              </>
            )
          );
        }}
      />
      <SupplyAdd
        items={unlocked(supplyItems)}
        hidden={later(supplyItems)}
        exclude={plan.supplies.map((x) => x.item)}
        onAdd={(id, rate, from) => s.addSupply(id, rate, from)}
      />
    </>
  );

  return (
    <div className="panel-body targets">
      <section className="stack">
        <h3 className="section-title has-mode">
          {t('productsTitle')}
          <div className="segmented" role="radiogroup" aria-label={t('haveModeLabel')}>
            {([false, true] as const).map((on) => (
              <button key={String(on)} type="button" role="radio" aria-checked={have === on} onClick={() => have !== on && setHave(on)}>
                {t(on ? 'iHave' : 'iWant')}
              </button>
            ))}
          </div>
        </h3>
        <Cards
          list={products}
          size={64}
          locked={!!worked}
          onRate={s.setTarget}
          onRemove={s.removeTarget}
          extra={(i) => {
            const item = plan.targets[i].item;
            return (
              <>
                {plan.targets.length > 1 && (
                  <button
                    type="button"
                    className="line-toggle"
                    aria-pressed={!!plan.separate?.includes(item)}
                    title={t('ownLineHint')}
                    onClick={() => s.updatePlan(toggleLine(item))}
                  >
                    {t('ownLine')}
                  </button>
                )}
                <button
                  type="button"
                  className="line-toggle"
                  aria-pressed={!!plan.pooled?.includes(item)}
                  title={t('toPoolHint')}
                  onClick={() => s.updatePlan(togglePooled(item))}
                >
                  <span className="when-wide">{t('toPool')}</span>
                  <span className="when-narrow">{t('toPoolShort')}</span>
                </button>
              </>
            );
          }}
        />
        {worked && <p className="have-note">{t('haveMost')}</p>}
        <ItemPicker
          items={unlocked(craftableItems)}
          hidden={later(craftableItems)}
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

      {have && (
        <Fold id="have" title={t('whatIHave')} summary={onHand.length} defaultOpen>
          <Cards
            list={onHand.map((item) => ({ item, rate: plan.fixed[item] }))}
            size={52}
            onRate={(i, v) => v > 0 && s.setFixed(onHand[i], v)}
            onRemove={(i) => s.setFixed(onHand[i], undefined)}
          />
          {onHand.length === 0 && <p className="have-note">{t('haveNone')}</p>}
          <ItemPicker
            items={rawItems}
            label={t('addHave')}
            onPick={(id) => s.setFixed(id, Math.round((result?.raw.find((x) => x.item === id)?.rate ?? 60) * 100) / 100)}
            exclude={onHand}
          />
          <h3 className="section-title have-sub">{t('suppliesTitle')}</h3>
          {onHandItems}
        </Fold>
      )}

      {!have && (
        <Fold id="supplies" title={t('suppliesTitle')} summary={plan.supplies.length} defaultOpen>
          {onHandItems}
        </Fold>
      )}

      <InventoryPanel result={result} />
      <MiningFold />
    </div>
  );
}

/** The miner, purity and clock again, folded to a line: in a narrow panel they sit here, not a tab away. */
function MiningFold() {
  const { t, name, num } = useT();
  const { ex } = useExtraction();
  const miner = MINERS.find((m) => m.id === ex.miner);
  const summary = [miner && minerLabel(name(miner)), t(ex.purity), `${num(Math.round(ex.clock * 10000) / 100)}%`]
    .filter(Boolean)
    .join(' · ');
  return (
    <Fold id="mining" title={t('extraction')} summary={summary} className="mining">
      <ExtractionControls />
    </Fold>
  );
}

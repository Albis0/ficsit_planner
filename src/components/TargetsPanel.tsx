import { craftableItems, data } from '../lib/data';
import { useT } from '../lib/i18n';
import type { SolveResult, Target } from '../lib/solver';
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
}: {
  list: Target[];
  size: number;
  onRate: (i: number, v: number) => void;
  onRemove: (i: number) => void;
}) {
  const { t, name } = useT();
  return list.map((target, i) => {
    const item = data.items[target.item];
    return (
      <div className="item-card" key={target.item}>
        <Slot id={item.id} size={size} />
        <span className="item-card-name">{name(item)}</span>
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
  const { t } = useT();
  const plan = usePlan();
  const s = useStore();

  return (
    <div className="panel-body targets">
      <section className="stack">
        <Cards list={plan.targets} size={64} onRate={s.setTarget} onRemove={s.removeTarget} />
        <ItemPicker items={craftableItems} label={t('addProduct')} onPick={s.addTarget} exclude={plan.targets.map((x) => x.item)} />
      </section>

      <section className="stack">
        <h3 className="section-title">{t('suppliesTitle')}</h3>
        <p className="hint">{t('suppliesHint')}</p>
        <Cards list={plan.supplies} size={52} onRate={s.setSupply} onRemove={s.removeSupply} />
        <ItemPicker
          items={supplyItems}
          label={t('addSupply')}
          onPick={(id) => s.addSupply(id)}
          exclude={plan.supplies.map((x) => x.item)}
        />
      </section>

      <InventoryPanel result={result} />
    </div>
  );
}

import { data, itemLocked } from '../lib/data';
import { useT } from '../lib/i18n';
import { usePool } from '../lib/overview';
import { POOL } from '../lib/pool';
import { usePlan, useStore } from '../store';
import { ItemPicker } from './ItemPicker';

type Item = (typeof data.items)[string];

/**
 * The buttons that add something a factory gets instead of making it: an item on hand, an item from the pool (when
 * the other tabs leave something over), or an item from another factory tab. Both floors use it; what a pick does is
 * theirs to say.
 */
export function SupplyAdd({
  items,
  hidden,
  exclude,
  onAdd,
}: {
  /** What "Item" offers. */
  items: Item[];
  hidden?: Item[];
  exclude: string[];
  onAdd: (item: string, rate: number, from?: string) => void;
}) {
  const { t } = useT();
  const plan = usePlan();
  const plans = useStore((s) => s.plans);
  const power = useStore((s) => s.power);
  const tier = useStore((s) => s.tier);
  const showLocked = useStore((s) => s.settings.showLocked);
  const others = plans.filter((p) => p.id !== plan.id);
  const poolOn = others.length > 0 || power.some((p) => p.plants.length > 0);
  const pool = usePool(plan.id, poolOn);
  const all = Object.values(data.items).filter((i) => !i.raw);
  const open = showLocked ? all : all.filter((i) => !itemLocked(i.id, tier));
  const later = showLocked ? undefined : all.filter((i) => itemLocked(i.id, tier));
  const poolItems = open.filter((i) => (pool.find((l) => l.item === i.id)?.left ?? 0) > 0.01);
  // Taken from the tab that already makes it, if one does; the source can be changed on the card.
  const made = new Map<string, string>();
  for (const o of others) for (const x of o.targets) if (!made.has(x.item)) made.set(x.item, o.id);

  return (
    <div className="add-row">
      <ItemPicker
        items={items}
        hidden={hidden}
        label={t('addSupply')}
        short={t('addSupplyShort')}
        onPick={(id) => onAdd(id, 10)}
        exclude={exclude}
      />
      {poolItems.length > 0 && (
        <ItemPicker
          items={poolItems}
          label={t('takeFromPool')}
          short={t('takeFromPoolShort')}
          onPick={(id) => onAdd(id, Math.min(10, Math.floor((pool.find((l) => l.item === id)?.left ?? 10) * 100) / 100), POOL)}
          exclude={exclude}
        />
      )}
      {others.length > 0 && (
        <ItemPicker
          items={open}
          hidden={later}
          label={t('takeFromFactory')}
          short={t('takeFromFactoryShort')}
          onPick={(id) => onAdd(id, 10, made.get(id) ?? others[0].id)}
          exclude={exclude}
        />
      )}
    </div>
  );
}

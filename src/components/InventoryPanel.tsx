import { useState } from 'react';
import { data, recipeById, recipeUnlocked } from '../lib/data';
import { useT } from '../lib/i18n';
import { recipeLabel } from '../lib/text';
import type { SolveResult } from '../lib/solver';
import { autoAssignAsync } from '../lib/solverClient';
import { usePlan, useStore } from '../store';
import { Icon } from './Icon';
import { RateInput } from './RateInput';

const SLOOP_ICON = 'Desc_WAT1_C';
const SHARD_ICON = 'Desc_CrystalShard_C';

/** How many somersloops and power shards you own, and a button to place them where they pay off most. */
export function InventoryPanel({ result }: { result?: SolveResult }) {
  const { t, name } = useT();
  const inventory = useStore((s) => s.inventory);
  const tier = useStore((s) => s.tier);
  const set = useStore((s) => s.set);
  const updatePlan = useStore((s) => s.updatePlan);
  const plan = usePlan();
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const placed = (result?.recipes ?? []).filter((u) => u.shards > 0 || u.sloops > 0);

  const place = async () => {
    setBusy(true);
    try {
      const mods = await autoAssignAsync(
        {
          targets: plan.targets.filter((x) => x.rate > 0),
          supplies: plan.supplies,
          enabledRecipes: new Set(plan.enabled.filter((id) => recipeUnlocked(recipeById.get(id)!, tier))),
          resourceCaps: plan.caps,
          objective: plan.objective,
          fixed: plan.fixed,
        },
        inventory,
      );
      updatePlan({ mods });
    } catch {
      // The plan itself failed to solve; the error already shows on the factory floor.
    } finally {
      setTried(true);
      setBusy(false);
    }
  };

  const row = (icon: string, label: string, key: 'sloops' | 'shards', used: number) => {
    const over = used > inventory[key];
    return (
      <div className="item-card flat inventory-row">
        <span className="slot" style={{ width: 52, height: 52, ['--slot-size' as string]: '52px' }}>
          <Icon id={icon} size={38} />
        </span>
        <span className="item-card-name">
          {label}
          <span className={`inventory-use ${over ? 'over' : ''}`} title={over ? t('overStock') : undefined}>
            {used} {t('inUse')}
          </span>
        </span>
        <RateInput value={inventory[key]} label={label} onChange={(v) => set({ inventory: { ...inventory, [key]: Math.floor(v) } })} />
      </div>
    );
  };

  return (
    <section className="stack">
      <h3 className="section-title">{t('inventory')}</h3>
      <p className="hint">{t('inventoryHint')}</p>
      {row(SLOOP_ICON, t('sloops'), 'sloops', result?.sloops ?? 0)}
      {row(SHARD_ICON, t('shards'), 'shards', result?.shards ?? 0)}
      <div className="inventory-actions">
        <button
          type="button"
          className="primary-button"
          disabled={busy || !result || (inventory.sloops === 0 && inventory.shards === 0)}
          onClick={place}
        >
          {busy ? t('placing') : t('autoPlace')}
        </button>
        {placed.length > 0 && (
          <button type="button" className="text-button" onClick={() => updatePlan({ mods: {} })}>
            {t('clearMods')}
          </button>
        )}
      </div>
      {placed.length > 0 && (
        <ul className="placements">
          {placed.map((u) => (
            <li key={u.recipe.id}>
              <button type="button" onClick={() => set({ inspect: u.recipe.id, view: 'graph' })}>
                <Icon id={u.recipe.machine} size={32} />
                <span className="placement-name">
                  {recipeLabel(name(u.recipe), u.recipe.kind)}
                  <small>{name(data.machines[u.recipe.machine])}</small>
                </span>
                {u.shards > 0 && <span className="mod-badge shard">{u.shards} ◆</span>}
                {u.sloops > 0 && <span className="mod-badge sloop">{u.sloops} ●</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {tried && !busy && placed.length === 0 && <p className="hint warn">{t('nothingPlaced')}</p>}
    </section>
  );
}

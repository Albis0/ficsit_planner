import { useState } from 'react';
import { data, recipeById, recipeUnlocked } from '../lib/data';
import { useT } from '../lib/i18n';
import { recipeLabel } from '../lib/text';
import { effectiveExtraction, overclockExtractors, planExtraction } from '../lib/extraction';
import { isDefaultGame } from '../lib/game';
import type { SolveInput, SolveResult } from '../lib/solver';
import { useExports, withExports } from '../lib/solution';
import { autoAssignAsync, solveAsync } from '../lib/solverClient';
import { aimOf, usePlan, useStore } from '../store';
import { Icon } from './Icon';
import { RateInput } from './RateInput';

const SLOOP_ICON = 'Desc_WAT1_C';
const SHARD_ICON = 'Desc_CrystalShard_C';

/** How many somersloops and power shards you own, and a button to place them where they pay off most. */
export function InventoryPanel({ result }: { result?: SolveResult }) {
  const { t, name } = useT();
  const inventory = useStore((s) => s.inventory);
  const tier = useStore((s) => s.tier);
  const aim = useStore(aimOf);
  const game = useStore((s) => s.settings.game);
  const set = useStore((s) => s.set);
  const updatePlan = useStore((s) => s.updatePlan);
  const plan = usePlan();
  const exports = useExports(plan.id);
  const [busy, setBusy] = useState<'place' | 'all'>();
  const [tried, setTried] = useState(false);
  const placed = (result?.recipes ?? []).filter((u) => u.shards > 0 || u.sloops > 0);
  const ex = effectiveExtraction(plan.extraction, tier);
  const extraction = result ? planExtraction(result.raw, ex) : [];
  const extractorShards = extraction.reduce((n, u) => n + u.shards, 0);
  const overclocked = extraction.filter((u) => ex.overclock?.[u.item] !== undefined && u.shards > 0);
  const { overclock: _, ...plainExtraction } = plan.extraction;

  /** Best places first; with `all`, every free slot too, and the shards left over into the extractors. */
  const place = async (all: boolean) => {
    setBusy(all ? 'all' : 'place');
    try {
      const input: SolveInput = {
        targets: withExports(plan.targets, exports),
        supplies: plan.supplies,
        enabledRecipes: new Set(plan.enabled.filter((id) => recipeUnlocked(recipeById.get(id)!, tier))),
        resourceCaps: plan.caps,
        objective: 'resources',
        fixed: plan.fixed,
        equalWeights: aim === 'equal',
        ...(isDefaultGame(game) ? {} : { game }),
      };
      const mods = await autoAssignAsync(input, inventory, all);
      let overclock: Record<string, number> | undefined;
      if (all) {
        const r = await solveAsync({ ...input, mods });
        overclock = overclockExtractors(r.raw, { ...ex, overclock: undefined }, inventory.shards - r.shards);
      }
      updatePlan({ mods, extraction: overclock && Object.keys(overclock).length ? { ...plainExtraction, overclock } : plainExtraction });
    } catch {
      // The plan itself failed to solve; the error already shows on the factory floor.
    } finally {
      setTried(true);
      setBusy(undefined);
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
        <RateInput value={inventory[key]} label={label} onChange={(v) => set({ inventory: { ...inventory, [key]: Math.floor(v) } })} step />
      </div>
    );
  };

  return (
    <section className="stack inventory">
      {/* The buttons sit with the title, so they're in view without scrolling the panel. */}
      <div className="section-head">
        <h3 className="section-title">{t('inventory')}</h3>
        <div className="inventory-actions">
          <button
            type="button"
            className="ghost-button small"
            title={t('useAllHint')}
            disabled={!!busy || !result || (inventory.sloops === 0 && inventory.shards === 0)}
            onClick={() => place(true)}
          >
            {busy === 'all' ? t('placing') : t('useAll')}
          </button>
          <button
            type="button"
            className="primary-button small"
            title={t('autoPlaceHint')}
            disabled={!!busy || !result || (inventory.sloops === 0 && inventory.shards === 0)}
            onClick={() => place(false)}
          >
            {busy === 'place' ? t('placing') : t('autoPlace')}
          </button>
        </div>
      </div>
      {row(SLOOP_ICON, t('sloops'), 'sloops', result?.sloops ?? 0)}
      {row(SHARD_ICON, t('shards'), 'shards', (result?.shards ?? 0) + extractorShards)}
      {tried && !busy && placed.length === 0 && overclocked.length === 0 && <p className="hint warn">{t('nothingPlaced')}</p>}
      {(placed.length > 0 || overclocked.length > 0) && (
        <div className="placements-head">
          <span className="control-label">{t('placedIn')}</span>
          <button type="button" className="text-button" onClick={() => updatePlan({ mods: {}, extraction: plainExtraction })}>
            {t('clearMods')}
          </button>
        </div>
      )}
      {(placed.length > 0 || overclocked.length > 0) && (
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
          {overclocked.map((u) => (
            <li key={u.item}>
              <button type="button" onClick={() => set({ tab: 'resources' })}>
                <Icon id={u.extractor.id} size={32} />
                <span className="placement-name">
                  {name(data.items[u.item])}
                  <small>
                    {u.built}× {name(u.extractor)} · {Math.round(u.clock * 1000) / 10}%
                  </small>
                </span>
                <span className="mod-badge shard">{u.shards} ◆</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

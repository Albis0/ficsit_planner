import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { data, recipeById, recipeTier } from '../lib/data';
import { useT } from '../lib/i18n';
import { recipeLabel } from '../lib/text';
import { makeFromLeftover, useStore } from '../store';
import { CardMenu, type CardMenuItem } from './modeler/CardMenu';

/** Recipes on in the plan that take an item and make something else from it, standard ones first. */
export function recipesTaking(item: string, enabled: ReadonlySet<string>, tier: number) {
  const kindRank = (k: string) => (k === 'standard' ? 0 : k === 'alternate' ? 1 : 2);
  return data.recipes
    .filter((r) => r.kind !== 'power' && enabled.has(r.id) && recipeTier(r) <= tier && r.inputs.some((s) => s.item === item))
    .filter((r) => r.outputs.some((o) => o.item !== item))
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.name.localeCompare(b.name));
}

const CANISTER = 'Desc_FluidCanister_C';

/** A recipe that fills canisters with the leftover, which makes a part worth Sink points out of a liquid. */
export function packsForSink(r: { inputs: { item: string }[]; outputs: { item: string }[] }, item: string) {
  return (
    data.items[item]?.form !== 'solid' &&
    r.inputs.some((s) => s.item === CANISTER) &&
    r.outputs.some((o) => o.item !== CANISTER && data.items[o.item]?.form === 'solid' && data.items[o.item].sink > 0)
  );
}

/**
 * The button under a leftover card: what the leftover could be made into. Picking a recipe puts its product on the
 * factory's targets, for as much as the leftover makes, and offers it to the pool.
 */
export function SurplusMake({ item, rate, line }: { item: string; rate: number; line?: string[] }) {
  const { t, name, num } = useT();
  const enabled = useStore((s) => s.plans.find((p) => p.id === s.active)?.enabled);
  const tier = useStore((s) => s.tier);
  const update = useStore((s) => s.updatePlan);
  const [at, setAt] = useState<{ x: number; y: number }>();
  const list = useMemo(() => {
    // Recipes that pack the leftover into a part the Sink takes come first.
    const all = recipesTaking(item, new Set(enabled ?? []), tier);
    return [...all.filter((r) => packsForSink(r, item)), ...all.filter((r) => !packsForSink(r, item))];
  }, [item, enabled, tier]);
  if (list.length === 0) return null;

  const items: CardMenuItem[] = list.map((r) => {
    const taken = r.inputs.find((s) => s.item === item);
    const made = r.outputs.find((o) => o.item !== item);
    const product = made ? name(data.items[made.item]) : '';
    const how = recipeLabel(name(recipeById.get(r.id)), r.kind);
    if (packsForSink(r, item) && taken && made) {
      const per = rate / taken.rate;
      const canister = r.inputs.find((s) => s.item === CANISTER);
      const parts = Math.floor(per * made.rate * 100) / 100;
      return {
        label: t('sinkIt', { item: product }),
        note: t('sinkItNote', {
          machine: name(data.machines[r.machine]),
          n: num(Math.ceil(per * (canister?.rate ?? 0) * 100) / 100),
          can: name(data.items[CANISTER]),
        }),
        keys: `${num(Math.round(parts * data.items[made.item].sink))} ${t('sinkPts')}`,
        sink: true,
        onPick: () => update(makeFromLeftover(r.id, item, rate, line)),
      };
    }
    return {
      // A recipe named like its product (Residual Fuel makes fuel, Petroleum Coke makes coke) says it once.
      label: how === product ? product : `${product} · ${how}`,
      keys: taken && made ? `${num(Math.floor(((rate * made.rate) / taken.rate) * 100) / 100)}${t('perMin')}` : undefined,
      onPick: () => update(makeFromLeftover(r.id, item, rate, line)),
    };
  });

  return (
    <>
      <button
        type="button"
        className="endpoint-make nodrag nopan"
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          // Under the button; above it when the list would run off the screen.
          const room = items.length * 40 + 12;
          const y = box.bottom + 4 + room > window.innerHeight ? Math.max(8, box.top - 4 - room) : box.bottom + 4;
          setAt({ x: Math.max(8, Math.min(box.left, window.innerWidth - 340)), y });
        }}
      >
        {t('makeFromIt')} ›
      </button>
      {at && createPortal(<CardMenu at={at} items={items} onClose={() => setAt(undefined)} fixed />, document.body)}
    </>
  );
}

import type { Plan, PowerPlan } from '../store';

export interface Tabs {
  plans: Plan[];
  power: PowerPlan[];
  active: string;
  activePower: string;
}

const ids = (list: { id: string }[]) => new Set(list.map((p) => p.id));

/** The closed tabs go back where they were. A blank tab that took the place of a closed last one makes way for it. */
function bring<T extends { id: string }>(was: T[], now: T[], blank: (p: T) => boolean): T[] {
  const have = ids(now);
  const gone = was.filter((p) => !have.has(p.id));
  const before = ids(was);
  const base = gone.length === was.length && now.length === 1 && blank(now[0]) && !before.has(now[0].id) ? [] : [...now];
  for (const p of gone) base.splice(Math.min(was.indexOf(p), base.length), 0, p);
  return base;
}

/**
 * Undo for a closed tab: the tab comes back and nothing done since is undone. What closing it changed in the other tabs
 * (a "comes from" that pointed at it, a power plant that counted it) is put back as well.
 */
export function reopen(was: Tabs, now: Tabs): Tabs {
  const gone = new Set(
    [...was.plans.filter((p) => !ids(now.plans).has(p.id)), ...was.power.filter((p) => !ids(now.power).has(p.id))].map((p) => p.id),
  );
  const plans = bring(was.plans, now.plans, (p) => !p.targets.length && !p.supplies.length && !p.model?.nodes.length).map((q) => {
    const old = was.plans.find((p) => p.id === q.id);
    if (!old || !gone.size) return q;
    const from = (item: string) => old.supplies.find((s) => s.item === item)?.from;
    const supplies = q.supplies.map((s) =>
      !s.from && from(s.item) && gone.has(from(s.item) as string) ? { ...s, from: from(s.item) } : s,
    );
    const nodes = q.model?.nodes.map((n) => {
      const o = old.model?.nodes.find((x) => x.id === n.id);
      return n.k === 'in' && !n.from && o?.k === 'in' && o.from && gone.has(o.from) ? { ...n, from: o.from } : n;
    });
    return { ...q, supplies, ...(q.model && nodes ? { model: { ...q.model, nodes } } : {}) };
  });
  const power = bring(was.power, now.power, (p) => !p.plants.length).map((pp) => {
    const old = was.power.find((p) => p.id === pp.id);
    if (!old || !Array.isArray(old.factories) || !Array.isArray(pp.factories)) return pp;
    const factories = pp.factories;
    return { ...pp, factories: [...factories, ...old.factories.filter((f) => gone.has(f) && !factories.includes(f))] };
  });
  return {
    plans,
    power,
    active: gone.has(was.active) ? was.active : now.active,
    activePower: gone.has(was.activePower) ? was.activePower : now.activePower,
  };
}

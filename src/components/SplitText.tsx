import { groupClocks } from '../lib/clocks';
import { useT } from '../lib/i18n';
import type { RecipeUse } from '../lib/solver';
import type { Destination, Split, SplitGroup } from '../lib/split';
import { recipeLabel } from '../lib/text';

/** Words for a split line: where a group's output goes, its machines and clocks, and what the split costs. */
export function useSplitText() {
  const { t, name, num } = useT();
  return {
    where: (to: Destination[]) =>
      to
        .map((d) =>
          d.kind === 'recipe' ? recipeLabel(name(d.recipe), d.recipe.kind) : t(d.kind === 'target' ? 'productLabel' : 'surplus'),
        )
        .join(', '),
    /** "2 × 100% + 1 × 45.17%", or "1 × 150% + 1 × 100%" on an overclocked group. */
    run: (u: RecipeUse) =>
      groupClocks(u.clocks)
        .map((g) => `${g.n} × ${num(g.clock * 100)}%`)
        .join(' + '),
    extra: (split: Split) =>
      split.extra === 0 ? t('splitSame') : split.extra === 1 ? t('splitExtraOne') : t('splitExtraN', { n: split.extra }),
  };
}

/** On a machine card: "Split 3 + 2" ("Split 5 ways" past three), each group spelled out in the title. */
export function SplitBadge({ split }: { split: Split }) {
  const { t, num } = useT();
  const { where, run, extra } = useSplitText();
  const title = [
    ...split.groups.map((g) => `${run(g.use)} ${t('splitTo', { to: where(g.to) })} (${num(g.rate)}${t('perMin')})`),
    extra(split),
  ].join('\n');
  return (
    <span className="mod-badge split" title={title}>
      {split.groups.length > 3
        ? t('splitWays', { n: split.groups.length })
        : t('splitShort', { sizes: split.groups.map((g) => g.use.built).join(' + ') })}
    </span>
  );
}

/** On a card of its own for one destination's group: "→ Iron Rod". */
export function SplitTo({ part }: { part: SplitGroup }) {
  const { t } = useT();
  const { where } = useSplitText();
  const to = t('splitTo', { to: where(part.to) });
  return (
    <span className="mod-badge split" title={to}>
      {to}
    </span>
  );
}

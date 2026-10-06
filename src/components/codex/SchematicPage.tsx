import type { ReactNode } from 'react';
import { type CodexIndex, nameOf, recipesFor, schematicIcon } from '../../lib/codex';
import { data, type Recipe } from '../../lib/data';
import { useT } from '../../lib/i18n';
import { Icon } from '../Icon';
import { CodexLink } from './route';
import { AltVerdict, Amount, Amounts, Head, RecipeCard, Section, schematicWhere } from './parts';

export function SchematicPage({ id, index }: { id: string; index: CodexIndex }) {
  const { t, num } = useT();
  const s = index.schematic.get(id);
  if (!s) return <p className="hint">{t('codexMissing')}</p>;
  const recipes = s.unlocks.map((u) => data.recipes.find((r) => r.id === u)).filter(Boolean) as Recipe[];
  const others = s.unlocks.filter((u) => !recipes.some((r) => r.id === u));
  const stats: [string, ReactNode][] = [];
  if (s.type === 'milestone' || s.type === 'hub') stats.push([t('statTier'), s.tier]);
  if (s.group) stats.push([s.type === 'mam' ? t('statTree') : t('statShelf'), s.group]);
  if (s.time) stats.push([t('statTime'), s.time >= 60 ? t('minutesShort', { n: num(s.time / 60) }) : t('secondsN', { n: num(s.time) })]);
  const standard = s.type === 'alternate' && recipes[0] ? recipesFor(recipes[0].outputs[0].item).filter((r) => r.kind === 'standard') : [];
  const tagKey = {
    hub: 'schem_hub',
    milestone: 'schem_milestone',
    mam: 'schem_mam',
    alternate: 'schem_alternate',
    shop: 'schem_shop',
  } as const;

  return (
    <>
      <Head icon={schematicIcon(s, index.data)} name={s.name} tag={t(tagKey[s.type])} stats={stats} />
      {s.cost.length > 0 && (
        <Section title={s.type === 'shop' ? t('priceTitle') : s.type === 'mam' ? t('researchCost') : t('deliverTitle')}>
          <Amounts list={s.cost} index={index} />
        </Section>
      )}
      {s.type === 'alternate' && (
        <Section title={t('hardDriveTitle')}>
          <p className="codex-text">{t('hardDriveText')}</p>
        </Section>
      )}
      {recipes.length > 0 && (
        <Section
          title={s.type === 'alternate' ? t('theRecipe') : t('unlocksRecipes')}
          count={s.type === 'alternate' ? undefined : recipes.length}
        >
          <div className="codex-recipes">
            {recipes.map((r) => (
              <RecipeCard key={r.id} recipe={r} index={index} build={r.outputs[0]?.item} />
            ))}
          </div>
        </Section>
      )}
      {s.type === 'alternate' && recipes[0] && <AltVerdict recipe={recipes[0]} index={index} />}
      {standard.length > 0 && (
        <Section title={t('comparedTo')}>
          <div className="codex-recipes">
            {standard.map((r) => (
              <RecipeCard key={r.id} recipe={r} index={index} />
            ))}
          </div>
        </Section>
      )}
      {(others.length > 0 || s.gives || s.extras) && (
        <Section title={s.type === 'shop' ? t('youGet') : t('unlocksTitle')}>
          <div className="codex-amounts wrap">
            {s.gives?.map((g) => (
              <Amount key={g.item} item={g.item} amount={g.amount} index={index} />
            ))}
            {others.map((u) => (
              <Amount key={u} item={u} index={index} />
            ))}
          </div>
          {s.extras && (
            <ul className="codex-extras">
              {s.extras.map((x) => (
                <li key={x.k}>
                  {x.k === 'scan'
                    ? t('extra_scan', { list: x.items.map((i) => nameOf(i, index.data)).join(', ') })
                    : 'n' in x
                      ? t(`extra_${x.k}`, { n: x.n })
                      : t(`extra_${x.k}`)}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
      {s.after.length > 0 && (
        <Section title={t('requiresFirst')}>
          <div className="codex-uses">
            {s.after
              .map((a) => index.schematic.get(a))
              .filter(Boolean)
              .map((a) => (
                <CodexLink key={a!.id} page={{ kind: 'schematic', id: a!.id }} className="codex-use">
                  <Icon id={schematicIcon(a!, index.data) ?? ''} size={30} />
                  <span className="codex-use-name">{a!.name}</span>
                  <span className="codex-use-where">{schematicWhere(a!, t)}</span>
                </CodexLink>
              ))}
          </div>
        </Section>
      )}
    </>
  );
}

import { type ReactNode, useState } from 'react';
import { type CodexIndex, nameOf, type Phase, pageOf, type Schematic } from '../../lib/codex';
import { type Cost, data, type Recipe, recipeTier } from '../../lib/data';
import { useT } from '../../lib/i18n';
import { recipeLabel } from '../../lib/text';
import { useStore } from '../../store';
import { elevatorAmount } from '../../lib/game';
import { versusStandard } from '../../lib/insights';
import { RecipeCompare } from '../CodexLine';
import { Glyph } from '../Glyph';
import { Icon } from '../Icon';
import { CodexLink } from './route';

/** Title block: the big icon, name, what kind of thing it is, key figures and the game's own words. */
export function Head({
  icon,
  name,
  tag,
  stats,
  desc,
  actions,
}: {
  icon?: string;
  name: string;
  tag: string;
  stats: [string, ReactNode][];
  desc?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="codex-head">
      <span className="slot codex-head-icon">{icon && <Icon id={icon} size={88} />}</span>
      <div className="codex-head-main">
        <span className="codex-tag">{tag}</span>
        <h2 className="codex-title">{name}</h2>
        {stats.length > 0 && (
          <dl className="codex-stats">
            {stats.map(([label, value]) => (
              <div key={label} className="codex-stat">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {actions && <div className="codex-actions">{actions}</div>}
      {desc && (
        <blockquote className="codex-desc">
          {desc.split('\n\n').map((p) => (
            <p key={p}>{p}</p>
          ))}
        </blockquote>
      )}
    </header>
  );
}

export function Section({ title, children, count }: { title: string; children: ReactNode; count?: number }) {
  return (
    <section className="codex-section">
      <h3 className="codex-h">
        {title}
        {count !== undefined && <span className="codex-h-count">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

/** What delivering a phase opens: the next tiers, or, for the last one, the end of the project. */
export function phaseOpens(p: Phase, index: CodexIndex, t: ReturnType<typeof useT>['t']): string {
  const i = index.data.phases.indexOf(p);
  // The phase before the first (tiers 0 to 2) asks for nothing.
  const from = i <= 0 ? 3 : index.data.phases[i - 1].lastTier + 1;
  if (from > p.lastTier) return t('phaseLast');
  return from === p.lastTier ? t('phaseTier', { tier: from }) : t('phaseTiers', { from, to: p.lastTier });
}

/** An alternate's whole line next to the standard recipe's: what it saves and what it costs. */
export function AltVerdict({ recipe, index }: { recipe: Recipe; index: CodexIndex }) {
  const { t } = useT();
  const partCost = useStore((s) => s.settings.game.parts);
  const item = recipe.outputs[0].item;
  const insight = index.data.insights.items[item];
  const vs = versusStandard(insight, recipe.id);
  if (!insight || !vs) return null;
  const change = (share: number, more: 'moreRaw' | 'morePower' | 'moreBuildings', less: 'lessRaw' | 'lessPower' | 'lessBuildings') =>
    Math.abs(share) < 0.005 ? undefined : t(share > 0 ? more : less, { n: Math.round(Math.abs(share) * 100) });
  const parts = [
    change(vs.raw, 'moreRaw', 'lessRaw'),
    change(vs.power, 'morePower', 'lessPower'),
    change(vs.buildings, 'moreBuildings', 'lessBuildings'),
  ].filter(Boolean);
  return (
    <Section title={t('verdictTitle')}>
      <p className="codex-text">
        {vs.needsMore
          ? t('verdictNeedsMore')
          : parts.length
            ? t('verdictLine', { list: parts.join(', '), item: nameOf(item, index.data) })
            : t('verdictSame')}
      </p>
      <RecipeCompare insight={insight} index={index} only={[insight.recipe, recipe.id]} />
      <p className="hint">
        {t('compareNote', { rate: `${insight.line.rate}${data.items[item]?.form !== 'solid' ? t('m3PerMin') : t('perMin')}` })}
      </p>
      {partCost !== 1 && <p className="hint">{t('comparePartsNote')}</p>}
    </Section>
  );
}

/** The Space Elevator's phases: what each asks for, and the tiers it opens. */
export function PhaseList({ index }: { index: CodexIndex }) {
  const { t } = useT();
  const game = useStore((s) => s.settings.game);
  return (
    <div className="codex-phases">
      {index.data.phases.map((p) => {
        return (
          <div key={p.phase} className="codex-phase">
            <div className="codex-phase-head">
              <b>{t('phaseN', { n: p.phase })}</b>
              <span>{phaseOpens(p, index, t)}</span>
            </div>
            <Amounts list={p.cost.map((c) => ({ ...c, amount: elevatorAmount(c.amount, game) }))} index={index} />
          </div>
        );
      })}
    </div>
  );
}

/** Tips the game doesn't give: what to watch for, what goes well with it. */
export function Notes({ text }: { text: string }) {
  const { t } = useT();
  return (
    <section className="codex-section codex-notes">
      <h3 className="codex-h">{t('goodToKnow')}</h3>
      <div className="codex-text">
        {text.split('\n\n').map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
    </section>
  );
}

/** An item as a slot with its amount, linking to its page. */
export function Amount({ item, amount, unit, index }: { item: string; amount?: number; unit?: string; index: CodexIndex }) {
  const { num } = useT();
  const page = pageOf(item, index.data);
  const name = nameOf(item, index.data);
  const body = (
    <>
      <span className="slot">
        <Icon id={item} size={34} />
      </span>
      <span className="codex-amount-text">
        {amount !== undefined && (
          <b>
            {num(amount)}
            {unit && <small>{unit}</small>}
          </b>
        )}
        <span>{name}</span>
      </span>
    </>
  );
  return page ? (
    <CodexLink page={page} className="codex-amount" title={name}>
      {body}
    </CodexLink>
  ) : (
    <span className="codex-amount" title={name}>
      {body}
    </span>
  );
}

export function Amounts({ list, index, unit }: { list: Cost[]; index: CodexIndex; unit?: string }) {
  return (
    <div className="codex-amounts">
      {list.map((c) => (
        <Amount key={c.item} item={c.item} amount={c.amount} unit={unit} index={index} />
      ))}
    </div>
  );
}

/** One way of making something: ingredients, results, where, how long and how much power. */
/** `build`: the item a "Build with this recipe" button makes a factory for. */
export function RecipeCard({ recipe, index, build }: { recipe: Recipe; index: CodexIndex; build?: string }) {
  const { t, num } = useT();
  const buildable = build && data.items[build] && !data.items[build].raw;
  const unlock = index.data.recipeUnlock[recipe.id];
  const s = unlock ? index.schematic.get(unlock) : undefined;
  const fluid = (item: string) => data.items[item]?.form !== 'solid';
  const perMin = (list: Recipe['inputs']) =>
    list.map((x) => ({ item: x.item, amount: x.rate, unit: fluid(x.item) ? t('m3PerMin') : t('perMin') }));
  return (
    <div className={`codex-recipe ${recipe.kind}`}>
      <div className="codex-recipe-head">
        <span className="codex-recipe-name">{recipeLabel(recipe.name, recipe.kind)}</span>
        {recipe.kind === 'alternate' && <span className="codex-pill alt">{t('alternate')}</span>}
        {index.data.handCraft.includes(recipe.id) && <span className="codex-pill">{t('handCraft')}</span>}
        {buildable && (
          <button
            type="button"
            className="text-button codex-build"
            title={t('buildWithHint')}
            onClick={() => useStore.getState().buildFactory(build, nameOf(build, index.data), recipe.id)}
          >
            <Glyph name="factory" size={16} />
            {t('buildWith')}
          </button>
        )}
      </div>
      <div className="codex-recipe-flow">
        <div className="codex-amounts">
          {perMin(recipe.inputs).map((x) => (
            <Amount key={x.item} {...x} index={index} />
          ))}
        </div>
        <span className="codex-arrow" aria-hidden>
          →
        </span>
        <div className="codex-amounts">
          {perMin(recipe.outputs).map((x) => (
            <Amount key={x.item} {...x} index={index} />
          ))}
        </div>
      </div>
      <div className="codex-recipe-foot">
        <CodexLink page={{ kind: 'building', id: recipe.machine }} className="codex-machine">
          <Icon id={recipe.machine} size={24} />
          {nameOf(recipe.machine, index.data)}
        </CodexLink>
        <span>{t('secondsN', { n: num(recipe.duration) })}</span>
        <span>
          {recipe.powerRange ? `${num(recipe.powerRange[0])}–${num(recipe.powerRange[1])}` : num(recipe.power)} {t('mw')}
        </span>
        <span>{t('tierN', { tier: recipeTier(recipe) })}</span>
        {s && s.type !== 'milestone' && s.type !== 'hub' && (
          <CodexLink page={{ kind: 'schematic', id: s.id }} className="codex-unlock">
            {s.type === 'alternate' ? t('fromHardDrive') : s.type === 'mam' ? t('fromMam', { tree: s.group ?? '' }) : s.name}
          </CodexLink>
        )}
      </div>
    </div>
  );
}

export function UnlockLine({ id, index }: { id: string | undefined; index: CodexIndex }) {
  const { t } = useT();
  const s = id ? index.schematic.get(id) : undefined;
  if (!s) return null;
  return (
    <p className="codex-unlock-line">
      {t('unlockedBy')} <CodexLink page={{ kind: 'schematic', id: s.id }}>{s.name}</CodexLink>
      <span className="codex-unlock-where">{schematicWhere(s, t)}</span>
    </p>
  );
}

export function schematicWhere(s: Schematic, t: ReturnType<typeof useT>['t']): string {
  if (s.type === 'milestone') return t('whereMilestone', { tier: s.tier });
  if (s.type === 'hub') return t('whereHub');
  if (s.type === 'mam') return t('whereMam', { tree: s.group ?? '' });
  if (s.type === 'alternate') return t('whereHardDrive');
  return t('whereShop');
}

/** A fluid's colour on the pipe: a swatch, its hex, and a button that copies the hex. */
export function ColorChip({ hex }: { hex: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      ?.writeText(hex)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };
  return (
    <span className="codex-color">
      <span className="codex-swatch" style={{ background: hex }} aria-hidden />
      <code>{hex}</code>
      <button type="button" className="codex-copy" onClick={copy}>
        {copied ? t('copied') : t('copy')}
      </button>
    </span>
  );
}

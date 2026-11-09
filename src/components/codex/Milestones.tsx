import { useMemo, useState } from 'react';
import { type CodexIndex, nameOf, pageKey, pageOf, schematicIcon } from '../../lib/codex';
import { useT } from '../../lib/i18n';
import { Icon } from '../Icon';
import { AdaButton } from './Ada';
import { CodexLink } from './route';

/** The HUB's milestones the way the game shows them: a row of tiers, the milestones of the tier as squares, then what
 *  each one gives and costs, with its picture on a board to the right. */
export function MilestoneScreen({ index }: { index: CodexIndex }) {
  const { t, num } = useT();
  const list = useMemo(() => index.data.schematics.filter((s) => s.type === 'hub' || s.type === 'milestone'), [index]);
  const tiers = useMemo(() => [...new Set(list.map((s) => s.tier))].sort((a, b) => a - b), [list]);
  const [tier, setTier] = useState(tiers.includes(1) ? 1 : tiers[0]);
  const [picked, setPicked] = useState<string>();
  const here = list.filter((s) => s.tier === tier);
  const s = here.find((x) => x.id === picked) ?? here[0];
  // Each thing it opens once, a recipe shown as the part it makes.
  const rewards = useMemo(() => {
    const seen = new Set<string>();
    return (s?.unlocks ?? []).flatMap((u) => {
      const page = pageOf(u, index.data);
      if (!page || !('id' in page) || seen.has(pageKey(page))) return [];
      seen.add(pageKey(page));
      return [{ page, id: page.id }];
    });
  }, [s, index]);
  if (!s) return null;
  const time = s.time ? (s.time >= 60 ? t('minutesShort', { n: num(s.time / 60) }) : t('secondsN', { n: num(s.time) })) : '';
  const before = s.after.map((a) => index.schematic.get(a)?.name).filter(Boolean);
  const kind = (k: string) => (k === 'building' ? t('hubKindBuilding') : k === 'vehicle' ? t('hubKindVehicle') : t('hubKindPart'));

  return (
    <div className="hub">
      <div className="hub-tiers" role="tablist" aria-label={t('hubTiers')}>
        {tiers.map((n) => (
          <button
            key={n}
            type="button"
            role="tab"
            aria-selected={n === tier}
            className={`hub-tier${n === tier ? ' current' : ''}`}
            onClick={() => {
              setTier(n);
              setPicked(undefined);
            }}
          >
            {t('tierN', { tier: n })}
          </button>
        ))}
      </div>
      <div className="hub-picks">
        {here.map((x) => (
          <button
            key={x.id}
            type="button"
            className={`hub-pick${x.id === s.id ? ' current' : ''}`}
            aria-pressed={x.id === s.id}
            onClick={() => setPicked(x.id)}
          >
            <Icon id={schematicIcon(x, index.data) ?? ''} size={56} />
            <span>{x.name}</span>
          </button>
        ))}
      </div>
      <div className="hub-body">
        <div className="hub-lists">
          {(rewards.length > 0 || !!s.extras?.length) && <h3 className="hub-h">{t('hubRewards')}</h3>}
          <div className="hub-rewards">
            {rewards.map(({ page, id }) => (
              <CodexLink key={pageKey(page)} page={page} className="hub-reward" title={nameOf(id, index.data)}>
                <span className="hub-slot">
                  <Icon id={id} size={56} />
                </span>
                <span className="hub-reward-name">{nameOf(id, index.data)}</span>
                <span className="hub-reward-kind">{kind(page.kind)}</span>
              </CodexLink>
            ))}
          </div>
          {s.extras?.length ? (
            <ul className="hub-extras">
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
          ) : null}
          <h3 className="hub-h">{t('hubCost')}</h3>
          <div className="hub-costs">
            {s.cost.map((c) => {
              const page = pageOf(c.item, index.data);
              const chip = (
                <>
                  <span className="hub-slot">
                    <Icon id={c.item} size={56} />
                  </span>
                  <b className="hub-count">{num(c.amount)}</b>
                </>
              );
              return page ? (
                <CodexLink key={c.item} page={page} className="hub-cost" title={nameOf(c.item, index.data)}>
                  {chip}
                </CodexLink>
              ) : (
                <span key={c.item} className="hub-cost" title={nameOf(c.item, index.data)}>
                  {chip}
                </span>
              );
            })}
          </div>
        </div>
        <aside className="hub-side">
          <div className="hub-art">
            <Icon id={schematicIcon(s, index.data) ?? ''} size={120} />
          </div>
          <div className="hub-info">
            <div className="ada-title">
              <h3 className="hub-name">{s.name}</h3>
              <AdaButton id={s.id} />
            </div>
            {time && (
              <p>
                {t('statTime')}: {time}
              </p>
            )}
            {before.length > 0 && (
              <p>
                {t('requiresFirst')}: {before.join(', ')}
              </p>
            )}
            <CodexLink page={{ kind: 'schematic', id: s.id }} className="mam-open">
              {t('mamOpenPage')}
            </CodexLink>
          </div>
        </aside>
      </div>
    </div>
  );
}

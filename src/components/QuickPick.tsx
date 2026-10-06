import { useMemo, useState } from 'react';
import { craftableItems, data, itemLocked, itemTier, SPECIAL_ITEMS } from '../lib/data';
import { useT } from '../lib/i18n';
import { laterMatches } from '../lib/later';
import { searchKey } from '../lib/text';
import { useStore } from '../store';
import { Glyph } from './Glyph';
import { Slot } from './Slot';

const projectParts = Array.from({ length: 12 }, (_, i) => `Desc_SpaceElevatorPart_${i + 1}_C`).filter((id) => data.items[id]);

const common = [
  'Desc_IronPlate_C',
  'Desc_IronPlateReinforced_C',
  'Desc_ModularFrame_C',
  'Desc_Rotor_C',
  'Desc_Stator_C',
  'Desc_Motor_C',
  'Desc_Cable_C',
  'Desc_Wire_C',
  'Desc_SteelPlate_C',
  'Desc_SteelPipe_C',
  'Desc_Plastic_C',
  'Desc_Rubber_C',
  'Desc_CircuitBoard_C',
  'Desc_Computer_C',
  'Desc_ModularFrameHeavy_C',
  'Desc_HighSpeedConnector_C',
  'Desc_AluminumPlate_C',
  'Desc_MotorLightweight_C',
].filter((id) => data.items[id]);

const RESULTS = 30;

/** First-run screen: what to make, a search over every item, and shortcuts to the usual goals. */
export function QuickPick() {
  const { t, name } = useT();
  const tier = useStore((s) => s.tier);
  // Set to hide what isn't unlocked yet: those leave the shortcuts and the search.
  const hide = useStore((s) => !s.settings.showLocked);
  const shown = (ids: string[]) => (hide ? ids.filter((id) => !itemLocked(id, tier)) : ids);
  const set = useStore((s) => s.set);
  const updatePlan = useStore((s) => s.updatePlan);
  const setFloor = useStore((s) => s.setFloor);
  const active = useStore((s) => s.active);
  const [q, setQ] = useState('');

  const matches = useMemo(() => {
    const f = searchKey(q.trim());
    if (!f) return [];
    return craftableItems
      .filter((i) => searchKey(name(i)).includes(f) && !(hide && itemLocked(i.id, tier)))
      .sort(
        // Gear (ammo, equipment, power shards) after the parts.
        (a, b) =>
          Number(SPECIAL_ITEMS.has(a.id)) - Number(SPECIAL_ITEMS.has(b.id)) ||
          Number(!searchKey(name(a)).startsWith(f)) - Number(!searchKey(name(b)).startsWith(f)) ||
          name(a).localeCompare(name(b)),
      )
      .slice(0, RESULTS);
  }, [q, name, hide, tier]);

  const later = useMemo(
    () =>
      hide && q.trim()
        ? laterMatches(
            q,
            craftableItems.filter((i) => itemLocked(i.id, tier)),
            name,
          )
        : [],
    [q, name, hide, tier],
  );

  const add = (item: string, rate: number) => {
    updatePlan((p) => (p.targets.some((x) => x.item === item) ? {} : { targets: [...p.targets, { item, rate }] }));
    set({ tab: 'targets' });
  };

  const grid = (ids: string[], rate: number) => (
    <div className="quick-grid">
      {shown(ids).map((id) => {
        // Above the unlocked tier: still pickable, but say when it opens up.
        const needs = itemTier(id);
        const locked = needs !== undefined && needs > tier;
        return (
          <button key={id} type="button" className={`quick-item ${locked ? 'locked' : ''}`} onClick={() => add(id, rate)}>
            <Slot id={id} size={72} />
            <span>{name(data.items[id])}</span>
            {locked && <span className="tier-tag">{t('tierTag', { tier: needs })}</span>}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="quick-pick">
      <div className="quick-inner">
        <div className="quick-head">
          <h2 className="quick-title">{t('whatToMake')}</h2>
          {/* Or no targets at all: an empty floor to build on by hand. */}
          <button
            type="button"
            className="build-by-hand"
            title={t('manualHint')}
            onClick={() => {
              setFloor(active, 'manual');
              set({ view: 'graph' });
            }}
          >
            <Glyph name="floor" size={20} />
            {t('buildByHand')}
          </button>
        </div>
        <input
          className="quick-search"
          type="search"
          placeholder={t('searchItems')}
          aria-label={t('searchItems')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) add(matches[0].id, 10);
            if (e.key === 'Escape') setQ('');
          }}
        />
        {q.trim() ? (
          matches.length ? (
            grid(
              matches.map((i) => i.id),
              10,
            )
          ) : (
            <p className="hint">
              {later.length
                ? t('notInTierYet', { list: later.map((x) => `${name(x.item)} (${t('tierTag', { tier: x.tier })})`).join(', ') })
                : t('noResults')}
            </p>
          )
        ) : (
          <>
            <h3 className="section-title">{t('projectParts')}</h3>
            {grid(projectParts, 5)}
            <h3 className="section-title">{t('commonParts')}</h3>
            {grid(common, 30)}
          </>
        )}
      </div>
    </div>
  );
}

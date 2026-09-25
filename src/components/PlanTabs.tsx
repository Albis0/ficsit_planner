import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { useStore } from '../store';
import { Icon } from './Icon';

/** The tabs on screen: factories in the factory planner, power plants in the power planner. */
function useTabs() {
  const { t } = useT();
  const power = useStore((s) => s.mode === 'power');
  const plans = useStore((s) => s.plans);
  const plants = useStore((s) => s.power);
  const active = useStore((s) => (power ? s.activePower : s.active));
  const set = useStore((s) => s.set);
  const store = useStore.getState;
  return power
    ? {
        power,
        list: plants.map((p) => ({ id: p.id, name: p.name, icon: p.plants[0]?.generator })),
        active,
        select: (id: string) => set({ activePower: id, inspect: undefined }),
        add: () => store().addPowerPlan(`${t('plantName')} ${plants.length + 1}`),
        duplicate: (id: string) => store().duplicatePowerPlan(id),
        remove: (id: string) => store().removePowerPlan(id),
        rename: (id: string, name: string) => store().renamePowerPlan(id, name),
        label: t('plantName'),
        addLabel: t('newPlant'),
      }
    : {
        power,
        list: plans.map((p) => ({ id: p.id, name: p.name, icon: undefined as string | undefined })),
        active,
        select: (id: string) => set({ active: id, inspect: undefined }),
        add: () => store().addPlan(`${t('planName')} ${plans.length + 1}`),
        duplicate: (id: string) => store().duplicatePlan(id),
        remove: (id: string) => store().removePlan(id),
        rename: (id: string, name: string) => store().renamePlan(id, name),
        label: t('planName'),
        addLabel: t('newPlan'),
      };
}

/** Rename (phones only, where there's no double-click), duplicate and delete for the tab on screen. */
export function PlanActions({ rename = false, onDone }: { rename?: boolean; onDone?: () => void }) {
  const { t } = useT();
  const tabs = useTabs();
  const set = useStore((s) => s.set);
  const active = tabs.active;
  // Which tab the Delete button is asking about, so switching tabs drops the question.
  const [asking, setAsking] = useState<string>();
  const confirming = asking === active;

  return (
    <span className="plan-actions">
      {rename && (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            set({ renaming: active });
            onDone?.();
          }}
        >
          {t('rename')}
        </button>
      )}
      <button
        type="button"
        className="text-button"
        onClick={() => {
          tabs.duplicate(active);
          onDone?.();
        }}
      >
        {t('duplicate')}
      </button>
      <button
        type="button"
        className={`text-button ${confirming ? 'danger' : ''}`}
        onClick={() => {
          if (!confirming) return setAsking(active);
          tabs.remove(active);
          onDone?.();
        }}
        onBlur={() => setAsking(undefined)}
      >
        {confirming ? t('confirmDelete') : t('deletePlan')}
      </button>
    </span>
  );
}

/** Tabs across the top bar: switch, double-click to rename, duplicate or delete the active one. */
export function PlanTabs() {
  const { t } = useT();
  const tabs = useTabs();
  const editing = useStore((s) => s.renaming);
  const set = useStore((s) => s.set);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const stopEditing = () => set({ renaming: undefined });

  return (
    <nav className={`plan-tabs ${tabs.power ? 'power' : ''}`} aria-label={tabs.label}>
      {tabs.list.map((p) =>
        editing === p.id ? (
          <input
            key={p.id}
            ref={input}
            className="plan-tab editing"
            defaultValue={p.name}
            aria-label={t('rename')}
            onBlur={(e) => {
              tabs.rename(p.id, e.target.value.trim() || p.name);
              stopEditing();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') stopEditing();
            }}
          />
        ) : (
          <button
            key={p.id}
            type="button"
            className="plan-tab"
            aria-current={p.id === tabs.active ? 'page' : undefined}
            title={t('renameHint')}
            onClick={() => tabs.select(p.id)}
            onDoubleClick={() => set({ renaming: p.id })}
          >
            {p.icon && <Icon id={p.icon} size={22} className="plan-tab-icon" />}
            {p.name}
          </button>
        ),
      )}
      <button type="button" className="plan-add" aria-label={tabs.addLabel} title={tabs.addLabel} onClick={tabs.add}>
        +
      </button>
      <PlanActions />
    </nav>
  );
}

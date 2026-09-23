import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { useStore } from '../store';

/** Factory tabs across the top bar: switch, double-click to rename, duplicate or delete the active one. */
export function PlanTabs() {
  const { t } = useT();
  const plans = useStore((s) => s.plans);
  const active = useStore((s) => s.active);
  const set = useStore((s) => s.set);
  const addPlan = useStore((s) => s.addPlan);
  const duplicatePlan = useStore((s) => s.duplicatePlan);
  const removePlan = useStore((s) => s.removePlan);
  const renamePlan = useStore((s) => s.renamePlan);
  const [editing, setEditing] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  useEffect(() => setConfirming(false), [active]);

  return (
    <nav className="plan-tabs" aria-label={t('planName')}>
      {plans.map((p) =>
        editing === p.id ? (
          <input
            key={p.id}
            ref={input}
            className="plan-tab editing"
            defaultValue={p.name}
            onBlur={(e) => {
              renamePlan(p.id, e.target.value.trim() || p.name);
              setEditing(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setEditing(undefined);
            }}
          />
        ) : (
          <button
            key={p.id}
            type="button"
            className="plan-tab"
            aria-current={p.id === active ? 'page' : undefined}
            title={t('renameHint')}
            onClick={() => set({ active: p.id, inspect: undefined })}
            onDoubleClick={() => setEditing(p.id)}
          >
            {p.name}
          </button>
        ),
      )}
      <button
        type="button"
        className="plan-add"
        aria-label={t('newPlan')}
        title={t('newPlan')}
        onClick={() => addPlan(`${t('planName')} ${plans.length + 1}`)}
      >
        +
      </button>
      <span className="plan-actions">
        <button type="button" className="text-button" onClick={() => duplicatePlan(active)}>
          {t('duplicate')}
        </button>
        <button
          type="button"
          className={`text-button ${confirming ? 'danger' : ''}`}
          onClick={() => {
            if (!confirming) return setConfirming(true);
            removePlan(active);
          }}
          onBlur={() => setConfirming(false)}
        >
          {confirming ? t('confirmDelete') : t('deletePlan')}
        </button>
      </span>
    </nav>
  );
}

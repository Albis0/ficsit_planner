import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { useStore } from '../store';

/** Rename (phones only, where there's no double-click), duplicate and delete for the active factory. */
export function PlanActions({ rename = false, onDone }: { rename?: boolean; onDone?: () => void }) {
  const { t } = useT();
  const active = useStore((s) => s.active);
  const set = useStore((s) => s.set);
  const duplicatePlan = useStore((s) => s.duplicatePlan);
  const removePlan = useStore((s) => s.removePlan);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => setConfirming(false), [active]);

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
          duplicatePlan(active);
          onDone?.();
        }}
      >
        {t('duplicate')}
      </button>
      <button
        type="button"
        className={`text-button ${confirming ? 'danger' : ''}`}
        onClick={() => {
          if (!confirming) return setConfirming(true);
          removePlan(active);
          onDone?.();
        }}
        onBlur={() => setConfirming(false)}
      >
        {confirming ? t('confirmDelete') : t('deletePlan')}
      </button>
    </span>
  );
}

/** Factory tabs across the top bar: switch, double-click to rename, duplicate or delete the active one. */
export function PlanTabs() {
  const { t } = useT();
  const plans = useStore((s) => s.plans);
  const active = useStore((s) => s.active);
  const editing = useStore((s) => s.renaming);
  const set = useStore((s) => s.set);
  const addPlan = useStore((s) => s.addPlan);
  const renamePlan = useStore((s) => s.renamePlan);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const stopEditing = () => set({ renaming: undefined });

  return (
    <nav className="plan-tabs" aria-label={t('planName')}>
      {plans.map((p) =>
        editing === p.id ? (
          <input
            key={p.id}
            ref={input}
            className="plan-tab editing"
            defaultValue={p.name}
            aria-label={t('rename')}
            onBlur={(e) => {
              renamePlan(p.id, e.target.value.trim() || p.name);
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
            aria-current={p.id === active ? 'page' : undefined}
            title={t('renameHint')}
            onClick={() => set({ active: p.id, inspect: undefined })}
            onDoubleClick={() => set({ renaming: p.id })}
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
      <PlanActions />
    </nav>
  );
}

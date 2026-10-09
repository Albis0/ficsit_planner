import { type CSSProperties, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../lib/i18n';
import { useOverview } from '../lib/overview';
import { shareTab } from '../lib/share';
import { useStore } from '../store';
import { Glyph } from './Glyph';
import { Icon } from './Icon';
import { CardMenu } from './modeler/CardMenu';

/** The tabs on screen: factories in the factory planner, power plants in the power planner. */
function useTabs() {
  const { t } = useT();
  const power = useStore((s) => s.mode === 'power');
  const plans = useStore((s) => s.plans);
  const plants = useStore((s) => s.power);
  const active = useStore((s) => (power ? s.activePower : s.active));
  const set = useStore((s) => s.set);
  const store = useStore.getState;
  // Closing a tab takes one click, like a browser's; the toast after it offers Undo instead of asking first.
  // "Factory 3" for the third tab, or the next number that's free once some were closed or renamed.
  const nextName = (base: string, names: string[]) => {
    let n = names.length + 1;
    while (names.includes(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  };
  const closing = (remove: (id: string) => void) => (id: string) => {
    const s = store();
    const name = (power ? s.power : s.plans).find((p) => p.id === id)?.name ?? '';
    const before = { plans: s.plans, power: s.power, active: s.active, activePower: s.activePower };
    remove(id);
    set({ closed: { name, before } });
  };
  return power
    ? {
        power,
        list: plants.map((p) => ({ id: p.id, name: p.name, icon: p.plants[0]?.generator })),
        active,
        select: (id: string) => set({ activePower: id, inspect: undefined }),
        add: () => {
          set({ overview: undefined });
          store().addPowerPlan(
            nextName(
              t('plantName'),
              plants.map((p) => p.name),
            ),
          );
        },
        duplicate: (id: string) => store().duplicatePowerPlan(id),
        remove: closing((id) => store().removePowerPlan(id)),
        rename: (id: string, name: string) => store().renamePowerPlan(id, name),
        label: t('plantName'),
        addLabel: t('newPlant'),
      }
    : {
        power,
        list: plans.map((p) => ({ id: p.id, name: p.name, icon: undefined as string | undefined })),
        active,
        select: (id: string) => set({ active: id, inspect: undefined }),
        add: () => {
          set({ overview: undefined });
          store().addPlan(
            nextName(
              t('planName'),
              plans.map((p) => p.name),
            ),
          );
        },
        duplicate: (id: string) => store().duplicatePlan(id),
        remove: closing((id) => store().removePlan(id)),
        rename: (id: string, name: string) => store().renamePlan(id, name),
        label: t('planName'),
        addLabel: t('newPlan'),
      };
}

/**
 * Copies a link to the tab on screen (on phones, hands it to the share sheet), and says for a moment
 * what happened on the button itself.
 */
export function ShareButton({ className = 'chrome-button', onDone }: { className?: string; onDone?: () => void }) {
  const { t } = useT();
  const tabs = useTabs();
  const [shared, setShared] = useState<'copied' | 'failed'>();
  useEffect(() => {
    if (!shared) return;
    const timer = setTimeout(() => setShared(undefined), 2500);
    return () => clearTimeout(timer);
  }, [shared]);
  const name = tabs.list.find((p) => p.id === tabs.active)?.name ?? '';
  return (
    <button
      type="button"
      className={`${className} share-button ${shared ?? ''}`}
      title={t('shareHint')}
      onClick={async () => {
        const r = await shareTab(name);
        if (r === 'shared') return onDone?.();
        setShared(r);
      }}
    >
      <Glyph name={shared === 'copied' ? 'check' : 'share'} size={18} />
      <span className="chrome-label">{shared === 'copied' ? t('linkCopied') : shared === 'failed' ? t('shareFailed') : t('share')}</span>
    </button>
  );
}

/** A right click on a tab or a row of the list: rename, duplicate and delete for that one, wherever it is. */
function useRowMenu() {
  const { t } = useT();
  const set = useStore((s) => s.set);
  const zoom = useStore((s) => s.settings.uiScale);
  const [at, setAt] = useState<{ x: number; y: number; id: string; plant: boolean }>();
  const close = useCallback(() => setAt(undefined), []);
  const items = at && [
    {
      label: t('rename'),
      onPick: () =>
        set(
          at.plant
            ? { mode: 'power', activePower: at.id, overview: undefined, inspect: undefined, renaming: at.id }
            : { mode: 'factory', active: at.id, overview: undefined, inspect: undefined, renaming: at.id },
        ),
    },
    {
      label: t('duplicate'),
      onPick: () => (at.plant ? useStore.getState().duplicatePowerPlan(at.id) : useStore.getState().duplicatePlan(at.id)),
    },
    {
      label: t('deletePlan'),
      danger: true,
      onPick: () => {
        const s = useStore.getState();
        const name = (at.plant ? s.power : s.plans).find((x) => x.id === at.id)?.name ?? '';
        const before = { plans: s.plans, power: s.power, active: s.active, activePower: s.activePower };
        if (at.plant) s.removePowerPlan(at.id);
        else s.removePlan(at.id);
        set({ closed: { name, before } });
      },
    },
  ];
  return {
    open: (e: ReactMouseEvent, id: string, plant: boolean) => {
      e.preventDefault();
      setAt({ x: e.clientX, y: e.clientY, id, plant });
    },
    menu:
      at && items
        ? createPortal(
            <CardMenu at={{ x: at.x / zoom, y: at.y / zoom }} items={items} onClose={close} fixed />,
            document.querySelector('.app') ?? document.body,
          )
        : null,
  };
}

/** Rename, duplicate and delete for the tab on screen; a deleted tab can be brought back from the toast. */
export function PlanActions({ onDone }: { onDone?: () => void }) {
  const { t } = useT();
  const tabs = useTabs();
  const set = useStore((s) => s.set);
  const active = tabs.active;

  return (
    <>
      <button
        type="button"
        className="menu-item"
        onClick={() => {
          set({ renaming: active });
          onDone?.();
        }}
      >
        <Glyph name="rename" size={18} />
        {t('rename')}
      </button>
      <button
        type="button"
        className="menu-item"
        onClick={() => {
          tabs.duplicate(active);
          onDone?.();
        }}
      >
        <Glyph name="copy" size={18} />
        {t('duplicate')}
      </button>
      <button
        type="button"
        className="menu-item delete"
        onClick={() => {
          tabs.remove(active);
          onDone?.();
        }}
      >
        <Glyph name="trash" size={18} />
        {t('deletePlan')}
      </button>
    </>
  );
}

/** The ⋯ beside the tabs: a small menu with rename, duplicate and delete for the tab on screen. */
function TabMenu() {
  const { t } = useT();
  // Where the menu opens: under the button, drawn outside the tab strip (which scrolls, and would clip it).
  const [open, setOpen] = useState<{ x: number; y: number }>();
  const box = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLSpanElement>(null);
  // The list is zoomed with the interface, which scales its offsets too.
  const zoom = useStore((s) => s.settings.uiScale);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) =>
      !box.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node) && setOpen(undefined);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(undefined);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <span className="tab-menu" ref={box}>
      <button
        type="button"
        className="tab-menu-button"
        aria-label={t('tabActions')}
        title={t('tabActions')}
        aria-expanded={!!open}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOpen((o) => (o ? undefined : { x: r.left, y: r.bottom + 6 }));
        }}
      >
        <Glyph name="more" size={22} />
      </button>
      {open &&
        createPortal(
          <span className="tab-menu-list" role="menu" ref={list} style={{ left: open.x / zoom, top: open.y / zoom }}>
            <PlanActions onDone={() => setOpen(undefined)} />
          </span>,
          document.querySelector('.app') ?? document.body,
        )}
    </span>
  );
}

/** Which way a dragged row is moved: the row under the pointer, within its own group. */
function rowUnder(list: HTMLElement | null, group: string, own: string, y: number): number {
  const rows = [...(list?.querySelectorAll<HTMLElement>(`[data-group="${group}"]`) ?? [])].filter((r) => r.dataset.id !== own);
  return rows.filter((r) => {
    const box = r.getBoundingClientRect();
    return y > box.top + box.height / 2;
  }).length;
}

/**
 * Every factory and power plant in one list: pick one to open it, drag the grip to put it in another place,
 * add a new one at the bottom. "All" (the page with everything side by side) heads the factories once there are two things to compare.
 */
function PlanList({ at, onClose }: { at: { x: number; y: number }; onClose: () => void }) {
  const { t, num } = useT();
  const set = useStore((s) => s.set);
  const moveTab = useStore((s) => s.moveTab);
  const mode = useStore((s) => s.mode);
  const active = useStore((s) => s.active);
  const activePower = useStore((s) => s.activePower);
  const overview = useStore((s) => !!s.overview);
  const o = useOverview();
  const zoom = useStore((s) => s.settings.uiScale);
  const box = useRef<HTMLDivElement>(null);
  const rowMenu = useRowMenu();
  const [dragging, setDragging] = useState<string>();
  const many = o.factories.length + o.plants.filter((p) => !p.empty).length > 1;
  const power = mode === 'power';

  const add = (isPlant: boolean) => {
    const s = useStore.getState();
    const nextName = (base: string, names: string[]) => {
      let n = names.length + 1;
      while (names.includes(`${base} ${n}`)) n++;
      return `${base} ${n}`;
    };
    set({ overview: undefined, mode: isPlant ? 'power' : 'factory' });
    if (isPlant)
      s.addPowerPlan(
        nextName(
          t('plantName'),
          s.power.map((p) => p.name),
        ),
      );
    else
      s.addPlan(
        nextName(
          t('planName'),
          s.plans.map((p) => p.name),
        ),
      );
    onClose();
  };

  const grip = (id: string, name: string, group: 'f' | 'p') => {
    const here = () => (group === 'f' ? o.factories : o.plants).findIndex((x) => x.id === id);
    return (
      <button
        type="button"
        className="plan-grip"
        aria-label={t('moveTab', { name })}
        title={t('moveTab', { name })}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(id);
        }}
        onPointerMove={(e) => {
          if (dragging !== id) return;
          const to = rowUnder(box.current, group, id, e.clientY);
          if (to !== here()) moveTab(id, to, group === 'p');
        }}
        onPointerUp={() => setDragging(undefined)}
        onPointerCancel={() => setDragging(undefined)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          moveTab(id, here() + (e.key === 'ArrowUp' ? -1 : 1), group === 'p');
        }}
      >
        <span aria-hidden />
      </button>
    );
  };

  return (
    <div
      className="plan-list"
      role="menu"
      aria-label={t('tabList')}
      ref={box}
      style={{ '--x': `${at.x / zoom}px`, '--y': `${at.y / zoom}px` } as CSSProperties}
    >
      <h3 className="plan-list-head">{t('ovFactories')}</h3>
      {many && (
        <div className="plan-row all" data-current={overview || undefined}>
          <span className="plan-grip-gap" />
          <button
            type="button"
            className="plan-row-name"
            onClick={() => {
              set({ overview: true, inspect: undefined });
              onClose();
            }}
          >
            <span className="plan-row-label">{t('overviewTab')}</span>
            <span className="plan-row-mw">{t('allTogether')}</span>
          </button>
        </div>
      )}
      {o.factories.map((f) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: a right click is a shortcut to the row's menu; the row's buttons do the same by keyboard
        <div
          key={f.id}
          className="plan-row"
          data-group="f"
          data-id={f.id}
          data-current={(!overview && !power && f.id === active) || undefined}
          data-dragging={dragging === f.id || undefined}
          onContextMenu={(e) => rowMenu.open(e, f.id, false)}
        >
          {grip(f.id, f.name, 'f')}
          <button
            type="button"
            className="plan-row-name"
            onClick={() => {
              set({ mode: 'factory', active: f.id, inspect: undefined });
              onClose();
            }}
          >
            <span className="plan-row-label">{f.name}</span>
            <span className="plan-row-mw">{f.pending || f.failed || f.empty ? '' : `${num(f.mw)} MW`}</span>
          </button>
        </div>
      ))}
      <h3 className="plan-list-head">{t('ovPlants')}</h3>
      {o.plants.map((p) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: a right click is a shortcut to the row's menu; the row's buttons do the same by keyboard
        <div
          key={p.id}
          className="plan-row power"
          data-group="p"
          data-id={p.id}
          data-current={(!overview && power && p.id === activePower) || undefined}
          data-dragging={dragging === p.id || undefined}
          onContextMenu={(e) => rowMenu.open(e, p.id, true)}
        >
          {grip(p.id, p.name, 'p')}
          <button
            type="button"
            className="plan-row-name"
            onClick={() => {
              set({ mode: 'power', activePower: p.id, inspect: undefined });
              onClose();
            }}
          >
            {p.icon && <Icon id={p.icon} size={22} className="plan-tab-icon" />}
            <span className="plan-row-label">{p.name}</span>
            <span className="plan-row-mw">{p.pending || p.failed || p.empty ? '' : `${num(p.made)} MW`}</span>
          </button>
        </div>
      ))}
      <div className="plan-list-add">
        <button type="button" className="primary" onClick={() => add(false)}>
          <span aria-hidden>+</span> {t('newPlan')}
        </button>
        <button type="button" onClick={() => add(true)}>
          <span aria-hidden>+</span> {t('newPlant')}
        </button>
      </div>
      {rowMenu.menu}
    </div>
  );
}

/**
 * The top bar's one tab: the factory or power plant on screen, with a ▾ that opens the list of all of them. Double-click
 * renames it; + adds another of the same kind, ⋯ has rename, duplicate and delete.
 */
export function PlanTabs() {
  const { t } = useT();
  const tabs = useTabs();
  const editing = useStore((s) => s.renaming);
  const set = useStore((s) => s.set);
  const overview = useStore((s) => !!s.overview);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ x: number; y: number }>();
  const rowMenu = useRowMenu();

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) =>
      !box.current?.contains(e.target as Node) &&
      !list.current?.contains(e.target as Node) &&
      !(e.target as Element).closest?.('.card-menu') &&
      setOpen(undefined);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(undefined);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const stopEditing = () => set({ renaming: undefined });
  const current = tabs.list.find((p) => p.id === tabs.active);
  const shown = overview ? t('overviewTab') : (current?.name ?? '');

  return (
    <nav className={`plan-tabs ${tabs.power ? 'power' : ''}`} aria-label={tabs.label} ref={box}>
      {editing && current && editing === current.id && !overview ? (
        <input
          ref={input}
          className="plan-tab editing"
          defaultValue={current.name}
          aria-label={t('rename')}
          onBlur={(e) => {
            tabs.rename(current.id, e.target.value.trim() || current.name);
            stopEditing();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') stopEditing();
          }}
        />
      ) : (
        <button
          type="button"
          className="plan-current"
          title={`${shown}\n${t('renameHint')}`}
          aria-haspopup="menu"
          aria-expanded={!!open}
          onContextMenu={(e) => !overview && current && rowMenu.open(e, current.id, tabs.power)}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setOpen((o) => (o ? undefined : { x: r.left, y: r.bottom }));
          }}
          onDoubleClick={() => {
            if (!overview && current) {
              setOpen(undefined);
              set({ renaming: current.id });
            }
          }}
        >
          {!overview && current?.icon && <Icon id={current.icon} size={22} className="plan-tab-icon" />}
          <span className="plan-tab-label">{shown}</span>
          <span className="plan-caret" aria-hidden />
        </button>
      )}
      <button type="button" className="plan-add" aria-label={tabs.addLabel} title={tabs.addLabel} onClick={tabs.add}>
        +
      </button>
      <TabMenu />
      {rowMenu.menu}
      {open &&
        createPortal(
          <div ref={list} className="plan-list-frame">
            <PlanList at={open} onClose={() => setOpen(undefined)} />
          </div>,
          document.querySelector('.app') ?? document.body,
        )}
    </nav>
  );
}

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../lib/i18n';
import { shareTab } from '../lib/share';
import { useStore } from '../store';
import { Glyph } from './Glyph';
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
        add: () =>
          store().addPowerPlan(
            nextName(
              t('plantName'),
              plants.map((p) => p.name),
            ),
          ),
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
        add: () =>
          store().addPlan(
            nextName(
              t('planName'),
              plans.map((p) => p.name),
            ),
          ),
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

  // More tabs than room: they scroll sideways (the mouse wheel too). Arrows at both ends, a thin bar showing which
  // part of the row is in view and a fade on each side that has more make it clear where the rest is. The tab on
  // screen is kept in view, and the new tab and ⋯ buttons stay put after the row.
  const strip = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ overflow: false, left: false, right: false, start: 0, size: 1 });
  // biome-ignore lint/correctness/useExhaustiveDependencies: a tab added or removed changes what overflows.
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const measure = () =>
      setView({
        overflow: el.scrollWidth > el.clientWidth + 2,
        left: el.scrollLeft > 2,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
        start: el.scrollLeft / el.scrollWidth,
        size: el.clientWidth / el.scrollWidth,
      });
    const wheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    el.addEventListener('wheel', wheel, { passive: false });
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    for (const c of el.children) resize.observe(c);
    return () => {
      el.removeEventListener('scroll', measure);
      el.removeEventListener('wheel', wheel);
      resize.disconnect();
    };
  }, [tabs.list.length]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the tab on screen or the number of tabs changes.
  useEffect(() => {
    strip.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tabs.active, tabs.list.length]);
  const nudge = (dir: 1 | -1) => strip.current?.scrollBy({ left: dir * strip.current.clientWidth * 0.7, behavior: 'smooth' });
  const arrow = (dir: 1 | -1) =>
    view.overflow && (
      <button
        type="button"
        className={`tabs-nudge ${dir < 0 ? 'left' : 'right'}`}
        aria-label={dir < 0 ? t('tabsEarlier') : t('tabsLater')}
        title={dir < 0 ? t('tabsEarlier') : t('tabsLater')}
        disabled={dir < 0 ? !view.left : !view.right}
        onClick={() => nudge(dir)}
      >
        <Glyph name={dir < 0 ? 'chevronLeft' : 'chevronRight'} size={18} />
      </button>
    );

  return (
    <nav className={`plan-tabs ${tabs.power ? 'power' : ''}`} aria-label={tabs.label}>
      {arrow(-1)}
      <div className="plan-tabs-frame" data-more-left={view.left || undefined} data-more-right={view.right || undefined}>
        <div className="plan-tabs-strip" ref={strip}>
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
              <span key={p.id} className="plan-tab" aria-current={p.id === tabs.active ? 'page' : undefined}>
                <button
                  type="button"
                  className="plan-tab-name"
                  title={`${p.name}\n${t('renameHint')}`}
                  onClick={() => tabs.select(p.id)}
                  onDoubleClick={() => set({ renaming: p.id })}
                  onAuxClick={(e) => e.button === 1 && tabs.remove(p.id)}
                >
                  {p.icon && <Icon id={p.icon} size={22} className="plan-tab-icon" />}
                  <span className="plan-tab-label">{p.name}</span>
                </button>
                <button
                  type="button"
                  className="plan-tab-close"
                  aria-label={t('closeTab', { name: p.name })}
                  title={t('closeTab', { name: p.name })}
                  onClick={() => tabs.remove(p.id)}
                >
                  <Glyph name="close" size={14} />
                </button>
              </span>
            ),
          )}
        </div>
        {view.overflow && (
          <span className="tabs-track" aria-hidden>
            <span style={{ left: `${view.start * 100}%`, width: `${view.size * 100}%` }} />
          </span>
        )}
      </div>
      {arrow(1)}
      <button type="button" className="plan-add" aria-label={tabs.addLabel} title={tabs.addLabel} onClick={tabs.add}>
        +
      </button>
      <TabMenu />
    </nav>
  );
}

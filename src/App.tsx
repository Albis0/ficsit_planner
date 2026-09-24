import { useEffect, useMemo, useState } from 'react';
import { GraphView } from './components/GraphView';
import { Inspector } from './components/Inspector';
import { MobileMenu, MobileNav } from './components/MobileChrome';
import { ObjectiveSwitch } from './components/ObjectiveSwitch';
import { PlanTabs } from './components/PlanTabs';
import { InstallButton, PwaStatus } from './components/PwaStatus';
import { QuickPick } from './components/QuickPick';
import { TierDialog } from './components/TierPicker';
import { RecipesPanel } from './components/RecipesPanel';
import { ResourcesPanel } from './components/ResourcesPanel';
import { Summary } from './components/Summary';
import { TableView } from './components/TableView';
import { TargetsPanel } from './components/TargetsPanel';
import { data, recipeById, recipeUnlocked } from './lib/data';
import { effectiveExtraction, planExtraction } from './lib/extraction';
import { useT } from './lib/i18n';
import type { SolveResult } from './lib/solver';
import { solveAsync } from './lib/solverClient';
import { failureText, type SolveFailure } from './lib/solveFailure';
import { usePlan, useStore } from './store';
import { applyScale } from './lib/zoom';

const SCALES = [0.9, 1, 1.1, 1.25, 1.4];

function useSolution() {
  const plan = usePlan();
  const tier = useStore((s) => s.tier);
  const [state, setState] = useState<{ result?: SolveResult; error?: SolveFailure; busy: boolean }>({ busy: false });

  const active = useMemo(() => plan.targets.filter((t) => t.rate > 0), [plan.targets]);
  // Recipes above the unlocked tier (or needing a building that isn't unlocked) stay ticked but sit out.
  const usable = useMemo(
    () => new Set(plan.enabled.filter((id) => recipeUnlocked(recipeById.get(id)!, tier))),
    [plan.enabled, tier],
  );

  useEffect(() => {
    if (active.length === 0) {
      setState({ busy: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, busy: true }));
    // Debounce so typing "120" doesn't solve for 1 and 12 first.
    const timer = setTimeout(async () => {
      try {
        const result = await solveAsync({
          targets: active,
          supplies: plan.supplies,
          enabledRecipes: usable,
          resourceCaps: plan.caps,
          objective: plan.objective,
          mods: plan.mods,
          fixed: plan.fixed,
        });
        if (!cancelled) setState({ result, busy: false });
      } catch (e) {
        if (!cancelled) setState({ error: e as SolveFailure, busy: false });
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, plan.supplies, usable, plan.caps, plan.objective, plan.mods, plan.fixed]);

  return state;
}

export default function App() {
  const { t, lang } = useT();
  const s = useStore();
  const plan = usePlan();
  const { result, error, busy } = useSolution();
  const extraction = useMemo(
    () => (result ? planExtraction(result.raw, effectiveExtraction(plan.extraction, s.tier)) : []),
    [result, plan.extraction, s.tier],
  );

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    applyScale(s.scale);
  }, [s.scale]);

  const scaleIndex = Math.max(0, SCALES.indexOf(s.scale));
  const [tierOpen, setTierOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const tabs = [
    ['targets', t('targets'), plan.targets.length],
    ['recipes', t('recipes'), plan.enabled.length],
    ['resources', t('resources'), null],
  ] as const;

  return (
    <div className="app" data-pane={s.pane}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">FICSIT</span>
        </div>
        <PlanTabs />
        <div className="topbar-controls">
          <InstallButton />
          <button type="button" className="tier-button" title={t('whereAreYou')} onClick={() => setTierOpen(true)}>
            {t('tier')} <b>{s.tier}</b>
          </button>
          <span className="control-label">{t('objective')}</span>
          <ObjectiveSwitch />
          <div className="scale" aria-label={t('uiSize')}>
            <button type="button" aria-label="-" disabled={scaleIndex === 0} onClick={() => s.set({ scale: SCALES[scaleIndex - 1] })}>
              A−
            </button>
            <span>{Math.round(s.scale * 100)}%</span>
            <button
              type="button"
              aria-label="+"
              disabled={scaleIndex === SCALES.length - 1}
              onClick={() => s.set({ scale: SCALES[scaleIndex + 1] })}
            >
              A+
            </button>
          </div>
        </div>
        <button type="button" className="menu-button" aria-label={t('menu')} onClick={() => setMenuOpen(true)}>
          ⋯
        </button>
      </header>

      <aside className="side">
        <nav className="tabs" role="tablist">
          {tabs.map(([id, label, badge]) => (
            <button key={id} type="button" role="tab" aria-selected={s.tab === id} onClick={() => s.set({ tab: id })}>
              {label}
              {badge != null && <span className="tab-badge">{badge}</span>}
            </button>
          ))}
        </nav>
        {s.tab === 'targets' && <TargetsPanel result={result} />}
        {s.tab === 'recipes' && <RecipesPanel />}
        {s.tab === 'resources' && <ResourcesPanel result={result} />}
      </aside>

      <main className="floor">
        {result && !error && <Summary result={result} extraction={extraction} />}
        <div className="floor-view">
          {error && <div className="floor-message error">{failureText(error, t)}</div>}
          {!error && !result && !busy && <QuickPick />}
          {!error && result && (s.view === 'graph' ? <GraphView result={result} extraction={extraction} /> : <TableView result={result} extraction={extraction} />)}
          {!error && result && <Inspector result={result} />}
          {busy && <div className="busy">{t('solving')}</div>}
          {result && (
            <div className="floor-bar">
              <div className="segmented" role="radiogroup">
                <button type="button" role="radio" aria-checked={s.view === 'graph'} onClick={() => s.set({ view: 'graph' })}>
                  {t('graph')}
                </button>
                <button type="button" role="radio" aria-checked={s.view === 'table'} onClick={() => s.set({ view: 'table' })}>
                  {t('table')}
                </button>
              </div>
              {!s.inspect && <span className="floor-hint">{t('inspectHint')}</span>}
            </div>
          )}
        </div>
      </main>
      <MobileNav />
      {menuOpen && <MobileMenu onClose={() => setMenuOpen(false)} onTier={() => setTierOpen(true)} />}
      {(!s.onboarded || tierOpen) && <TierDialog onClose={() => setTierOpen(false)} />}
      <PwaStatus />
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { GraphView } from './components/GraphView';
import { Inspector } from './components/Inspector';
import { MissingList } from './components/MissingList';
import { MobileMenu, MobileNav } from './components/MobileChrome';
import { PlanTabs } from './components/PlanTabs';
import { InstallButton, PwaStatus } from './components/PwaStatus';
import { QuickPick } from './components/QuickPick';
import { TierDialog } from './components/TierPicker';
import { RecipesPanel } from './components/RecipesPanel';
import { ResourcesPanel } from './components/ResourcesPanel';
import { Splitter } from './components/Splitter';
import { Summary } from './components/Summary';
import { TableView } from './components/TableView';
import { TargetsPanel } from './components/TargetsPanel';
import { recipeById, recipeUnlocked } from './lib/data';
import { effectiveExtraction, planExtraction } from './lib/extraction';
import { useT } from './lib/i18n';
import type { SolveResult } from './lib/solver';
import { solveAsync } from './lib/solverClient';
import { failureText, type SolveFailure } from './lib/solveFailure';
import { usePlan, useStore } from './store';

function useSolution() {
  const plan = usePlan();
  const tier = useStore((s) => s.tier);
  const [state, setState] = useState<{ result?: SolveResult; error?: SolveFailure; busy: boolean }>({ busy: false });

  const active = useMemo(() => plan.targets.filter((t) => t.rate > 0), [plan.targets]);
  // Recipes above the unlocked tier (or needing a building that isn't unlocked) stay ticked but sit out.
  const usable = useMemo(() => new Set(plan.enabled.filter((id) => recipeUnlocked(recipeById.get(id)!, tier))), [plan.enabled, tier]);

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
          objective: 'resources',
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
  }, [active, plan.supplies, usable, plan.caps, plan.mods, plan.fixed]);

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

  const [tierOpen, setTierOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const tabs = [
    ['targets', t('targets'), plan.targets.length],
    ['recipes', t('recipes'), plan.enabled.length],
    ['resources', t('resources'), null],
  ] as const;

  // Nothing planned yet: the whole floor asks what to make, and the side panel waits.
  const empty = plan.targets.length === 0;
  // Every target is out of reach (e.g. above the unlocked tier): explain instead of drawing a lone "bring in".
  const blocked = result && result.recipes.length === 0 && result.missing.length > 0;

  return (
    <div
      className="app"
      data-pane={s.pane}
      data-empty={empty || undefined}
      data-deck={s.deckClosed ? 'closed' : undefined}
      style={s.deckHeight ? { ['--deck-h' as string]: `${s.deckHeight}px` } : undefined}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <h1 className="brand-name">
            FICSIT<span className="sr-only"> Planner</span>
          </h1>
        </div>
        <PlanTabs />
        <div className="topbar-controls">
          <InstallButton />
          <button type="button" className="tier-button" title={t('whereAreYou')} onClick={() => setTierOpen(true)}>
            {t('tier')} <b>{s.tier}</b>
          </button>
        </div>
        <button type="button" className="menu-button" aria-label={t('menu')} onClick={() => setMenuOpen(true)}>
          ⋯
        </button>
      </header>

      <aside className="side">
        <div className="tabs" role="tablist">
          {tabs.map(([id, label, badge]) => (
            <button key={id} type="button" role="tab" aria-selected={s.tab === id} onClick={() => s.set({ tab: id, deckClosed: false })}>
              {label}
              {badge != null && <span className="tab-badge">{badge}</span>}
            </button>
          ))}
          <button
            type="button"
            className="deck-toggle"
            aria-expanded={!s.deckClosed}
            title={s.deckClosed ? t('showPanel') : t('hidePanel')}
            onClick={() => s.set({ deckClosed: !s.deckClosed })}
          >
            <span aria-hidden>{s.deckClosed ? '▾' : '▴'}</span>
            <span className="deck-toggle-label">{s.deckClosed ? t('showPanel') : t('hidePanel')}</span>
          </button>
        </div>
        {s.tab === 'targets' && <TargetsPanel result={result} />}
        {s.tab === 'recipes' && <RecipesPanel />}
        {s.tab === 'resources' && <ResourcesPanel result={result} />}
        <Splitter />
      </aside>

      <main className="floor">
        {result && !error && !blocked && <Summary result={result} extraction={extraction} />}
        <div className="floor-view">
          {error && (
            <div className="floor-message error">
              <div className="failure">
                {failureText(error, t)}
                {Object.keys(plan.fixed).length > 0 && (
                  <button type="button" className="primary-button" onClick={() => s.updatePlan({ fixed: {} })}>
                    {t('unpinAll')}
                  </button>
                )}
              </div>
            </div>
          )}
          {empty && <QuickPick />}
          {!error && blocked && (
            <div className="floor-message">
              <div className="blocked">
                <h2 className="quick-title">{t('cantMakeYet')}</h2>
                <MissingList missing={result.missing} />
              </div>
            </div>
          )}
          {!error &&
            result &&
            !blocked &&
            (s.view === 'graph' ? (
              <GraphView result={result} extraction={extraction} />
            ) : (
              <TableView result={result} extraction={extraction} />
            ))}
          {!error && result && !blocked && <Inspector result={result} />}
          {busy && <div className="busy">{t('solving')}</div>}
          {result && !blocked && (
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

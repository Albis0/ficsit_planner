import { useEffect, useMemo, useState } from 'react';
import { GraphView } from './components/GraphView';
import { Glyph } from './components/Glyph';
import { Inspector } from './components/Inspector';
import { MissingList } from './components/MissingList';
import { MobileMenu, MobileNav } from './components/MobileChrome';
import { ModeFlash, ModeSwitch } from './components/ModeSwitch';
import { PlanTabs } from './components/PlanTabs';
import { PlantInspector, PowerQuickStart, PowerSummary } from './components/PowerFloor';
import { PowerPanel } from './components/PowerPanel';
import { InstallButton, PwaStatus } from './components/PwaStatus';
import { QuickPick } from './components/QuickPick';
import { RecipesPanel } from './components/RecipesPanel';
import { ReportDialog } from './components/ReportDialog';
import { ResourcesPanel } from './components/ResourcesPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { Splitter } from './components/Splitter';
import { Summary } from './components/Summary';
import { TableView } from './components/TableView';
import { TargetsPanel } from './components/TargetsPanel';
import { TierDialog } from './components/TierPicker';
import { effectiveExtraction, planExtraction } from './lib/extraction';
import type { Consumer } from './lib/graph';
import { useT } from './lib/i18n';
import { plantIdOf, plantSize, plantUnlocked, plantValid } from './lib/power';
import { settingsStyle } from './lib/settings';
import { factoryInput, gridDemand, gridInput, useFactoryDraws, useSolve } from './lib/solution';
import { failureText } from './lib/solveFailure';
import { useMediaQuery } from './lib/useMediaQuery';
import { usePlan, useStore } from './store';

/**
 * Both planners solve side by side, each only while it's on screen. Switching keeps the other's
 * last result, so the switch's reveal shows a finished screen rather than an empty one.
 */
function useSolutions() {
  const mode = useStore((s) => s.mode);
  const tier = useStore((s) => s.tier);
  const plan = useStore((s) => s.plans.find((p) => p.id === s.active) ?? s.plans[0]);
  const { plants, headroom, chain, exclude, extra } = useStore((s) => s.grid);
  const draws = useFactoryDraws(mode === 'power');
  const outside = gridDemand({ exclude, extra }, draws);

  const { targets, supplies, enabled, caps, mods, fixed } = plan;
  const factoryIn = useMemo(
    () => factoryInput({ targets, supplies, enabled, caps, mods, fixed }, tier),
    [targets, supplies, enabled, caps, mods, fixed, tier],
  );
  const gridIn = useMemo(() => gridInput({ plants, headroom, chain }, outside, tier), [plants, headroom, chain, outside, tier]);
  const factory = useSolve(factoryIn, mode === 'factory');
  const power = useSolve(gridIn, mode === 'power');
  return { factory, power, draws, outside };
}

export default function App() {
  const { t, lang } = useT();
  const s = useStore();
  const plan = usePlan();
  const phone = useMediaQuery('(max-width: 900px)');
  const { factory, power, draws, outside } = useSolutions();
  const powerMode = s.mode === 'power';
  const { result, error, busy } = powerMode ? power : factory;
  const extraction = useMemo(
    () => (result ? planExtraction(result.raw, effectiveExtraction(plan.extraction, s.tier)) : []),
    [result, plan.extraction, s.tier],
  );

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const [tierOpen, setTierOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Power planner: the chain's own draw (machines plus the miners and pumps feeding them), and who the grid feeds.
  const chainDraw = powerMode && result ? result.power + extraction.reduce((sum, u) => sum + u.power, 0) : 0;
  const consumers = useMemo<Consumer[] | undefined>(() => {
    if (!powerMode) return undefined;
    const skip = new Set(s.grid.exclude);
    const list: Consumer[] = draws
      .filter((f) => !skip.has(f.id) && (f.mw ?? 0) > 0)
      .map((f) => ({ id: f.id, label: f.name, mw: f.mw!, tone: 'factory' }));
    if (s.grid.extra > 0) list.push({ id: 'other', label: t('otherLoadShort'), mw: s.grid.extra, tone: 'other' });
    if (chainDraw > 0.01) list.push({ id: 'chain', label: t('fuelChainShort'), mw: chainDraw, tone: 'chain' });
    return list;
  }, [powerMode, draws, s.grid.exclude, s.grid.extra, chainDraw, t]);

  const tabs = [
    ['targets', powerMode ? t('powerTab') : t('targets'), powerMode ? s.grid.plants.length : plan.targets.length],
    ['recipes', t('recipes'), plan.enabled.length],
    ['resources', t('resources'), null],
  ] as const;

  // Nothing planned yet: the whole floor asks what to make (or how to make power), and the panel waits.
  const empty = powerMode ? s.grid.plants.length === 0 : plan.targets.length === 0;
  // Every target is out of reach (e.g. above the unlocked tier): explain instead of drawing a lone "bring in".
  const blocked = !powerMode && result && result.recipes.length === 0 && result.missing.length > 0;
  // Power planner with nothing that can run, or only auto plants and nothing to power: nothing gets
  // built, so say why instead of drawing an empty floor.
  const running = powerMode ? s.grid.plants.filter((p) => plantValid(p) && plantUnlocked(p, s.tier)) : [];
  const idle =
    powerMode && result && !empty && (result.grid?.generation ?? 0) < 1e-6
      ? running.length === 0
        ? 'none'
        : running.every((p) => plantSize(p) === 'auto')
          ? 'nothing'
          : undefined
      : undefined;
  const shown = result && !error && !blocked && !idle;
  const inspectPlant = s.inspect ? plantIdOf(s.inspect) : undefined;
  const panel = phone ? 'top' : s.settings.panel;

  const style: Record<string, string> = settingsStyle(s.settings);
  if (s.deckHeight) style['--deck-h'] = `${s.deckHeight}px`;
  if (s.sideWidth) style['--side-w'] = `${s.sideWidth}px`;

  return (
    <div
      className="app"
      data-mode={s.mode}
      data-pane={s.pane}
      data-panel={panel}
      data-empty={empty || undefined}
      data-deck={s.deckClosed ? 'closed' : undefined}
      data-belt-motion={s.settings.beltMotion ? undefined : 'off'}
      data-motion={s.settings.motion === 'system' ? undefined : s.settings.motion}
      style={style}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <h1 className="brand-name">
            FICSIT<span className="sr-only"> Planner</span>
          </h1>
        </div>
        <ModeSwitch />
        {powerMode ? (
          <div className="grid-title">
            <Glyph name="bolt" size={20} />
            <span>{t('powerGrid')}</span>
          </div>
        ) : (
          <PlanTabs />
        )}
        <div className="topbar-controls">
          <InstallButton />
          <button type="button" className="tier-button" title={t('whereAreYou')} onClick={() => setTierOpen(true)}>
            {t('tier')} <b>{s.tier}</b>
          </button>
          <button type="button" className="chrome-button settings" title={t('settings')} onClick={() => s.set({ dialog: 'settings' })}>
            <Glyph name="gear" size={20} />
            <span className="chrome-label">{t('settings')}</span>
          </button>
          <button type="button" className="chrome-button" title={t('feedback')} onClick={() => s.set({ dialog: 'report' })}>
            <Glyph name="flag" size={20} />
            <span className="chrome-label">{t('feedback')}</span>
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
            <span aria-hidden className="deck-arrow" />
            <span className="deck-toggle-label">{s.deckClosed ? t('showPanel') : t('hidePanel')}</span>
          </button>
        </div>
        {s.tab === 'targets' &&
          (powerMode ? <PowerPanel result={result} draws={draws} chainDraw={chainDraw} /> : <TargetsPanel result={result} />)}
        {s.tab === 'recipes' && <RecipesPanel />}
        {s.tab === 'resources' && <ResourcesPanel result={result} />}
        <Splitter side={panel} />
      </aside>

      <main className="floor">
        {shown &&
          (powerMode ? (
            <PowerSummary
              result={result}
              extraction={extraction}
              totals={{ outside, chain: chainDraw, factories: outside - s.grid.extra }}
            />
          ) : (
            <Summary result={result} extraction={extraction} />
          ))}
        <div className="floor-view">
          {error && (
            <div className="floor-message error">
              <div className="failure">
                {powerMode && error.code === 'infeasible' ? t('errPowerInfeasible') : failureText(error, t)}
                {!powerMode && Object.keys(plan.fixed).length > 0 && (
                  <button type="button" className="primary-button" onClick={() => s.updatePlan({ fixed: {} })}>
                    {t('unpinAll')}
                  </button>
                )}
              </div>
            </div>
          )}
          {empty && (powerMode ? <PowerQuickStart draws={draws} /> : <QuickPick />)}
          {!error && blocked && (
            <div className="floor-message">
              <div className="blocked">
                <h2 className="quick-title">{t('cantMakeYet')}</h2>
                <MissingList missing={result.missing} />
              </div>
            </div>
          )}
          {!error && idle && (
            <div className="floor-message">
              <div className="blocked">
                <h2 className="quick-title">{idle === 'none' ? t('noPlantRuns') : t('nothingToPower')}</h2>
                <p className="hint">{idle === 'none' ? t('noPlantRunsHint') : t('nothingToPowerHint')}</p>
                <button type="button" className="primary-button" onClick={() => s.set({ tab: 'targets', deckClosed: false, pane: 'side' })}>
                  {idle === 'none' ? t('openPlants') : t('setDemand')}
                </button>
              </div>
            </div>
          )}
          {shown &&
            (s.view === 'graph' ? (
              <GraphView result={result} extraction={extraction} consumers={consumers} />
            ) : (
              <TableView result={result} extraction={extraction} />
            ))}
          {shown && (inspectPlant ? <PlantInspector key={inspectPlant} result={result} /> : <Inspector result={result} />)}
          {busy && <div className="busy">{t('solving')}</div>}
          {shown && (
            <div className="floor-bar">
              <div className="segmented" role="radiogroup">
                <button type="button" role="radio" aria-checked={s.view === 'graph'} onClick={() => s.set({ view: 'graph' })}>
                  {t('graph')}
                </button>
                <button type="button" role="radio" aria-checked={s.view === 'table'} onClick={() => s.set({ view: 'table' })}>
                  {t('table')}
                </button>
              </div>
              {!s.inspect && <span className="floor-hint">{powerMode ? t('inspectPowerHint') : t('inspectHint')}</span>}
            </div>
          )}
        </div>
      </main>
      <MobileNav />
      {menuOpen && <MobileMenu onClose={() => setMenuOpen(false)} onTier={() => setTierOpen(true)} />}
      {(!s.onboarded || tierOpen) && <TierDialog onClose={() => setTierOpen(false)} />}
      {s.dialog === 'settings' && <SettingsDialog onClose={() => s.set({ dialog: undefined })} />}
      {s.dialog === 'report' && <ReportDialog onClose={() => s.set({ dialog: undefined })} />}
      <ModeFlash />
      <PwaStatus />
    </div>
  );
}

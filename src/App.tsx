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
import { factoryInput, powerInput, powerLoad, useFactoryDraws, useSolve } from './lib/solution';
import { failureText } from './lib/solveFailure';
import { useMediaQuery } from './lib/useMediaQuery';
import { activePowerPlan, usePlan, useStore } from './store';

/**
 * Both planners solve side by side, each only while it's on screen. Switching keeps the other's
 * last result, so the switch's reveal shows a finished screen rather than an empty one.
 */
function useSolutions() {
  const mode = useStore((s) => s.mode);
  const tier = useStore((s) => s.tier);
  const plan = useStore((s) => s.plans.find((p) => p.id === s.active) ?? s.plans[0]);
  const pp = useStore(activePowerPlan);
  const draws = useFactoryDraws(mode === 'power');
  const load = powerLoad(pp, draws);
  const { plants, sizeBy, have, headroom, ownLoad, chain } = pp;

  const { targets, supplies, enabled, caps, mods, fixed } = plan;
  const factoryIn = useMemo(
    () => factoryInput({ targets, supplies, enabled, caps, mods, fixed }, tier),
    [targets, supplies, enabled, caps, mods, fixed, tier],
  );
  // Sized to what you have with nothing listed yet: nothing to solve, the floor asks for the list.
  const powerIn = useMemo(
    () =>
      sizeBy === 'have' && have.length === 0
        ? undefined
        : powerInput({ plants, sizeBy, have, headroom, ownLoad, chain }, load.demand, tier),
    [plants, sizeBy, have, headroom, ownLoad, chain, load.demand, tier],
  );
  // Sized to what you have: the same plant making a set 1,000 MW shows what its fuel is made from.
  const probeIn = useMemo(
    () => (sizeBy === 'have' ? powerInput({ plants, sizeBy: 'want', have, headroom, ownLoad, chain }, 1000, tier) : undefined),
    [plants, sizeBy, have, headroom, ownLoad, chain, tier],
  );
  const factory = useSolve(factoryIn, mode === 'factory');
  const power = useSolve(powerIn, mode === 'power');
  const probe = useSolve(probeIn, mode === 'power');
  return { factory, power, probe: probe.result, draws, load };
}

export default function App() {
  const { t, lang } = useT();
  const s = useStore();
  const plan = usePlan();
  const phone = useMediaQuery('(max-width: 900px)');
  const { factory, power, probe, draws, load } = useSolutions();
  const powerMode = s.mode === 'power';
  const pp = activePowerPlan(s);
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

  // Power planner: the chain's own draw (machines plus the miners and pumps feeding them), and who the plant feeds.
  const chainDraw = powerMode && result ? result.power + extraction.reduce((sum, u) => sum + u.power, 0) : 0;
  const chainLoad = pp.ownLoad ? chainDraw : 0;
  const generation = result?.grid?.generation ?? 0;
  const consumers = useMemo<Consumer[] | undefined>(() => {
    if (!powerMode) return undefined;
    const list: Consumer[] = [];
    if (pp.sizeBy === 'factories') {
      for (const f of load.fed) if ((f.mw ?? 0) > 0) list.push({ id: f.id, label: f.name, mw: f.mw!, tone: 'factory' });
      if (pp.extra > 0.01) list.push({ id: 'other', label: t('otherLoadShort'), mw: pp.extra, tone: 'other' });
    } else if (pp.sizeBy === 'want' && pp.want > 0) {
      list.push({ id: 'out', label: t('yourTarget'), mw: pp.want, tone: 'out' });
    } else if (pp.sizeBy === 'have' && generation - chainLoad > 0.01) {
      list.push({ id: 'out', label: t('forTheGrid'), mw: generation - chainLoad, tone: 'out' });
    }
    if (chainLoad > 0.01) list.push({ id: 'chain', label: t('fuelChainShort'), mw: chainLoad, tone: 'chain' });
    return list;
  }, [powerMode, pp.sizeBy, pp.want, pp.extra, load, chainLoad, generation, t]);

  const tabs = [
    ['targets', powerMode ? t('powerTab') : t('targets'), powerMode ? pp.plants.length : plan.targets.length],
    ['recipes', t('recipes'), plan.enabled.length],
    ['resources', t('resources'), null],
  ] as const;

  // Nothing planned yet: the whole floor asks what to make (or how to make power), and the panel waits.
  const empty = powerMode ? pp.plants.length === 0 : plan.targets.length === 0;
  // Every target is out of reach (e.g. above the unlocked tier): explain instead of drawing a lone "bring in".
  const blocked = !powerMode && result && result.recipes.length === 0 && result.missing.length > 0;
  // Power planner with nothing that can run, or only auto plants and nothing to power: nothing gets
  // built, so say why instead of drawing an empty floor.
  const running = powerMode ? pp.plants.filter((p) => plantValid(p) && plantUnlocked(p, s.tier)) : [];
  const idle =
    powerMode && result && !empty && generation < 1e-6
      ? running.length === 0
        ? 'none'
        : running.every((p) => plantSize(p) === 'auto')
          ? 'nothing'
          : undefined
      : undefined;
  const listFirst = powerMode && !empty && pp.sizeBy === 'have' && pp.have.length === 0;
  const shown = result && !error && !blocked && !idle && !listFirst;
  const inspectPlant = s.inspect ? plantIdOf(s.inspect) : undefined;
  // The power planner reads top to bottom, so it keeps its panel beside the floor even when factories have it on top.
  const panel = phone ? 'top' : powerMode && s.settings.panel === 'top' ? 'left' : s.settings.panel;

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
        <PlanTabs />
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
          (powerMode ? (
            <PowerPanel result={result} draws={draws} load={load} chainDraw={chainDraw} probe={probe} />
          ) : (
            <TargetsPanel result={result} />
          ))}
        {s.tab === 'recipes' && <RecipesPanel />}
        {s.tab === 'resources' && <ResourcesPanel result={result} />}
        <Splitter side={panel} />
      </aside>

      <main className="floor">
        {shown &&
          (powerMode ? (
            <PowerSummary result={result} load={load} chainDraw={chainDraw} />
          ) : (
            <Summary result={result} extraction={extraction} />
          ))}
        <div className="floor-view">
          {error && (
            <div className="floor-message error">
              <div className="failure">
                {powerMode && error.code === 'infeasible'
                  ? pp.sizeBy === 'have'
                    ? t('errHaveInfeasible')
                    : t('errPowerInfeasible')
                  : failureText(error, t)}
                {!powerMode && Object.keys(plan.fixed).length > 0 && (
                  <button type="button" className="primary-button" onClick={() => s.updatePlan({ fixed: {} })}>
                    {t('unpinAll')}
                  </button>
                )}
              </div>
            </div>
          )}
          {empty && (powerMode ? <PowerQuickStart load={load} /> : <QuickPick />)}
          {!error && blocked && (
            <div className="floor-message">
              <div className="blocked">
                <h2 className="quick-title">{t('cantMakeYet')}</h2>
                <MissingList missing={result.missing} />
              </div>
            </div>
          )}
          {listFirst && (
            <div className="floor-message">
              <div className="blocked">
                <h2 className="quick-title">{t('listWhatYouHave')}</h2>
                <p className="hint">{t('listWhatYouHaveHint')}</p>
                <button type="button" className="primary-button" onClick={() => s.set({ tab: 'targets', deckClosed: false, pane: 'side' })}>
                  {t('setDemand')}
                </button>
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

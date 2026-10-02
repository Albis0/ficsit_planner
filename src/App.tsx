import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { CodexNav, CodexPage, useCodexRoute } from './components/Codex';
import { type FactoryLinks, GraphView } from './components/GraphView';
import { Glyph } from './components/Glyph';
import { Inspector } from './components/Inspector';
import { MapNav } from './components/MapNav';
import { MissingList } from './components/MissingList';
import { MobileMenu, MobileNav } from './components/MobileChrome';
import { ModeSwitch } from './components/ModeSwitch';
import { PlanTabs, ShareButton } from './components/PlanTabs';
import { PlantInspector, PowerQuickStart, PowerSummary } from './components/PowerFloor';
import { PowerPanel } from './components/PowerPanel';
import { InstallButton, ClosedTab, Notice, PwaStatus } from './components/PwaStatus';
import { QuickPick } from './components/QuickPick';
import { RecipesPanel } from './components/RecipesPanel';
import { ReportDialog } from './components/ReportDialog';
import { ResourcesPanel } from './components/ResourcesPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { Splitter } from './components/Splitter';
import { Summary, SummaryHandle } from './components/Summary';
import { TableView } from './components/TableView';
import { TransportView } from './components/TransportView';
import { TargetsPanel } from './components/TargetsPanel';
import { TierDialog } from './components/TierPicker';
import { effectiveExtraction, planExtraction } from './lib/extraction';
import { applyGame } from './lib/game';
import type { Consumer } from './lib/graph';
import { useT } from './lib/i18n';
import { plantIdOf, plantSize, plantUnlocked, plantValid } from './lib/power';
import { settingsStyle } from './lib/settings';
import { showInPanel } from './lib/panel';
import { useSharedLinks } from './lib/share';
import { factoryInput, powerInput, powerLoad, useExports, useFactoryDraws, useSolve } from './lib/solution';
import { failureText } from './lib/solveFailure';
import { fold } from './lib/fold';
import { useMediaQuery } from './lib/useMediaQuery';
import { LATEST_UPDATE } from './locales/updates.en';
import { activePowerPlan, aimOf, usePlan, useStore } from './store';

// Folding the panel moves the app's grid tracks: above the floor a row, beside it a column.
const GRID = ['gridTemplateRows', 'gridTemplateColumns'] as const;

// The map pulls in Leaflet and its tiles, so it loads only when opened.
const WorldMap = lazy(() => import('./components/WorldMap'));

/**
 * Both planners solve side by side, each only while it's on screen. Switching keeps the other's
 * last result, so the switch's reveal shows a finished screen rather than an empty one.
 */
function useSolutions() {
  const mode = useStore((s) => s.mode);
  const tier = useStore((s) => s.tier);
  const aim = useStore(aimOf);
  const game = useStore((s) => s.settings.game);
  // The floor, the table and the Codex read the same recipes the worker solves with.
  applyGame(game);
  const plan = useStore((s) => s.plans.find((p) => p.id === s.active) ?? s.plans[0]);
  const pp = useStore(activePowerPlan);
  const draws = useFactoryDraws(mode === 'power');
  const load = powerLoad(pp, draws);
  const { plants, sizeBy, have, headroom, ownLoad, chain } = pp;

  const { targets, supplies, enabled, caps, mods, fixed, extraction } = plan;
  const exports = useExports(plan.id);
  const factoryIn = useMemo(
    () => factoryInput({ targets, supplies, enabled, caps, mods, fixed, extraction }, tier, exports, aim, game),
    [targets, supplies, enabled, caps, mods, fixed, extraction, tier, exports, aim, game],
  );
  // Sized to what you have with nothing listed yet: nothing to solve, the floor asks for the list.
  const powerIn = useMemo(
    () =>
      sizeBy === 'have' && have.length === 0
        ? undefined
        : powerInput({ plants, sizeBy, have, headroom, ownLoad, chain }, load.demand, tier, aim, game),
    [plants, sizeBy, have, headroom, ownLoad, chain, load.demand, tier, aim, game],
  );
  // Sized to what you have: the same plant making a set 1,000 MW shows what its fuel is made from.
  const probeIn = useMemo(
    () => (sizeBy === 'have' ? powerInput({ plants, sizeBy: 'want', have, headroom, ownLoad, chain }, 1000, tier, aim, game) : undefined),
    [plants, sizeBy, have, headroom, ownLoad, chain, tier, aim, game],
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
  const codexMode = s.mode === 'codex';
  const mapMode = s.mode === 'map';
  // The Codex and the map aren't planners: no plan tabs, no targets panel, their own index on the left.
  const bookMode = codexMode || mapMode;
  useCodexRoute();
  useSharedLinks();
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
  // Someone who has used the app before sees a dot on the gear until they open the new notes.
  const newUpdates = s.onboarded && s.seenUpdates !== LATEST_UPDATE;
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
  const exports = useExports(plan.id);
  // The graph names the tabs this factory sends to and takes from.
  const links = useMemo<FactoryLinks | undefined>(() => {
    if (powerMode) return undefined;
    const nameOf = (id: string) => s.plans.find((p) => p.id === id)?.name ?? '';
    const to = new Map<string, { name: string; rate: number }[]>();
    for (const x of exports) to.set(x.item, [...(to.get(x.item) ?? []), { name: nameOf(x.to), rate: x.rate }]);
    const from = new Map(plan.supplies.flatMap((x) => (x.from ? [[x.item, nameOf(x.from)] as const] : [])));
    return { to, from, own: new Set(plan.targets.map((x) => x.item)) };
  }, [powerMode, exports, plan.supplies, plan.targets, s.plans]);
  const empty = bookMode ? false : powerMode ? pp.plants.length === 0 : plan.targets.length === 0 && exports.length === 0;
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
  // The Codex reads like a book: its index beside the page, on the left.
  const panel = phone ? 'top' : bookMode ? 'left' : powerMode && s.settings.panel === 'top' ? 'left' : s.settings.panel;

  const style: Record<string, string> = settingsStyle(s.settings);
  if (s.deckHeight) {
    style['--deck-h'] = `${s.deckHeight}px`;
    style['--deck-row'] = 'var(--deck)';
  }
  if (s.sideWidth) style['--side-w'] = `${s.sideWidth}px`;

  return (
    <div
      className="app"
      data-mode={s.mode}
      data-pane={s.pane}
      data-panel={panel}
      data-empty={empty || undefined}
      data-deck={s.deckClosed && !bookMode ? 'closed' : undefined}
      data-summary={s.settings.summary}
      data-belt-motion={s.settings.beltMotion ? undefined : 'off'}
      data-motion={s.settings.motion === 'system' ? undefined : s.settings.motion}
      style={style}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <h1 className="brand-name">
            <span className="brand-word">FICSIT</span> <span className="brand-sub">Planner</span>
          </h1>
        </div>
        <ModeSwitch />
        {bookMode ? <span className="topbar-fill" /> : <PlanTabs />}
        <div className="topbar-controls">
          <InstallButton />
          {!bookMode && <ShareButton />}
          <button type="button" className="tier-button" title={t('unlockedTier')} onClick={() => setTierOpen(true)}>
            {t('tier')} <b>{s.tier}</b>
          </button>
          <button type="button" className="chrome-button settings" title={t('settings')} onClick={() => s.set({ dialog: 'settings' })}>
            <Glyph name="gear" size={20} />
            <span className="chrome-label">{t('settings')}</span>
            {newUpdates && <span className="new-dot" role="img" aria-label={t('newUpdates')} />}
          </button>
          <button type="button" className="chrome-button" title={t('feedback')} onClick={() => s.set({ dialog: 'report' })}>
            <Glyph name="flag" size={20} />
            <span className="chrome-label">{t('feedback')}</span>
          </button>
        </div>
        <button type="button" className="menu-button" aria-label={t('menu')} onClick={() => setMenuOpen(true)}>
          ⋯{newUpdates && <span className="new-dot" role="img" aria-label={t('newUpdates')} />}
        </button>
      </header>

      <aside className="side">
        {codexMode && <CodexNav />}
        {mapMode && <MapNav />}
        {!bookMode && (
          <div className="tabs" role="tablist">
            {tabs.map(([id, label, badge]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={s.tab === id}
                onClick={(e) =>
                  s.deckClosed
                    ? fold(e.currentTarget.closest<HTMLElement>('.app'), GRID, () => s.set({ tab: id, deckClosed: false }))
                    : s.set({ tab: id })
                }
              >
                {label}
                {badge != null && <span className="tab-badge">{badge}</span>}
              </button>
            ))}
            <button
              type="button"
              className="deck-toggle"
              aria-expanded={!s.deckClosed}
              title={s.deckClosed ? t('showPanel') : t('hidePanel')}
              onClick={(e) => fold(e.currentTarget.closest<HTMLElement>('.app'), GRID, () => s.set({ deckClosed: !s.deckClosed }))}
            >
              <span aria-hidden className="deck-arrow" />
              <span className="deck-toggle-label">{s.deckClosed ? t('showPanel') : t('hidePanel')}</span>
            </button>
          </div>
        )}
        {!bookMode &&
          s.tab === 'targets' &&
          (powerMode ? (
            <PowerPanel result={result} draws={draws} load={load} chainDraw={chainDraw} probe={probe} />
          ) : (
            <TargetsPanel result={result} />
          ))}
        {!bookMode && s.tab === 'recipes' && <RecipesPanel />}
        {!bookMode && s.tab === 'resources' && <ResourcesPanel result={result} />}
        <Splitter side={panel} />
      </aside>

      <main className="floor">
        {codexMode && <CodexPage />}
        {mapMode && (
          <Suspense fallback={null}>
            <WorldMap />
          </Suspense>
        )}
        {!bookMode &&
          shown &&
          (powerMode ? (
            <PowerSummary result={result} load={load} chainDraw={chainDraw} />
          ) : (
            <Summary result={result} extraction={extraction} />
          ))}
        {!bookMode && (
          <div className="floor-view">
            {shown && !powerMode && <SummaryHandle />}
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
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => showInPanel('targets', '.panel-body.power .size-by', '.size-box .add-button')}
                  >
                    {t('addHave')}
                  </button>
                </div>
              </div>
            )}
            {!error && idle && (
              <div className="floor-message">
                <div className="blocked">
                  <h2 className="quick-title">{idle === 'none' ? t('noPlantRuns') : t('nothingToPower')}</h2>
                  <p className="hint">{idle === 'none' ? t('noPlantRunsHint') : t('nothingToPowerHint')}</p>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => showInPanel('targets', `.panel-body.power .${idle === 'none' ? 'gens' : 'size-by'}`)}
                  >
                    {idle === 'none' ? t('openPlants') : t('setDemand')}
                  </button>
                </div>
              </div>
            )}
            {shown &&
              (s.view === 'table' ? (
                <TableView result={result} extraction={extraction} />
              ) : s.view === 'transport' && !powerMode ? (
                <TransportView result={result} links={links} />
              ) : (
                <GraphView result={result} extraction={extraction} consumers={consumers} links={links} />
              ))}
            {shown && (inspectPlant ? <PlantInspector key={inspectPlant} result={result} /> : <Inspector result={result} />)}
            {busy && <div className="busy">{t('solving')}</div>}
            {shown && (
              <div className="floor-bar">
                <div className="segmented" role="radiogroup">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={s.view === 'graph' || (powerMode && s.view === 'transport')}
                    onClick={() => s.set({ view: 'graph' })}
                  >
                    {t('graph')}
                  </button>
                  <button type="button" role="radio" aria-checked={s.view === 'table'} onClick={() => s.set({ view: 'table' })}>
                    {t('table')}
                  </button>
                  {!powerMode && (
                    <button type="button" role="radio" aria-checked={s.view === 'transport'} onClick={() => s.set({ view: 'transport' })}>
                      {t('transportView')}
                    </button>
                  )}
                </div>
                {!s.inspect && <span className="floor-hint">{powerMode ? t('inspectPowerHint') : t('inspectHint')}</span>}
              </div>
            )}
          </div>
        )}
      </main>
      <MobileNav />
      {menuOpen && <MobileMenu onClose={() => setMenuOpen(false)} onTier={() => setTierOpen(true)} />}
      {(!s.onboarded || tierOpen) && <TierDialog onClose={() => setTierOpen(false)} />}
      {s.dialog === 'settings' && <SettingsDialog onClose={() => s.set({ dialog: undefined })} />}
      {s.dialog === 'report' && <ReportDialog onClose={() => s.set({ dialog: undefined })} />}
      <Notice />
      <ClosedTab />
      <PwaStatus />
    </div>
  );
}

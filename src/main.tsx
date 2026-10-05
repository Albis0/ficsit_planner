import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './fonts';
import './styles.css';
import './styles/frame.css';
import './styles/plan-tabs.css';
import './styles/buttons-and-fields.css';
import './styles/inventory-slot.css';
import './styles/panel/side-panel.css';
import './styles/panel/item-picker.css';
import './styles/panel/recipes.css';
import './styles/panel/resources.css';
import './styles/factory-floor.css';
import './styles/quick-pick.css';
import './styles/summary-readouts.css';
import './styles/graph/graph-nodes.css';
import './styles/graph/graph-edges.css';
import './styles/inspector.css';
import './styles/table-view.css';
import './styles/transport-view.css';
import './styles/belts-and-pipes.css';
import './styles/pinned-raw-inputs.css';
import './styles/tier-and-first-run.css';
import './styles/inventory.css';
import './styles/build-bill.css';
import './styles/shards-and-sloops.css';
import './styles/install-and-offline.css';
import './styles/interface-size.css';
import './styles/mode-switch.css';
import './styles/top-bar.css';
import './styles/power/panel.css';
import './styles/power/floor.css';
import './styles/modals.css';
import './styles/settings.css';
import './styles/feedback.css';
import './styles/panel/beside-floor.css';
import './styles/motion.css';
import './styles/responsive.css';
import './styles/crash-screen.css';
import './styles/settings/save-bar.css';
import './styles/codex.css';
import './styles/settings/help.css';
import './styles/world-map.css';
import './styles/game-look.css';
import './styles/machine-console.css';
import './styles/folding.css';
import './styles/hand-build-floor.css';

import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
// Catches the install prompt even if it fires before React mounts.
import './lib/install';
// Highlights glide between picks in a row of choices.
import './lib/slide';

// Additions kept on this machine only, if there are any.
import.meta.glob('./lib/*.local.ts', { eager: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

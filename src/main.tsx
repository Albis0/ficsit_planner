import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './fonts';
import './styles.css';
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

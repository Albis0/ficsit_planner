import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './fonts';
import './styles.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
// Catches the install prompt even if it fires before React mounts.
import './lib/install';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

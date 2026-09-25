import { Component, type ReactNode } from 'react';
import { exportAll, wipeLocal } from '../lib/backup';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { useStore } from '../store';

/**
 * Last line of defence: if a render throws (say, a damaged save), show a way out instead of a blank
 * page — save a copy of the data, reset the settings, or start clean — rather than crashing on every load.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const retry = () => this.setState({ error: undefined });
    return (
      <div className="crash" role="alert">
        <div className="crash-box">
          <span className="brand-mark" aria-hidden />
          <h1 className="crash-title">Something broke</h1>
          <p className="hint">
            The planner hit an error it couldn't recover from. Your factories are still saved in this browser. Save a copy first, then try
            the steps below in order.
          </p>
          <code className="crash-detail">{error.message}</code>
          <div className="crash-actions">
            <button type="button" className="ghost-button" onClick={exportAll}>
              Save a copy
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                useStore.setState({ settings: DEFAULT_SETTINGS, mode: 'factory', dialog: undefined, inspect: undefined });
                retry();
              }}
            >
              Reset settings and try again
            </button>
            <button
              type="button"
              className="ghost-button danger"
              onClick={() => {
                wipeLocal();
                location.reload();
              }}
            >
              Start clean
            </button>
          </div>
        </div>
      </div>
    );
  }
}

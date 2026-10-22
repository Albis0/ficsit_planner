import { describe, expect, test } from 'bun:test';

import { fireEvent, render, cleanup } from '@testing-library/react';
import { SaveSection } from '../../src/components/SaveSection';
import { useStore } from '../../src/store';
import { ALL_ANSWERS } from '../../src/lib/save/apply';

const followed = (more = {}) => ({
  session: 's1',
  game: 'ela',
  file: 'SPACE',
  savedAt: Date.now(),
  playSeconds: 3600,
  saveVersion: 60,
  build: 502094,
  importedAt: Date.now(),
  answers: ALL_ANSWERS,
  seen: { tier: 3, skipped: [], unlocked: [], sloops: 0, shards: 0 },
  ...more,
});

describe('Settings › Game save', () => {
  test('without a save it offers the import', () => {
    useStore.setState({ save: undefined });
    const view = render(<SaveSection />);
    expect(view.getByText('Import save')).toBeTruthy();
    cleanup();
  });

  test('what Refresh takes can be switched between the player’s own saves and the autosaves', () => {
    useStore.setState({ save: followed({ from: 'manual' }) });
    const view = render(<SaveSection />);
    const manual = view.getByRole('radio', { name: 'Latest save of yours' });
    const auto = view.getByRole('radio', { name: 'Latest autosave' });
    expect(manual.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(auto);
    expect(useStore.getState().save?.from).toBe('auto');
    expect(auto.getAttribute('aria-checked')).toBe('true');
    cleanup();
  });

  test('a switch turns one thing off for the next refresh', () => {
    useStore.setState({ save: followed() });
    const view = render(<SaveSection />);
    expect(useStore.getState().save?.answers.power).toBe(true);
    fireEvent.click(view.getByRole('switch', { name: 'Power circuits' }));
    expect(useStore.getState().save?.answers.power).toBe(false);
    cleanup();
  });
});

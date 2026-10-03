import { expect, test } from 'bun:test';
import { cleanSettings } from '../src/lib/sanitize';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

test('layout settings default to network simplex, right angles, balanced', () => {
  expect(DEFAULT_SETTINGS.layoutPlacement).toBe('NETWORK_SIMPLEX');
  expect(DEFAULT_SETTINGS.edgeRouting).toBe('ORTHOGONAL');
  expect(DEFAULT_SETTINGS.layoutEffort).toBe('balanced');
});

test('saved layout settings are kept when known and defaulted when not', () => {
  const kept = cleanSettings({ layoutPlacement: 'BRANDES_KOEPF', edgeRouting: 'SPLINES', layoutEffort: 'thorough' });
  expect([kept.layoutPlacement, kept.edgeRouting, kept.layoutEffort]).toEqual(['BRANDES_KOEPF', 'SPLINES', 'thorough']);
  const junk = cleanSettings({ layoutPlacement: 'DAGRE', edgeRouting: 7, layoutEffort: null });
  expect([junk.layoutPlacement, junk.edgeRouting, junk.layoutEffort]).toEqual(['NETWORK_SIMPLEX', 'ORTHOGONAL', 'balanced']);
});

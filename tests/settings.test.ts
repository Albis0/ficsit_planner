import { expect, test } from 'bun:test';
import { cleanSettings } from '../src/lib/sanitize';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

test('machine clocks default to single and keep average when saved', () => {
  expect(DEFAULT_SETTINGS.clockSpread).toBe('single');
  expect(cleanSettings({ clockSpread: 'average' }).clockSpread).toBe('average');
  expect(cleanSettings({ clockSpread: 'even' }).clockSpread).toBe('single');
});

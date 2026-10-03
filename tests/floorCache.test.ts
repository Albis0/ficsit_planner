import { expect, test } from 'bun:test';
import { recallFloor, rememberFloor } from '../src/lib/floorCache';

test('the last floor of a solve comes back while the settings it was laid out with are the same', () => {
  const result = {};
  rememberFloor(result, 'LR|balanced', 'floor A');
  expect(recallFloor(result, 'LR|balanced')).toBe('floor A');
  // Other settings, or another solve: lay out afresh.
  expect(recallFloor(result, 'TB|balanced')).toBeUndefined();
  expect(recallFloor({}, 'LR|balanced')).toBeUndefined();
  // Only the latest is kept.
  rememberFloor(result, 'TB|fast', 'floor B');
  expect(recallFloor(result, 'LR|balanced')).toBeUndefined();
  expect(recallFloor(result, 'TB|fast')).toBe('floor B');
});

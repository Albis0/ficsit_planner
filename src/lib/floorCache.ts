/**
 * The last floor laid out for each solve, with the settings it was laid out with, so coming back to the floor (from
 * the table, or another tab) shows it at once instead of an empty floor while it's laid out again.
 */
const floors = new WeakMap<object, { key: string; floor: unknown }>();

export function rememberFloor<T>(result: object, key: string, floor: T): void {
  floors.set(result, { key, floor });
}

export function recallFloor<T>(result: object, key: string): T | undefined {
  const kept = floors.get(result);
  return kept && kept.key === key ? (kept.floor as T) : undefined;
}

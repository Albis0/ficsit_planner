import { describe, expect, test } from 'bun:test';
import { typedHex } from '../src/components/modeler/ColorWheel';
import { type Found, kindOf, latestOf } from '../src/lib/save/files';

const save = (name: string): Found => ({ file: { name } as File, header: {} as Found['header'] });

describe('a typed colour', () => {
  test('is taken with or without the hash, long or short, in any case', () => {
    expect(typedHex('#ABC123')).toBe('#abc123');
    expect(typedHex('abc123')).toBe('#abc123');
    expect(typedHex(' #fa0 ')).toBe('#ffaa00');
  });
  test('is nothing yet while it is not a colour', () => {
    for (const bad of ['', '#', '#ab', '#abcd', '#abcde', '#abcdeg', '##abc123', 'abc1234']) expect(typedHex(bad)).toBeUndefined();
  });
});

describe('manual saves and autosaves', () => {
  test('the game’s autosaves are told from the player’s own by their file name', () => {
    expect(kindOf({ name: 'SPACE_autosave_0.sav' })).toBe('auto');
    expect(kindOf({ name: 'SPACE_AUTOSAVE_2.SAV' })).toBe('auto');
    expect(kindOf({ name: 'SPACE.sav' })).toBe('manual');
    expect(kindOf({ name: 'my_autosave_plan.sav' })).toBe('manual');
  });

  test('the newest of a kind is taken, and the newest of any kind when there is none of it', () => {
    const saves = [save('S_autosave_1.sav'), save('S.sav'), save('S_autosave_0.sav'), save('S_old.sav')];
    expect(latestOf(saves, 'manual').file.name).toBe('S.sav');
    expect(latestOf(saves, 'auto').file.name).toBe('S_autosave_1.sav');
    expect(latestOf(saves, undefined).file.name).toBe('S_autosave_1.sav');
    expect(latestOf([save('S.sav')], 'auto').file.name).toBe('S.sav');
  });
});

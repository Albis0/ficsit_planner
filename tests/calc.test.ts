import { expect, test } from 'bun:test';
import { calculate, shown } from '../src/lib/calc';

test('the calculator works out sums, in the order of arithmetic', () => {
  expect(calculate('2+3*4')).toBe(14);
  expect(calculate('(2+3)*4')).toBe(20);
  expect(calculate('10 ÷ 4')).toBe(2.5);
  expect(calculate('1,5 × 2')).toBe(3);
  expect(calculate('-3 + 5')).toBe(2);
  expect(calculate('50%')).toBe(0.5);
  expect(calculate('200*15%')).toBe(30);
  expect(calculate('2*-3')).toBe(-6);
});

test('what is not a sum, or has no answer, gives none', () => {
  for (const bad of ['', '2+', '(2', '2)', 'abc', '1/0', '0/0', 'alert(1)', '1e999*1e999']) expect(calculate(bad)).toBeUndefined();
});

test('results are shown without float dust', () => {
  expect(shown(0.1 + 0.2)).toBe('0.3');
  expect(shown(120)).toBe('120');
  expect(shown(1 / 3)).toBe('0.3333333333');
});

import { describe, expect, test } from 'bun:test';

import { cleanup, fireEvent, render } from '@testing-library/react';
import { RateInput } from '../../src/components/RateInput';

describe('a clock field that commits when left', () => {
  test('left untouched it sends nothing, so the machine count does not step', () => {
    const seen: number[] = [];
    const view = render(<RateInput value={83.13} label="Clock" deferred onChange={(n) => seen.push(n)} />);
    const field = view.getByLabelText('Clock') as HTMLInputElement;
    fireEvent.focus(field);
    fireEvent.blur(field);
    expect(seen).toEqual([]);

    fireEvent.change(field, { target: { value: '75' } });
    expect(seen).toEqual([]);
    fireEvent.blur(field);
    expect(seen).toEqual([75]);
    cleanup();
  });
});

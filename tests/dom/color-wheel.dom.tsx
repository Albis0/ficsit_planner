import { describe, expect, test } from 'bun:test';

import { fireEvent, render, cleanup } from '@testing-library/react';
import { ColorWheel } from '../../src/components/modeler/ColorWheel';

describe('the colour wheel’s hex field', () => {
  test('six digits typed make the colour at once; the short form waits until the field is left', () => {
    const seen: string[] = [];
    const view = render(<ColorWheel value="#fa9549" label="Colour" onChange={(hex) => seen.push(hex)} />);
    const field = view.getByLabelText('Colour (hex)') as HTMLInputElement;
    expect(field.value).toBe('#fa9549');

    fireEvent.change(field, { target: { value: '#abc12' } });
    expect(seen).toEqual([]);
    fireEvent.change(field, { target: { value: '#ABC123' } });
    expect(seen).toEqual(['#abc123']);

    fireEvent.change(field, { target: { value: '#0f0' } });
    expect(seen).toEqual(['#abc123']);
    fireEvent.blur(field);
    expect(seen).toEqual(['#abc123', '#00ff00']);

    // Left half-typed: nothing is taken, and the field shows the colour again.
    fireEvent.change(field, { target: { value: '#12' } });
    fireEvent.blur(field);
    expect(seen).toHaveLength(2);
    expect(field.value).toBe('#fa9549');
    cleanup();
  });
});

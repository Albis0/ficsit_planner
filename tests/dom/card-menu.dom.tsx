import { describe, expect, test } from 'bun:test';

import { fireEvent, render, cleanup } from '@testing-library/react';
import { CardMenu } from '../../src/components/modeler/CardMenu';

const items = [
  { label: 'Copy', onPick: () => {} },
  { label: 'Delete', danger: true, onPick: () => {} },
];

describe('the card menu', () => {
  test('the first entry has the keyboard, and Escape closes it even where the floor swallows keys', () => {
    let closed = 0;
    const view = render(<CardMenu at={{ x: 10, y: 10 }} items={items} onClose={() => closed++} />);
    expect(document.activeElement?.textContent).toContain('Copy');
    fireEvent.keyDown(view.getByRole('menu'), { key: 'Escape' });
    expect(closed).toBe(1);
    cleanup();
  });

  test('a press outside closes it, a press inside does not', () => {
    let closed = 0;
    const view = render(<CardMenu at={{ x: 10, y: 10 }} items={items} onClose={() => closed++} />);
    fireEvent.pointerDown(view.getByRole('menu'));
    expect(closed).toBe(0);
    fireEvent.pointerDown(document.body);
    expect(closed).toBe(1);
    cleanup();
  });

  test('picking an entry runs it', () => {
    const picked: string[] = [];
    const view = render(
      <CardMenu at={{ x: 0, y: 0 }} items={items.map((i) => ({ ...i, onPick: () => picked.push(i.label) }))} onClose={() => {}} />,
    );
    fireEvent.click(view.getByText('Delete'));
    expect(picked).toEqual(['Delete']);
    cleanup();
  });
});

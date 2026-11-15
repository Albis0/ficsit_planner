import { cleanup, fireEvent, render } from '@testing-library/react';
import { describe, expect, test } from 'bun:test';
import { NewWorldDialog } from '../../src/components/NewWorldDialog';
import { MAX_TIER, useStore } from '../../src/store';

const one = () => useStore.setState({ worlds: [], world: { id: 'main', name: 'World 1' }, randomNodes: undefined, dialog: undefined });

describe('the New world window', () => {
  test('asks for the name, the tier, the three multipliers and random nodes, with the next free name filled in', () => {
    one();
    const view = render(<NewWorldDialog onClose={() => {}} />);
    expect((view.getByLabelText('Name') as HTMLInputElement).value).toBe('World 2');
    expect(view.getByRole('button', { name: `Tier ${MAX_TIER}` }).getAttribute('aria-pressed')).toBe('true');
    for (const label of ['Part cost', 'Power use', 'Space Elevator cost'])
      expect((view.getByLabelText(label) as HTMLInputElement).value).toBe('1');
    expect(view.getByRole('switch', { name: 'Random resource nodes' }).getAttribute('aria-checked')).toBe('false');
    expect(view.getByRole('button', { name: 'Create' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    cleanup();
  });

  test('Cancel opens nothing', () => {
    one();
    let closed = 0;
    const view = render(<NewWorldDialog onClose={() => closed++} />);
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
    expect(closed).toBe(1);
    expect(useStore.getState().worlds).toHaveLength(0);
    expect(useStore.getState().world.name).toBe('World 1');
    cleanup();
  });

  test('Create opens a world with what was asked, and Enter in the name does the same', () => {
    one();
    let closed = 0;
    const view = render(<NewWorldDialog onClose={() => closed++} />);
    fireEvent.change(view.getByLabelText('Name'), { target: { value: 'Dunarr' } });
    fireEvent.click(view.getByRole('button', { name: 'Tier 4' }));
    fireEvent.change(view.getByLabelText('Part cost'), { target: { value: '0.5' } });
    fireEvent.click(view.getByRole('switch', { name: 'Random resource nodes' }));
    fireEvent.click(view.getByRole('button', { name: 'Create' }));
    const s = useStore.getState();
    expect(closed).toBe(1);
    expect(s.world.name).toBe('Dunarr');
    expect(s.worlds.map((w) => w.name)).toEqual(['World 1']);
    expect(s.tier).toBe(4);
    expect(s.settings.game.parts).toBe(0.5);
    expect(s.randomNodes).toBe(true);
    cleanup();

    one();
    const again = render(<NewWorldDialog onClose={() => {}} />);
    fireEvent.submit(again.getByLabelText('Name'));
    expect(useStore.getState().world.name).toBe('World 2');
    expect(useStore.getState().randomNodes).toBeUndefined();
    cleanup();
    one();
  });
});

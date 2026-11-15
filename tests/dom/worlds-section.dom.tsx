import { cleanup, fireEvent, render } from '@testing-library/react';
import { describe, expect, test } from 'bun:test';
import { WorldsSection } from '../../src/components/WorldsSection';
import { useStore } from '../../src/store';

const one = () => useStore.setState({ worlds: [], world: { id: 'main', name: 'World 1' }, dialog: undefined });

describe('Settings › Worlds', () => {
  test('with one world: its name, marked open, rename, no delete', () => {
    one();
    const view = render(<WorldsSection onSwitched={() => {}} />);
    expect(view.getByText('World 1')).toBeTruthy();
    expect(view.getByText('Open now')).toBeTruthy();
    expect(view.queryByRole('button', { name: /^Delete world/ })).toBeNull();
    expect(view.getByRole('button', { name: 'Rename: World 1' })).toBeTruthy();
    cleanup();
  });

  test('lists every world with the open one marked, and Open switches and tells the settings', () => {
    one();
    useStore.getState().addWorld();
    let switched = 0;
    const view = render(<WorldsSection onSwitched={() => switched++} />);
    const rows = view.getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('.world-name')?.textContent)).toEqual(['World 2', 'World 1']);
    expect(rows.map((r) => r.hasAttribute('data-open'))).toEqual([true, false]);
    fireEvent.click(view.getByRole('button', { name: 'Open: World 1' }));
    expect(useStore.getState().world.name).toBe('World 1');
    expect(switched).toBe(1);
    cleanup();
    one();
  });

  test('New world opens the window instead of making a world', () => {
    one();
    useStore.getState().addWorld();
    const view = render(<WorldsSection onSwitched={() => {}} />);
    fireEvent.click(view.getByRole('button', { name: 'New world' }));
    expect(useStore.getState().dialog).toBe('newWorld');
    expect(useStore.getState().worlds).toHaveLength(1);
    cleanup();
    one();
  });

  test('rename changes the name', () => {
    one();
    const view = render(<WorldsSection onSwitched={() => {}} />);
    fireEvent.click(view.getByRole('button', { name: 'Rename: World 1' }));
    const field = view.getByLabelText('Rename') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Random' } });
    fireEvent.blur(field);
    expect(useStore.getState().world.name).toBe('Random');
    cleanup();
    one();
  });

  test('delete asks first, and Cancel leaves the world alone', () => {
    one();
    useStore.getState().addWorld();
    const view = render(<WorldsSection onSwitched={() => {}} />);
    fireEvent.click(view.getByRole('button', { name: 'Delete world: World 1' }));
    expect(view.getByRole('alert').textContent).toContain('Delete World 1?');
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
    expect(useStore.getState().worlds).toHaveLength(1);
    fireEvent.click(view.getByRole('button', { name: 'Delete world: World 1' }));
    fireEvent.click(view.getByRole('button', { name: 'Delete world' }));
    expect(useStore.getState().worlds).toHaveLength(0);
    cleanup();
    one();
  });
});

import { useEffect } from 'react';
import { useStore } from '../store';

/** Whether the key went to a field or a dialog, where Ctrl+Z belongs to the field. */
const typing = (e: KeyboardEvent) =>
  !!(e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]') || !!document.querySelector('dialog[open]');

/** Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z undo and redo the plan on screen (the Auto floor and the power plant), when `on`. */
export function useUndoKeys(on: boolean) {
  const undoPlan = useStore((s) => s.undoPlan);
  const redoPlan = useStore((s) => s.redoPlan);
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || typing(e)) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      e.preventDefault();
      if (key === 'y' || e.shiftKey) redoPlan();
      else undoPlan();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on, undoPlan, redoPlan]);
}

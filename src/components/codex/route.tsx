import { type ReactNode, useEffect } from 'react';
import { loadCodex, type Page, pageKey, parsePage } from '../../lib/codex';
import { useStore } from '../../store';

export const HASH = '#codex';

/** Opens a Codex page, as a new step in the browser's history so Back returns to the last one. */
export function goCodex(page: Page) {
  const key = pageKey(page);
  const hash = key ? `${HASH}/${key}` : HASH;
  if (location.hash !== hash) history.pushState(null, '', hash);
  useStore.getState().set({ mode: 'codex', codexPage: key, pane: 'floor', inspect: undefined });
}

/**
 * Keeps the address and the Codex in step: #codex/item/Desc_Motor_C opens that page (a shared link,
 * or Back and Forward), and leaving the Codex clears it again.
 */
export function useCodexRoute() {
  const mode = useStore((s) => s.mode);
  const page = useStore((s) => s.codexPage);
  useEffect(() => {
    const read = () => {
      if (!location.hash.startsWith(HASH)) return;
      const key = pageKey(parsePage(location.hash.slice(HASH.length + 1)));
      // A link to a page opens on the page, also on phones where the index might be showing.
      useStore.getState().set({ mode: 'codex', codexPage: key, ...(key ? { pane: 'floor' as const } : {}) });
    };
    read();
    window.addEventListener('popstate', read);
    window.addEventListener('hashchange', read);
    return () => {
      window.removeEventListener('popstate', read);
      window.removeEventListener('hashchange', read);
    };
  }, []);
  useEffect(() => {
    const hash = page ? `${HASH}/${page}` : HASH;
    if (mode === 'codex' && location.hash !== hash) history.replaceState(null, '', hash);
    if (mode !== 'codex' && location.hash.startsWith(HASH)) history.replaceState(null, '', location.pathname + location.search);
  }, [mode, page]);
  // Warm the file up once the planner has settled, so the first visit opens at once.
  useEffect(() => {
    const id = setTimeout(() => loadCodex(), 4000);
    return () => clearTimeout(id);
  }, []);
}

/** A link to a Codex page: a real link (so it opens in a new tab too), handled in place on a plain click. */
export function CodexLink({ page, className, children, title }: { page: Page; className?: string; children: ReactNode; title?: string }) {
  const key = pageKey(page);
  // The page on screen: marked, so a press that stays put reads as intended.
  const here = useStore((s) => s.mode === 'codex' && s.codexPage === key);
  return (
    <a
      className={className}
      href={key ? `${HASH}/${key}` : HASH}
      title={title}
      aria-current={here ? 'page' : undefined}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        goCodex(page);
      }}
    >
      {children}
    </a>
  );
}

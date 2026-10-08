import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';

// What was open stays open while the panel is switched away and back.
const remembered = new Map<string, boolean>();
/** The panel is this narrow (folding.css) when its sections fold. */
const NARROW = 480;

interface Props {
  id: string;
  title: string;
  /** One line shown beside the title while the section is folded, e.g. what is in it. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  /** Buttons that go with the section; they show only while it is open in a narrow panel. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * A section of the side panel. Across the top, or in a wide panel, it is a plain titled column; in a narrow panel
 * the title becomes a row that folds the section down to one line (see folding.css).
 */
export function Fold({ id, title, summary, defaultOpen = false, actions, className = '', children }: Props) {
  const [open, setOpen] = useState(() => remembered.get(id) ?? defaultOpen);
  const root = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const side = root.current?.closest('.side');
    if (!side) return;
    const watch = new ResizeObserver(() => setNarrow(side.clientWidth <= NARROW));
    watch.observe(side);
    return () => watch.disconnect();
  }, []);
  const flip = () => {
    remembered.set(id, !open);
    setOpen(!open);
  };
  return (
    <section ref={root} className={`stack fold ${className}`} data-open={open}>
      <div className="fold-top">
        <h3 className="section-title fold-title">
          <button type="button" className="fold-head" aria-expanded={narrow ? open : undefined} tabIndex={narrow ? 0 : -1} onClick={flip}>
            <span className="fold-name">{title}</span>
            {summary != null && <span className="fold-summary">{summary}</span>}
            <span className="fold-chevron" aria-hidden />
          </button>
        </h3>
        {actions && <div className="fold-actions">{actions}</div>}
      </div>
      <div className="fold-body">{children}</div>
    </section>
  );
}

import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { Glyph, type GlyphName } from './Glyph';

/**
 * Modal panel in the game's style: a charcoal plate with a cut corner, a hazard-striped header
 * edge and the title in condensed caps. Opens with a short rise, closes the same way.
 */
export function Dialog({
  title,
  icon,
  className = '',
  onClose,
  children,
}: {
  title: string;
  icon: GlyphName;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    ref.current?.showModal();
    // Taking an open dialog out of the page skips the browser's own focus return, so hand focus back
    // to whatever opened it (the gear, the flag), where a keyboard user left off.
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const close = () => {
    if (closing) return;
    setClosing(true);
    // Leaves time for the closing animation; reduced motion makes it instant in CSS anyway.
    setTimeout(onClose, 160);
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape and the close button cover keyboard users; this is the backdrop click.
    <dialog
      ref={ref}
      className={`modal ${className}`}
      data-closing={closing || undefined}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => e.target === ref.current && close()}
    >
      <header className="modal-head">
        <span className="modal-icon">
          <Glyph name={icon} size={22} />
        </span>
        <h2 id={titleId} className="modal-title">
          {title}
        </h2>
        <button type="button" className="modal-close" aria-label={t('close')} onClick={close}>
          <Glyph name="close" size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}

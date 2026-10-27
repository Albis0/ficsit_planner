import { useEffect, useState } from 'react';
import { buildingById, data } from '../lib/data';
import { useT } from '../lib/i18n';
import { type BillLine, useMaterials } from '../lib/materials';
import { useStore } from '../store';
import { Glyph } from './Glyph';
import { Icon } from './Icon';

/** A panel beside the All page: what it takes to build every factory, and which factory needs how much of each. */
export function MaterialsPanel({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const set = useStore((s) => s.set);
  const [builtToo, setBuiltToo] = useState(false);
  const bill = useMaterials(builtToo);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const open = (id: string) => set({ mode: 'factory', active: id, inspect: undefined });
  return (
    <aside className="materials" aria-label={t('materials')}>
      <header className="materials-head">
        <h2>{t('materials')}</h2>
        <button type="button" className="icon-button" aria-label={t('close')} onClick={onClose}>
          <Glyph name="close" size={20} />
        </button>
      </header>
      <div className="materials-body">
        <label className="check-row small">
          <input type="checkbox" checked={builtToo} onChange={(e) => setBuiltToo(e.target.checked)} />
          <span>{t('materialsBuilt')}</span>
        </label>
        <Lines title={t('parts')} lines={bill.parts} label={(id) => data.items[id]} open={open} />
        <Lines title={t('buildings')} lines={bill.buildings} label={buildingById} open={open} />
        <p className="hint">{t('materialsHint')}</p>
      </div>
    </aside>
  );
}

function Lines({
  title,
  lines,
  label,
  open,
}: {
  title: string;
  lines: BillLine[];
  label: (id: string) => { name: string } | undefined;
  open: (id: string) => void;
}) {
  const { t, name, num } = useT();
  return (
    <section className="mat-section">
      <h3 className="ov-title">{title}</h3>
      {lines.length === 0 ? (
        <p className="hint">{t('materialsNone')}</p>
      ) : (
        <ul className="mat-list">
          {lines.map((l) => (
            <li key={l.id} className="mat-row">
              <span className="ov-item">
                <Icon id={l.id} size={30} />
                {name(label(l.id))}
                <b className="mat-total">{num(l.total)}</b>
              </span>
              <span className="ov-who-list">
                {l.by.map((b) => (
                  <button key={b.id} type="button" className="ov-who" onClick={() => open(b.id)}>
                    {b.name}
                    <small>{num(b.amount)}</small>
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

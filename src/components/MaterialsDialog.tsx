import { useState } from 'react';
import { buildingById, data } from '../lib/data';
import { useT } from '../lib/i18n';
import { type BillLine, useMaterials } from '../lib/materials';
import { useStore } from '../store';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

/** What it takes to build every factory: the parts and the buildings, and which factory needs how much of each. */
export function MaterialsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const set = useStore((s) => s.set);
  const [builtToo, setBuiltToo] = useState(false);
  const bill = useMaterials(builtToo);
  const open = (id: string) => {
    set({ mode: 'factory', active: id, inspect: undefined });
    onClose();
  };
  return (
    <Dialog title={t('materials')} icon="factory" className="save-dialog wide" onClose={onClose}>
      <div className="save-body materials">
        <label className="check-row small">
          <input type="checkbox" checked={builtToo} onChange={(e) => setBuiltToo(e.target.checked)} />
          <span>{t('materialsBuilt')}</span>
        </label>
        <Lines title={t('parts')} lines={bill.parts} label={(id) => data.items[id]} open={open} />
        <Lines title={t('buildings')} lines={bill.buildings} label={buildingById} open={open} />
        <p className="hint">{t('materialsHint')}</p>
      </div>
    </Dialog>
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
    <section className="ov-section">
      <h2 className="ov-title">{title}</h2>
      {lines.length === 0 ? (
        <p className="hint">{t('materialsNone')}</p>
      ) : (
        <table className="ov-table">
          <thead>
            <tr>
              <th>{title}</th>
              <th className="num">{t('materialsTotal')}</th>
              <th>{t('materialsNeededBy')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="ov-name">
                  <span className="ov-item">
                    <Icon id={l.id} size={30} />
                    {name(label(l.id))}
                  </span>
                </td>
                <td className="num" data-label={t('materialsTotal')}>
                  {num(l.total)}
                </td>
                <td data-label={t('materialsNeededBy')}>
                  <span className="ov-who-list">
                    {l.by.map((b) => (
                      <button key={b.id} type="button" className="ov-who" onClick={() => open(b.id)}>
                        {b.name}
                        <small>{num(b.amount)}</small>
                      </button>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

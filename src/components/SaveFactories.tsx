import { useState } from 'react';
import { data, generatorById } from '../lib/data';
import { useT } from '../lib/i18n';
import { PLANT_NAMES, type Plant, unitPower } from '../lib/power';
import { buildingOf, type SaveGrid } from '../lib/save/map';
import { savedWhen } from '../lib/save/pick';
import { useStore } from '../store';
import { Glyph } from './Glyph';
import { Icon } from './Icon';

/** All › From your save: the power circuits of the followed save. */
export function SaveFactoryList() {
  const { t } = useT();
  const save = useStore((s) => s.save);
  const grids = save?.grids ?? [];
  const [open, setOpen] = useState(true);
  if (!save || !grids.length) return null;
  return (
    <section className="ov-section save-list" data-open={open}>
      <h2 className="ov-title">
        <button type="button" className="save-list-head" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Glyph name={open ? 'chevronDown' : 'chevronRight'} size={18} />
          {t('mapFromSave')}
          <small>{t('saveLine', { game: save.game, when: savedWhen(save.savedAt, t('today')) })}</small>
        </button>
      </h2>
      {open && grids.length > 0 && <SaveGrids grids={grids} />}
    </section>
  );
}

const BATTERY = data.powerStorage.id;

/** The generator making the most of a circuit's power: what its card and plant tab are named after. */
const mainGenerator = (g: SaveGrid) =>
  g.plants.reduce((a, b) => (unitPower(asPlant(b)) * b.n > unitPower(asPlant(a)) * a.n ? b : a)).generator;
const asPlant = ({ n, ...r }: SaveGrid['plants'][number]): Plant => ({ ...r, id: '', by: 'count', amount: n });

/** All › From your save › Power circuits: a card for each circuit with generators, what it makes and draws, and a plant tab to make of it. */
function SaveGrids({ grids }: { grids: SaveGrid[] }) {
  const { t, name, num } = useT();
  const plantFromSave = useStore((s) => s.plantFromSave);
  return (
    <>
      <h3 className="ov-title save-grids-title">{t('saveQPower')}</h3>
      <div className="save-cards">
        {grids.map((g) => {
          const main = mainGenerator(g);
          const title = PLANT_NAMES[main] ?? name(generatorById.get(main));
          const rows = new Map<string, number>();
          for (const p of g.plants) rows.set(p.generator, (rows.get(p.generator) ?? 0) + p.n);
          if (g.batteries) rows.set(BATTERY, g.batteries);
          return (
            <article key={g.id} className="save-card">
              <header>
                <Icon id={main} size={40} />
                <span>
                  <b>{title}</b>
                  <small>{t('saveGridLine', { made: num(g.made), used: num(g.used) })}</small>
                </span>
              </header>
              <ul className="save-counts">
                {[...rows].map(([cls, n]) => (
                  <li key={cls} title={cls === BATTERY ? name(data.powerStorage) : name(buildingOf(cls))}>
                    <Icon id={cls} size={28} />
                    <b>{n}</b>
                  </li>
                ))}
              </ul>
              <footer>
                <span />
                <button type="button" className="ghost-button" onClick={() => plantFromSave(title, g.plants)}>
                  {t('saveMakePlant')}
                </button>
              </footer>
            </article>
          );
        })}
      </div>
    </>
  );
}

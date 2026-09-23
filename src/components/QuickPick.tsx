import { data } from '../lib/data';
import { useT } from '../lib/i18n';
import { useStore } from '../store';
import { Slot } from './Slot';

const projectParts = Array.from({ length: 12 }, (_, i) => `Desc_SpaceElevatorPart_${i + 1}_C`).filter((id) => data.items[id]);

const common = [
  'Desc_IronPlate_C',
  'Desc_IronPlateReinforced_C',
  'Desc_ModularFrame_C',
  'Desc_Rotor_C',
  'Desc_Stator_C',
  'Desc_Motor_C',
  'Desc_Cable_C',
  'Desc_Wire_C',
  'Desc_SteelPlate_C',
  'Desc_SteelPipe_C',
  'Desc_Plastic_C',
  'Desc_Rubber_C',
  'Desc_CircuitBoard_C',
  'Desc_Computer_C',
  'Desc_ModularFrameHeavy_C',
  'Desc_HighSpeedConnector_C',
  'Desc_AluminumPlate_C',
  'Desc_MotorLightweight_C',
].filter((id) => data.items[id]);

/** First-run screen: the things people actually plan for, as inventory slots. */
export function QuickPick() {
  const { t, name } = useT();
  const set = useStore((s) => s.set);
  const updatePlan = useStore((s) => s.updatePlan);

  const add = (item: string, rate: number) => {
    updatePlan((p) => (p.targets.some((x) => x.item === item) ? {} : { targets: [...p.targets, { item, rate }] }));
    set({ tab: 'targets' });
  };

  const grid = (ids: string[], rate: number) => (
    <div className="quick-grid">
      {ids.map((id) => (
        <button key={id} type="button" className="quick-item" onClick={() => add(id, rate)}>
          <Slot id={id} size={72} />
          <span>{name(data.items[id])}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="quick-pick">
      <h2 className="quick-title">{t('whatToMake')}</h2>
      <p className="hint">{t('quickPickHint')}</p>
      <h3 className="section-title">{t('projectParts')}</h3>
      {grid(projectParts, 5)}
      <h3 className="section-title">{t('commonParts')}</h3>
      {grid(common, 30)}
    </div>
  );
}

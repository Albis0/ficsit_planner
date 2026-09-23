import { data } from '../lib/data';
import { useT } from '../lib/i18n';
import { Icon } from './Icon';

interface Props {
  id: string;
  rate?: number;
  size?: number;
  tone?: 'default' | 'muted' | 'alert' | 'target';
  onClick?: () => void;
}

/** An inventory slot like the game's: square, icon in the middle, amount in the bottom-right corner. */
export function Slot({ id, rate, size = 56, tone = 'default', onClick }: Props) {
  const { name, num } = useT();
  const label = name(data.items[id] ?? data.machines[id] ?? data.extractors.find((e) => e.id === id));
  const body = (
    <>
      <Icon id={id} size={Math.round(size * 0.74)} />
      {rate !== undefined && <span className="slot-count">{num(rate)}</span>}
    </>
  );
  const style = { width: size, height: size, ['--slot-size' as string]: `${size}px` };
  return onClick ? (
    <button type="button" className={`slot ${tone}`} style={style} title={label} aria-label={label} onClick={onClick}>
      {body}
    </button>
  ) : (
    <span className={`slot ${tone}`} style={style} title={label}>
      {body}
    </span>
  );
}

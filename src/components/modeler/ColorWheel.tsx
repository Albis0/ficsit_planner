import { useRef, useState } from 'react';
import { hexToHsv, type Hsv, hsvToHex } from '../../lib/model/color';

const SIZE = 148;

/**
 * Any colour: round for the hue (round the wheel) and how strong it is (out from the middle), a slider for how light.
 * While the pointer is down only the wheel and `onLive` hear of it (the floor takes the colour straight away); the model
 * is told once, on letting go, so a drag makes one undo step and no recalculation per move.
 */
export function ColorWheel({
  value,
  label,
  onChange,
  onLive,
}: {
  value: string;
  label: string;
  onChange: (hex: string) => void;
  onLive?: (hex: string) => void;
}) {
  const [live, setLive] = useState<string>();
  const latest = useRef<string>(undefined);
  const hex = live ?? value;
  const c = hexToHsv(hex);
  const show = (next: string) => {
    latest.current = next;
    setLive(next);
    onLive?.(next);
  };
  const commit = () => {
    if (latest.current && latest.current !== value) onChange(latest.current);
    latest.current = undefined;
    setLive(undefined);
  };
  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    // The wheel starts at the top and runs clockwise.
    const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    show(hsvToHex({ h, s: Math.min(1, Math.hypot(dx, dy) / (r.width / 2)), v: c.v || 1 }));
  };
  const at = (c.s * SIZE) / 2;
  const a = (c.h * Math.PI) / 180;
  return (
    <div className="color-picker">
      <div
        className="color-wheel"
        role="slider"
        aria-label={label}
        aria-valuetext={hex}
        aria-valuenow={Math.round(c.h)}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => e.buttons && pick(e)}
        onPointerUp={commit}
        onPointerCancel={commit}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 6 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -6 : 0;
          if (!step) return;
          e.preventDefault();
          show(hsvToHex({ ...c, h: (c.h + step + 360) % 360, s: c.s || 1 } satisfies Hsv));
        }}
        onKeyUp={commit}
      >
        <span className="color-dot" style={{ left: SIZE / 2 + at * Math.sin(a), top: SIZE / 2 - at * Math.cos(a), background: hex }} />
      </div>
      <input
        type="range"
        className="color-light"
        aria-label={label}
        min={10}
        max={100}
        value={Math.round(c.v * 100)}
        style={{ background: `linear-gradient(90deg, #000, ${hsvToHex({ ...c, v: 1 })})` }}
        onChange={(e) => show(hsvToHex({ ...c, v: Number(e.target.value) / 100 }))}
        onPointerUp={commit}
        onKeyUp={commit}
      />
    </div>
  );
}

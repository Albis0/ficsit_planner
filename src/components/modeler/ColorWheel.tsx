import { hexToHsv, type Hsv, hsvToHex } from '../../lib/model/color';

const SIZE = 148;

/** Any colour: round for the hue (round the wheel) and how strong it is (out from the middle), a slider for how light. */
export function ColorWheel({ value, label, onChange }: { value: string; label: string; onChange: (hex: string) => void }) {
  const c = hexToHsv(value);
  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    // The wheel starts at the top and runs clockwise.
    const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    onChange(hsvToHex({ h, s: Math.min(1, Math.hypot(dx, dy) / (r.width / 2)), v: c.v || 1 }));
  };
  const at = (c.s * SIZE) / 2;
  const a = (c.h * Math.PI) / 180;
  return (
    <div className="color-picker">
      <div
        className="color-wheel"
        role="slider"
        aria-label={label}
        aria-valuetext={value}
        aria-valuenow={Math.round(c.h)}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => e.buttons && pick(e)}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 6 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -6 : 0;
          if (!step) return;
          e.preventDefault();
          onChange(hsvToHex({ ...c, h: (c.h + step + 360) % 360, s: c.s || 1 } satisfies Hsv));
        }}
      >
        <span className="color-dot" style={{ left: SIZE / 2 + at * Math.sin(a), top: SIZE / 2 - at * Math.cos(a), background: value }} />
      </div>
      <input
        type="range"
        className="color-light"
        aria-label={label}
        min={10}
        max={100}
        value={Math.round(c.v * 100)}
        style={{ background: `linear-gradient(90deg, #000, ${hsvToHex({ ...c, v: 1 })})` }}
        onChange={(e) => onChange(hsvToHex({ ...c, v: Number(e.target.value) / 100 }))}
      />
    </div>
  );
}

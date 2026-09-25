/** Small line icons for the chrome (game icons are for items and buildings). Drawn in currentColor. */
const PATHS = {
  // Sawtooth factory roof with a chimney.
  factory: 'M3 20V10l5 3V10l5 3V10l5 3V4h3v16z M7 16h2 M11 16h2 M15 16h2',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  gear: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.5 7.5 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 2.6-1.5l2.4 1 2-3.4z',
  flag: 'M5 21V4 M5 4h11l-2 4 2 4H5',
  bug: 'M8 8a4 4 0 0 1 8 0 M7 10h10v4a5 5 0 0 1-10 0z M12 10v9 M3 12h4 M17 12h4 M4 7l3 2 M20 7l-3 2 M4 18l3-2 M20 18l-3-2',
  bulb: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z',
  check: 'M4 12.5 9.5 18 20 6.5',
  close: 'M6 6l12 12 M18 6 6 18',
  layout: 'M3 4h18v16H3z M3 9h18 M9 9v11',
  floor: 'M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18',
  palette:
    'M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.6 0-.9-.7-1.3-.7-2.1 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z M7.5 11.5h.01 M10 7.5h.01 M14.5 7.5h.01',
  sliders: 'M4 6h10 M18 6h2 M4 12h4 M12 12h8 M4 18h12 M20 18h0 M14 4v4 M8 10v4 M16 16v4',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  battery: 'M3 7h16v10H3z M21 10v4 M6 10v4 M9 10v4',
  plus: 'M12 5v14 M5 12h14',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
  send: 'M3 11 21 3l-8 18-2-8z M11 13l10-10',
  download: 'M12 4v11 M7 10l5 5 5-5 M4 20h16',
  upload: 'M12 20V9 M7 14l5-5 5 5 M4 4h16',
  reset: 'M4 4v6h6 M5.5 15a7.5 7.5 0 1 0 1.8-7.8L4 10',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  github:
    'M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7 3.6 3.6 0 0 1 .1-2.7s.8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7a3.9 3.9 0 0 1 1 2.7c0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2z',
} as const;

export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, size = 20, className }: { name: GlyphName; size?: number; className?: string }) {
  const filled = name === 'bolt' || name === 'github';
  return (
    <svg
      className={`glyph ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

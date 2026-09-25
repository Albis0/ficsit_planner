/** Where the panel (targets, recipes, resources) sits around the factory floor. */
export type PanelSide = 'top' | 'left' | 'right';

export interface Colors {
  /** FICSIT orange: buttons, selections, the current tab. */
  accent: string;
  /** Machine strips by recipe kind. */
  standard: string;
  alternate: string;
  converter: string;
  /** Generators and everything power. */
  power: string;
}

export interface Settings {
  panel: PanelSide;
  /** Machine and endpoint cards on the floor, 1 = as designed. Everything on the card grows with it. */
  cardScale: number;
  /** Text on the cards and belt labels, on top of the card size. */
  textScale: number;
  /** Top bar, panel, summary and inspector. */
  uiScale: number;
  /** Room between machines, 1 = default. */
  spacing: number;
  beltLabels: 'auto' | 'always' | 'never';
  beltMotion: boolean;
  /** Foundation grid lines on the floor. */
  gridLines: boolean;
  /** Belts coloured by tier, or all in one colour. */
  beltColors: 'tier' | 'one';
  colors: Colors;
  /** Most decimals shown on rates and power. */
  decimals: number;
  motion: 'system' | 'reduce' | 'full';
}

export const DEFAULT_COLORS: Colors = {
  accent: '#fa9549',
  standard: '#fa9549',
  alternate: '#6fcab8',
  converter: '#bda2f5',
  power: '#f7d154',
};

export const DEFAULT_SETTINGS: Settings = {
  panel: 'top',
  cardScale: 1,
  textScale: 1,
  uiScale: 1,
  spacing: 1,
  beltLabels: 'auto',
  beltMotion: true,
  gridLines: true,
  beltColors: 'tier',
  colors: DEFAULT_COLORS,
  decimals: 2,
  motion: 'system',
};

export const LIMITS = {
  cardScale: [0.7, 1.6],
  textScale: [0.8, 1.5],
  uiScale: [0.85, 1.35],
  spacing: [0.5, 2.5],
  decimals: [0, 3],
} as const satisfies Partial<Record<keyof Settings, readonly [number, number]>>;

export const clampSetting = (key: keyof typeof LIMITS, v: number) => Math.min(LIMITS[key][1], Math.max(LIMITS[key][0], v));

const DARK_INK = '#1d1206';
const LIGHT_INK = '#fbf7f0';
/** The panels' charcoal (--panel-2), what outlines and accent text sit on. */
const PANEL = '#22262a';

/** Relative luminance (WCAG) of a #rrggbb colour, or undefined when it isn't one. */
function luminance(hex: string): number | undefined {
  const m = hex.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return undefined;
  const [r, g, b] = m.slice(1).map((x) => Number.parseInt(x, 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Dark or light text, whichever has more contrast on this background. */
export function inkOn(hex: string): string {
  const lum = luminance(hex);
  if (lum === undefined) return DARK_INK;
  return contrast(lum, luminance(DARK_INK)!) >= contrast(lum, luminance(LIGHT_INK)!) ? DARK_INK : LIGHT_INK;
}

/** The accent where it stands out on the dark panels (3:1, enough for a focus ring); a lighter tint of it where it doesn't. */
export function accentOnDark(hex: string): string {
  const lum = luminance(hex);
  if (lum === undefined || contrast(lum, luminance(PANEL)!) >= 3) return hex;
  return `color-mix(in srgb, ${hex} 40%, ${LIGHT_INK})`;
}

/** Whether two sets of settings are the same, colour by colour. */
export function sameSettings(a: Settings, b: Settings): boolean {
  return (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).every((k) =>
    k === 'colors' ? (Object.keys(DEFAULT_COLORS) as (keyof Colors)[]).every((c) => a.colors[c] === b.colors[c]) : a[k] === b[k],
  );
}

/** CSS variables the settings set on the app, so every stylesheet rule follows them. */
export function settingsStyle(s: Settings): Record<string, string> {
  const c = s.colors;
  return {
    '--ficsit': c.accent,
    '--ficsit-deep': `color-mix(in srgb, ${c.accent} 82%, #000)`,
    '--ficsit-ink': inkOn(c.accent),
    '--focus': accentOnDark(c.accent),
    '--kind-standard': c.standard,
    '--standard-ink': inkOn(c.standard),
    '--alt': c.alternate,
    '--alt-ink': inkOn(c.alternate),
    '--converter': c.converter,
    '--converter-ink': inkOn(c.converter),
    '--power': c.power,
    '--power-ink': inkOn(c.power),
    '--card-scale': String(s.cardScale),
    '--card-text': String(s.textScale),
    '--ui-scale': String(s.uiScale),
  };
}

/** Accent presets, each a colour already in the game's palette. */
export const ACCENTS: { name: string; value: string }[] = [
  { name: 'FICSIT orange', value: '#fa9549' },
  { name: 'Hazard yellow', value: '#f2c230' },
  { name: 'Coolant blue', value: '#4aa3df' },
  { name: 'Biomass green', value: '#7fc25a' },
  { name: 'Ficsonium violet', value: '#b98cf2' },
  { name: 'Somersloop pink', value: '#f27ad2' },
];

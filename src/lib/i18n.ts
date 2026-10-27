import { useMemo } from 'react';
import { useStore } from '../store';
import { LANGS, type StringKey } from './lang';

export type { Lang, StringKey } from './lang';

export function useT() {
  const lang = useStore((s) => s.lang);
  const decimals = useStore((s) => s.settings.decimals);
  // Stable per language and number format, so components can list t, name and num as memo dependencies.
  return useMemo(() => {
    const { messages, locale } = LANGS[lang] ?? LANGS.en;
    /** Looks up a string; `{name}` placeholders are filled from vars. */
    const t = (k: StringKey, vars?: Record<string, string | number>) =>
      vars ? messages[k].replace(/\{(\w+)\}/g, (m, v: string) => String(vars[v] ?? m)) : messages[k];
    const name = (x: { name: string } | undefined) => x?.name ?? '?';
    const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: decimals });
    const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    // From a thousand up the digits after the point say nothing: 38,206 MW, not 38,206.43.
    // Too small to show at this many decimals is zero, never "-0".
    const tiny = 0.5 * 10 ** -decimals;
    const num = (n: number) => (Math.abs(n) >= 1000 ? whole.format(n) : nf.format(Math.abs(n) < tiny ? 0 : n));
    return { t, name, num, lang };
  }, [lang, decimals]);
}

import { useMemo } from 'react';
import { useStore } from '../store';
import { LANGS, type StringKey } from './lang';

export type { Lang, StringKey } from './lang';

export function useT() {
  const lang = useStore((s) => s.lang);
  // Stable per language, so components can list t, name and num as memo dependencies.
  return useMemo(() => {
    const { messages, locale } = LANGS[lang] ?? LANGS.en;
    /** Looks up a string; `{name}` placeholders are filled from vars. */
    const t = (k: StringKey, vars?: Record<string, string | number>) =>
      vars ? messages[k].replace(/\{(\w+)\}/g, (m, v: string) => String(vars[v] ?? m)) : messages[k];
    const name = (x: { name: string } | undefined) => x?.name ?? '?';
    const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    const num = (n: number) => nf.format(Math.abs(n) < 5e-5 ? 0 : n);
    return { t, name, num, lang };
  }, [lang]);
}

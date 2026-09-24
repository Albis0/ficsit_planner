import { en } from '../locales/en';

export type Messages = typeof en;
export type StringKey = keyof Messages;

export type Lang = 'en';

/** UI languages: messages plus the locale used for number formatting. */
export const LANGS: Record<Lang, { messages: Messages; locale: string }> = {
  en: { messages: en, locale: 'en-US' },
};

export const isLang = (x: unknown): x is Lang => typeof x === 'string' && x in LANGS;

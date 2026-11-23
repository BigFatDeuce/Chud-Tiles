import { app } from 'electron';

// The few texts of the main process the player sees (dialog titles, error messages). The interface
// tells its language at start (`app:lang`); until then the system's language decides.

type Lang = 'fr' | 'en';
let chosen: Lang | null = null;

export function setLang(l: unknown): void {
  if (l === 'fr' || l === 'en') chosen = l;
}

export const lang = (): Lang => chosen ?? (/^fr\b/i.test(app.getLocale()) ? 'fr' : 'en');

/** The text in the interface's language: French, English. */
export const say = (fr: string, en: string): string => (lang() === 'fr' ? fr : en);

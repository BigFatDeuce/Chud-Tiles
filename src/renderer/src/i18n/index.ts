import { EN } from './en';

// Languages of the interface. The French text is the source and the key: `tr('Jouer')` gives
// "Jouer" in French and the English dictionary's "Play" in English. Variables: `tr('{n} notes',
// { n })`; plurals: `trn(n, '{n} morceau', '{n} morceaux')` (French forms, each one translated).
// The language is read once at start (from the saved settings, or the system's language); changing
// it reloads the interface, so constants built at load time are translated too.

export type Lang = 'fr' | 'en';
export type LangSetting = 'auto' | Lang;

export const LANGS: { v: LangSetting; label: string }[] = [
  { v: 'auto', label: 'Auto' },
  { v: 'fr', label: 'Français' },
  { v: 'en', label: 'English' },
];

const SETTINGS_KEY = 'chud-tiles-settings';

export function systemLang(): Lang {
  const l = (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || 'fr';
  return /^fr\b/i.test(l) ? 'fr' : 'en';
}

function savedSetting(): LangSetting {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const l = raw ? (JSON.parse(raw) as { state?: { lang?: LangSetting } }).state?.lang : undefined;
    return l === 'fr' || l === 'en' ? l : 'auto';
  } catch {
    return 'auto';
  }
}

export const resolve = (s: LangSetting): Lang => (s === 'auto' ? systemLang() : s);

/** The language of this session of the interface. */
export const lang: Lang = resolve(savedSetting());
/** For numbers, dates and sorting. */
export const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';

if (typeof document !== 'undefined') document.documentElement.lang = lang;

const missing = new Set<string>();

function fill(s: string, vars?: Record<string, string | number>): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

export function tr(s: string, vars?: Record<string, string | number>): string {
  if (lang === 'fr') return fill(s, vars);
  const en = EN[s];
  if (en === undefined && !missing.has(s)) {
    missing.add(s);
    if (import.meta.env?.DEV) console.warn('[i18n] missing:', s);
  }
  return fill(en ?? s, vars);
}

/** Plural: French forms in (0 and 1 are singular in French, only 1 in English). */
export function trn(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  const singular = lang === 'fr' ? Math.abs(n) < 2 : n === 1;
  return tr(singular ? one : other, { n, ...vars });
}

/** A message that may come from elsewhere (an error of the system side): translated when known. */
export const trMaybe = (s: string): string => (lang === 'fr' ? s : (EN[s] ?? s));

/** Strings asked for but not translated (tests). */
export const missingKeys = (): string[] => [...missing];

/** Number in the interface's language. */
export const fmtNum = (n: number, digits?: number): string => n.toLocaleString(locale, digits === undefined ? undefined : { minimumFractionDigits: digits, maximumFractionDigits: digits });

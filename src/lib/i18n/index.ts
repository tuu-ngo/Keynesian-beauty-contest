import { en } from "./en";
import { vi } from "./vi";

export const dictionaries = { vi, en } as const;
export type Locale = keyof typeof dictionaries;
export type Dictionary = typeof vi;
export const DEFAULT_LOCALE: Locale = "vi";

export function t(locale: Locale, key: keyof Dictionary, vars: Record<string, string | number> = {}) {
  return dictionaries[locale][key].replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
}

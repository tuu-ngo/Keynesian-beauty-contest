import { en } from "./en";

export const dictionaries = { en } as const;
export type Locale = keyof typeof dictionaries;
export type Dictionary = typeof en;
export const DEFAULT_LOCALE: Locale = "en";

export function t(
  locale: Locale,
  key: keyof Dictionary,
  vars: Record<string, string | number> = {},
) {
  return dictionaries[locale][key].replace(/\{(\w+)\}/g, (_, name) =>
    String(vars[name] ?? `{${name}}`),
  );
}

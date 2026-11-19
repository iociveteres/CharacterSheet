// Interface strings from the catalog in i18n/catalog. The page loads the
// dictionary of the user's language (ui/static/dist/i18n.<lang>.js, built by
// scripts/build.mjs) before its bundle, and changing the language reloads the
// page, so t() is a plain function that can run at module level.
import type { I18nKey, I18nParams } from "./keys.gen";

export type { I18nKey } from "./keys.gen";

export type Lang = "en" | "ru";

/** A string, or plural forms by Intl.PluralRules category, picked by the param `count`. */
export type Message = string | Partial<Record<Intl.LDMLPluralRule, string>>;

export interface Dictionary {
    lang: Lang;
    messages: Record<string, Message>;
}

declare global {
    // Set by the dictionary script; tests install one in ui/static/js/i18n/vitest.setup.ts.
    var __I18N__: Dictionary | undefined;
}

type ParamsArg<K extends I18nKey> = keyof I18nParams[K] extends never ? [] : [params: I18nParams[K]];

export function lang(): Lang {
    return globalThis.__I18N__?.lang ?? "en";
}

/**
 * Intl.ListFormat in the page's language. English lists as en-GB does,
 * "A, B or C" without the Oxford comma, as the sheet wrote its lists before.
 */
export function listFormat(type: "conjunction" | "disjunction"): Intl.ListFormat {
    return new Intl.ListFormat(lang() === "en" ? "en-GB" : lang(), { type });
}

const pluralRules = new Map<string, Intl.PluralRules>();

function pluralForm(forms: Exclude<Message, string>, count: number): string {
    let rules = pluralRules.get(lang());
    if (!rules) pluralRules.set(lang(), rules = new Intl.PluralRules(lang()));
    // The catalog holds one/few/many for ru, and fractions select "other": in
    // Russian they take the form of "few" (2,5 часа).
    return forms[rules.select(count)] ?? forms.other ?? forms.few ?? forms.many ?? Object.values(forms)[0] ?? "";
}

/**
 * The message of `key` in the page's language with `{name}` replaced by its
 * param. A key the dictionary lacks comes back as is: check:i18n is what
 * catches it, the page keeps working.
 */
export function t<K extends I18nKey>(key: K, ...[params]: ParamsArg<K>): string {
    const message = globalThis.__I18N__?.messages[key];
    if (message === undefined) return key;
    const values = (params ?? {}) as Record<string, string | number>;
    const text = typeof message === "string" ? message : pluralForm(message, Number(values.count ?? 0));
    return text.replace(/\{(\w+)\}/g, (match, name: string) => (values[name] === undefined ? match : String(values[name])));
}

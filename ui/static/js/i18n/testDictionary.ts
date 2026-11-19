// Installs a dictionary built from i18n/catalog, as the page's dictionary
// script would. Tests only: it reads the catalog with node:fs.
import { clientDictionary, loadCatalog } from "../../../../scripts/i18n/catalog.mjs";
import type { Dictionary, Lang } from "./index";

let entries: ReturnType<typeof loadCatalog>["entries"] | undefined;
const dictionaries = new Map<Lang, Dictionary["messages"]>();

export function installDictionary(lang: Lang): void {
    entries ??= loadCatalog().entries;
    const messages = dictionaries.get(lang) ?? clientDictionary(entries, lang);
    dictionaries.set(lang, messages);
    globalThis.__I18N__ = { lang, messages };
}

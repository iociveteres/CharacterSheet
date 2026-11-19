// The rules of check:i18n ("Инструменты" in _prd/i18n/plan.md). Each check
// returns problems as "file:line: message" and takes its folders as
// arguments, so the tests run them on scripts/i18n/testdata.
import { CATALOG_DIR, LANGS, PLURAL_FORMS, loadCatalog } from "./catalog.mjs";
import { LARGE_TEXT_DIRS, largeTexts } from "./sources.mjs";
import { DEFAULT_ROOTS, covers, findUsage } from "./usage.mjs";

// What loadCatalog adds to an entry besides the fields of the file.
const LOADER_FIELDS = ["key", "file", "prefix", "line"];
const FIELDS = new Set([...LOADER_FIELDS, ...LANGS, "note"]);

const isForms = message => message !== null && typeof message === "object" && !Array.isArray(message);
const textsOf = message => (isForms(message) ? Object.values(message) : [message]);
const placeholdersOf = message => [...new Set(textsOf(message).flatMap(text => [...String(text).matchAll(/\{(\w+)\}/g)].map(m => m[1])))].sort();

/** Problems with the entries themselves: their file, languages, fields, placeholders and plural forms. */
export function checkEntries({ entries, problems: loaderProblems }) {
    const problems = [...loaderProblems];
    const prefixes = [...new Set(entries.map(e => e.prefix))];
    for (const e of entries) {
        const at = `${e.file}:${e.line}: ${e.key}`;
        // The longest file prefix the key starts with names its file, so a key has one place to be.
        const home = prefixes.filter(p => e.key.startsWith(p + ".")).sort((a, b) => b.length - a.length)[0];
        if (home !== e.prefix) {
            problems.push(home ? `${at}: belongs in ${home.split(".").join("/")}.json` : `${at}: a key of this file starts with "${e.prefix}."`);
        }
        for (const field of Object.keys(e)) {
            if (!FIELDS.has(field)) problems.push(`${at}: unknown field "${field}", an entry holds ${LANGS.join(", ")} and note`);
        }
        if (e.note !== undefined && typeof e.note !== "string") problems.push(`${at}: note is a string`);
        let plain = 0;
        for (const lang of LANGS) {
            const message = e[lang];
            if (message === undefined || message === "") {
                problems.push(`${at}: no ${lang}`);
                continue;
            }
            if (!isForms(message)) {
                plain++;
                if (typeof message !== "string") problems.push(`${at}: ${lang} is a string or an object of plural forms`);
                continue;
            }
            const forms = Object.keys(message);
            const missing = PLURAL_FORMS[lang].filter(f => !forms.includes(f));
            const extra = forms.filter(f => !PLURAL_FORMS[lang].includes(f));
            if (missing.length) problems.push(`${at}: ${lang} lacks the plural forms ${missing.join(", ")}`);
            if (extra.length) problems.push(`${at}: ${lang} has plural forms ${extra.join(", ")}, it takes ${PLURAL_FORMS[lang].join(", ")}`);
            for (const [form, text] of Object.entries(message)) {
                if (typeof text !== "string" || text === "") problems.push(`${at}: ${lang}.${form} is empty or not a string`);
            }
        }
        if (plain !== 0 && plain !== LANGS.filter(lang => e[lang] !== undefined && e[lang] !== "").length) {
            problems.push(`${at}: plural forms in one language and a plain string in another`);
        }
        const [first, ...others] = LANGS.filter(lang => e[lang]);
        for (const lang of others) {
            const a = placeholdersOf(e[first]).join(", "), b = placeholdersOf(e[lang]).join(", ");
            if (a !== b) problems.push(`${at}: placeholders differ: ${first} {${a}}, ${lang} {${b}}`);
        }
    }
    return problems;
}

/** Keys the code uses that the catalog lacks, catalog keys nothing uses, markers that cover nothing. */
export function checkUsage({ entries, byKey }, { uses, markers }) {
    const problems = [];
    for (const use of uses) {
        if (!byKey.has(use.key)) problems.push(`${use.file}:${use.line}: "${use.key}" is not in the catalog`);
    }
    for (const m of markers) {
        if (!entries.some(e => covers(m.pattern, e.key))) problems.push(`${m.file}:${m.line}: i18n-keys ${m.pattern} covers no catalog key`);
    }
    const used = new Set(uses.map(u => u.key));
    for (const e of entries) {
        if (!used.has(e.key) && !markers.some(m => covers(m.pattern, e.key))) {
            problems.push(`${e.file}:${e.line}: ${e.key}: not used in the code (a key built at run time needs an i18n-keys marker, see scripts/i18n/usage.mjs)`);
        }
    }
    return problems;
}

/** Large texts that lack a language, or have one that isn't in LANGS. */
export function checkLargeTexts(dirs = LARGE_TEXT_DIRS) {
    const problems = [];
    for (const text of largeTexts(dirs)) {
        const [any] = Object.values(text.files);
        for (const lang of LANGS) {
            if (!text.files[lang]) problems.push(`${any}:1: ${text.name} has no ${lang} file (${text.name.split("/").pop()}.${lang}.html)`);
        }
        for (const [lang, file] of Object.entries(text.files)) {
            if (!LANGS.includes(lang)) problems.push(`${file}:1: unknown language "${lang}", the languages are ${LANGS.join(", ")}`);
        }
    }
    return problems;
}

/**
 * All the checks of `npm run check:i18n`.
 * @param {{ catalogDir?: string, roots?: typeof DEFAULT_ROOTS, largeTextDirs?: Record<string, string> }} [options]
 */
export function checkAll({ catalogDir = CATALOG_DIR, roots = DEFAULT_ROOTS, largeTextDirs = LARGE_TEXT_DIRS } = {}) {
    const catalog = loadCatalog(catalogDir);
    return {
        catalog,
        problems: [...checkEntries(catalog), ...checkUsage(catalog, findUsage(roots)), ...checkLargeTexts(largeTextDirs)],
    };
}

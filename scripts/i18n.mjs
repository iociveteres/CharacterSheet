// npm run i18n -- find <text or key>   entries whose key, en, ru or note holds the text, any case
// npm run i18n -- missing              keys without ru
// They print `file:line  key  en  ru` (missing: without ru), the line pointing at the entry.
import { isTranslated, loadCatalog } from "./i18n/catalog.mjs";

const USAGE = `usage: npm run i18n -- find <text or key>
       npm run i18n -- missing`;

const show = message => (message !== null && typeof message === "object"
    ? Object.entries(message).map(([form, text]) => `${form}: ${text}`).join("; ")
    : message ?? "—");
const textsOf = message => (message !== null && typeof message === "object" ? Object.values(message) : [message ?? ""]);

const [command, ...args] = process.argv.slice(2);
const { entries, problems } = loadCatalog();
if (command === "find" && args.length) {
    const needle = args.join(" ").toLowerCase();
    const found = entries.filter(e => [e.key, ...textsOf(e.en), ...textsOf(e.ru), e.note ?? ""].some(text => String(text).toLowerCase().includes(needle)));
    for (const e of found) console.log(`${e.file}:${e.line}  ${e.key}  ${show(e.en)}  ${show(e.ru)}`);
    if (!found.length) console.log(`No entry holds "${args.join(" ")}".`);
} else if (command === "missing" && !args.length) {
    const found = entries.filter(e => !isTranslated(e, "ru"));
    for (const e of found) console.log(`${e.file}:${e.line}  ${e.key}  ${show(e.en)}`);
    console.log(`${found.length} of ${entries.length} keys lack ru.`);
} else {
    console.error(USAGE);
    process.exit(2);
}
// A broken file drops its entries from the search: say so, and fail.
for (const p of problems) console.error(p);
if (problems.length) process.exit(1);

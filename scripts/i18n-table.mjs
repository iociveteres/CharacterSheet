// npm run i18n:table: writes i18n/table.html (not committed), the catalog and
// the large texts on one page with search and a "not translated" filter.
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadCatalog } from "./i18n/catalog.mjs";
import { largeTexts } from "./i18n/sources.mjs";
import { renderTable } from "./i18n/table.mjs";

const OUT = path.join(ROOT, "i18n", "table.html");

const { entries, problems } = loadCatalog();
fs.writeFileSync(OUT, renderTable({ entries, texts: largeTexts() }));
console.log(`Wrote ${OUT}: ${entries.length} keys.`);
// A broken file is missing from the table: say so, and fail.
for (const p of problems) console.error(p);
if (problems.length) process.exit(1);

// Fails when more than one copy of @preact/signals-core is installed: two copies
// mean two reactive graphs, and signals from one never notify the other.
import { execSync } from "node:child_process";

const out = execSync("npm ls @preact/signals-core --all --parseable", { encoding: "utf8" });
const copies = out.split(/\r?\n/).filter(Boolean);

if (copies.length !== 1) {
    console.error(`Expected one copy of @preact/signals-core, found ${copies.length}:`);
    for (const path of copies) console.error(`  ${path}`);
    process.exit(1);
}
console.log(`One copy of @preact/signals-core: ${copies[0]}`);

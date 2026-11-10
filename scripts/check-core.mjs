// Fails when sheet/core imports a game topic (sheet/rolls, sheet/magic and the
// other folders by topic): the core holds the reactive sheet and its edits for
// any kind, and the rules plug into it through the kind's attachComputeds.
// Besides itself it may import the schema, the components and the files at the
// sheet's root; sheet/kinds only for types, since the kinds wire the topics in.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const sheet = path.join(process.cwd(), "ui", "static", "js", "sheet");
const core = path.join(sheet, "core");
const ALLOWED = new Set(["core", "schema", "components"]);

const problems = [];
for (const name of fs.readdirSync(core).filter(f => /\.tsx?$/.test(f))) {
    const file = path.join(core, name);
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
        if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier) continue;
        const spec = node.moduleSpecifier.text;
        if (!spec.startsWith(".")) continue;
        const target = path.resolve(core, spec);
        const [folder, ...rest] = path.relative(sheet, target).split(path.sep);
        const rootFile = !rest.length && !fs.existsSync(target); // "../kinds" is the folder's index
        if (rootFile || ALLOWED.has(folder)) continue;
        if (folder === "kinds" && typeOnly(node)) continue;
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        problems.push(`${path.relative(process.cwd(), file)}:${line + 1}: sheet/core imports sheet/${folder} ("${spec}")`);
    }
}

function typeOnly(node) {
    if (ts.isExportDeclaration(node)) return node.isTypeOnly;
    const clause = node.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    const bindings = clause.namedBindings;
    return !clause.name && !!bindings && ts.isNamedImports(bindings) && bindings.elements.every(e => e.isTypeOnly);
}

if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
}
console.log("sheet/core imports no game topic.");

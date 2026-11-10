// Fails when a folder of ui/static/js/sheet imports a layer above it, or when
// folders of one layer import each other in a cycle. The order and the reasons
// for it: _prd/sheet_modules/plan.md. Imports that break the rule today are
// listed in layer-exceptions.txt; one that no longer exists fails too, so the
// list only shrinks. Type-only imports and tests don't count: they don't load
// a module at run time.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const LAYERS = [
    ["core"],
    ["modifiers"],
    ["characteristics"],
    ["rolls"],
    ["gear", "weapons", "tech", "magic", "combat", "conditions"],
    ["profile", "statblock"],
    ["kinds"],
];
const layerOf = new Map(LAYERS.flatMap((folders, i) => folders.map(f => [f, i])));

const sheet = path.join(process.cwd(), "ui", "static", "js", "sheet");
const exceptionsFile = path.join(process.cwd(), "scripts", "layer-exceptions.txt");
const exceptions = new Set(fs.readFileSync(exceptionsFile, "utf8").split(/\r?\n/)
    .map(l => l.replace(/#.*/, "").trim()).filter(Boolean));
const seen = new Set();
const problems = [];
const sideways = new Map(); // folder -> Map(folder -> [import])

const rel = file => path.relative(sheet, file).split(path.sep).join("/");
const EXTS = [".ts", ".tsx", ".js"];
function resolve(from, spec) {
    const base = path.resolve(path.dirname(from), spec);
    for (const candidate of [base, ...EXTS.map(e => base + e), ...EXTS.map(e => path.join(base, "index" + e))]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
}

for (const folder of layerOf.keys()) {
    const dir = path.join(sheet, folder);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir, { recursive: true })) {
        if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name) || name.endsWith(".gen.ts")) continue;
        const file = path.join(dir, name);
        const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
        for (const node of source.statements) {
            if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier) continue;
            const spec = node.moduleSpecifier.text;
            if (!spec.startsWith(".") || typeOnly(node)) continue;
            const target = resolve(file, spec);
            if (!target) continue;
            const to = rel(target).split("/")[0];
            if (to === folder || !layerOf.has(to)) continue;
            const edge = `${rel(file)} -> ${rel(target)}`;
            if (exceptions.has(edge)) { seen.add(edge); continue; }
            if (layerOf.get(to) > layerOf.get(folder)) problems.push(`${edge}: ${folder} imports ${to}, a layer above it`);
            else if (layerOf.get(to) === layerOf.get(folder)) {
                if (!sideways.has(folder)) sideways.set(folder, new Map());
                const edges = sideways.get(folder);
                if (!edges.has(to)) edges.set(to, []);
                edges.get(to).push(edge);
            }
        }
    }
}

for (const cycle of cycles(sideways)) {
    problems.push(`${cycle.join(", ")} import each other in a cycle:`);
    for (const from of cycle) for (const [to, edges] of sideways.get(from) ?? []) {
        if (cycle.includes(to)) for (const edge of edges) problems.push(`  ${edge}`);
    }
}
for (const edge of exceptions) if (!seen.has(edge)) problems.push(`${edge}: no such import any more, remove it from scripts/layer-exceptions.txt`);

function typeOnly(node) {
    if (ts.isExportDeclaration(node)) return node.isTypeOnly;
    const clause = node.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    const bindings = clause.namedBindings;
    return !clause.name && !!bindings && ts.isNamedImports(bindings) && bindings.elements.every(e => e.isTypeOnly);
}

// Tarjan's strongly connected components with more than one folder.
function cycles(graph) {
    let next = 0;
    const index = new Map(), low = new Map(), stack = [], onStack = new Set(), found = [];
    const visit = v => {
        index.set(v, next); low.set(v, next); next++;
        stack.push(v); onStack.add(v);
        for (const w of graph.get(v)?.keys() ?? []) {
            if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
            else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
        }
        if (low.get(v) !== index.get(v)) return;
        const component = [];
        let w;
        do { w = stack.pop(); onStack.delete(w); component.push(w); } while (w !== v);
        if (component.length > 1) found.push(component.sort());
    };
    for (const v of graph.keys()) if (!index.has(v)) visit(v);
    return found;
}

if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
}
console.log(`Sheet folders import only lower layers (${exceptions.size} exceptions left).`);

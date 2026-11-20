// Fails when a file of ui/static/js/sheet imports a layer above its own, a
// topic of its layer in a direction SIDEWAYS doesn't list, or a folder no
// layer holds; and when code outside the sheet imports more of it than
// sheet/api.ts. Type-only imports count: a type ties the layers as much as a
// value. Tests and testUtils.tsx don't count. The order and the reasons for
// it: _prd/sheet_modules/plan.md. Imports listed in layer-exceptions.txt pass;
// one that no longer exists fails, so the list only shrinks. The forum's script
// imports only its own folder and no package, and nothing else imports it.
// The crop code (crop/) is the site's, shared by the sheet's portrait and the
// account page's avatar: it imports neither the sheet nor the room.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The files at the sheet's root that the layers read: below core, they import
// only the schema and each other. Every other root file wires the sheet
// together (main.ts, instance.ts, api.ts...) and sits above sheet/kinds.
const BASE = ["autocomplete.ts", "connection.ts", "lifecycle.ts", "payload.ts", "rollEvents.ts", "rollLabel.ts", "versions.ts"];

const LAYERS = [
    ["schema"],
    ["<base>"],
    ["core"],
    ["components"],
    ["modifiers"],
    ["characteristics"],
    ["entries"],
    ["rolls"],
    ["powers"],
    ["gear", "weapons", "tech", "magic", "combat", "conditions"],
    ["profile", "statblock"],
    ["kinds"],
    ["<app>"],
];
// The directions in which folders of one layer may import each other.
const SIDEWAYS = {
    combat: ["weapons"], // a stance changes the melee attacks
    weapons: ["gear"], // an attack linked to its gear item
};
// What the code outside the sheet may import of it, and the sheet of the code outside.
const PUBLIC = ["api.ts", "main.ts", "kinds/kinds.gen.ts"];
// A folder, ending in "/", allows every file in it.
const OUTSIDE_ALLOWED = ["room/messages.ts", "i18n/index.ts", "crop/"];
const outsideAllowed = to => OUTSIDE_ALLOWED.some(a => a.endsWith("/") ? to.startsWith(a) : to === a);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const js = path.join(root, "ui", "static", "js");
const sheet = path.join(js, "sheet");
// The forum's script stands alone (_prd/forum/plan.md): plain TypeScript without Preact or signals
// and nothing of the sheet, the room or the bestiary, and nothing else imports it, so that it goes
// with the forum.
const forum = path.join(js, "forum");
const layerOf = new Map(LAYERS.flatMap((units, i) => units.map(u => [u, i])));
const exceptionsFile = path.join(root, "scripts", "layer-exceptions.txt");
const exceptions = new Set(fs.readFileSync(exceptionsFile, "utf8").split(/\r?\n/)
    .map(l => l.replace(/#.*/, "").trim()).filter(Boolean));
const seen = new Set();
const problems = [];

const slash = p => p.split(path.sep).join("/");
const inSheet = file => !path.relative(sheet, file).startsWith("..");
const inForum = file => !path.relative(forum, file).startsWith("..");
const crop = path.join(js, "crop");
const inCrop = file => !path.relative(crop, file).startsWith("..");
const room = path.join(js, "room");
const inRoom = file => !path.relative(room, file).startsWith("..");
const ignored = name => /\.test\.[jt]sx?$/.test(name) || /(^|[\\/])testUtils\.tsx?$/.test(name) || name.endsWith(".d.ts");

// The layer unit of a sheet file: its folder, or <base> / <app> at the root.
function unitOf(file) {
    const [first, ...rest] = slash(path.relative(sheet, file)).split("/");
    if (rest.length) return first;
    return BASE.includes(first) ? "<base>" : "<app>";
}

const EXTS = [".ts", ".tsx", ".js", ".mjs"];
function resolve(from, spec) {
    const base = path.resolve(path.dirname(from), spec);
    for (const candidate of [base, ...EXTS.map(e => base + e), ...EXTS.map(e => path.join(base, "index" + e))]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
}

function* files(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== "node_modules") yield* files(full);
        } else if (/\.(m?js|tsx?)$/.test(entry.name) && !ignored(entry.name)) yield full;
    }
}

// The module specifiers of `file`: imports, re-exports, import() and import("x").T.
function specifiers(file) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const found = [];
    const visit = node => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            found.push(node.moduleSpecifier.text);
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
            found.push(node.arguments[0].text);
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
            found.push(node.argument.literal.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}

function report(edge, why) {
    if (exceptions.has(edge)) seen.add(edge);
    else problems.push(`${edge}: ${why}`);
}

for (const file of files(js)) {
    const from = slash(path.relative(js, file));
    for (const spec of specifiers(file)) {
        if (!spec.startsWith(".")) {
            if (inForum(file)) report(`${from} -> ${spec}`, "the forum script imports no packages");
            continue;
        }
        const target = resolve(file, spec);
        if (!target) continue;
        const to = slash(path.relative(js, target));
        const edge = `${from} -> ${to}`;
        if (inForum(file) !== inForum(target)) {
            report(edge, inForum(file) ? "the forum script imports only ui/static/js/forum" : "nothing outside ui/static/js/forum imports the forum script");
            continue;
        }
        if (inCrop(file) && (inSheet(target) || inRoom(target))) {
            report(edge, "the crop code imports neither the sheet nor the room");
            continue;
        }
        if (!inSheet(file)) {
            if (inSheet(target) && !PUBLIC.includes(slash(path.relative(sheet, target)))) {
                report(edge, "outside the sheet, import sheet/api.ts");
            }
            continue;
        }
        if (!inSheet(target)) {
            if (!outsideAllowed(to)) report(edge, `the sheet imports only ${OUTSIDE_ALLOWED.join(", ")} from outside it`);
            continue;
        }
        const a = unitOf(file), b = unitOf(target);
        if (a === b) continue;
        for (const unit of [a, b]) {
            if (!layerOf.has(unit)) report(edge, `sheet/${unit} is in no layer: add it to LAYERS in scripts/check-layers.mjs`);
        }
        if (!layerOf.has(a) || !layerOf.has(b)) continue;
        if (layerOf.get(b) > layerOf.get(a)) report(edge, `${a} imports ${b}, a layer above it`);
        else if (layerOf.get(b) === layerOf.get(a) && !SIDEWAYS[a]?.includes(b)) {
            report(edge, `${a} imports ${b} of its own layer, a direction SIDEWAYS doesn't allow`);
        }
    }
}

for (const edge of exceptions) if (!seen.has(edge)) problems.push(`${edge}: no such import any more, remove it from scripts/layer-exceptions.txt`);

if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
}
console.log(`The sheet imports only lower layers, the rest of the code only sheet/api.ts, the forum script only itself, the crop code neither the sheet nor the room (${exceptions.size} exceptions left).`);

// Fails on `in` and Object.hasOwn over the sheet state: its objects are
// deepsignal proxies, and these go past the get trap, so the reader is not
// subscribed and misses an item added or removed later. Reading the key,
// `obj[key] !== undefined`, subscribes. A state object is found by its type:
// one that holds signals, directly or deeper. Tests are left out: there `in`
// checks the shape of a state, and nothing re-renders.
import ts from "typescript";
import path from "node:path";

const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
const program = ts.createProgram(config.fileNames, config.options);
const checker = program.getTypeChecker();
const root = path.join(path.dirname(configPath), "ui", "static", "js");

const isSignal = type => {
    const name = type.getSymbol()?.getName();
    return (name === "Signal" || name === "ReadonlySignal")
        && (type.getSymbol().declarations ?? []).some(d => d.getSourceFile().fileName.includes("signals-core"));
};

const seen = new Map();
function holdsSignals(type, depth = 0) {
    if (depth > 4) return false;
    if (seen.has(type)) return seen.get(type);
    seen.set(type, false);
    let result = false;
    if (type.isUnionOrIntersection()) {
        result = type.types.some(t => holdsSignals(t, depth));
    } else if (!isSignal(type) && type.flags & ts.TypeFlags.Object) {
        const children = checker.getPropertiesOfType(type).map(p => checker.getTypeOfSymbol(p));
        const index = checker.getIndexInfoOfType(type, ts.IndexKind.String);
        if (index) children.push(index.type);
        result = children.some(t => {
            const child = checker.getNonNullableType(t);
            return isSignal(child) || holdsSignals(child, depth + 1);
        });
    }
    seen.set(type, result);
    return result;
}

const problems = [];
const report = (node, what) => {
    const file = node.getSourceFile();
    const { line } = file.getLineAndCharacterOfPosition(node.getStart());
    problems.push(`${path.relative(process.cwd(), file.fileName)}:${line + 1}: ${what} over the sheet state does not subscribe; read the key: obj[key] !== undefined`);
};
const onState = node => holdsSignals(checker.getNonNullableType(checker.getTypeAtLocation(node)));

function visit(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InKeyword && onState(node.right)) {
        report(node, "`in`");
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const { expression: target, name } = node.expression;
        if (name.text === "hasOwn" && target.getText() === "Object" && node.arguments[0] && onState(node.arguments[0])) {
            report(node, "Object.hasOwn");
        } else if (name.text === "hasOwnProperty" && onState(target)) {
            report(node, "hasOwnProperty");
        }
    }
    ts.forEachChild(node, visit);
}

for (const file of program.getSourceFiles()) {
    const ours = file.fileName.startsWith(root.replaceAll("\\", "/")) && !/\.test\.tsx?$/.test(file.fileName);
    if (ours && !file.isDeclarationFile) visit(file);
}

if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
}
console.log("No `in` over the sheet state.");

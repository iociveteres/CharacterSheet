// `check:i18n -- literals`: a heuristic count of the interface text still
// written in the code rather than taken from the catalog. What counts:
//
//   TS/TSX/JS  text in JSX, and string literals in JSX children; the strings of
//              the attributes or props title, placeholder, aria-label, label, alt
//              (JSX, object literals, `el.title = …`, setAttribute); assignments
//              to textContent / innerText; the message of alert/confirm/prompt
//   templates  text outside tags and {{ }}, and the attributes above plus the
//              value of a submit/button/reset input
//
// A string counts only when it holds a letter (entities like &nbsp; aside), so
// "×", "—" or "12" don't. A t(…) call or a {{ }} action is never a literal.
// Branches of ?:, && and || and both sides of + are looked into; any other
// expression is left alone.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { LANGS, ROOT } from "./catalog.mjs";
import { isClientSource, lineAt, relToRoot, slash, walk } from "./sources.mjs";

export const DEFAULT_FOLDERS = ["ui/static/js", "ui/html", "internal/mailer/templates"];
export const EXCEPTIONS_FILE = path.join(ROOT, "scripts", "i18n-literal-exceptions.txt");

const LABEL_NAMES = new Set(["title", "placeholder", "aria-label", "ariaLabel", "label", "alt"]);
const TEXT_NAMES = new Set(["textContent", "innerText"]);
const DIALOGS = new Set(["alert", "confirm", "prompt"]);
const BUTTON_TYPES = new Set(["submit", "button", "reset"]);

const ENTITY = /&(#x?[0-9a-f]+|[a-z]+\d*);/gi;
const normalize = text => text.replace(ENTITY, " ").replace(/\s+/g, " ").trim();
// A link or an address reads the same in every language.
const hasLetter = text => /\p{L}/u.test(normalize(text)) && !/^(\S+:\/\/\S+|[^\s@]+@[^\s@]+)$/.test(normalize(text));
// The length of what precedes the text itself: whitespace, entities and, in templates, actions.
const leadOf = text => text.match(/^(\s|\{…\}|&(#x?[0-9a-f]+|[a-z]+\d*);)*/i)[0].length;

/** The string literals an expression evaluates to, looking through ?:, &&, ||, ?? and +. */
function stringsOf(node) {
    if (!node) return [];
    if (ts.isParenthesizedExpression(node) || ts.isJsxExpression(node)) return stringsOf(node.expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) return [node];
    if (ts.isConditionalExpression(node)) return [...stringsOf(node.whenTrue), ...stringsOf(node.whenFalse)];
    if (ts.isBinaryExpression(node)) {
        const op = node.operatorToken.kind;
        if (op === ts.SyntaxKind.AmpersandAmpersandToken) return stringsOf(node.right);
        if ([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken].includes(op)) {
            return [...stringsOf(node.left), ...stringsOf(node.right)];
        }
    }
    return [];
}

const literalText = node => (ts.isTemplateExpression(node)
    ? node.head.text + node.templateSpans.map(s => "${…}" + s.literal.text).join("")
    : node.text);
const literalWords = node => (ts.isTemplateExpression(node) ? node.head.text + node.templateSpans.map(s => s.literal.text).join(" ") : node.text);

const nameOf = node => (node && (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isPrivateIdentifier(node)) ? node.text : node?.getText());

function scriptLiterals(text, file) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const found = [];
    const add = (node, value = literalText(node), words = literalWords(node)) => {
        if (!hasLetter(words)) return;
        const start = ts.isJsxText(node) ? node.pos + leadOf(value) : node.getStart();
        found.push({ file, line: source.getLineAndCharacterOfPosition(start).line + 1, text: normalize(value) });
    };
    const addAll = expr => stringsOf(expr).forEach(n => add(n));
    const visit = node => {
        if (ts.isJsxText(node)) add(node, node.text, node.text);
        else if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) addAll(node.expression);
        else if (ts.isJsxAttribute(node) && LABEL_NAMES.has(node.name.getText())) addAll(node.initializer);
        else if (ts.isPropertyAssignment(node) && LABEL_NAMES.has(nameOf(node.name))) addAll(node.initializer);
        else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) {
            const name = node.left.name.text;
            if (LABEL_NAMES.has(name) || TEXT_NAMES.has(name)) addAll(node.right);
        } else if (ts.isCallExpression(node)) {
            const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : nameOf(node.expression);
            const [first, second] = node.arguments;
            if (DIALOGS.has(callee)) addAll(first);
            else if (callee === "setAttribute" && first && ts.isStringLiteral(first) && LABEL_NAMES.has(first.text)) addAll(second);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}

// Blanks out what isn't page text, keeping the newlines so the lines stay right;
// an action becomes {…} so a literal around it still reads ("Hi, {…}.").
function maskTemplate(text) {
    const blank = s => s.replace(/[^\n]/g, "");
    return text
        .replace(/\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}/g, blank)
        .replace(/\{\{[\s\S]*?\}\}/g, s => "{…}" + blank(s))
        .replace(/<!--[\s\S]*?-->/g, blank)
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, blank);
}

function templateLiterals(text, file) {
    const masked = maskTemplate(text);
    const found = [];
    // Actions at the edges ({{define "title"}}Login{{end}}) aren't part of the text.
    const add = (raw, index) => {
        const lead = leadOf(raw);
        const value = raw.slice(lead).replace(/(\s|\{…\})*$/, "");
        if (hasLetter(value)) found.push({ file, line: lineAt(masked, index + lead), text: normalize(value) });
    };
    for (const m of masked.matchAll(/<[^>]*>|[^<]+/g)) {
        if (!m[0].startsWith("<")) {
            add(m[0], m.index);
            continue;
        }
        const attrs = [...m[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g)]
            .map(a => ({ name: a[1].toLowerCase(), value: a[2] ?? a[3] ?? a[4], index: m.index + a.index }));
        const isButton = /^<input\b/i.test(m[0]) && attrs.some(a => a.name === "type" && BUTTON_TYPES.has(a.value.toLowerCase()));
        for (const a of attrs) {
            if (LABEL_NAMES.has(a.name) || (isButton && a.name === "value")) add(a.value, a.index);
        }
    }
    return found;
}

/** The literals of every source file under `folders` (relative to the repository root). */
export function findLiterals(folders = DEFAULT_FOLDERS) {
    const found = [];
    const files = [];
    for (const folder of folders) {
        // A large text (about.en.html) is the translation itself, kept whole per language.
        const accept = name => isClientSource(name) || (name.endsWith(".html") && !LANGS.some(lang => name.endsWith(`.${lang}.html`)));
        for (const abs of walk(folder, accept)) {
            const file = relToRoot(abs);
            const text = fs.readFileSync(abs, "utf8");
            files.push(file);
            found.push(...(file.endsWith(".html") ? templateLiterals(text, file) : scriptLiterals(text, file)));
        }
    }
    return { literals: found, files };
}

const globToRegExp = glob => new RegExp("^" + glob.split(/(\*\*\/?|\*|\?)/).map(part => (
    part === "**/" ? "(?:.*/)?" : part === "**" ? ".*" : part === "*" ? "[^/]*" : part === "?" ? "[^/]" : part.replace(/[.+^${}()|[\]\\]/g, "\\$&")
)).join("") + "$");

/**
 * Lines of the exceptions file: `path glob | literal | reason`, see its header.
 * @returns {{ exceptions: { glob: string, literal: string, reason: string, file: string, line: number, re: RegExp }[], problems: string[] }}
 */
export function loadExceptions(file = EXCEPTIONS_FILE) {
    const exceptions = [];
    const problems = [];
    if (!fs.existsSync(file)) return { exceptions, problems };
    const rel = relToRoot(file);
    fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((raw, i) => {
        const line = raw.trim();
        if (!line || line.startsWith("#")) return;
        const first = line.indexOf(" | "), last = line.lastIndexOf(" | ");
        if (first === -1 || first === last) {
            problems.push(`${rel}:${i + 1}: expected "path glob | literal | reason"`);
            return;
        }
        const glob = line.slice(0, first).trim(), literal = normalize(line.slice(first + 3, last)), reason = line.slice(last + 3).trim();
        if (!reason) problems.push(`${rel}:${i + 1}: an exception needs a reason`);
        exceptions.push({ glob, literal, reason, file: rel, line: i + 1, re: globToRegExp(glob) });
    });
    return { exceptions, problems };
}

/**
 * Splits literals into the remaining and the excepted, and warns of exceptions
 * that match nothing: those whose glob matches a scanned file but none of its
 * literals, and, when `complete` (the default folders were scanned), those
 * whose glob matches no scanned file.
 */
export function applyExceptions({ literals, files }, { exceptions, problems }, { complete = false } = {}) {
    const used = new Set();
    const remaining = [];
    for (const lit of literals) {
        const match = exceptions.find(ex => ex.re.test(lit.file) && (ex.literal === "*" || ex.literal === lit.text));
        if (match) used.add(match);
        else remaining.push(lit);
    }
    const warnings = [...problems];
    for (const ex of exceptions) {
        if (used.has(ex)) continue;
        const inScope = files.some(f => ex.re.test(f));
        if (inScope || complete) warnings.push(`${ex.file}:${ex.line}: ${ex.glob} | ${ex.literal}: matches no literal any more, remove it`);
    }
    return { remaining, excepted: literals.length - remaining.length, warnings };
}

/**
 * Literal counts by folder: each given folder and its folders up to two levels
 * below it (ui/static/js/sheet/weapons, ui/html/pages), deeper ones counted in
 * those. Folders without literals are listed too, with 0.
 */
export function countByFolder(folders, files, literals) {
    const groupOf = file => {
        const folder = folders.map(slash).find(f => file === f || file.startsWith(f.replace(/\/$/, "") + "/"));
        if (!folder) return null;
        const dirs = path.posix.dirname(path.posix.relative(folder, file)).split("/").filter(d => d && d !== ".");
        return [folder, ...dirs.slice(0, 2)].join("/");
    };
    const counts = new Map();
    for (const file of files) {
        const group = groupOf(file);
        if (group && !counts.has(group)) counts.set(group, 0);
    }
    for (const lit of literals) {
        const group = groupOf(lit.file);
        if (group) counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
}

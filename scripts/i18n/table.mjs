// The page of `npm run i18n:table`: the whole catalog and the large texts in
// one self-contained HTML file, for reading and proofreading the translation.
// The data goes in as JSON and the page's script builds the rows with
// textContent, so no catalog text is ever parsed as HTML.
import path from "node:path";
import { LANGS, PLURAL_FORMS, ROOT, isTranslated } from "./catalog.mjs";

/** A link that opens `file` (relative to the repository root) at `line` in VS Code. */
export const editorLink = (file, line = 1) => `vscode://file/${encodeURI(path.resolve(ROOT, file).split(path.sep).join("/").replace(/^\//, ""))}:${line}`;

const STYLE = `
:root { color-scheme: light dark; --bg: #fff; --panel: #f5f5f4; --line: #e2e2e0; --text: #1c1c1a; --muted: #6b6b66;
  --accent: #1d5fbf; --warn: #b3261e; --warn-bg: #fdecea; --sel: #e3ecfa; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #18181a; --panel: #222225; --line: #34343a; --text: #e6e6e3; --muted: #9a9a95;
    --accent: #7aa7f0; --warn: #f2948c; --warn-bg: #3a2020; --sel: #26344d; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.4 system-ui, sans-serif; }
header { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center;
  padding: 10px 16px; background: var(--panel); border-bottom: 1px solid var(--line); }
header h1 { margin: 0; font-size: 16px; }
header input[type=search] { flex: 1 1 240px; padding: 5px 8px; font: inherit; color: inherit; background: var(--bg);
  border: 1px solid var(--line); border-radius: 4px; }
.stats { color: var(--muted); }
.layout { display: flex; align-items: flex-start; }
nav { position: sticky; top: 53px; flex: 0 0 240px; max-height: calc(100vh - 53px); overflow: auto; padding: 8px 0;
  border-right: 1px solid var(--line); }
nav ul { list-style: none; margin: 0; padding-left: 12px; }
nav > ul { padding-left: 4px; }
nav button { display: flex; width: 100%; justify-content: space-between; gap: 8px; padding: 2px 8px; border: 0;
  border-radius: 3px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
nav button:hover { background: var(--line); }
nav button.selected { background: var(--sel); }
nav .count { color: var(--muted); font-size: 12px; }
nav .count.todo { color: var(--warn); }
main { flex: 1; min-width: 0; padding: 8px 16px 32px; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th, td { padding: 4px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { color: var(--muted); font-weight: 600; }
col.key { width: 26%; } col.note { width: 18%; }
tr.file td { padding-top: 14px; font-weight: 600; color: var(--muted); border-bottom-color: var(--text); }
td.key code { font-size: 12.5px; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.where { display: block; font-size: 12px; }
.form { display: block; }
.form b { display: inline-block; min-width: 3.5em; color: var(--muted); font-weight: normal; font-size: 12px; }
#entries td { white-space: pre-line; }
td.todo { color: var(--warn); background: var(--warn-bg); }
td.note { color: var(--muted); }
.hint { color: var(--muted); font-size: 12px; }
td.editable { cursor: text; }
td.editable:hover { box-shadow: inset 0 0 0 1px var(--line); }
td.saving { opacity: .5; }
td textarea { display: block; width: 100%; min-height: 2em; field-sizing: content; padding: 2px 4px; resize: vertical;
  font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--accent); border-radius: 3px; }
label.form { display: flex; align-items: baseline; }
label.form + label.form { margin-top: 2px; }
label.form b { flex: none; }
.problems { display: block; margin-top: 4px; color: var(--warn); font-size: 12px; white-space: pre-line; }
h2 { margin: 24px 0 4px; font-size: 15px; }
.empty { color: var(--muted); padding: 16px 0; }
@media (max-width: 720px) { .layout { display: block; } nav { position: static; max-height: 40vh; border-right: 0;
  border-bottom: 1px solid var(--line); } }
`;

// Runs in the page: builds the tree, the rows and the filters from #data.
function page() {
    const data = JSON.parse(document.getElementById("data").textContent);
    const el = (tag, props = {}, ...children) => {
        const node = Object.assign(document.createElement(tag), props);
        node.append(...children.filter(c => c !== null && c !== undefined));
        return node;
    };
    const isForms = m => m !== null && typeof m === "object";
    const texts = m => (isForms(m) ? Object.values(m) : [m ?? ""]);
    const untranslated = e => e.ru === undefined || texts(e.ru).some(t => !t);
    const FIELDS = [...data.langs, "note"];
    // As the server saves it: a cleared field is left out of the entry.
    const normalize = v => (isForms(v) ? (Object.values(v).every(t => t === "") ? undefined : v) : v === "" ? undefined : v);
    const message = (m, cell) => {
        if (isForms(m)) for (const [form, text] of Object.entries(m)) cell.append(el("span", { className: "form" }, el("b", { textContent: form }), text));
        else cell.append(m ?? "—");
        return cell;
    };

    // The tree: every prefix of the catalog files, then the large texts under "large texts".
    const root = { path: "", label: "All", children: new Map(), keys: 0, todo: 0 };
    const nodeAt = parts => parts.reduce((node, part, i) => {
        if (!node.children.has(part)) node.children.set(part, { path: parts.slice(0, i + 1).join("."), label: part, children: new Map(), keys: 0, todo: 0 });
        return node.children.get(part);
    }, root);
    const entryNodes = new Set([root]);
    for (const e of data.entries) {
        for (let n = e.prefix.split(".").length; n >= 0; n--) entryNodes.add(nodeAt(e.prefix.split(".").slice(0, n)));
    }
    const large = { path: "#large", label: "large texts", children: new Map(), keys: data.texts.length, todo: 0 };
    for (const text of data.texts) {
        const group = text.name.split("/")[0];
        if (!large.children.has(group)) large.children.set(group, { path: `#large/${group}`, label: group, children: new Map(), keys: 0, todo: 0 });
        const node = large.children.get(group);
        node.keys++;
        if (!text.files.ru) { node.todo++; large.todo++; }
    }
    if (data.texts.length) root.children.set("#large", large);

    let selected = "";
    const buttons = [];
    const treeItem = node => {
        node.count = el("span");
        const button = el("button", { type: "button" }, el("span", { textContent: node.label }), node.count);
        button.dataset.path = node.path;
        button.addEventListener("click", () => { selected = node.path; apply(); });
        buttons.push(button);
        const kids = [...node.children.values()];
        return el("li", {}, button, kids.length ? el("ul", {}, ...kids.map(treeItem)) : null);
    };
    document.querySelector("nav").append(el("ul", {}, treeItem(root)));
    const stats = document.getElementById("stats");
    // Counts by section and in the header; again after each save, which may translate an entry or clear one.
    function recount() {
        for (const node of entryNodes) node.keys = node.todo = 0;
        for (const e of data.entries) {
            for (let n = e.prefix.split(".").length; n >= 0; n--) {
                const node = nodeAt(e.prefix.split(".").slice(0, n));
                node.keys++;
                if (untranslated(e)) node.todo++;
            }
        }
        for (const node of [...entryNodes, large, ...large.children.values()]) {
            if (!node.count) continue;
            node.count.className = "count" + (node.todo ? " todo" : "");
            node.count.textContent = node.todo ? `${node.todo} / ${node.keys}` : String(node.keys);
        }
        stats.textContent = `${root.keys} keys, ${root.todo} without ru, ${data.texts.length} large texts`;
    }

    // The rows, in catalog order, with a heading row per file.
    const tbody = document.querySelector("#entries tbody");
    const rows = [];
    const showRow = row => {
        const e = row.entry;
        const classes = { en: e.en === undefined ? "todo" : "", ru: untranslated(e) ? "todo" : "", note: "note" };
        for (const field of FIELDS) {
            const cell = row.fieldCells[field];
            cell.className = classes[field] + (data.editable ? " editable" : "");
            cell.replaceChildren();
            if (field === "note") cell.append(e.note ?? "");
            else message(e[field], cell);
        }
        row.haystack = [e.key, ...texts(e.en), ...texts(e.ru), e.note ?? ""].join("\n").toLowerCase();
    };
    let lastFile = null, fileRow = null;
    for (const e of data.entries) {
        if (e.file !== lastFile) {
            lastFile = e.file;
            fileRow = el("tr", { className: "file" }, el("td", { colSpan: 4, textContent: e.file }));
            fileRow.entries = [];
            tbody.append(fileRow);
        }
        const row = el("tr");
        row.entry = e;
        row.problems = el("span", { className: "problems", hidden: true });
        row.fieldCells = Object.fromEntries(FIELDS.map(field => [field, el("td")]));
        row.append(el("td", { className: "key" }, el("code", { textContent: e.key }), el("a", { className: "where", href: e.href, textContent: `${e.file}:${e.line}` }), row.problems),
            ...FIELDS.map(field => row.fieldCells[field]));
        if (data.editable) for (const field of FIELDS) row.fieldCells[field].addEventListener("click", () => edit(row, field));
        showRow(row);
        fileRow.entries.push(row);
        rows.push(row);
        tbody.append(row);
    }
    const fileRows = [...tbody.querySelectorAll("tr.file")];
    recount();

    // Editing in place: a click opens the field, leaving it saves, Esc puts it back.
    function edit(row, field) {
        const cell = row.fieldCells[field];
        if (cell.editing || String(getSelection())) return;
        cell.editing = true;
        const e = row.entry;
        const before = e[field];
        const other = data.langs.find(lang => lang !== field && isForms(e[lang]));
        // A missing translation of a plural entry starts with that language's forms.
        const forms = field === "note" ? null
            : isForms(before) ? [...new Set([...data.pluralForms[field], ...Object.keys(before)])]
            : before === undefined && other ? data.pluralForms[field] : null;
        const areas = (forms ?? [null]).map(form => {
            const value = form === null ? before ?? "" : before?.[form] ?? "";
            return [form, el("textarea", { value, rows: String(value).split("\n").length, lang: field === "en" ? "en" : "ru" })];
        });
        cell.className = "";
        cell.replaceChildren(...areas.map(([form, area]) => (form === null ? area : el("label", { className: "form" }, el("b", { textContent: form }), area))));
        areas[0][1].focus();
        const value = () => (forms ? Object.fromEntries(areas.map(([form, area]) => [form, area.value])) : areas[0][1].value);

        let saving = false;
        const close = () => {
            cell.removeEventListener("focusout", onFocusOut);
            cell.removeEventListener("keydown", onKey);
            cell.editing = false;
            showRow(row);
        };
        const say = lines => {
            row.problems.textContent = lines.join("\n");
            row.problems.hidden = !lines.length;
        };
        async function save() {
            const after = value();
            if (JSON.stringify(normalize(after) ?? null) === JSON.stringify(before ?? null)) return close();
            saving = true;
            cell.classList.add("saving");
            try {
                const res = await fetch("/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: e.key, field, before: before ?? null, after }) });
                const body = await res.json();
                if (res.status === 409) {
                    // The file changed after the page loaded: show what it holds now and the text that wasn't saved.
                    setFields(e, body.fields);
                    close();
                    say([`${field} has changed in the file, the table shows it now. Not saved:`, JSON.stringify(after)]);
                    return;
                }
                if (!res.ok) throw new Error(body.error);
                setFields(e, body.fields);
                close();
                recount();
                say(body.problems);
            } catch (err) {
                saving = false;
                cell.classList.remove("saving");
                say([`Not saved: ${err.message}`]);
            }
        }
        function onFocusOut(event) {
            // Moving between the plural forms of one cell stays in the editor.
            if (!saving && !cell.contains(event.relatedTarget)) save();
        }
        function onKey(event) {
            if (saving) return;
            if (event.key === "Escape") close();
            else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) save();
        }
        cell.addEventListener("focusout", onFocusOut);
        cell.addEventListener("keydown", onKey);
    }
    function setFields(e, fields) {
        for (const field of FIELDS) {
            if (fields[field] === undefined) delete e[field];
            else e[field] = fields[field];
        }
    }

    const textBody = document.querySelector("#texts tbody");
    const textRows = data.texts.map(text => {
        const link = lang => (text.files[lang]
            ? el("a", { href: text.files[lang].href, textContent: text.files[lang].file })
            : "—");
        const row = el("tr", {}, el("td", {}, el("code", { textContent: text.name })),
            ...data.langs.map(lang => el("td", { className: text.files[lang] ? "" : "todo" }, link(lang))));
        row.text = text;
        row.haystack = [text.name, ...Object.values(text.files).map(f => f.file)].join("\n").toLowerCase();
        textBody.append(row);
        return row;
    });

    const search = document.getElementById("search");
    const todoOnly = document.getElementById("todo");
    function apply() {
        const needle = search.value.trim().toLowerCase();
        const inEntries = selected === "" || !selected.startsWith("#");
        let shown = 0;
        for (const row of rows) {
            const e = row.entry;
            row.hidden = !inEntries
                || (selected && e.prefix !== selected && !e.prefix.startsWith(selected + "."))
                || (todoOnly.checked && !untranslated(e))
                || (needle && !row.haystack.includes(needle));
            if (!row.hidden) shown++;
        }
        for (const fileRow of fileRows) fileRow.hidden = fileRow.entries.every(r => r.hidden);
        let textsShown = 0;
        for (const row of textRows) {
            const group = "#large/" + row.text.name.split("/")[0];
            row.hidden = !(selected === "" || selected === "#large" || selected === group)
                || (todoOnly.checked && row.text.files.ru)
                || (needle && !row.haystack.includes(needle));
            if (!row.hidden) textsShown++;
        }
        document.getElementById("entries").hidden = !shown;
        document.getElementById("texts-section").hidden = !textsShown;
        document.getElementById("empty").hidden = shown + textsShown > 0;
        for (const b of buttons) b.classList.toggle("selected", b.dataset.path === selected);
    }
    search.addEventListener("input", apply);
    todoOnly.addEventListener("change", apply);
    apply();
}

/**
 * @param {{ entries: import("./catalog.mjs").Entry[], texts: { name: string, files: Record<string, string> }[], editable?: boolean }} input
 *   texts as largeTexts() gives them; editable when npm run i18n:edit serves the page and saves its edits
 */
export function renderTable({ entries, texts, editable = false }) {
    const data = {
        langs: LANGS,
        pluralForms: PLURAL_FORMS,
        editable,
        entries: entries.map(e => ({ key: e.key, file: e.file, line: e.line, prefix: e.prefix, en: e.en, ru: e.ru, note: e.note, href: editorLink(e.file, e.line) })),
        texts: texts.map(t => ({
            name: t.name,
            files: Object.fromEntries(Object.entries(t.files).map(([lang, file]) => [lang, { file, href: editorLink(file) }])),
        })),
    };
    const todo = entries.filter(e => !isTranslated(e, "ru")).length;
    // < escaped so that no text can close the script element.
    const json = JSON.stringify(data).replace(/</g, "\\u003c");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>i18n catalog</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>i18n catalog</h1>
  <span class="stats" id="stats">${entries.length} keys, ${todo} without ru, ${texts.length} large texts</span>
  <input type="search" id="search" placeholder="Search key, en, ru, note" autofocus>
  <label><input type="checkbox" id="todo"> Not translated</label>
  <span class="hint">${editable
        ? "Click en, ru or note to edit; leaving the field saves the file, Esc cancels."
        : "Read-only: npm run i18n:edit serves this table with editing."}</span>
</header>
<div class="layout">
<nav></nav>
<main>
  <table id="entries">
    <colgroup><col class="key"><col><col><col class="note"></colgroup>
    <thead><tr><th>key</th><th>en</th><th>ru</th><th>note</th></tr></thead>
    <tbody></tbody>
  </table>
  <section id="texts-section">
    <h2>Large texts</h2>
    <table id="texts">
      <colgroup><col class="key">${LANGS.map(() => "<col>").join("")}</colgroup>
      <thead><tr><th>text</th>${LANGS.map(lang => `<th>${lang}</th>`).join("")}</tr></thead>
      <tbody></tbody>
    </table>
  </section>
  <p class="empty" id="empty" hidden>Nothing matches.</p>
</main>
</div>
<script type="application/json" id="data">${json}</script>
<script>(${page.toString()})();</script>
</body>
</html>
`;
}

// npm run i18n:edit [-- --port 4010]: the table of i18n:table with editable
// en, ru and note, served on 127.0.0.1; a save writes the catalog file at once.
import http from "node:http";
import { loadCatalog } from "./i18n/catalog.mjs";
import { Conflict, saveEntry } from "./i18n/edit.mjs";
import { largeTexts } from "./i18n/sources.mjs";
import { renderTable } from "./i18n/table.mjs";

const portArg = process.argv.indexOf("--port");
const PORT = portArg === -1 ? 4010 : Number(process.argv[portArg + 1]);
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const send = (res, status, type, body) => {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(body);
};
const sendJSON = (res, status, value) => send(res, status, "application/json; charset=utf-8", JSON.stringify(value));

const server = http.createServer(async (req, res) => {
    // Another site may point its own name at 127.0.0.1; only these hosts reach the catalog.
    if (!HOSTS.has(req.headers.host)) return send(res, 403, "text/plain", "unknown host");
    if (req.method === "GET" && req.url === "/") {
        // Read anew on every load, so the page shows edits made in the files too.
        const { entries } = loadCatalog();
        return send(res, 200, "text/html; charset=utf-8", renderTable({ entries, texts: largeTexts(), editable: true }));
    }
    // A JSON content type makes a cross-site request preflight, which this server never answers.
    if (req.method === "POST" && req.url === "/save" && req.headers["content-type"] === "application/json") {
        let body = "";
        for await (const chunk of req) body += chunk;
        try {
            return sendJSON(res, 200, saveEntry(JSON.parse(body)));
        } catch (err) {
            if (err instanceof Conflict) return sendJSON(res, 409, { error: err.message, fields: err.current });
            return sendJSON(res, 400, { error: err.message });
        }
    }
    send(res, 404, "text/plain", "not found");
});

server.listen(PORT, "127.0.0.1", () => {
    console.log(`Editing i18n/catalog at http://localhost:${PORT}/ (Ctrl+C to stop).`);
    console.log("The app picks the edits up after npm run build and a server restart.");
});

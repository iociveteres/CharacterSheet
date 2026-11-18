# Agents

An online character sheet for Warhammer tabletop RPGs: rooms, chat, dice rolls and sheet edits that
every player sees live over WebSocket. Setup, `.env`, migrations and Docker: `README.md`.

## Critical rules

- Never push to `main`: a push deploys straight to production (`.github/workflows/deploy.yml`).
  Work on a branch.
- Never edit `*.gen.ts` by hand. After changing `internal/models/character_sheets_content.go` or
  `sheet_kinds.go`, run `npm run gen:types`; after changing `i18n/catalog`, `npm run gen:i18n`. CI
  checks the result.
- Never add a `Co-Authored-By` line to commits.

## Architecture

- Go + PostgreSQL (pgx), entry point `cmd/web`; static files and templates embedded by `ui/efs.go`.
- Sheet content is one JSONB value shaped by `internal/models/character_sheets_content.go`. A field
  lives in the Go struct, the JS schema (`ui/static/js/sheet/schema`) and the block that renders it
  (in the topic's folder, e.g. `sheet/weapons`). Changing the shape of stored data needs a migration.
- `sheet/core` is the sheet state and its edits, with no game rules (`npm run check:layers`). Each
  topic folder (`rolls`, `characteristics`, `conditions`, `combat`, `weapons`, `gear`, `magic`,
  `tech`, `profile`, `statblock`) keeps its rules, blocks and tests together. A rules file named like
  its block takes a `Rules` suffix (`gripRules.ts` next to `Grips.tsx`): Windows ignores case.
- A migration that touches `character_sheets`, up or down, leaves `updated_at` alone: it is when a
  player last changed the sheet. Older migrations set it; don't copy that line.
- The room page is one bundle, `room/main.ts`, that also imports the sheet. The room is Preact
  islands mounted into the empty elements of `view_room.html` (`room/islands.tsx`), rendered from
  `#room-state`. Room and sheet don't import each other's state or components: they talk through
  DOM events on `document` (`sheet:*`, `ws:*`, `room:sendMessage`) and `room/socket.js`.
- The sheet is Preact + `@preact/signals`, rendered on the client from JSON: `/sheet/view/:id` for a
  sheet picked in the room list, `#sheet-state` when the room page is opened on a sheet.
  `sheet/main.ts` renders `<Sheet>` into a shadow root; each kind's layout is
  `sheet/kinds/<kind>.tsx` (adding a kind: see `internal/models/sheet_kinds.go`).
- Components never write signals: fields send edits through the sheet context's `actions`
  (`core/actions.ts`), remote changes go to the state only (`core/remote.ts`); the room uses
  `room/actions.ts` and `room/remote.ts`. data-ids nest like state paths; nothing reads them back,
  CSS and tests do.
- Backgrounds by nesting level, selection, buttons by role, editing in place:
  `ui/static/css/DESIGN.md`. Follow it in new UI.
- UI text is in `i18n/catalog/` (en, ru), never a literal in code: `t("key")` on the client
  (`ui/static/js/i18n`), `i18n.T(lang, "key")` and `{{t .Lang "key"}}` on the server; exceptions
  with a reason in `scripts/i18n-literal-exceptions.txt`. A file path is its key prefix
  (`sheet/weapons.json` holds `sheet.weapons.*`); one entry per line with the full key:
  `"key": { "en": …, "ru": …, "note": "for the translator" }`, plural forms picked by `count`.
  Terms come from `sheet/terms*.json` and `common.json`, never a second key. A key built at run time
  needs an `i18n-keys:` marker (`scripts/i18n/usage.mjs`). Long texts are a file per language
  (`ui/html/content/<name>.<lang>.html`, `internal/mailer/templates`).
- Stored values never depend on the language: translate the label, not what goes into the sheet;
  rules compare the stored value. What the server sends to the whole room is a code that each client
  words in its own language. So is a roll label: what the sheet takes from the catalog goes as a code
  (`sheet/rollLabel.ts`), worded by the reader's client (`sheet/rollLabelText.ts`); only what the
  player typed stays text. Codes are stored in `room_messages.label_data`: never rename one, alias it.

## Game data: the DoomBC Core rulebook (Russian), prepared in `../BookParser`

- `JSON/final/*.json`: built by its `build.py` and copied into `internal/gamedata/assets` (a private
  repo). Without the folder `go:embed` fails: put a `placeholder.json` containing `[]` there.
- `JSON/<NNx>_<domain>/*.json`: hand-proofread sources; data fixes go here, then rebuild.
- `chapters/<NN section>/<NN title>.pdf`: the book split by chapter, for looking up rules text
  (e.g. `04 II. МЕХАНИКА/05 БОЙ.pdf`). The whole book is `DoomBC_Core_opt.pdf`.
- `markdown/4a_ranged`, `4b_melee`, `4c_armour`: weapon and armour tables in Markdown.

## Commands

- Run `npm run build` before `go run ./cmd/web`: the bundle is embedded in the binary.
- Frontend work: `npm run watch` and `go run ./cmd/web -dev`; JS and CSS show up on reload. Restart
  the server after changing Go code or templates: templates stay embedded even with `-dev`.
- Check in a browser with `web-local` / `web-dev` from `.claude/launch.json` (port 4002): with the
  `BASE_URL` from `.env` the WebSocket rejects the connection, it compares Origin with `BASE_URL`.
- Checks, same as CI: `npm run typecheck`, `npm test`, `npm run check:signals`,
  `npm run check:state`, `npm run check:layers`, `npm run check:i18n`, `go vet ./...`,
  `go test ./...`. `internal/models` tests need Postgres on `localhost:5432` (`test_web` / `pass`,
  database `test_charactersheet`). Most tests take the schema from `testdata/setup.sql`; encounter
  and bestiary tests build it in `newSheetHomesTestDB` from `sheet_homes_setup.sql` plus a list of
  migrations: add a new migration there and its tables to `sheet_homes_teardown.sql`. Run
  `npm test -- --reporter=dot` to keep the output short: it lists only failures.
- `npm run test:e2e` drives a running `web-local` / `web-dev` in headless Chrome, with the session
  saved by `node scripts/perf/sheet-render.mjs login`. Pass a folder to run one domain
  (`npm run test:e2e -- e2e/scenarios/sync`); `baseline/old-build` compares with a build on :4001.
- Strings: `npm run i18n -- find <text or key>` instead of reading catalog files,
  `npm run i18n -- missing` for keys without `ru`; `npm run i18n:table` builds `i18n/table.html` for
  proofreading, `npm run i18n:edit` serves it editable. e2e pins the `lang=en` cookie.
- happy-dom misparses `select`, `input`, `textarea` and radio in HTML strings: render with Preact.
- Measure render time with `npm run perf:sheet`, not in the built-in browser pane: it throttles
  `requestAnimationFrame` in the background.

## Commits

- Subject: conventional commits in English, lowercase, no trailing period:
  `fix: do not render layout positions without an item`.
- Body: prose paragraphs on what changed in behaviour and why.

## Code comments

- Don't restate the code: what a well-named function does, what an expression returns, type fields.
- Comment what isn't visible from the surrounding code: why it's done this way, non-obvious browser,
  library or server behaviour, a link to another file, a known pitfall. Usually one line.

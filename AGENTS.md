# Agents

An online character sheet for Warhammer tabletop RPGs: rooms, chat, dice rolls and sheet edits that
every player sees live over WebSocket. Setup, `.env`, migrations and Docker: `README.md`.

## Critical rules

- Never push to `main`: a push deploys straight to production (`.github/workflows/deploy.yml`).
  Work on a branch.
- Never edit `*.gen.ts` by hand. After changing `internal/models/character_sheets_content.go` or
  `sheet_kinds.go`, run `npm run gen:types`; CI checks the result.
- Never add a `Co-Authored-By` line to commits.

## Architecture

- Go + PostgreSQL (pgx), entry point `cmd/web`; static files and templates embedded by `ui/efs.go`.
- Sheet content is one JSONB value shaped by `internal/models/character_sheets_content.go`. A field
  lives in the Go struct, the JS schema (`ui/static/js/sheet/schema`) and the block that renders it
  (`ui/static/js/sheet/blocks`). Changing the shape of stored data needs a migration.
- The room page is one bundle, `room/main.ts`, that also imports the sheet. The room is Preact
  islands mounted into the empty elements of `view_room.html` (`room/islands.tsx`), rendered from
  `#room-state`. Room and sheet don't import each other's state or components: they talk through
  DOM events on `document` (`sheet:*`, `ws:*`, `room:sendMessage`) and `room/socket.js`.
- The sheet is Preact + `@preact/signals`, rendered on the client from JSON: `/sheet/view/:id` for a
  sheet picked in the room list, `#sheet-state` when the room page is opened on a sheet.
  `sheet/main.ts` renders `<Sheet>` into a shadow root; each kind's layout is
  `sheet/kinds/<kind>.tsx` (adding a kind: see `internal/models/sheet_kinds.go`).
- Components never write signals: fields send edits through the sheet context's `actions`
  (`state/actions.ts`), remote changes go to the state only (`state/remote.ts`); the room uses
  `room/actions.ts` and `room/remote.ts`. data-ids nest like state paths; nothing reads them back,
  CSS and tests do.

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
- Checks, same as CI: `npm run typecheck`, `npm test`, `npm run check:signals`, `go vet ./...`,
  `go test ./...`. `internal/models` tests need Postgres on `localhost:5432` (`test_web` / `pass`,
  database `test_charactersheet`). The schema comes from `internal/models/testdata/setup.sql`, not
  from migrations.
- `npm run test:e2e` drives a running `web-local` / `web-dev` in headless Chrome, with the session
  saved by `node scripts/perf/sheet-render.mjs login`. Pass a folder to run one domain
  (`npm run test:e2e -- e2e/scenarios/sync`); `baseline/old-build` compares with a build on :4001.
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

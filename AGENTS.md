# Agents

An online character sheet for Warhammer tabletop RPGs: rooms, chat, dice rolls, and sheet edits
that every player sees live over WebSocket. First-time setup, `.env`, migrations and Docker are
covered in `README.md`.

## Critical rules

- Never push to `main`: a push deploys straight to production (`.github/workflows/deploy.yml`).
  Work on a branch.
- Never edit `*.gen.ts` by hand. After changing `internal/models/character_sheets_content.go` or
  `sheet_kinds.go`, run `npm run gen:types`; CI checks the result.
- Never add a `Co-Authored-By` line to commits.

## Architecture

- Go + PostgreSQL (pgx), entry point `cmd/web`. Static files and templates are embedded with
  `go:embed` (`ui/efs.go`).
- Sheet content is stored as a single JSONB value; its shape is defined in
  `internal/models/character_sheets_content.go`.
- One sheet field lives in the Go struct, the JS schema (`ui/static/js/sheet/schema`) and the
  block that renders it (`ui/static/js/sheet/blocks`). Changing the shape of already stored data
  needs a migration.
- The room page uses Alpine.js. The sheet is Preact + `@preact/signals`, rendered on the client
  from JSON: `/sheet/view/:id` for a sheet picked in the room list, `#sheet-state` when the room
  page is opened on a sheet. `sheet/main.ts` renders `<Sheet>` into a shadow root; the layout of
  each kind is `sheet/kinds/<kind>.tsx` (adding a kind: see `internal/models/sheet_kinds.go`).
- Components never write signals: fields render their signal and send edits through the
  `actions` of the sheet context (`state/actions.ts`). Remote changes go to the state only
  (`state/remote.ts`). data-ids nest like state paths; nothing reads them back, CSS and tests do.

## Commands

- Run `npm run build` before `go run ./cmd/web`: the bundle is embedded in the binary.
- For frontend work: `npm run watch` and `go run ./cmd/web -dev`. JS and CSS changes show up on page
  reload. Restart the server after changing Go code or templates: templates stay embedded even with
  `-dev`.
- To check in a browser, run `web-local` / `web-dev` from `.claude/launch.json` (port 4002). With
  the `BASE_URL` from `.env` the WebSocket rejects the connection, because it compares Origin with
  `BASE_URL`.
- Checks, same as CI: `npm run typecheck`, `npm test`, `npm run check:signals`, `go vet ./...`,
  `go test ./...`.
- `internal/models` tests need Postgres on `localhost:5432` (`test_web` / `pass`, database
  `test_charactersheet`). The schema comes from `internal/models/testdata/setup.sql`, not from
  migrations.
- If `internal/gamedata/assets` is missing (it comes from a private repo), `go:embed` fails to
  build. Put a `placeholder.json` containing `[]` there.
- `npm run test:e2e` drives a running `web-local` / `web-dev` in headless Chrome, with the session
  saved by `node scripts/perf/sheet-render.mjs login`. Scenarios 01/02 compare with an old build
  on :4001.
- happy-dom parses `select`, `input`, `textarea` and radio from HTML strings wrong; render them
  with Preact in vitest.
- Measure render time with `npm run perf:sheet`, not in the built-in browser pane: it throttles
  `requestAnimationFrame` in the background.

## Commits

- Subject: conventional commits in English, lowercase, no trailing period:
  `fix: do not render layout positions without an item`.
- Body: prose paragraphs on what changed in behaviour and why.

## Code comments

- Don't write comments that restate the code: what a well-named function does, what an obvious
  expression returns, which fields a type has.
- Write a comment where something isn't visible from the surrounding code: why it's done this way,
  non-obvious browser, library or server behaviour, a link to another file, a known pitfall.
- Keep those comments short: usually one line.

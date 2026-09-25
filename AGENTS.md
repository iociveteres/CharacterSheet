# Agents

An online character sheet for Warhammer tabletop RPGs: rooms, chat, dice rolls, and sheet edits
that every player sees live over WebSocket. First-time setup, `.env`, migrations and Docker are
covered in `README.md`.

## Critical rules

- Never push to `main`: a push deploys straight to production (`.github/workflows/deploy.yml`).
  Work on a branch.
- Never edit `ui/static/js/sheet/schema/content.gen.ts` by hand. After changing
  `internal/models/character_sheets_content.go`, run `npm run gen:types`; CI checks the result.
- Never add a `Co-Authored-By` line to commits.

## Architecture

- Go + PostgreSQL (pgx), entry point `cmd/web`. Static files and templates are embedded with
  `go:embed` (`ui/efs.go`).
- Sheet content is stored as a single JSONB value; its shape is defined in
  `internal/models/character_sheets_content.go`.
- One sheet field lives in several places: the Go struct, the Go template in `ui/html/sheet/*`,
  defaults in `internal/templates/sheet_funcs.go`, and the JS schema in `ui/static/js/sheet/schema`.
  Changing the shape of already stored data needs a migration.
- The room page uses Alpine.js. The sheet is being moved to Preact + `@preact/signals` block by
  block.
- Preact blocks are mounted only through `mountBlock` (`ui/static/js/sheet/components/mount.tsx`)
  and never write signals: fields render their signal, `network.js` writes it. Remote changes under
  a mounted block's paths go to the state only (`state/remote.ts`).
- Blocks moved to Preact live in `ui/static/js/sheet/blocks`. Their Go template is an empty mount
  point (`data-block`), and their state keys are listed in `PREACT_BLOCK_PATHS`
  (`state/migrated.ts`), which the markup reconciliation skips.

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
- After changing the schema, `normalizeSheet` or sheet templates, run `npm run reconcile:sheets`
  (see `README.md`, section Sheet state).
- happy-dom parses `select`, `input`, `textarea` and radio wrong. The workaround is `matchBrowser`
  in `scripts/reconcile/compare.ts`.
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

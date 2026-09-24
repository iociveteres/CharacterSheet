# Iociveteres's Character Sheet

An online Warhammer RP compatible character sheet. Fast, informative, convenient, green across all Lighthouse metrics and well received by small community.

[charactersheet.iociveteres.ru](https://charactersheet.iociveteres.ru)

---

## Features

- Real-time sync across players via WebSocket
- Rooms, chat, dice roller
- Role-based permissions — gamemaster, moderator, player
- Drag-and-drop item grid layout with persistent column positions
- One-click rolls for skill checks, ability tests, and initiative
- Modifier builders for attacks, psychic tests, and custom rolls
- Copy-paste from rulebook — weapons, gear, talents, psychic and tech powers
- Folder organisation for character sheets
- Export / import character as JSON
- Email confirmations
- Light and dark themes with adjustable accent hue

---

## Tech Stack

- **Backend:** Go, PostgreSQL (pgx)
- **Frontend:** Alpine.js, Preact signals, SortableJS, vanilla JS, esbuild
- **Transport:** WebSocket, custom JSON API
- **Infrastructure:** Docker, VPS

---

## Running Locally

### Prerequisites

- Go 1.24+
- Node.js 24+
- PostgreSQL 15+
- [golang-migrate](https://github.com/golang-migrate/migrate) CLI

### Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/iociveteres/CharacterSheet
   cd CharacterSheet
   ```

2. **Create a `.env` file** in the project root:
   ```env
   DATABASE_URL=postgres://user:password@localhost:5432/charactersheet?sslmode=disable
   BASE_URL=http://localhost:4000
   SMTP_HOSTNAME=smtp.example.com
   SMTP_PORT=587
   SMTP_USER=you@example.com
   SMTP_PASS=secret
   ```

3. **Run migrations**
   ```bash
   migrate -path ./migrations -database $DATABASE_URL up
   ```

4. **Build the frontend bundle**
   ```bash
   npm ci && npm run build
   ```

   This is required before `go run`: the sheet is bundled into `ui/static/dist/sheet.js`,
   which the binary embeds. The room's WebSocket also lives in the bundle, so without it
   neither the sheet nor chat and dice work.

5. **Start the server**
   ```bash
   go run ./cmd/web
   ```

   The site will be available at `http://localhost:4000`.

### Frontend development

Static files are embedded with `go:embed`, so a rebuilt bundle is only picked up after
restarting the server. For live work run the watcher and start the server with `-dev`,
which serves `/static` from `./ui` on disk with `Cache-Control: no-store`:

```bash
npm run watch
go run ./cmd/web -dev
```

Checks run in CI: `npm run typecheck`, `npm test`, `npm run check:signals` (one copy of
`@preact/signals-core`), `go vet ./...`, `go test ./...`.

### Sheet state

The client builds the sheet state from the JSON the server embeds next to the sheet
(`#sheet-state`). `ui/static/js/sheet/schema` describes every field the templates render,
and `normalizeSheet` brings stored content to that shape. The watch bundle compares that
state with the one scanned from the server-rendered markup and logs any difference.

- `npm run gen:types` regenerates `schema/content.gen.ts` from the Go structs (tygo).
  Run it after changing `internal/models/character_sheets_content.go`; CI checks it.
- `npm run reconcile:sheets -- --dump sheets.jsonl` renders every sheet of a dump and
  compares both states offline. Make the dump with
  ```bash
  psql "$DATABASE_URL" -Atc "select json_build_object('id', id, 'kind', sheet_kind, 'content', content) from character_sheets" > sheets.jsonl
  ```
  CI runs it on the synthetic sheets of `scripts/reconcile/edge-sheets.mjs`.

### Docker

```bash
docker compose up
```

---

## About

I was frustrated with Roll20's laggy sheets and general slowness, so I set out to build a better character sheet. The site launched in November 2025, and I can boast not only my friends use it. On release I thought it was complete, but further use revealed more features worth adding.

**Since launch, the following has been added:**
- Tabs for psychic and tech power schools
- Significantly more automation
- Migration from an event-based system to Preact signals for reactive calculations
- One-click rolls for skill checks, ability tests, initiative, etc.
- Modifier builders for attacks, psychic tests, and rolls

**Currently planned:**
- Autocomplete and autofill for advancements, gear, talents, psychic powers, etc.
- Russian localisation (i18n)
- Bug fixes as needed and refactoring when my heart says so

I hope you find the site enjoyable and useful in your endeavors, dogmatic or chaotic.

---

## Contact

- Email: [iociveteres@gmail.com](mailto:iociveteres@gmail.com)
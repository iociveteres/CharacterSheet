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
- **Frontend:** Alpine.js, Preact signals, SortableJS, vanilla JS
- **Transport:** WebSocket, custom JSON API
- **Infrastructure:** Docker, VPS

---

## Running Locally

### Prerequisites

- Go 1.22+
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

4. **Start the server**
   ```bash
   go run ./cmd/web
   ```

   The site will be available at `http://localhost:4000`.

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
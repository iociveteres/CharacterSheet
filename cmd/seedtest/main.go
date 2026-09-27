// Command seedtest puts a test room into the local database: verified users
// with every room role, a sheet for each player and enough chat for "Load
// earlier messages". Run it again to undo what a test did to the room: roles
// and membership go back, a kicked player returns, the outsider leaves,
// folders and sheets made by tests are deleted, the seeded sheets get their
// name and visibility back, the stress sheets (stress.go) are made anew.
// The chat is kept.
// It prints the room and the users as JSON (scripts/e2e/seed.mjs reads it):
//
//	npm run seed
//
// It refuses a database that is not on this machine.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"golang.org/x/crypto/bcrypt"

	"charactersheet.iociveteres.net/internal/models"
)

// The password of every seeded user.
const password = "seed-password"

const roomName = "Seed room"

// Chat messages the room has at least: more than one page of 50.
const chatMessages = 60

type seedUser struct {
	Key   string `json:"key"`
	Name  string `json:"name"`
	Email string `json:"email"`
	// Empty for a user who is not in the room.
	Role models.RoomRole `json:"role"`
	ID   int             `json:"id"`
	// The user's own sheet in the room; 0 for a user without one.
	SheetID int `json:"sheetId,omitempty"`
}

var users = []*seedUser{
	{Key: "gm", Name: "Seed GM", Email: "gm@seed.test", Role: models.RoleGamemaster},
	{Key: "moderator", Name: "Seed Moderator", Email: "moderator@seed.test", Role: models.RoleModerator},
	{Key: "player", Name: "Seed Player", Email: "player@seed.test", Role: models.RolePlayer},
	{Key: "player2", Name: "Seed Player 2", Email: "player2@seed.test", Role: models.RolePlayer},
	{Key: "outsider", Name: "Seed Outsider", Email: "outsider@seed.test"},
}

type output struct {
	RoomID   int         `json:"roomId"`
	Password string      `json:"password"`
	Users    []*seedUser `json:"users"`
	// Sheet ids by profile name ("M", "XL"); the player owns them.
	StressSheets map[string]int `json:"stressSheets"`
}

func main() {
	_ = godotenv.Load()
	dsn := flag.String("dsn", os.Getenv("DATABASE_URL"), "PostgreSQL data source name")
	flag.Parse()

	ctx := context.Background()
	if err := checkLocal(*dsn); err != nil {
		log.Fatal(err)
	}
	db, err := pgxpool.New(ctx, *dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	roomID, stress, err := seed(ctx, db, models.NewModels(db))
	if err != nil {
		log.Fatal(err)
	}

	out, err := json.MarshalIndent(output{RoomID: roomID, Password: password, Users: users, StressSheets: stress}, "", "  ")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(string(out))
}

// checkLocal fails unless the database is on this machine: the seed resets
// roles and passwords, which must never happen to real users.
func checkLocal(dsn string) error {
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return err
	}
	switch cfg.Host {
	case "localhost", "127.0.0.1", "::1":
		return nil
	}
	return fmt.Errorf("refusing to seed %q: the database is not on localhost", cfg.Host)
}

func seed(ctx context.Context, db *pgxpool.Pool, m models.Models) (int, map[string]int, error) {
	for _, u := range users {
		id, err := ensureUser(ctx, db, m, u)
		if err != nil {
			return 0, nil, fmt.Errorf("user %s: %w", u.Email, err)
		}
		u.ID = id
	}
	gm, player := users[0], users[2]

	var roomID int
	err := db.QueryRow(ctx, `SELECT id FROM rooms WHERE owner_id = $1 AND name = $2 ORDER BY id LIMIT 1`,
		gm.ID, roomName).Scan(&roomID)
	if errors.Is(err, pgx.ErrNoRows) {
		roomID, err = m.Rooms.Create(ctx, gm.ID, roomName)
	}
	if err != nil {
		return 0, nil, fmt.Errorf("room: %w", err)
	}

	if _, err := db.Exec(ctx, `DELETE FROM character_sheet_folders WHERE room_id = $1`, roomID); err != nil {
		return 0, nil, fmt.Errorf("folders: %w", err)
	}

	for _, u := range users {
		if err := ensureMembership(ctx, db, roomID, u); err != nil {
			return 0, nil, fmt.Errorf("membership of %s: %w", u.Email, err)
		}
		if u.Role == "" || u.Role == models.RoleModerator {
			continue
		}
		if err := ensureSheet(ctx, db, m, roomID, u); err != nil {
			return 0, nil, fmt.Errorf("sheet of %s: %w", u.Email, err)
		}
	}

	stress, err := ensureStressSheets(ctx, db, m, roomID, player)
	if err != nil {
		return 0, nil, err
	}

	if err := ensureChat(ctx, db, m, roomID); err != nil {
		return 0, nil, fmt.Errorf("chat: %w", err)
	}
	return roomID, stress, nil
}

// ensureUser creates the user or resets its password to the seed one, and marks the e-mail
// verified so that it can sign in.
func ensureUser(ctx context.Context, db *pgxpool.Pool, m models.Models, u *seedUser) (int, error) {
	id, err := m.Users.Insert(ctx, u.Name, u.Email, password)
	if errors.Is(err, models.ErrDuplicateEmail) {
		var hash []byte
		hash, err = bcrypt.GenerateFromPassword([]byte(password), 12)
		if err != nil {
			return 0, err
		}
		err = db.QueryRow(ctx, `UPDATE users SET hashed_password = $2 WHERE email = $1 RETURNING id`,
			u.Email, string(hash)).Scan(&id)
	}
	if err != nil {
		return 0, err
	}
	_, err = db.Exec(ctx, `UPDATE users SET status = 'email_verified' WHERE id = $1`, id)
	return id, err
}

func ensureMembership(ctx context.Context, db *pgxpool.Pool, roomID int, u *seedUser) error {
	if u.Role == "" {
		_, err := db.Exec(ctx, `DELETE FROM room_members WHERE room_id = $1 AND user_id = $2`, roomID, u.ID)
		return err
	}
	_, err := db.Exec(ctx, `
INSERT INTO room_members (room_id, user_id, role)
VALUES ($1, $2, $3)
ON CONFLICT (room_id, user_id) DO UPDATE SET role = EXCLUDED.role`, roomID, u.ID, u.Role)
	return err
}

// ensureSheet leaves the user one sheet in the room, their first, named after
// them and visible to everyone; it creates the sheet if there is none.
func ensureSheet(ctx context.Context, db *pgxpool.Pool, m models.Models, roomID int, u *seedUser) error {
	var first *int
	err := db.QueryRow(ctx, `SELECT min(id) FROM character_sheets WHERE room_id = $1 AND owner_id = $2`,
		roomID, u.ID).Scan(&first)
	if err != nil {
		return err
	}
	id := 0
	if first != nil {
		id = *first
	} else if id, err = m.CharacterSheets.Insert(ctx, u.ID, roomID, models.DefaultSheetKind); err != nil {
		return err
	}
	if _, err := db.Exec(ctx, `DELETE FROM character_sheets WHERE room_id = $1 AND owner_id = $2 AND id <> $3`,
		roomID, u.ID, id); err != nil {
		return err
	}
	u.SheetID = id
	_, err = db.Exec(ctx, `
UPDATE character_sheets
SET content = jsonb_set(content, '{characterInfo,characterName}', to_jsonb($2::text)),
    sheet_visibility = 'everyone_can_view'
WHERE id = $1`, id, u.Name+"'s character")
	return err
}

// ensureChat fills the chat up to chatMessages, taking turns between the members.
func ensureChat(ctx context.Context, db *pgxpool.Pool, m models.Models, roomID int) error {
	var count int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM room_messages WHERE room_id = $1`, roomID).Scan(&count); err != nil {
		return err
	}
	members := []*seedUser{}
	for _, u := range users {
		if u.Role != "" {
			members = append(members, u)
		}
	}
	for i := count; i < chatMessages; i++ {
		author := members[i%len(members)]
		if _, _, err := m.RoomMessages.Create(ctx, author.ID, roomID, fmt.Sprintf("Seed message %d", i+1), nil, nil); err != nil {
			return err
		}
	}
	return nil
}
